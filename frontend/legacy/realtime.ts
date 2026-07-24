import { io, type Socket } from 'socket.io-client';

import { SOCKET_IO_PATH, SOCKET_IO_URL } from './constants';
import { els } from './dom';
import { state } from './state';

import type { AnyRecord } from './types';

const realtimeEventNames = [
  'thread:created',
  'thread:bumped',
  'thread:updated',
  'comment:created',
  'comment:updated',
  'thread:archived',
  'dm:message',
  'dm:message-updated',
  'dm:message-deleted',
  'dm:conversation-deleted',
  'dm:typing',
  'dm:read',
  'moderation:event'
];

type RealtimeAcknowledgement = {
  ok?: boolean;
  data?: unknown;
  error?: string;
  statusCode?: number;
  retryAfterMs?: number;
};

function handleRealtimeRefreshError(error: { message?: string }) {
  console.warn('Không cập nhật được màn hình từ realtime:', error);
  els.socketStatus.textContent = 'cần cập nhật';
  els.socketStatus.classList.add('offline');
  els.socketStatus.classList.remove('live');
}

function eventThreadId(payload: AnyRecord = {}) {
  return String(
    payload.threadId ||
      payload.thread?.id ||
      payload.comment?.threadId ||
      ''
  );
}

function eventBoardSlug(payload: AnyRecord = {}) {
  return String(
    payload.boardSlug ||
      payload.thread?.boardSlug ||
      payload.comment?.boardSlug ||
      ''
  );
}

function shouldRefreshThread(_eventName: string, payload: AnyRecord) {
  const currentThreadId = String(state.threadId || '');
  if (!currentThreadId) {
    return false;
  }
  const targetThreadId = eventThreadId(payload);
  // Only reload the open thread when the event is about that thread.
  return Boolean(targetThreadId) && targetThreadId === currentThreadId;
}

function shouldRefreshBoard(eventName: string, payload: AnyRecord) {
  if (eventName === 'comment:updated') {
    return false;
  }
  const currentBoard = String(state.boardSlug || '');
  if (!currentBoard) {
    return true;
  }
  const boardSlug = eventBoardSlug(payload);
  return !boardSlug || boardSlug === currentBoard;
}

function shouldRefreshHome(eventName: string) {
  return (
    eventName === 'thread:created' ||
    eventName === 'thread:bumped' ||
    eventName === 'thread:archived' ||
    eventName === 'thread:updated'
  );
}

let pendingRefreshTimer: number | null = null;
let pendingRefresh: (() => Promise<unknown> | null) | null = null;

function scheduleRefresh(run: () => Promise<unknown> | null) {
  pendingRefresh = run;
  if (pendingRefreshTimer != null) {
    return;
  }
  // Coalesce bursty events (e.g. comment:created + thread:bumped).
  pendingRefreshTimer = window.setTimeout(() => {
    pendingRefreshTimer = null;
    const next = pendingRefresh;
    pendingRefresh = null;
    const refresh = next?.();
    if (refresh) {
      refresh.catch(handleRealtimeRefreshError);
    }
  }, 80);
}

let realtimeDependencies: AnyRecord = {};
let activeAccountToken = '';
let activeAdminToken = '';
let authListenerInstalled = false;

function setRealtimeStatus(live: boolean) {
  els.socketStatus.textContent = live ? 'trực tiếp' : 'mất kết nối';
  els.socketStatus.classList.toggle('live', live);
  els.socketStatus.classList.toggle('offline', !live);
}

function emitCurrentScope(source: Socket) {
  source.emit('realtime:scope', {
    boardSlug: String(state.boardSlug || ''),
    threadId: String(state.threadId || '')
  });
}

