import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const requestedPort = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 0;
const requestedChromeDebugPort = process.env.CHROME_DEBUG_PORT ? Number(process.env.CHROME_DEBUG_PORT) : 0;
let port = requestedPort;
let chromeDebugPort = requestedChromeDebugPort;
let baseUrl = '';

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

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const value = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(value));
    });
  });
}

async function resolvePort(requested, label) {
  if (Number.isInteger(requested) && requested > 0) {
    return requested;
  }
  const value = await freePort();
  if (!value) {
    throw new Error(`Could not allocate a ${label} port.`);
  }
  return value;
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
  const videoThreadResponse = await fetch(`${baseUrl}/api/boards/confession/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subject: 'Smoke video thread',
      body: 'Chủ đề video kiểm thử catalog',
      captchaToken: 'dev-pass',
      posterToken: 'ci-poster-video',
      image: {
        name: 'catalog-video-smoke.webm',
        type: 'video/webm',
        dataUrl: 'data:video/webm;base64,AAAA',
        sizeBytes: 3,
        width: 1,
        height: 1
      }
    })
  });
  if (!videoThreadResponse.ok) {
    const body = await videoThreadResponse.text().catch(() => '');
    throw new Error(`Could not create smoke video thread: ${videoThreadResponse.status} ${body}`);
  }

  const threadResponse = await fetch(`${baseUrl}/api/boards/confession/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subject: 'Smoke subject title',
      body: 'Bài kiểm thử browser smoke cho CI\n#dice 1d6',
      captchaToken: 'dev-pass',
      deletePassword: 'smoke-delete-pass',
      posterToken: 'ci-poster',
      image: {
        name: 'thread-media-smoke.png',
        type: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        sizeBytes: 68,
        width: 1,
        height: 1,
        thumbnail: {
          name: 'thread-media-smoke-thumb.png',
          type: 'image/png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
          sizeBytes: 68,
          width: 1,
          height: 1
        }
      }
    })
  });
  if (!threadResponse.ok) {
    const body = await threadResponse.text().catch(() => '');
    throw new Error(`Could not create smoke thread: ${threadResponse.status} ${body}`);
  }
  const threadPayload = await threadResponse.json();
  const threadId = threadPayload.data.thread.id;
  const threadGlobalNumber = threadPayload.data.thread.globalNumber;

  const commentResponse = await fetch(`${baseUrl}/api/threads/${threadId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      body: `>>${threadGlobalNumber} phản hồi kiểm thử smoke-thread-search-token`,
      captchaToken: 'dev-pass',
      posterToken: 'ci-poster',
      image: {
        name: 'omitted-reply-smoke.png',
        type: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        sizeBytes: 68,
        width: 1,
        height: 1,
        thumbnail: {
          name: 'omitted-reply-smoke-thumb.png',
          type: 'image/png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
          sizeBytes: 68,
          width: 1,
          height: 1
        }
      }
    })
  });
  if (!commentResponse.ok) {
    const body = await commentResponse.text().catch(() => '');
    throw new Error(`Could not create smoke comment: ${commentResponse.status} ${body}`);
  }

  for (const index of [2, 3, 4]) {
    const previewResponse = await fetch(`${baseUrl}/api/threads/${threadId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: `board preview phản hồi ${index}`,
        captchaToken: 'dev-pass',
        posterToken: `ci-poster-preview-${index}`
      })
    });
    if (!previewResponse.ok) {
      const body = await previewResponse.text().catch(() => '');
      throw new Error(`Could not create smoke preview comment ${index}: ${previewResponse.status} ${body}`);
    }
  }

  const neighborResponse = await fetch(`${baseUrl}/api/boards/confession/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subject: 'Smoke neighboring thread',
      body: 'Chủ đề kề bên để kiểm thử điều hướng thread',
      captchaToken: 'dev-pass',
      posterToken: 'ci-poster-neighbor'
    })
  });
  if (!neighborResponse.ok) {
    const body = await neighborResponse.text().catch(() => '');
    throw new Error(`Could not create smoke neighbor thread: ${neighborResponse.status} ${body}`);
  }

  return threadId;
}

async function createPendingThread(body, posterToken, media = {}) {
  const threadResponse = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      body,
      captchaToken: 'dev-pass',
      posterToken,
      ...media
    })
  });
  if (!threadResponse.ok) {
    const responseBody = await threadResponse.text().catch(() => '');
    throw new Error(`Could not create pending smoke thread: ${threadResponse.status} ${responseBody}`);
  }
  const threadPayload = await threadResponse.json();
  return threadPayload.data.thread;
}

async function createAdminToken() {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin-password' })
  });
  if (!response.ok) {
    throw new Error(`Admin smoke login failed: ${response.status}`);
  }
  const payload = await response.json();
  if (!payload.data?.token) {
    throw new Error('Admin smoke login did not return a token.');
  }
  return payload.data.token;
}

async function createDeletedAppealThread(adminToken) {
  const threadResponse = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subject: 'Appeal form smoke',
      body: 'Bài kiểm thử form kháng nghị public',
      captchaToken: 'dev-pass',
      posterToken: 'ci-poster-appeal'
    })
  });
  if (!threadResponse.ok) {
    const body = await threadResponse.text().catch(() => '');
    throw new Error(`Could not create appeal smoke thread: ${threadResponse.status} ${body}`);
  }
  const threadPayload = await threadResponse.json();
  const thread = threadPayload.data.thread;
  const appealToken = threadPayload.data.appealToken;
  if (!thread?.globalNumber || !appealToken) {
    throw new Error('Appeal smoke thread did not return a global number and appeal token.');
  }
  const deleteResponse = await fetch(`${baseUrl}/api/admin/posts/${thread.globalNumber}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ reason: 'Browser smoke appeal setup' })
  });
  if (!deleteResponse.ok) {
    const body = await deleteResponse.text().catch(() => '');
    throw new Error(`Could not delete appeal smoke thread: ${deleteResponse.status} ${body}`);
  }
  return { appealToken, globalNumber: thread.globalNumber };
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

