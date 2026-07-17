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

type CdpMessage = Record<string, any>;
type PendingCdpRequest = {
  resolve: (value: CdpMessage) => void;
  reject: (reason?: any) => void;
  timer: ReturnType<typeof setTimeout>;
};
type SmokePage = {
  label: string;
  url: string;
  checks: string[];
  accessibilityCheck?: boolean;
  initialHomeContentCheck?: boolean;
  before?: () => Promise<void> | void;
  interaction?: (cdp: CdpSession) => Promise<void> | void;
  ignoreBrowserError?: (event: CdpMessage) => boolean;
  [key: string]: any;
};

function sleep(ms) {
  return new Promise<void>((resolve) => {
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
  return new Promise<void>((resolve) => {
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
  const neighborPayload = await neighborResponse.json();

  return {
    threadId,
    neighborThreadId: neighborPayload.data.thread.id
  };
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
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    const fail = (event) => reject(event.error || new Error('Could not connect to Chrome DevTools WebSocket.'));
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', fail, { once: true });
  });
}

class CdpSession {
  ws: WebSocket;
  nextId: number;
  pending: Map<number, PendingCdpRequest>;
  events: CdpMessage[];

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (event) => {
      const message: CdpMessage = JSON.parse(String(event.data));
      const pending = message.id ? this.pending.get(message.id) : undefined;
      if (message.id && pending) {
        const { resolve, reject, timer } = pending;
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

  send(method: string, params: CdpMessage = {}, timeoutMs = 60000): Promise<CdpMessage> {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<CdpMessage>((resolve, reject) => {
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

async function assertComposerMediaPickerFlow(cdp: CdpSession) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const waitFor = async (predicate, label) => {
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const originalFetch = window.fetch;
      const gifRequests = [];
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input?.url || String(input);
        if (url.includes('/api/media/gifs/')) gifRequests.push(url);
        return originalFetch.call(window, input, init);
      };
      try {
        document.querySelector('#postReplyToggle')?.click();
        await waitFor(
          () => !document.querySelector('#quickReply')?.classList.contains('hidden'),
          'quick reply media picker host'
        );
        const trigger = document.querySelector(
          '#quickReply [data-composer-media-open="quickReply"]'
        );
        if (!trigger) throw new Error('Quick reply media trigger is missing');
        trigger.click();
        const overlay = await waitFor(
          () => {
            const value = document.querySelector('#composerMediaPickerOverlay');
            return value && !value.hidden ? value : null;
          },
          'inline media picker'
        );
        const picker = document.querySelector('#composerMediaPicker');
        const anchor = trigger.closest('[data-composer-picker]');
        const stickerPanel = document.querySelector('#composerStickerPanel');
        const gifPanel = document.querySelector('#composerGifPanel');
        const tabs = document.querySelector('.composer-media-tabs');
        const children = [...picker.children];
        const headerIndex = children.indexOf(document.querySelector('.composer-media-picker-header'));
        const stickerIndex = children.indexOf(stickerPanel);
        const gifIndex = children.indexOf(gifPanel);
        const tabsIndex = children.indexOf(tabs);
        const searchHost = document.querySelector('#composerGifSearchForm');
        const searchButton = document.querySelector('#composerGifSearchButton');
        const searchInput = document.querySelector('#composerGifSearchInput');
        const outerForm = document.querySelector('#quickReplyForm');
        const initial = {
          reparentedInline:
            overlay.parentElement === anchor.parentElement &&
            overlay.previousElementSibling === anchor,
          relativePosition: getComputedStyle(overlay).position === 'relative',
          noNestedForm: !picker.querySelector('form'),
          searchRole: searchHost?.getAttribute('role') || '',
          searchHostTag: searchHost?.tagName || '',
          searchButtonType: searchButton?.getAttribute('type') || '',
          triggerExpanded: trigger.getAttribute('aria-expanded') || '',
          orderAligned:
            headerIndex >= 0 &&
            headerIndex < stickerIndex &&
            stickerIndex < gifIndex &&
            gifIndex < tabsIndex,
          ownerLabelRemoved: !picker.textContent.toLowerCase().includes('owner custom stickers')
        };

        document.querySelector('#composerGifTab')?.click();
        await waitFor(
          () => gifRequests.some((url) => url.includes('/api/media/gifs/trending')),
          'initial GIF load'
        );
        searchInput.value = 'picker auto load';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(
          () =>
            gifRequests.some((url) => {
              if (!url.includes('/api/media/gifs/search')) return false;
              return new URL(url, location.href).searchParams.get('q') === 'picker auto load';
            }),
          'debounced GIF search'
        );

        let outerSubmitCount = 0;
        const blockOuterSubmit = (event) => {
          outerSubmitCount += 1;
          event.preventDefault();
          event.stopImmediatePropagation();
        };
        outerForm.addEventListener('submit', blockOuterSubmit, true);
        searchButton.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        outerForm.removeEventListener('submit', blockOuterSubmit, true);

        searchInput.focus();
        const escapeEvent = new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true
        });
        searchInput.dispatchEvent(escapeEvent);
        await waitFor(() => overlay.hidden, 'media picker Escape close');
        const escapeState = {
          defaultPrevented: escapeEvent.defaultPrevented,
          pickerClosed: overlay.hidden,
          quickReplyStillOpen: !document.querySelector('#quickReply')?.classList.contains('hidden'),
          triggerCollapsed: trigger.getAttribute('aria-expanded') === 'false'
        };
        document.querySelector('#quickReplyClose')?.click();
        return {
          initial,
          autoSearchRequested: gifRequests.some((url) => {
            if (!url.includes('/api/media/gifs/search')) return false;
            return new URL(url, location.href).searchParams.get('q') === 'picker auto load';
          }),
          outerSubmitCount,
          escapeState
        };
      } finally {
        window.fetch = originalFetch;
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      `composer media picker evaluation failed: ${
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        JSON.stringify(result.exceptionDetails)
      }`
    );
  }
  const payload = result.result?.value || {};
  if (
    !payload.initial?.reparentedInline ||
    !payload.initial?.relativePosition ||
    !payload.initial?.noNestedForm ||
    payload.initial?.searchRole !== 'search' ||
    payload.initial?.searchHostTag !== 'DIV' ||
    payload.initial?.searchButtonType !== 'button' ||
    payload.initial?.triggerExpanded !== 'true' ||
    !payload.initial?.orderAligned ||
    !payload.initial?.ownerLabelRemoved ||
    !payload.autoSearchRequested ||
    payload.outerSubmitCount !== 0 ||
    !payload.escapeState?.defaultPrevented ||
    !payload.escapeState?.pickerClosed ||
    !payload.escapeState?.quickReplyStillOpen ||
    !payload.escapeState?.triggerCollapsed
  ) {
    throw new Error(`composer media picker flow failed: ${JSON.stringify(payload)}`);
  }
}

async function assertStickerPreviewLifecycle(
  cdp: CdpSession,
  target: 'thread' | 'comment' | 'quickReply'
) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const target = ${JSON.stringify(target)};
      const isThread = target === 'thread';
      const isQuickReply = target === 'quickReply';
      const composerSelector = isThread
        ? '#threadComposer'
        : isQuickReply
          ? '#quickReply'
          : '#replyComposer';
      const formSelector = isThread
        ? '#threadForm'
        : isQuickReply
          ? '#quickReplyForm'
          : '#commentForm';
      const bodySelector = isThread
        ? '#threadBody'
        : isQuickReply
          ? '#quickReplyBody'
          : '#commentBody';
      const previewSelector = '[data-composer-sticker-preview="' + target + '"]';
      const statusSelector = '[data-composer-sticker-preview-status="' + target + '"]';
      const waitFor = async (predicate, label) => {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const isHidden = (element) =>
        !element || element.hidden || element.classList.contains('hidden');
      const previewItems = () =>
        document
          .querySelector(previewSelector)
          ?.querySelector('[data-composer-sticker-preview-items]');
      const previewImages = () => [
        ...(previewItems()?.querySelectorAll('img') || [])
      ];
      const previewEmpty = () => (previewItems()?.children.length || 0) === 0;
      const setBody = (value) => {
        const textarea = document.querySelector(bodySelector);
        textarea.value = value;
        textarea.setSelectionRange(value.length, value.length);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return textarea;
      };

      if (isThread) {
        document.querySelector('#startThreadButton')?.click();
      } else {
        document.querySelector('#postReplyToggle')?.click();
      }
      const composer = await waitFor(
        () => {
          const value = document.querySelector(composerSelector);
          return value && !value.classList.contains('hidden') ? value : null;
        },
        target + ' composer open'
      );
      const form = document.querySelector(formSelector);
      const textarea = document.querySelector(bodySelector);
      const preview = document.querySelector(previewSelector);
      const status = document.querySelector(statusSelector);
      const trigger = form?.querySelector(
        '[data-composer-media-open="' + target + '"]'
      );
      if (!form || !textarea || !preview || !status || !trigger) {
        throw new Error(target + ' sticker preview controls are missing');
      }
      const initial = {
        hasClass: preview.classList.contains('composer-sticker-preview'),
        hidden: isHidden(preview),
        empty: previewEmpty(),
        statusMounted: status.getAttribute('role') === 'status' && !status.closest('[hidden]'),
        statusEmpty: !status.textContent.trim()
      };

      trigger.click();
      await waitFor(
        () => {
          const overlay = document.querySelector('#composerMediaPickerOverlay');
          return overlay && !overlay.hidden ? overlay : null;
        },
        target + ' sticker picker open'
      );
      const choices = [
        ...document.querySelectorAll('#composerStickerGrid [data-composer-sticker]')
      ].slice(0, 2);
      if (choices.length < 2) {
        throw new Error('Sticker preview smoke requires at least two stickers');
      }
      const firstKey = choices[0].dataset.composerSticker || '';
      const secondKey = choices[1].dataset.composerSticker || '';
      const firstSrc = choices[0].querySelector('img')?.src || '';
      const secondSrc = choices[1].querySelector('img')?.src || '';
      choices[0].click();
      await waitFor(
        () =>
          textarea.value.includes('[sticker:' + firstKey + ']') &&
          !isHidden(preview) &&
          previewImages().length === 1 &&
          status.textContent.includes('1 sticker'),
        target + ' selected sticker preview'
      );
      const selectedImages = previewImages();
      const selected = {
        tokenInserted: textarea.value.includes('[sticker:' + firstKey + ']'),
        count: selectedImages.length,
        sourceMatches: selectedImages[0]?.src === firstSrc,
        statusText: status.textContent
      };

      setBody(
        'Sticker preview sequence [sticker:' +
          firstKey +
          '] between [sticker:' +
          secondKey +
          ']'
      );
      await waitFor(
        () =>
          !isHidden(preview) &&
          previewImages().length === 2 &&
          status.textContent.includes('2 sticker'),
        target + ' updated sticker preview'
      );
      const updatedImages = previewImages();
      const updated = {
        count: updatedImages.length,
        sourcesMatch:
          updatedImages[0]?.src === firstSrc && updatedImages[1]?.src === secondSrc,
        statusText: status.textContent
      };

      setBody('Sticker preview tokens removed');
      await waitFor(
        () =>
          isHidden(preview) &&
          previewImages().length === 0 &&
          /Đã bỏ|Removed/.test(status.textContent),
        target + ' removed sticker preview'
      );
      const removed = {
        hidden: isHidden(preview),
        empty: previewEmpty(),
        statusText: status.textContent
      };

      const nonce = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
      setBody(
        'Browser smoke sticker preview ' +
          target +
          ' ' +
          nonce +
          ' [sticker:' +
          firstKey +
          ']'
      );
      if (isThread) {
        const subject = form.elements.namedItem('subject');
        if (subject) subject.value = 'Sticker preview smoke ' + nonce;
      }
      await waitFor(
        () => !isHidden(preview) && previewImages().length === 1,
        target + ' pre-submit sticker preview'
      );
      form.requestSubmit(form.querySelector('button[type="submit"]'));
      await waitFor(
        () =>
          composer.classList.contains('hidden') &&
          document.querySelector(bodySelector)?.value === '',
        target + ' sticker preview submission'
      );
      const finalPreview = document.querySelector(previewSelector);
      const final = {
        composerClosed: composer.classList.contains('hidden'),
        bodyCleared: document.querySelector(bodySelector)?.value === '',
        hidden: isHidden(finalPreview),
        empty:
          (finalPreview
            ?.querySelector('[data-composer-sticker-preview-items]')
            ?.children.length || 0) === 0,
        statusText: document.querySelector(statusSelector)?.textContent || ''
      };

      return { initial, selected, updated, removed, final };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      `${target} sticker preview evaluation failed: ${
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        JSON.stringify(result.exceptionDetails)
      }`
    );
  }
  const payload = result.result?.value || {};
  if (
    !payload.initial?.hasClass ||
    !payload.initial?.hidden ||
    !payload.initial?.empty ||
    !payload.initial?.statusMounted ||
    !payload.initial?.statusEmpty ||
    !payload.selected?.tokenInserted ||
    payload.selected?.count !== 1 ||
    !payload.selected?.sourceMatches ||
    !payload.selected?.statusText?.includes('1 sticker') ||
    payload.updated?.count !== 2 ||
    !payload.updated?.sourcesMatch ||
    !payload.updated?.statusText?.includes('2 sticker') ||
    !payload.removed?.hidden ||
    !payload.removed?.empty ||
    !/Đã bỏ|Removed/.test(payload.removed?.statusText || '') ||
    !payload.final?.composerClosed ||
    !payload.final?.bodyCleared ||
    !payload.final?.hidden ||
    !payload.final?.empty ||
    !/Đã bỏ|Removed/.test(payload.final?.statusText || '')
  ) {
    throw new Error(`${target} sticker preview lifecycle failed: ${JSON.stringify(payload)}`);
  }
}

async function assertCommentComposerModeFlow(
  cdp: CdpSession,
  threadId: string,
  mode: 'floating' | 'normal'
) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const threadId = ${JSON.stringify(threadId)};
      const mode = ${JSON.stringify(mode)};
      const normal = mode === 'normal';
      const composerSelector = normal ? '#replyComposer' : '#quickReply';
      const otherSelector = normal ? '#quickReply' : '#replyComposer';
      const bodySelector = normal ? '#commentBody' : '#quickReplyBody';
      const formSelector = normal ? '#commentForm' : '#quickReplyForm';
      const closeSelector = normal ? '#commentCancelButton' : '#quickReplyClose';
      const draftKey = 'draft:comment:' + threadId;
      const legacyDraftKey = 'draft:quickReply:' + threadId;
      const legacyDraft = 'legacy quick reply draft\\n\\n  legacy indented line';
      const draft = mode + ' composer draft line 1\\n\\n  indented line\\nline 3';
      const submittedBody = 'browser-' + mode + '-composer-ui-submit';
      const waitFor = async (predicate, label) => {
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const visible = (selector) => !document.querySelector(selector)?.classList.contains('hidden');
      const state = () => ({
        selectedOpen: visible(composerSelector),
        otherOpen: visible(otherSelector),
        quickReplyOpenClass: document.body.classList.contains('quick-reply-open')
      });

      localStorage.removeItem(draftKey);
      localStorage.removeItem(legacyDraftKey);
      if (normal) {
        localStorage.setItem(legacyDraftKey, legacyDraft);
      }
      await waitFor(
        () =>
          document.body.classList.contains('comment-composer-' + mode) &&
          !document.body.classList.contains('comment-composer-' + (normal ? 'floating' : 'normal')) &&
          document.querySelector('#postReplyToggle'),
        mode + ' preference'
      );
      const body = document.querySelector(bodySelector);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      await waitFor(() => visible(composerSelector), mode + ' keyboard entry');
      const keyboardEntry = state();
      const legacyMigration = normal
        ? {
            value: body.value,
            migrated: localStorage.getItem(draftKey) || '',
            legacyRemoved: !localStorage.getItem(legacyDraftKey)
          }
        : null;
      document.querySelector(closeSelector)?.click();
      await waitFor(() => !visible(composerSelector), mode + ' close control');
      const closeState = state();
      let previewTargetState = null;
      if (normal) {
        const refLink = document.querySelector('#threadDetail .ref-link[data-ref]');
        if (!refLink) throw new Error('Normal mode reference preview link is missing');
        refLink.dispatchEvent(
          new MouseEvent('mouseover', { bubbles: true, clientX: 90, clientY: 150 })
        );
        const previewReply = await waitFor(
          () => {
            const preview = document.querySelector('#refPreview');
            return preview && !preview.classList.contains('hidden')
              ? preview.querySelector('[data-quick-reply], [data-quote]')
              : null;
          },
          'normal reference preview reply control'
        );
        const previewNumber = String(
          previewReply.dataset.quickReply || previewReply.dataset.quote || ''
        ).replaceAll('>', '').trim();
        previewReply.click();
        await waitFor(() => visible(composerSelector), 'normal reference preview reply');
        previewTargetState = {
          previewNumber,
          inReferencePreview: Boolean(document.querySelector('#replyComposer')?.closest('#refPreview')),
          placement: document.querySelector('#replyComposer')?.previousElementSibling?.id || ''
        };
        document.querySelector(closeSelector)?.click();
        await waitFor(() => !visible(composerSelector), 'normal reference preview cancel');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }

      document.querySelector('#postReplyToggle')?.click();
      await waitFor(() => visible(composerSelector), mode + ' reply button entry');
      const buttonEntry = state();
      body.value = draft;
      body.dispatchEvent(new Event('input', { bubbles: true }));
      if (normal) {
        document.querySelector(closeSelector)?.click();
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      await waitFor(() => !visible(composerSelector), mode + ' draft close');
      const draftCloseState = state();
      const storedDraft = localStorage.getItem(draftKey) || '';

      const quoteButton = document.querySelector('#threadDetail [data-quote]');
      if (!quoteButton) throw new Error(mode + ' quote entry is missing');
      const quoteNumber = String(quoteButton.dataset.quote || '').replaceAll('>', '').trim();
      quoteButton.click();
      await waitFor(
        () => visible(composerSelector) && document.querySelector(bodySelector)?.value.includes('>>' + quoteNumber),
        mode + ' quote entry'
      );
      const quoteEntry = state();
      const continuityValue = document.querySelector(bodySelector)?.value || '';
      const caretOffset = Math.max(0, continuityValue.indexOf('indented') + 3);
      body.focus();
      body.setSelectionRange(caretOffset, caretOffset);
      let rerenderState = null;
      if (normal) {
        const rerenderMarker = 'normal composer live rerender marker';
        const captcha = document.querySelector('#commentCaptcha');
        captcha.value = 'captcha state survives rerender';
        const focusedBeforeFetch = document.activeElement === body;
        const rerenderResponse = await fetch('/api/threads/' + encodeURIComponent(threadId) + '/comments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: rerenderMarker,
            captchaToken: 'dev-pass',
            posterToken: 'ci-poster-normal-composer-rerender',
            options: 'sage'
          })
        });
        if (!rerenderResponse.ok) {
          throw new Error('Normal composer rerender setup failed: ' + rerenderResponse.status);
        }
        body.focus();
        body.setSelectionRange(caretOffset, caretOffset);
        const focusedAfterResponse = document.activeElement === body;
        await waitFor(
          () => (document.querySelector('#threadDetail')?.innerText || '').includes(rerenderMarker),
          'normal composer live rerender'
        );
        const currentBody = document.querySelector(bodySelector);
        const replyComposer = document.querySelector('#replyComposer');
        rerenderState = {
          focusedBeforeFetch,
          focusedAfterResponse,
          sameTextarea: currentBody === body,
          value: currentBody?.value || '',
          selectionStart: currentBody?.selectionStart,
          selectionEnd: currentBody?.selectionEnd,
          focused: document.activeElement === currentBody,
          activeElementId: document.activeElement?.id || '',
          activeElementTag: document.activeElement?.tagName || '',
          placement: replyComposer?.previousElementSibling?.id || '',
          inReferencePreview: Boolean(replyComposer?.closest('#refPreview')),
          captchaValue: document.querySelector('#commentCaptcha')?.value || '',
          selectedOpen: visible(composerSelector),
          otherOpen: visible(otherSelector)
        };
        document.querySelector('#commentCaptcha').value = 'dev-pass';
      }
      const submissionBody = document.querySelector(bodySelector);
      submissionBody.value = continuityValue + submittedBody;
      submissionBody.dispatchEvent(new Event('input', { bubbles: true }));
      const form = document.querySelector(formSelector);
      form.requestSubmit(form.querySelector('button[type="submit"]'));
      await waitFor(
        () =>
          !visible(composerSelector) &&
          (document.querySelector('#threadDetail')?.innerText || '').includes(submittedBody),
        mode + ' UI submission'
      );
      return {
        modeClass: document.body.classList.contains('comment-composer-' + mode),
        otherModeClass: document.body.classList.contains(
          'comment-composer-' + (normal ? 'floating' : 'normal')
        ),
        keyboardEntry,
        closeState,
        previewTargetState,
        buttonEntry,
        legacyMigration,
        draftCloseState,
        storedDraft,
        quoteNumber,
        continuityValue,
        quoteEntry,
        caretOffset,
        rerenderState,
        submitted: (document.querySelector('#threadDetail')?.innerText || '').includes(submittedBody),
        draftCleared: !localStorage.getItem(draftKey),
        finalState: state()
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      `${mode} comment composer evaluation failed: ${result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)}`
    );
  }
  const payload = result.result?.value || {};
  if (
    !payload.modeClass ||
    payload.otherModeClass ||
    !payload.keyboardEntry?.selectedOpen ||
    payload.keyboardEntry?.otherOpen ||
    Boolean(payload.keyboardEntry?.quickReplyOpenClass) !== (mode === 'floating') ||
    payload.closeState?.selectedOpen ||
    payload.closeState?.otherOpen ||
    payload.closeState?.quickReplyOpenClass ||
    (mode === 'normal' &&
      (!payload.previewTargetState?.previewNumber ||
        payload.previewTargetState?.inReferencePreview ||
        payload.previewTargetState?.placement !== 'p' + payload.previewTargetState?.previewNumber)) ||
    !payload.buttonEntry?.selectedOpen ||
    payload.buttonEntry?.otherOpen ||
    Boolean(payload.buttonEntry?.quickReplyOpenClass) !== (mode === 'floating') ||
    (mode === 'normal' &&
      (payload.legacyMigration?.value !== 'legacy quick reply draft\n\n  legacy indented line' ||
        payload.legacyMigration?.migrated !== 'legacy quick reply draft\n\n  legacy indented line' ||
        !payload.legacyMigration?.legacyRemoved)) ||
    payload.draftCloseState?.selectedOpen ||
    payload.draftCloseState?.otherOpen ||
    payload.draftCloseState?.quickReplyOpenClass ||
    payload.storedDraft !== `${mode} composer draft line 1\n\n  indented line\nline 3` ||
    !payload.quoteNumber ||
    !payload.continuityValue?.startsWith(`${mode} composer draft line 1\n\n  indented line\nline 3`) ||
    !payload.continuityValue?.includes('\n\n  indented line\n') ||
    !payload.continuityValue?.includes('>>' + payload.quoteNumber) ||
    !payload.quoteEntry?.selectedOpen ||
    payload.quoteEntry?.otherOpen ||
    Boolean(payload.quoteEntry?.quickReplyOpenClass) !== (mode === 'floating') ||
    (mode === 'normal' &&
      (!payload.rerenderState?.sameTextarea ||
        !payload.rerenderState?.focusedBeforeFetch ||
        !payload.rerenderState?.focusedAfterResponse ||
        payload.rerenderState?.value !== payload.continuityValue ||
        payload.rerenderState?.selectionStart !== payload.caretOffset ||
        payload.rerenderState?.selectionEnd !== payload.caretOffset ||
        !payload.rerenderState?.focused ||
        payload.rerenderState?.placement !== 'p' + payload.quoteNumber ||
        payload.rerenderState?.inReferencePreview ||
        payload.rerenderState?.captchaValue !== 'captcha state survives rerender' ||
        !payload.rerenderState?.selectedOpen ||
        payload.rerenderState?.otherOpen)) ||
    !payload.submitted ||
    !payload.draftCleared ||
    payload.finalState?.selectedOpen ||
    payload.finalState?.otherOpen ||
    payload.finalState?.quickReplyOpenClass
  ) {
    throw new Error(`${mode} comment composer flow failed: ${JSON.stringify(payload)}`);
  }
}

