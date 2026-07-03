import { els } from './dom';
import { realtimeEndpoint } from './format';
import { state } from './state';

import type { AnyRecord } from './types';

const realtimeEventNames = ['thread:created', 'thread:bumped', 'thread:updated', 'comment:created', 'comment:updated', 'thread:archived'];

function parseRealtimePayload(event) {
  try {
    const payload = JSON.parse(event?.data || '{}');
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return {};
  }
}

function handleRealtimeRefreshError(error) {
  console.warn('Không cập nhật được màn hình từ realtime:', error);
  els.socketStatus.textContent = 'cần cập nhật';
  els.socketStatus.classList.add('offline');
  els.socketStatus.classList.remove('live');
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
      if (eventName === 'comment:created') {
        dependencies.notifyWatchedThreadPost(parseRealtimePayload(event));
      }
      const hash = window.location.hash || '#home';
      let refresh = null;
      if (hash.startsWith('#home') || hash === '') {
        refresh = dependencies.loadHome();
      } else if (hash.startsWith('#thread/')) {
        if (!dependencies.audioWorkInProgress()) {
          refresh = dependencies.loadThread();
        }
      } else if (hash.startsWith('#catalog/')) {
        refresh = dependencies.loadCatalog();
      } else if (hash.startsWith('#archive/')) {
        if (eventName === 'thread:archived') {
          refresh = dependencies.loadArchive();
        }
      } else if (hash.startsWith('#board/')) {
        refresh = dependencies.loadBoard();
      }
      if (refresh) {
        refresh.catch(handleRealtimeRefreshError);
      }
    });
  }
}