function assertContrastPairs(pairs, label) {
  for (const pair of pairs) {
    if (!Number.isFinite(pair.ratio) || pair.ratio < 4.5) {
      throw new Error(`${label} contrast check failed for ${pair.label}: ${pair.ratio}`);
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

    const preloadStatements = [];
    if (page.theme) {
      preloadStatements.push(`localStorage.setItem('theme', ${JSON.stringify(page.theme)});`);
    }
    if (page.loginAdmin) {
      if (!page.adminToken) {
        throw new Error(`${page.label} requires an admin token.`);
      }
      preloadStatements.push(`localStorage.setItem('adminToken', ${JSON.stringify(page.adminToken)});`);
    }
    if (preloadStatements.length) {
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `try { ${preloadStatements.join(' ')} } catch {}`
      });
    }

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

    const deadline = Date.now() + 25000;
    let reloaded = false;
    let snapshot = null;
    while (Date.now() < deadline) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `(() => ({
          text: document.body ? document.body.innerText : '',
          bodyClass: document.body ? document.body.className : '',
          innerWidth: window.innerWidth,
          scrollWidth: Math.max(document.body?.scrollWidth || 0, document.documentElement?.scrollWidth || 0)
        }))()`,
        returnByValue: true
      });
      snapshot = result.result?.value;
      const hasExpectedText = snapshot?.text && page.checks.every((check) => snapshot.text.includes(check));
      const hasExpectedTheme = !page.theme || String(snapshot?.bodyClass || '').includes(`theme-${page.theme}`);
      if (hasExpectedText && hasExpectedTheme) {
        break;
      }
      if (!reloaded && Date.now() > deadline - 12500) {
        reloaded = true;
        await cdp.send('Page.navigate', { url: page.url });
      }
      await sleep(250);
    }

    assertIncludes(snapshot?.text || '', page.checks, page.label);
    if (page.theme && !String(snapshot?.bodyClass || '').includes(`theme-${page.theme}`)) {
      throw new Error(`${page.label} did not apply theme-${page.theme}.`);
    }
    if (page.width && snapshot.scrollWidth > snapshot.innerWidth) {
      throw new Error(`${page.label} has horizontal overflow: ${snapshot.scrollWidth} > ${snapshot.innerWidth}`);
    }

    if (page.contrastCheck) {
      const contrast = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const styles = getComputedStyle(document.body);
          const resolveColor = (value) => {
            const probe = document.createElement('span');
            probe.style.color = value;
            document.body.appendChild(probe);
            const computed = getComputedStyle(probe).color;
            probe.remove();
            const match = computed.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
            return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
          };
          const luminance = ([r, g, b]) => {
            const channels = [r, g, b].map((channel) => {
              const normalized = channel / 255;
              return normalized <= 0.03928
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          const ratio = (foreground, background) => {
            const fg = resolveColor(foreground);
            const bg = resolveColor(background);
            if (!fg || !bg) {
              return 0;
            }
            const lighter = Math.max(luminance(fg), luminance(bg));
            const darker = Math.min(luminance(fg), luminance(bg));
            return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
          };
          const variable = (name) => styles.getPropertyValue(name).trim();
          return [
            { label: 'text/page', ratio: ratio(variable('--text'), variable('--page')) },
            { label: 'text/reply', ratio: ratio(variable('--text'), variable('--reply')) },
            { label: 'link/page', ratio: ratio(variable('--link'), variable('--page')) },
            { label: 'link/reply', ratio: ratio(variable('--link'), variable('--reply')) },
            { label: 'header/page', ratio: ratio(variable('--header'), variable('--page')) },
            { label: 'text/label', ratio: ratio(variable('--text'), variable('--label')) }
          ];
        })()`,
        returnByValue: true
      });
      assertContrastPairs(contrast.result?.value || [], page.label);
    }

    if (page.accessibilityCheck) {
      const unlabeled = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const controls = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')];
          const visible = (element) => {
            if (element.disabled || element.closest('.hidden,[hidden],[aria-hidden="true"]')) {
              return false;
            }
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          };
          const hasName = (element) => {
            if (element.labels?.length) {
              return true;
            }
            if (element.getAttribute('aria-label')?.trim()) {
              return true;
            }
            const labelledBy = element.getAttribute('aria-labelledby');
            if (labelledBy) {
              return labelledBy
                .split(/\\s+/)
                .some((id) => document.getElementById(id)?.textContent?.trim());
            }
            return Boolean(element.getAttribute('title')?.trim());
          };
          return controls
            .filter((element) => visible(element) && !hasName(element))
            .map((element) => element.outerHTML.slice(0, 180));
        })()`,
        returnByValue: true
      });
      const unlabeledControls = unlabeled.result?.value || [];
      if (unlabeledControls.length) {
        throw new Error(`${page.label} has visible form controls without accessible names: ${unlabeledControls.join(' | ')}`);
      }
    }

    if (page.interaction) {
      await page.interaction(cdp);
    }

    if (page.screenshotPath) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const image = Buffer.from(screenshot.data || '', 'base64');
      if (image.length < 1000) {
        throw new Error(`${page.label} screenshot was unexpectedly small.`);
      }
      await writeFile(page.screenshotPath, image);
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

  port = await resolvePort(requestedPort, 'backend');
  chromeDebugPort = await resolvePort(requestedChromeDebugPort, 'Chrome debugging');
  baseUrl = `http://127.0.0.1:${port}`;

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), '36chan-browser-smoke-'));
  const screenshotRoot = process.env.VISUAL_SCREENSHOT_DIR
    ? path.resolve(repoRoot, process.env.VISUAL_SCREENSHOT_DIR)
    : path.join(tempRoot, 'screenshots');
  await mkdir(screenshotRoot, { recursive: true });
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
    const adminToken = await createAdminToken();
    const threadId = await createSeedThread();
    let approvePendingThread = null;
    let deletePendingThread = null;
    let appealSmoke = null;
    const pages = [
      {
        label: 'home desktop',
        url: `${baseUrl}/#home`,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-home-desktop.png'),
        checks: ['36chan là gì?', 'Bảng', 'Bài mới nhất', 'Chủ đề đang theo dõi', 'Bài của tôi', 'Bảng đang theo dõi', 'Thống Kê Máy Chủ']
      },
      {
        label: 'board desktop',
        url: `${baseUrl}/#board/confession`,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-board-desktop.png'),
        checks: [
          'Tạo chủ đề mới',
          'Danh mục',
          'Kho lưu trữ',
          'Sắp xếp theo',
          'Có video',
          'Smoke subject title',
          'Bài kiểm thử browser smoke cho CI',
          'Bỏ qua 1 phản hồi và 1 tệp.',
          'board preview phản hồi 4'
        ],
        async interaction(cdp) {
          const result = await cdp.send('Runtime.evaluate', {
            expression: `(async () => {
              document.querySelector('[data-board-filter="video"]')?.click();
              const videoFilterDeadline = Date.now() + 3000;
              let boardVideoFilterActive = false;
              let boardVideoFilterPressed = '';
              let boardVideoFilterText = '';
              while (Date.now() < videoFilterDeadline) {
                const button = document.querySelector('[data-board-filter="video"]');
                boardVideoFilterActive = button?.classList.contains('active') ?? false;
                boardVideoFilterPressed = button?.getAttribute('aria-pressed') || '';
                boardVideoFilterText = document.querySelector('#threadList')?.innerText || '';
                if (
                  boardVideoFilterActive &&
                  boardVideoFilterPressed === 'true' &&
                  boardVideoFilterText.includes('Smoke video thread') &&
                  !boardVideoFilterText.includes('Smoke subject title')
                ) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              document.querySelector('[data-board-filter="all"]')?.click();
              const allFilterDeadline = Date.now() + 3000;
              let boardAllFilterActive = false;
              while (Date.now() < allFilterDeadline) {
                boardAllFilterActive = document.querySelector('[data-board-filter="all"]')?.classList.contains('active') ?? false;
                const text = document.querySelector('#threadList')?.innerText || '';
                if (boardAllFilterActive && text.includes('Smoke subject title')) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              document.querySelector('[data-board-sort="replies"]')?.click();
              await new Promise((resolve) => setTimeout(resolve, 350));
              const boardSortActive = document.querySelector('[data-board-sort="replies"]')?.classList.contains('active') ?? false;
              const boardSortPressed = document.querySelector('[data-board-sort="replies"]')?.getAttribute('aria-pressed') || '';
              document.querySelector('#startThreadButton')?.click();
              await new Promise((resolve) => setTimeout(resolve, 100));
              document.querySelector('[data-thread-template="study"]')?.click();
              const body = document.querySelector('#threadBody');
              body.value += '\\nSố điện thoại 0912345678';
              body.dispatchEvent(new Event('input', { bubbles: true }));
              const deletePasswordInput = document.querySelector('#threadForm [name="deletePassword"]');
              if (deletePasswordInput) {
                deletePasswordInput.value = 'ui-delete-pass';
                deletePasswordInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
              const draft = localStorage.getItem('draft:thread:confession') || '';
              const warning = document.querySelector('#threadPrivacyWarning');
              const listText = document.querySelector('#threadList')?.innerText || '';
              const previewCount = document.querySelectorAll('#threadList .reply-preview').length;
              const jsonFeedHref = document.querySelector('#boardJsonFeedLink')?.href || '';
              const rssFeedHref = document.querySelector('#boardRssFeedLink')?.href || '';
              const bottomJsonFeedHref = document.querySelector('#boardJsonFeedLinkBottom')?.href || '';
              const bottomRssFeedHref = document.querySelector('#boardRssFeedLinkBottom')?.href || '';
              return {
                value: body.value,
                draft,
                warningText: warning?.textContent || '',
                warningHidden: warning?.classList.contains('hidden') ?? true,
                deletePasswordVisible: Boolean(deletePasswordInput),
                deletePasswordStored: localStorage.getItem('deletePassword') || '',
                deletePasswordSynced: [...document.querySelectorAll('[data-delete-password-input]')].every((input) => input.value === 'ui-delete-pass'),
                postedAutomatically: listText.includes('Mình muốn chia sẻ chuyện học tập'),
                boardVideoFilterActive,
                boardVideoFilterPressed,
                boardVideoFilterText,
                boardAllFilterActive,
                boardSortActive,
                boardSortPressed,
                previewCount,
                hasOmittedReplies: listText.includes('Bỏ qua 1 phản hồi và 1 tệp.'),
                hasLatestPreview: listText.includes('board preview phản hồi 4'),
                jsonFeedHref,
                rssFeedHref,
                bottomJsonFeedHref,
                bottomRssFeedHref
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          const payload = result.result?.value || {};
          if (!payload.value.includes('Mình muốn chia sẻ chuyện học tập') || !payload.value.includes('Số điện thoại 0912345678')) {
            throw new Error('board desktop did not insert and edit the confession template.');
          }
          if (payload.draft !== payload.value) {
            throw new Error('board desktop did not autosave the edited template draft.');
          }
          if (payload.warningHidden || !payload.warningText.includes('số điện thoại')) {
            throw new Error('board desktop did not rescan privacy risk after template insertion.');
          }
          if (!payload.deletePasswordVisible || payload.deletePasswordStored !== 'ui-delete-pass' || !payload.deletePasswordSynced) {
            throw new Error(
              `board desktop delete password sync failed: visible=${Boolean(payload.deletePasswordVisible)} stored=${payload.deletePasswordStored || 'missing'} synced=${Boolean(payload.deletePasswordSynced)}`
            );
          }
          if (payload.postedAutomatically) {
            throw new Error('board desktop template insertion posted automatically.');
          }
          if (!payload.boardVideoFilterActive || payload.boardVideoFilterPressed !== 'true') {
            throw new Error('board desktop did not activate video filter.');
          }
          if (!payload.boardVideoFilterText?.includes('Smoke video thread') || payload.boardVideoFilterText?.includes('Smoke subject title')) {
            throw new Error(`board desktop video filter failed: ${payload.boardVideoFilterText || 'missing list text'}`);
          }
          if (!payload.boardAllFilterActive) {
            throw new Error('board desktop did not restore all filter.');
          }
          if (!payload.boardSortActive || payload.boardSortPressed !== 'true') {
            throw new Error('board desktop did not activate the reply-count board sort control.');
          }
          if (payload.previewCount < 3 || !payload.hasOmittedReplies || !payload.hasLatestPreview) {
            throw new Error(
              `board desktop reply previews failed: count=${payload.previewCount || 0} omitted=${Boolean(payload.hasOmittedReplies)} latest=${Boolean(payload.hasLatestPreview)}`
            );
          }
          if (
            !payload.jsonFeedHref.endsWith('/feeds/boards/confession/threads.json') ||
            !payload.rssFeedHref.endsWith('/feeds/boards/confession/threads.rss') ||
            !payload.bottomJsonFeedHref.endsWith('/feeds/boards/confession/threads.json') ||
            !payload.bottomRssFeedHref.endsWith('/feeds/boards/confession/threads.rss')
          ) {
            throw new Error('board desktop did not expose active board JSON/RSS feed links.');
          }
        }
      },
      {
        label: 'thread desktop',
        url: `${baseUrl}/#thread/${threadId}`,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-thread-desktop.png'),
        checks: ['Đăng trả lời', 'Theo dõi', 'Bài kiểm thử browser smoke cho CI', 'phản hồi kiểm thử'],
        async interaction(cdp) {
          const result = await cdp.send('Runtime.evaluate', {
            expression: `(async () => {
              const threadId = ${JSON.stringify(threadId)};
              const notifications = [];
              const clipboardWrites = [];
              class FakeNotification {
                static permission = 'granted';
                constructor(title, options = {}) {
                  notifications.push({ title, options });
                }
                close() {}
              }
              Object.defineProperty(window, 'Notification', { configurable: true, value: FakeNotification });
              Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                  writeText: async (text) => {
                    clipboardWrites.push(String(text));
                  }
                }
              });
              const threadNavLink = document.querySelector('[data-thread-nav]');
              const threadNavHref = threadNavLink?.getAttribute('href') || '';
              if (!threadNavLink || !threadNavHref.startsWith('#thread/')) {
                throw new Error('thread previous/next navigation link missing');
              }
              const threadJsonFeedHref = document.querySelector('[data-thread-json-feed]')?.getAttribute('href') || '';
              const threadRssFeedHref = document.querySelector('[data-thread-rss-feed]')?.getAttribute('href') || '';
              if (
                threadJsonFeedHref !== '/feeds/threads/' + encodeURIComponent(threadId) + '/posts.json' ||
                threadRssFeedHref !== '/feeds/threads/' + encodeURIComponent(threadId) + '/posts.rss'
              ) {
                throw new Error('thread desktop did not expose thread JSON/RSS feed links.');
              }
              const mediaButton = document.querySelector('[data-thread-media-toggle]');
              if (!mediaButton) {
                throw new Error('thread media toolbar button missing');
              }
              mediaButton.click();
              const mediaExpandDeadline = Date.now() + 3000;
              let mediaExpandedCount = 0;
              let mediaButtonAfterExpand = '';
              let firstMediaLoaded = false;
              while (Date.now() < mediaExpandDeadline) {
                const mediaToggles = [...document.querySelectorAll('#threadDetail [data-image-toggle]')];
                mediaExpandedCount = mediaToggles.filter((toggle) => toggle.classList.contains('expanded')).length;
                mediaButtonAfterExpand = document.querySelector('[data-thread-media-toggle]')?.textContent?.trim() || '';
                firstMediaLoaded = mediaToggles.some((toggle) => toggle.querySelector('img')?.dataset.fullLoaded === 'true');
                if (mediaToggles.length > 0 && mediaExpandedCount === mediaToggles.length && mediaButtonAfterExpand === 'Thu media' && firstMediaLoaded) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              document.querySelector('[data-thread-media-toggle]')?.click();
              const mediaCollapseDeadline = Date.now() + 3000;
              let mediaCollapsedCount = -1;
              let mediaButtonAfterCollapse = '';
              while (Date.now() < mediaCollapseDeadline) {
                const mediaToggles = [...document.querySelectorAll('#threadDetail [data-image-toggle]')];
                mediaCollapsedCount = mediaToggles.filter((toggle) => !toggle.classList.contains('expanded')).length;
                mediaButtonAfterCollapse = document.querySelector('[data-thread-media-toggle]')?.textContent?.trim() || '';
                if (mediaToggles.length > 0 && mediaCollapsedCount === mediaToggles.length && mediaButtonAfterCollapse === 'Mở media') {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              const mediaIndex = document.querySelector('#threadDetail .thread-media-index');
              const mediaIndexItems = [...document.querySelectorAll('#threadDetail [data-thread-media-jump]')];
              const mediaIndexFirst = mediaIndexItems[0];
              const mediaIndexHref = mediaIndexFirst?.getAttribute('href') || '';
              const mediaIndexLabel = mediaIndex?.innerText || '';
              mediaIndexFirst?.click();
              const mediaIndexFocusDeadline = Date.now() + 3000;
              let mediaIndexFocusedPost = '';
              while (Date.now() < mediaIndexFocusDeadline) {
                mediaIndexFocusedPost = document.querySelector('#threadDetail .permalink-target')?.id || '';
                if (mediaIndexFocusedPost) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              localStorage.setItem('notificationPreferences', JSON.stringify({
                email: false,
                watchedThreads: true,
                boardSubscriptions: false,
                browserWatchedThreads: true
              }));
              const watchButton = document.querySelector('[data-toggle-watch]');
              if (!watchButton) {
                throw new Error('watch button missing');
              }
              watchButton.click();
              const deadline = Date.now() + 3000;
              while (!localStorage.getItem('watchedThreads')?.includes(threadId) && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const response = await fetch('/api/threads/' + encodeURIComponent(threadId) + '/comments', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  body: 'browser notification smoke',
                  captchaToken: 'dev-pass',
                  posterToken: 'ci-poster-notify',
                  options: 'sage'
                })
              });
              if (!response.ok) {
                throw new Error('notification smoke comment failed: ' + response.status);
              }
              const notificationBody = await response.json();
              const commentNumber = Number(notificationBody?.data?.comment?.globalNumber || notificationBody?.data?.globalNumber || 0);
              if (!Number.isFinite(commentNumber) || commentNumber <= 0) {
                throw new Error('notification smoke comment did not return a global number');
              }
              const watchedThreadLink = () =>
                [...document.querySelectorAll('#watchedThreads .watch-thread-link')].find((link) =>
                  (link.getAttribute('href') || '').includes('#thread/' + encodeURIComponent(threadId))
                );
              const watchedThreadMarkReadButton = () =>
                watchedThreadLink()?.closest('.watch-item')?.querySelector('[data-mark-watch-read]');
              const notificationDeadline = Date.now() + 3000;
              while (notifications.length === 0 && Date.now() < notificationDeadline) {
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const notificationPreferencesAfterNotify = JSON.parse(localStorage.getItem('notificationPreferences') || '{}');
              const watchedMap = JSON.parse(localStorage.getItem('watchedThreads') || '{}');
              const currentWatched = watchedMap[threadId] || {};
              watchedMap[threadId] = {
                ...currentWatched,
                maxNumber: Math.max(Number(currentWatched.maxNumber || 0), commentNumber),
                lastSeen: Math.max(0, commentNumber - 1)
              };
              localStorage.setItem('watchedThreads', JSON.stringify(watchedMap));
              window.location.hash = '#home';
              const watchDeadline = Date.now() + 5000;
              let watchHref = '';
              while (Date.now() < watchDeadline) {
                watchHref = watchedThreadLink()?.getAttribute('href') || '';
                if (watchHref.includes('?p=' + encodeURIComponent(commentNumber))) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              watchedThreadMarkReadButton()?.click();
              const readDeadline = Date.now() + 3000;
              let readWatched = {};
              let readHref = '';
              let markReadButtonStillVisible = true;
              while (Date.now() < readDeadline) {
                readWatched = JSON.parse(localStorage.getItem('watchedThreads') || '{}')[threadId] || {};
                readHref = watchedThreadLink()?.getAttribute('href') || '';
                markReadButtonStillVisible = Boolean(watchedThreadMarkReadButton());
                if (Number(readWatched.lastSeen || 0) >= commentNumber && !readHref.includes('?p=') && !markReadButtonStillVisible) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              localStorage.setItem('notificationPreferences', JSON.stringify({
                email: false,
                watchedThreads: true,
                boardSubscriptions: false,
                browserWatchedThreads: false
              }));
              const allReadResponse = await fetch('/api/threads/' + encodeURIComponent(threadId) + '/comments', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  body: 'watchlist mark all read smoke',
                  captchaToken: 'dev-pass',
                  posterToken: 'ci-poster-mark-all'
                })
              });
              if (!allReadResponse.ok) {
                throw new Error('mark-all smoke comment failed: ' + allReadResponse.status);
              }
              const allReadBody = await allReadResponse.json();
              const allReadNumber = Number(allReadBody?.data?.comment?.globalNumber || allReadBody?.data?.globalNumber || 0);
              if (!Number.isFinite(allReadNumber) || allReadNumber <= 0) {
                throw new Error('mark-all smoke comment did not return a global number');
              }
              const allReadMap = JSON.parse(localStorage.getItem('watchedThreads') || '{}');
              allReadMap[threadId] = {
                ...(allReadMap[threadId] || {}),
                maxNumber: allReadNumber,
                lastSeen: Math.max(0, allReadNumber - 1)
              };
              localStorage.setItem('watchedThreads', JSON.stringify(allReadMap));
              window.location.hash = '#home?markAll=' + encodeURIComponent(allReadNumber);
              const allReadDeadline = Date.now() + 5000;
              let allReadHref = '';
              let markAllDisabledBefore = true;
              while (Date.now() < allReadDeadline) {
                allReadHref = watchedThreadLink()?.getAttribute('href') || '';
                markAllDisabledBefore = Boolean(document.querySelector('#watchedMarkAllRead')?.disabled);
                if (allReadHref.includes('?p=' + encodeURIComponent(allReadNumber)) && !markAllDisabledBefore) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              document.querySelector('#watchedMarkAllRead')?.click();
              const markAllDeadline = Date.now() + 3000;
              let markAllWatched = {};
              let markAllHref = '';
              let markAllDisabledAfter = false;
              while (Date.now() < markAllDeadline) {
                markAllWatched = JSON.parse(localStorage.getItem('watchedThreads') || '{}')[threadId] || {};
                markAllHref = watchedThreadLink()?.getAttribute('href') || '';
                markAllDisabledAfter = Boolean(document.querySelector('#watchedMarkAllRead')?.disabled);
                if (Number(markAllWatched.lastSeen || 0) >= allReadNumber && !markAllHref.includes('?p=') && markAllDisabledAfter) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              window.location.hash = '#thread/' + encodeURIComponent(threadId);
              const returnThreadDeadline = Date.now() + 5000;
              while (!document.querySelector('#threadSearchInput') && Date.now() < returnThreadDeadline) {
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              const threadSearchInput = document.querySelector('#threadSearchInput');
              if (!threadSearchInput) {
                throw new Error('thread search input missing');
              }
              threadSearchInput.value = 'smoke-thread-search-token';
              threadSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
              document.querySelector('#threadSearchForm button[type="submit"]')?.click();
              const threadSearchDeadline = Date.now() + 3000;
              let threadSearchStatus = '';
              let threadSearchPreviewVisible = false;
              let threadSearchOtherHidden = false;
              while (Date.now() < threadSearchDeadline) {
                const detailText = document.querySelector('#threadDetail')?.innerText || '';
                threadSearchStatus = document.querySelector('#threadDetail .thread-search-status')?.textContent || '';
                threadSearchPreviewVisible = detailText.includes('smoke-thread-search-token');
                threadSearchOtherHidden = !detailText.includes('browser notification smoke');
                if (threadSearchStatus.includes('1 phản hồi khớp') && threadSearchPreviewVisible && threadSearchOtherHidden) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              document.querySelector('[data-clear-thread-search]')?.click();
              const threadSearchClearDeadline = Date.now() + 3000;
              let threadSearchCleared = false;
              while (Date.now() < threadSearchClearDeadline) {
                const detailText = document.querySelector('#threadDetail')?.innerText || '';
                threadSearchCleared = detailText.includes('browser notification smoke') && !document.querySelector('[data-clear-thread-search]');
                if (threadSearchCleared) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              const watched = JSON.parse(localStorage.getItem('watchedThreads') || '{}')[threadId] || {};
              const diceRollText = document.querySelector('.dice-roll')?.textContent || '';
              const sageMarkerVisible = Boolean([...document.querySelectorAll('.sage-marker')].find((item) => item.textContent.trim() === 'sage'));
              const commentDeletePasswordInput = document.querySelector('#commentForm [name="deletePassword"]');
              if (!commentDeletePasswordInput) {
                throw new Error('comment delete password field missing');
              }
              commentDeletePasswordInput.value = 'smoke-delete-pass';
              commentDeletePasswordInput.dispatchEvent(new Event('input', { bubbles: true }));
              const originalPrompt = window.prompt;
              let selfEditPromptDefault = '';
              window.prompt = (message, defaultValue) => {
                if (String(message || '').includes('sửa bài')) {
                  selfEditPromptDefault = String(defaultValue || '');
                }
                return 'smoke-delete-pass';
              };
              const selfEditButton = document.querySelector('#threadDetail [data-self-edit-post]');
              if (!selfEditButton) {
                throw new Error('self edit button missing');
              }
              selfEditButton.click();
              const editModalDeadline = Date.now() + 3000;
              let editTextarea = null;
              while (Date.now() < editModalDeadline) {
                editTextarea = document.querySelector('#postEditTextarea');
                if (editTextarea) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              if (!editTextarea) {
                throw new Error('self edit modal missing');
              }
              editTextarea.value = 'Bài kiểm thử browser smoke cho CI đã sửa';
              editTextarea.dispatchEvent(new Event('input', { bubbles: true }));
              document.querySelector('#postEditConfirmBtn')?.click();
              const selfEditDeadline = Date.now() + 3000;
              let selfEditBodyUpdated = false;
              let selfEditMarkerVisible = false;
              while (Date.now() < selfEditDeadline) {
                const op = document.querySelector('#threadDetail article.post.op');
                selfEditBodyUpdated = Boolean(op?.innerText.includes('Bài kiểm thử browser smoke cho CI đã sửa'));
                selfEditMarkerVisible = Boolean(op?.querySelector('.last-edited'));
                if (selfEditBodyUpdated && selfEditMarkerVisible) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              window.prompt = originalPrompt;
              const selectedQuoteButton = document.querySelector('#threadDetail article.post.op [data-quote]');
              const selectedQuoteBody = document.querySelector('#threadDetail article.post.op .post-body');
              if (!selectedQuoteButton || !selectedQuoteBody) {
                throw new Error('selected quote controls missing');
              }
              const walker = document.createTreeWalker(selectedQuoteBody, NodeFilter.SHOW_TEXT);
              let selectedQuoteNode = null;
              while (walker.nextNode()) {
                if (walker.currentNode.data.includes('browser smoke')) {
                  selectedQuoteNode = walker.currentNode;
                  break;
                }
              }
              if (!selectedQuoteNode) {
                throw new Error('selected quote source text missing');
              }
              const quoteStart = selectedQuoteNode.data.indexOf('browser smoke');
              const range = document.createRange();
              range.setStart(selectedQuoteNode, quoteStart);
              range.setEnd(selectedQuoteNode, quoteStart + 'browser smoke'.length);
              const selection = window.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
              selectedQuoteButton.click();
              await new Promise((resolve) => setTimeout(resolve, 100));
              const selectedQuoteComposerValue = document.querySelector('#commentBody')?.value || '';
              const selectedQuoteNumber = selectedQuoteButton.dataset.quote || '';
              const copyPostLinkButton = document.querySelector('#threadDetail [data-copy-post-link]');
              if (!copyPostLinkButton) {
                throw new Error('copy post link control missing');
              }
              copyPostLinkButton.click();
              const copyPostLinkDeadline = Date.now() + 3000;
              while (clipboardWrites.length === 0 && Date.now() < copyPostLinkDeadline) {
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const collapseButton = document.querySelector('#threadDetail [data-collapse-post]');
              if (!collapseButton) {
                throw new Error('post collapse button missing');
              }
              collapseButton.click();
              const collapsedPost = collapseButton.closest('.post');
              const collapsedBodyHidden = collapsedPost
                ? getComputedStyle(collapsedPost.querySelector('.post-body')).display === 'none'
                : false;
              const collapseLabel = collapseButton.textContent.trim();
              collapseButton.click();
              const expandedBodyVisible = collapsedPost
                ? getComputedStyle(collapsedPost.querySelector('.post-body')).display !== 'none'
                : false;
              const expandLabel = collapseButton.textContent.trim();
              const threadCollapseButton = document.querySelector('[data-thread-collapse-posts]');
              if (!threadCollapseButton) {
                throw new Error('thread post collapse toolbar missing');
              }
              threadCollapseButton.click();
              const postsAfterThreadCollapse = [...document.querySelectorAll('#threadDetail article.post')];
              const threadPostCount = postsAfterThreadCollapse.length;
              const threadCollapsedPostCount = postsAfterThreadCollapse.filter((post) => post.classList.contains('post-collapsed')).length;
              const threadCollapseLabel = threadCollapseButton.textContent.trim();
              const threadCollapsePressed = threadCollapseButton.getAttribute('aria-pressed');
              threadCollapseButton.click();
              const postsAfterThreadExpand = [...document.querySelectorAll('#threadDetail article.post')];
              const threadExpandedCollapsedCount = postsAfterThreadExpand.filter((post) => post.classList.contains('post-collapsed')).length;
              const threadExpandLabel = threadCollapseButton.textContent.trim();
              const threadExpandPressed = threadCollapseButton.getAttribute('aria-pressed');
              const refLink = document.querySelector('#threadDetail .post.comment .post-body .ref-link[data-ref]');
              if (!refLink) {
                throw new Error('thread quote reference link missing');
              }
              const originalFetch = window.fetch.bind(window);
              let refPreviewFetchCount = 0;
              window.fetch = (input, init) => {
                const requestUrl = String(input?.url || input || '');
                if (requestUrl.includes('/api/posts/')) {
                  refPreviewFetchCount += 1;
                }
                return originalFetch(input, init);
              };
              refLink.dispatchEvent(
                new MouseEvent('mouseover', {
                  bubbles: true,
                  clientX: 80,
                  clientY: 140
                })
              );
              const refPreviewDeadline = Date.now() + 3000;
              let refPreviewText = '';
              while (Date.now() < refPreviewDeadline) {
                const preview = document.querySelector('#refPreview');
                refPreviewText = preview?.innerText || '';
                if (preview && !preview.classList.contains('hidden') && refPreviewText.includes('Bài kiểm thử browser smoke cho CI')) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
              await new Promise((resolve) => setTimeout(resolve, 50));
              const refPreviewHiddenAfterEscape = document.querySelector('#refPreview')?.classList.contains('hidden') || false;
              refLink.dispatchEvent(
                new MouseEvent('mouseover', {
                  bubbles: true,
                  clientX: 84,
                  clientY: 144
                })
              );
              const refPreviewCacheDeadline = Date.now() + 1000;
              let refPreviewCachedText = '';
              while (Date.now() < refPreviewCacheDeadline) {
                refPreviewCachedText = document.querySelector('#refPreview')?.innerText || '';
                if (refPreviewCachedText.includes('Bài kiểm thử browser smoke cho CI')) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              window.fetch = originalFetch;
              return {
                count: notifications.length,
                first: notifications[0] || null,
                watched,
                diceRollText,
                selfEditPromptDefault,
                selfEditBodyUpdated,
                selfEditMarkerVisible,
                commentNumber,
                watchHref,
                readWatched,
                readHref,
                markReadButtonStillVisible,
                allReadNumber,
                allReadHref,
                markAllDisabledBefore,
                markAllWatched,
                markAllHref,
                markAllDisabledAfter,
                selectedQuoteComposerValue,
                selectedQuoteNumber,
                copiedPostLink: clipboardWrites[0] || '',
                collapsedBodyHidden,
                collapseLabel,
                expandedBodyVisible,
                expandLabel,
                threadPostCount,
                threadCollapsedPostCount,
                threadCollapseLabel,
                threadCollapsePressed,
                threadExpandedCollapsedCount,
                threadExpandLabel,
                threadExpandPressed,
                refPreviewText,
                refPreviewCachedText,
                refPreviewHiddenAfterEscape,
                refPreviewFetchCount,
                mediaExpandedCount,
                mediaButtonAfterExpand,
                firstMediaLoaded,
                mediaCollapsedCount,
                mediaButtonAfterCollapse,
                mediaIndexCount: mediaIndexItems.length,
                mediaIndexLabel,
                mediaIndexHref,
                mediaIndexFocusedPost,
                threadSearchStatus,
                threadSearchPreviewVisible,
                threadSearchOtherHidden,
                threadSearchCleared,
                sageMarkerVisible,
                preferences: notificationPreferencesAfterNotify
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          const payload = result.result?.value || {};
          if (payload.count !== 1) {
            throw new Error(`thread desktop expected one browser notification, got ${payload.count || 0}.`);
          }
          if (!payload.first?.options?.body?.includes('browser notification smoke')) {
            throw new Error('thread desktop browser notification did not include the new comment preview.');
          }
          if (!payload.preferences.browserWatchedThreads) {
            throw new Error('thread desktop did not persist browser notification opt-in.');
          }
          if (!payload.diceRollText?.includes('1d6')) {
            throw new Error(`thread desktop did not render dice roll result: ${payload.diceRollText || 'missing'}`);
          }
          if (!payload.sageMarkerVisible) {
            throw new Error('thread desktop did not render sage marker for sage reply.');
          }
          if (!payload.watchHref?.includes(`?p=${payload.commentNumber}`)) {
            throw new Error(`thread desktop watchlist did not link to first unread post: ${payload.watchHref || 'missing href'}`);
          }
          if (Number(payload.readWatched?.lastSeen || 0) < Number(payload.commentNumber || 0)) {
            throw new Error('thread desktop watchlist mark-read did not advance lastSeen.');
          }
          if (payload.readHref?.includes('?p=') || payload.markReadButtonStillVisible) {
            throw new Error(`thread desktop watchlist mark-read did not clear unread UI: ${payload.readHref || 'missing href'}`);
          }
          if (!payload.allReadHref?.includes(`?p=${payload.allReadNumber}`) || payload.markAllDisabledBefore) {
            throw new Error(`thread desktop watchlist mark-all setup did not expose unread state: ${payload.allReadHref || 'missing href'}`);
          }
          if (Number(payload.markAllWatched?.lastSeen || 0) < Number(payload.allReadNumber || 0)) {
            throw new Error('thread desktop watchlist mark-all did not advance lastSeen.');
          }
          if (payload.markAllHref?.includes('?p=') || !payload.markAllDisabledAfter) {
            throw new Error(`thread desktop watchlist mark-all did not clear unread UI: ${payload.markAllHref || 'missing href'}`);
          }
          if (!payload.selfEditPromptDefault || !payload.selfEditBodyUpdated || !payload.selfEditMarkerVisible) {
            throw new Error(
              `thread desktop self edit failed: promptDefault=${payload.selfEditPromptDefault || 'missing'} updated=${Boolean(payload.selfEditBodyUpdated)} marker=${Boolean(payload.selfEditMarkerVisible)}`
            );
          }
          if (
            !payload.selectedQuoteNumber ||
            !payload.selectedQuoteComposerValue?.includes(payload.selectedQuoteNumber) ||
            !payload.selectedQuoteComposerValue?.includes('>browser smoke')
          ) {
            throw new Error(
              `thread desktop selected quote failed: quote=${payload.selectedQuoteNumber || 'missing'} composer=${payload.selectedQuoteComposerValue || 'missing'}`
            );
          }
          if (
            !payload.copiedPostLink?.startsWith(baseUrl) ||
            !payload.copiedPostLink.includes(`/#thread/${threadId}?p=`)
          ) {
            throw new Error(`thread desktop copy post link failed: ${payload.copiedPostLink || 'missing'}`);
          }
          if (
            !payload.collapsedBodyHidden ||
            payload.collapseLabel !== '[Mở]' ||
            !payload.expandedBodyVisible ||
            payload.expandLabel !== '[Thu]'
          ) {
            throw new Error(
              `thread desktop post collapse failed: hidden=${Boolean(payload.collapsedBodyHidden)} collapsedLabel=${payload.collapseLabel || 'missing'} visible=${Boolean(payload.expandedBodyVisible)} expandedLabel=${payload.expandLabel || 'missing'}`
            );
          }
          if (
            payload.threadPostCount < 1 ||
            payload.threadCollapsedPostCount !== payload.threadPostCount ||
            payload.threadCollapseLabel !== 'Mở bài' ||
            payload.threadCollapsePressed !== 'true' ||
            payload.threadExpandedCollapsedCount !== 0 ||
            payload.threadExpandLabel !== 'Thu bài' ||
            payload.threadExpandPressed !== 'false'
          ) {
            throw new Error(
              `thread desktop post collapse toolbar failed: posts=${payload.threadPostCount || 0} collapsed=${payload.threadCollapsedPostCount || 0} collapseLabel=${payload.threadCollapseLabel || 'missing'} collapsePressed=${payload.threadCollapsePressed || 'missing'} remaining=${payload.threadExpandedCollapsedCount || 0} expandLabel=${payload.threadExpandLabel || 'missing'} expandPressed=${payload.threadExpandPressed || 'missing'}`
            );
          }
          if (
            !payload.refPreviewText?.includes('Bài kiểm thử browser smoke cho CI') ||
            !payload.refPreviewCachedText?.includes('Bài kiểm thử browser smoke cho CI') ||
            !payload.refPreviewHiddenAfterEscape ||
            payload.refPreviewFetchCount !== 1
          ) {
            throw new Error(
              `thread desktop reference preview failed: first=${payload.refPreviewText || 'missing'} cached=${payload.refPreviewCachedText || 'missing'} hidden=${Boolean(payload.refPreviewHiddenAfterEscape)} fetches=${payload.refPreviewFetchCount ?? 'missing'}`
            );
          }
          if (
            payload.mediaExpandedCount < 2 ||
            payload.mediaButtonAfterExpand !== 'Thu media' ||
            !payload.firstMediaLoaded ||
            payload.mediaCollapsedCount < 2 ||
            payload.mediaButtonAfterCollapse !== 'Mở media'
          ) {
            throw new Error(
              `thread desktop media toolbar failed: expanded=${payload.mediaExpandedCount || 0} expandedLabel=${payload.mediaButtonAfterExpand || 'missing'} loaded=${Boolean(payload.firstMediaLoaded)} collapsed=${payload.mediaCollapsedCount || 0} collapsedLabel=${payload.mediaButtonAfterCollapse || 'missing'}`
            );
          }
          if (
            payload.mediaIndexCount < 2 ||
            !payload.mediaIndexLabel?.includes('Media trong thread') ||
            !payload.mediaIndexHref?.includes(`#thread/${threadId}?p=`) ||
            !payload.mediaIndexFocusedPost
          ) {
            throw new Error(
              `thread desktop media index failed: count=${payload.mediaIndexCount || 0} label=${payload.mediaIndexLabel || 'missing'} href=${payload.mediaIndexHref || 'missing'} focus=${payload.mediaIndexFocusedPost || 'missing'}`
            );
          }
          if (
            !payload.threadSearchStatus?.includes('1 phản hồi khớp') ||
            !payload.threadSearchPreviewVisible ||
            !payload.threadSearchOtherHidden ||
            !payload.threadSearchCleared
          ) {
            throw new Error(
              `thread desktop search failed: status=${payload.threadSearchStatus || 'missing'} visible=${Boolean(payload.threadSearchPreviewVisible)} hidden=${Boolean(payload.threadSearchOtherHidden)} cleared=${Boolean(payload.threadSearchCleared)}`
            );
          }
          if (!Number.isFinite(Number(payload.watched.maxNumber))) {
            throw new Error('thread desktop did not keep watched thread metadata.');
          }
        }
      },
      {
        label: 'catalog desktop',
        url: `${baseUrl}/#catalog/confession`,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-catalog-desktop.png'),
        checks: [
          'Danh mục',
          'Sắp xếp theo:',
          'Lọc:',
          'Có tệp',
          'Có video',
          'Số tệp',
          'Smoke subject title',
          'Bài kiểm thử browser smoke cho CI'
        ],
        async interaction(cdp) {
          const result = await cdp.send('Runtime.evaluate', {
            expression: `(async () => {
              document.querySelector('[data-catalog-sort="files"]')?.click();
              const deadline = Date.now() + 3000;
              let filesSortActive = false;
              let filesSortPressed = '';
              let firstCatalogText = '';
              while (Date.now() < deadline) {
                const button = document.querySelector('[data-catalog-sort="files"]');
                filesSortActive = button?.classList.contains('active') ?? false;
                filesSortPressed = button?.getAttribute('aria-pressed') || '';
                firstCatalogText = document.querySelector('#catalogGrid .catalog-thread')?.innerText || '';
                if (filesSortActive && filesSortPressed === 'true' && firstCatalogText.includes('Smoke subject title') && firstCatalogText.includes('I: 2')) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              document.querySelector('[data-catalog-filter="video"]')?.click();
              const videoFilterDeadline = Date.now() + 3000;
              let videoFilterActive = false;
              let videoFilterPressed = '';
              let videoCatalogText = '';
              let videoCatalogCount = 0;
              while (Date.now() < videoFilterDeadline) {
                const button = document.querySelector('[data-catalog-filter="video"]');
                videoFilterActive = button?.classList.contains('active') ?? false;
                videoFilterPressed = button?.getAttribute('aria-pressed') || '';
                const cards = [...document.querySelectorAll('#catalogGrid .catalog-thread')];
                videoCatalogCount = cards.length;
                videoCatalogText = document.querySelector('#catalogGrid')?.innerText || '';
                if (
                  videoFilterActive &&
                  videoFilterPressed === 'true' &&
                  videoCatalogCount === 1 &&
                  videoCatalogText.includes('Smoke video thread') &&
                  videoCatalogText.includes('Video') &&
                  !videoCatalogText.includes('Smoke subject title')
                ) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              return {
                filesSortActive,
                filesSortPressed,
                firstCatalogText,
                videoFilterActive,
                videoFilterPressed,
                videoCatalogCount,
                videoCatalogText
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          const payload = result.result?.value || {};
          if (!payload.filesSortActive || payload.filesSortPressed !== 'true') {
            throw new Error('catalog desktop did not activate file-count sort.');
          }
          if (!payload.firstCatalogText?.includes('Smoke subject title') || !payload.firstCatalogText?.includes('I: 2')) {
            throw new Error(`catalog desktop file-count sort did not rank media-rich thread first: ${payload.firstCatalogText || 'missing first item'}`);
          }
          if (!payload.videoFilterActive || payload.videoFilterPressed !== 'true') {
            throw new Error('catalog desktop did not activate video filter.');
          }
          if (
            payload.videoCatalogCount !== 1 ||
            !payload.videoCatalogText?.includes('Smoke video thread') ||
            !payload.videoCatalogText?.includes('Video') ||
            payload.videoCatalogText?.includes('Smoke subject title')
          ) {
            throw new Error(
              `catalog desktop video filter failed: count=${payload.videoCatalogCount || 0} text=${payload.videoCatalogText || 'missing'}`
            );
          }
        }
      },
      {
        label: 'archive desktop',
        url: `${baseUrl}/#archive/confession`,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-archive-desktop.png'),
        checks: ['Kho lưu trữ', 'Kho lưu trữ chưa có chủ đề']
      },
      {
        label: 'admin desktop',
        url: `${baseUrl}/#admin`,
        screenshotPath: path.join(screenshotRoot, 'admin-login-desktop.png'),
        checks: ['Bảng quản trị', 'Tài khoản', 'Đăng nhập']
      },
      {
        label: 'account login desktop',
        url: `${baseUrl}/#login`,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-account-login-desktop.png'),
        checks: ['Đăng nhập tài khoản', 'Tài khoản', 'Mật khẩu']
      },
      {
        label: 'account desktop',
        url: `${baseUrl}/#account`,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-account-desktop.png'),
        checks: ['Cài đặt tài khoản', 'Giao diện', 'Bảng nhà', 'Trình duyệt: thread đang theo dõi', 'Bạn chưa đăng nhập tài khoản'],
        async interaction(cdp) {
          const result = await cdp.send('Runtime.evaluate', {
            expression: `(async () => {
              let requestCount = 0;
              class FakeNotification {
                static permission = 'default';
                static async requestPermission() {
                  requestCount += 1;
                  FakeNotification.permission = 'denied';
                  return 'denied';
                }
              }
              Object.defineProperty(window, 'Notification', { configurable: true, value: FakeNotification });
              const browserCheckbox = document.querySelector('#accountBrowserNotifyWatchedThreads');
              browserCheckbox.checked = true;
              document.querySelector('#accountSettingsForm').requestSubmit();
              const deadline = Date.now() + 3000;
              while (requestCount === 0 && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
              return {
                requestCount,
                checked: browserCheckbox.checked,
                status: document.querySelector('#accountBrowserNotificationsStatus')?.textContent || '',
                preferences: JSON.parse(localStorage.getItem('notificationPreferences') || '{}')
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          const payload = result.result?.value || {};
          if (payload.requestCount !== 1) {
            throw new Error(`account desktop expected one browser permission request, got ${payload.requestCount || 0}.`);
          }
          if (payload.preferences.browserWatchedThreads) {
            throw new Error('account desktop persisted browser notifications after denied permission.');
          }
          if (!payload.status.includes('chặn') && !payload.status.includes('Tắt')) {
            throw new Error('account desktop did not show denied browser notification status.');
          }
        }
      },
      {
        label: 'admin dashboard desktop',
        url: `${baseUrl}/#admin`,
        loginAdmin: true,
        adminToken,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-admin-desktop.png'),
        checks: ['AI chờ duyệt', 'Báo cáo', 'Đã duyệt', 'Nhật ký', 'Hàng đợi trống'],
        async interaction(cdp) {
          const result = await cdp.send('Runtime.evaluate', {
            expression: `(async () => {
              const waitFor = async (predicate, label) => {
                const deadline = Date.now() + 5000;
                while (Date.now() < deadline) {
                  const value = predicate();
                  if (value) return value;
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
                throw new Error('Timed out waiting for ' + label);
              };
              document.querySelector('[data-admin-tab="analytics"]')?.click();
              await waitFor(() => document.querySelector('#pendingList .analytics-dashboard'), 'analytics dashboard');
              const adminToken = localStorage.getItem('adminToken') || '';
              const response = await fetch('/api/admin/analytics', {
                headers: adminToken ? { authorization: 'Bearer ' + adminToken } : {}
              });
              const analytics = await response.json().catch(() => ({}));
              const errorText = document.querySelector('#pendingList .form-error')?.innerText || '';
              return {
                ok: response.ok,
                hasBoardActivity: analytics?.data?.boardActivity && typeof analytics.data.boardActivity === 'object',
                hasMapError: errorText.includes('map is not a function'),
                errorText
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          if (result.exceptionDetails) {
            throw new Error(`admin analytics evaluation failed: ${result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)}`);
          }
          const payload = result.result?.value || {};
          if (!payload.ok || !payload.hasBoardActivity || payload.hasMapError) {
            throw new Error(`admin analytics tab failed to render: ${payload.errorText || 'missing analytics content'}`);
          }
        }
      },
      {
        label: 'admin moderation flow desktop',
        url: `${baseUrl}/#admin`,
        loginAdmin: true,
        adminToken,
        theme: 'burichan',
        contrastCheck: true,
        async before() {
          approvePendingThread = await createPendingThread(
            'Admin visual pass pending approval PII 0912345678',
            'ci-poster-admin-approve',
            {
              image: {
                name: 'admin-detail.png',
                type: 'image/png',
                dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
                sizeBytes: 68,
                width: 1,
                height: 1,
                thumbnail: {
                  name: 'admin-detail-thumb.png',
                  type: 'image/png',
                  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
                  sizeBytes: 68,
                  width: 1,
                  height: 1
                }
              }
            }
          );
          deletePendingThread = await createPendingThread(
            'Admin visual pass pending bulk delete PII 0987654321',
            'ci-poster-admin-delete'
          );
        },
        checks: ['AI chờ duyệt', 'Báo cáo', 'Đã duyệt', 'Nhật ký', 'Admin visual pass pending approval'],
        async interaction(cdp) {
          const result = await cdp.send('Runtime.evaluate', {
            expression: `(async () => {
              const approveId = ${JSON.stringify(approvePendingThread.id)};
              const deleteId = ${JSON.stringify(deletePendingThread.id)};
              const approveGlobal = ${JSON.stringify(approvePendingThread.globalNumber)};
              const waitFor = async (predicate, label) => {
                const deadline = Date.now() + 5000;
                while (Date.now() < deadline) {
                  const value = predicate();
                  if (value) return value;
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
                throw new Error('Timed out waiting for ' + label);
              };
              const submitReason = async (reason) => {
                await waitFor(() => document.querySelector('#reasonTextarea'), 'reason modal');
                const textarea = document.querySelector('#reasonTextarea');
                textarea.value = reason;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                document.querySelector('#reasonConfirmBtn')?.click();
              };
              const approveItem = await waitFor(() => document.querySelector('.pending-item[data-id="' + approveId + '"]'), 'approve pending item');
              approveItem.querySelector('[data-admin-detail]')?.click();
              await waitFor(() => approveItem.querySelector('.admin-detail-host')?.innerText.includes('Admin visual pass pending approval'), 'detail panel');
              await waitFor(() => {
                const image = approveItem.querySelector('.admin-detail-host .post-media-gallery img');
                return image?.complete && image.naturalWidth > 0 ? image : null;
              }, 'admin detail image preview');
              const imageName = approveItem.querySelector('.admin-detail-host .file-text')?.innerText || '';
              if (!imageName.includes('admin-detail.png')) {
                throw new Error('admin detail panel did not render uploaded image metadata.');
              }
              approveItem.querySelector('[data-action="approve"]')?.click();
              await submitReason('Visual pass approved');
              await waitFor(() => !document.querySelector('.pending-item[data-id="' + approveId + '"]'), 'approved item removal');

              const deleteItem = await waitFor(() => document.querySelector('.pending-item[data-id="' + deleteId + '"]'), 'delete pending item');
              deleteItem.querySelector('[data-admin-select]')?.click();
              document.querySelector('#adminBulkDelete')?.click();
              await submitReason('Visual pass bulk delete');
              await waitFor(() => !document.querySelector('.pending-item[data-id="' + deleteId + '"]'), 'deleted item removal');

              document.querySelector('[data-admin-tab="deleted"]')?.click();
              await waitFor(() => document.body.innerText.includes('Visual pass bulk delete'), 'deleted tab reason');
              document.querySelector('[data-admin-tab="audit"]')?.click();
              await waitFor(() => document.body.innerText.includes('Visual pass approved'), 'audit tab approve reason');
              return {
                approvedGone: !document.querySelector('.pending-item[data-id="' + approveId + '"]'),
                deletedGone: !document.querySelector('.pending-item[data-id="' + deleteId + '"]'),
                auditHasApprove: document.body.innerText.includes('Visual pass approved'),
                deletedHasReason: document.body.innerText.includes('Visual pass bulk delete'),
                detailGlobal: approveGlobal
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          const payload = result.result?.value || {};
          if (!payload.approvedGone || !payload.deletedGone || !payload.auditHasApprove || !payload.deletedHasReason) {
            throw new Error('admin dashboard desktop did not complete pending moderation flow.');
          }
        }
      },
      {
        label: 'home mobile',
        url: `${baseUrl}/#home`,
        width: 390,
        height: 844,
        screenshotPath: path.join(screenshotRoot, 'home-mobile.png'),
        checks: ['36chan là gì?', 'Bảng', 'Bài mới nhất', 'Chủ đề đang theo dõi', 'Bài của tôi', 'Bảng đang theo dõi']
      },
      {
        label: 'board mobile',
        url: `${baseUrl}/#board/confession`,
        width: 390,
        height: 844,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-board-mobile.png'),
        checks: ['Tạo chủ đề mới', 'Danh mục', 'Kho lưu trữ', 'Bài kiểm thử browser smoke cho CI']
      },
      {
        label: 'thread mobile',
        url: `${baseUrl}/#thread/${threadId}`,
        width: 390,
        height: 844,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-thread-mobile.png'),
        checks: ['Đăng trả lời', 'Bài kiểm thử browser smoke cho CI']
      },
      {
        label: 'archive mobile',
        url: `${baseUrl}/#archive/confession`,
        width: 390,
        height: 844,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-archive-mobile.png'),
        checks: ['Kho lưu trữ', 'Kho lưu trữ chưa có chủ đề']
      },
      {
        label: 'admin dashboard mobile',
        url: `${baseUrl}/#admin`,
        loginAdmin: true,
        adminToken,
        width: 390,
        height: 844,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-admin-mobile.png'),
        checks: ['AI chờ duyệt', 'Báo cáo', 'Đã duyệt', 'Nhật ký', 'Hàng đợi trống']
      },
      {
        label: 'policy appeal desktop',
        url: `${baseUrl}/#policy/appeal`,
        theme: 'burichan',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-policy-appeal-desktop.png'),
        checks: ['Nội quy, riêng tư và báo cáo', 'Kháng nghị bài bị xóa', 'Mã kháng nghị', 'Gửi kháng nghị'],
        async before() {
          appealSmoke = await createDeletedAppealThread(adminToken);
        },
        async interaction(cdp) {
          const result = await cdp.send('Runtime.evaluate', {
            expression: `(async () => {
              const appealToken = ${JSON.stringify(appealSmoke?.appealToken || '')};
              const globalNumber = ${JSON.stringify(appealSmoke?.globalNumber || '')};
              const waitFor = async (predicate, label) => {
                const deadline = Date.now() + 5000;
                while (Date.now() < deadline) {
                  const value = predicate();
                  if (value) return value;
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
                throw new Error('Timed out waiting for ' + label);
              };
              const form = await waitFor(() => document.querySelector('#appealForm'), 'appeal form');
              document.querySelector('#appealToken').value = appealToken;
              document.querySelector('#appealReason').value = 'Xin admin xem lại bài kiểm thử kháng nghị';
              form.requestSubmit();
              const resultText = await waitFor(() => {
                const text = document.querySelector('#appealResult')?.textContent || '';
                return text.includes('No.' + globalNumber) ? text : '';
              }, 'appeal result');
              return {
                resultText,
                tokenCleared: document.querySelector('#appealToken')?.value === '',
                reasonCleared: document.querySelector('#appealReason')?.value === '',
                errorHidden: document.querySelector('#appealError')?.classList.contains('hidden') ?? false
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          if (result.exceptionDetails) {
            throw new Error(`policy appeal evaluation failed: ${result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)}`);
          }
          const payload = result.result?.value || {};
          if (!payload.resultText?.includes('Trạng thái: open') || !payload.tokenCleared || !payload.reasonCleared || !payload.errorHidden) {
            throw new Error(`policy appeal form failed: ${JSON.stringify(payload)}`);
          }
        }
      }
    ];

    for (const page of pages) {
      page.accessibilityCheck ??= true;
      if (page.before) {
        await page.before();
      }
      await smokePage(page);
    }

    console.log(`Browser smoke passed with ${chromePath}`);
    console.log(`Screenshots saved to ${screenshotRoot}`);
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
