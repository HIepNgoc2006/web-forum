import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
      body: 'Bài kiểm thử browser smoke cho CI\n#dice 1d6',
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
      body: '>>1 phản hồi kiểm thử smoke-thread-search-token',
      captchaToken: 'dev-pass',
      posterToken: 'ci-poster'
    })
  });
  if (!commentResponse.ok) {
    throw new Error(`Could not create smoke comment: ${commentResponse.status}`);
  }

  return threadId;
}

async function createPendingThread(body, posterToken) {
  const threadResponse = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      body,
      captchaToken: 'dev-pass',
      posterToken
    })
  });
  if (!threadResponse.ok) {
    throw new Error(`Could not create pending smoke thread: ${threadResponse.status}`);
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
        checks: ['Tạo chủ đề mới', 'Danh mục', 'Kho lưu trữ', 'Bài kiểm thử browser smoke cho CI'],
        async interaction(cdp) {
          const result = await cdp.send('Runtime.evaluate', {
            expression: `(async () => {
              document.querySelector('#startThreadButton')?.click();
              await new Promise((resolve) => setTimeout(resolve, 100));
              document.querySelector('[data-thread-template="study"]')?.click();
              const body = document.querySelector('#threadBody');
              body.value += '\\nSố điện thoại 0912345678';
              body.dispatchEvent(new Event('input', { bubbles: true }));
              const draft = localStorage.getItem('draft:thread:confession') || '';
              const warning = document.querySelector('#threadPrivacyWarning');
              const listText = document.querySelector('#threadList')?.innerText || '';
              return {
                value: body.value,
                draft,
                warningText: warning?.textContent || '',
                warningHidden: warning?.classList.contains('hidden') ?? true,
                postedAutomatically: listText.includes('Mình muốn chia sẻ chuyện học tập')
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
          if (payload.postedAutomatically) {
            throw new Error('board desktop template insertion posted automatically.');
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
              class FakeNotification {
                static permission = 'granted';
                constructor(title, options = {}) {
                  notifications.push({ title, options });
                }
                close() {}
              }
              Object.defineProperty(window, 'Notification', { configurable: true, value: FakeNotification });
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
                  posterToken: 'ci-poster-notify'
                })
              });
              if (!response.ok) {
                throw new Error('notification smoke comment failed: ' + response.status);
              }
              const notificationDeadline = Date.now() + 3000;
              while (notifications.length === 0 && Date.now() < notificationDeadline) {
                await new Promise((resolve) => setTimeout(resolve, 50));
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
              return {
                count: notifications.length,
                first: notifications[0] || null,
                watched,
                diceRollText,
                threadSearchStatus,
                threadSearchPreviewVisible,
                threadSearchOtherHidden,
                threadSearchCleared,
                preferences: JSON.parse(localStorage.getItem('notificationPreferences') || '{}')
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
        checks: ['Danh mục', 'Sắp xếp theo:', 'Lọc:', 'Có tệp', 'Có video', 'Số tệp', 'Bài kiểm thử browser smoke cho CI']
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
        checks: ['Hàng đợi kiểm duyệt', 'Tài khoản', 'Đăng nhập']
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
        checks: ['Settings tài khoản', 'Giao diện', 'Bảng nhà', 'Browser: thread đang theo dõi', 'Bạn chưa đăng nhập tài khoản'],
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
        checks: ['AI chờ duyệt', 'Báo cáo', 'Đã duyệt', 'Nhật ký', 'Hàng đợi trống']
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
            'ci-poster-admin-approve'
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
