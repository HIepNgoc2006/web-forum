#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimePath = path.join(frontendRoot, 'legacy', 'notification-runtime.ts');
const timeoutMs = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function findBrowser() {
  const windows = process.platform === 'win32';
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    process.env.EDGE_PATH,
    windows ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '',
    windows ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : '',
    windows ? 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' : '',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return '';
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        return;
      }
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
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

async function waitForDebugTarget(debugPort) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (version.webSocketDebuggerUrl && page) {
        return { browserUrl: version.webSocketDebuggerUrl, pageUrl: page.webSocketDebuggerUrl };
      }
    } catch {
      // Chrome is still starting.
    }
    await sleep(150);
  }
  throw new Error('Chrome DevTools endpoint did not become ready.');
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  }
  return result?.value;
}

async function waitForRuntime(cdp) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, 'Boolean(window.notificationRuntime)')) {
      return;
    }
    await sleep(100);
  }
  throw new Error('Notification runtime did not load in Chromium.');
}

function runBrowserScenarios() {
  const runtime = window.notificationRuntime;
  const NativeNotification = window.Notification;
  let nativeNotificationCreated = false;
  try {
    const nativeNotification = new NativeNotification('36chan browser notification smoke');
    nativeNotification.close();
    nativeNotificationCreated = true;
  } catch {
    nativeNotificationCreated = false;
  }

  const records = [];
  class CapturingNotification {
    static permission = 'granted';
    constructor(title, options = {}) {
      this.title = title;
      this.options = options;
      this.onclick = null;
      records.push({ title, options });
    }
    close() {}
  }
  window.Notification = CapturingNotification;
  localStorage.setItem('notificationPreferences', JSON.stringify({
    browserBoardSubscriptions: true,
    browserWatchedThreads: true,
    browserMentions: true,
    browserDirectMessages: true,
    directMessages: false
  }));

  const ids = new Set();
  runtime.notifySubscribedBoardThread({
    thread: {
      id: 'board-thread',
      boardSlug: 'hoc-tap',
      globalNumber: 10,
      subject: 'Chủ đề mới'
    }
  }, {
    browserNotificationIds: ids,
    isBoardSubscribed: () => true
  });
  runtime.notifyWatchedThreadPost({
    threadId: 'watched-thread',
    comment: {
      id: 'watched-comment',
      boardSlug: 'hoc-tap',
      globalNumber: 12,
      bodyLines: [{ text: 'Phản hồi mới' }]
    }
  }, {
    browserNotificationIds: ids,
    readWatchedThreads: () => ({
      'watched-thread': {
        boardPath: '/hoc-tap/',
        globalNumber: 11,
        lastSeen: 11,
        maxNumber: 11,
        replyCount: 0
      }
    }),
    writeWatchedThreads: () => {}
  });
  runtime.notifyTaggedPost({
    threadId: 'tagged-thread',
    comment: {
      id: 'tagged-comment',
      boardSlug: 'hoc-tap',
      globalNumber: 14,
      bodyLines: [{ text: '@student.name xem bài này' }]
    }
  }, {
    accountUsername: 'student.name',
    browserNotificationIds: ids
  });
  runtime.notifyDirectMessage({
    conversationId: 'conversation-1',
    messageId: 'message-1',
    senderUsername: 'friend'
  }, {
    browserNotificationIds: ids
  });
  window.Notification = NativeNotification;

  return {
    permission: NativeNotification.permission,
    nativeNotificationCreated,
    records
  };
}

async function main() {
  const browserPath = await findBrowser();
  if (!browserPath) {
    throw new Error('Chrome or Edge was not found.');
  }
  const source = await readFile(runtimePath, 'utf8');
  const runtimeJavaScript = stripTypeScriptTypes(source, { mode: 'transform' });
  const html = `<!doctype html><meta charset="utf-8"><title>notification test</title>
    <script type="module">window.notificationRuntime = await import('/notification-runtime.js');</script>`;
  const server = http.createServer((request, response) => {
    if (request.url === '/notification-runtime.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(runtimeJavaScript);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await listen(server);
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const debugServer = http.createServer();
  await listen(debugServer);
  const debugAddress = debugServer.address();
  const debugPort = debugAddress.port;
  await closeServer(debugServer);
  const profile = await mkdtemp(path.join(os.tmpdir(), '36chan-notifications-'));
  const chrome = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    origin
  ], { stdio: 'ignore', shell: false });

  let browserCdp;
  let pageCdp;
  try {
    const targets = await waitForDebugTarget(debugPort);
    browserCdp = new CdpClient(targets.browserUrl);
    pageCdp = new CdpClient(targets.pageUrl);
    await browserCdp.connect();
    await pageCdp.connect();
    await browserCdp.send('Browser.grantPermissions', {
      origin,
      permissions: ['notifications']
    });
    await pageCdp.send('Page.reload', { ignoreCache: true });
    await waitForRuntime(pageCdp);
    const result = await evaluate(pageCdp, `(${runBrowserScenarios.toString()})()`);

    assert.equal(result.permission, 'granted');
    assert.equal(result.nativeNotificationCreated, true);
    assert.deepEqual(result.records.map((record) => record.options.data.kind), [
      'board',
      'thread',
      'mention',
      'message'
    ]);
    assert.match(result.records[0].title, /Chủ đề mới/);
    assert.match(result.records[1].title, /No\.11/);
    assert.match(result.records[2].title, /được nhắc đến/);
    assert.match(result.records[3].title, /Tin nhắn/);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    browserCdp?.close();
    pageCdp?.close();
    chrome.kill('SIGTERM');
    await Promise.race([once(chrome, 'exit'), sleep(2000)]);
    if (chrome.exitCode === null) {
      chrome.kill('SIGKILL');
    }
    await closeServer(server);
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Ignore temporary file locking delays on Windows teardown
    }
  }
}

await main();
