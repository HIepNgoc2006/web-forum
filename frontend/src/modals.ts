import { MAX_MEDIA_BYTES, REASON_MACROS, REPORT_CATEGORIES } from './constants';
import { escapeHtml } from './format';
import type { AnyRecord } from './types';

export function createPostEditModal({
  showToast,
  maxMediaPerPost,
  maxMediaBytes = MAX_MEDIA_BYTES,
  isSupportedMediaFile,
  fileToDataUrl,
  imagePreviewHtml
}: AnyRecord) {
  return function showPostEditModal(globalNumber, initialBody = '', options: AnyRecord = {}) {
    return new Promise<any>((resolve) => {
      const allowMedia = Boolean(options.allowMedia);
      const showReason = !allowMedia && options.showReason !== false;
      const currentMediaHtml = allowMedia && options.currentMediaHtml ? options.currentMediaHtml : '';
      const overlay = document.createElement('div');
      overlay.className = 'reason-modal-overlay';
      overlay.innerHTML = `
      <div class="reason-modal post-edit-modal" role="dialog" aria-modal="true" aria-labelledby="postEditModalTitle">
        <div class="reason-modal-title" id="postEditModalTitle">Sửa bài No.${escapeHtml(globalNumber)}</div>
        <label class="reason-modal-label" for="postEditTextarea">Nội dung:</label>
        <textarea class="reason-textarea" id="postEditTextarea" rows="8" maxlength="5000" placeholder="Nội dung bài viết...">${escapeHtml(initialBody)}</textarea>
        ${
          allowMedia
            ? `
              <label class="reason-modal-label">Tệp đính kèm:</label>
              ${currentMediaHtml ? `<div class="edit-current-media">${currentMediaHtml}</div>` : '<p class="muted">Bài này chưa có tệp đính kèm.</p>'}
              <label class="reason-modal-label"><input id="postEditKeepImages" type="checkbox" checked> Giữ tệp hiện tại nếu không chọn tệp mới</label>
              <input id="postEditFileInput" type="file" accept="image/*,video/mp4,video/webm" multiple>
              <label class="reason-modal-label"><input id="postEditSpoiler" type="checkbox"> Ẩn ảnh mới</label>
              <div class="image-preview hidden" id="postEditPreview"></div>
            `
            : `
              ${
                showReason
                  ? `
                    <label class="reason-modal-label" for="postEditReasonTextarea">Lý do sửa:</label>
                    <textarea class="reason-textarea" id="postEditReasonTextarea" rows="3" placeholder="Nhập lý do..."></textarea>
                  `
                  : ''
              }
            `
        }
        <div class="reason-modal-actions">
          <button class="primary-button" id="postEditConfirmBtn" type="button">Lưu</button>
          <button class="ghost-button" id="postEditCancelBtn" type="button">Hủy</button>
        </div>
      </div>
    `;
      document.body.appendChild(overlay);

      const bodyTextarea = overlay.querySelector('#postEditTextarea');
      const reasonTextarea = overlay.querySelector('#postEditReasonTextarea');
      const keepImagesInput = overlay.querySelector('#postEditKeepImages');
      const fileInput = overlay.querySelector('#postEditFileInput');
      const spoilerInput = overlay.querySelector('#postEditSpoiler');
      const preview = overlay.querySelector('#postEditPreview');
      const confirmBtn = overlay.querySelector('#postEditConfirmBtn');
      const cancelBtn = overlay.querySelector('#postEditCancelBtn');
      let selectedMedia = [];
      let settled = false;

      function finish(value) {
        if (settled) {
          return;
        }
        settled = true;
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        resolve(value);
      }

      function resetSelectedMedia() {
        selectedMedia = [];
        fileInput.value = '';
        preview.innerHTML = '';
        preview.classList.add('hidden');
      }

      fileInput?.addEventListener('change', async () => {
        const files = Array.from(fileInput.files || []);
        if (!files.length) {
          resetSelectedMedia();
          return;
        }
        if (files.length > maxMediaPerPost) {
          showToast(`Tối đa ${maxMediaPerPost} tệp mỗi bài viết.`);
          resetSelectedMedia();
          return;
        }
        if (files.some((file) => !isSupportedMediaFile(file))) {
          showToast('Chỉ hỗ trợ ảnh, MP4 hoặc WebM.');
          resetSelectedMedia();
          return;
        }
        const mediaLimit =
          typeof maxMediaBytes === 'function' ? Number(maxMediaBytes()) : Number(maxMediaBytes);
        const effectiveMediaLimit =
          Number.isFinite(mediaLimit) && mediaLimit > 0 ? mediaLimit : MAX_MEDIA_BYTES;
        if (files.some((file) => file.size > effectiveMediaLimit)) {
          const maxMb = Math.round(effectiveMediaLimit / (1024 * 1024));
          showToast(`Tệp quá lớn (tối đa ${Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 50}MB).`);
          resetSelectedMedia();
          return;
        }
        try {
          selectedMedia = await Promise.all(files.map((file) => fileToDataUrl(file)));
          preview.innerHTML = imagePreviewHtml(selectedMedia);
          preview.classList.remove('hidden');
          if (keepImagesInput) {
            keepImagesInput.checked = false;
          }
        } catch (error) {
          resetSelectedMedia();
          showToast(error.message);
        }
      });

      confirmBtn.addEventListener('click', () => {
        const body = bodyTextarea.value.trim();
        if (!body) {
          bodyTextarea.focus();
          return;
        }
        if (!allowMedia) {
          finish({ body, reason: reasonTextarea?.value.trim() || '' });
          return;
        }
        const replaceImages = selectedMedia.length > 0 || !keepImagesInput?.checked;
        finish({
          body,
          replaceImages,
          images: replaceImages
            ? selectedMedia.map((item) => ({ ...item, spoiler: Boolean(spoilerInput?.checked) }))
            : undefined
        });
      });

      cancelBtn.addEventListener('click', () => {
        finish(null);
      });

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          finish(null);
        }
      });

      function onKeyDown(event) {
        if (event.key === 'Escape') {
          finish(null);
        }
      }

      document.addEventListener('keydown', onKeyDown);

      bodyTextarea.focus();
    });
  };
}
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
