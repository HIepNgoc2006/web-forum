import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const port = Number(process.env.E2E_PORT ?? 3210);
const chromeDebugPort = Number(process.env.CHROME_DEBUG_PORT ?? 9223);
const baseUrl = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fileExists(filePath) {
  try {
    const fs = await import('node:fs/promises');
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    isWindows ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '',
    isWindows ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : '',
    isWindows ? 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' : '',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return '';
}

function spawnProcess(command, args, options = {}) {
  return spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    ...options
  });
}

function collectProcess(child) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function stopProcess(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
  await waitForExit(child);
}

async function waitForChromeDebug() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${chromeDebugPort}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until Chrome exposes the debugging endpoint.
    }
    await sleep(200);
  }
  throw new Error('Chrome DevTools endpoint did not become ready within 10s.');
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the server is ready.
    }
    await sleep(250);
  }
  throw new Error('Backend did not become healthy within 15s.');
}

async function createSeedThread() {
  const threadResponse = await fetch(`${baseUrl}/api/boards/confession/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      body: 'Bài kiểm thử browser smoke cho CI',
      captchaToken: 'dev-pass',
      posterToken: 'ci-poster'
    })
  });
  if (!threadResponse.ok) {
    throw new Error(`Could not create smoke thread: ${threadResponse.status}`);
  }
  const threadPayload = await threadResponse.json();
  const threadId = threadPayload.data.thread.id;

  const commentResponse = await fetch(`${baseUrl}/api/threads/${threadId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      body: '>>1 phản hồi kiểm thử',
      captchaToken: 'dev-pass',
      posterToken: 'ci-poster'
    })
  });
  if (!commentResponse.ok) {
    throw new Error(`Could not create smoke comment: ${commentResponse.status}`);
  }

  return threadId;
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const fail = (event) => reject(event.error || new Error('Could not connect to Chrome DevTools WebSocket.'));
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', fail, { once: true });
  });
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message));
        } else {
          resolve(message.result || {});
        }
        return;
      }
      if (message.method) {
        this.events.push(message);
      }
    });
  }

  send(method, params = {}, timeoutMs = 10000) {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  close() {
    this.ws.close();
  }
}

function assertIncludes(html, checks, label) {
  for (const check of checks) {
    if (!html.includes(check)) {
      throw new Error(`${label} did not render expected text: ${check}`);
    }
  }
}

async function createTarget(url) {
  const encodedUrl = encodeURIComponent(url);
  let response = await fetch(`http://127.0.0.1:${chromeDebugPort}/json/new?${encodedUrl}`, { method: 'PUT' });
  if (!response.ok) {
    response = await fetch(`http://127.0.0.1:${chromeDebugPort}/json/new?${encodedUrl}`);
  }
  if (!response.ok) {
    throw new Error(`Could not create Chrome target: ${response.status}`);
  }
  return response.json();
}

async function closeTarget(targetId) {
  await fetch(`http://127.0.0.1:${chromeDebugPort}/json/close/${targetId}`).catch(() => {});
}