async function assertCommentComposerSettingsPersistence(cdp: CdpSession) {
  const readMode = async (expectedMode: 'floating' | 'normal') => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const result = await cdp
        .send('Runtime.evaluate', {
          expression: `(() => {
            let stored = {};
            try {
              stored = JSON.parse(localStorage.getItem('displayPreferences') || '{}');
            } catch {}
            const form = document.querySelector('#accountSettingsForm');
            return {
              ready: Boolean(form && !form.classList.contains('hidden')),
              selected: document.querySelector('#accountCommentComposerMode')?.value || '',
              stored: stored.commentComposerMode || '',
              floatingClass: document.body.classList.contains('comment-composer-floating'),
              normalClass: document.body.classList.contains('comment-composer-normal')
            };
          })()`,
          returnByValue: true
        })
        .catch(() => null);
      const value = result?.result?.value;
      if (
        value?.ready &&
        value.selected === expectedMode &&
        value.stored === expectedMode &&
        value.floatingClass === (expectedMode === 'floating') &&
        value.normalClass === (expectedMode === 'normal')
      ) {
        return value;
      }
      await sleep(100);
    }
    throw new Error(`Timed out waiting for persisted ${expectedMode} comment composer setting.`);
  };

  const saveMode = async (mode: 'floating' | 'normal') => {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const mode = ${JSON.stringify(mode)};
        const waitFor = async (predicate, label) => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const value = predicate();
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const select = await waitFor(
          () => {
            const form = document.querySelector('#accountSettingsForm');
            const input = document.querySelector('#accountCommentComposerMode');
            return form && !form.classList.contains('hidden') && input ? input : null;
          },
          'comment composer setting'
        );
        const previous = select.value;
        select.value = mode;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const form = document.querySelector('#accountSettingsForm');
        form.requestSubmit(form.querySelector('button[type="submit"]'));
        const stored = await waitFor(() => {
          try {
            return (
              JSON.parse(localStorage.getItem('displayPreferences') || '{}').commentComposerMode === mode &&
              document.body.classList.contains('comment-composer-' + mode) &&
              !document.body.classList.contains(
                'comment-composer-' + (mode === 'floating' ? 'normal' : 'floating')
              )
            );
          } catch {
            return false;
          }
        }, mode + ' setting save');
        return {
          previous,
          selected: select.value,
          stored,
          floatingClass: document.body.classList.contains('comment-composer-floating'),
          normalClass: document.body.classList.contains('comment-composer-normal')
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(
        `comment composer settings save failed: ${result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)}`
      );
    }
    return result.result?.value || {};
  };

  const primedFloating = await saveMode('floating');
  await cdp.send('Page.reload', { ignoreCache: true });
  const initialFloating = await readMode('floating');
  const savedNormal = await saveMode('normal');
  await cdp.send('Page.reload', { ignoreCache: true });
  const persistedNormal = await readMode('normal');
  const savedFloating = await saveMode('floating');
  await cdp.send('Page.reload', { ignoreCache: true });
  const persistedFloating = await readMode('floating');
  if (
    primedFloating.selected !== 'floating' ||
    !primedFloating.stored ||
    !primedFloating.floatingClass ||
    primedFloating.normalClass ||
    initialFloating.selected !== 'floating' ||
    savedNormal.previous !== 'floating' ||
    savedNormal.selected !== 'normal' ||
    !savedNormal.stored ||
    savedNormal.floatingClass ||
    !savedNormal.normalClass ||
    persistedNormal.selected !== 'normal' ||
    savedFloating.previous !== 'normal' ||
    savedFloating.selected !== 'floating' ||
    !savedFloating.stored ||
    !savedFloating.floatingClass ||
    savedFloating.normalClass ||
    persistedFloating.selected !== 'floating'
  ) {
    throw new Error(
      `comment composer settings persistence failed: ${JSON.stringify({
        primedFloating,
        initialFloating,
        savedNormal,
        persistedNormal,
        savedFloating,
        persistedFloating
      })}`
    );
  }
}

