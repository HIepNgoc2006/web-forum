import type { AnyRecord } from './types';
import {
  adminAnalyticsHtml,
  adminAnalyticsRestHtml,
  adminBoardsHtml,
  adminHealthHtml,
  adminPostEditButtonHtml,
  adminPostRestoreButtonHtml,
  adminUsersHtml,
  appealsHtml,
  compactReportsHtml,
  csvEscape,
  historyActionsHtml,
  moderationActionsHtml,
  reportsHtml,
  sanctionsHtml
} from './admin';
import { escapeHtml, formatPostDate, moderationConfidenceHtml, moderationLabelText, moderationStatusText, mediaList, mediaToggleHtml } from './format';
import { moderationPriorityHtml } from './format';
import { adminLockButtonHtml, adminStickyButtonHtml, imageHtml, postMediaCount } from './thread';

const ADMIN_LOAD_ERROR_MESSAGE = 'Chi tiết bài viết phản hồi quá lâu, vui lòng thử lại.';

type ApiCall = (input: string, options?: AnyRecord) => Promise<AnyRecord>;
type ShowToast = (message: string) => void;
type LoadAdmin = () => Promise<void>;
type ShowReasonModal = (message: string, context: string) => Promise<string | null>;

type AdminHelpersDependencies = {
  state: AnyRecord;
  els: AnyRecord;
  showToast: ShowToast;
  api: ApiCall;
  loadAdmin: LoadAdmin;
  renderPostLines: (lines: AnyRecord[], options?: AnyRecord) => string;
  showReasonModal: ShowReasonModal;
  adminLoadTimeoutMs: number;
  adminLoadTimeoutMessage?: string;
};

type AdminHelpers = {
  adminQueryString: () => string;
  adminEndpoint: () => string;
  isAdminSessionError: (error: AnyRecord) => boolean;
  isAbortError: (error: AnyRecord) => boolean;
  renderAdminTabs: () => void;
  renderAdminAnalytics: (analytics: AnyRecord) => void;
  renderAdminHealth: (data: AnyRecord) => void;
  renderAdminItems: (items: AnyRecord[]) => void;
  exportAdminCsv: () => void;
  syncAdminBoardFilter: () => void;
  adminTableDetailHost: (button: Element) => Element | null;
  selectedPendingIds: () => string[];
  bulkModerate: (action: string) => Promise<void>;
  loadAdminDetail: (globalNumber: string, host: Element, options?: AnyRecord) => Promise<void>;
  adminPostDetailHtml: (detail: AnyRecord, options?: AnyRecord) => string;
  deletedPostsHtml: (posts: AnyRecord[]) => string;
  pendingPostsHtml: (posts: AnyRecord[]) => string;
  editHistoryMediaHtml: (images?: AnyRecord[]) => string;
  editHistoryHtml: (history?: AnyRecord[]) => string;
};

