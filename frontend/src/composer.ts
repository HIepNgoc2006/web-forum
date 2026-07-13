import { safePrivateText, safeReplyTemplateBody } from './account';
import { MAX_MEDIA_BYTES, MAX_MEDIA_PER_POST, SUPPORTED_VIDEO_TYPES, THREAD_TEMPLATES } from './constants';
import { els } from './dom';
import {
  dataUrlBytes,
  escapeHtml,
  fileTextHtml,
  mediaKind,
  mediaThumbnailSrc,
  scanDraftRisks
} from './format';
import type { AnyRecord } from './types';

export function updatePrivacyWarning(text, box) {
  if (!box) {
    return [];
  }
  const { privacyRisks, rumorRisks, risks } = scanDraftRisks(text);
  if (!risks.length) {
    box.textContent = '';
    box.classList.add('hidden');
    return risks;
  }
  const hasRumorRisk = rumorRisks.length > 0;
  const detail = privacyRisks.length
    ? 'Hãy sửa trước khi đăng nếu đây là thông tin thật.'
    : 'Hãy viết lại trung lập hoặc thêm ngữ cảnh nếu đây chỉ là tin đồn/cáo buộc.';
  box.innerHTML = `<strong>${hasRumorRisk ? 'Chưa kiểm chứng:' : 'Cảnh báo riêng tư:'}</strong> Có thể chứa ${risks
    .map((risk) => escapeHtml(risk))
    .join(', ')}. ${detail}`;
  box.classList.remove('hidden');
  return risks;
}

export function confirmPrivacyBeforeSubmit(text, box) {
  const risks = updatePrivacyWarning(text, box);
  if (!risks.length) {
    return true;
  }
  return window.confirm(
    `Bài viết có thể chứa ${risks.join(', ')}. Hãy sửa nếu có thông tin cá nhân hoặc cáo buộc chưa kiểm chứng. Bạn vẫn muốn gửi nội dung này?`
  );
}

export function isSupportedMediaFile(file) {
  return Boolean(file?.type?.startsWith('image/') || SUPPORTED_VIDEO_TYPES.has(file?.type));
}

export function fileToDataUrl(file) {
  return new Promise<any>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc tệp'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (file.type.startsWith('video/')) {
        resolve(videoFileMetadata(file, dataUrl));
        return;
      }
      const image = new Image();
      image.onload = () => {
        const selectedImage: AnyRecord = {
          name: file.name,
          type: file.type,
          sizeBytes: file.size,
          width: image.naturalWidth,
          height: image.naturalHeight,
          dataUrl
        };
        const thumbnail = createImageThumbnail(image, file);
        if (thumbnail) {
          selectedImage.thumbnail = thumbnail;
        }
        resolve(selectedImage);
      };
      image.onerror = () =>
        resolve({
          name: file.name,
          type: file.type,
          sizeBytes: file.size,
          dataUrl
        });
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function videoFileMetadata(file, dataUrl) {
  return new Promise<any>((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const timeout = window.setTimeout(() => finish(), 2500);

    const finish = (thumbnail = null) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      const selectedVideo: AnyRecord = {
        name: file.name,
        type: file.type,
        mediaType: 'video',
        sizeBytes: file.size,
        dataUrl
      };
      const width = Number(video.videoWidth || 0);
      const height = Number(video.videoHeight || 0);
      if (width > 0 && height > 0) {
        selectedVideo.width = width;
        selectedVideo.height = height;
      }
      if (thumbnail) {
        selectedVideo.thumbnail = thumbnail;
      }
      video.removeAttribute('src');
      video.load();
      resolve(selectedVideo);
    };

    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.onerror = () => finish();
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish();
        return;
      }
      try {
        video.currentTime = Math.min(Math.max(Number(video.duration || 0) * 0.1, 0), 1);
      } catch {
        finish();
      }
    };
    video.onloadeddata = () => {
      if (!settled && video.currentTime === 0) {
        finish(createVideoThumbnail(video, file));
      }
    };
    video.onseeked = () => finish(createVideoThumbnail(video, file));
    video.src = dataUrl;
  });
}

