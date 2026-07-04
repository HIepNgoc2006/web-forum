import { REASON_MACROS, REPORT_CATEGORIES } from './constants';
import { escapeHtml } from './format';
import type { AnyRecord } from './types';

export function showReportModal(globalNumber: string | number): Promise<{ category: string; reason: string } | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'reason-modal-overlay';
    overlay.innerHTML = `
      <div class="reason-modal" role="dialog" aria-modal="true" aria-labelledby="reportModalTitle">
        <div class="reason-modal-title" id="reportModalTitle">Báo cáo No.${escapeHtml(globalNumber)}</div>
        <label class="reason-modal-label" for="reportCategorySelect">Loại báo cáo:</label>
        <select class="reason-macro-select" id="reportCategorySelect">
          ${REPORT_CATEGORIES.map((category) => `<option value="${category.value}">${category.label}</option>`).join('')}
        </select>
        <label class="reason-modal-label" for="reportReasonTextarea">Lý do:</label>
        <textarea class="reason-textarea" id="reportReasonTextarea" rows="3" placeholder="Mô tả ngắn vấn đề..."></textarea>
        <div class="reason-modal-actions">
          <button class="primary-button" id="reportConfirmBtn" type="button">Gửi báo cáo</button>
          <button class="ghost-button" id="reportCancelBtn" type="button">Hủy</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const select = overlay.querySelector('#reportCategorySelect');
    const textarea = overlay.querySelector('#reportReasonTextarea');
    const confirmBtn = overlay.querySelector('#reportConfirmBtn');
    const cancelBtn = overlay.querySelector('#reportCancelBtn');
    let settled = false;

    function finish(value: { category: string; reason: string } | null) {
      if (settled) {
        return;
      }
      settled = true;
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(value);
    }

    confirmBtn.addEventListener('click', () => {
      const reason = textarea.value.trim();
      finish(reason ? { category: select.value, reason } : null);
    });

    cancelBtn.addEventListener('click', () => {
      finish(null);
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        finish(null);
      }
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        finish(null);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    textarea.focus();
  });
}

export function showReasonModal(title: string, context: string): Promise<string | null> {
  return new Promise((resolve) => {
    const macros = (REASON_MACROS as AnyRecord)[context] || REASON_MACROS.approve;
    const overlay = document.createElement('div');
    overlay.className = 'reason-modal-overlay';
    overlay.innerHTML = `
      <div class="reason-modal" role="dialog" aria-modal="true" aria-labelledby="reasonModalTitle">
        <div class="reason-modal-title" id="reasonModalTitle">${title}</div>
        <label class="reason-modal-label" for="reasonMacroSelect">Chọn mẫu lý do:</label>
        <select class="reason-macro-select" id="reasonMacroSelect">
          <option value="">-- Tùy chỉnh --</option>
          ${macros.map((m, i) => `<option value="${i}">${m}</option>`).join('')}
        </select>
        <label class="reason-modal-label" for="reasonTextarea">Lý do (có thể sửa):</label>
        <textarea class="reason-textarea" id="reasonTextarea" rows="3" placeholder="Nhập lý do..."></textarea>
        <div class="reason-modal-actions">
          <button class="primary-button" id="reasonConfirmBtn" type="button">Xác nhận</button>
          <button class="ghost-button" id="reasonCancelBtn" type="button">Hủy</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const select = overlay.querySelector('#reasonMacroSelect');
    const textarea = overlay.querySelector('#reasonTextarea');
    const confirmBtn = overlay.querySelector('#reasonConfirmBtn');
    const cancelBtn = overlay.querySelector('#reasonCancelBtn');
    let settled = false;

    select.addEventListener('change', () => {
      const index = select.value;
      if (index !== '') {
        textarea.value = macros[Number(index)];
      } else {
        textarea.value = '';
      }
      textarea.focus();
    });

    function finish(value: string | null) {
      if (settled) {
        return;
      }
      settled = true;
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(value);
    }

    confirmBtn.addEventListener('click', () => {
      const value = textarea.value.trim();
      finish(value);
    });

    cancelBtn.addEventListener('click', () => {
      finish(null);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        finish(null);
      }
    });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        finish(null);
      }
    }

    document.addEventListener('keydown', onKeyDown);

    textarea.focus();
  });
}
