import type { AnyRecord } from './types';

export function createBoardLoadController(dependencies: AnyRecord) {
  const {
    state,
    els,
    api,
    homeController,
    setScreen,
    boardHeading,
    currentBoard,
    renderMissingBoard,
    updateBoardPresentation,
    openThreadComposer = () => {},
    closeThreadComposer = () => {},
    boardThreadsCacheKey,
    readBoardThreadsCache,
    writeBoardThreadsCache,
    renderBoardThreads,
    renderCatalogThreads,
    renderArchiveThreads
  } = dependencies;

  async function loadCatalog() {
    const board = currentBoard();
    if (!board) {
      renderMissingBoard('catalog');
      return;
    }
    setScreen('catalog');
    homeController.renderBoards();
    els.catalogTitle.textContent = `${board.path} - ${board.name}`;
    if (els.catalogSubtitle) {
      els.catalogSubtitle.textContent = 'Danh mục';
      els.catalogSubtitle.classList.remove('hidden');
    }
    els.catalogDescription.textContent = board.description;
    els.catalogReturnTop.href = `#board/${board.slug}`;
    els.catalogReturnBottom.href = `#board/${board.slug}`;
    els.catalogSearchInput.value = '';
    const threads = await api(`/api/boards/${board.slug}/threads`);
    writeBoardThreadsCache(board.slug, threads, { page: 1, pageSize: state.boardPageSize });
    state.catalogThreads = threads;
    if (!threads.length) {
      els.catalogGrid.innerHTML = '<p class="muted">Chưa có chủ đề công khai.</p>';
      return;
    }
    renderCatalogThreads(threads);
  }

  async function loadArchive() {
    const board = state.boards.find((item) => item.slug === state.boardSlug);
    setScreen('archive');
    homeController.renderBoards();
    if (!board) {
      els.archiveTitle.textContent = 'Không tìm thấy bảng';
      if (els.archiveSubtitle) {
        els.archiveSubtitle.textContent = '';
        els.archiveSubtitle.classList.add('hidden');
      }
      els.archiveDescription.textContent = `Bảng /${state.boardSlug}/ không tồn tại.`;
      els.archiveReturnTop.href = '#home';
      els.archiveReturnBottom.href = '#home';
      els.archiveList.innerHTML = '<p class="muted">Không có kho lưu trữ để hiển thị.</p>';
      return;
    }
    updateBoardPresentation(board);
    els.archiveTitle.textContent = `${board.path} - ${board.name}`;
    if (els.archiveSubtitle) {
      els.archiveSubtitle.textContent = 'Kho lưu trữ';
      els.archiveSubtitle.classList.remove('hidden');
    }
    els.archiveDescription.textContent = board.description;
    els.archiveReturnTop.href = `#board/${board.slug}`;
    els.archiveReturnBottom.href = `#board/${board.slug}`;
    if (board.retentionPolicy?.publicArchive === false) {
      els.archiveList.innerHTML = '<p class="muted">Kho lưu trữ không công khai.</p>';
      return;
    }
    const threads = await api(`/api/boards/${board.slug}/archive`);
    state.archiveThreads = threads;
    renderArchiveThreads(threads);
  }

  async function loadBoard() {
    const board = currentBoard();
    if (!board) {
      renderMissingBoard('board');
      return;
    }
    setScreen('board');
    homeController.renderBoards();
    homeController.syncBoardSubscriptionButtons();
    homeController.syncBoardHiddenButtons?.();
    updateBoardPresentation(board);
    els.boardTitle.textContent = boardHeading(board);
    els.boardPath.textContent = board.path;
    els.boardDescription.textContent = board.description;
    els.boardCatalogLink.href = `#catalog/${board.slug}`;
    els.boardArchiveLink.href = `#archive/${board.slug}`;
    els.boardJsonFeedLink.href = `/feeds/boards/${board.slug}/threads.json`;
    els.boardRssFeedLink.href = `/feeds/boards/${board.slug}/threads.rss`;
    els.boardCatalogLinkBottom.href = `#catalog/${board.slug}`;
    els.boardArchiveLinkBottom.href = `#archive/${board.slug}`;
    els.boardJsonFeedLinkBottom.href = `/feeds/boards/${board.slug}/threads.json`;
    els.boardRssFeedLinkBottom.href = `/feeds/boards/${board.slug}/threads.rss`;
    const publicArchive = board.retentionPolicy?.publicArchive !== false;
    els.boardArchiveLink.classList.toggle('hidden', !publicArchive);
    els.boardArchiveLinkBottom.classList.toggle('hidden', !publicArchive);
    els.boardSearchInput.value = state.boardSearchTerm;
    els.boardSummary.classList.add('hidden');
    const shouldOpenComposer = new URLSearchParams(window.location.hash.split('?')[1] || '').get('new') === '1';
    if (shouldOpenComposer) {
      openThreadComposer({ focus: true });
    } else {
      closeThreadComposer();
    }
    const cacheOptions = {
      boardSlug: board.slug,
      page: state.boardPage,
      pageSize: state.boardPageSize,
      q: state.boardSearchTerm,
      sort: state.boardSort,
      filter: state.boardFilter
    };
    const requestKey = boardThreadsCacheKey(cacheOptions);
    const cached = readBoardThreadsCache(cacheOptions);
    if (cached) {
      state.boardThreads = cached.threads;
      state.boardPageMeta = cached.meta;
      renderBoardThreads(cached.threads);
    } else {
      state.boardThreads = [];
      state.boardPageMeta = null;
      els.threadList.innerHTML = '<p class="muted">Đang tải chủ đề...</p>';
      els.boardPagination.innerHTML = '';
    }
    const query = new URLSearchParams({
      page: String(state.boardPage),
      pageSize: String(state.boardPageSize),
      sort: state.boardSort
    });
    if (state.boardFilter !== 'all') {
      query.set('filter', state.boardFilter);
    }
    if (state.boardSearchTerm.trim()) {
      query.set('q', state.boardSearchTerm.trim());
    }
    const payload = await api(`/api/boards/${board.slug}/threads?${query.toString()}`);
    const entry = writeBoardThreadsCache(board.slug, payload, cacheOptions);
    const stillOnBoard =
      (window.location.hash || '').startsWith('#board/') &&
      state.boardSlug === board.slug &&
      boardThreadsCacheKey(cacheOptions) === requestKey;
    if (!stillOnBoard) {
      return;
    }
    state.boardThreads = entry.threads;
    state.boardPageMeta = entry.meta;
    renderBoardThreads(entry.threads);
  }

  return {
    loadCatalog,
    loadArchive,
    loadBoard
  };
}
