import { api } from './api';
import { watchedThreadsKey } from './constants';
import { els } from './dom';
import { escapeHtml, plainPreview } from './format';
import { state } from './state';
import {
  firstUnreadPostNumber,
  maxThreadPostNumber,
  postMediaCount,
  watchedThreadHref
} from './thread';
import type { AnyRecord } from './types';
import {
  localDisplayPreferences,
  writeThreadLastSeen
} from './storage';

function persistWatchedThreads(watchedThreads, { scheduleAccountPrivateDataSave }: AnyRecord = {}) {
  localStorage.setItem(watchedThreadsKey, JSON.stringify(watchedThreads));
  if (state.accountToken && state.accountPrivateData) {
    state.accountPrivateData.watchlist = Object.values(watchedThreads as AnyRecord).filter((item) => item?.threadId);
    scheduleAccountPrivateDataSave?.();
  }
}

export function readWatchedThreads() {
  if (state.accountToken && state.accountPrivateData) {
    return Object.fromEntries((state.accountPrivateData.watchlist || []).map((item) => [item.threadId, item]));
  }
  try {
    const parsed: AnyRecord = JSON.parse(localStorage.getItem(watchedThreadsKey) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(([threadId, item]) => threadId && item && typeof item === 'object')
    );
  } catch {
    return {};
  }
}

export function writeWatchedThreads(watchedThreads, dependencies: AnyRecord = {}) {
  persistWatchedThreads(watchedThreads, dependencies);
}

export function isThreadWatched(threadId = state.threadId) {
  return Boolean(threadId && readWatchedThreads()[threadId]);
}

export function syncWatchedControls({
  unreadOnly = localDisplayPreferences().watchedUnreadOnly,
  unreadCount = state.watchedThreadSummaries.filter((item) => Number(item.unreadCount || 0) > 0).length
}: AnyRecord = {}) {
  if (!els?.watchedUnreadToggle && !els?.watchedMarkAllRead && !els?.watchedSortSelect) {
    return;
  }
  if (els.watchedSortSelect) {
    els.watchedSortSelect.value = localDisplayPreferences().watchedSort;
  }
  if (els.watchedUnreadToggle) {
    els.watchedUnreadToggle.textContent = unreadCount ? `chưa đọc ${unreadCount}` : 'chưa đọc';
    els.watchedUnreadToggle.classList.toggle('active', unreadOnly);
    els.watchedUnreadToggle.setAttribute('aria-pressed', String(unreadOnly));
  }
  if (els.watchedMarkAllRead) {
    els.watchedMarkAllRead.disabled = unreadCount === 0;
    els.watchedMarkAllRead.title = unreadCount
      ? `Đánh dấu ${unreadCount} chủ đề là đã đọc`
      : 'Không có chủ đề chưa đọc';
  }
}

export function watchedThreadEntryFromDetail(detail, existing: AnyRecord = {}, { markSeen = false }: AnyRecord = {}) {
  const board = state.boards.find((item) => item.slug === detail.thread.boardSlug);
  const posts = [detail.thread, ...(detail.comments || [])];
  const currentMaxNumber = detail.commentPage?.currentMaxGlobalNumber || maxThreadPostNumber(detail);
  const fileCount = posts.reduce((total, post) => total + postMediaCount(post), 0);
  return {
    threadId: detail.thread.id,
    boardSlug: detail.thread.boardSlug,
    boardPath: board?.path || `/${detail.thread.boardSlug}/`,
    boardName: board?.name || detail.thread.boardSlug,
    globalNumber: detail.thread.globalNumber,
    preview: plainPreview(detail.thread.bodyLines, 'Không có nội dung').slice(0, 180),
    lastSeen: markSeen ? currentMaxNumber : Number(existing.lastSeen || 0),
    maxNumber: currentMaxNumber,
    replyCount: detail.thread.replyCount ?? detail.comments.length,
    fileCount: Math.max(Number(existing.fileCount || 0), fileCount),
    isArchived: Boolean(detail.thread.isArchived),
    updatedAt: detail.thread.bumpedAt || detail.thread.createdAt || new Date().toISOString()
  };
}

