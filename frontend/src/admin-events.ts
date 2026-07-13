import { escapeHtml } from './format';
import type { AnyRecord } from './types';

type SetButtonLoading = (button: Element, text: string) => (() => void) | void;

type AdminEventDependencies = {
  els: AnyRecord;
  state: AnyRecord;
  showToast: (message: string) => void;
  setButtonLoading: SetButtonLoading;
  api: (input: string, options?: AnyRecord) => Promise<AnyRecord>;
  loadAdmin: () => Promise<void>;
  loadThread: () => Promise<void>;
  loadBoard: () => Promise<void>;
  refreshPublicBoards: () => Promise<void> | void;
  saveAdminModerationSettings: () => Promise<void> | void;
  exportAdminCsv: () => void;
  adminBoardPayload: (form: AnyRecord, options?: AnyRecord) => AnyRecord;
  adminUserPayload: (form: AnyRecord, options?: AnyRecord) => AnyRecord;
  adminSiteContentPayload?: (root: Element | null) => AnyRecord;
  applySiteContent?: (content: AnyRecord) => void;
  loadAdminDetail: (globalNumber: string, host: Element, options?: AnyRecord) => Promise<void>;
  adminTableDetailHost: (button: Element) => Element | null;
  showReasonModal: (message: string, context: string) => Promise<string | null>;
  showPostEditModal: (globalNumber: string, currentBody: string, options?: AnyRecord) => Promise<AnyRecord | null>;
  bulkModerate: (action: string) => Promise<void>;
};

function isButtonTarget(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}

