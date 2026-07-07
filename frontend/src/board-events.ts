import { findBoardByQuery } from './board';
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