function handleRealtimeEvent(eventName: string, rawPayload: unknown) {
  const dependencies = realtimeDependencies;
  const payload = rawPayload && typeof rawPayload === 'object'
    ? rawPayload as AnyRecord
    : {};
  if (eventName === 'thread:created') {
    dependencies.notifySubscribedBoardThread?.(payload);
  }
  if (eventName === 'comment:created') {
    dependencies.notifyWatchedThreadPost?.(payload);
  }
  if (
    eventName === 'dm:message' ||
    eventName === 'dm:message-updated' ||
    eventName === 'dm:message-deleted' ||
    eventName === 'dm:conversation-deleted' ||
    eventName === 'dm:typing' ||
    eventName === 'dm:read'
  ) {
    dependencies.handleIncomingDmEvent?.(payload, eventName);
    return;
  }

  const hash = window.location.hash || '#home';
  if (eventName === 'moderation:event') {
    if (hash.startsWith('#admin') && dependencies.loadAdmin) {
      scheduleRefresh(() => dependencies.loadAdmin());
    }
    return;
  }
  if (hash.startsWith('#home') || hash === '') {
    if (shouldRefreshHome(eventName)) {
      scheduleRefresh(() => dependencies.loadHome());
    }
  } else if (hash.startsWith('#thread/')) {
    if (!dependencies.audioWorkInProgress() && shouldRefreshThread(eventName, payload)) {
      scheduleRefresh(() => dependencies.loadThread({ preserveScroll: true }));
    }
  } else if (hash.startsWith('#catalog/')) {
    if (shouldRefreshBoard(eventName, payload)) {
      scheduleRefresh(() => dependencies.loadCatalog());
    }
  } else if (hash.startsWith('#archive/')) {
    if (eventName === 'thread:archived' && shouldRefreshBoard(eventName, payload)) {
      scheduleRefresh(() => dependencies.loadArchive());
    }
  } else if (hash.startsWith('#board/')) {
    if (shouldRefreshBoard(eventName, payload)) {
      scheduleRefresh(() => dependencies.loadBoard());
    }
  }
}

function connectRealtime(force = false) {
  const accountToken = String(state.accountToken || '');
  const adminToken = String(state.token || '');
  const existing = state.realtimeSource as Socket | null;
  if (
    !force &&
    existing &&
    accountToken === activeAccountToken &&
    adminToken === activeAdminToken
  ) {
    emitCurrentScope(existing);
    return;
  }
  existing?.close();
  if (pendingRefreshTimer != null) {
    window.clearTimeout(pendingRefreshTimer);
    pendingRefreshTimer = null;
    pendingRefresh = null;
  }

  activeAccountToken = accountToken;
  activeAdminToken = adminToken;
  state.realtimeContextKey = 'socket.io';
  const source = io(SOCKET_IO_URL || undefined, {
    path: SOCKET_IO_PATH,
    auth: { accountToken, adminToken },
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
    timeout: 10_000
  });
  state.realtimeSource = source;
  source.on('connect', () => {
    setRealtimeStatus(true);
    emitCurrentScope(source);
  });
  source.on('disconnect', () => setRealtimeStatus(false));
  source.on('connect_error', () => setRealtimeStatus(false));
  for (const eventName of realtimeEventNames) {
    source.on(eventName, (payload) => handleRealtimeEvent(eventName, payload));
  }
}

export function setupRealtime(dependencies: AnyRecord) {
  realtimeDependencies = dependencies;
  if (!authListenerInstalled) {
    authListenerInstalled = true;
    window.addEventListener('36chan:auth-changed', () => connectRealtime(true));
  }
  connectRealtime();
}

export function emitRealtime(
  eventName: string,
  payload: AnyRecord,
  { timeoutMs = 5_000 }: { timeoutMs?: number } = {}
): Promise<unknown> {
  const source = state.realtimeSource as Socket | null;
  if (!source?.connected) {
    return Promise.reject(Object.assign(
      new Error('Realtime chưa kết nối'),
      { code: 'SOCKET_DISCONNECTED' }
    ));
  }
  return new Promise((resolve, reject) => {
    source.timeout(timeoutMs).emit(
      eventName,
      payload,
      (timeoutError: Error | null, response?: RealtimeAcknowledgement) => {
        if (timeoutError) {
          reject(timeoutError);
          return;
        }
        if (!response?.ok) {
          const error = new Error(response?.error || 'Realtime request failed');
          Object.assign(error, {
            statusCode: response?.statusCode,
            retryAfterMs: response?.retryAfterMs
          });
          reject(error);
          return;
        }
        resolve(response.data);
      }
    );
  });
}