export function syncWatchedThreadFromDetail(detail, dependencies: AnyRecord = {}) {
  if (!isThreadWatched(detail.thread.id)) {
    return;
  }
  const watchedThreads = readWatchedThreads();
  watchedThreads[detail.thread.id] = watchedThreadEntryFromDetail(detail, watchedThreads[detail.thread.id], {
    markSeen: true
  });
  writeWatchedThreads(watchedThreads, dependencies);
}

export function removeWatchedThread(threadId, dependencies: AnyRecord = {}) {
  const watchedThreads = readWatchedThreads();
  delete watchedThreads[threadId];
  writeWatchedThreads(watchedThreads, dependencies);
}

export function sortWatchedThreads(left, right, sort = localDisplayPreferences().watchedSort) {
  const unavailableCompare = Number(Boolean(left.unavailable)) - Number(Boolean(right.unavailable));
  if (unavailableCompare !== 0) {
    return unavailableCompare;
  }
  if (sort === 'board') {
    const boardCompare = String(left.boardSlug || '').localeCompare(String(right.boardSlug || ''));
    if (boardCompare !== 0) {
      return boardCompare;
    }
    return Number(left.globalNumber || 0) - Number(right.globalNumber || 0);
  }
  if (sort === 'recent') {
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
  }
  const unreadDelta = Number(right.unreadCount || 0) - Number(left.unreadCount || 0);
  if (unreadDelta !== 0) {
    return unreadDelta;
  }
  return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
}

export function visibleWatchedThreadSummaries(watchedThreads = state.watchedThreadSummaries, { isPostFiltered }: AnyRecord) {
  const preferences = localDisplayPreferences();
  return watchedThreads
    .filter(
      (item) =>
        !isPostFiltered({
          ...item,
          id: item.threadId,
          body: item.preview,
          globalNumber: item.globalNumber
        })
    )
    .sort((left, right) => sortWatchedThreads(left, right, preferences.watchedSort));
}

export async function loadWatchedThreadSummaries(dependencies: AnyRecord) {
  const watchedEntries = Object.values(readWatchedThreads());
  if (!watchedEntries.length) {
    state.watchedThreadSummaries = [];
    syncWatchedControls({ unreadCount: 0 });
    return [];
  }

  const results = await Promise.all(
    watchedEntries.map(async (entry) => {
      try {
        const detail = await api(`/api/threads/${encodeURIComponent(entry.threadId)}`);
        const posts = [detail.thread, ...(detail.comments || [])];
        const unreadCount = posts.filter((post) => Number(post.globalNumber) > Number(entry.lastSeen || 0)).length;
        return {
          ...watchedThreadEntryFromDetail(detail, entry),
          unreadCount,
          firstUnreadNumber: firstUnreadPostNumber(posts, entry.lastSeen),
          unavailable: false
        };
      } catch {
        return {
          ...entry,
          unreadCount: 0,
          unavailable: true
        };
      }
    })
  );

  const watchedThreads = readWatchedThreads();
  results.forEach((item) => {
    if (!item.unavailable) {
      watchedThreads[item.threadId] = {
        threadId: item.threadId,
        boardSlug: item.boardSlug,
        boardPath: item.boardPath,
        boardName: item.boardName,
        globalNumber: item.globalNumber,
        preview: item.preview,
        lastSeen: item.lastSeen,
        maxNumber: item.maxNumber,
        replyCount: item.replyCount,
        fileCount: item.fileCount,
        isArchived: item.isArchived,
        updatedAt: item.updatedAt
      };
    }
  });
  writeWatchedThreads(watchedThreads, dependencies);
  state.watchedThreadSummaries = visibleWatchedThreadSummaries(results, dependencies);
  return state.watchedThreadSummaries;
}