export function createAdminHelpers(dependencies: AdminHelpersDependencies): AdminHelpers {
  const {
    state,
    els,
    showToast,
    api,
    loadAdmin,
    renderPostLines,
    showReasonModal,
    adminLoadTimeoutMs,
    adminLoadTimeoutMessage
  } = dependencies;

  const safeLoadAdmin = loadAdmin || (() => Promise.resolve());
  /** Invalidates stale analytics/health island mounts and vanilla fallbacks after tab or re-render. */
  let adminIslandRenderToken = 0;

  function isLiveAdminIslandHost(
    expectedTab: string,
    renderToken: number,
    host: Element | null
  ): boolean {
    if (renderToken !== adminIslandRenderToken || state.adminTab !== expectedTab || !host) {
      return false;
    }
    return host.isConnected && Boolean(els.pendingList?.contains(host));
  }

  function deletedPostsHtml(posts: AnyRecord[]) {
    if (!posts.length) {
      return '<p class="muted">Chưa có bài đã xóa.</p>';
    }
    return posts
      .map(
        (post) => `
        <article class="pending-item" data-id="${post.id}">
          <div class="post-meta">
            <span>${post.type === 'thread' ? 'chủ đề' : 'bình luận'}</span>
            <span>No.${post.globalNumber}</span>
            <span>${escapeHtml(post.boardSlug)}</span>
            <span>Xóa: ${escapeHtml(post.deleteReason || '-')}</span>
          </div>
          <div class="post-body">${renderPostLines(post.bodyLines || [])}</div>
          <div class="pending-actions">
            <button class="ghost-button" data-admin-detail="${post.globalNumber}" type="button">[Chi tiết]</button>
            <button class="ghost-button" data-admin-note="${post.globalNumber}" type="button">[Ghi chú]</button>
            ${adminPostRestoreButtonHtml(post)}
          </div>
        </article>
      `
      )
      .join('');
  }

  function pendingPostsHtml(posts: AnyRecord[]) {
    if (!posts.length) {
      return '<p class="muted">Hàng đợi trống.</p>';
    }
    return posts
      .map(
        (post) => `
        <article class="pending-item" data-id="${post.id}" data-global-number="${post.globalNumber}">
          <label class="admin-select-row">
            <input data-admin-select="${post.id}" type="checkbox" />
            <span>Chọn</span>
          </label>
          <div class="post-meta">
            <span>${post.type === 'thread' ? 'chủ đề' : 'bình luận'}</span>
            <span>No.${post.globalNumber}</span>
            <span>${escapeHtml(post.boardSlug)}</span>
            <span>AI:${escapeHtml(post.moderationLabels.map(moderationLabelText).join(', ') || moderationStatusText(post.moderationStatus))}</span>
            ${moderationPriorityHtml(post.moderationPriority)}
            ${moderationConfidenceHtml(post.moderationConfidence)}
          </div>
          <div class="post-body">${renderPostLines(post.bodyLines || [])}</div>
          <div class="pending-actions">
            <button class="ghost-button" data-admin-detail="${post.globalNumber}" type="button">[Chi tiết]</button>
            <button class="ghost-button" data-admin-note="${post.globalNumber}" type="button">[Ghi chú]</button>
            <button class="ghost-button" data-admin-sanction="cooldown" data-global-number="${post.globalNumber}" type="button">[Làm chậm]</button>
            <button class="ghost-button" data-admin-sanction="ban" data-global-number="${post.globalNumber}" type="button">[Tạm khóa]</button>
            <button class="primary-button" data-action="approve" type="button">Duyệt</button>
            <button class="danger-button" data-action="delete" type="button">Xóa</button>
          </div>
        </article>
      `
      )
      .join('');
  }

  function editHistoryMediaHtml(images: AnyRecord[] = []) {
    const media = mediaList(images);
    if (!media.length) {
      return '<p class="muted">Không có tệp.</p>';
    }
    return `<div class="post-media-gallery">${media.map((image) => mediaToggleHtml(image, 'thumb')).join('')}</div>`;
  }

  function editHistoryHtml(history: AnyRecord[] = []) {
    if (!history.length) {
      return '<p class="muted">Chưa có lịch sử chỉnh sửa.</p>';
    }
    return `
    <div class="admin-edit-history">
      ${history
        .map(
          (entry) => `
            <section class="admin-edit-history-entry">
              <div class="post-meta">
                <span>${escapeHtml(formatPostDate(entry.createdAt))}</span>
                <span>${escapeHtml(entry.actor || 'admin')}</span>
                <span>${escapeHtml(entry.reason || '-')}</span>
              </div>
              <div class="admin-edit-history-grid">
                <div>
                  <h4>Trước</h4>
                  ${editHistoryMediaHtml(entry.previousImages || [])}
                  <div class="post-body">${renderPostLines(entry.previousBodyLines || [])}</div>
                </div>
                <div>
                  <h4>Sau</h4>
                  ${editHistoryMediaHtml(entry.newImages || [])}
                  <div class="post-body">${renderPostLines(entry.newBodyLines || [])}</div>
                </div>
              </div>
            </section>
          `
        )
        .join('')}
    </div>
  `;
  }

  function adminPostDetailHtml(detail: AnyRecord, options: AnyRecord = {}) {
    const post = detail.post;
    const actions = detail.actions || [];
    const reports = detail.reports || [];
    const appeals = detail.appeals || [];
    const sanctions = detail.sanctions || [];
    const editHistory = detail.editHistory || [];
    const reportsBlock = options.compactReports ? compactReportsHtml(reports) : reportsHtml(reports);
    return `
    <div class="admin-detail">
      <div class="post-meta">
        <span>${post.type === 'thread' ? 'chủ đề' : 'bình luận'}</span>
        <span>No.${post.globalNumber}</span>
        <span>${escapeHtml(post.boardSlug)}</span>
        <span>${escapeHtml((post.moderationLabels || []).map(moderationLabelText).join(', ') || moderationStatusText(post.moderationStatus))}</span>
        ${moderationConfidenceHtml(post.moderationConfidence)}
      </div>
      ${detail.thread ? `<p class="muted">Ngữ cảnh thread: No.${detail.thread.globalNumber} · ${escapeHtml(detail.thread.boardSlug)}</p>` : ''}
      ${imageHtml(post)}
      <div class="post-body">${renderPostLines(post.bodyLines || [])}</div>
      <div class="pending-actions">
        <button class="ghost-button" data-admin-note="${post.globalNumber}" type="button">[Ghi chú]</button>
        ${
          post.isDeleted
            ? adminPostRestoreButtonHtml(post)
            : `
              ${adminPostEditButtonHtml(post, { className: 'ghost-button' })}
              ${post.type === 'thread' ? adminStickyButtonHtml(post) : ''}
              ${post.type === 'thread' ? adminLockButtonHtml(post) : ''}
              <button class="ghost-button" data-admin-sanction="cooldown" data-global-number="${post.globalNumber}" type="button">[Làm chậm]</button>
              <button class="ghost-button" data-admin-sanction="ban" data-global-number="${post.globalNumber}" type="button">[Tạm khóa]</button>
              ${postMediaCount(post) ? `<button class="ghost-button" data-admin-delete-post="${post.globalNumber}" data-file-only="true" type="button">[Xóa tệp]</button>` : ''}
              <button class="danger-button" data-admin-delete-post="${post.globalNumber}" type="button">Xóa bài</button>
            `
        }
      </div>
      <h3>Báo cáo ${reports.length ? `<button class="ghost-button" data-admin-reports-summary="${post.globalNumber}" type="button">[Tóm tắt báo cáo AI]</button>` : ''}</h3>
      <div id="adminReportsSummaryBox-${post.globalNumber}" class="admin-reports-summary-box hidden"></div>
      ${reportsBlock}
      <h3>Kháng nghị</h3>
      ${appeals.length ? appealsHtml(appeals) : '<p class="muted">Không có kháng nghị.</p>'}
      <h3>Làm chậm/Tạm khóa</h3>
      ${sanctions.length ? sanctionsHtml(sanctions) : '<p class="muted">Không có lệnh làm chậm/tạm khóa.</p>'}
      <h3>Lịch sử chỉnh sửa</h3>
      ${editHistoryHtml(editHistory)}
      <h3>Nhật ký</h3>
      ${actions.length ? moderationActionsHtml(actions) : '<p class="muted">Không có nhật ký.</p>'}
    </div>
  `;
  }

  function renderAdminAnalytics(analytics: AnyRecord) {
    renderAdminTabs();
    const expectedTab = 'analytics';
    const renderToken = ++adminIslandRenderToken;
    // Metric cards mount in React; tables + digest stay vanilla for event handlers.
    const restHtml = adminAnalyticsRestHtml(analytics, state.boards);
    els.pendingList.innerHTML = `
      <div class="analytics-dashboard">
        <div id="reactAdminAnalyticsCards" class="react-island" data-react-island="admin-analytics-cards"></div>
        ${restHtml}
      </div>
    `;
    if (els.adminSelectAll) {
      els.adminSelectAll.checked = false;
    }
    const queue = analytics?.moderationQueue || {};
    const host = document.getElementById('reactAdminAnalyticsCards');
    void import('./react/mount-admin-analytics')
      .then(({ mountAdminAnalyticsCardsIsland }) => {
        // Stale lazy resolve: do not mount into a different admin tab or superseded host.
        if (!isLiveAdminIslandHost(expectedTab, renderToken, host)) {
          return;
        }
        mountAdminAnalyticsCardsIsland({
          moderationQueue: {
            pendingCount: queue.pendingCount,
            pendingThreads: queue.pendingThreads,
            pendingComments: queue.pendingComments,
            oldestPendingAgeMinutes: queue.oldestPendingAgeMinutes,
            averageResolutionTimeMinutes: queue.averageResolutionTimeMinutes,
            resolvedCount: queue.resolvedCount
          },
          aiUsageTotal: analytics?.aiUsage?.total || 0
        });
      })
      .catch(() => {
        // Stale failure: do not overwrite another tab with analytics vanilla HTML.
        if (!isLiveAdminIslandHost(expectedTab, renderToken, host)) {
          return;
        }
        els.pendingList.innerHTML = adminAnalyticsHtml(analytics, state.boards);
      });
  }

  function renderAdminHealth(data: AnyRecord) {
    renderAdminTabs();
    const expectedTab = 'health';
    const renderToken = ++adminIslandRenderToken;
    // Optional React island host; falls back to vanilla HTML if the chunk fails.
    els.pendingList.innerHTML =
      '<div id="reactAdminHealthIsland" class="react-island" data-react-island="admin-health"></div>';
    if (els.adminSelectAll) {
      els.adminSelectAll.checked = false;
    }
    const host = document.getElementById('reactAdminHealthIsland');
    void import('./react/mount-admin-health')
      .then(({ mountAdminHealthIsland }) => {
        // Stale lazy resolve: do not mount into a different admin tab or superseded host.
        if (!isLiveAdminIslandHost(expectedTab, renderToken, host)) {
          return;
        }
        mountAdminHealthIsland(data);
      })
      .catch(() => {
        // Stale failure: do not overwrite another tab with health vanilla HTML.
        if (!isLiveAdminIslandHost(expectedTab, renderToken, host)) {
          return;
        }
        els.pendingList.innerHTML = adminHealthHtml(data);
      });
  }

  function adminQueryString() {
    const params = new URLSearchParams();
    const boardFilter = els.adminBoardFilter?.value || '';
    if (boardFilter) {
      params.set('boardSlug', boardFilter);
    }
    const labelFilter = els.adminLabelFilter?.value || '';
    if (state.adminTab !== 'reports' && labelFilter) {
      params.set('label', labelFilter);
    }
    const reportCategoryFilter = els.adminReportCategoryFilter?.value || '';
    if (state.adminTab === 'reports' && reportCategoryFilter) {
      params.set('category', reportCategoryFilter);
    }
    const timeFilter = els.adminTimeFilter?.value || '';
    if (timeFilter) {
      const since = new Date(Date.now() - (timeFilter === '24h' ? 24 : 24 * 7) * 60 * 60 * 1000);
      params.set('since', since.toISOString());
    }
    const priorityFilter = els.adminPriorityFilter?.value || '';
    if ((state.adminTab === 'pending' || state.adminTab === 'reports') && priorityFilter) {
      params.set('priority', priorityFilter);
    }
    const confidenceFilter = els.adminConfidenceFilter?.value || '';
    if (state.adminTab === 'pending' && confidenceFilter) {
      params.set('confidence', confidenceFilter);
    }
    const prioritySort = els.adminPrioritySort?.value || '';
    if ((state.adminTab === 'pending' || state.adminTab === 'reports') && prioritySort) {
      params.set('sort', prioritySort);
    }
    return params.toString();
  }

  function adminEndpoint() {
    const query = adminQueryString();
    const suffix = query ? `?${query}` : '';
    if (state.adminTab === 'reports') {
      return `/api/admin/reports${query ? `?limit=100&${query}` : '?limit=100'}`;
    }
    if (state.adminTab === 'appeals') {
      return `/api/admin/appeals${query ? `?limit=100&${query}` : '?limit=100'}`;
    }
    if (state.adminTab === 'approved') {
      return `/api/admin/approved${query ? `?limit=100&${query}` : '?limit=100'}`;
    }
    if (state.adminTab === 'deleted') {
      return `/api/admin/deleted${query ? `?limit=100&${query}` : '?limit=100'}`;
    }
    if (state.adminTab === 'sanctions') {
      return `/api/admin/sanctions${query ? `?limit=100&${query}&status=active` : '?limit=100&status=active'}`;
    }
    if (state.adminTab === 'boards') {
      return '/api/admin/boards';
    }
    if (state.adminTab === 'users') {
      return '/api/admin/users';
    }
    if (state.adminTab === 'audit') {
      return `/api/admin/moderation-actions${query ? `?limit=100&${query}` : '?limit=100'}`;
    }
    if (state.adminTab === 'analytics') {
      return '/api/admin/analytics';
    }
    if (state.adminTab === 'health') {
      return '/api/admin/health';
    }
    return `/api/admin/pending${suffix}`;
  }

  function isAdminSessionError(error: AnyRecord) {
    return error?.statusCode === 401 || error?.requires2FA;
  }

  function isAbortError(error: AnyRecord) {
    return error?.name === 'AbortError';
  }

  function renderAdminTabs() {
    document.querySelectorAll('[data-admin-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.adminTab === state.adminTab);
    });
    els.adminBulkBar.classList.toggle('hidden', state.adminTab !== 'pending');
    els.adminLabelFilter.closest('label')?.classList.toggle('hidden', state.adminTab === 'reports' || state.adminTab === 'appeals');
    els.adminReportCategoryFilterWrap.classList.toggle('hidden', state.adminTab !== 'reports');
    const supportsPriority = state.adminTab === 'pending' || state.adminTab === 'reports';
    els.adminPriorityFilterWrap.classList.toggle('hidden', !supportsPriority);
    els.adminPrioritySortWrap.classList.toggle('hidden', !supportsPriority);
    els.adminConfidenceFilterWrap?.classList.toggle('hidden', state.adminTab !== 'pending');
    els.reportSection.classList.toggle('hidden', true);
    els.moderationSection.classList.toggle('hidden', true);
  }

  function renderAdminItems(items: AnyRecord[]) {
    state.adminItems = items;
    renderAdminTabs();
    if (state.adminTab === 'pending') {
      els.pendingList.innerHTML = pendingPostsHtml(items);
    } else if (state.adminTab === 'reports') {
      els.pendingList.innerHTML = `<div class="moderation-log">${reportsHtml(items)}</div>`;
    } else if (state.adminTab === 'appeals') {
      els.pendingList.innerHTML = `<div class="moderation-log">${appealsHtml(items)}</div>`;
    } else if (state.adminTab === 'deleted') {
      els.pendingList.innerHTML = deletedPostsHtml(items);
    } else if (state.adminTab === 'sanctions') {
      els.pendingList.innerHTML = `<div class="moderation-log">${sanctionsHtml(items)}</div>`;
    } else if (state.adminTab === 'boards') {
      els.pendingList.innerHTML = adminBoardsHtml(items, state.lifecycle || {});
    } else if (state.adminTab === 'users') {
      els.pendingList.innerHTML = adminUsersHtml(items);
    } else {
      els.pendingList.innerHTML = `<div class="moderation-log">${historyActionsHtml(items)}</div>`;
    }
    if (els.adminSelectAll) {
      els.adminSelectAll.checked = false;
    }
  }

  function exportAdminCsv() {
    const rows = [['tab', 'time', 'board', 'globalNumber', 'typeOrAction', 'confidence', 'reason']];
    for (const item of state.adminItems) {
      rows.push([
        state.adminTab,
        item.createdAt || item.deletedAt || '',
        item.boardSlug || '',
        item.globalNumber || item.sourceGlobalNumber || '',
        item.type || item.action || item.kind || '',
        Number.isFinite(Number(item.moderationConfidence)) ? Number(item.moderationConfidence) : '',
        item.reason || item.deleteReason || ''
      ]);
    }
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `36chan-admin-${state.adminTab}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function syncAdminBoardFilter() {
    if (!els.adminBoardFilter) {
      return;
    }
    const selectedBoard = els.adminBoardFilter.value;
    els.adminBoardFilter.innerHTML = `
      <option value="">Tất cả</option>
      ${state.boards
        .map((board) => `<option value="${escapeHtml(board.slug)}">${escapeHtml(board.path)} ${escapeHtml(board.name)}</option>`)
        .join('')}
    `;
    if (selectedBoard && state.boards.some((board) => board.slug === selectedBoard)) {
      els.adminBoardFilter.value = selectedBoard;
    }
  }

  async function loadAdminDetail(globalNumber: string, host: Element, options: AnyRecord = {}) {
    const detail = await api(`/api/admin/posts/${globalNumber}`, {
      timeoutMs: adminLoadTimeoutMs,
      timeoutMessage: adminLoadTimeoutMessage || ADMIN_LOAD_ERROR_MESSAGE
    });
    const container = host.querySelector('.admin-detail-host') || document.createElement('div');
    container.className = 'admin-detail-host';
    container.innerHTML = adminPostDetailHtml(detail, options);
    host.appendChild(container);
  }

  function adminTableDetailHost(button: Element) {
    const row = button.closest('tr');
    const table = row?.closest('.moderation-log-table');
    if (!row || !table) {
      return null;
    }
    const globalNumber = button.dataset.adminDetail;
    const next = row.nextElementSibling;
    if (next?.classList.contains('admin-detail-row') && next.dataset.detailFor === globalNumber) {
      next.remove();
      button.setAttribute('aria-expanded', 'false');
      return null;
    }
    table.querySelectorAll('.admin-detail-row').forEach((detailRow) => detailRow.remove());
    table
      .querySelectorAll('[data-admin-detail][aria-expanded="true"]')
      .forEach((detailButton) => {
        detailButton.setAttribute('aria-expanded', 'false');
      });
    const detailRow = document.createElement('tr');
    detailRow.className = 'admin-detail-row';
    detailRow.dataset.detailFor = globalNumber;
    const cell = document.createElement('td');
    cell.colSpan = row.cells.length || 1;
    cell.innerHTML = '<div class="admin-detail-host"><p class="muted">Đang tải chi tiết...</p></div>';
    detailRow.appendChild(cell);
    row.after(detailRow);
    button.setAttribute('aria-expanded', 'true');
    return cell;
  }

  function selectedPendingIds() {
    return [...document.querySelectorAll('[data-admin-select]:checked')].map((input) => input.dataset.adminSelect);
  }

  async function bulkModerate(action: string) {
    const ids = selectedPendingIds();
    if (!ids.length) {
      showToast('Chưa chọn bài nào.');
      return;
    }
    const reason = await showReasonModal(
      action === 'approve' ? `Lý do duyệt ${ids.length} bài:` : `Lý do xóa ${ids.length} bài:`,
      action === 'approve' ? 'bulk-approve' : 'bulk-delete'
    );
    if (reason === null) {
      return;
    }
    await api('/api/admin/pending/bulk', {
      method: 'POST',
      body: JSON.stringify({ action, ids, reason })
    });
    showToast(action === 'approve' ? 'Đã duyệt hàng loạt.' : 'Đã xóa hàng loạt.');
    await safeLoadAdmin();
  }

  return {
    adminQueryString,
    adminEndpoint,
    isAdminSessionError,
    isAbortError,
    renderAdminTabs,
    renderAdminAnalytics,
    renderAdminHealth,
    renderAdminItems,
    exportAdminCsv,
    syncAdminBoardFilter,
    adminTableDetailHost,
    selectedPendingIds,
    bulkModerate,
    loadAdminDetail,
    adminPostDetailHtml,
    deletedPostsHtml,
    pendingPostsHtml,
    editHistoryMediaHtml,
    editHistoryHtml
  };
}