export function createImageThumbnail(image, file) {
  const width = Number(image.naturalWidth || image.width || 0);
  const height = Number(image.naturalHeight || image.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const maxEdge = 240;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const thumbnailWidth = Math.max(1, Math.round(width * scale));
  const thumbnailHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = thumbnailWidth;
  canvas.height = thumbnailHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.drawImage(image, 0, 0, thumbnailWidth, thumbnailHeight);
  const type = 'image/jpeg';
  const dataUrl = canvas.toDataURL(type, 0.7);
  if (!dataUrl.startsWith('data:image/')) {
    return null;
  }

  const baseName = String(file.name || 'thumbnail').replace(/\.[^.]+$/, '');
  return {
    name: `${baseName}-thumb.jpg`,
    type,
    dataUrl,
    sizeBytes: dataUrlBytes(dataUrl),
    width: thumbnailWidth,
    height: thumbnailHeight
  };
}

export function createVideoThumbnail(video, file) {
  const width = Number(video.videoWidth || 0);
  const height = Number(video.videoHeight || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const maxEdge = 240;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const thumbnailWidth = Math.max(1, Math.round(width * scale));
  const thumbnailHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = thumbnailWidth;
  canvas.height = thumbnailHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, thumbnailWidth, thumbnailHeight);
  const type = 'image/jpeg';
  const dataUrl = canvas.toDataURL(type, 0.72);
  if (!dataUrl.startsWith('data:image/')) {
    return null;
  }

  const baseName = String(file.name || 'video').replace(/\.[^.]+$/, '');
  return {
    name: `${baseName}-poster.jpg`,
    type,
    dataUrl,
    sizeBytes: dataUrlBytes(dataUrl),
    width: thumbnailWidth,
    height: thumbnailHeight
  };
}

export function imagePreviewHtml(image) {
  if (Array.isArray(image)) {
    return image.map((item) => imagePreviewHtml(item)).join('');
  }
  const thumbnailSrc = mediaThumbnailSrc(image, { fallbackOriginal: mediaKind(image) !== 'video' });
  const preview = thumbnailSrc
    ? `<img src="${escapeHtml(thumbnailSrc)}" alt="${escapeHtml(image.name)}">`
    : `<span class="post-image placeholder image-lazy-placeholder">${mediaKind(image) === 'video' ? 'Video' : 'Có tệp'}</span>`;
  return `
    <div class="image-preview-item">
      ${preview}
      <div class="file-text">${fileTextHtml(image)}</div>
    </div>
  `;
}

function maxMediaBytesLabel(maxMediaBytes = MAX_MEDIA_BYTES) {
  const mb = Math.round(Number(maxMediaBytes) / (1024 * 1024));
  return Number.isFinite(mb) && mb > 0 ? `${mb}MB` : '50MB';
}

// Shared change handler for a file input that stages media on state[stateKey].
// Optionally renders a preview panel and/or updates a filename label.
function resolveMaxMediaBytes(maxMediaBytes) {
  const value = typeof maxMediaBytes === 'function' ? maxMediaBytes() : maxMediaBytes;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MAX_MEDIA_BYTES;
}

function handleImageInputChange(
  input,
  { state, stateKey, preview = null, fileNameEl = null, showToast, maxMediaPerPost, maxMediaBytes = MAX_MEDIA_BYTES }
) {
  return async () => {
    const reset = () => {
      state[stateKey] = [];
      if (preview) {
        preview.innerHTML = '';
        preview.classList.add('hidden');
      }
      if (fileNameEl) {
        fileNameEl.textContent = 'Chưa chọn tệp';
      }
    };
    const files = Array.from(input.files || []) as File[];
    if (!files.length) {
      reset();
      return;
    }
    if (files.length > maxMediaPerPost) {
      showToast(`Tối đa ${maxMediaPerPost} tệp mỗi bài viết.`);
      input.value = '';
      reset();
      return;
    }
    if (files.some((file) => !isSupportedMediaFile(file))) {
      showToast('Chỉ hỗ trợ ảnh, MP4 hoặc WebM.');
      input.value = '';
      reset();
      return;
    }
    const effectiveMaxMediaBytes = resolveMaxMediaBytes(maxMediaBytes);
    if (files.some((file) => file.size > effectiveMaxMediaBytes)) {
      showToast(`Tệp quá lớn (tối đa ${maxMediaBytesLabel(effectiveMaxMediaBytes)}).`);
      input.value = '';
      reset();
      return;
    }
    try {
      state[stateKey] = await Promise.all(files.map((file) => fileToDataUrl(file)));
      if (preview) {
        preview.innerHTML = imagePreviewHtml(state[stateKey]);
        preview.classList.remove('hidden');
      }
      if (fileNameEl) {
        fileNameEl.textContent = files.length === 1 ? files[0].name : `${files.length} tệp đã chọn`;
      }
    } catch (error) {
      showToast(error.message);
      input.value = '';
      reset();
    }
  };
}

export function bindComposerMediaInputEvents({
  els,
  state,
  showToast,
  maxMediaPerPost = MAX_MEDIA_PER_POST,
  maxMediaBytes = MAX_MEDIA_BYTES
}: AnyRecord) {
  const options = { state, showToast, maxMediaPerPost, maxMediaBytes };
  els.threadImage.addEventListener(
    'change',
    handleImageInputChange(els.threadImage, {
      ...options,
      stateKey: 'selectedImage',
      preview: els.imagePreview
    })
  );
  els.commentImage.addEventListener(
    'change',
    handleImageInputChange(els.commentImage, {
      ...options,
      stateKey: 'commentImage',
      preview: els.commentImagePreview
    })
  );
  els.quickReplyFile.addEventListener(
    'change',
    handleImageInputChange(els.quickReplyFile, {
      ...options,
      stateKey: 'quickReplyImage',
      preview: els.quickReplyImagePreview,
      fileNameEl: els.quickReplyFileName
    })
  );
}

export function writeTextareaValue(textarea, value) {
  textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function composerTextarea(target) {
  if (target === 'thread') {
    return els.threadBody;
  }
  if (target === 'comment') {
    return els.commentBody;
  }
  if (target === 'quickReply') {
    return els.quickReplyBody;
  }
  return null;
}

export function insertComposerBlock(target, text, { showToast }: AnyRecord = {}) {
  const textarea = composerTextarea(target);
  const body = safeReplyTemplateBody(text);
  if (!textarea || !body) {
    return;
  }
  const value = textarea.value;
  const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : value.length;
  const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
  const prefix = start > 0 && !value.slice(0, start).endsWith('\n') ? '\n' : '';
  const suffix = value[end] && !value.slice(end).startsWith('\n') ? '\n' : '';
  const insertText = `${prefix}${body}${suffix}`;
  const maxLength = Number(textarea.maxLength);
  if (Number.isFinite(maxLength) && maxLength > 0 && value.length - (end - start) + insertText.length > maxLength) {
    showToast?.('Nháp đã đạt giới hạn ký tự.');
    textarea.focus();
    return;
  }
  textarea.setRangeText(insertText, start, end, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

export function defaultReplyTemplateTitle(body = '') {
  const firstLine = safePrivateText(String(body).split('\n').find((line) => line.trim()) || '', 80);
  return firstLine || 'Mẫu trả lời';
}

export function insertThreadTemplate(key, { showToast }: AnyRecord = {}) {
  const template = THREAD_TEMPLATES.find((item) => item.key === key);
  if (!template) {
    return;
  }
  const value = els.threadBody.value;
  const canReplaceSelection =
    document.activeElement === els.threadBody &&
    Number.isFinite(els.threadBody.selectionStart) &&
    els.threadBody.selectionStart !== els.threadBody.selectionEnd;
  let nextValue = template.body;
  let cursorStart = template.body.length;
  if (canReplaceSelection) {
    const start = els.threadBody.selectionStart;
    const end = els.threadBody.selectionEnd;
    nextValue = `${value.slice(0, start)}${template.body}${value.slice(end)}`;
    cursorStart = start + template.body.length;
  } else if (value.trim()) {
    const spacer = value.endsWith('\n') ? '\n' : '\n\n';
    nextValue = `${value}${spacer}${template.body}`;
    cursorStart = nextValue.length;
  }
  els.threadBody.dataset.threadTemplateKey = template.key;
  writeTextareaValue(els.threadBody, nextValue);
  els.threadBody.setSelectionRange(cursorStart, cursorStart);
  els.threadBody.focus();
  showToast?.(`Đã chèn mẫu ${template.label}. Bạn có thể sửa trước khi gửi.`);
}

export function dismissThreadTemplate({ showToast }: AnyRecord = {}) {
  const key = els.threadBody.dataset.threadTemplateKey;
  const template = THREAD_TEMPLATES.find((item) => item.key === key);
  if (!template) {
    els.threadBody.focus();
    return;
  }
  const value = els.threadBody.value;
  if (value === template.body) {
    writeTextareaValue(els.threadBody, '');
  } else if (value.includes(template.body)) {
    writeTextareaValue(els.threadBody, value.replace(template.body, '').replace(/\n{3,}/g, '\n\n').trimStart());
  } else {
    showToast?.('Mẫu đã được sửa; xóa phần không cần trong ô bình luận.');
    els.threadBody.focus();
    return;
  }
  delete els.threadBody.dataset.threadTemplateKey;
  els.threadBody.focus();
  showToast?.('Đã bỏ mẫu khỏi nháp.');
}

export function insertComposerToken(target, token, { showToast }: AnyRecord = {}) {
  const textarea = composerTextarea(target);
  if (!textarea || !token) {
    return;
  }
  const value = textarea.value;
  const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : value.length;
  const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
  const prefix = start > 0 && !/\s/.test(value[start - 1]) ? ' ' : '';
  const suffix = value[end] && !/\s/.test(value[end]) ? ' ' : '';
  const insertText = `${prefix}${token}${suffix}`;
  const maxLength = Number(textarea.maxLength);
  if (Number.isFinite(maxLength) && maxLength > 0 && value.length - (end - start) + insertText.length > maxLength) {
    showToast?.('Nội dung đã đạt giới hạn ký tự.');
    textarea.focus();
    return;
  }
  textarea.setRangeText(insertText, start, end, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}


export function createReplyTemplateComposerController({
  state,
  readReplyTemplates,
  addReplyTemplate,
  showToast,
  composerTextarea: resolveComposerTextarea = composerTextarea,
  insertComposerBlock: insertBlock = insertComposerBlock
}: AnyRecord) {
  function renderReplyTemplatePickers() {
    const templates = readReplyTemplates();
    document.querySelectorAll('[data-reply-template-picker]').forEach((root) => {
      const target = root.dataset.replyTemplatePicker;
      const scopedTemplates = templates.filter((template) => !template.boardSlug || template.boardSlug === state.boardSlug);
      const options = scopedTemplates
        .map((template) => '<option value="' + escapeHtml(template.id) + '">' + escapeHtml(template.title) + '</option>')
        .join('');
      root.innerHTML =
        '<span>Mẫu đã lưu</span>' +
        '<select data-reply-template-select ' +
        (scopedTemplates.length ? '' : 'disabled') +
        ' aria-label="Mẫu đã lưu">' +
        (scopedTemplates.length ? options : '<option value="">Chưa có mẫu</option>') +
        '</select>' +
        '<button class="link-button" data-insert-reply-template="' +
        escapeHtml(target) +
        '" type="button" ' +
        (scopedTemplates.length ? '' : 'disabled') +
        '>[Chèn]</button>' +
        '<button class="link-button" data-save-reply-template="' +
        escapeHtml(target) +
        '" type="button">[Lưu mẫu]</button>';
    });
  }

  function insertReplyTemplate(target, id) {
    const template = readReplyTemplates().find((item) => item.id === id);
    if (!template) {
      showToast('Không tìm thấy mẫu trả lời.');
      return;
    }
    insertBlock(target, template.body, { showToast });
  }

  function saveComposerReplyTemplate(target) {
    const textarea = resolveComposerTextarea(target);
    const body = safeReplyTemplateBody(textarea?.value || '');
    if (!body) {
      showToast('Nhập nội dung trước khi lưu mẫu.');
      textarea?.focus();
      return;
    }
    addReplyTemplate({
      title: defaultReplyTemplateTitle(body),
      body,
      boardSlug: state.boardSlug || ''
    });
    showToast('Đã lưu mẫu trả lời.');
  }

  return {
    renderReplyTemplatePickers,
    insertReplyTemplate,
    saveComposerReplyTemplate
  };
}

