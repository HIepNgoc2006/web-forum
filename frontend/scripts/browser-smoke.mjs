#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.dirname(scriptRoot);
const repoRoot = path.dirname(frontendRoot);
const require = createRequire(import.meta.url);

const BACKEND_PORT = Number(process.env.BROWSER_SMOKE_BACKEND_PORT || 3000);
const START_TIMEOUT_MS = 45_000;
const PAGE_TIMEOUT_MS = 30_000;
const MAX_PROCESS_OUTPUT = 24_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(candidate) {
  if (!candidate) {
    return false;
  }
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function findBrowser() {
  const isWindows = process.platform === 'win32';
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    process.env.EDGE_PATH,
    isWindows ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '',
    isWindows ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : '',
    isWindows ? 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' : '',
    isWindows ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : '',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return '';
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function freePort() {
  const server = await listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await closeServer(server);
  if (!port) {
    throw new Error('Could not allocate a local port for browser smoke.');
  }
  return port;
}

async function requireBackendPort() {
  let server;
  try {
    server = await listen(BACKEND_PORT);
  } catch (error) {
    throw new Error(
      `Port ${BACKEND_PORT} must be free for frontend browser smoke because ` +
        `BACKEND_ORIGIN is resolved during next build. Stop the process using that port and retry.`,
      { cause: error }
    );
  }
  await closeServer(server);
}

function spawnService(label, command, args, options) {
  let output = '';
  let spawnError = null;
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    ...options
  });
  const append = (chunk) => {
    output = `${output}${String(chunk)}`.slice(-MAX_PROCESS_OUTPUT);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('error', (error) => {
    spawnError = error;
  });
  return {
    label,
    child,
    output: () => output.trim(),
    spawnError: () => spawnError
  };
}

function assertServiceRunning(service) {
  const error = service.spawnError();
  if (error) {
    throw new Error(`${service.label} failed to start: ${error.message}`);
  }
  if (service.child.exitCode !== null) {
    const output = service.output();
    throw new Error(
      `${service.label} exited with code ${service.child.exitCode}.` +
        (output ? `\n${output}` : '')
    );
  }
}

async function waitForHttp(url, service, timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    assertServiceRunning(service);
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(1500)
      });
      await response.arrayBuffer();
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(200);
  }
  const output = service.output();
  throw new Error(
    `${service.label} was not ready at ${url}: ${lastError || 'timed out'}.` +
      (output ? `\n${output}` : '')
  );
}

