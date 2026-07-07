import { findBoardByQuery, normalizeBoardFilter, normalizeBoardSort } from './board';
import { normalizeCatalogSort } from './catalog';
import type { AnyRecord } from './types';

export function bindBoardNavigationEvents({
  els,
  state,
  showToast,
  loadBoard,
  saveCurrentBoardSearch,
  renderCatalogThreads,
  openThreadComposer,
  openReplyComposer
}: AnyRecord) {
  els.homeBoardSearchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const board = findBoardByQuery(els.homeBoardSearchInput.value, state.boards);
    if (!board) {
      showToast('Không tìm thấy bảng phù hợp.');
      return;
    }
    window.location.hash = `#board/${board.slug}`;
  });
  els.refreshThreads.addEventListener('click', () => loadBoard().catch((error) => showToast(error.message)));
  els.saveBoardSearchButton.addEventListener('click', saveCurrentBoardSearch);
  els.boardSearchInput.addEventListener('input', () => {
    state.boardSearchTerm = els.boardSearchInput.value;
    state.boardPage = 1;
    window.clearTimeout(els.boardSearchInput.searchTimer);
    els.boardSearchInput.searchTimer = window.setTimeout(() => loadBoard().catch((error) => showToast(error.message)), 250);
  });
  els.catalogSearchInput.addEventListener('input', () => renderCatalogThreads(state.catalogThreads));
  els.startThreadButton.addEventListener('click', () => openThreadComposer());
  els.postReplyToggle.addEventListener('click', () => openReplyComposer());
  els.threadStartThreadButton.addEventListener('click', () => {
    window.location.hash = `#board/${state.boardSlug}?new=1`;
  });
  els.backToBoard.addEventListener('click', () => {
    window.location.hash = `#board/${state.boardSlug}`;
  });
}

export function handleBoardCatalogControlClick(
  event,
  {
    state,
    showToast,
    loadBoard,
    loadCatalog,
    loadArchive,
    renderCatalogThreads,
    toggleBoardSubscription,
    syncBoardSubscriptionButtons
  }: AnyRecord
) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }

  const boardSubscriptionButton = target.closest('[data-toggle-board-subscription]');
  if (boardSubscriptionButton) {
    return (async () => {
      await toggleBoardSubscription();
      syncBoardSubscriptionButtons();
    })();
  }

  const catalogRefreshButton = target.closest('[data-catalog-refresh]');
  if (catalogRefreshButton) {
    return loadCatalog().catch((error) => showToast(error.message));
  }

  const catalogSortButton = target.closest('[data-catalog-sort]');
  if (catalogSortButton) {
    state.catalogSort = normalizeCatalogSort(catalogSortButton.dataset.catalogSort);
    renderCatalogThreads(state.catalogThreads);
    return Promise.resolve();
  }

  const boardSortButton = target.closest('[data-board-sort]');
  if (boardSortButton) {
    state.boardSort = normalizeBoardSort(boardSortButton.dataset.boardSort);
    state.boardPage = 1;
    return loadBoard().catch((error) => showToast(error.message));
  }

  const boardFilterButton = target.closest('[data-board-filter]');
  if (boardFilterButton) {
    state.boardFilter = normalizeBoardFilter(boardFilterButton.dataset.boardFilter);
    state.boardPage = 1;
    return loadBoard().catch((error) => showToast(error.message));
  }

  const catalogFilterButton = target.closest('[data-catalog-filter]');
  if (catalogFilterButton) {
    state.catalogFilter = catalogFilterButton.dataset.catalogFilter;
    renderCatalogThreads(state.catalogThreads);
    return Promise.resolve();
  }

  const catalogSizeButton = target.closest('[data-catalog-size]');
  if (catalogSizeButton) {
    state.catalogImageSize = catalogSizeButton.dataset.catalogSize;
    renderCatalogThreads(state.catalogThreads);
    return Promise.resolve();
  }

  const archiveRefreshButton = target.closest('[data-archive-refresh]');
  if (archiveRefreshButton) {
    return loadArchive().catch((error) => showToast(error.message));
  }

  return null;
}