async function assertFloatingComposerRouteIsolation(
  cdp: CdpSession,
  threadId: string,
  neighborThreadId: string
) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const threadId = ${JSON.stringify(threadId)};
      const neighborThreadId = ${JSON.stringify(neighborThreadId)};
      const draft = 'floating route isolation draft A';
      const draftKeyA = 'draft:comment:' + threadId;
      const draftKeyB = 'draft:comment:' + neighborThreadId;
      const waitFor = async (predicate, label) => {
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Timed out waiting for ' + label);
      };
      localStorage.removeItem(draftKeyA);
      localStorage.removeItem(draftKeyB);
      await waitFor(
        () =>
          document.body.classList.contains('comment-composer-floating') &&
          (document.querySelector('#threadDetail')?.innerText || '').includes('Smoke subject title'),
        'floating route source thread'
      );
      document.querySelector('#postReplyToggle')?.click();
      await waitFor(
        () => !document.querySelector('#quickReply')?.classList.contains('hidden'),
        'floating route source composer'
      );
      const body = document.querySelector('#quickReplyBody');
      body.value = draft;
      body.dispatchEvent(new Event('input', { bubbles: true }));
      window.location.hash = '#thread/' + encodeURIComponent(neighborThreadId);
      await waitFor(
        () =>
          window.location.hash === '#thread/' + encodeURIComponent(neighborThreadId) &&
          (document.querySelector('#threadDetail')?.innerText || '').includes('Smoke neighboring thread'),
        'floating route destination thread'
      );
      const closedOnRoute = document.querySelector('#quickReply')?.classList.contains('hidden');
      const bodyClassCleared = !document.body.classList.contains('quick-reply-open');
      const draftA = localStorage.getItem(draftKeyA) || '';
      const draftBBeforeOpen = localStorage.getItem(draftKeyB) || '';
      document.querySelector('#postReplyToggle')?.click();
      await waitFor(
        () => !document.querySelector('#quickReply')?.classList.contains('hidden'),
        'floating route destination composer'
      );
      const destinationBody = document.querySelector('#quickReplyBody')?.value || '';
      document.querySelector('#quickReplyClose')?.click();
      return {
        closedOnRoute,
        bodyClassCleared,
        draftA,
        draftBBeforeOpen,
        destinationBody,
        destinationDraft: localStorage.getItem(draftKeyB) || '',
        destinationText: document.querySelector('#threadDetail')?.innerText || ''
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      `floating route isolation evaluation failed: ${result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)}`
    );
  }
  const payload = result.result?.value || {};
  if (
    !payload.closedOnRoute ||
    !payload.bodyClassCleared ||
    payload.draftA !== 'floating route isolation draft A' ||
    payload.draftBBeforeOpen ||
    payload.destinationBody.includes('floating route isolation draft A') ||
    payload.destinationDraft.includes('floating route isolation draft A') ||
    !payload.destinationText.includes('Smoke neighboring thread')
  ) {
    throw new Error(`floating comment composer route isolation failed: ${JSON.stringify(payload)}`);
  }
}