async function stopService(service) {
  const child = service?.child;
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), sleep(3000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([once(child, 'exit'), sleep(2000)]);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForPageTarget(debugPort, chrome) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = '';
  while (Date.now() < deadline) {
    assertServiceRunning(chrome);
    try {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) {
        return page.webSocketDebuggerUrl;
      }
      lastError = 'no page target was available';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(200);
  }
  throw new Error(`Chrome DevTools endpoint was not ready: ${lastError || 'timed out'}.`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    if (typeof globalThis.WebSocket !== 'function') {
      throw new Error('This smoke test requires the global WebSocket available in Node.js 22.');
    }
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener('message', (event) => this.handleMessage(event.data));
    this.socket.addEventListener('close', () => {
      const error = new Error('Chrome DevTools connection closed unexpectedly.');
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener(
        'error',
        () => reject(new Error('Could not connect to the Chrome DevTools WebSocket.')),
        { once: true }
      );
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }
    const handlers = this.listeners.get(message.method);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(message.params || {});
    }
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) || new Set();
    handlers.add(handler);
    this.listeners.set(method, handlers);
    return () => handlers.delete(handler);
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== 1) {
      return Promise.reject(new Error('Chrome DevTools WebSocket is not open.'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools command timed out: ${method}`));
      }, PAGE_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.socket && this.socket.readyState < 2) {
      this.socket.close();
    }
  }
}

function remoteValue(value) {
  if (Object.prototype.hasOwnProperty.call(value, 'value')) {
    try {
      return JSON.stringify(value.value);
    } catch {
      return String(value.value);
    }
  }
  return value.description || value.type || 'unknown';
}

function collectDiagnostics(cdp) {
  const pageErrors = [];
  const requests = new Map();
  const responses = [];
  const nextAssetFailures = [];

  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    const detail = exceptionDetails?.exception?.description || exceptionDetails?.text;
    pageErrors.push(`page exception: ${detail || 'unknown exception'}`);
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args = [] }) => {
    if (type === 'error' || type === 'assert') {
      pageErrors.push(`console.${type}: ${args.map(remoteValue).join(' ')}`);
    }
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry?.level === 'error') {
      pageErrors.push(`browser log: ${entry.text || 'unknown error'}`);
    }
  });
  cdp.on('Inspector.targetCrashed', () => {
    pageErrors.push('page target crashed');
  });
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    requests.set(requestId, request?.url || '');
  });
  cdp.on('Network.responseReceived', ({ response, type }) => {
    responses.push({
      url: response?.url || '',
      status: Number(response?.status || 0),
      type: type || '',
      mimeType: response?.mimeType || ''
    });
  });
  cdp.on('Network.loadingFailed', ({ requestId, errorText, canceled }) => {
    const url = requests.get(requestId) || '';
    if (!canceled && url.includes('/_next/')) {
      nextAssetFailures.push(`${url}: ${errorText || 'loading failed'}`);
    }
  });

  return { pageErrors, responses, nextAssetFailures };
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (exceptionDetails) {
    const detail = exceptionDetails.exception?.description || exceptionDetails.text;
    throw new Error(`Browser evaluation failed: ${detail || 'unknown exception'}`);
  }
  if (result?.subtype === 'error') {
    throw new Error(`Browser evaluation failed: ${result.description || 'unknown error'}`);
  }
  return result?.value;
}

async function waitForSnapshot(cdp, label, expression, timeoutMs = PAGE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = null;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      lastSnapshot = await evaluate(cdp, expression);
      if (lastSnapshot?.ready) {
        return lastSnapshot;
      }
      lastError = '';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(
    `${label} did not become ready.` +
      (lastError ? ` ${lastError}` : '') +
      (lastSnapshot ? ` Last state: ${JSON.stringify(lastSnapshot)}` : '')
  );
}

async function navigate(cdp, url) {
  let result;
  try {
    result = await cdp.send('Page.navigate', { url });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Navigation to ${url} failed: ${detail}`, { cause: error });
  }
  if (result.errorText) {
    throw new Error(`Navigation to ${url} failed: ${result.errorText}`);
  }
}

function assertNoHorizontalOverflow(snapshot, label) {
  assert.ok(snapshot.innerWidth > 0, `${label} reported an invalid viewport width.`);
  assert.ok(
    snapshot.scrollWidth <= snapshot.innerWidth,
    `${label} has horizontal overflow: ${snapshot.scrollWidth} > ${snapshot.innerWidth}.`
  );
}

function assertNoPageErrors(pageErrors) {
  if (pageErrors.length) {
    throw new Error(`Browser emitted errors:\n${pageErrors.join('\n')}`);
  }
}

const homeSnapshotExpression = `(() => {
  const home = document.querySelector('#homeScreen');
  const legacyRoot = document.querySelector('#nextLegacyRoot');
  const boardNav = document.querySelector('#boardNav');
  const socketStatus = document.querySelector('#socketStatus');
  const boardLinks = boardNav ? boardNav.querySelectorAll('a[href^="#board/"]').length : 0;
  const rootWidth = document.documentElement ? document.documentElement.scrollWidth : 0;
  const bodyWidth = document.body ? document.body.scrollWidth : 0;
  const scrollWidth = Math.max(rootWidth, bodyWidth);
  const homeActive = Boolean(home && home.classList.contains('active'));
  const socketLive = Boolean(socketStatus && socketStatus.classList.contains('live'));
  const legacyRootPresent = Boolean(legacyRoot);
  const legacyRootVisible = Boolean(
    legacyRoot && !legacyRoot.hidden && getComputedStyle(legacyRoot).display !== 'none'
  );
  const homeContentReady = [
    '#homeBoards',
    '#popularThreads',
    '#latestPosts',
    '#homeStats',
    '#serverStats'
  ].every((selector) => {
    const element = document.querySelector(selector);
    return Boolean(element && (element.childElementCount > 0 || element.textContent.trim()));
  });
  const bootstrapState = legacyRoot ? legacyRoot.dataset.bootstrapState || '' : '';
  const bootstrapScreenPresent = Boolean(document.querySelector('#nextBootstrapScreen'));
  const nativeUiPresent = Boolean(
    document.querySelector('[data-native-runtime], main[data-native-home]')
  );
  return {
    ready: homeActive && boardLinks > 0 && socketLive && legacyRootVisible &&
      homeContentReady && bootstrapState === 'ready' && !bootstrapScreenPresent && !nativeUiPresent,
    homeActive,
    boardLinks,
    socketLive,
    socketText: socketStatus ? socketStatus.textContent.trim() : '',
    legacyRootPresent,
    legacyRootVisible,
    homeContentReady,
    bootstrapState,
    bootstrapScreenPresent,
    nativeUiPresent,
    pathname: window.location.pathname,
    hash: window.location.hash,
    innerWidth: window.innerWidth,
    scrollWidth
  };
})()`;

