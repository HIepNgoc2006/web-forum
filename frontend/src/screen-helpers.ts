import type { AnyRecord } from './types';
import { boardRulesForDisplay, normalizeBoardSort, normalizeBoardFilter, normalizeBoardThreadsPayload } from './board';
import { normalizeSearchValue } from './format';

export function createScreenHelpers(dependencies: AnyRecord) {
  const {
    state,
    els,
    homeController,
    stopAutoUpdateTimer,
    closeThreadComposer = () => {},
    showToast = () => {},
    readWatchedThreads,
    writeWatchedThreads,
    watchedThreadEntryFromDetail,
    threadToolbarHtml,
    boardThreadsCachePrefix
  } = dependencies;

  const safeReadWatchedThreads = readWatchedThreads || (() => ({}));
  const safeWriteWatchedThreads = writeWatchedThreads || (() => {});
  const safeWatchedThreadEntryFromDetail = watchedThreadEntryFromDetail || (() => ({}));
  const safeThreadToolbarHtml = threadToolbarHtml || (() => '');

  function setScreen(name: string) {
    if (name !== 'thread') {
      stopAutoUpdateTimer();
    }
    for (const screen of [
      els.homeScreen,
      els.policyScreen,
      els.boardScreen,
      els.catalogScreen,
      els.archiveScreen,
      els.threadScreen,
      els.registerScreen,
      els.loginScreen,
      els.forgotScreen,
      els.accountScreen,
      els.adminScreen
    ]) {
      screen.classList.remove('active');
    }
    document.body.classList.toggle('home-page', name === 'home');
    document.body.classList.toggle('policy-page', name === 'policy');
    document.body.classList.toggle('account-page', ['register', 'login', 'forgot', 'account'].includes(name));
    document.body.classList.toggle(
      'board-page',
      name === 'board' || name === 'catalog' || name === 'archive' || name === 'thread'
    );
    if (name === 'home') {
      els.homeScreen.classList.add('active');
    } else if (name === 'policy') {
      els.policyScreen.classList.add('active');
    } else if (name === 'catalog') {
      els.catalogScreen.classList.add('active');
    } else if (name === 'archive') {
      els.archiveScreen.classList.add('active');
    } else if (name === 'thread') {
      els.threadScreen.classList.add('active');
    } else if (name === 'register') {
      els.registerScreen.classList.add('active');
    } else if (name === 'login') {
      els.loginScreen.classList.add('active');
    } else if (name === 'forgot') {
      els.forgotScreen.classList.add('active');
    } else if (name === 'account') {
      els.accountScreen.classList.add('active');
    } else if (name === 'admin') {
      els.adminScreen.classList.add('active');
    } else {
      els.boardScreen.classList.add('active');
    }
  }

  function currentBoard() {
    return state.boards.find((board) => board.slug === state.boardSlug) || null;
  }

  function renderMissingBoard(screen = 'board') {
    const slug = state.boardSlug || 'unknown';
    setScreen(screen);
    homeController.renderBoards();
    updateBoardPresentation(null);
    if (screen === 'catalog') {
      els.catalogTitle.textContent = 'Không tìm thấy bảng';
      els.catalogDescription.textContent = `Không có bảng /${slug}/.`;
      els.catalogReturnTop.href = '#home';
      els.catalogReturnBottom.href = '#home';
      els.catalogGrid.innerHTML = '<p class="muted">Hãy chọn một bảng khác từ thanh điều hướng.</p>';
      return;
    }
    els.boardTitle.textContent = 'Không tìm thấy bảng';
    els.boardPath.textContent = `/${slug}/`;
    els.boardDescription.textContent = 'Bảng này không tồn tại hoặc đã bị ẩn.';
    els.boardCatalogLink.href = '#home';
    els.boardArchiveLink.href = '#home';
    els.boardCatalogLinkBottom.href = '#home';
    els.boardArchiveLinkBottom.href = '#home';
    els.boardJsonFeedLink.href = '#home';
    els.boardRssFeedLink.href = '#home';
    els.boardJsonFeedLinkBottom.href = '#home';
    els.boardRssFeedLinkBottom.href = '#home';
    els.boardSummary.classList.add('hidden');
    els.threadList.innerHTML = '<p class="muted">Hãy chọn một bảng khác từ thanh điều hướng.</p>';
    els.boardPagination.innerHTML = '';
    closeThreadComposer();
  }

  function boardThreadsCacheKey({
    boardSlug = state.boardSlug,
    page = state.boardPage,
    pageSize = state.boardPageSize,
    q = state.boardSearchTerm,
    sort = state.boardSort,
    filter = state.boardFilter
  }: AnyRecord = {}) {
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const safePageSize = Math.max(1, Math.floor(Number(pageSize) || state.boardPageSize));
    return [
      boardSlug,
      safePage,
      safePageSize,
      normalizeSearchValue(q),
      normalizeBoardSort(sort),
      normalizeBoardFilter(filter)
    ].join('|');
  }

  function firstBoardPageFromThreads(
    threads: Array<AnyRecord> = [],
    { page = 1, pageSize = state.boardPageSize }: AnyRecord = {}
  ) {
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const safePageSize = Math.max(1, Math.floor(Number(pageSize) || state.boardPageSize));
    const offset = (safePage - 1) * safePageSize;
    const total = threads.length;
    return {
      items: threads.slice(offset, offset + safePageSize),
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
      hasMore: offset + safePageSize < total
    };
  }

  function writeBoardThreadsCache(boardSlug, payload, options: AnyRecord = {}) {
    const { threads, meta } = normalizeBoardThreadsPayload(payload);
    const pagePayload = meta || firstBoardPageFromThreads(threads, options);
    const entry = {
      threads: meta ? threads : pagePayload.items,
      meta: pagePayload,
      cachedAt: Date.now()
    };
    const key = boardThreadsCacheKey({
      boardSlug,
      page: pagePayload.page,
      pageSize: pagePayload.pageSize,
      q: options.q || '',
      sort: options.sort || state.boardSort,
      filter: options.filter || state.boardFilter
    });
    state.boardThreadsCache.set(key, entry);
    try {
      sessionStorage.setItem(`${boardThreadsCachePrefix}${key}`, JSON.stringify(entry));
    } catch {
      /* ignore storage limits */
    }
    return entry;
  }

  function readBoardThreadsCache(options: AnyRecord = {}) {
    const key = boardThreadsCacheKey(options);
    const memoryEntry = state.boardThreadsCache.get(key);
    if (memoryEntry) {
      return memoryEntry;
    }
    try {
      const parsed = JSON.parse(sessionStorage.getItem(`${boardThreadsCachePrefix}${key}`) || '');
      if (parsed && Array.isArray(parsed.threads) && (!parsed.meta || typeof parsed.meta === 'object')) {
        state.boardThreadsCache.set(key, parsed);
        return parsed;
      }
    } catch {
      /* ignore stale cache */
    }
    return null;
  }

  function updateBoardPresentation(board: AnyRecord = null) {
    const label = board?.name?.toLowerCase() || '36chan';
    const rules = boardRulesForDisplay(board);
    document.querySelectorAll('[data-board-rules]').forEach((section) => {
      const list = section.querySelector('[data-board-rules-list]');
      if (!list) {
        return;
      }
      list.replaceChildren(...rules.map((rule) => {
        const item = document.createElement('li');
        item.textContent = rule;
        return item;
      }));
      section.classList.toggle('hidden', rules.length === 0);
    });
    document.querySelectorAll('[data-board-banner]').forEach((ad) => {
      const text = ad.querySelector('[data-board-banner-text]');
      const image = ad.querySelector('[data-board-banner-image]');
      if (text) {
        text.textContent = board?.banner?.text || `Bảng ${label} sinh viên`;
      }
      if (image) {
        if (board?.banner?.imageUrl) {
          image.src = board.banner.imageUrl;
          image.alt = board.banner.altText || board.banner.text || board.name || '';
          image.classList.remove('hidden');
        } else {
          image.removeAttribute('src');
          image.alt = '';
          image.classList.add('hidden');
        }
      }
    });
  }

  function toggleCurrentThreadWatch() {
    if (!state.threadDetail?.thread?.id) {
      return;
    }
    const watchedThreads = safeReadWatchedThreads();
    const threadId = state.threadDetail.thread.id;
    if (watchedThreads[threadId]) {
      delete watchedThreads[threadId];
      safeWriteWatchedThreads(watchedThreads);
      showToast('Đã bỏ theo dõi chủ đề.');
    } else {
      watchedThreads[threadId] = safeWatchedThreadEntryFromDetail(state.threadDetail, {}, { markSeen: true });
      safeWriteWatchedThreads(watchedThreads);
      showToast('Đã theo dõi chủ đề.');
    }
    if (state.threadId) {
      // Guarded because some callers may invoke while thread headers are not yet mounted.
      els.threadToolbarTop.innerHTML = safeThreadToolbarHtml(state.threadDetail, 'top');
      els.threadToolbarBottom.innerHTML = safeThreadToolbarHtml(state.threadDetail, 'bottom');
    }
  }

  function pageControlsHtml(meta, actionName) {
    if (!meta || Number(meta.totalPages || 1) <= 1) {
      return '';
    }
    const page = Number(meta.page || 1);
    const totalPages = Number(meta.totalPages || 1);
    return `
      <span>Trang ${page}/${totalPages}</span>
      [<button class="link-button" data-page-action="${actionName}" data-page="${page - 1}" type="button" ${
        page <= 1 ? 'disabled' : ''
      }>Trước</button>]
      [<button class="link-button" data-page-action="${actionName}" data-page="${page + 1}" type="button" ${
        page >= totalPages ? 'disabled' : ''
      }>Sau</button>]
      <span>${Number(meta.total || 0).toLocaleString()} mục</span>
    `;
  }

  return {
    setScreen,
    currentBoard,
    renderMissingBoard,
    boardThreadsCacheKey,
    firstBoardPageFromThreads,
    writeBoardThreadsCache,
    readBoardThreadsCache,
    updateBoardPresentation,
    toggleCurrentThreadWatch,
    pageControlsHtml
  };
}