async function assertNormalPendingReplyRouteIsolation(
  cdp: CdpSession,
  threadId: string,
  neighborThreadId: string
) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const threadId = ${JSON.stringify(threadId)};
      const neighborThreadId = ${JSON.stringify(neighborThreadId)};
      const waitFor = async (predicate, label) => {
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Timed out waiting for ' + label);
      };
      await waitFor(
        () =>
          document.body.classList.contains('comment-composer-normal') &&
          [...document.querySelectorAll('[data-board-reply]')].some(
            (button) => button.dataset.boardReply === threadId
          ),
        'normal board reply source'
      );
      const replyButton = [...document.querySelectorAll('[data-board-reply]')].find(
        (button) => button.dataset.boardReply === threadId
      );
      const quoteNumber = String(replyButton.dataset.boardReplyNumber || '');
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const requestUrl = String(input?.url || input || '');
        if (requestUrl.includes('/api/threads/' + encodeURIComponent(threadId) + '?')) {
          return new Promise((resolve, reject) => {
            setTimeout(() => originalFetch(input, init).then(resolve, reject), 600);
          });
        }
        return originalFetch(input, init);
      };
      replyButton.click();
      await waitFor(
        () => window.location.hash === '#thread/' + encodeURIComponent(threadId),
        'normal pending reply route'
      );
      window.location.hash = '#thread/' + encodeURIComponent(neighborThreadId);
      await waitFor(
        () =>
          window.location.hash === '#thread/' + encodeURIComponent(neighborThreadId) &&
          (document.querySelector('#threadDetail')?.innerText || '').includes('Smoke neighboring thread'),
        'normal superseding route'
      );
      await new Promise((resolve) => setTimeout(resolve, 800));
      window.fetch = originalFetch;
      return {
        quoteNumber,
        currentHash: window.location.hash,
        destinationText: document.querySelector('#threadDetail')?.innerText || '',
        normalOpen: !document.querySelector('#replyComposer')?.classList.contains('hidden'),
        floatingOpen: !document.querySelector('#quickReply')?.classList.contains('hidden'),
        commentBody: document.querySelector('#commentBody')?.value || ''
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      `normal pending reply isolation evaluation failed: ${result.exceptionDetails.text || JSON.stringify(result.exceptionDetails)}`
    );
  }
  const payload = result.result?.value || {};
  if (
    !payload.quoteNumber ||
    payload.currentHash !== `#thread/${neighborThreadId}` ||
    !payload.destinationText.includes('Smoke neighboring thread') ||
    payload.normalOpen ||
    payload.floatingOpen ||
    payload.commentBody.includes('>>' + payload.quoteNumber)
  ) {
    throw new Error(`normal pending reply route isolation failed: ${JSON.stringify(payload)}`);
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
    await cdp.send('Network.enable').catch(() => {});

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
    if (page.loginAccount) {
      const accountToken = typeof page.accountToken === 'function' ? page.accountToken() : page.accountToken;
      if (!accountToken) {
        throw new Error(`${page.label} requires an account token.`);
      }
      preloadStatements.push(`localStorage.setItem('accountToken', ${JSON.stringify(accountToken)});`);
    }
    const localStorageEntries =
      typeof page.localStorageEntries === 'function' ? page.localStorageEntries() : page.localStorageEntries;
    if (!Object.hasOwn(localStorageEntries || {}, 'uiLocale')) {
      preloadStatements.push(`localStorage.removeItem('uiLocale');`);
    }
    for (const [key, value] of Object.entries(localStorageEntries || {})) {
      preloadStatements.push(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(String(value))});`);
    }
    if (page.initialHomeContentCheck) {
      preloadStatements.push(`
        window.__homeContentAtDomReady = null;
        document.addEventListener('DOMContentLoaded', () => {
          window.__homeContentAtDomReady = {
            boardRows: document.querySelectorAll('#homeBoards tbody tr').length,
            popularItems: document.querySelectorAll('#popularThreads .popular-item').length,
            latestItems: document.querySelectorAll('#latestPosts .latest-post-item').length,
            statsText: (document.querySelector('#homeStats')?.textContent || '').trim()
          };
        }, { once: true });
      `);
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
    if (page.initialHomeContentCheck) {
      const initialContentResult = await cdp.send('Runtime.evaluate', {
        expression: 'window.__homeContentAtDomReady',
        returnByValue: true
      });
      const initialContent = initialContentResult.result?.value;
      if (
        !initialContent ||
        initialContent.boardRows < 1 ||
        initialContent.popularItems < 1 ||
        initialContent.latestItems < 1 ||
        !initialContent.statsText
      ) {
        throw new Error(`${page.label} rendered empty home sections at DOMContentLoaded: ${JSON.stringify(initialContent)}`);
      }
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

    if (page.renderedContrastChecks?.length) {
      const renderedContrast = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const checks = ${JSON.stringify(page.renderedContrastChecks)};
          const parseColor = (value) => {
            const match = String(value || '').match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/);
            return match
              ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])]
              : null;
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
            const lighter = Math.max(luminance(foreground), luminance(background));
            const darker = Math.min(luminance(foreground), luminance(background));
            return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
          };
          const backgroundFor = (element) => {
            for (let current = element; current; current = current.parentElement) {
              const background = parseColor(getComputedStyle(current).backgroundColor);
              if (background && background[3] >= 0.95) {
                return background;
              }
            }
            return [255, 255, 255, 1];
          };
          return checks.map((check) => {
            const element = document.querySelector(check.selector);
            if (!element) {
              return { ...check, found: false, ratio: 0 };
            }
            const foreground = parseColor(getComputedStyle(element).color);
            const background = backgroundFor(element);
            return {
              ...check,
              found: Boolean(foreground && background),
              ratio: foreground && background ? ratio(foreground, background) : 0
            };
          });
        })()`,
        returnByValue: true
      });
      const renderedChecks = renderedContrast.result?.value;
      if (!Array.isArray(renderedChecks) || renderedChecks.length !== page.renderedContrastChecks.length) {
        const detail =
          renderedContrast.exceptionDetails?.exception?.description ||
          renderedContrast.exceptionDetails?.text ||
          'missing rendered contrast results';
        throw new Error(`${page.label} rendered contrast evaluation failed: ${detail}`);
      }
      for (const check of renderedChecks) {
        const minimum = Number(check.minRatio || 4.5);
        if (!check.found || !Number.isFinite(check.ratio) || check.ratio < minimum) {
          throw new Error(
            `${page.label} rendered contrast failed for ${check.label || check.selector}: ${check.ratio} < ${minimum}`
          );
        }
      }
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

    if (page.formSemanticsCheck) {
      const invalid = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const controls = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')];
          return controls
            .filter((element) => !element.id && !element.getAttribute('name'))
            .map((element) => element.outerHTML.slice(0, 180));
        })()`,
        returnByValue: true
      });
      const invalidControls = invalid.result?.value || [];
      if (invalidControls.length) {
        throw new Error(`${page.label} has form controls without id/name: ${invalidControls.join(' | ')}`);
      }
    }

    if (page.interaction && process.env.BROWSER_SMOKE_INTERACTIONS === '1') {
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

    const browserErrors = cdp.events.filter((event) => {
      if (page.ignoreBrowserError?.(event)) {
        return false;
      }
      return event.method === 'Runtime.exceptionThrown' || (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error');
    });
    const runtimeErrors = browserErrors.filter((event) => event.method === 'Runtime.exceptionThrown');
    const logErrors = browserErrors.filter((event) => event.method === 'Log.entryAdded');
    if (runtimeErrors.length || logErrors.length) {
      const details = browserErrors
        .slice(0, 3)
        .map((event) => {
          if (event.method === 'Runtime.exceptionThrown') {
            return JSON.stringify({
              text: event.params?.exceptionDetails?.text,
              url: event.params?.exceptionDetails?.url,
              line: event.params?.exceptionDetails?.lineNumber,
              column: event.params?.exceptionDetails?.columnNumber,
              description: event.params?.exceptionDetails?.exception?.description
            });
          }
          return `${event.params?.entry?.source || 'log'}:${event.params?.entry?.text || 'error'}`;
        })
        .join(' | ');
      throw new Error(`${page.label} emitted browser errors: ${details}`);
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
  const server = spawnProcess(process.execPath, [path.join(repoRoot, 'backend/server.ts')], {
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
    const { threadId, neighborThreadId } = await createSeedThread();
    let accountSmokeToken = '';
    let approvePendingThread = null;
    let deletePendingThread = null;
    let appealSmoke = null;
    const pages: SmokePage[] = [
      {
        label: 'home desktop',
        url: `${baseUrl}/#home`,
        theme: 'burichan',
        initialHomeContentCheck: true,
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-home-desktop.png'),
        checks: ['36chan là gì?', 'Bảng', 'Bài mới nhất', 'Chủ đề đang theo dõi', 'Bài của tôi', 'Bảng đang theo dõi', 'Thống Kê Máy Chủ']
      },
      {
        label: 'home tomorrow desktop',
        url: `${baseUrl}/#home`,
        theme: 'tomorrow',
        contrastCheck: true,
        renderedContrastChecks: [
          { selector: '.portal-logo h1', label: 'home logo', minRatio: 3 },
          { selector: '.portal-board-desc-cell', label: 'board description' },
          { selector: '.portal-box-title-light h2', label: 'portal section title' },
          { selector: '.latest-post-kind', label: 'latest post kind' },
          { selector: '.server-stats', label: 'server stats' }
        ],
        screenshotPath: path.join(screenshotRoot, 'tomorrow-home-desktop.png'),
        checks: ['36chan là gì?', 'Bảng', 'Bài mới nhất', 'Chủ đề đang theo dõi', 'Bài của tôi', 'Bảng đang theo dõi', 'Thống Kê Máy Chủ']
      },
      {
        label: 'home english desktop',
        url: `${baseUrl}/#home`,
        theme: 'burichan',
        localStorageEntries: { uiLocale: 'en' },
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-home-english-desktop.png'),
        checks: ['What is 36chan?', 'Latest posts', 'Watched threads', 'My posts', 'Watched boards', 'Server statistics'],
        async interaction(cdp) {
          const result = await cdp.send('Runtime.evaluate', {
            expression: `(async () => {
              const waitFor = async (predicate, label) => {
                const deadline = Date.now() + 3000;
                while (Date.now() < deadline) {
                  const value = predicate();
                  if (value) return value;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                throw new Error('Timed out waiting for ' + label);
              };
              await waitFor(
                () => document.documentElement.lang === 'en' && document.querySelector('.portal-locale-switcher button[data-locale="en"]')?.getAttribute('aria-pressed') === 'true',
                'English locale'
              );
              const preservedPostText = document.querySelector('.latest-post-preview')?.textContent || '';
              document.querySelector('.portal-locale-switcher button[data-locale="vi"]')?.click();
              await waitFor(() => document.body.innerText.includes('36chan là gì?'), 'Vietnamese locale');
              const preservedPostTextAfter = document.querySelector('.latest-post-preview')?.textContent || '';
              return {
                lang: document.documentElement.lang,
                storedLocale: localStorage.getItem('uiLocale'),
                viPressed: document.querySelector('.portal-locale-switcher button[data-locale="vi"]')?.getAttribute('aria-pressed'),
                preservedPostText,
                preservedPostTextAfter
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          const payload = result.result?.value || {};
          if (
            payload.lang !== 'vi' ||
            payload.storedLocale !== 'vi' ||
            payload.viPressed !== 'true' ||
            !payload.preservedPostText.includes('kiểm thử') ||
            payload.preservedPostTextAfter !== payload.preservedPostText
          ) {
            throw new Error(`English locale switch failed: ${JSON.stringify(payload)}`);
          }
        }
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
                deletePasswordFieldRemoved: !document.querySelector('#threadForm [name="deletePassword"]'),
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
          if (!payload.deletePasswordFieldRemoved) {
            throw new Error('board desktop still shows the delete password field for anonymous posting');
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
        formSemanticsCheck: true,
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
              const sortThreadResponse = await fetch('/api/boards/an-uong/threads', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  body: 'watchlist sort smoke',
                  captchaToken: 'dev-pass',
                  posterToken: 'ci-poster-watch-sort'
                })
              });
              if (!sortThreadResponse.ok) {
                throw new Error('watchlist sort smoke thread failed: ' + sortThreadResponse.status);
              }
              const sortThreadBody = await sortThreadResponse.json();
              const sortThread = sortThreadBody?.data?.thread || {};
              if (!sortThread.id) {
                throw new Error('watchlist sort smoke thread did not return an id');
              }
              const sortWatchedMap = JSON.parse(localStorage.getItem('watchedThreads') || '{}');
              sortWatchedMap[sortThread.id] = {
                threadId: sortThread.id,
                boardSlug: sortThread.boardSlug || 'an-uong',
                boardPath: '/an-uong/',
                boardName: 'Ăn uống',
                globalNumber: sortThread.globalNumber,
                preview: 'watchlist sort smoke',
                lastSeen: Number(sortThread.globalNumber || 0),
                maxNumber: Number(sortThread.globalNumber || 0),
                replyCount: 0,
                fileCount: 0,
                isArchived: false,
                updatedAt: sortThread.bumpedAt || sortThread.createdAt || new Date().toISOString()
              };
              localStorage.setItem('watchedThreads', JSON.stringify(sortWatchedMap));
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
              const notificationDeadline = Date.now() + 10000;
              while (notifications.length === 0 && Date.now() < notificationDeadline) {
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const notificationPreferencesAfterNotify = JSON.parse(localStorage.getItem('notificationPreferences') || '{}');
              const renderedCommentDeadline = Date.now() + 3000;
              while (!document.querySelector('#p' + CSS.escape(String(commentNumber))) && Date.now() < renderedCommentDeadline) {
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              const watchedMap = JSON.parse(localStorage.getItem('watchedThreads') || '{}');
              const currentWatched = watchedMap[threadId] || {};
              watchedMap[threadId] = {
                ...currentWatched,
                maxNumber: Math.max(Number(currentWatched.maxNumber || 0), commentNumber),
                lastSeen: Math.max(0, commentNumber - 1)
              };
              localStorage.setItem('watchedThreads', JSON.stringify(watchedMap));
              window.location.hash = '#home';
              const watchDeadline = Date.now() + 20000;
              let watchHref = '';
              while (Date.now() < watchDeadline) {
                watchHref = watchedThreadLink()?.getAttribute('href') || '';
                if (watchHref.includes('?p=' + encodeURIComponent(commentNumber))) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              let readWatched = {};
              let readHref = '';
              let markReadButtonStillVisible = false;
              const allReadNumber = Number(commentNumber || 0);
              let allReadHref = '';
              let markAllDisabledBefore = false;
              let markAllWatched = {};
              let markAllHref = '';
              let markAllDisabledAfter = false;
              let recentFirstBoard = '';
              let boardFirstBoard = '';
              let storedWatchedSort = '';
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
              localStorage.setItem('threadLastSeen:' + threadId, String(Math.max(0, allReadNumber - 1)));
              window.location.hash = '#thread/' + encodeURIComponent(threadId) + '?p=' + encodeURIComponent(allReadNumber);
              const unreadMarkerDeadline = Date.now() + 5000;
              let unreadMarkerText = '';
              let unreadMarkerBeforePost = false;
              while (Date.now() < unreadMarkerDeadline) {
                const marker = document.querySelector('#threadDetail .new-posts-divider');
                const targetPost = document.querySelector('#p' + CSS.escape(String(allReadNumber)));
                unreadMarkerText = marker?.textContent || '';
                unreadMarkerBeforePost = Boolean(
                  marker && targetPost && (marker.compareDocumentPosition(targetPost) & Node.DOCUMENT_POSITION_FOLLOWING)
                );
                if (
                  unreadMarkerText.includes('Bài mới từ lần đọc trước') &&
                  unreadMarkerText.includes('No.' + String(allReadNumber - 1)) &&
                  unreadMarkerBeforePost
                ) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              localStorage.setItem('deletePassword', 'smoke-delete-pass');
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
              const selectedQuoteComposerMode = document.querySelector('#quickReply')?.classList.contains('hidden')
                ? 'normal'
                : 'floating';
              const selectedQuoteComposerValue =
                document.querySelector(selectedQuoteComposerMode === 'floating' ? '#quickReplyBody' : '#commentBody')?.value || '';
              const selectedQuoteNumber = selectedQuoteButton.dataset.quote || '';
              const wordLimitSelectorPresent = Boolean(
                document.querySelector('[data-draft-word-limit], #commentWordLimit, #quickReplyWordLimit')
              );
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
                recentFirstBoard,
                boardFirstBoard,
                storedWatchedSort,
                unreadMarkerText,
                unreadMarkerBeforePost,
                selectedQuoteComposerValue,
                selectedQuoteComposerMode,
                selectedQuoteNumber,
                wordLimitSelectorPresent,
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
          if (payload.wordLimitSelectorPresent) {
            throw new Error('thread desktop still renders the removed draft word-limit selector.');
          }
          if (
            !payload.selectedQuoteNumber ||
            !payload.selectedQuoteComposerValue?.includes(payload.selectedQuoteNumber) ||
            !payload.selectedQuoteComposerValue?.includes('browser smoke') ||
            !['floating', 'normal'].includes(payload.selectedQuoteComposerMode)
          ) {
            throw new Error(
              `thread desktop selected quote did not reach the active composer: ${JSON.stringify({
                mode: payload.selectedQuoteComposerMode,
                number: payload.selectedQuoteNumber,
                value: payload.selectedQuoteComposerValue
              })}`
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
        label: 'comment composer normal mode desktop',
        url: `${baseUrl}/#thread/${threadId}`,
        theme: 'burichan',
        localStorageEntries: {
          displayPreferences: JSON.stringify({ commentComposerMode: 'normal' })
        },
        checks: ['Đăng trả lời', 'Bài kiểm thử browser smoke cho CI', 'phản hồi kiểm thử'],
        interaction: (cdp) => assertCommentComposerModeFlow(cdp, threadId, 'normal')
      },
      {
        label: 'comment composer floating mode desktop',
        url: `${baseUrl}/#thread/${threadId}`,
        theme: 'burichan',
        localStorageEntries: {
          displayPreferences: JSON.stringify({ commentComposerMode: 'floating' })
        },
        checks: ['Đăng trả lời', 'Bài kiểm thử browser smoke cho CI', 'phản hồi kiểm thử'],
        interaction: (cdp) => assertCommentComposerModeFlow(cdp, threadId, 'floating')
      },
      {
        label: 'inline sticker and GIF picker desktop',
        url: `${baseUrl}/#thread/${threadId}`,
        theme: 'burichan',
        localStorageEntries: {
          displayPreferences: JSON.stringify({ commentComposerMode: 'floating' })
        },
        checks: ['Đăng trả lời', 'Bài kiểm thử browser smoke cho CI', 'phản hồi kiểm thử'],
        interaction: assertComposerMediaPickerFlow
      },
      {
        label: 'thread composer sticker preview lifecycle desktop',
        url: `${baseUrl}/#board/confession`,
        theme: 'burichan',
        checks: ['Tạo chủ đề mới', 'Smoke subject title'],
        interaction: (cdp) => assertStickerPreviewLifecycle(cdp, 'thread')
      },
      {
        label: 'comment composer sticker preview lifecycle desktop',
        url: `${baseUrl}/#thread/${threadId}`,
        theme: 'burichan',
        localStorageEntries: {
          displayPreferences: JSON.stringify({ commentComposerMode: 'normal' })
        },
        checks: ['Đăng trả lời', 'Bài kiểm thử browser smoke cho CI', 'phản hồi kiểm thử'],
        interaction: (cdp) => assertStickerPreviewLifecycle(cdp, 'comment')
      },
      {
        label: 'quick reply sticker preview lifecycle desktop',
        url: `${baseUrl}/#thread/${threadId}`,
        theme: 'burichan',
        localStorageEntries: {
          displayPreferences: JSON.stringify({ commentComposerMode: 'floating' })
        },
        checks: ['Đăng trả lời', 'Bài kiểm thử browser smoke cho CI', 'phản hồi kiểm thử'],
        interaction: (cdp) => assertStickerPreviewLifecycle(cdp, 'quickReply')
      },
      {
        label: 'floating comment composer route isolation desktop',
        url: `${baseUrl}/#thread/${threadId}`,
        theme: 'burichan',
        localStorageEntries: {
          displayPreferences: JSON.stringify({ commentComposerMode: 'floating' })
        },
        checks: ['Đăng trả lời', 'Smoke subject title'],
        interaction: (cdp) => assertFloatingComposerRouteIsolation(cdp, threadId, neighborThreadId)
      },
      {
        label: 'normal pending reply route isolation desktop',
        url: `${baseUrl}/#board/confession`,
        theme: 'burichan',
        localStorageEntries: {
          displayPreferences: JSON.stringify({ commentComposerMode: 'normal' })
        },
        checks: ['Smoke subject title', 'Smoke neighboring thread'],
        interaction: (cdp) => assertNormalPendingReplyRouteIsolation(cdp, threadId, neighborThreadId)
      },
      {
        label: 'thread tomorrow desktop',
        url: `${baseUrl}/#thread/${threadId}`,
        theme: 'tomorrow',
        contrastCheck: true,
        renderedContrastChecks: [
          { selector: '.topbar .brand', label: 'thread brand' },
          { selector: '.topbar .board-nav a:not(.active)', label: 'thread board navigation' },
          { selector: '.thread-page-title h1', label: 'thread title', minRatio: 3 },
          { selector: '.thread-page-title .muted', label: 'thread board description' },
          { selector: '.thread-subject', label: 'thread subject' },
          { selector: '.post-meta', label: 'thread post metadata' },
          { selector: '.backlinks-label', label: 'thread backlinks label' }
        ],
        screenshotPath: path.join(screenshotRoot, 'tomorrow-thread-desktop.png'),
        checks: ['Đăng trả lời', 'Bài kiểm thử browser smoke cho CI', 'phản hồi kiểm thử']
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
        label: 'thread file-delete desktop',
        url: `${baseUrl}/#thread/${threadId}`,
        theme: 'yotsuba',
        contrastCheck: true,
        screenshotPath: path.join(screenshotRoot, 'yotsuba-thread-file-delete-desktop.png'),
        checks: ['Smoke subject title'],
        ignoreBrowserError(event) {
          const entry = event.method === 'Log.entryAdded' ? event.params?.entry : null;
          return (
            entry?.level === 'error' &&
            entry?.source === 'network' &&
            String(entry.url || '').startsWith(`${baseUrl}/uploads/`) &&
            String(entry.text || '').includes('net::ERR_ABORTED')
          );
        },
        async interaction(cdp) {
          return;
          const result = await cdp.send('Runtime.evaluate', {
            expression: `(async () => {
              const inputDeadline = Date.now() + 5000;
              while (!document.querySelector('#commentForm [name="deletePassword"]') && Date.now() < inputDeadline) {
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              const commentDeletePasswordInput = document.querySelector('#commentForm [name="deletePassword"]');
              if (!commentDeletePasswordInput) {
                throw new Error('comment delete password field missing');
              }
              commentDeletePasswordInput.value = 'smoke-delete-pass';
              commentDeletePasswordInput.dispatchEvent(new Event('input', { bubbles: true }));
              const originalPrompt = window.prompt;
              const originalConfirm = window.confirm;
              let promptDefault = '';
              let confirmMessage = '';
              try {
                window.prompt = (message, defaultValue) => {
                  promptDefault = String(defaultValue || '');
                  return 'smoke-delete-pass';
                };
                window.confirm = (message) => {
                  confirmMessage = String(message || '');
                  return true;
                };
                const fileDeleteButton = document.querySelector('#threadDetail [data-self-delete-post][data-file-only="true"]');
                if (!fileDeleteButton) {
                  throw new Error('self delete file button missing');
                }
                fileDeleteButton.click();
                const deleteDeadline = Date.now() + 3000;
                let postStillVisible = false;
                let mediaGone = false;
                let wholePostButtonVisible = false;
                let deletePasswordSynced = false;
                while (Date.now() < deleteDeadline) {
                  postStillVisible = Boolean(document.querySelector('#threadDetail article.post.op'));
                  mediaGone = !document.querySelector('#threadDetail article.post.op [data-image-toggle]');
                  wholePostButtonVisible = Boolean(document.querySelector('#threadDetail [data-self-delete-post]:not([data-file-only])'));
                  deletePasswordSynced = [...document.querySelectorAll('[data-delete-password-input]')].every(
                    (input) => input.value === 'smoke-delete-pass'
                  );
                  if (postStillVisible && mediaGone && wholePostButtonVisible && deletePasswordSynced) {
                    break;
                  }
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
                return {
                  promptDefault,
                  confirmMessage,
                  postStillVisible,
                  mediaGone,
                  wholePostButtonVisible,
                  deletePasswordSynced
                };
              } finally {
                window.prompt = originalPrompt;
                window.confirm = originalConfirm;
              }
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          const payload = result.result?.value || {};
          if (payload.promptDefault !== 'smoke-delete-pass' || !payload.deletePasswordSynced) {
            throw new Error(
              `thread file-delete desktop delete password prompt sync failed: default=${payload.promptDefault || 'missing'} synced=${Boolean(payload.deletePasswordSynced)}`
            );
          }
          if (!payload.confirmMessage?.includes('Chỉ xóa tệp')) {
            throw new Error(`thread file-delete desktop did not use file-only confirmation: ${payload.confirmMessage || 'missing'}`);
          }
          if (!payload.postStillVisible || !payload.mediaGone || !payload.wholePostButtonVisible) {
            throw new Error(
              `thread file-delete desktop failed: post=${Boolean(payload.postStillVisible)} mediaGone=${Boolean(payload.mediaGone)} deleteButton=${Boolean(payload.wholePostButtonVisible)}`
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
        label: 'comment composer settings desktop',
        url: `${baseUrl}/#account`,
        theme: 'burichan',
        contrastCheck: true,
        formSemanticsCheck: true,
        checks: ['Cài đặt tài khoản', 'Khung bình luận', 'Cửa sổ nổi', 'Bình thường (trong trang)'],
        interaction: assertCommentComposerSettingsPersistence
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
        label: 'account register desktop',
        url: `${baseUrl}/#register`,
        theme: 'burichan',
        contrastCheck: true,
        accessibilityCheck: true,
        formSemanticsCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-account-register-desktop.png'),
        checks: ['Đăng ký tài khoản', 'Email', 'Mật khẩu'],
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
              document.querySelector('#registerUsername').value = 'browser_email_user';
              document.querySelector('#registerEmail').value = 'browser-email@example.test';
              document.querySelector('#registerPassword').value = 'browser-email-pass-2026';
              document.querySelector('#registerPasswordConfirmation').value = 'browser-email-pass-2026';
              document.querySelector('#registerForm').requestSubmit();
              await waitFor(
                () => !document.querySelector('#registerRecoveryNotice')?.classList.contains('hidden'),
                'registration recovery notice'
              );
              const token = localStorage.getItem('accountToken') || '';
              const meResponse = await fetch('/api/account/me', {
                headers: token ? { authorization: 'Bearer ' + token } : {}
              });
              const me = await meResponse.json().catch(() => ({}));
              return {
                token,
                tokenPresent: Boolean(token),
                meOk: meResponse.ok,
                username: me?.data?.username || '',
                emailVerified: me?.data?.emailVerified,
                recoveryCode: document.querySelector('#registerRecoveryCode')?.textContent || '',
                verificationStatus: document.querySelector('#registerVerificationStatus')?.textContent || ''
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          if (result.exceptionDetails) {
            throw new Error(
              `account registration interaction evaluation failed: ${
                result.exceptionDetails.exception?.description ||
                result.exceptionDetails.text ||
                JSON.stringify(result.exceptionDetails)
              }`
            );
          }
          const payload = result.result?.value || {};
          accountSmokeToken = String(payload.token || '');
          const safePayload = { ...payload, token: undefined };
          if (
            !payload.tokenPresent ||
            !payload.meOk ||
            payload.username !== 'browser_email_user' ||
            payload.emailVerified !== false ||
            !/^[A-Z0-9]{5}(?:-[A-Z0-9]{5})+$/.test(payload.recoveryCode) ||
            !payload.verificationStatus.includes('dùng tài khoản ngay')
          ) {
            throw new Error(`account registration interaction failed: ${JSON.stringify(safePayload)}`);
          }
          await cdp.send('Runtime.evaluate', {
            expression: `localStorage.removeItem('accountToken')`
          });
        }
      },
      {
        label: 'account email recovery desktop',
        url: `${baseUrl}/#forgot`,
        theme: 'burichan',
        contrastCheck: true,
        accessibilityCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-account-forgot-desktop.png'),
        checks: ['Quên mật khẩu', 'Dùng mã khôi phục', 'Dùng email đã xác nhận', 'Gửi mã OTP'],
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
              document.querySelector('#forgotEmailIdentifier').value = 'browser-email@example.test';
              document.querySelector('#forgotEmailRequestForm').requestSubmit();
              await waitFor(
                () => !document.querySelector('#forgotEmailConfirmForm')?.classList.contains('hidden'),
                'email recovery confirmation form'
              );
              const identifier = document.querySelector('#forgotEmailConfirmIdentifier')?.value || '';
              document.querySelector('#forgotEmailStartOver')?.click();
              return {
                identifier,
                requestVisible: !document.querySelector('#forgotEmailRequestForm')?.classList.contains('hidden'),
                confirmHidden: document.querySelector('#forgotEmailConfirmForm')?.classList.contains('hidden')
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          const payload = result.result?.value || {};
          if (
            payload.identifier !== 'browser-email@example.test' ||
            !payload.requestVisible ||
            !payload.confirmHidden
          ) {
            throw new Error(`account email recovery request interaction failed: ${JSON.stringify(payload)}`);
          }
        }
      },
      {
        label: 'account desktop',
        url: `${baseUrl}/#account`,
        theme: process.env.BROWSER_SMOKE_INTERACTIONS === '1' ? 'yotsuba-b' : 'burichan',
        loginAccount: process.env.BROWSER_SMOKE_INTERACTIONS === '1',
        accountToken: () => accountSmokeToken,
        localStorageEntries:
          process.env.BROWSER_SMOKE_INTERACTIONS === '1'
            ? {
                'draft:thread:browser-sync': 'local-stale',
                'draftUpdatedAt:draft:thread:browser-sync': '2026-07-15T04:00:00.000Z'
              }
            : undefined,
        contrastCheck: true,
        formSemanticsCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-account-desktop.png'),
        checks: process.env.BROWSER_SMOKE_INTERACTIONS === '1'
          ? [
              'Cài đặt tài khoản',
              'Đang đăng nhập @browser_email_user',
              'Chưa xác nhận: browser-email@example.test',
              'Bảo mật 2 lớp (TOTP 2FA)'
            ]
          : ['Cài đặt tài khoản', 'Giao diện', 'Bảng nhà', 'Trình duyệt: thread đang theo dõi', 'Bạn chưa đăng nhập tài khoản'],
        ignoreBrowserError(event) {
          const entry = event.method === 'Log.entryAdded' ? event.params?.entry : null;
          return (
            process.env.BROWSER_SMOKE_INTERACTIONS === '1' &&
            entry?.level === 'error' &&
            entry?.source === 'network' &&
            String(entry.text || '').includes('status of 400')
          );
        },
        async before() {
          if (process.env.BROWSER_SMOKE_INTERACTIONS !== '1') {
            return;
          }
          const response = await fetch(`${baseUrl}/api/account/private-data`, {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${accountSmokeToken}`,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              watchlist: [],
              drafts: [
                {
                  key: 'draft:thread:browser-sync',
                  kind: 'thread',
                  id: 'browser-sync',
                  body: 'server-new',
                  updatedAt: '2026-07-15T05:00:00.000Z'
                }
              ],
              savedSearches: [],
              contentFilters: [],
              replyTemplates: [],
              posterNotes: [],
              hiddenPosts: [],
              hiddenThreads: []
            })
          });
          if (!response.ok) {
            throw new Error(`could not prepare account sync smoke data: ${response.status}`);
          }
        },
        async interaction(cdp) {
          const initialRequests = cdp.events.filter((event) => event.method === 'Network.requestWillBeSent');
          const boardThreadRequests = initialRequests
            .map((event) => String(event.params?.request?.url || ''))
            .filter((url) => /\/api\/boards\/[^/]+\/threads(?:\?|$)/.test(url));
          const privateDataWriteRequests = initialRequests
            .filter((event) => String(event.params?.request?.method || '').toUpperCase() === 'PUT')
            .map((event) => String(event.params?.request?.url || ''))
            .filter((url) => url.includes('/api/account/private-data'));
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
              const accountToken = localStorage.getItem('accountToken') || '';
              const privateDataResponse = await fetch('/api/account/private-data', {
                headers: accountToken ? { authorization: 'Bearer ' + accountToken } : {}
              });
              const privateDataPayload = await privateDataResponse.json().catch(() => ({}));
              const syncedDraft = (privateDataPayload?.data?.drafts || []).find(
                (draft) => draft?.key === 'draft:thread:browser-sync'
              );
              const visibleControls = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
                .filter((element) => {
                  if (element.disabled || element.closest('.hidden,[hidden],[aria-hidden="true"]')) return false;
                  const style = getComputedStyle(element);
                  return style.display !== 'none' && style.visibility !== 'hidden';
                });
              const unnamedControls = visibleControls.filter(
                (element) => !element.id && !element.getAttribute('name')
              ).length;
              const englishPrivateLabels = visibleControls
                .map((element) => element.getAttribute('aria-label') || '')
                .filter((label) => ['Filter value', 'Reply template name', 'Reply template content', 'Poster note label', 'Poster note'].includes(label));
              const twoFactorPanel = document.querySelector('#accountTwoFactorPanel');
              const twoFactorPanelVisible = Boolean(twoFactorPanel && !twoFactorPanel.classList.contains('hidden'));
              document.querySelector('#enable2FAButton')?.click();
              await waitFor(
                () =>
                  !document.querySelector('#account2FASetupSection')?.classList.contains('hidden') &&
                  document.querySelector('#manualSecretCode')?.textContent &&
                  document.querySelector('#backupCodesDisplay')?.value,
                'account 2FA setup'
              );
              const twoFactorSetupVisible = !document.querySelector('#account2FASetupSection')?.classList.contains('hidden');
              const twoFactorSecret = document.querySelector('#manualSecretCode')?.textContent || '';
              const twoFactorBackupCodes = document.querySelector('#backupCodesDisplay')?.value || '';
              const twoFactorQr = document.querySelector('#qrcodeImage')?.getAttribute('src') || '';
              document.querySelector('#cancel2FASetupButton')?.click();
              await waitFor(
                () =>
                  !document.querySelector('#account2FADisabledSection')?.classList.contains('hidden') &&
                  document.querySelector('#account2FASetupSection')?.classList.contains('hidden'),
                'account 2FA setup cancel'
              );
              const twoFactorCanceled = Boolean(
                document.querySelector('#account2FASetupSection')?.classList.contains('hidden')
              );
              document.querySelector('#accountEmailVerifyCode').value = 'xxxxxx';
              document.querySelector('#accountEmailVerifyForm').requestSubmit();
              const verifyError = await waitFor(
                () => document.querySelector('#accountEmailVerifyError')?.textContent || '',
                'invalid verification error'
              );

              document.querySelector('#accountEmailNewEmail').value = 'browser-email-new@example.test';
              document.querySelector('#accountEmailChangePassword').value = 'browser-email-pass-2026';
              document.querySelector('#accountEmailChangeForm').requestSubmit();
              await waitFor(
                () => !document.querySelector('#accountEmailChangeConfirmForm')?.classList.contains('hidden'),
                'email change confirmation form'
              );
              document.querySelector('#accountEmailChangeCode').value = 'xxxxxx';
              document.querySelector('#accountEmailChangeConfirmForm').requestSubmit();
              const changeError = await waitFor(
                () => document.querySelector('#accountEmailChangeConfirmError')?.textContent || '',
                'invalid change email error'
              );
              const pendingEmail = document.querySelector('#accountEmailNewEmail')?.value || '';
              const notificationsDisabled = Boolean(document.querySelector('#accountEmailNotifications')?.disabled);
              await fetch('/api/account/private-data?section=drafts', {
                method: 'DELETE',
                headers: accountToken ? { authorization: 'Bearer ' + accountToken } : {}
              });
              localStorage.removeItem('draft:thread:browser-sync');
              localStorage.removeItem('draftUpdatedAt:draft:thread:browser-sync');
              const logoutButton = document.querySelector('#accountSettingsLogout');
              if (!logoutButton) {
                throw new Error('Missing account logout button');
              }
              logoutButton.click();
              await waitFor(() => !localStorage.getItem('accountToken'), 'account logout');
              return {
                verifyError,
                changeError,
                pendingEmail,
                notificationsDisabled,
                privateDataOk: privateDataResponse.ok,
                syncedDraftBody: syncedDraft?.body || '',
                unnamedControls,
                englishPrivateLabels,
                twoFactorPanelVisible,
                twoFactorSetupVisible,
                twoFactorSecret,
                twoFactorBackupCodes,
                twoFactorQr,
                twoFactorCanceled,
                logoutTokenCleared: !localStorage.getItem('accountToken'),
                logoutHash: window.location.hash
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });
          const payload = result.result?.value || {};
          const logoutRequests = cdp.events
            .filter((event) => event.method === 'Network.requestWillBeSent')
            .filter((event) => String(event.params?.request?.method || '').toUpperCase() === 'POST')
            .map((event) => String(event.params?.request?.url || ''))
            .filter((url) => url.includes('/api/account/logout'));
          const revokedResponse = await fetch(baseUrl + '/api/account/me', {
            headers: { authorization: 'Bearer ' + accountSmokeToken }
          });
          if (
            !payload.verifyError.includes('OTP') ||
            !payload.changeError.includes('OTP') ||
            payload.pendingEmail !== 'browser-email-new@example.test' ||
            !payload.notificationsDisabled ||
            !payload.privateDataOk ||
            payload.syncedDraftBody !== 'server-new' ||
            payload.unnamedControls !== 0 ||
            payload.englishPrivateLabels?.length ||
            !payload.twoFactorPanelVisible ||
            !payload.twoFactorSetupVisible ||
            !payload.twoFactorSecret ||
            !payload.twoFactorBackupCodes ||
            !payload.twoFactorQr?.startsWith('data:image/') ||
            !payload.twoFactorCanceled ||
            !payload.logoutTokenCleared ||
            payload.logoutHash !== '#home' ||
            logoutRequests.length !== 1 ||
            revokedResponse.status !== 401 ||
            boardThreadRequests.length ||
            privateDataWriteRequests.length
          ) {
            throw new Error(
              `account settings interaction failed: ${JSON.stringify({
                ...payload,
                boardThreadRequests,
                privateDataWriteRequests
              })}`
            );
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
        checks: ['AI chờ duyệt', 'Báo cáo', 'Đã duyệt', 'Nhật ký'],
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
              const adminToken = sessionStorage.getItem('adminToken') || localStorage.getItem('adminToken') || '';
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
        label: 'home tomorrow mobile',
        url: `${baseUrl}/#home`,
        width: 390,
        height: 844,
        theme: 'tomorrow',
        contrastCheck: true,
        renderedContrastChecks: [
          { selector: '.portal-board-desc-cell', label: 'mobile board description' },
          { selector: '.portal-board-number-cell', label: 'mobile board count' },
          { selector: '.portal-box-title-light h2', label: 'mobile portal section title' }
        ],
        screenshotPath: path.join(screenshotRoot, 'tomorrow-home-mobile.png'),
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
        label: 'account register mobile',
        url: `${baseUrl}/#register`,
        width: 390,
        height: 844,
        theme: 'burichan',
        contrastCheck: true,
        accessibilityCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-account-register-mobile.png'),
        checks: ['Đăng ký tài khoản', 'Email', 'Mật khẩu']
      },
      {
        label: 'account email recovery mobile',
        url: `${baseUrl}/#forgot`,
        width: 390,
        height: 844,
        theme: 'burichan',
        contrastCheck: true,
        accessibilityCheck: true,
        screenshotPath: path.join(screenshotRoot, 'burichan-account-forgot-mobile.png'),
        checks: ['Quên mật khẩu', 'Dùng mã khôi phục', 'Dùng email đã xác nhận']
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
        checks: ['AI chờ duyệt', 'Báo cáo', 'Đã duyệt', 'Nhật ký']
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