function legacyBoardSnapshotExpression(expectedPath = '/legacy') {
  return `(() => {
  const expectedPath = ${JSON.stringify(expectedPath)};
  const boardScreen = document.querySelector('#boardScreen');
  const boardNav = document.querySelector('#boardNav');
  const threadList = document.querySelector('#threadList');
  const socketStatus = document.querySelector('#socketStatus');
  const legacyRoot = document.querySelector('#nextLegacyRoot');
  const normalizedPath = window.location.pathname.replace(/\\/+$/, '') || '/';
  const boardLinks = boardNav ? boardNav.querySelectorAll('a[href^="#board/"]').length : 0;
  const activeBoardLink = Boolean(
    boardNav && boardNav.querySelector('a.active[href="#board/confession"]')
  );
  const boardActive = Boolean(boardScreen && boardScreen.classList.contains('active'));
  const threadItems = threadList ? threadList.childElementCount : 0;
  const socketLive = Boolean(socketStatus && socketStatus.classList.contains('live'));
  const legacyRootVisible = Boolean(
    legacyRoot && !legacyRoot.hidden && getComputedStyle(legacyRoot).display !== 'none'
  );
  const rootWidth = document.documentElement ? document.documentElement.scrollWidth : 0;
  const bodyWidth = document.body ? document.body.scrollWidth : 0;
  const scrollWidth = Math.max(rootWidth, bodyWidth);
  return {
    ready:
      normalizedPath === expectedPath &&
      window.location.hash === '#board/confession' &&
      boardActive &&
      activeBoardLink &&
      boardLinks > 0 &&
      threadItems > 0 &&
      socketLive &&
      legacyRootVisible &&
      legacyRoot?.dataset.bootstrapState === 'ready' &&
      !document.querySelector('#nextBootstrapScreen'),
    pathname: window.location.pathname,
    hash: window.location.hash,
    boardActive,
    activeBoardLink,
    boardLinks,
    threadItems,
    socketLive,
    socketText: socketStatus ? socketStatus.textContent.trim() : '',
    legacyRootVisible,
    bootstrapState: legacyRoot ? legacyRoot.dataset.bootstrapState || '' : '',
    innerWidth: window.innerWidth,
    scrollWidth
  };
})()`;
}

function legacyRouteSnapshotExpression(expectedPath, expectedHash, selector) {
  return `(() => {
    const path = window.location.pathname.replace(/\\/+$/, '') || '/';
    const screen = document.querySelector(${JSON.stringify(selector)});
    const screenActive = Boolean(screen && screen.classList.contains('active'));
    const legacyRoot = document.querySelector('#nextLegacyRoot');
    const legacyRootPresent = Boolean(legacyRoot);
    const legacyRootVisible = Boolean(
      legacyRoot && !legacyRoot.hidden && getComputedStyle(legacyRoot).display !== 'none'
    );
    const nativeUiPresent = Boolean(
      document.querySelector('[data-native-runtime], main[data-native-home], main[data-native-board], main[data-native-thread]')
    );
    return {
      ready: path === ${JSON.stringify(expectedPath)} &&
        window.location.hash === ${JSON.stringify(expectedHash)} &&
        screenActive && legacyRootVisible &&
        legacyRoot?.dataset.bootstrapState === 'ready' &&
        !document.querySelector('#nextBootstrapScreen') && !nativeUiPresent,
      pathname: path,
      hash: window.location.hash,
      screenActive,
      legacyRootPresent,
      legacyRootVisible,
      bootstrapState: legacyRoot ? legacyRoot.dataset.bootstrapState || '' : '',
      nativeUiPresent
    };
  })()`;
}

