import { escapeHtml } from './format';
import type { AnyRecord } from './types';

export function threadSearchHtml(detail: AnyRecord = {}, threadSearchTerm = ''): string {
  const term = threadSearchTerm;
  const total = Number(detail.commentPage?.total ?? 0);
  const status = term
    ? `${total.toLocaleString()} phản hồi khớp trong thread`
    : 'Tìm theo nội dung, số bài hoặc ID poster';
  return `
    <form class="thread-search" id="threadSearchForm">
      <label>
        <span>Tìm trong thread</span>
        <input id="threadSearchInput" name="q" value="${escapeHtml(term)}" placeholder="từ khóa, No. hoặc ID" autocomplete="off">
      </label>
      <button class="ghost-button" type="submit">[Tìm]</button>
      ${
        term
          ? '<button class="link-button" data-clear-thread-search type="button">[Xóa]</button>'
          : ''
      }
      <span class="thread-search-status">${escapeHtml(status)}</span>
    </form>
  `;
}

export function bindThreadSearchEvents({ body = document.body, state, loadThread, normalizeThreadSearchTerm, showToast }: AnyRecord) {
  body.addEventListener('submit', (event) => {
    const threadSearchForm = event.target.closest('#threadSearchForm');
    if (!threadSearchForm) {
      return;
    }
    event.preventDefault();
    state.threadSearchTerm = normalizeThreadSearchTerm(String(new FormData(threadSearchForm).get('q') || ''));
    state.threadCommentPage = 1;
    loadThread().catch((error) => showToast(error.message));
  });

  body.addEventListener('click', async (event) => {
    const clearThreadSearchButton = event.target.closest('[data-clear-thread-search]');
    if (!clearThreadSearchButton) {
      return;
    }
    state.threadSearchTerm = '';
    state.threadCommentPage = 1;
    await loadThread().catch((error) => showToast(error.message));
  });
}