async function smokePage(page) {
  const target = await createTarget('about:blank');
  const cdp = new CdpSession(await connectWebSocket(target.webSocketDebuggerUrl));

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable').catch(() => {});

    if (page.width && page.height) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: page.width,
        height: page.height,
        deviceScaleFactor: 1,
        mobile: true
      });
    } else {
      await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    }

    await cdp.send('Page.navigate', { url: page.url });
    if (page.loginAdmin) {
      await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin-password' })
          });
          if (!response.ok) {
            throw new Error('Admin smoke login failed: ' + response.status);
          }
          const payload = await response.json();
          localStorage.setItem('adminToken', payload.data.token);
          location.reload();
          return true;
        })()`,
        awaitPromise: true,
        returnByValue: true
      });
    }

    const deadline = Date.now() + 12000;
    let snapshot = null;
    while (Date.now() < deadline) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `(() => ({
          text: document.body ? document.body.innerText : '',
          innerWidth: window.innerWidth,
          scrollWidth: Math.max(document.body?.scrollWidth || 0, document.documentElement?.scrollWidth || 0)
        }))()`,
        returnByValue: true
      });
      snapshot = result.result?.value;
      if (snapshot?.text && page.checks.every((check) => snapshot.text.includes(check))) {
        break;
      }
      await sleep(250);
    }

    assertIncludes(snapshot?.text || '', page.checks, page.label);
    if (page.width && snapshot.scrollWidth > snapshot.innerWidth) {
      throw new Error(`${page.label} has horizontal overflow: ${snapshot.scrollWidth} > ${snapshot.innerWidth}`);
    }

    const runtimeErrors = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown');
    const logErrors = cdp.events.filter((event) => event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error');
    if (runtimeErrors.length || logErrors.length) {
      throw new Error(`${page.label} emitted browser errors.`);
    }
  } finally {
    cdp.close();
    await closeTarget(target.id);
  }
}

async function main() {
  const chromePath = await findChrome();
  if (!chromePath) {
    if (process.env.CI) {
      throw new Error('Chrome/Chromium was not found. Set CHROME_PATH or install Google Chrome.');
    }
    console.log('Chrome/Chromium was not found; skipping browser smoke test outside CI.');
    return;
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), '36chan-browser-smoke-'));
  const userDataDir = path.join(tempRoot, 'chrome-profile');
  const server = spawnProcess(process.execPath, [path.join(repoRoot, 'backend/server.js')], {
    cwd: tempRoot,
    env: {
      ...process.env,
      // Browser smoke verifies dashboard rendering; backend tests cover production admin 2FA enforcement.
      NODE_ENV: 'test',
      PORT: String(port),
      STORE_DRIVER: 'json',
      STATIC_ROOT: path.join(repoRoot, 'frontend/dist'),
      UPLOAD_ROOT: path.join(tempRoot, 'uploads'),
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin-password',
      JWT_SECRET: 'browser-smoke-secret',
      MODERATION_FINGERPRINT_SECRET: 'browser-smoke-secret',
      POSTER_PROOF_SECRET: 'browser-smoke-secret'
    }
  });
  const chrome = spawnProcess(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${chromeDebugPort}`,
    'about:blank'
  ]);

  try {
    await waitForHealth();
    await waitForChromeDebug();
    const threadId = await createSeedThread();
    const pages = [
      {
        label: 'home desktop',
        url: `${baseUrl}/#home`,
        checks: ['36chan là gì?', 'Bảng', 'Bài mới nhất', 'Chủ đề đang theo dõi', 'Bài của tôi', 'Bảng đang theo dõi', 'Thống Kê Máy Chủ']
      },
      {
        label: 'board desktop',
        url: `${baseUrl}/#board/confession`,
        checks: ['Tạo chủ đề mới', 'Danh mục', 'Kho lưu trữ', 'Bài kiểm thử browser smoke cho CI']
      },
      {
        label: 'thread desktop',
        url: `${baseUrl}/#thread/${threadId}`,
        checks: ['Đăng trả lời', 'Theo dõi', 'Bài kiểm thử browser smoke cho CI', 'phản hồi kiểm thử']
      },
      {
        label: 'catalog desktop',
        url: `${baseUrl}/#catalog/confession`,
        checks: ['Danh mục', 'Sắp xếp theo:', 'Lọc:', 'Có ảnh', 'Bài kiểm thử browser smoke cho CI']
      },
      {
        label: 'admin desktop',
        url: `${baseUrl}/#admin`,
        checks: ['Hàng đợi kiểm duyệt', 'Tài khoản', 'Đăng nhập']
      },
      {
        label: 'admin dashboard desktop',
        url: `${baseUrl}/#admin`,
        loginAdmin: true,
        checks: ['AI chờ duyệt', 'Báo cáo', 'Đã duyệt', 'Nhật ký', 'Hàng đợi trống']
      },
      {
        label: 'home mobile',
        url: `${baseUrl}/#home`,
        width: 390,
        height: 844,
        checks: ['36chan là gì?', 'Bảng', 'Bài mới nhất', 'Chủ đề đang theo dõi', 'Bài của tôi', 'Bảng đang theo dõi']
      },
      {
        label: 'thread mobile',
        url: `${baseUrl}/#thread/${threadId}`,
        width: 390,
        height: 844,
        checks: ['Đăng trả lời', 'Bài kiểm thử browser smoke cho CI']
      }
    ];

    for (const page of pages) {
      await smokePage(page);
    }

    console.log(`Browser smoke passed with ${chromePath}`);
  } finally {
    await stopProcess(server);
    await stopProcess(chrome);
    await sleep(300);
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