const stalledBootstrapSnapshotExpression = `(() => {
  const root = document.querySelector('#nextLegacyRoot');
  const loadingScreens = Array.from(document.querySelectorAll('#nextBootstrapScreen'));
  const isVisible = (element) => {
    if (!element || element.hidden) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      element.getClientRects().length > 0;
  };
  return {
    ready: Boolean(root && loadingScreens.length),
    pathname: window.location.pathname,
    rootHidden: Boolean(root && (root.hidden || getComputedStyle(root).display === 'none')),
    bootstrapState: root ? root.dataset.bootstrapState || '' : '',
    loadingVisible: loadingScreens.some(isVisible),
    loadingText: loadingScreens.map((element) => element.textContent.trim()).join(' '),
    homeVisible: isVisible(document.querySelector('#homeScreen'))
  };
})()`;

async function assertStalledBootstrapGate(cdp, frontendOrigin) {
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.setBlockedURLs', {
    urls: ['*/_next/static/chunks/*.js']
  });
  try {
    for (const [path, label] of [
      ['/', 'root home'],
      ['/board/confession', 'clean board route']
    ]) {
      await navigate(cdp, `${frontendOrigin}${path}`);
      const snapshot = await waitForSnapshot(
        cdp,
        `Stalled first load at ${label}`,
        stalledBootstrapSnapshotExpression,
        15_000
      );
      assert.equal(snapshot.pathname, path, `${label} changed its public pathname.`);
      assert.equal(snapshot.rootHidden, true, `${label} exposed the incomplete legacy shell.`);
      assert.equal(snapshot.bootstrapState, 'loading', `${label} lost its loading state.`);
      assert.equal(snapshot.loadingVisible, true, `${label} did not show the first-load status.`);
      assert.match(snapshot.loadingText, /Đang tải 36chan/);
      assert.equal(snapshot.homeVisible, false, `${label} exposed the empty home screen.`);
    }
  } finally {
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  }
}

