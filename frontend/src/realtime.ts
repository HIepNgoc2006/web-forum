import { els } from './dom';
import { realtimeEndpoint } from './format';
import { state } from './state';

import type { AnyRecord } from './types';

const realtimeEventNames = [
  'thread:created',
  'thread:bumped',
  'thread:updated',
  'comment:created',
  'comment:updated',
  'thread:archived',
  'dm:message'
];

function parseRealtimePayload(event: MessageEvent | Event) {
  try {
    const payload = JSON.parse((event as MessageEvent)?.data || '{}');
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return {};
  }
}

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

export function setupRealtime(dependencies: AnyRecord) {
  const context = new URLSearchParams();
  if ((window.location.hash || '').startsWith('#board/') || (window.location.hash || '').startsWith('#thread/')) {
    context.set('boardSlug', state.boardSlug);
  }
  if ((window.location.hash || '').startsWith('#thread/') && state.threadId) {
    context.set('threadId', state.threadId);
  }
  const contextKey = context.toString();
  if (state.realtimeSource && state.realtimeContextKey === contextKey) {
    return;
  }
  if (state.realtimeSource) {
    state.realtimeSource.close();
  }
  if (pendingRefreshTimer != null) {
    window.clearTimeout(pendingRefreshTimer);
    pendingRefreshTimer = null;
    pendingRefresh = null;
  }
  state.realtimeContextKey = contextKey;
  const source = new EventSource(realtimeEndpoint(contextKey));
  state.realtimeSource = source;
  source.addEventListener('connected', () => {
    els.socketStatus.textContent = 'trực tiếp';
    els.socketStatus.classList.add('live');
    els.socketStatus.classList.remove('offline');
  });
  source.onerror = () => {
    els.socketStatus.textContent = 'mất kết nối';
    els.socketStatus.classList.add('offline');
    els.socketStatus.classList.remove('live');
  };
  for (const eventName of realtimeEventNames) {
    source.addEventListener(eventName, (event) => {
      const payload = parseRealtimePayload(event);
      if (eventName === 'comment:created') {
        dependencies.notifyWatchedThreadPost(payload);
      }
      if (eventName === 'dm:message') {
        dependencies.handleIncomingDmEvent?.(payload);
        return;
      }
      const hash = window.location.hash || '#home';
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
    });
  }
}