export function markWatchedThreadRead(threadId, dependencies: AnyRecord = {}) {
  if (!threadId) {
    return false;
  }
  const watchedThreads = readWatchedThreads();
  const watched = watchedThreads[threadId];
  if (!watched) {
    return false;
  }

  const summary = state.watchedThreadSummaries.find((item) => item.threadId === threadId);
  const maxNumber = Math.max(
    Number(watched.maxNumber || 0),
    Number(watched.lastSeen || 0),
    Number(summary?.maxNumber || 0)
  );
  watchedThreads[threadId] = {
    ...watched,
    maxNumber,
    lastSeen: maxNumber
  };
  writeWatchedThreads(watchedThreads, dependencies);
  writeThreadLastSeen(threadId, maxNumber);
  state.watchedThreadSummaries = state.watchedThreadSummaries.map((item) => {
    if (item.threadId !== threadId) {
      return item;
    }
    return {
      ...item,
      lastSeen: Math.max(Number(item.maxNumber || 0), maxNumber),
      unreadCount: 0,
      firstUnreadNumber: 0
    };
  });
  return true;
}

export function markAllWatchedThreadsRead(dependencies: AnyRecord = {}) {
  const unreadThreadIds = state.watchedThreadSummaries
    .filter((item) => Number(item.unreadCount || 0) > 0 && !item.unavailable)
    .map((item) => item.threadId)
    .filter(Boolean);
  unreadThreadIds.forEach((threadId) => markWatchedThreadRead(threadId, dependencies));
  return unreadThreadIds.length;
}

export function renderWatchedThreads(watchedThreads = state.watchedThreadSummaries, dependencies: AnyRecord) {
  const allVisibleThreads = visibleWatchedThreadSummaries(watchedThreads, dependencies);
  const unreadOnly = localDisplayPreferences().watchedUnreadOnly;
  const unreadCount = allVisibleThreads.filter((item) => Number(item.unreadCount || 0) > 0).length;
  const visibleThreads = unreadOnly
    ? allVisibleThreads.filter((item) => Number(item.unreadCount || 0) > 0)
    : allVisibleThreads;
  syncWatchedControls({ unreadOnly, unreadCount });

  if (!visibleThreads.length) {
    els.watchedThreads.innerHTML = allVisibleThreads.length
      ? '<p class="latest-empty">Không có chủ đề chưa đọc trong watchlist.</p>'
      : '<p class="latest-empty">Chưa theo dõi chủ đề nào. Vào một thread và bấm [Theo dõi].</p>';
    return;
  }

  els.watchedThreads.innerHTML = visibleThreads
    .map((item) => {
      const boardLabel = item.boardPath || `/${item.boardSlug || '?'}/`;
      const preview = item.unavailable
        ? 'Chủ đề không còn truy cập được hoặc đã bị xóa.'
        : item.preview || 'Không có nội dung';
      const href = watchedThreadHref(item);
      const hasUnread = Number(item.unreadCount || 0) > 0;
      const unreadBadge = item.unreadCount
        ? `<span class="watch-unread">+${Number(item.unreadCount).toLocaleString()} mới</span>`
        : '<span class="watch-seen">đã đọc</span>';
      const stats = item.unavailable
        ? '<span class="watch-status">không khả dụng</span>'
        : `<span>${Number(item.replyCount || 0).toLocaleString()} trả lời</span><span>${Number(
            item.fileCount || 0
          ).toLocaleString()} tệp</span>`;

      return `
        <div class="watch-item ${item.unavailable ? 'watch-item-unavailable' : ''}">
          <a class="watch-thread-link" href="${href}">
            <span class="watch-board">${escapeHtml(boardLabel)}</span>
            <span class="watch-number">No.${escapeHtml(item.globalNumber || '?')}</span>
            ${unreadBadge}
            <span class="watch-preview">${escapeHtml(preview)}${preview.length >= 180 ? '...' : ''}</span>
            <span class="watch-stats">${stats}</span>
          </a>
          <span class="watch-actions">
            ${
              hasUnread
                ? `<button class="link-button watch-read" data-mark-watch-read="${escapeHtml(item.threadId)}" type="button">[Đã đọc]</button>`
                : ''
            }
            <button class="link-button watch-remove" data-unwatch-thread="${escapeHtml(item.threadId)}" type="button">[Bỏ]</button>
          </span>
        </div>
      `;
    })
    .join('');
}