async function runBrowserAssertions(cdp, frontendOrigin) {
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Network.enable'),
    cdp.send('Log.enable')
  ]);
  if (process.env.BROWSER_SMOKE_GATE_ONLY === '1') {
    await assertStalledBootstrapGate(cdp, frontendOrigin);
    return;
  }
  const diagnostics = collectDiagnostics(cdp);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  await navigate(cdp, `${frontendOrigin}/`);
  const rootHome = await waitForSnapshot(cdp, 'Legacy UI at the root route', homeSnapshotExpression);
  assert.equal(rootHome.pathname, '/', 'Root route changed its public pathname.');
  assert.equal(rootHome.hash, '', 'Root home unexpectedly added a hash.');
  assert.equal(rootHome.legacyRootPresent, true, 'Root did not render the legacy shell.');
  assert.equal(rootHome.nativeUiPresent, false, 'Root rendered native Next UI.');
  assert.ok(rootHome.boardLinks > 0, 'Legacy home did not render board links.');
  assertNoHorizontalOverflow(rootHome, 'Legacy root home');

  const apiHome = await evaluate(
    cdp,
    `(async () => {
      const response = await fetch('/api/home', {
        cache: 'no-store',
        headers: { accept: 'application/json' }
      });
      const payload = await response.json();
      const home = payload && payload.data ? payload.data : payload;
      return {
        ok: response.ok,
        status: response.status,
        sameOrigin: new URL(response.url).origin === window.location.origin,
        boardCount: Array.isArray(home && home.boards) ? home.boards.length : 0
      };
    })()`
  );
  assert.equal(apiHome.status, 200, 'Same-origin /api/home did not return HTTP 200.');
  assert.equal(apiHome.ok, true, 'Same-origin /api/home response was not successful.');
  assert.equal(apiHome.sameOrigin, true, '/api/home escaped the Next application origin.');
  assert.ok(apiHome.boardCount > 0, '/api/home did not return any boards.');

  const createdThread = await evaluate(
    cdp,
    `(async () => {
      const response = await fetch('/api/boards/confession/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          subject: 'Next legacy browser smoke',
          body: 'A calm discussion about lunch on campus.',
          captchaToken: 'dev-pass',
          posterToken: 'frontend-browser-smoke',
          deletePassword: 'frontend-smoke-password'
        })
      });
      const payload = await response.json();
      const thread = payload?.data?.thread || payload?.data || payload?.thread || {};
      let captchaConfigured = false;
      if (!response.ok) {
        const configResponse = await fetch('/api/config', { cache: 'no-store' });
        const configPayload = await configResponse.json();
        const config = configPayload?.data || configPayload || {};
        captchaConfigured = Boolean(config?.hcaptchaSiteKey);
      }
      return {
        ok: response.ok,
        status: response.status,
        id: String(thread.id || ''),
        error: String(payload?.error?.message || payload?.error || payload?.message || ''),
        captchaConfigured
      };
    })()`
  );
  assert.equal(
    createdThread.status,
    201,
    `Same-origin thread creation did not return HTTP 201: ${createdThread.error || 'unknown error'} ` +
      `(captcha configured: ${createdThread.captchaConfigured})`
  );
  assert.equal(createdThread.ok, true, 'Same-origin thread creation failed.');
  assert.ok(createdThread.id, 'Same-origin thread creation returned no thread id.');

  const domAssets = await evaluate(
    cdp,
    `Array.from(
      document.querySelectorAll('script[src*="/_next/"], link[rel="stylesheet"][href*="/_next/"]')
    ).map((element) => element.src || element.href)`
  );
  const successfulAssets = diagnostics.responses.filter(
    (response) =>
      response.url.includes('/_next/') && response.status >= 200 && response.status < 400
  );
  const badAssetResponses = diagnostics.responses.filter(
    (response) => response.url.includes('/_next/') && response.status >= 400
  );
  assert.ok(domAssets.length > 0, 'The page did not reference any /_next/ assets.');
  assert.ok(successfulAssets.length > 0, 'No /_next/ asset completed successfully.');
  const assetChecks = await evaluate(
    cdp,
    `Promise.all(${JSON.stringify(domAssets)}.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        return { url, ok: response.ok, status: response.status };
      } catch (error) {
        return { url, ok: false, status: 0, error: String(error) };
      }
    }))`
  );
  const unavailableAssets = assetChecks.filter((asset) => !asset.ok);
  assert.deepEqual(
    unavailableAssets,
    [],
    `Some DOM /_next/ assets were unavailable: ${unavailableAssets
      .map((asset) => `${asset.status} ${asset.url}`)
      .join(', ')}`
  );
  assert.deepEqual(
    badAssetResponses,
    [],
    `Some /_next/ assets returned errors: ${badAssetResponses
      .map((response) => `${response.status} ${response.url}`)
      .join(', ')}`
  );
  assert.deepEqual(
    diagnostics.nextAssetFailures,
    [],
    `Some /_next/ assets failed to load: ${diagnostics.nextAssetFailures.join(', ')}`
  );

  const connectedRealtime = diagnostics.responses.filter((response) => {
    try {
      return (
        new URL(response.url).pathname.startsWith('/socket.io') &&
        response.status >= 200 &&
        response.status < 400
      );
    } catch {
      return false;
    }
  });
  assert.ok(
    connectedRealtime.length > 0,
    'No successful Socket.IO handshake/polling response was observed.'
  );

  await navigate(cdp, `${frontendOrigin}/#board/confession`);
  const board = await waitForSnapshot(
    cdp,
    'Legacy hash board at the root route',
    legacyBoardSnapshotExpression('/')
  );
  assert.equal(board.pathname, '/', 'Legacy hash board changed its pathname.');
  assert.equal(board.hash, '#board/confession', 'Legacy board hash was not retained.');
  assert.ok(board.threadItems > 0, 'Legacy hash board did not render threads.');
  assertNoHorizontalOverflow(board, 'Legacy hash board');

  await navigate(cdp, `${frontendOrigin}/legacy`);
  const legacyHome = await waitForSnapshot(cdp, 'Legacy alias home', homeSnapshotExpression);
  assert.equal(legacyHome.pathname, '/legacy', 'Legacy alias did not remain at /legacy.');
  assert.equal(legacyHome.hash, '', 'Hashless legacy alias unexpectedly added a hash.');
  assert.equal(legacyHome.homeActive, true, 'Legacy alias home was not active.');
  assertNoHorizontalOverflow(legacyHome, 'Legacy alias home');

  await navigate(cdp, `${frontendOrigin}/legacy#board/confession`);
  const legacyBoard = await waitForSnapshot(
    cdp,
    'Legacy alias board',
    legacyBoardSnapshotExpression()
  );
  assert.equal(legacyBoard.pathname, '/legacy', 'Legacy board alias changed its pathname.');
  assert.equal(legacyBoard.hash, '#board/confession', 'Legacy board alias lost its hash.');
  assert.ok(legacyBoard.threadItems > 0, 'Legacy board alias did not render threads.');
  assertNoHorizontalOverflow(legacyBoard, 'Legacy alias board');

  const threadPath = `/thread/${encodeURIComponent(createdThread.id)}`;
  const legacyRoutes = [
    ['/home', '', '#homeScreen', 'Home'],
    ['/board/confession', '#board/confession', '#boardScreen', 'Board'],
    ['/Board/confession', '#board/confession', '#boardScreen', 'Case-insensitive board'],
    ['/catalog/confession', '#catalog/confession', '#catalogScreen', 'Catalog'],
    [threadPath, `#thread/${encodeURIComponent(createdThread.id)}`, '#threadScreen', 'Thread'],
    ['/login', '#login', '#loginScreen', 'Login'],
    ['/admin', '#admin', '#adminScreen', 'Admin']
  ];
  for (const [routePath, expectedHash, selector, label] of legacyRoutes) {
    await navigate(cdp, `${frontendOrigin}${routePath}`);
    const snapshot = await waitForSnapshot(
      cdp,
      `Legacy ${label} route`,
      legacyRouteSnapshotExpression(routePath, expectedHash, selector)
    );
    assert.equal(snapshot.pathname, routePath, `${label} did not remain on its clean path.`);
    assert.equal(snapshot.hash, expectedHash, `${label} did not use its legacy hash.`);
    assert.equal(snapshot.legacyRootPresent, true, `${label} did not render the legacy shell.`);
    assert.equal(snapshot.screenActive, true, `${label} legacy screen was not active.`);
    assert.equal(snapshot.nativeUiPresent, false, `${label} rendered native Next UI.`);
  }

  const shellEntryRoutes = [
    '/',
    '/home',
    '/board/confession',
    '/thread/smoke-thread',
    '/catalog/confession',
    '/archive/confession',
    '/policy',
    '/policy/privacy',
    '/login',
    '/register',
    '/forgot',
    '/account',
    '/messages',
    '/messages/smoke-conversation',
    '/admin'
  ];
  const shellEntries = await evaluate(
    cdp,
    `Promise.all(${JSON.stringify(shellEntryRoutes)}.map(async (path) => {
      const response = await fetch(path, { cache: 'no-store' });
      const html = await response.text();
      return {
        path,
        status: response.status,
        legacyShell: html.includes('nextLegacyRoot'),
        initialGate:
          html.includes('nextBootstrapScreen') &&
          /id="nextLegacyRoot"[^>]*hidden/.test(html),
        nativeHome: html.includes('data-native-home')
      };
    }))`
  );
  const invalidShellEntries = shellEntries.filter(
    (entry) => entry.status !== 200 || !entry.legacyShell || !entry.initialGate || entry.nativeHome
  );
  assert.deepEqual(invalidShellEntries, [], 'Some supported UI routes did not serve the legacy shell.');

  const unknownResponse = await fetch(`${frontendOrigin}/route-that-does-not-exist`, {
    cache: 'no-store'
  });
  await unknownResponse.arrayBuffer();
  assert.equal(unknownResponse.status, 404, 'Unknown UI routes should remain 404 responses.');

  await sleep(500);
  assertNoPageErrors(diagnostics.pageErrors);
  await assertStalledBootstrapGate(cdp, frontendOrigin);
}