export async function handleAdminClick(event: Event, deps: AdminEventDependencies): Promise<boolean> {
  const target = isButtonTarget(event);
  if (!target) {
    return false;
  }

  const {
    els,
    state,
    showToast,
    setButtonLoading,
    api,
    loadAdmin,
    loadThread,
    loadBoard,
    refreshPublicBoards,
    saveAdminModerationSettings,
    exportAdminCsv,
    adminBoardPayload,
    adminUserPayload,
    adminSiteContentPayload,
    applySiteContent,
    loadAdminDetail,
    adminTableDetailHost,
    showReasonModal,
    showPostEditModal,
    bulkModerate
  } = deps;

  const adminTabButton = target.closest('[data-admin-tab]');
  if (adminTabButton) {
    state.adminTab = adminTabButton.dataset.adminTab;
    await loadAdmin();
    return true;
  }
  if (target.closest('#adminRefresh, [data-admin-retry]')) {
    await loadAdmin();
    return true;
  }
  if (target.closest('#adminExport')) {
    exportAdminCsv();
    return true;
  }
  if (target.closest('#adminSaveModerationSettings')) {
    await saveAdminModerationSettings();
    return true;
  }

  const adminSiteContentSaveButton = target.closest('[data-admin-site-content-save]');
  if (adminSiteContentSaveButton) {
    const root = adminSiteContentSaveButton.closest('[data-admin-site-content]');
    const restore = setButtonLoading(adminSiteContentSaveButton, 'Đang lưu...');
    try {
      const payload = adminSiteContentPayload ? adminSiteContentPayload(root) : {};
      const content = await api('/api/admin/site-content', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      state.siteContent = content;
      if (typeof applySiteContent === 'function') {
        applySiteContent(content);
      }
      showToast('Đã lưu nội dung /policy/.');
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    } finally {
      if (typeof restore === 'function') {
        restore();
      }
    }
    return true;
  }

  const adminBoardCreateButton = target.closest('[data-admin-board-create]');
  if (adminBoardCreateButton) {
    const form = adminBoardCreateButton.closest('[data-admin-board-create-form]');
    const restore = setButtonLoading(adminBoardCreateButton, 'Đang tạo...');
    try {
      await api('/api/admin/boards', {
        method: 'POST',
        body: JSON.stringify(adminBoardPayload(form as AnyRecord, { includeSlug: true }))
      });
      showToast('Đã tạo board.');
      await refreshPublicBoards();
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    } finally {
      if (typeof restore === 'function') {
        restore();
      }
    }
    return true;
  }

  const adminBoardSaveButton = target.closest('[data-admin-board-save]');
  if (adminBoardSaveButton) {
    const row = adminBoardSaveButton.closest('[data-admin-board-row]');
    const slug = row?.dataset.adminBoardRow;
    if (!slug) {
      return true;
    }
    const restore = setButtonLoading(adminBoardSaveButton, 'Đang lưu...');
    try {
      await api(`/api/admin/boards/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        body: JSON.stringify(adminBoardPayload(row as AnyRecord))
      });
      showToast('Đã lưu board.');
      await refreshPublicBoards();
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    } finally {
      if (typeof restore === 'function') {
        restore();
      }
    }
    return true;
  }

  const adminBoardDeleteButton = target.closest('[data-admin-board-delete]');
  if (adminBoardDeleteButton) {
    const row = adminBoardDeleteButton.closest('[data-admin-board-row]');
    const slug = row?.dataset.adminBoardRow;
    if (!slug || !window.confirm(`Xóa board /${slug}/? Chỉ board rỗng mới xóa được.`)) {
      return true;
    }
    const restore = setButtonLoading(adminBoardDeleteButton, 'Đang xóa...');
    try {
      await api(`/api/admin/boards/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      showToast('Đã xóa board.');
      await refreshPublicBoards();
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    } finally {
      if (typeof restore === 'function') {
        restore();
      }
    }
    return true;
  }

  const adminUserCreateButton = target.closest('[data-admin-user-create]');
  if (adminUserCreateButton) {
    const form = adminUserCreateButton.closest('[data-admin-user-create-form]');
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(adminUserPayload(form as AnyRecord, { includeUsername: true }))
      });
      showToast('Đã tạo tài khoản quản trị.');
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  const adminUserSaveButton = target.closest('[data-admin-user-save]');
  if (adminUserSaveButton) {
    const row = adminUserSaveButton.closest('[data-admin-user-row]');
    const id = row?.dataset.adminUserRow;
    if (!id) {
      return true;
    }
    try {
      await api(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(adminUserPayload(row as AnyRecord))
      });
      showToast('Đã lưu tài khoản quản trị.');
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  const adminUserDisableButton = target.closest('[data-admin-user-disable]');
  if (adminUserDisableButton) {
    const row = adminUserDisableButton.closest('[data-admin-user-row]');
    const id = row?.dataset.adminUserRow;
    const username = row?.querySelector('strong')?.textContent || 'tài khoản này';
    if (!id || !window.confirm(`Vô hiệu hóa ${username}?`)) {
      return true;
    }
    try {
      await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
      showToast('Đã vô hiệu hóa tài khoản quản trị.');
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  if (target.closest('#adminBulkApprove')) {
    await bulkModerate('approve');
    return true;
  }
  if (target.closest('#adminBulkDelete')) {
    await bulkModerate('delete');
    return true;
  }

  const appealResolveButton = target.closest('[data-admin-resolve-appeal]');
  if (appealResolveButton) {
    const status = appealResolveButton.dataset.status === 'accepted' ? 'accepted' : 'rejected';
    const reason = await showReasonModal(
      status === 'accepted' ? 'Lý do chấp nhận kháng nghị:' : 'Lý do từ chối kháng nghị:',
      status === 'accepted' ? 'appeal-accept' : 'appeal-reject'
    );
    if (reason === null) {
      return true;
    }
    try {
      await api(`/api/admin/appeals/${encodeURIComponent(appealResolveButton.dataset.adminResolveAppeal)}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ status, reason })
      });
      showToast(status === 'accepted' ? 'Đã chấp nhận kháng nghị.' : 'Đã từ chối kháng nghị.');
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  const adminDetailButton = target.closest('[data-admin-detail]');
  if (adminDetailButton) {
    const isTableDetail = Boolean(adminDetailButton.closest('tr')?.closest('.moderation-log-table'));
    const tableHost = isTableDetail ? adminTableDetailHost(adminDetailButton) : null;
    if (isTableDetail && !tableHost) {
      return true;
    }
    const host = tableHost || adminDetailButton.closest('.pending-item') || els.pendingList;
    if (!host) {
      return true;
    }
    try {
      await loadAdminDetail(adminDetailButton.dataset.adminDetail, host as Element, {
        compactReports: Boolean(tableHost)
      });
    } catch (error) {
      if (tableHost) {
        tableHost.innerHTML = `<div class="admin-detail-host"><p class="error">${escapeHtml(error.message)}</p></div>`;
      }
      showToast(error.message);
    }
    return true;
  }

  const adminReportsSummaryButton = target.closest('[data-admin-reports-summary]');
  if (adminReportsSummaryButton) {
    const globalNumber = adminReportsSummaryButton.dataset.adminReportsSummary;
    const box = document.getElementById(`adminReportsSummaryBox-${globalNumber}`);
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = '<p class="muted">Đang tóm tắt báo cáo...</p>';
      try {
        const result = await api(`/api/admin/posts/${globalNumber}/reports/summary`, {
          method: 'POST'
        });
        box.innerHTML = `
          <div class="reports-summary-content">
            <strong>${escapeHtml(result.label || 'Tóm tắt báo cáo AI')}:</strong>
            <p>${escapeHtml(result.summary)}</p>
          </div>
        `;
      } catch (error) {
        box.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
      }
    }
    return true;
  }

  const boardDigestButton = target.closest('[data-board-digest]');
  if (boardDigestButton) {
    const box = document.querySelector('[data-board-digest-result]');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = '<p class="muted">Đang tạo bản tổng hợp...</p>';
      try {
        const result = await api('/api/admin/board-digest', { method: 'POST' });
        const bullets = (result.bullets || []).map((line) => `<li>${escapeHtml(line)}</li>`).join('');
        box.innerHTML = `
          <div class="reports-summary-content">
            <strong>${escapeHtml(result.label || 'Nội dung do AI tổng hợp')}</strong>
            <p class="muted">${result.threadCount} chủ đề công khai trên ${result.boardCount} bảng</p>
            <ul>${bullets}</ul>
          </div>
        `;
      } catch (error) {
        box.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
      }
    }
    return true;
  }

  const adminNoteButton = target.closest('[data-admin-note]');
  if (adminNoteButton) {
    const note = window.prompt(`Ghi chú nội bộ cho No.${adminNoteButton.dataset.adminNote}:`, '') || '';
    if (!note) {
      return true;
    }
    try {
      await api(`/api/admin/posts/${adminNoteButton.dataset.adminNote}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note })
      });
      showToast('Đã lưu ghi chú.');
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  const adminEditPostButton = target.closest('[data-admin-edit-post]');
  if (adminEditPostButton) {
    const globalNumber = adminEditPostButton.dataset.adminEditPost;
    const currentBody = decodeURIComponent(adminEditPostButton.dataset.adminEditBody || '');
    const edit = await showPostEditModal(globalNumber, currentBody);
    if (!edit) {
      return true;
    }
    try {
      await api(`/api/admin/posts/${globalNumber}`, {
        method: 'PUT',
        body: JSON.stringify(edit)
      });
      showToast('Đã sửa bài.');
      const hash = window.location.hash || '';
      if (hash.startsWith('#thread/')) {
        await loadThread();
      } else if (hash.startsWith('#board/')) {
        await loadBoard();
      } else {
        await loadAdmin();
      }
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  const adminRestorePostButton = target.closest('[data-admin-restore-post]');
  if (adminRestorePostButton) {
    const globalNumber = adminRestorePostButton.dataset.adminRestorePost;
    const reason = await showReasonModal(`Lý do khôi phục bài No.${globalNumber}:`, 'restore');
    if (reason === null) {
      return true;
    }
    try {
      await api(`/api/admin/posts/${globalNumber}/restore`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      showToast('Đã khôi phục bài.');
      const hash = window.location.hash || '';
      if (hash.startsWith('#thread/')) {
        await loadThread();
      } else if (hash.startsWith('#board/')) {
        await loadBoard();
      } else {
        await loadAdmin();
      }
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  const adminDeletePostButton = target.closest('[data-admin-delete-post]');
  if (adminDeletePostButton) {
    const globalNumber = adminDeletePostButton.dataset.adminDeletePost;
    const fileOnly = adminDeletePostButton.dataset.fileOnly === 'true';
    const reason = await showReasonModal(
      fileOnly ? `Lý do xóa tệp của No.${globalNumber}:` : `Lý do xóa bài No.${globalNumber}:`,
      'delete'
    );
    if (reason === null) {
      return true;
    }
    try {
      await api(`/api/admin/posts/${globalNumber}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason, fileOnly })
      });
      showToast(fileOnly ? 'Đã xóa tệp.' : 'Đã xóa bài.');
      const hash = window.location.hash || '';
      if (hash.startsWith('#thread/')) {
        await loadThread();
      } else if (hash.startsWith('#board/')) {
        await loadBoard();
      } else {
        await loadAdmin();
      }
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  const adminStickyButton = target.closest('[data-admin-sticky-thread]');
  if (adminStickyButton) {
    const threadId = adminStickyButton.dataset.adminStickyThread;
    const nextSticky = adminStickyButton.dataset.stickyNext === 'true';
    const ok = window.confirm(nextSticky ? 'Ghim chủ đề này lên đầu board?' : 'Gỡ ghim chủ đề này?');
    if (!ok) {
      return true;
    }
    try {
      await api(`/api/admin/threads/${encodeURIComponent(threadId)}/sticky`, {
        method: nextSticky ? 'POST' : 'DELETE'
      });
      showToast(nextSticky ? 'Đã ghim chủ đề.' : 'Đã gỡ ghim chủ đề.');
      const hash = window.location.hash || '';
      if (hash.startsWith('#board/')) {
        await loadBoard();
      } else if (hash.startsWith('#thread/')) {
        await loadThread();
      } else {
        await loadAdmin();
      }
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  const adminLockButton = target.closest('[data-admin-lock-thread]');
  if (adminLockButton) {
    const threadId = adminLockButton.dataset.adminLockThread;
    const nextLocked = adminLockButton.dataset.lockNext === 'true';
    const ok = window.confirm(nextLocked ? 'Khóa chủ đề này? Người dùng sẽ không thể trả lời.' : 'Mở khóa chủ đề này?');
    if (!ok) {
      return true;
    }
    try {
      await api(`/api/admin/threads/${encodeURIComponent(threadId)}/lock`, {
        method: nextLocked ? 'POST' : 'DELETE'
      });
      showToast(nextLocked ? 'Đã khóa chủ đề.' : 'Đã mở khóa chủ đề.');
      const hash = window.location.hash || '';
      if (hash.startsWith('#board/')) {
        await loadBoard();
      } else if (hash.startsWith('#thread/')) {
        await loadThread();
      } else {
        await loadAdmin();
      }
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  const adminSanctionButton = target.closest('[data-admin-sanction]');
  if (adminSanctionButton) {
    const kind = adminSanctionButton.dataset.adminSanction;
    const globalNumber = adminSanctionButton.dataset.globalNumber;
    const defaultMinutes = kind === 'ban' ? '1440' : '60';
    const durationMinutes = window.prompt(
      kind === 'ban' ? 'Tạm khóa trong bao nhiêu phút?' : 'Làm chậm trong bao nhiêu phút?',
      defaultMinutes
    );
    if (!durationMinutes) {
      return true;
    }
    const reason = await showReasonModal(kind === 'ban' ? 'Lý do tạm khóa:' : 'Lý do làm chậm:', kind) || '';
    try {
      await api(`/api/admin/posts/${globalNumber}/sanctions`, {
        method: 'POST',
        body: JSON.stringify({ kind, durationMinutes: Number(durationMinutes), reason })
      });
      showToast(kind === 'ban' ? 'Đã tạm khóa.' : 'Đã đặt làm chậm.');
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  const revokeSanctionButton = target.closest('[data-admin-revoke-sanction]');
  if (revokeSanctionButton) {
    const reason = await showReasonModal('Lý do gỡ lệnh làm chậm/tạm khóa:', 'revoke');
    if (reason === null) {
      return true;
    }
    try {
      await api(`/api/admin/sanctions/${revokeSanctionButton.dataset.adminRevokeSanction}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason })
      });
      showToast('Đã gỡ lệnh làm chậm/tạm khóa.');
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  const pendingButton = target.closest('[data-action]');
  if (pendingButton) {
    const item = pendingButton.closest('.pending-item');
    const action = pendingButton.dataset.action;
    const reason = await showReasonModal(
      action === 'approve' ? 'Lý do duyệt bài:' : 'Lý do xóa bài:',
      action === 'approve' ? 'approve' : 'delete'
    );
    if (reason === null) {
      return true;
    }
    try {
      await api(
        action === 'approve'
          ? `/api/admin/pending/${item?.dataset.id}/approve`
          : `/api/admin/pending/${item?.dataset.id}`,
        {
          method: action === 'approve' ? 'POST' : 'DELETE',
          body: JSON.stringify({ reason })
        }
      );
      showToast(action === 'approve' ? 'Đã duyệt.' : 'Đã xóa.');
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    }
    return true;
  }

  return false;
}

export function handleAdminChange(event: Event, deps: AdminEventDependencies): boolean {
  const target = isButtonTarget(event);
  if (!target) {
    return false;
  }
  const { els, loadAdmin, showToast } = deps;
  if (
    target.closest(
      '#adminBoardFilter, #adminLabelFilter, #adminReportCategoryFilter, #adminTimeFilter, #adminPriorityFilter, #adminConfidenceFilter, #adminPrioritySort'
    )
  ) {
    loadAdmin().catch((error) => showToast(error.message));
    return true;
  }
  if (target.closest('#adminSelectAll')) {
    document.querySelectorAll('[data-admin-select]').forEach((input) => {
      input.checked = els.adminSelectAll.checked;
    });
    return true;
  }
  return false;
}