async function main() {
  const browserPath = await findBrowser();
  if (!browserPath) {
    if (process.env.CI) {
      throw new Error('Chrome or Edge was not found. Set CHROME_PATH or install a Chromium browser.');
    }
    console.log('Chrome or Edge was not found; skipping frontend browser smoke outside CI.');
    return;
  }

  await access(path.join(frontendRoot, '.next', 'BUILD_ID')).catch((error) => {
    throw new Error('frontend is not built. Run its build command before browser smoke.', {
      cause: error
    });
  });
  await requireBackendPort();

  const nextPort = await freePort();
  const chromeDebugPort = await freePort();
  const backendOrigin = `http://127.0.0.1:${BACKEND_PORT}`;
  const frontendOrigin = `http://127.0.0.1:${nextPort}`;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), '36chan-next-browser-smoke-'));
  const backendEnvInitUrl = pathToFileURL(
    path.join(repoRoot, 'backend', 'src', 'core', 'env-init.ts')
  ).href;
  const backendTestPreload = `data:text/javascript,${encodeURIComponent(`
    await import(${JSON.stringify(backendEnvInitUrl)});
    for (const key of Object.keys(process.env)) {
      if (key.toUpperCase() === 'HCAPTCHA_SECRET' || key.toUpperCase() === 'HCAPTCHA_SITE_KEY') {
        delete process.env[key];
      }
    }
  `)}`;
  const inheritedTestEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key.toUpperCase() !== 'HCAPTCHA_SECRET' && key.toUpperCase() !== 'HCAPTCHA_SITE_KEY'
    )
  );
  const backendStaticRoot = path.join(tempRoot, 'static');
  const userDataDir = path.join(tempRoot, 'chrome-profile');
  await Promise.all([
    mkdir(backendStaticRoot, { recursive: true }),
    mkdir(userDataDir, { recursive: true })
  ]);

  let backend = null;
  let next = null;
  let chrome = null;
  let cdp = null;
  try {
    backend = spawnService(
      'Backend',
      process.execPath,
      ['--import', backendTestPreload, path.join(repoRoot, 'backend', 'server.ts')],
      {
        cwd: tempRoot,
        env: {
          ...inheritedTestEnv,
          NODE_ENV: 'test',
          PORT: String(BACKEND_PORT),
          STORE_DRIVER: 'json',
          STATIC_ROOT: backendStaticRoot,
          UPLOAD_ROOT: path.join(tempRoot, 'uploads'),
          ADMIN_USERNAME: 'admin',
          ADMIN_PASSWORD: 'admin-password',
          JWT_SECRET: 'frontend-browser-smoke-secret',
          MODERATION_FINGERPRINT_SECRET: 'frontend-browser-smoke-secret',
          POSTER_PROOF_SECRET: 'frontend-browser-smoke-secret',
          HCAPTCHA_SECRET: '',
          HCAPTCHA_SITE_KEY: ''
        }
      }
    );
    await waitForHttp(`${backendOrigin}/api/home`, backend);
    await sleep(150);
    assertServiceRunning(backend);

    const standaloneRoot = path.join(frontendRoot, '.next', 'standalone');
    next = spawnService(
      'Next server',
      process.execPath,
      [path.join(standaloneRoot, 'server.js')],
      {
        cwd: standaloneRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PORT: String(nextPort),
          HOSTNAME: '127.0.0.1',
          NEXT_TELEMETRY_DISABLED: '1',
          BACKEND_ORIGIN: backendOrigin
        }
      }
    );    await waitForHttp(`${frontendOrigin}/`, next);

    chrome = spawnService(
      'Chrome',
      browserPath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--no-first-run',
        '--remote-allow-origins=*',
        `--user-data-dir=${userDataDir}`,
        `--remote-debugging-port=${chromeDebugPort}`,
        '--remote-debugging-address=127.0.0.1',
        '--window-size=1280,900',
        'about:blank'
      ],
      { cwd: tempRoot, env: process.env }
    );
    const pageWebSocketUrl = await waitForPageTarget(chromeDebugPort, chrome);
    cdp = new CdpClient(pageWebSocketUrl);
    await cdp.connect();
    await runBrowserAssertions(cdp, frontendOrigin);

    console.log(`frontend browser smoke: ok (${browserPath})`);
  } catch (error) {
    const serviceOutput = [backend, next, chrome]
      .filter(Boolean)
      .map((service) => {
        const output = service.output();
        return output ? `\n[${service.label}]\n${output}` : '';
      })
      .join('');
    if (serviceOutput && error instanceof Error) {
      error.message = `${error.message}${serviceOutput}`;
      console.error(serviceOutput);
    }
    throw error;
  } finally {
    cdp?.close();
    await stopService(chrome);
    await stopService(next);
    await stopService(backend);
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
