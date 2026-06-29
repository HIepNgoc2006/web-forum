import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

const state = {
  boards: [],
  boardGroups: [],
  aiConfigured: false,
  hcaptchaSiteKey: '',
  hcaptchaReady: null,
  boardSlug: 'confession',
  threadId: '',
  threadDetail: null,
  threadLoadRequestId: 0,
  threadGlobalNumber: '',
  threadPosterHash: '',
  threadLastSeenBefore: 0,
  threadCurrentMaxNumber: 0,
  token: localStorage.getItem('adminToken') || '',
  accountToken: localStorage.getItem('accountToken') || '',
  account: null,
  accountPostNumbers: new Set(),
  temp2FAToken: null,
  adminTemp2FAToken: null,
  accountPrivateData: null,
  accountPrivateSaveTimer: null,
  posterToken: getPosterToken(),
  selectedImage: [],
  commentImage: [],
  quickReplyImage: [],
  audioRecorders: {},
  audioTranscribing: new Set(),
  audioTranscriptionControllers: new Map(),
  refPreviewCache: new Map(),
  refPreviewRequestId: 0,
  refPreviewHideTimer: null,
  quickReplyDrag: null,
  replyComposerOpen: false,
  threadIsArchived: false,
  threadIsLocked: false,
  boardPage: 1,
  boardPageSize: 15,
  boardSearchTerm: '',
  boardSort: 'bump',
  boardFilter: 'all',
  boardPageMeta: null,
  threadCommentPage: 1,
  threadCommentPageSize: 50,
  threadCommentPageMeta: null,
  threadSearchTerm: '',
  commentsSort: 'old',
  autoUpdate: true,
  autoCountdown: 7,
  autoTimer: null,
  realtimeSource: null,
  realtimeContextKey: '',
  browserNotificationIds: new Set(),
  watchedThreadSummaries: [],
  boardThreads: [],
  boardThreadsCache: new Map(),
  catalogThreads: [],
  catalogSort: 'bump',
  catalogImageSize: 'small',
  catalogFilter: 'all',
  theme: localStorage.getItem('theme') || 'yotsuba-b',
  archiveThreads: [],
  adminTab: 'pending',
  adminItems: [],
  moderationConfidenceThreshold: 0,
  lifecycle: {
    maxActiveThreadsPerBoard: 150,
    bumpLimit: 300,
    replyLimit: 500
  }
};

const REASON_MACROS = {
  approve: [
    'Nội dung hợp lệ',
    'Đã xác minh an toàn',
    'Nội dung không vi phạm'
  ],
  delete: [
    'Vi phạm nội quy',
    'Nội dung rác/spam',
    'Chứa thông tin cá nhân',
    'Nội dung thù ghét',
    'Tin giả/chưa xác minh'
  ],
  ban: [
    'Spam nhiều lần',
    'Vi phạm nghiêm trọng',
    'Quấy rối người khác',
    'Đăng nội dung bất hợp pháp'
  ],
  cooldown: [
    'Spam nhiều lần',
    'Đăng quá nhanh',
    'Quấy rối người khác'
  ],
  revoke: [
    'Hết hạn xử lý',
    'Xem xét lại, không vi phạm',
    'Yêu cầu gỡ bỏ'
  ],
  restore: [
    'Khôi phục sau khi xem xét lại',
    'Xóa nhầm',
    'Kháng nghị hợp lệ'
  ],
  'bulk-approve': [
    'Nội dung hợp lệ',
    'Đã xác minh an toàn',
    'Duyệt hàng loạt theo đợt'
  ],
  'bulk-delete': [
    'Vi phạm nội quy',
    'Nội dung rác/spam',
    'Xóa hàng loạt theo đợt'
  ]
};

const REPORT_CATEGORIES = [
  { value: 'Spam', label: 'Spam' },
  { value: 'Toxic', label: 'Độc hại' },
  { value: 'PII', label: 'Thông tin cá nhân' },
  { value: 'Fake News', label: 'Tin giả' },
  { value: 'Illegal', label: 'Bất hợp pháp' },
  { value: 'Other', label: 'Khác' }
];

const THREAD_TEMPLATES = [
  {
    key: 'study',
    label: 'Học tập',
    body: 'Mình muốn chia sẻ chuyện học tập:\n- Môn hoặc bối cảnh liên quan: ...\n- Điều đang vướng: ...\n- Mình đã thử: ...\nMong mọi người góp ý theo hướng tôn trọng và không nêu tên thật.'
  },
  {
    key: 'relationship',
    label: 'Tình cảm',
    body: 'Mình muốn kể một chuyện tình cảm ẩn danh:\n- Bối cảnh chung: ...\n- Điều mình đang phân vân: ...\n- Mình cần lời khuyên về: ...\nMong mọi người góp ý nhẹ nhàng, không đoán danh tính.'
  },
  {
    key: 'feedback',
    label: 'Góp ý',
    body: 'Mình muốn góp ý:\n- Vấn đề: ...\n- Ảnh hưởng: ...\n- Gợi ý cải thiện: ...\nMình viết để xây dựng, không nhắm vào cá nhân cụ thể.'
  }
];

const WATCHED_THREAD_SORTS = new Set(['unread', 'recent', 'board']);
const STICKERS = {
  cheer: { icon: '🎉', label: 'Cổ vũ' },
  panic: { icon: '😱', label: 'Hoảng' },
  study: { icon: '📚', label: 'Học' },
  thanks: { icon: '🙏', label: 'Cảm ơn' }
};

const AUDIO_RECORDING_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];
const AI_TRANSCRIBE_TIMEOUT_MS = 60_000;
const AI_SPEAK_TIMEOUT_MS = 60_000;
const AI_TTS_PROVIDER_COOLDOWN_MS = 60_000;

function reportCategoryLabel(value) {
  return REPORT_CATEGORIES.find((category) => category.value === value)?.label || 'Khác';
}

function moderationPriorityLabel(priority = {}) {
  if (priority.level === 'high') {
    return 'Cao';
  }
  if (priority.level === 'medium') {
    return 'Trung bình';
  }
  return 'Thấp';
}

function moderationPriorityHtml(priority = {}) {
  const level = ['high', 'medium', 'low'].includes(priority.level) ? priority.level : 'low';
  const score = Number(priority.score || 0);
  const reportCount = Number(priority.reportCount || 0);
  const details = [
    `Ưu tiên ${moderationPriorityLabel({ level })}: ${score}`,
    reportCount > 0 ? `${reportCount} báo cáo` : '',
    priority.hasPiiRisk ? 'PII' : ''
  ].filter(Boolean);
  return `<span class="priority-badge priority-${level}">${escapeHtml(details.join(' · '))}</span>`;
}

function moderationConfidenceText(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) {
    return 'Không có';
  }
  return `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`;
}

function moderationConfidenceHtml(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) {
    return '';
  }
  return `<span class="priority-badge priority-confidence">Tin cậy ${moderationConfidenceText(confidence)}</span>`;
}

function showReportModal(globalNumber) {
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

    function finish(value) {
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

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        finish(null);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    textarea.focus();
  });
}

function showReasonModal(title, context) {
  return new Promise((resolve) => {
    const macros = REASON_MACROS[context] || REASON_MACROS.approve;
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

    function finish(value) {
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

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        finish(null);
      }
    }

    document.addEventListener('keydown', onKeyDown);

    textarea.focus();
  });
}

function showPostEditModal(globalNumber, initialBody = '', options = {}) {
  return new Promise((resolve) => {
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
      if (files.length > MAX_MEDIA_PER_POST) {
        showToast(`Tối đa ${MAX_MEDIA_PER_POST} tệp mỗi bài viết.`);
        resetSelectedMedia();
        return;
      }
      if (files.some((file) => !isSupportedMediaFile(file))) {
        showToast('Chỉ hỗ trợ ảnh, MP4 hoặc WebM.');
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
}

function getPosterToken() {
  const key = 'posterToken';
  const current = localStorage.getItem(key);
  if (current) {
    return current;
  }
  const next =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(key, next);
  return next;
}

function threadLastSeenKey(threadId) {
  return `threadLastSeen:${threadId}`;
}

function readThreadLastSeen(threadId) {
  const value = Number(localStorage.getItem(threadLastSeenKey(threadId)) || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function writeThreadLastSeen(threadId, globalNumber) {
  const value = Number(globalNumber);
  if (threadId && Number.isFinite(value) && value > 0) {
    localStorage.setItem(threadLastSeenKey(threadId), String(Math.floor(value)));
  }
}

const watchedThreadsKey = 'watchedThreads';
const savedSearchesKey = 'savedSearches';
const contentFiltersKey = 'contentFilters';
const replyTemplatesKey = 'replyTemplates';
const posterNotesKey = 'posterNotes';
const myPostsKey = 'myPosts';
const hiddenThreadsKey = 'hiddenThreads';
const hiddenPostsKey = 'hiddenPosts';
const deletePasswordKey = 'deletePassword';
const subscribedBoardsKey = 'subscribedBoards';
const themeKey = 'theme';
const homeBoardKey = 'homeBoard';
const displayPreferencesKey = 'displayPreferences';
const notificationPreferencesKey = 'notificationPreferences';
const boardThreadsCachePrefix = 'boardThreadsCache:';
const aiNotConfiguredMessage =
  'Chưa cấu hình Google AI Studio. Thêm GOOGLE_AI_API_KEY vào backend/.env để dùng tính năng AI này.';
const MAX_MEDIA_PER_POST = 4;
const SUPPORTED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
const SUPPORTED_THEMES = ['yotsuba-b', 'yotsuba', 'tomorrow', 'burichan'];
const API_BASE_URL = String(import.meta.env?.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const REALTIME_URL = String(import.meta.env?.VITE_SOCKET_URL || '/events').trim() || '/events';

function withUrlBase(path, baseUrl) {
  if (!baseUrl || /^[a-z][a-z\d+\-.]*:/i.test(path)) {
    return path;
  }
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${safePath}`;
}

function realtimeEndpoint(contextKey = '') {
  const url = withUrlBase(REALTIME_URL, API_BASE_URL);
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${contextKey ? `${separator}${contextKey}` : ''}`;
}

function readWatchedThreads() {
  if (state.accountToken && state.accountPrivateData) {
    return Object.fromEntries((state.accountPrivateData.watchlist || []).map((item) => [item.threadId, item]));
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(watchedThreadsKey) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(([threadId, item]) => threadId && item && typeof item === 'object')
    );
  } catch {
    return {};
  }
}

function writeWatchedThreads(watchedThreads) {
  localStorage.setItem(watchedThreadsKey, JSON.stringify(watchedThreads));
  if (state.accountToken && state.accountPrivateData) {
    state.accountPrivateData.watchlist = Object.values(watchedThreads).filter((item) => item?.threadId);
    scheduleAccountPrivateDataSave();
  }
}

function isThreadWatched(threadId = state.threadId) {
  return Boolean(threadId && readWatchedThreads()[threadId]);
}

function readJsonLocal(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonLocal(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readLocalList(key) {
  const value = readJsonLocal(key, []);
  return Array.isArray(value) ? value : [];
}

function normalizeWatchedSort(value) {
  return WATCHED_THREAD_SORTS.has(value) ? value : 'unread';
}

function syncWatchedControls({
  unreadOnly = localDisplayPreferences().watchedUnreadOnly,
  unreadCount = state.watchedThreadSummaries.filter((item) => Number(item.unreadCount || 0) > 0).length
} = {}) {
  if (!els?.watchedUnreadToggle && !els?.watchedMarkAllRead && !els?.watchedSortSelect) {
    return;
  }
  if (els.watchedSortSelect) {
    els.watchedSortSelect.value = localDisplayPreferences().watchedSort;
  }
  if (els.watchedUnreadToggle) {
    els.watchedUnreadToggle.textContent = unreadCount ? `chưa đọc ${unreadCount}` : 'chưa đọc';
    els.watchedUnreadToggle.classList.toggle('active', unreadOnly);
    els.watchedUnreadToggle.setAttribute('aria-pressed', String(unreadOnly));
  }
  if (els.watchedMarkAllRead) {
    els.watchedMarkAllRead.disabled = unreadCount === 0;
    els.watchedMarkAllRead.title = unreadCount
      ? `Đánh dấu ${unreadCount} chủ đề là đã đọc`
      : 'Không có chủ đề chưa đọc';
  }
}

function localDisplayPreferences() {
  const value = readJsonLocal(displayPreferencesKey, {});
  return {
    compactThreads: Boolean(value.compactThreads),
    hideThumbnails: Boolean(value.hideThumbnails),
    watchedUnreadOnly: Boolean(value.watchedUnreadOnly),
    watchedSort: normalizeWatchedSort(value.watchedSort)
  };
}

function writeLocalDisplayPreferences(preferences = {}) {
  const safe = {
    compactThreads: Boolean(preferences.compactThreads),
    hideThumbnails: Boolean(preferences.hideThumbnails),
    watchedUnreadOnly: Boolean(preferences.watchedUnreadOnly),
    watchedSort: normalizeWatchedSort(preferences.watchedSort)
  };
  writeJsonLocal(displayPreferencesKey, safe);
  return safe;
}

function localNotificationPreferences() {
  const value = readJsonLocal(notificationPreferencesKey, {});
  return {
    email: Boolean(value.email),
    watchedThreads: value.watchedThreads !== false,
    boardSubscriptions: Boolean(value.boardSubscriptions),
    browserWatchedThreads: Boolean(value.browserWatchedThreads)
  };
}

function writeLocalNotificationPreferences(preferences = {}) {
  const safe = {
    email: Boolean(preferences.email),
    watchedThreads: preferences.watchedThreads !== false,
    boardSubscriptions: Boolean(preferences.boardSubscriptions),
    browserWatchedThreads: Boolean(preferences.browserWatchedThreads)
  };
  writeJsonLocal(notificationPreferencesKey, safe);
  return safe;
}

function addLocalSetItem(key, value) {
  const items = new Set(readLocalList(key).map(String));
  items.add(String(value));
  writeJsonLocal(key, [...items]);
}

function defaultDeletePassword() {
  const current = localStorage.getItem(deletePasswordKey);
  if (current) {
    return current;
  }
  const next = Math.random().toString(36).slice(2, 10);
  localStorage.setItem(deletePasswordKey, next);
  return next;
}

function normalizeDeletePassword(value = '') {
  return String(value ?? '').trim().slice(0, 120);
}

function syncDeletePasswordInputs(value = defaultDeletePassword()) {
  const password = String(value ?? '');
  els.deletePasswordInputs.forEach((input) => {
    if (input.value !== password) {
      input.value = password;
    }
  });
}

function updateDeletePassword(value) {
  const password = normalizeDeletePassword(value);
  if (password) {
    localStorage.setItem(deletePasswordKey, password);
  } else {
    localStorage.removeItem(deletePasswordKey);
  }
  syncDeletePasswordInputs(password);
  return password;
}

function deletePasswordValue(form) {
  const typedPassword = normalizeDeletePassword(formValue(form, 'deletePassword'));
  const password = typedPassword || defaultDeletePassword();
  localStorage.setItem(deletePasswordKey, password);
  syncDeletePasswordInputs(password);
  return password;
}

function draftKey(kind, id) {
  return `draft:${kind}:${id}`;
}

function defaultAccountPrivateData() {
  return {
    watchlist: [],
    drafts: [],
    savedSearches: [],
    contentFilters: [],
    replyTemplates: [],
    posterNotes: []
  };
}

function safePrivateText(value = '', maxLength = 160) {
  return [...String(value ?? '')]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, maxLength);
}

function normalizeContentFilters(value = []) {
  const allowedTypes = new Set(['keyword', 'poster', 'thread', 'post']);
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      id: safePrivateText(item?.id || item?.key || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, 120),
      type: safePrivateText(item?.type, 40).toLowerCase(),
      value: safePrivateText(item?.value || item?.keyword || item?.posterHash || item?.threadId || item?.globalNumber, 160),
      label: safePrivateText(item?.label, 180),
      boardSlug: safePrivateText(item?.boardSlug, 80),
      createdAt: safePrivateText(item?.createdAt || new Date().toISOString(), 80)
    }))
    .filter((item) => allowedTypes.has(item.type) && item.value)
    .filter((item) => {
      const key = `${item.type}:${item.boardSlug}:${item.value.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 80);
}

function normalizeReplyTemplates(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      id: safePrivateText(item?.id || item?.key || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, 120),
      title: safePrivateText(item?.title || item?.label || 'Mẫu trả lời', 120),
      body: safePrivateText(item?.body || item?.text, 5000),
      boardSlug: safePrivateText(item?.boardSlug, 80),
      createdAt: safePrivateText(item?.createdAt || new Date().toISOString(), 80),
      updatedAt: safePrivateText(item?.updatedAt || item?.createdAt || new Date().toISOString(), 80)
    }))
    .filter((item) => item.body)
    .filter((item) => {
      const key = `${item.boardSlug}:${item.title.toLowerCase()}:${item.body}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 60);
}

function normalizePosterNotes(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      id: safePrivateText(item?.id || item?.key || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, 120),
      posterId: safePrivateText(item?.posterId || item?.posterHash || item?.idText, 80),
      label: safePrivateText(item?.label, 120),
      note: safePrivateText(item?.note || item?.body || item?.text, 500),
      boardSlug: safePrivateText(item?.boardSlug, 80),
      createdAt: safePrivateText(item?.createdAt || new Date().toISOString(), 80),
      updatedAt: safePrivateText(item?.updatedAt || item?.createdAt || new Date().toISOString(), 80)
    }))
    .filter((item) => item.posterId)
    .filter((item) => {
      const key = `${item.boardSlug}:${item.posterId.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 120);
}

function accountDraftSyncEnabled() {
  return state.account?.settings?.syncDrafts !== false;
}

function readSavedSearches() {
  if (state.accountToken && state.accountPrivateData) {
    return Array.isArray(state.accountPrivateData.savedSearches) ? state.accountPrivateData.savedSearches : [];
  }
  return readLocalList(savedSearchesKey).filter((item) => item && typeof item === 'object');
}

function writeSavedSearches(savedSearches) {
  const items = savedSearches.filter((item) => item?.boardSlug && item?.query).slice(0, 50);
  writeJsonLocal(savedSearchesKey, items);
  if (state.accountToken && state.accountPrivateData) {
    state.accountPrivateData.savedSearches = items;
    scheduleAccountPrivateDataSave();
  }
}

function privateItemId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readContentFilters() {
  if (state.accountToken && state.accountPrivateData) {
    return normalizeContentFilters(state.accountPrivateData.contentFilters);
  }
  return normalizeContentFilters(readLocalList(contentFiltersKey));
}

function writeContentFilters(filters) {
  const items = normalizeContentFilters(filters);
  writeJsonLocal(contentFiltersKey, items);
  if (state.accountToken && state.accountPrivateData) {
    state.accountPrivateData.contentFilters = items;
    scheduleAccountPrivateDataSave();
  }
  return items;
}

function addContentFilter(filter) {
  return writeContentFilters([{ id: privateItemId(), createdAt: new Date().toISOString(), ...filter }, ...readContentFilters()]);
}

function removeContentFilter(id) {
  return writeContentFilters(readContentFilters().filter((filter) => filter.id !== id));
}

function readReplyTemplates() {
  if (state.accountToken && state.accountPrivateData) {
    return normalizeReplyTemplates(state.accountPrivateData.replyTemplates);
  }
  return normalizeReplyTemplates(readLocalList(replyTemplatesKey));
}

function writeReplyTemplates(templates) {
  const items = normalizeReplyTemplates(templates);
  writeJsonLocal(replyTemplatesKey, items);
  if (state.accountToken && state.accountPrivateData) {
    state.accountPrivateData.replyTemplates = items;
    scheduleAccountPrivateDataSave();
  }
  return items;
}

function addReplyTemplate(template) {
  return writeReplyTemplates([
    { id: privateItemId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...template },
    ...readReplyTemplates()
  ]);
}

function removeReplyTemplate(id) {
  return writeReplyTemplates(readReplyTemplates().filter((template) => template.id !== id));
}

function readPosterNotes() {
  if (state.accountToken && state.accountPrivateData) {
    return normalizePosterNotes(state.accountPrivateData.posterNotes);
  }
  return normalizePosterNotes(readLocalList(posterNotesKey));
}

function writePosterNotes(notes) {
  const items = normalizePosterNotes(notes);
  writeJsonLocal(posterNotesKey, items);
  if (state.accountToken && state.accountPrivateData) {
    state.accountPrivateData.posterNotes = items;
    scheduleAccountPrivateDataSave();
  }
  return items;
}

function addPosterNote(note) {
  return writePosterNotes([
    { id: privateItemId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...note },
    ...readPosterNotes()
  ]);
}

function removePosterNote(id) {
  return writePosterNotes(readPosterNotes().filter((note) => note.id !== id));
}

function posterNoteForPost(post = {}) {
  const poster = normalizeSearchValue(posterId(post));
  const posterHash = normalizeSearchValue(post.posterHash || '');
  if (!poster || poster === 'id:????') {
    return null;
  }
  const boardSlug = String(post.boardSlug || state.boardSlug || '');
  const notes = readPosterNotes();
  const matchesPoster = (note) => {
    const notePoster = normalizeSearchValue(note.posterId);
    return notePoster === poster || (posterHash && notePoster === posterHash);
  };
  return (
    notes.find((note) => matchesPoster(note) && note.boardSlug === boardSlug) ||
    notes.find((note) => matchesPoster(note) && !note.boardSlug) ||
    null
  );
}

function postPlainText(post = {}) {
  return [
    post.subject,
    post.body,
    post.preview,
    plainPreview(post.bodyLines, ''),
    postDisplayName(post),
    post.tripcode,
    post.capcode,
    posterId(post),
    post.globalNumber ? 'No.' + post.globalNumber : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function contentFilterMatch(post = {}) {
  const filters = readContentFilters();
  if (!filters.length || !post) {
    return null;
  }
  const boardSlug = String(post.boardSlug || state.boardSlug || '');
  const haystack = normalizeSearchValue(postPlainText(post));
  const poster = normalizeSearchValue(posterId(post));
  const threadId = String(post.threadId || post.id || '');
  const globalNumber = String(post.globalNumber || '');
  return (
    filters.find((filter) => {
      if (filter.boardSlug && filter.boardSlug !== boardSlug) {
        return false;
      }
      const value = normalizeSearchValue(filter.value);
      if (!value) {
        return false;
      }
      if (filter.type === 'keyword') {
        return haystack.includes(value);
      }
      if (filter.type === 'poster') {
        return poster === value || poster.includes(value);
      }
      if (filter.type === 'thread') {
        return threadId === filter.value || globalNumber === filter.value;
      }
      if (filter.type === 'post') {
        return globalNumber === filter.value;
      }
      return false;
    }) || null
  );
}

function isPostFiltered(post) {
  return Boolean(contentFilterMatch(post));
}

function parseDraftKey(key = '') {
  const [, kind = '', id = ''] = String(key).split(':');
  return { kind, id };
}

function localDraftEntries() {
  const drafts = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('draft:')) {
      continue;
    }
    const body = localStorage.getItem(key) || '';
    if (!body) {
      continue;
    }
    const { kind, id } = parseDraftKey(key);
    drafts.push({ key, kind, id, body, updatedAt: new Date().toISOString() });
  }
  return drafts;
}

function readDraft(key) {
  if (state.accountToken && state.accountPrivateData && accountDraftSyncEnabled()) {
    const draft = (state.accountPrivateData.drafts || []).find((item) => item.key === key);
    if (draft) {
      return draft.body || '';
    }
  }
  return localStorage.getItem(key) || '';
}

function writeDraft(key, body) {
  localStorage.setItem(key, body);
  if (!state.accountToken || !state.accountPrivateData || !accountDraftSyncEnabled()) {
    return;
  }
  const { kind, id } = parseDraftKey(key);
  const drafts = (state.accountPrivateData.drafts || []).filter((item) => item.key !== key);
  if (body) {
    drafts.unshift({
      key,
      kind,
      id,
      boardSlug: kind === 'thread' ? id : state.boardSlug,
      threadId: kind === 'comment' || kind === 'quickReply' ? id : '',
      body,
      updatedAt: new Date().toISOString()
    });
  }
  state.accountPrivateData.drafts = drafts.slice(0, 40);
  scheduleAccountPrivateDataSave();
}

function removeDraft(key) {
  localStorage.removeItem(key);
  if (state.accountToken && state.accountPrivateData && accountDraftSyncEnabled()) {
    state.accountPrivateData.drafts = (state.accountPrivateData.drafts || []).filter((item) => item.key !== key);
    scheduleAccountPrivateDataSave();
  }
}

function writeTextareaValue(textarea, value) {
  textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function composerTextarea(target) {
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

function insertComposerBlock(target, text) {
  const textarea = composerTextarea(target);
  const body = String(text || '').trim();
  if (!textarea || !body) {
    return;
  }
  const value = textarea.value;
  const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : value.length;
  const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
  const prefix = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const suffix = value[end] && value[end] !== '\n' ? '\n' : '';
  const insertText = `${prefix}${body}${suffix}`;
  const maxLength = Number(textarea.maxLength);
  if (Number.isFinite(maxLength) && maxLength > 0 && value.length - (end - start) + insertText.length > maxLength) {
    showToast('Nội dung đã đạt giới hạn ký tự.');
    textarea.focus();
    return;
  }
  textarea.setRangeText(insertText, start, end, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function insertReplyTemplate(target, id) {
  const template = readReplyTemplates().find((item) => item.id === id);
  if (!template) {
    showToast('Không tìm thấy mẫu trả lời.');
    return;
  }
  insertComposerBlock(target, template.body);
}

function defaultReplyTemplateTitle(body = '') {
  return safePrivateText(String(body).split(/\n/).find(Boolean) || 'Mẫu trả lời', 48);
}

function saveComposerReplyTemplate(target) {
  const textarea = composerTextarea(target);
  const body = textarea?.value.trim() || '';
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
  renderReplyTemplatePickers();
  showToast('Đã lưu mẫu trả lời.');
}

function insertComposerToken(target, token) {
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
    showToast('Nội dung đã đạt giới hạn ký tự.');
    textarea.focus();
    return;
  }
  textarea.setRangeText(insertText, start, end, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function insertThreadTemplate(key) {
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
  showToast(`Đã chèn mẫu ${template.label}. Bạn có thể sửa trước khi gửi.`);
}

function dismissThreadTemplate() {
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
    showToast('Mẫu đã được sửa; xóa phần không cần trong ô bình luận.');
    els.threadBody.focus();
    return;
  }
  delete els.threadBody.dataset.threadTemplateKey;
  els.threadBody.focus();
  showToast('Đã bỏ mẫu khỏi nháp.');
}

function myPosts() {
  return readLocalList(myPostsKey).filter((item) => item && typeof item === 'object');
}

// Cached set of the viewer's own post numbers, used to stamp "(You)" on their
// posts and on quotes pointing at them. Rebuilt lazily and invalidated whenever
// a new post is remembered.
let myPostNumberCache = null;
function myPostNumberSet() {
  if (!myPostNumberCache) {
    myPostNumberCache = new Set(myPosts().map((item) => Number(item.globalNumber)));
  }
  return myPostNumberCache;
}

function isMyPost(post) {
  const number = Number(post?.globalNumber);
  return Number.isFinite(number) && myPostNumberSet().has(number);
}

function myPostEntry(globalNumber) {
  const number = Number(globalNumber);
  if (!Number.isFinite(number)) {
    return null;
  }
  return myPosts().find((item) => Number(item.globalNumber) === number) || null;
}

function isAnonymousMyPost(post) {
  const entry = myPostEntry(post?.globalNumber);
  return Boolean(entry && entry.owner === 'anonymous' && entry.deletePassword);
}

function myPostDeletePassword(globalNumber) {
  const entry = myPostEntry(globalNumber);
  return normalizeDeletePassword(entry?.deletePassword) || defaultDeletePassword();
}

function isAccountPost(post) {
  const number = Number(post?.globalNumber);
  return Boolean(state.accountToken && state.account && Number.isFinite(number) && state.accountPostNumbers.has(number));
}

async function refreshAccountPostNumbers() {
  if (!state.accountToken || !state.account) {
    state.accountPostNumbers = new Set();
    return;
  }
  try {
    const items = await api('/api/account/posts', { auth: 'account' });
    state.accountPostNumbers = new Set(
      (items || [])
        .map((item) => Number((item.post || item)?.globalNumber))
        .filter(Number.isFinite)
    );
  } catch (error) {
    if (/đăng nhập|Phiên/.test(error.message)) {
      setAccountSession();
      return;
    }
    console.warn('Không tải được danh sách bài của tài khoản:', error);
  }
}
function rememberMyPost(post, type) {
  if (!post?.globalNumber) {
    return;
  }
  const accountOwned = Boolean(state.accountToken && state.account);
  const items = myPosts().filter((item) => Number(item.globalNumber) !== Number(post.globalNumber));
  items.unshift({
    type,
    owner: accountOwned ? 'account' : 'anonymous',
    deletePassword: accountOwned ? undefined : defaultDeletePassword(),
    threadId: post.threadId || post.id || state.threadId,
    boardSlug: post.boardSlug || state.boardSlug,
    globalNumber: post.globalNumber,
    preview: plainPreview(post.bodyLines, post.body || 'Không có nội dung').slice(0, 160),
    createdAt: post.createdAt || new Date().toISOString()
  });
  writeJsonLocal(myPostsKey, items.slice(0, 50));
  myPostNumberCache = null;
  if (state.accountToken && state.account) {
    state.accountPostNumbers.add(Number(post.globalNumber));
  }
}

function hiddenThreadIds() {
  return new Set(readLocalList(hiddenThreadsKey).map(String));
}

function hiddenPostNumbers() {
  return new Set(readLocalList(hiddenPostsKey).map(String));
}

function subscribedBoardSlugs() {
  return new Set(readLocalList(subscribedBoardsKey).map(String));
}

function writeSubscribedBoardSlugs(slugs = []) {
  const items = [...new Set(slugs.map((slug) => String(slug).trim()).filter(Boolean))];
  writeJsonLocal(subscribedBoardsKey, items);
  return items;
}

function isBoardSubscribed(slug = state.boardSlug) {
  return subscribedBoardSlugs().has(String(slug));
}

async function toggleBoardSubscription(slug = state.boardSlug) {
  const items = subscribedBoardSlugs();
  if (items.has(slug)) {
    items.delete(slug);
    showToast('Đã bỏ theo dõi bảng.');
  } else {
    items.add(slug);
    showToast('Đã theo dõi bảng.');
  }
  writeSubscribedBoardSlugs([...items]);
  await persistAccountSettings({ silent: true });
}

function applyTheme(theme = state.theme) {
  const safeTheme = SUPPORTED_THEMES.includes(theme) ? theme : 'yotsuba-b';
  state.theme = safeTheme;
  document.body.classList.remove(...SUPPORTED_THEMES.map((item) => `theme-${item}`));
  document.body.classList.add(`theme-${safeTheme}`);
  localStorage.setItem(themeKey, safeTheme);
  document.querySelectorAll('[data-theme-select]').forEach((select) => {
    select.value = safeTheme;
  });
}

function applyDisplayPreferences(preferences = localDisplayPreferences()) {
  const safe = writeLocalDisplayPreferences(preferences);
  document.body.classList.toggle('display-compact', safe.compactThreads);
  document.body.classList.toggle('display-hide-thumbnails', safe.hideThumbnails);
  if (els?.accountCompactThreads) {
    els.accountCompactThreads.checked = safe.compactThreads;
  }
  if (els?.accountHideThumbnails) {
    els.accountHideThumbnails.checked = safe.hideThumbnails;
  }
  if (els?.accountWatchedUnreadOnly) {
    els.accountWatchedUnreadOnly.checked = safe.watchedUnreadOnly;
  }
  if (els?.accountWatchedSort) {
    els.accountWatchedSort.value = safe.watchedSort;
  }
  syncWatchedControls({ unreadOnly: safe.watchedUnreadOnly });
  return safe;
}

function applyNotificationPreferences(preferences = localNotificationPreferences()) {
  const safe = writeLocalNotificationPreferences(preferences);
  if (els?.accountEmailNotifications) {
    els.accountEmailNotifications.checked = safe.email;
  }
  if (els?.accountNotifyWatchedThreads) {
    els.accountNotifyWatchedThreads.checked = safe.watchedThreads;
  }
  if (els?.accountNotifyBoardSubscriptions) {
    els.accountNotifyBoardSubscriptions.checked = safe.boardSubscriptions;
  }
  syncBrowserNotificationControls(safe);
  return safe;
}

function browserNotificationsSupported() {
  return typeof window !== 'undefined' && typeof window.Notification !== 'undefined';
}

function browserNotificationPermission() {
  if (!browserNotificationsSupported()) {
    return 'unsupported';
  }
  return window.Notification.permission || 'default';
}

function syncBrowserNotificationControls(preferences = localNotificationPreferences()) {
  if (!els?.accountBrowserNotifyWatchedThreads) {
    return;
  }
  const supported = browserNotificationsSupported();
  const permission = browserNotificationPermission();
  els.accountBrowserNotifyWatchedThreads.checked = Boolean(preferences.browserWatchedThreads);
  els.accountBrowserNotifyWatchedThreads.disabled = !supported;
  if (!els.accountBrowserNotificationsStatus) {
    return;
  }
  if (!supported) {
    els.accountBrowserNotificationsStatus.textContent = 'Trình duyệt này không hỗ trợ browser notifications.';
  } else if (permission === 'denied') {
    els.accountBrowserNotificationsStatus.textContent = 'Trình duyệt đang chặn browser notifications cho trang này.';
  } else if (permission === 'granted' && preferences.browserWatchedThreads) {
    els.accountBrowserNotificationsStatus.textContent = 'Browser notifications cho thread đang theo dõi đang bật.';
  } else if (permission === 'granted') {
    els.accountBrowserNotificationsStatus.textContent = 'Đã cấp quyền browser notification; tùy chọn đang tắt.';
  } else if (preferences.browserWatchedThreads) {
    els.accountBrowserNotificationsStatus.textContent = 'Cần cấp quyền browser notification khi lưu settings.';
  } else {
    els.accountBrowserNotificationsStatus.textContent = 'Tắt browser notifications cho thread đang theo dõi.';
  }
}

async function resolveBrowserWatchedThreadPreference(requested) {
  if (!requested) {
    return false;
  }
  if (!browserNotificationsSupported()) {
    showToast('Trình duyệt này không hỗ trợ browser notifications.');
    return false;
  }
  const permission = browserNotificationPermission();
  if (permission === 'granted') {
    return true;
  }
  if (permission === 'denied') {
    showToast('Browser notifications đang bị chặn trong trình duyệt.');
    return false;
  }
  if (typeof window.Notification.requestPermission !== 'function') {
    showToast('Không thể xin quyền browser notification trên trình duyệt này.');
    return false;
  }
  try {
    const result = await window.Notification.requestPermission();
    if (result === 'granted') {
      return true;
    }
    showToast(result === 'denied' ? 'Browser notifications đã bị từ chối.' : 'Chưa cấp quyền browser notification.');
    return false;
  } catch {
    showToast('Không thể xin quyền browser notification.');
    return false;
  }
}

const els = {
  homeScreen: document.querySelector('#homeScreen'),
  policyScreen: document.querySelector('#policyScreen'),
  appealForm: document.querySelector('#appealForm'),
  appealToken: document.querySelector('#appealToken'),
  appealReason: document.querySelector('#appealReason'),
  appealError: document.querySelector('#appealError'),
  appealResult: document.querySelector('#appealResult'),
  homeBoards: document.querySelector('#homeBoards'),
  homeBoardSearchForm: document.querySelector('#homeBoardSearchForm'),
  homeBoardSearchInput: document.querySelector('#homeBoardSearchInput'),
  popularThreads: document.querySelector('#popularThreads'),
  latestPosts: document.querySelector('#latestPosts'),
  watchedThreads: document.querySelector('#watchedThreads'),
  watchedSortSelect: document.querySelector('#watchedSortSelect'),
  watchedUnreadToggle: document.querySelector('#watchedUnreadToggle'),
  watchedMarkAllRead: document.querySelector('#watchedMarkAllRead'),
  myPosts: document.querySelector('#myPosts'),
  subscribedBoards: document.querySelector('#subscribedBoards'),
  hotBoards: document.querySelector('#hotBoards'),
  campusPulse: document.querySelector('#campusPulse'),
  homeStats: document.querySelector('#homeStats'),
  serverStats: document.querySelector('#serverStats'),
  boardNav: document.querySelector('#boardNav'),
  accountLoginLink: document.querySelector('#accountLoginLink'),
  accountRegisterLink: document.querySelector('#accountRegisterLink'),
  accountSettingsLink: document.querySelector('#accountSettingsLink'),
  accountLogoutButton: document.querySelector('#accountLogoutButton'),
  socketStatus: document.querySelector('#socketStatus'),
  boardScreen: document.querySelector('#boardScreen'),
  catalogScreen: document.querySelector('#catalogScreen'),
  archiveScreen: document.querySelector('#archiveScreen'),
  threadScreen: document.querySelector('#threadScreen'),
  registerScreen: document.querySelector('#registerScreen'),
  loginScreen: document.querySelector('#loginScreen'),
  accountScreen: document.querySelector('#accountScreen'),
  adminScreen: document.querySelector('#adminScreen'),
  boardTitle: document.querySelector('#boardTitle'),
  boardPath: document.querySelector('#boardPath'),
  boardDescription: document.querySelector('#boardDescription'),
  boardSearchInput: document.querySelector('#boardSearchInput'),
  saveBoardSearchButton: document.querySelector('#saveBoardSearchButton'),
  boardCatalogLink: document.querySelector('#boardCatalogLink'),
  boardArchiveLink: document.querySelector('#boardArchiveLink'),
  boardJsonFeedLink: document.querySelector('#boardJsonFeedLink'),
  boardRssFeedLink: document.querySelector('#boardRssFeedLink'),
  boardCatalogLinkBottom: document.querySelector('#boardCatalogLinkBottom'),
  boardArchiveLinkBottom: document.querySelector('#boardArchiveLinkBottom'),
  boardJsonFeedLinkBottom: document.querySelector('#boardJsonFeedLinkBottom'),
  boardRssFeedLinkBottom: document.querySelector('#boardRssFeedLinkBottom'),
  threadList: document.querySelector('#threadList'),
  boardPagination: document.querySelector('#boardPagination'),
  catalogTitle: document.querySelector('#catalogTitle'),
  catalogDescription: document.querySelector('#catalogDescription'),
  catalogSearchInput: document.querySelector('#catalogSearchInput'),
  catalogGrid: document.querySelector('#catalogGrid'),
  catalogReturnTop: document.querySelector('#catalogReturnTop'),
  catalogReturnBottom: document.querySelector('#catalogReturnBottom'),
  archiveTitle: document.querySelector('#archiveTitle'),
  archiveDescription: document.querySelector('#archiveDescription'),
  archiveReturnTop: document.querySelector('#archiveReturnTop'),
  archiveReturnBottom: document.querySelector('#archiveReturnBottom'),
  archiveList: document.querySelector('#archiveList'),
  startThreadButton: document.querySelector('#startThreadButton'),
  threadStartThreadButton: document.querySelector('#threadStartThreadButton'),
  threadComposer: document.querySelector('#threadComposer'),
  threadForm: document.querySelector('#threadForm'),
  threadBody: document.querySelector('#threadBody'),
  threadPollOptions: document.querySelector('#threadPollOptions'),
  threadPrivacyWarning: document.querySelector('#threadPrivacyWarning'),
  threadRewriteButton: document.querySelector('#threadRewriteButton'),
  threadRewriteTone: document.querySelector('#threadRewriteTone'),
  threadAiRewriteLabel: document.querySelector('#threadAiRewriteLabel'),
  threadImage: document.querySelector('#threadImage'),
  threadAudio: document.querySelector('#threadAudio'),
  threadRecordButton: document.querySelector('#threadRecordButton'),
  threadCaptionButton: document.querySelector('#threadCaptionButton'),
  threadOcrButton: document.querySelector('#threadOcrButton'),
  translateTarget: document.querySelector('#translateTarget'),
  threadCaptcha: document.querySelector('#threadCaptcha'),
  imagePreview: document.querySelector('#imagePreview'),
  refreshThreads: document.querySelector('#refreshThreads'),
  boardSummaryButton: document.querySelector('#boardSummaryButton'),
  boardSummary: document.querySelector('#boardSummary'),
  backToBoard: document.querySelector('#backToBoard'),
  threadTitle: document.querySelector('#threadTitle'),
  threadAdminActions: document.querySelector('#threadAdminActions'),
  threadBoardPath: document.querySelector('#threadBoardPath'),
  threadBoardDescription: document.querySelector('#threadBoardDescription'),
  threadToolbarTop: document.querySelector('#threadToolbarTop'),
  threadToolbarBottom: document.querySelector('#threadToolbarBottom'),
  threadSummaryButton: document.querySelector('#threadSummaryButton'),
  threadSummary: document.querySelector('#threadSummary'),
  postReplyToggle: document.querySelector('#postReplyToggle'),
  replyComposer: document.querySelector('#replyComposer'),
  threadDetail: document.querySelector('#threadDetail'),
  threadPagination: document.querySelector('#threadPagination'),
  commentForm: document.querySelector('#commentForm'),
  commentBody: document.querySelector('#commentBody'),
  commentPrivacyWarning: document.querySelector('#commentPrivacyWarning'),
  commentCaptcha: document.querySelector('#commentCaptcha'),
  commentImage: document.querySelector('#commentImage'),
  commentAudio: document.querySelector('#commentAudio'),
  commentRecordButton: document.querySelector('#commentRecordButton'),
  commentCaptionButton: document.querySelector('#commentCaptionButton'),
  commentOcrButton: document.querySelector('#commentOcrButton'),
  commentImagePreview: document.querySelector('#commentImagePreview'),
  suggestButton: document.querySelector('#suggestButton'),
  rewriteButton: document.querySelector('#rewriteButton'),
  rewriteTone: document.querySelector('#rewriteTone'),
  commentAiRewriteLabel: document.querySelector('#commentAiRewriteLabel'),
  suggestions: document.querySelector('#suggestions'),
  adminTitle: document.querySelector('#adminTitle'),
  loginForm: document.querySelector('#loginForm'),
  adminUsername: document.querySelector('#adminUsername'),
  adminPassword: document.querySelector('#adminPassword'),
  admin2FAVerifyForm: document.querySelector('#admin2FAVerifyForm'),
  admin2FAVerifyError: document.querySelector('#admin2FAVerifyError'),
  admin2FACode: document.querySelector('#admin2FACode'),
  admin2FACancelButton: document.querySelector('#admin2FACancelButton'),
  admin2FASetupPanel: document.querySelector('#admin2FASetupPanel'),
  admin2FASetupStart: document.querySelector('#admin2FASetupStart'),
  adminStart2FAButton: document.querySelector('#adminStart2FAButton'),
  admin2FASetupQR: document.querySelector('#admin2FASetupQR'),
  admin2FAQRImage: document.querySelector('#admin2FAQRImage'),
  admin2FABackupCodes: document.querySelector('#admin2FABackupCodes'),
  admin2FASetupCode: document.querySelector('#admin2FASetupCode'),
  adminVerify2FASetupButton: document.querySelector('#adminVerify2FASetupButton'),
  adminLoginPasskeyButton: document.querySelector('#adminLoginPasskeyButton'),
  adminPasskeysPanel: document.querySelector('#adminPasskeysPanel'),
  adminPasskeysList: document.querySelector('#adminPasskeysList'),
  adminAddPasskeyButton: document.querySelector('#adminAddPasskeyButton'),
  logoutButton: document.querySelector('#logoutButton'),
  adminTools: document.querySelector('#adminTools'),
  adminBoardFilter: document.querySelector('#adminBoardFilter'),
  adminLabelFilter: document.querySelector('#adminLabelFilter'),
  adminReportCategoryFilterWrap: document.querySelector('#adminReportCategoryFilterWrap'),
  adminReportCategoryFilter: document.querySelector('#adminReportCategoryFilter'),
  adminTimeFilter: document.querySelector('#adminTimeFilter'),
  adminPriorityFilterWrap: document.querySelector('#adminPriorityFilterWrap'),
  adminPriorityFilter: document.querySelector('#adminPriorityFilter'),
  adminConfidenceFilterWrap: document.querySelector('#adminConfidenceFilterWrap'),
  adminConfidenceFilter: document.querySelector('#adminConfidenceFilter'),
  adminPrioritySortWrap: document.querySelector('#adminPrioritySortWrap'),
  adminPrioritySort: document.querySelector('#adminPrioritySort'),
  adminQueueThresholdInput: document.querySelector('#adminQueueThresholdInput'),
  adminSaveModerationSettings: document.querySelector('#adminSaveModerationSettings'),
  adminRefresh: document.querySelector('#adminRefresh'),
  adminExport: document.querySelector('#adminExport'),
  adminBulkBar: document.querySelector('#adminBulkBar'),
  adminSelectAll: document.querySelector('#adminSelectAll'),
  adminBulkApprove: document.querySelector('#adminBulkApprove'),
  adminBulkDelete: document.querySelector('#adminBulkDelete'),
  pendingList: document.querySelector('#pendingList'),
  reportSection: document.querySelector('#reportSection'),
  reportList: document.querySelector('#reportList'),
  moderationSection: document.querySelector('#moderationSection'),
  moderationActions: document.querySelector('#moderationActions'),
  registerForm: document.querySelector('#registerForm'),
  registerUsername: document.querySelector('#registerUsername'),
  registerPassword: document.querySelector('#registerPassword'),
  registerCaptcha: document.querySelector('#registerCaptcha'),
  registerError: document.querySelector('#registerError'),
  registerRecoveryNotice: document.querySelector('#registerRecoveryNotice'),
  registerRecoveryCode: document.querySelector('#registerRecoveryCode'),
  registerRecoveryCopy: document.querySelector('#registerRecoveryCopy'),
  registerRecoveryContinue: document.querySelector('#registerRecoveryContinue'),
  forgotScreen: document.querySelector('#forgotScreen'),
  forgotPasswordForm: document.querySelector('#forgotPasswordForm'),
  forgotUsername: document.querySelector('#forgotUsername'),
  forgotRecoveryCode: document.querySelector('#forgotRecoveryCode'),
  forgotNewPassword: document.querySelector('#forgotNewPassword'),
  forgotCaptcha: document.querySelector('#forgotCaptcha'),
  forgotError: document.querySelector('#forgotError'),
  forgotSuccess: document.querySelector('#forgotSuccess'),
  forgotNewRecoveryCode: document.querySelector('#forgotNewRecoveryCode'),
  forgotRecoveryCopy: document.querySelector('#forgotRecoveryCopy'),
  accountRecoveryPanel: document.querySelector('#accountRecoveryPanel'),
  recoveryCodeForm: document.querySelector('#recoveryCodeForm'),
  recoveryCodeError: document.querySelector('#recoveryCodeError'),
  recoveryCodePassword: document.querySelector('#recoveryCodePassword'),
  recoveryCodeResult: document.querySelector('#recoveryCodeResult'),
  recoveryCodeResultValue: document.querySelector('#recoveryCodeResultValue'),
  recoveryCodeCopy: document.querySelector('#recoveryCodeCopy'),
  accountLoginForm: document.querySelector('#accountLoginForm'),
  accountUsername: document.querySelector('#accountUsername'),
  accountPassword: document.querySelector('#accountPassword'),
  accountLoginCaptcha: document.querySelector('#accountLoginCaptcha'),
  accountLoginError: document.querySelector('#accountLoginError'),
  account2FAVerifyForm: document.querySelector('#account2FAVerifyForm'),
  account2FAVerifyError: document.querySelector('#account2FAVerifyError'),
  login2FACode: document.querySelector('#login2FACode'),
  loginBackupCode: document.querySelector('#loginBackupCode'),
  submitBackupCodeButton: document.querySelector('#submitBackupCodeButton'),
  backupCodeInputSection: document.querySelector('#backupCodeInputSection'),
  useBackupCodeLink: document.querySelector('#useBackupCodeLink'),
  useTotpLink: document.querySelector('#useTotpLink'),
  accountStatus: document.querySelector('#accountStatus'),
  accountSettingsForm: document.querySelector('#accountSettingsForm'),
  accountSettingsError: document.querySelector('#accountSettingsError'),
  accountTheme: document.querySelector('#accountTheme'),
  accountHomeBoard: document.querySelector('#accountHomeBoard'),
  accountSyncDrafts: document.querySelector('#accountSyncDrafts'),
  accountCompactThreads: document.querySelector('#accountCompactThreads'),
  accountHideThumbnails: document.querySelector('#accountHideThumbnails'),
  accountWatchedUnreadOnly: document.querySelector('#accountWatchedUnreadOnly'),
  accountWatchedSort: document.querySelector('#accountWatchedSort'),
  accountEmailNotifications: document.querySelector('#accountEmailNotifications'),
  accountNotifyWatchedThreads: document.querySelector('#accountNotifyWatchedThreads'),
  accountNotifyBoardSubscriptions: document.querySelector('#accountNotifyBoardSubscriptions'),
  accountBrowserNotifyWatchedThreads: document.querySelector('#accountBrowserNotifyWatchedThreads'),
  accountBrowserNotificationsStatus: document.querySelector('#accountBrowserNotificationsStatus'),
  accountBoardSubscriptions: document.querySelector('#accountBoardSubscriptions'),
  accountSettingsLogout: document.querySelector('#accountSettingsLogout'),
  accountPrivateDataPanel: document.querySelector('#accountPrivateDataPanel'),
  accountPrivateDataSummary: document.querySelector('#accountPrivateDataSummary'),
  accountPasskeysPanel: document.querySelector('#accountPasskeysPanel'),
  accountPasskeysList: document.querySelector('#accountPasskeysList'),
  addPasskeyButton: document.querySelector('#addPasskeyButton'),
  loginPasskeyButton: document.querySelector('#loginPasskeyButton'),
  account2FADisabledSection: document.querySelector('#account2FADisabledSection'),
  enable2FAButton: document.querySelector('#enable2FAButton'),
  account2FASetupSection: document.querySelector('#account2FASetupSection'),
  qrcodeImage: document.querySelector('#qrcodeImage'),
  backupCodesDisplay: document.querySelector('#backupCodesDisplay'),
  verify2FACode: document.querySelector('#verify2FACode'),
  verify2FASetupButton: document.querySelector('#verify2FASetupButton'),
  cancel2FASetupButton: document.querySelector('#cancel2FASetupButton'),
  account2FAEnabledSection: document.querySelector('#account2FAEnabledSection'),
  disable2FAPassword: document.querySelector('#disable2FAPassword'),
  disable2FAButton: document.querySelector('#disable2FAButton'),
  accountLoggedOut: document.querySelector('#accountLoggedOut'),
  accountDisplayOptions: document.querySelectorAll('[data-account-display-option]'),
  useAccountNameInputs: document.querySelectorAll('[data-use-account-name]'),
  capcodeOptions: document.querySelectorAll('[data-capcode-option]'),
  capcodeInputs: document.querySelectorAll('[data-capcode-input]'),
  deletePasswordInputs: document.querySelectorAll('[data-delete-password-input]'),
  toast: document.querySelector('#toast'),
  refPreview: document.querySelector('#refPreview'),
  quickReply: document.querySelector('#quickReply'),
  quickReplyHandle: document.querySelector('#quickReplyHandle'),
  quickReplyTitle: document.querySelector('#quickReplyTitle'),
  quickReplyClose: document.querySelector('#quickReplyClose'),
  quickReplyForm: document.querySelector('#quickReplyForm'),
  quickReplyBody: document.querySelector('#quickReplyBody'),
  quickReplyPrivacyWarning: document.querySelector('#quickReplyPrivacyWarning'),
  quickReplyCaptcha: document.querySelector('#quickReplyCaptcha'),
  quickReplyFile: document.querySelector('#quickReplyFile'),
  quickReplyFileName: document.querySelector('#quickReplyFileName')
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add('hidden'), 3400);
}

function loadHcaptchaScript() {
  if (!state.hcaptchaSiteKey) {
    return Promise.resolve();
  }
  if (window.hcaptcha?.render) {
    return Promise.resolve();
  }
  if (state.hcaptchaReady) {
    return state.hcaptchaReady;
  }
  state.hcaptchaReady = new Promise((resolve, reject) => {
    const onloadName = '__chan36HcaptchaOnLoad';
    let settled = false;
    const cleanup = (callback) => {
      if (window[onloadName] === callback) {
        delete window[onloadName];
      }
    };
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup(finish);
      if (window.hcaptcha?.render) {
        resolve();
      } else {
        reject(new Error('Không tải được hCaptcha'));
      }
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup(finish);
      reject(error);
    };
    window[onloadName] = finish;

    const existing = document.querySelector('script[data-hcaptcha-script]');
    if (existing) {
      if (window.hcaptcha?.render) {
        finish();
      } else {
        existing.addEventListener('load', () => window.setTimeout(finish, 0), { once: true });
        existing.addEventListener('error', fail, { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = `https://js.hcaptcha.com/1/api.js?render=explicit&onload=${onloadName}`;
    script.async = true;
    script.defer = true;
    script.dataset.hcaptchaScript = 'true';
    script.addEventListener('load', () => window.setTimeout(finish, 0), { once: true });
    script.addEventListener('error', fail, { once: true });
    document.head.appendChild(script);
  });
  return state.hcaptchaReady;
}

function resetHcaptcha(input) {
  if (!state.hcaptchaSiteKey || !window.hcaptcha?.reset || !input?.id) {
    return;
  }
  const host = document.querySelector(`[data-hcaptcha-target="${input.id}"]`);
  const widgetId = host?.dataset.hcaptchaWidgetId;
  if (widgetId !== undefined) {
    window.hcaptcha.reset(Number(widgetId));
    input.value = '';
  }
}

async function setupHcaptcha() {
  if (!state.hcaptchaSiteKey) {
    return;
  }
  document.querySelectorAll('[data-hcaptcha-target]').forEach((host) => {
    const input = document.getElementById(host.dataset.hcaptchaTarget);
    if (input) {
      input.value = '';
      input.classList.add('captcha-token-hidden');
    }
    host.classList.remove('hidden');
  });

  await loadHcaptchaScript();
  if (!window.hcaptcha?.render) {
    throw new Error('Không tải được hCaptcha');
  }

  document.querySelectorAll('[data-hcaptcha-target]').forEach((host) => {
    if (host.dataset.hcaptchaWidgetId !== undefined) {
      return;
    }
    const input = document.getElementById(host.dataset.hcaptchaTarget);
    if (!input) {
      return;
    }
    const widgetId = window.hcaptcha.render(host, {
      sitekey: state.hcaptchaSiteKey,
      callback(token) {
        input.value = token;
      },
      'expired-callback'() {
        input.value = '';
      },
      'error-callback'() {
        input.value = '';
        showToast('hCaptcha gặp lỗi, vui lòng thử lại.');
      }
    });
    host.dataset.hcaptchaWidgetId = String(widgetId);
  });
}

function setButtonLoading(button, label = 'Đang gửi...') {
  if (!button) {
    return () => {};
  }
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = label;
  return () => {
    button.disabled = false;
    button.textContent = previousText;
  };
}

function setFormError(element, message = '') {
  if (!element) {
    return;
  }
  element.textContent = message;
  element.classList.toggle('hidden', !message);
}

function accountSettingsFromLocal() {
  const notifications = localNotificationPreferences();
  return {
    theme: state.theme,
    homeBoard: localStorage.getItem(homeBoardKey) || state.account?.settings?.homeBoard || state.boardSlug || 'confession',
    syncDrafts: state.account?.settings?.syncDrafts !== false,
    emailNotifications: notifications.email,
    displayPreferences: localDisplayPreferences(),
    notificationPreferences: notifications,
    boardSubscriptions: [...subscribedBoardSlugs()]
  };
}

function syncAccountBoardSubscriptionOptions(settings = state.account?.settings || accountSettingsFromLocal()) {
  if (!els.accountBoardSubscriptions) {
    return;
  }
  const selected = new Set(
    Array.isArray(settings.boardSubscriptions) ? settings.boardSubscriptions.map(String) : [...subscribedBoardSlugs()]
  );
  els.accountBoardSubscriptions.innerHTML = state.boards
    .map(
      (board) => `
        <label>
          <input type="checkbox" value="${escapeHtml(board.slug)}" data-account-board-subscription ${
            selected.has(board.slug) ? 'checked' : ''
          } />
          ${escapeHtml(board.path)} ${escapeHtml(board.name)}
        </label>
      `
    )
    .join('');
}

function applyAccountSyncedSettings(account = state.account) {
  const settings = account?.settings;
  if (!settings) {
    applyDisplayPreferences();
    applyNotificationPreferences();
    syncAccountBoardSubscriptionOptions();
    return;
  }
  applyTheme(settings.theme);
  localStorage.setItem(homeBoardKey, settings.homeBoard || 'confession');
  applyDisplayPreferences(settings.displayPreferences);
  applyNotificationPreferences(settings.notificationPreferences || { email: settings.emailNotifications });
  writeSubscribedBoardSlugs(Array.isArray(settings.boardSubscriptions) ? settings.boardSubscriptions : []);
  syncBoardSubscriptionButtons();
  syncAccountBoardSubscriptionOptions(settings);
  if ((window.location.hash || '#home').startsWith('#home')) {
    renderSubscribedBoards();
  }
}

async function persistAccountSettings({ silent = false } = {}) {
  if (!state.accountToken || !state.account) {
    return null;
  }
  try {
    const account = await api('/api/account/settings', {
      auth: 'account',
      method: 'PUT',
      body: JSON.stringify({ settings: accountSettingsFromLocal() })
    });
    state.account = account;
    updateAccountNav();
    return account;
  } catch (error) {
    if (!silent) {
      throw error;
    }
    if (/đăng nhập|Phiên/.test(error.message)) {
      setAccountSession();
    }
    return null;
  }
}

function setAccountSession({ token = '', account = null } = {}) {
  state.accountToken = token;
  state.account = account;
  state.accountPostNumbers = new Set();
  state.accountPrivateData = token ? state.accountPrivateData : null;
  window.clearTimeout(state.accountPrivateSaveTimer);
  if (token) {
    localStorage.setItem('accountToken', token);
  } else {
    localStorage.removeItem('accountToken');
  }
  if (account) {
    applyAccountSyncedSettings(account);
  }
  updateAccountNav();
  renderAccountPrivateData();
}

function normalizeAccountPrivateData(value = {}) {
  return {
    watchlist: Array.isArray(value.watchlist) ? value.watchlist.filter((item) => item?.threadId).slice(0, 100) : [],
    drafts: Array.isArray(value.drafts) ? value.drafts.filter((item) => item?.key && item?.body).slice(0, 40) : [],
    savedSearches: Array.isArray(value.savedSearches)
      ? value.savedSearches.filter((item) => item?.boardSlug && item?.query).slice(0, 50)
      : [],
    contentFilters: normalizeContentFilters(value.contentFilters),
    replyTemplates: normalizeReplyTemplates(value.replyTemplates),
    posterNotes: normalizePosterNotes(value.posterNotes)
  };
}

function mergeByKey(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (key) {
      map.set(key, item);
    }
  });
  return [...map.values()];
}

function mergeAccountPrivateData(serverData = defaultAccountPrivateData()) {
  const localWatchlist = Object.values(readJsonLocal(watchedThreadsKey, {})).filter((item) => item?.threadId);
  const localSearches = readLocalList(savedSearchesKey).filter((item) => item?.boardSlug && item?.query);
  const localFilters = normalizeContentFilters(readLocalList(contentFiltersKey));
  const localTemplates = normalizeReplyTemplates(readLocalList(replyTemplatesKey));
  const localPosterNotes = normalizePosterNotes(readLocalList(posterNotesKey));
  const drafts = accountDraftSyncEnabled()
    ? mergeByKey([...(serverData.drafts || []), ...localDraftEntries()], (item) => item.key)
    : serverData.drafts || [];
  return normalizeAccountPrivateData({
    watchlist: mergeByKey([...(serverData.watchlist || []), ...localWatchlist], (item) => item.threadId),
    drafts,
    savedSearches: mergeByKey(
      [...(serverData.savedSearches || []), ...localSearches],
      (item) => `${item.boardSlug}:${item.query}`
    ),
    contentFilters: mergeByKey(
      [...(serverData.contentFilters || []), ...localFilters],
      (item) => `${item.type}:${item.boardSlug || ''}:${item.value}`
    ),
    replyTemplates: mergeByKey(
      [...(serverData.replyTemplates || []), ...localTemplates],
      (item) => `${item.boardSlug || ''}:${item.title}:${item.body}`
    ),
    posterNotes: mergeByKey(
      [...(serverData.posterNotes || []), ...localPosterNotes],
      (item) => `${item.boardSlug || ''}:${item.posterId}`
    )
  });
}

async function saveAccountPrivateData() {
  if (!state.accountToken || !state.accountPrivateData) {
    return null;
  }
  const data = await api('/api/account/private-data', {
    auth: 'account',
    method: 'PUT',
    body: JSON.stringify(state.accountPrivateData)
  });
  state.accountPrivateData = normalizeAccountPrivateData(data);
  return state.accountPrivateData;
}

function scheduleAccountPrivateDataSave() {
  if (!state.accountToken || !state.accountPrivateData) {
    return;
  }
  window.clearTimeout(state.accountPrivateSaveTimer);
  state.accountPrivateSaveTimer = window.setTimeout(() => {
    saveAccountPrivateData().catch((error) => {
      if (/đăng nhập|Phiên/.test(error.message)) {
        setAccountSession();
      }
    });
  }, 600);
}

async function loadAccountPrivateData({ mergeLocal = false } = {}) {
  if (!state.accountToken) {
    state.accountPrivateData = null;
    return null;
  }
  const data = await api('/api/account/private-data', { auth: 'account' });
  state.accountPrivateData = mergeLocal ? mergeAccountPrivateData(data) : normalizeAccountPrivateData(data);
  if (mergeLocal) {
    await saveAccountPrivateData();
  }
  renderAccountPrivateData();
  return state.accountPrivateData;
}

async function finishAccountLogin(result, { mergeLocal = true } = {}) {
  setAccountSession({ token: result.token, account: result.account });
  state.accountPrivateData = mergeLocal ? mergeAccountPrivateData() : normalizeAccountPrivateData();
  renderAccountPrivateData();
  try {
    await loadAccountPrivateData({ mergeLocal });
    await refreshAccountPostNumbers();
  } catch (error) {
    console.warn('Unable to sync account data after login', error);
    showToast('Đã đăng nhập, nhưng chưa đồng bộ được dữ liệu cá nhân. Vui lòng thử lại sau.');
  }
}
async function clearAccountPrivateData(section = '') {
  if (!state.accountToken) {
    return;
  }
  const data = await api(`/api/account/private-data${section ? `?section=${encodeURIComponent(section)}` : ''}`, {
    auth: 'account',
    method: 'DELETE'
  });
  state.accountPrivateData = normalizeAccountPrivateData(data);
  if (!section || section === 'watchlist') {
    writeJsonLocal(watchedThreadsKey, {});
  }
  if (!section || section === 'savedSearches') {
    writeJsonLocal(savedSearchesKey, []);
  }
  if (!section || section === 'drafts') {
    localDraftEntries().forEach((draft) => localStorage.removeItem(draft.key));
  }
  if (!section || section === 'contentFilters') {
    writeJsonLocal(contentFiltersKey, []);
  }
  if (!section || section === 'replyTemplates') {
    writeJsonLocal(replyTemplatesKey, []);
  }
  if (!section || section === 'posterNotes') {
    writeJsonLocal(posterNotesKey, []);
  }
  renderAccountPrivateData();
}

function updateAccountDisplayOptions() {
  const loggedIn = Boolean(state.accountToken && state.account?.username);
  els.accountDisplayOptions.forEach((element) => element.classList.toggle('hidden', !loggedIn));
  if (!loggedIn) {
    els.useAccountNameInputs.forEach((input) => {
      input.checked = false;
    });
  }
}

function isCapcodeEligible() {
  return Boolean(state.accountToken) && ['admin', 'moderator'].includes(state.account?.role);
}

function updateCapcodeOptions() {
  const eligible = isCapcodeEligible();
  els.capcodeOptions.forEach((element) => element.classList.toggle('hidden', !eligible));
  if (!eligible) {
    els.capcodeInputs.forEach((input) => {
      input.checked = false;
    });
  }
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) {
      return null;
    }
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function adminUsernameFromToken() {
  if (!state.token) {
    return '';
  }
  const payload = decodeJwtPayload(state.token);
  return payload && ['admin', 'owner', 'moderator', 'viewer'].includes(payload.role) ? payload.username || '' : '';
}

function updateAccountNav() {
  const loggedIn = Boolean(state.accountToken && state.account);
  const adminUsername = loggedIn ? '' : adminUsernameFromToken();
  const adminOnly = Boolean(adminUsername);
  els.accountLoginLink.classList.toggle('hidden', loggedIn || adminOnly);
  els.accountRegisterLink.classList.toggle('hidden', loggedIn || adminOnly);
  els.accountSettingsLink.classList.toggle('hidden', !loggedIn && !adminOnly);
  els.accountLogoutButton.classList.toggle('hidden', !loggedIn);
  if (loggedIn) {
    els.accountSettingsLink.textContent = `@${state.account.username}`;
    els.accountSettingsLink.setAttribute('href', '#account');
  } else if (adminOnly) {
    els.accountSettingsLink.textContent = `@${adminUsername}`;
    els.accountSettingsLink.setAttribute('href', '#admin');
  } else {
    els.accountSettingsLink.textContent = 'Tài khoản';
    els.accountSettingsLink.setAttribute('href', '#account');
  }
  updateAccountDisplayOptions();
  updateCapcodeOptions();
}

function logoutAccount({ message = 'Đã đăng xuất tài khoản.' } = {}) {
  setAccountSession();
  if (message) {
    showToast(message);
  }
  if (['#account', '#login', '#register', '#forgot'].some((prefix) => (window.location.hash || '').startsWith(prefix))) {
    window.location.hash = '#home';
  }
}

function syncAccountHomeBoardOptions() {
  if (!els.accountHomeBoard) {
    return;
  }
  els.accountHomeBoard.innerHTML = state.boards
    .map((board) => `<option value="${escapeHtml(board.slug)}">${escapeHtml(board.path)} ${escapeHtml(board.name)}</option>`)
    .join('');
}

function fillAccountSettings(account = state.account) {
  const settings = account?.settings || accountSettingsFromLocal();
  const displayPreferences = settings.displayPreferences || localDisplayPreferences();
  const notificationPreferences = settings.notificationPreferences || {
    ...localNotificationPreferences(),
    email: Boolean(settings.emailNotifications)
  };
  els.accountStatus.textContent = account
    ? `Đang đăng nhập @${account.username}. Tài khoản không thay thế Anonymous trên bài công khai.`
    : 'Chưa đăng nhập. Cài đặt bên dưới chỉ lưu trên trình duyệt này.';
  els.accountSettingsForm.classList.remove('hidden');
  els.accountLoggedOut.classList.toggle('hidden', Boolean(account));
  els.accountSettingsLogout.classList.toggle('hidden', !account);
  els.accountTheme.value = settings.theme || state.theme || 'yotsuba-b';
  els.accountHomeBoard.value = settings.homeBoard || localStorage.getItem(homeBoardKey) || state.boardSlug || 'confession';
  els.accountSyncDrafts.checked = settings.syncDrafts !== false;
  els.accountCompactThreads.checked = Boolean(displayPreferences.compactThreads);
  els.accountHideThumbnails.checked = Boolean(displayPreferences.hideThumbnails);
  els.accountWatchedUnreadOnly.checked = Boolean(displayPreferences.watchedUnreadOnly);
  els.accountWatchedSort.value = normalizeWatchedSort(displayPreferences.watchedSort);
  els.accountEmailNotifications.checked = Boolean(notificationPreferences.email ?? settings.emailNotifications);
  els.accountNotifyWatchedThreads.checked = notificationPreferences.watchedThreads !== false;
  els.accountNotifyBoardSubscriptions.checked = Boolean(notificationPreferences.boardSubscriptions);
  syncBrowserNotificationControls(notificationPreferences);
  syncAccountBoardSubscriptionOptions(settings);
  renderAccountPrivateData();
  render2FAState();
  renderPasskeys();
  renderAccountRecoveryPanel();
}

function render2FAState() {
  if (!els.account2FADisabledSection || !els.account2FASetupSection || !els.account2FAEnabledSection) {
    return;
  }
  const loggedIn = Boolean(state.accountToken && state.account);
  const enabled = Boolean(state.account?.twoFactorEnabled);
  els.account2FADisabledSection.classList.toggle('hidden', !loggedIn || enabled);
  els.account2FASetupSection.classList.add('hidden');
  els.account2FAEnabledSection.classList.toggle('hidden', !loggedIn || !enabled);
  if (els.verify2FACode) els.verify2FACode.value = '';
  if (els.disable2FAPassword) els.disable2FAPassword.value = '';
}

async function start2FASetup() {
  try {
    const data = await api('/api/account/2fa/setup', {
      auth: 'account',
      method: 'POST'
    });
    els.qrcodeImage.src = data.qrCodeUrl;
    els.backupCodesDisplay.value = data.backupCodes.join('\n');
    els.account2FADisabledSection.classList.add('hidden');
    els.account2FASetupSection.classList.remove('hidden');
    els.verify2FACode.focus();
  } catch (error) {
    showToast(`Lỗi thiết lập 2FA: ${error.message}`);
  }
}

async function verify2FASetup() {
  const code = (els.verify2FACode.value || '').trim();
  if (!code) {
    showToast('Vui lòng nhập mã 2FA để xác nhận.');
    return;
  }
  try {
    const result = await api('/api/account/2fa/verify', {
      auth: 'account',
      method: 'POST',
      body: JSON.stringify({ code })
    });
    state.account = result.account || { ...state.account, twoFactorEnabled: true };
    showToast('Kích hoạt bảo mật 2 lớp (2FA) thành công!');
    render2FAState();
  } catch (error) {
    showToast(`Kích hoạt 2FA thất bại: ${error.message}`);
  }
}

async function disable2FA() {
  const password = els.disable2FAPassword.value;
  if (!password) {
    showToast('Vui lòng nhập mật khẩu để tắt 2FA.');
    return;
  }
  if (!window.confirm('Bạn chắc chắn muốn TẮT bảo mật 2 lớp (2FA)?')) {
    return;
  }
  try {
    const result = await api('/api/account/2fa/disable', {
      auth: 'account',
      method: 'POST',
      body: JSON.stringify({ password })
    });
    state.account = result.account || { ...state.account, twoFactorEnabled: false };
    showToast('Đã tắt bảo mật 2 lớp (2FA).');
    render2FAState();
  } catch (error) {
    showToast(`Tắt 2FA thất bại: ${error.message}`);
  }
}

async function renderPasskeys() {
  if (!els.accountPasskeysPanel || !els.accountPasskeysList) {
    return;
  }
  const loggedIn = Boolean(state.accountToken && state.account);
  els.accountPasskeysPanel.classList.toggle('hidden', !loggedIn);
  if (!loggedIn) {
    els.accountPasskeysList.innerHTML = '';
    return;
  }
  try {
    const passkeys = await api('/api/account/passkeys', { auth: 'account' });
    if (!passkeys.length) {
      els.accountPasskeysList.innerHTML = '<p class="latest-empty">Chưa đăng ký thiết bị xác thực nào.</p>';
      return;
    }
    els.accountPasskeysList.innerHTML = passkeys
      .map((passkey) => {
        const deviceType = passkey.credentialDeviceType === 'singleDevice' ? 'Thiết bị đơn (Vân tay/Khuôn mặt)' : 'Đa thiết bị (iCloud/Google Keychain)';
        const date = new Date(passkey.createdAt).toLocaleString('vi-VN');
        return `
          <div class="watch-item">
            <div class="watch-thread-link">
              <span class="watch-board">Passkey</span>
              <span class="watch-preview" style="display:inline-block; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(passkey.id)}">ID: ${escapeHtml(passkey.id)}</span>
              <span class="watch-stats">${escapeHtml(deviceType)} · Tạo lúc: ${escapeHtml(date)}</span>
            </div>
            <button class="link-button watch-remove" data-delete-passkey="${escapeHtml(passkey.id)}" type="button">[Xóa]</button>
          </div>
        `;
      })
      .join('');
  } catch (error) {
    els.accountPasskeysList.innerHTML = `<p class="form-error">Lỗi khi tải Passkeys: ${escapeHtml(error.message)}</p>`;
  }
}

async function addPasskey() {
  try {
    const options = await api('/api/account/passkeys/register-options', {
      auth: 'account',
      method: 'POST'
    });

    const attestationResponse = await startRegistration(options);

    await api('/api/account/passkeys/register-verify', {
      auth: 'account',
      method: 'POST',
      body: JSON.stringify(attestationResponse)
    });

    showToast('Đăng ký thiết bị xác thực (Passkey) thành công!');
    await renderPasskeys();
  } catch (error) {
    showToast(`Lỗi đăng ký Passkey: ${error.message}`);
  }
}

async function loginWithPasskey() {
  const username = (els.accountUsername.value || '').trim();
  if (!username) {
    setFormError(els.accountLoginError, 'Vui lòng nhập tên tài khoản trước.');
    return;
  }
  setFormError(els.accountLoginError);
  const restoreButton = setButtonLoading(els.loginPasskeyButton, 'Đang xác thực...');
  try {
    const options = await api('/api/auth/webauthn/login-options', {
      method: 'POST',
      body: JSON.stringify({ username })
    });

    const assertionResponse = await startAuthentication(options);

    const result = await api('/api/auth/webauthn/login-verify', {
      method: 'POST',
      body: JSON.stringify({ username, assertionResponse })
    });

    await finishAccountLogin(result);
    showToast(`Chào mừng trở lại, @${result.account.username}!`);
    window.location.hash = '#home';
  } catch (error) {
    setFormError(els.accountLoginError, `Đăng nhập Passkey thất bại: ${error.message}`);
  } finally {
    restoreButton();
  }
}

async function loginAdminWithPasskey() {
  const username = (els.adminUsername.value || '').trim();
  if (!username) {
    showToast('Vui lòng nhập tên tài khoản quản trị trước.');
    els.adminUsername.focus();
    return;
  }
  const restoreButton = setButtonLoading(els.adminLoginPasskeyButton, 'Đang xác thực...');
  try {
    const options = await api('/api/auth/webauthn/login-options', {
      auth: 'none',
      method: 'POST',
      body: JSON.stringify({ username })
    });

    const assertionResponse = await startAuthentication(options);

    const result = await api('/api/auth/webauthn/login-verify', {
      auth: 'none',
      method: 'POST',
      body: JSON.stringify({ username, assertionResponse })
    });

    state.token = result.token;
    localStorage.setItem('adminToken', state.token);
    els.adminPassword.value = '';
    showToast('Đăng nhập quản trị bằng Passkey thành công.');
    await loadAdmin();
  } catch (error) {
    showToast(`Đăng nhập Passkey thất bại: ${error.message}`);
  } finally {
    restoreButton();
  }
}

async function addAdminPasskey() {
  try {
    const options = await api('/api/account/passkeys/register-options', {
      auth: 'admin',
      method: 'POST'
    });

    const attestationResponse = await startRegistration(options);

    await api('/api/account/passkeys/register-verify', {
      auth: 'admin',
      method: 'POST',
      body: JSON.stringify(attestationResponse)
    });

    showToast('Đăng ký Passkey quản trị thành công!');
    await renderAdminPasskeys();
  } catch (error) {
    showToast(`Lỗi đăng ký Passkey: ${error.message}`);
  }
}

async function renderAdminPasskeys() {
  if (!els.adminPasskeysPanel || !els.adminPasskeysList) {
    return;
  }
  const loggedIn = Boolean(state.token);
  els.adminPasskeysPanel.classList.toggle('hidden', !loggedIn);
  if (!loggedIn) {
    els.adminPasskeysList.innerHTML = '';
    return;
  }
  try {
    const passkeys = await api('/api/account/passkeys', { auth: 'admin' });
    if (!passkeys.length) {
      els.adminPasskeysList.innerHTML = '<p class="latest-empty">Chưa đăng ký thiết bị xác thực nào.</p>';
      return;
    }
    els.adminPasskeysList.innerHTML = passkeys
      .map((passkey) => {
        const deviceType = passkey.credentialDeviceType === 'singleDevice' ? 'Thiết bị đơn (Vân tay/Khuôn mặt)' : 'Đa thiết bị (iCloud/Google Keychain)';
        const date = new Date(passkey.createdAt).toLocaleString('vi-VN');
        return `
          <div class="watch-item">
            <div class="watch-thread-link">
              <span class="watch-board">Passkey</span>
              <span class="watch-preview" style="display:inline-block; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(passkey.id)}">ID: ${escapeHtml(passkey.id)}</span>
              <span class="watch-stats">${escapeHtml(deviceType)} · Tạo lúc: ${escapeHtml(date)}</span>
            </div>
            <button class="link-button watch-remove" data-delete-admin-passkey="${escapeHtml(passkey.id)}" type="button">[Xóa]</button>
          </div>
        `;
      })
      .join('');
  } catch (error) {
    els.adminPasskeysList.innerHTML = `<p class="form-error">Lỗi khi tải Passkeys: ${escapeHtml(error.message)}</p>`;
  }
}

function renderSavedSearches() {
  const searches = readSavedSearches();
  if (!searches.length) {
    return '<p class="latest-empty">Chưa lưu tìm kiếm nào.</p>';
  }
  return searches
    .slice(0, 10)
    .map((item) => {
      const board = state.boards.find((entry) => entry.slug === item.boardSlug);
      const label = item.label || `${board?.path || `/${item.boardSlug}/`} ${item.query}`;
      return `
        <div class="watch-item">
          <a class="watch-thread-link" href="#board/${encodeURIComponent(item.boardSlug)}?q=${encodeURIComponent(item.query)}">
            <span class="watch-board">${escapeHtml(board?.path || `/${item.boardSlug}/`)}</span>
            <span class="watch-preview">${escapeHtml(label)}</span>
          </a>
          <button class="link-button watch-remove" data-remove-saved-search="${escapeHtml(
            `${item.boardSlug}:${item.query}`
          )}" type="button">[Xóa]</button>
        </div>
      `;
    })
    .join('');
}

function privateBoardOptions() {
  return [
    '<option value="">Tất cả bảng</option>',
    ...state.boards.map((board) => `<option value="${escapeHtml(board.slug)}">${escapeHtml(board.path)} ${escapeHtml(board.name)}</option>`)
  ].join('');
}

function filterTypeLabel(type = '') {
  if (type === 'poster') return 'Poster ID';
  if (type === 'thread') return 'Thread';
  if (type === 'post') return 'Bài';
  return 'Từ khóa';
}

function renderContentFilters() {
  const filters = readContentFilters();
  const list = filters.length
    ? filters
        .map((filter) => {
          const board = filter.boardSlug ? `/${filter.boardSlug}/` : 'Tất cả';
          const label = filter.label || filter.value;
          return `
            <div class="watch-item">
              <div class="watch-thread-link">
                <span class="watch-board">${escapeHtml(filterTypeLabel(filter.type))}</span>
                <span class="watch-preview">${escapeHtml(label)}</span>
                <span class="watch-stats">${escapeHtml(board)}</span>
              </div>
              <button class="link-button watch-remove" data-remove-content-filter="${escapeHtml(filter.id)}" type="button">[Xóa]</button>
            </div>
          `;
        })
        .join('')
    : '<p class="latest-empty">Chưa có bộ lọc nội dung nào.</p>';
  return `
    <div class="content-filter-manager">
      ${list}
      <div class="content-filter-form">
        <select data-content-filter-type aria-label="Loại bộ lọc">
          <option value="keyword">Từ khóa</option>
          <option value="poster">Poster ID</option>
        </select>
        <input data-content-filter-value maxlength="160" placeholder="từ khóa hoặc ID" />
        <select data-content-filter-board aria-label="Phạm vi bảng">${privateBoardOptions()}</select>
        <button class="ghost-button" data-add-content-filter type="button">[Thêm]</button>
      </div>
    </div>
  `;
}

function renderReplyTemplates() {
  const templates = readReplyTemplates();
  const list = templates.length
    ? templates
        .map((template) => {
          const board = template.boardSlug ? `/${template.boardSlug}/` : 'Tất cả';
          const preview = template.body.length > 140 ? `${template.body.slice(0, 140)}...` : template.body;
          return `
            <div class="watch-item">
              <div class="watch-thread-link">
                <span class="watch-board">${escapeHtml(template.title)}</span>
                <span class="watch-preview">${escapeHtml(preview)}</span>
                <span class="watch-stats">${escapeHtml(board)}</span>
              </div>
              <button class="link-button watch-remove" data-remove-reply-template="${escapeHtml(template.id)}" type="button">[Xóa]</button>
            </div>
          `;
        })
        .join('')
    : '<p class="latest-empty">Chưa có mẫu trả lời nào.</p>';
  return `
    <div class="reply-template-manager">
      ${list}
      <div class="reply-template-form">
        <input data-reply-template-title maxlength="120" placeholder="tên mẫu" />
        <select data-reply-template-board aria-label="Phạm vi bảng">${privateBoardOptions()}</select>
        <textarea data-reply-template-body maxlength="5000" rows="3" placeholder="nội dung mẫu"></textarea>
        <button class="ghost-button" data-add-reply-template type="button">[Thêm]</button>
      </div>
    </div>
  `;
}

function renderPosterNotes() {
  const notes = readPosterNotes();
  const list = notes.length
    ? notes
        .map((note) => {
          const board = note.boardSlug ? `/${note.boardSlug}/` : 'Tất cả';
          const label = note.label || note.note || note.posterId;
          return `
            <div class="watch-item">
              <div class="watch-thread-link">
                <span class="watch-board">${escapeHtml(note.posterId)}</span>
                <span class="watch-preview">${escapeHtml(label)}</span>
                <span class="watch-stats">${escapeHtml(board)}</span>
              </div>
              <button class="link-button watch-remove" data-remove-poster-note="${escapeHtml(note.id)}" type="button">[Xóa]</button>
            </div>
          `;
        })
        .join('')
    : '<p class="latest-empty">Chưa có ghi chú Poster ID nào.</p>';
  return `
    <div class="poster-note-manager">
      ${list}
      <div class="poster-note-form">
        <input data-poster-note-id maxlength="80" placeholder="ID:ABCD1234" />
        <input data-poster-note-label maxlength="120" placeholder="nhãn ngắn" />
        <select data-poster-note-board aria-label="Phạm vi bảng">${privateBoardOptions()}</select>
        <input data-poster-note-text maxlength="500" placeholder="ghi chú" />
        <button class="ghost-button" data-add-poster-note type="button">[Thêm]</button>
      </div>
    </div>
  `;
}

function renderReplyTemplatePickers() {
  const templates = readReplyTemplates();
  document.querySelectorAll('[data-reply-template-picker]').forEach((root) => {
    const target = root.dataset.replyTemplatePicker;
    const scopedTemplates = templates.filter((template) => !template.boardSlug || template.boardSlug === state.boardSlug);
    const options = scopedTemplates
      .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.title)}</option>`)
      .join('');
    root.innerHTML = `
      <span>Mẫu đã lưu</span>
      <select data-reply-template-select ${scopedTemplates.length ? '' : 'disabled'} aria-label="Mẫu đã lưu">
        ${scopedTemplates.length ? options : '<option value="">Chưa có mẫu</option>'}
      </select>
      <button class="link-button" data-insert-reply-template="${escapeHtml(target)}" type="button" ${
        scopedTemplates.length ? '' : 'disabled'
      }>[Chèn]</button>
      <button class="link-button" data-save-reply-template="${escapeHtml(target)}" type="button">[Lưu mẫu]</button>
    `;
  });
}

function renderAccountPrivateData() {
  if (!els.accountPrivateDataPanel || !els.accountPrivateDataSummary) {
    renderReplyTemplatePickers();
    return;
  }
  const loggedIn = Boolean(state.accountToken && state.account);
  els.accountPrivateDataPanel.classList.toggle('hidden', !loggedIn);
  if (!loggedIn) {
    els.accountPrivateDataSummary.innerHTML = '';
    renderReplyTemplatePickers();
    return;
  }
  const data = state.accountPrivateData || defaultAccountPrivateData();
  els.accountPrivateDataSummary.innerHTML = `
    <section>
      <h3>Watchlist</h3>
      <p>${Number(data.watchlist?.length || 0).toLocaleString()} chủ đề đang theo dõi.</p>
    </section>
    <section>
      <h3>Saved searches</h3>
      ${renderSavedSearches()}
    </section>
    <section>
      <h3>Drafts</h3>
      <p>${Number(data.drafts?.length || 0).toLocaleString()} draft đang lưu.</p>
    </section>
    <section>
      <h3>Bộ lọc nội dung</h3>
      ${renderContentFilters()}
    </section>
    <section>
      <h3>Mẫu trả lời</h3>
      ${renderReplyTemplates()}
    </section>
    <section>
      <h3>Ghi chú Poster ID</h3>
      ${renderPosterNotes()}
    </section>
  `;
  renderReplyTemplatePickers();
}

function saveCurrentBoardSearch() {
  const query = (els.boardSearchInput.value || state.boardSearchTerm || '').trim();
  if (!query) {
    showToast('Nhập từ khóa trước khi lưu tìm kiếm.');
    return;
  }
  const board = currentBoard();
  const key = `${board.slug}:${query}`;
  const searches = readSavedSearches().filter((item) => `${item.boardSlug}:${item.query}` !== key);
  searches.unshift({
    id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    boardSlug: board.slug,
    query,
    label: `${board.path} ${query}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  writeSavedSearches(searches);
  renderAccountPrivateData();
  showToast(state.accountToken ? 'Đã lưu tìm kiếm vào tài khoản.' : 'Đã lưu tìm kiếm trên trình duyệt.');
}

function removeSavedSearch(key) {
  const searches = readSavedSearches().filter((item) => `${item.boardSlug}:${item.query}` !== key);
  writeSavedSearches(searches);
  renderAccountPrivateData();
  showToast('Đã xóa tìm kiếm đã lưu.');
}

async function loadAccountSession() {
  updateAccountNav();
  if (!state.accountToken) {
    return null;
  }
  try {
    const account = await api('/api/account/me', { auth: 'account' });
    state.account = account;
    applyAccountSyncedSettings(account);
    updateAccountNav();
    await loadAccountPrivateData({ mergeLocal: true });
    await refreshAccountPostNumbers();
    return account;
  } catch {
    setAccountSession();
    return null;
  }
}

async function loadAccountSettings() {
  setScreen('account');
  setFormError(els.accountSettingsError);
  syncAccountHomeBoardOptions();
  if (!state.account && state.accountToken) {
    await loadAccountSession();
  }
  if (state.account && state.accountToken && !state.accountPrivateData) {
    await loadAccountPrivateData({ mergeLocal: true });
  }
  fillAccountSettings();
  window.scrollTo({ top: 0 });
}

async function api(path, options = {}) {
  const { auth = 'admin', timeoutMs, signal, ...fetchOptions } = options;
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  if (auth === 'account' && state.accountToken) {
    headers.authorization = `Bearer ${state.accountToken}`;
  } else if (auth === 'admin' && state.token) {
    headers.authorization = `Bearer ${state.token}`;
  }

  let timeoutId = null;
  let timedOut = false;
  let abortListener = null;
  if ((timeoutMs || signal) && window.AbortController) {
    const controller = new AbortController();
    fetchOptions.signal = controller.signal;
    if (signal?.aborted) {
      controller.abort(signal.reason);
    } else if (signal) {
      abortListener = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abortListener, { once: true });
    }
    if (timeoutMs) {
      timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }
  } else if (signal) {
    fetchOptions.signal = signal;
  }

  let response;
  try {
    response = await fetch(withUrlBase(path, API_BASE_URL), { ...fetchOptions, headers });
  } catch (error) {
    if (timedOut) {
      throw new Error('AI phản hồi quá lâu, vui lòng thử lại.', { cause: error });
    }
    throw error;
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Yêu cầu thất bại');
    error.statusCode = response.status;
    error.setupRequired = payload.error?.setupRequired;
    error.requires2FA = payload.error?.requires2FA;
    throw error;
  }
  return payload.data;
}

function setScreen(name) {
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
  return state.boards.find((board) => board.slug === state.boardSlug) || state.boards[0];
}

function normalizeSearchValue(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeBoardSort(value) {
  const sort = String(value || '').trim().toLowerCase();
  return ['bump', 'created', 'replies'].includes(sort) ? sort : 'bump';
}

function normalizeBoardFilter(value) {
  const filter = String(value || '').trim().toLowerCase();
  return ['all', 'media', 'video', 'poll', 'unanswered'].includes(filter) ? filter : 'all';
}

function boardThreadsCacheKey({
  boardSlug = state.boardSlug,
  page = state.boardPage,
  pageSize = state.boardPageSize,
  q = state.boardSearchTerm,
  sort = state.boardSort,
  filter = state.boardFilter
} = {}) {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.max(1, Math.floor(Number(pageSize) || state.boardPageSize));
  return [boardSlug, safePage, safePageSize, normalizeSearchValue(q), normalizeBoardSort(sort), normalizeBoardFilter(filter)].join('|');
}

function firstBoardPageFromThreads(threads = [], { page = 1, pageSize = state.boardPageSize } = {}) {
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

function normalizeBoardThreadsPayload(payload) {
  if (Array.isArray(payload)) {
    return { threads: payload, meta: null };
  }
  const threads = Array.isArray(payload?.items) ? payload.items : [];
  return { threads, meta: payload && typeof payload === 'object' ? payload : null };
}

function writeBoardThreadsCache(boardSlug, payload, options = {}) {
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

function readBoardThreadsCache(options = {}) {
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

function findBoardByQuery(query) {
  const normalized = normalizeSearchValue(query);
  if (!normalized) {
    return null;
  }
  return state.boards.find((board) => {
    const slug = normalizeSearchValue(board.slug);
    const path = normalizeSearchValue(board.path).replaceAll('/', '');
    const name = normalizeSearchValue(board.name);
    return slug === normalized || path === normalized.replaceAll('/', '') || name.includes(normalized);
  });
}

function boardHeading(board) {
  if (!board) {
    return '36chan';
  }
  return `${board.path} - ${board.name}`;
}

function boardRulesForDisplay(board) {
  const rules = Array.isArray(board?.rules) ? board.rules : [];
  return rules.length ? rules : [board?.description || 'Diễn đàn ảnh sinh viên ẩn danh có AI kiểm duyệt.'];
}

function updateBoardPresentation(board) {
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

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[character];
  });
}

const privacyRiskRules = [
  {
    label: 'email',
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  },
  {
    label: 'số điện thoại',
    pattern: /(?:^|[^\d])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?=$|[^\d])/
  },
  {
    label: 'mã sinh viên',
    pattern: /(?:^|\s)(?:mssv|mã sinh viên|ma sinh vien|student id)\s*[:#-]?\s*[A-Z0-9]{5,}(?=$|\s|[.,;!?])/i
  },
  {
    label: 'lớp học',
    pattern: /(?:^|\s)(?:lớp|lop|class)\s*[:#-]?\s*[A-Z0-9._-]{3,}(?=$|\s|[.,;!?])/i
  },
  {
    label: 'tên thật',
    pattern:
      /(?:^|\s)(?:tên\s+(?:mình|tôi|bạn ấy|nó)\s+là|mình\s+tên\s+là|bạn ấy\s+tên\s+là|người đó\s+tên\s+là)\s+[\p{L}]+(?:\s+[\p{L}]+){1,3}/iu
  }
];

const rumorFrictionRules = [
  {
    label: 'thông tin chưa kiểm chứng',
    pattern: /(?:tin đồn|tin don|nghe nói|nghe noi|đồn là|don la|chưa kiểm chứng|chua kiem chung|bóc phốt|boc phot)/i
  },
  {
    label: 'cáo buộc cá nhân',
    pattern: /(?:lừa đảo|lua dao|ăn cắp|an cap|quấy rối|quay roi|ngoại tình|ngoai tinh|đánh người|danh nguoi|scam|biến thái|bien thai)/i
  }
];

function scanDraftRisks(text = '') {
  const content = String(text).normalize('NFC');
  const privacyRisks = privacyRiskRules.filter((rule) => rule.pattern.test(content)).map((rule) => rule.label);
  const rumorRisks = rumorFrictionRules.filter((rule) => rule.pattern.test(content)).map((rule) => rule.label);
  return { privacyRisks, rumorRisks, risks: [...privacyRisks, ...rumorRisks] };
}

function updatePrivacyWarning(text, box) {
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

function confirmPrivacyBeforeSubmit(text, box) {
  const risks = updatePrivacyWarning(text, box);
  if (!risks.length) {
    return true;
  }
  return window.confirm(
    `Bài viết có thể chứa ${risks.join(', ')}. Hãy sửa nếu có thông tin cá nhân hoặc cáo buộc chưa kiểm chứng. Bạn vẫn muốn gửi nội dung này?`
  );
}

function renderBoards() {
  els.boardNav.innerHTML = state.boards
    .map(
      (board) =>
        `<a class="${board.slug === state.boardSlug ? 'active' : ''}" href="#board/${board.slug}" title="${board.path}">${board.name}</a>`
    )
    .join('');
}

async function refreshPublicBoards({ fallbackBoards = state.boards } = {}) {
  try {
    state.boards = await api('/api/boards');
  } catch {
    state.boards = fallbackBoards;
  }
  renderBoards();
  syncAdminBoardFilter();
  return state.boards;
}

function syncBoardSubscriptionButtons() {
  const label = isBoardSubscribed(state.boardSlug) ? 'Bỏ theo dõi bảng' : 'Theo dõi bảng';
  document.querySelectorAll('[data-toggle-board-subscription]').forEach((button) => {
    button.textContent = label;
  });
}

function openThreadComposer({ focus = true } = {}) {
  els.threadComposer.classList.remove('hidden');
  els.startThreadButton.classList.add('hidden');
  const savedDraft = readDraft(draftKey('thread', state.boardSlug));
  if (savedDraft && !els.threadBody.value) {
    els.threadBody.value = savedDraft;
    updatePrivacyWarning(els.threadBody.value, els.threadPrivacyWarning);
  }
  if (focus) {
    window.setTimeout(() => els.threadBody.focus(), 0);
  }
}

function closeThreadComposer() {
  els.threadComposer.classList.add('hidden');
  els.startThreadButton.classList.remove('hidden');
}

function syncReplyComposer() {
  const canReply = !state.threadIsArchived && !state.threadIsLocked;
  els.replyComposer.classList.toggle('hidden', !state.replyComposerOpen || !canReply);
  els.postReplyToggle.classList.toggle('hidden', state.replyComposerOpen || !canReply);
  if (!state.replyComposerOpen || !canReply) {
    els.suggestions.classList.add('hidden');
  }
}

function openReplyComposer({ focus = true } = {}) {
  if (state.threadIsArchived || state.threadIsLocked) {
    showToast(state.threadIsLocked ? 'Chủ đề đã bị khóa, không thể trả lời.' : 'Chủ đề đã lưu trữ, không thể trả lời.');
    return;
  }
  state.replyComposerOpen = true;
  syncReplyComposer();
  const savedDraft = readDraft(draftKey('comment', state.threadId));
  if (savedDraft && !els.commentBody.value) {
    els.commentBody.value = savedDraft;
    updatePrivacyWarning(els.commentBody.value, els.commentPrivacyWarning);
  }
  if (focus) {
    window.setTimeout(() => els.commentBody.focus(), 0);
  }
}

function closeReplyComposer({ clear = false } = {}) {
  state.replyComposerOpen = false;
  if (clear) {
    els.commentBody.value = '';
    els.suggestions.classList.add('hidden');
  }
  syncReplyComposer();
}

function plainPreview(lines, fallback = '') {
  const text = (lines || [])
    .map((line) => line.text)
    .join(' ')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
    .replace(/\[\/?spoiler\]/gi, '')
    .trim();
  return text || fallback;
}

function threadSubject(thread) {
  return String(thread?.subject || '').trim();
}

function threadTitle(thread, fallback = 'Chưa có nội dung') {
  return threadSubject(thread) || plainPreview(thread?.bodyLines, fallback);
}

function threadSubjectHtml(thread) {
  const subject = threadSubject(thread);
  return subject ? `<div class="thread-subject">${escapeHtml(subject)}</div>` : '';
}

function homeBoardList() {
  const publicBoardsBySlug = new Map(state.boards.map((board) => [board.slug, board]));
  const groupedBoards = state.boardGroups
    .flatMap((group) => group.boards || [])
    .map((board) => publicBoardsBySlug.get(board.slug))
    .filter(Boolean);
  const source = groupedBoards.length ? [...groupedBoards, ...state.boards] : state.boards;
  const seen = new Set();
  return source.filter((board) => {
    if (!board || seen.has(board.slug)) {
      return false;
    }
    seen.add(board.slug);
    return true;
  });
}

function boardPostCount(threads = []) {
  return threads.reduce((total, thread) => total + 1 + Number(thread.replyCount || 0), 0);
}

function watchedThreadEntryFromDetail(detail, existing = {}, { markSeen = false } = {}) {
  const board = state.boards.find((item) => item.slug === detail.thread.boardSlug);
  const posts = [detail.thread, ...(detail.comments || [])];
  const currentMaxNumber = detail.commentPage?.currentMaxGlobalNumber || maxThreadPostNumber(detail);
  const fileCount = posts.reduce((total, post) => total + postMediaCount(post), 0);
  return {
    threadId: detail.thread.id,
    boardSlug: detail.thread.boardSlug,
    boardPath: board?.path || `/${detail.thread.boardSlug}/`,
    boardName: board?.name || detail.thread.boardSlug,
    globalNumber: detail.thread.globalNumber,
    preview: plainPreview(detail.thread.bodyLines, 'Không có nội dung').slice(0, 180),
    lastSeen: markSeen ? currentMaxNumber : Number(existing.lastSeen || 0),
    maxNumber: currentMaxNumber,
    replyCount: detail.thread.replyCount ?? detail.comments.length,
    fileCount: Math.max(Number(existing.fileCount || 0), fileCount),
    isArchived: Boolean(detail.thread.isArchived),
    updatedAt: detail.thread.bumpedAt || detail.thread.createdAt || new Date().toISOString()
  };
}

function syncWatchedThreadFromDetail(detail) {
  if (!isThreadWatched(detail.thread.id)) {
    return;
  }
  const watchedThreads = readWatchedThreads();
  watchedThreads[detail.thread.id] = watchedThreadEntryFromDetail(detail, watchedThreads[detail.thread.id], {
    markSeen: true
  });
  writeWatchedThreads(watchedThreads);
}

function removeWatchedThread(threadId) {
  const watchedThreads = readWatchedThreads();
  delete watchedThreads[threadId];
  writeWatchedThreads(watchedThreads);
}

function toggleCurrentThreadWatch() {
  if (!state.threadDetail?.thread?.id) {
    return;
  }

  const watchedThreads = readWatchedThreads();
  const threadId = state.threadDetail.thread.id;
  if (watchedThreads[threadId]) {
    delete watchedThreads[threadId];
    writeWatchedThreads(watchedThreads);
    showToast('Đã bỏ theo dõi chủ đề.');
  } else {
    watchedThreads[threadId] = watchedThreadEntryFromDetail(state.threadDetail, {}, { markSeen: true });
    writeWatchedThreads(watchedThreads);
    showToast('Đã theo dõi chủ đề.');
  }

  els.threadToolbarTop.innerHTML = threadToolbarHtml(state.threadDetail, 'top');
  els.threadToolbarBottom.innerHTML = threadToolbarHtml(state.threadDetail, 'bottom');
}

function sortWatchedThreads(left, right, sort = localDisplayPreferences().watchedSort) {
  const unavailableCompare = Number(Boolean(left.unavailable)) - Number(Boolean(right.unavailable));
  if (unavailableCompare !== 0) {
    return unavailableCompare;
  }
  if (sort === 'board') {
    const boardCompare = String(left.boardSlug || '').localeCompare(String(right.boardSlug || ''));
    if (boardCompare !== 0) {
      return boardCompare;
    }
    return Number(left.globalNumber || 0) - Number(right.globalNumber || 0);
  }
  if (sort === 'recent') {
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
  }
  const unreadDelta = Number(right.unreadCount || 0) - Number(left.unreadCount || 0);
  if (unreadDelta !== 0) {
    return unreadDelta;
  }
  return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
}

function visibleWatchedThreadSummaries(watchedThreads = state.watchedThreadSummaries) {
  const preferences = localDisplayPreferences();
  return watchedThreads
    .filter(
      (item) =>
        !isPostFiltered({
          ...item,
          id: item.threadId,
          body: item.preview,
          globalNumber: item.globalNumber
        })
    )
    .sort((left, right) => sortWatchedThreads(left, right, preferences.watchedSort));
}

function firstUnreadPostNumber(posts = [], lastSeen = 0) {
  const seenNumber = Number(lastSeen || 0);
  const firstUnread = posts
    .map((post) => Number(post.globalNumber || 0))
    .filter((globalNumber) => Number.isFinite(globalNumber) && globalNumber > seenNumber)
    .sort((left, right) => left - right)[0];
  return firstUnread || 0;
}

async function loadWatchedThreadSummaries() {
  const watchedEntries = Object.values(readWatchedThreads());
  if (!watchedEntries.length) {
    state.watchedThreadSummaries = [];
    syncWatchedControls({ unreadCount: 0 });
    return [];
  }

  const results = await Promise.all(
    watchedEntries.map(async (entry) => {
      try {
        const detail = await api(`/api/threads/${encodeURIComponent(entry.threadId)}`);
        const posts = [detail.thread, ...(detail.comments || [])];
        const unreadCount = posts.filter((post) => Number(post.globalNumber) > Number(entry.lastSeen || 0)).length;
        return {
          ...watchedThreadEntryFromDetail(detail, entry),
          unreadCount,
          firstUnreadNumber: firstUnreadPostNumber(posts, entry.lastSeen),
          unavailable: false
        };
      } catch {
        return {
          ...entry,
          unreadCount: 0,
          unavailable: true
        };
      }
    })
  );

  const watchedThreads = readWatchedThreads();
  results.forEach((item) => {
    if (!item.unavailable) {
      watchedThreads[item.threadId] = {
        threadId: item.threadId,
        boardSlug: item.boardSlug,
        boardPath: item.boardPath,
        boardName: item.boardName,
        globalNumber: item.globalNumber,
        preview: item.preview,
        lastSeen: item.lastSeen,
        maxNumber: item.maxNumber,
        replyCount: item.replyCount,
        fileCount: item.fileCount,
        isArchived: item.isArchived,
        updatedAt: item.updatedAt
      };
    }
  });
  writeWatchedThreads(watchedThreads);
  state.watchedThreadSummaries = visibleWatchedThreadSummaries(results);
  return state.watchedThreadSummaries;
}

function markWatchedThreadRead(threadId) {
  if (!threadId) {
    return false;
  }
  const watchedThreads = readWatchedThreads();
  const watched = watchedThreads[threadId];
  if (!watched) {
    return false;
  }

  const summary = state.watchedThreadSummaries.find((item) => item.threadId === threadId);
  const maxNumber = Math.max(
    Number(watched.maxNumber || 0),
    Number(watched.lastSeen || 0),
    Number(summary?.maxNumber || 0)
  );
  watchedThreads[threadId] = {
    ...watched,
    maxNumber,
    lastSeen: maxNumber
  };
  writeWatchedThreads(watchedThreads);
  writeThreadLastSeen(threadId, maxNumber);
  state.watchedThreadSummaries = state.watchedThreadSummaries.map((item) => {
    if (item.threadId !== threadId) {
      return item;
    }
    return {
      ...item,
      lastSeen: Math.max(Number(item.maxNumber || 0), maxNumber),
      unreadCount: 0,
      firstUnreadNumber: 0
    };
  });
  return true;
}

function markAllWatchedThreadsRead() {
  const unreadThreadIds = state.watchedThreadSummaries
    .filter((item) => Number(item.unreadCount || 0) > 0 && !item.unavailable)
    .map((item) => item.threadId)
    .filter(Boolean);
  unreadThreadIds.forEach((threadId) => markWatchedThreadRead(threadId));
  return unreadThreadIds.length;
}

function watchedThreadHref(item = {}) {
  if (item.unavailable || !item.threadId) {
    return '#home';
  }
  const threadPath = `#thread/${encodeURIComponent(item.threadId)}`;
  const firstUnreadNumber = Number(item.firstUnreadNumber || 0);
  return firstUnreadNumber > 0 ? `${threadPath}?p=${encodeURIComponent(firstUnreadNumber)}` : threadPath;
}

async function loadHomeThreadsByBoard() {
  const entries = await Promise.all(
    state.boards.map(async (board) => {
      try {
        const threads = await api(`/api/boards/${board.slug}/threads`);
        writeBoardThreadsCache(board.slug, threads, { page: 1, pageSize: state.boardPageSize });
        return [board.slug, threads];
      } catch {
        return [board.slug, []];
      }
    })
  );
  return Object.fromEntries(entries);
}

function renderHomeBoards(threadsByBoard = {}, stats = {}) {
  const rows = homeBoardList()
    .map((board) => {
      const postCount = boardPostCount(threadsByBoard[board.slug]);
      const boardUsers = Number(stats.boardUsers?.[board.slug] || 0);
      return `
        <tr>
          <td class="portal-board-icon-cell"><span class="board-row-icon" aria-hidden="true"></span></td>
          <td class="portal-board-name-cell">
            <a class="portal-board-link" href="#board/${board.slug}" title="${escapeHtml(board.description)}">
              <span class="board-path">${escapeHtml(board.path)}</span> - ${escapeHtml(board.name)}
            </a>
          </td>
          <td class="portal-board-desc-cell">${escapeHtml(board.description)}</td>
          <td class="portal-board-number-cell">${boardUsers.toLocaleString()}</td>
          <td class="portal-board-number-cell">${postCount.toLocaleString()}</td>
        </tr>
      `;
    })
    .join('');

  els.homeBoards.innerHTML = `
    <table class="portal-board-table">
      <colgroup>
        <col class="portal-board-icon-col">
        <col class="portal-board-name-col">
        <col class="portal-board-desc-col">
        <col class="portal-board-number-col">
        <col class="portal-board-number-col">
      </colgroup>
      <thead>
        <tr>
          <th class="portal-board-icon-head" scope="col"></th>
          <th scope="col">Bảng</th>
          <th scope="col">Mô Tả</th>
          <th scope="col">Người Dùng</th>
          <th scope="col">Bài Viết</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function popularThreadsFrom(threadsByBoard) {
  return Object.values(threadsByBoard)
    .flat()
    .sort((left, right) => right.bumpedAt.localeCompare(left.bumpedAt))
    .slice(0, 8);
}

function spoilerSummaryLabelHtml() {
  return '<span class="summary-spoiler-label">Spoiler</span>';
}

function popularThumbnailHtml(firstMedia, initials) {
  const thumbnailSrc = mediaThumbnailSrc(firstMedia);
  if (!firstMedia || !thumbnailSrc) {
    return `<span class="popular-placeholder">${escapeHtml(initials)}</span>`;
  }
  const spoiler = Boolean(firstMedia.spoiler);
  return `
    <span class="popular-thumb${spoiler ? ' spoiler-summary-thumb' : ''}">
      <img src="${escapeHtml(thumbnailSrc)}" alt="${escapeHtml(firstMedia.name)}">
      ${spoiler ? spoilerSummaryLabelHtml() : ''}
    </span>
  `;
}

function renderPopularThreads(threads) {
  const visibleThreads = threads.filter((thread) => !isPostFiltered(thread));
  if (!visibleThreads.length) {
    els.popularThreads.classList.add('popular-empty');
    els.popularThreads.innerHTML = `
      <p>
        Chưa có chủ đề nổi bật. Chủ đề công khai sẽ xuất hiện ở đây sau khi có người đăng bài.
      </p>
    `;
    return;
  }

  els.popularThreads.classList.remove('popular-empty');
  els.popularThreads.innerHTML = visibleThreads
    .map((thread) => {
      const board = state.boards.find((item) => item.slug === thread.boardSlug);
      const href = `#thread/${thread.id}`;
      const title = plainPreview(thread.bodyLines, board?.description).slice(0, 120);
      const initials = (board?.name || thread.boardSlug).slice(0, 2).toUpperCase();
      const firstMedia = mediaItemsFromPost(thread)[0];

      return `
        <a class="popular-item" href="${href}">
          <strong>${board?.name || thread.boardSlug}</strong>
          ${popularThumbnailHtml(firstMedia, initials)}
          <span>${title}${title.length >= 120 ? '...' : ''}</span>
        </a>
      `;
    })
    .join('');
}

function latestPostHref(post) {
  const threadId = post.threadId || post.id;
  if (!threadId) {
    return '#home';
  }
  return `#thread/${encodeURIComponent(threadId)}?p=${encodeURIComponent(post.globalNumber)}`;
}

function renderLatestPosts(posts) {
  const visiblePosts = posts.filter((post) => !isPostFiltered(post));
  if (!visiblePosts.length) {
    els.latestPosts.innerHTML = '<p class="latest-empty">Chưa có bài công khai.</p>';
    return;
  }

  els.latestPosts.innerHTML = visiblePosts
    .map((post) => {
      const board = state.boards.find((item) => item.slug === post.boardSlug);
      const preview = plainPreview(post.bodyLines, 'Không có nội dung').slice(0, 140);
      const kind = post.type === 'comment' ? 'Phản hồi' : 'Chủ đề';
      return `
        <a class="latest-post-item" href="${latestPostHref(post)}">
          <span class="latest-post-board">${escapeHtml(board?.path || `/${post.boardSlug}/`)}</span>
          <span class="latest-post-number">No.${post.globalNumber}</span>
          <span class="latest-post-kind">${kind}</span>
          <span class="latest-post-preview">${escapeHtml(preview)}${preview.length >= 140 ? '...' : ''}</span>
          <span class="latest-post-date">${formatPostDate(post.createdAt)}</span>
        </a>
      `;
    })
    .join('');
}

function renderWatchedThreads(watchedThreads = state.watchedThreadSummaries) {
  const allVisibleThreads = visibleWatchedThreadSummaries(watchedThreads);
  const unreadOnly = localDisplayPreferences().watchedUnreadOnly;
  const unreadCount = allVisibleThreads.filter((item) => Number(item.unreadCount || 0) > 0).length;
  const visibleThreads = unreadOnly
    ? allVisibleThreads.filter((item) => Number(item.unreadCount || 0) > 0)
    : allVisibleThreads;
  syncWatchedControls({ unreadOnly, unreadCount });

  if (!visibleThreads.length) {
    els.watchedThreads.innerHTML = allVisibleThreads.length
      ? '<p class="latest-empty">Không có chủ đề chưa đọc trong watchlist.</p>'
      : '<p class="latest-empty">Chưa theo dõi chủ đề nào. Vào một thread và bấm [Theo dõi].</p>';
    return;
  }

  els.watchedThreads.innerHTML = visibleThreads
    .map((item) => {
      const boardLabel = item.boardPath || `/${item.boardSlug || '?'}/`;
      const preview = item.unavailable
        ? 'Chủ đề không còn truy cập được hoặc đã bị xóa.'
        : item.preview || 'Không có nội dung';
      const href = watchedThreadHref(item);
      const unreadBadge = item.unreadCount
        ? `<span class="watch-unread">+${Number(item.unreadCount).toLocaleString()} mới</span>`
        : '<span class="watch-seen">đã đọc</span>';
      const stats = item.unavailable
        ? '<span class="watch-status">không khả dụng</span>'
        : `<span>${Number(item.replyCount || 0).toLocaleString()} trả lời</span><span>${Number(
            item.fileCount || 0
          ).toLocaleString()} tệp</span>`;

      return `
        <div class="watch-item ${item.unavailable ? 'watch-item-unavailable' : ''}">
          <a class="watch-thread-link" href="${href}">
            <span class="watch-board">${escapeHtml(boardLabel)}</span>
            <span class="watch-number">No.${escapeHtml(item.globalNumber || '?')}</span>
            ${unreadBadge}
            <span class="watch-preview">${escapeHtml(preview)}${preview.length >= 180 ? '...' : ''}</span>
            <span class="watch-stats">${stats}</span>
          </a>
          <button class="link-button watch-remove" data-unwatch-thread="${escapeHtml(item.threadId)}" type="button">[Bỏ]</button>
        </div>
      `;
    })
    .join('');
}

function renderMyPosts() {
  const items = myPosts();
  if (!items.length) {
    els.myPosts.innerHTML = '<p class="latest-empty">Chưa có bài nào được ghi nhớ trên trình duyệt này.</p>';
    return;
  }

  els.myPosts.innerHTML = items
    .slice(0, 10)
    .map((item) => {
      const href = `#thread/${encodeURIComponent(item.threadId)}?p=${encodeURIComponent(item.globalNumber)}`;
      const type = item.type === 'comment' ? 'Phản hồi' : 'Chủ đề';
      const preview = item.preview || 'Không có nội dung';
      return `
        <div class="watch-item">
          <a class="watch-thread-link" href="${href}">
            <span class="watch-board">/${escapeHtml(item.boardSlug || '?')}/</span>
            <span class="watch-number">No.${escapeHtml(item.globalNumber)}</span>
            <span class="watch-seen">${type}</span>
            <span class="watch-preview">${escapeHtml(preview)}${preview.length >= 160 ? '...' : ''}</span>
            <span class="watch-stats">${formatPostDate(item.createdAt)}</span>
          </a>
        </div>
      `;
    })
    .join('');
}

function renderSubscribedBoards() {
  const slugs = subscribedBoardSlugs();
  const boards = state.boards.filter((board) => slugs.has(board.slug));
  if (!boards.length) {
    els.subscribedBoards.innerHTML = '<p class="latest-empty">Chưa theo dõi bảng nào. Vào board và bấm [Theo dõi bảng].</p>';
    return;
  }

  els.subscribedBoards.innerHTML = `
    <table class="hot-board-table">
      <thead>
        <tr>
          <th scope="col">Bảng</th>
          <th scope="col">Mô tả</th>
          <th scope="col">Mở</th>
        </tr>
      </thead>
      <tbody>
        ${boards
          .map(
            (board) => `
              <tr>
                <td><a href="#board/${board.slug}">${escapeHtml(board.path)} ${escapeHtml(board.name)}</a></td>
                <td>${escapeHtml(board.description)}</td>
                <td><a href="#catalog/${board.slug}">Danh mục</a></td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
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

function renderHotBoards(boards) {
  if (!boards.length) {
    els.hotBoards.innerHTML = '<p class="latest-empty">Chưa có bảng nào nóng trong 24 giờ qua.</p>';
    return;
  }

  els.hotBoards.innerHTML = `
    <table class="hot-board-table">
      <thead>
        <tr>
          <th scope="col">Bảng</th>
          <th scope="col">Bài 24h</th>
          <th scope="col">Chủ đề</th>
          <th scope="col">Phản hồi</th>
          <th scope="col">Hoạt động cuối</th>
        </tr>
      </thead>
      <tbody>
        ${boards
          .map((item) => {
            const board = state.boards.find((entry) => entry.slug === item.boardSlug);
            const latest = item.latestActivityAt ? formatPostDate(item.latestActivityAt) : '-';
            return `
              <tr>
                <td><a href="#board/${item.boardSlug}">${escapeHtml(board?.path || `/${item.boardSlug}/`)}</a></td>
                <td>${Number(item.postCountLast24h || 0).toLocaleString()}</td>
                <td>${Number(item.threadCountLast24h || 0).toLocaleString()}</td>
                <td>${Number(item.replyCountLast24h || 0).toLocaleString()}</td>
                <td>${escapeHtml(latest)}</td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

function renderCampusPulse(items) {
  if (!items.length) {
    els.campusPulse.innerHTML = '<p class="latest-empty">Chưa đủ dữ liệu công khai trong 24 giờ qua.</p>';
    return;
  }
  els.campusPulse.innerHTML = `
    <table class="hot-board-table">
      <thead>
        <tr>
          <th scope="col">Từ khóa</th>
          <th scope="col">Lần nhắc</th>
          <th scope="col">Bảng</th>
          <th scope="col">Mới nhất</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${escapeHtml(item.keyword)}</td>
                <td>${item.count}</td>
                <td>${item.boardCount}</td>
                <td>${escapeHtml(item.latestActivityAt ? formatPostDate(item.latestActivityAt) : '-')}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderStats(stats) {
  els.homeStats.innerHTML = `
    <span><strong>Tổng bài viết:</strong> ${stats.totalPosts.toLocaleString()}</span>
    <span><strong>Người dùng hiện tại:</strong> ${stats.currentUsers.toLocaleString()}</span>
    <span><strong>Dung lượng nội dung:</strong> ${stats.activeContentMb.toLocaleString()} MB</span>
    <span><strong>Bảng đang hoạt động:</strong> ${stats.activeBoards.toLocaleString()}</span>
  `;
  els.serverStats.innerHTML = `
    <p>
      Hiện có <strong>${stats.publicBoardCount.toLocaleString()}</strong> bảng công khai,
      tổng cộng <strong>${stats.totalBoardCount.toLocaleString()}</strong>.
      Trên toàn hệ thống, <strong>${stats.postCountLast24h.toLocaleString()}</strong> bài viết
      đã được đăng trong ngày qua, <strong>${stats.postCountLastHour.toLocaleString()}</strong>
      bài trong giờ qua, tổng cộng <strong>${stats.totalPosts.toLocaleString()}</strong>.
    </p>
    <p>
      <strong>${stats.fileCount.toLocaleString()}</strong> tệp đang được phục vụ,
      tổng cộng <strong>${stats.fileMegabytes.toLocaleString()}MB</strong>.
    </p>
  `;
}

function moderationActionText(action) {
  return (
    {
      'ai:moderate': 'AI kiểm duyệt',
      'admin:approve': 'Quản trị viên duyệt',
      'admin:delete': 'Quản trị viên xóa',
      'admin:note': 'Ghi chú',
      'admin:cooldown': 'Làm chậm',
      'admin:ban': 'Tạm khóa',
      'admin:unsanction': 'Gỡ khóa',
      'admin:sticky': 'Ghim chủ đề',
      'admin:unsticky': 'Gỡ ghim chủ đề',
      'admin:lock': 'Khóa chủ đề',
      'admin:unlock': 'Mở khóa chủ đề'
    }[action] || action
  );
}

function moderationActionsHtml(actions) {
  if (!actions.length) {
    return '<p class="muted">Chưa có nhật ký kiểm duyệt.</p>';
  }

  return `
    <table class="moderation-log-table">
      <thead>
        <tr>
          <th>Thời gian</th>
          <th>Hành động</th>
          <th>Bài</th>
          <th>Nhãn</th>
          <th>Tin cậy</th>
          <th>Lý do</th>
          <th>Người xử lý</th>
        </tr>
      </thead>
      <tbody>
        ${actions
          .map(
            (action) => `
              <tr>
                <td>${formatPostDate(action.createdAt)}</td>
                <td>${escapeHtml(moderationActionText(action.action))}</td>
                <td>${escapeHtml(action.boardSlug)} / No.${action.globalNumber}</td>
                <td>${escapeHtml((action.moderationLabels || []).map(moderationLabelText).join(', ') || moderationStatusText(action.moderationStatus))}</td>
                <td>${escapeHtml(moderationConfidenceText(action.moderationConfidence))}</td>
                <td>${escapeHtml(action.reason || '-')}</td>
                <td>${escapeHtml(action.actor || '-')}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function reportsHtml(reports) {
  if (!reports.length) {
    return '<p class="muted">Chưa có báo cáo nào.</p>';
  }

  return `
    <table class="moderation-log-table">
      <thead>
        <tr>
          <th>Thời gian</th>
          <th>Bài</th>
          <th>Ưu tiên</th>
          <th>Loại</th>
          <th>Lý do</th>
          <th>Người báo cáo</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${reports
          .map(
            (report) => `
              <tr>
                <td>${formatPostDate(report.createdAt)}</td>
                <td>${escapeHtml(report.boardSlug)} / No.${report.globalNumber}</td>
                <td>${moderationPriorityHtml(report.moderationPriority)}</td>
                <td>${escapeHtml(reportCategoryLabel(report.category))}</td>
                <td>${escapeHtml(report.reason || '-')}</td>
                <td>${escapeHtml(posterId({ posterHash: report.reporterHash }))}</td>
                <td><button class="ghost-button" data-admin-detail="${report.globalNumber}" type="button">[Chi tiết]</button></td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function appealStatusLabel(status = '') {
  if (status === 'open') return 'Đang mở';
  if (status === 'accepted') return 'Đã chấp nhận';
  if (status === 'rejected') return 'Đã từ chối';
  return status || '-';
}

function appealsHtml(appeals) {
  if (!appeals.length) {
    return '<p class="muted">Chưa có kháng nghị nào.</p>';
  }

  return `
    <table class="moderation-log-table">
      <thead>
        <tr>
          <th>Gửi lúc</th>
          <th>Bài</th>
          <th>Trạng thái</th>
          <th>Lý do</th>
          <th>Dấu vết</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${appeals
          .map(
            (appeal) => `
              <tr>
                <td>${formatPostDate(appeal.submittedAt || appeal.createdAt)}</td>
                <td>${escapeHtml(appeal.boardSlug)} / No.${appeal.globalNumber}</td>
                <td>${escapeHtml(appealStatusLabel(appeal.status))}</td>
                <td>${escapeHtml(appeal.reason || '-')}</td>
                <td>${escapeHtml(appeal.reporterHashPreview || '-')}</td>
                <td>
                  <button class="ghost-button" data-admin-detail="${appeal.globalNumber}" type="button">[Chi tiết]</button>
                  ${appeal.status === 'open' ? `
                    <button class="primary-button" data-admin-resolve-appeal="${appeal.id}" data-status="accepted" type="button">Chấp nhận</button>
                    <button class="danger-button" data-admin-resolve-appeal="${appeal.id}" data-status="rejected" type="button">Từ chối</button>
                  ` : ''}
                </td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function deletedPostsHtml(posts) {
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

function sanctionsHtml(sanctions) {
  if (!sanctions.length) {
    return '<p class="muted">Chưa có lệnh làm chậm/tạm khóa.</p>';
  }

  return `
    <table class="moderation-log-table">
      <thead>
        <tr>
          <th>Tạo lúc</th>
          <th>Hết hạn</th>
          <th>Loại</th>
          <th>Nguồn</th>
          <th>Dấu vết</th>
          <th>Lý do</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${sanctions
          .map(
            (sanction) => `
              <tr>
                <td>${formatPostDate(sanction.createdAt)}</td>
                <td>${formatPostDate(sanction.expiresAt)}</td>
                <td>${sanction.kind === 'ban' ? 'Tạm khóa' : 'Làm chậm'}</td>
                <td>${escapeHtml(sanction.boardSlug)} / No.${sanction.sourceGlobalNumber}</td>
                <td>${escapeHtml(sanction.fingerprintPreview || '-')}</td>
                <td>${escapeHtml(sanction.reason || '-')}</td>
                <td>${sanction.revokedAt ? 'Đã gỡ' : `<button class="danger-button" data-admin-revoke-sanction="${sanction.id}" type="button">Gỡ</button>`}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function pendingPostsHtml(posts) {
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

function editHistoryMediaHtml(images = []) {
  const media = mediaList(images);
  if (!media.length) {
    return '<p class="muted">Không có tệp.</p>';
  }
  return `<div class="post-media-gallery">${media.map((image) => mediaToggleHtml(image, 'thumb')).join('')}</div>`;
}

function editHistoryHtml(history = []) {
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
                <span>${formatPostDate(entry.createdAt)}</span>
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

function adminPostDetailHtml(detail) {
  const post = detail.post;
  const actions = detail.actions || [];
  const reports = detail.reports || [];
  const appeals = detail.appeals || [];
  const sanctions = detail.sanctions || [];
  const editHistory = detail.editHistory || [];
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
      ${reports.length ? reportsHtml(reports) : '<p class="muted">Không có báo cáo.</p>'}
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

function historyActionsHtml(actions) {
  return moderationActionsHtml(actions);
}

function analyticsCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : 0;
}

function normalizeAnalyticsBoard(slug, board = {}) {
  const boardMeta = state.boards.find((item) => item.slug === (board.slug || slug));
  const threads = board.threads || {};
  const comments = board.comments || {};
  return {
    slug: board.slug || slug || '',
    name: board.name || boardMeta?.name || board.slug || slug || 'Board',
    threads: {
      active: analyticsCount(threads.active ?? board.activeThreads),
      pending: analyticsCount(threads.pending ?? board.pendingThreads),
      deleted: analyticsCount(threads.deleted ?? board.deletedThreads)
    },
    comments: {
      active: analyticsCount(comments.active ?? board.activeComments),
      pending: analyticsCount(comments.pending ?? board.pendingComments),
      deleted: analyticsCount(comments.deleted ?? board.deletedComments)
    },
    reportsCount: analyticsCount(board.reportsCount ?? board.totalReports)
  };
}

function analyticsBoardActivityRows(boardActivity) {
  if (Array.isArray(boardActivity)) {
    return boardActivity.map((board) => normalizeAnalyticsBoard(board?.slug, board));
  }
  if (boardActivity && typeof boardActivity === 'object') {
    return Object.entries(boardActivity).map(([slug, board]) => normalizeAnalyticsBoard(slug, board));
  }
  return [];
}

function adminAnalyticsHtml(analytics = {}) {
  const boardRows = analyticsBoardActivityRows(analytics.boardActivity)
    .map((board) => {
      return `
        <tr>
          <td><strong>/${escapeHtml(board.slug)}/</strong> - ${escapeHtml(board.name)}</td>
          <td>${board.threads.active} / ${board.threads.pending} / ${board.threads.deleted}</td>
          <td>${board.comments.active} / ${board.comments.pending} / ${board.comments.deleted}</td>
          <td><span class="analytics-badge">${board.reportsCount}</span></td>
        </tr>
      `;
    })
    .join('');

  const kindList = Object.entries(analytics.aiUsage?.byKind || {})
    .map(([kind, count]) => `<li><strong>${escapeHtml(kind)}:</strong> ${count} yêu cầu</li>`)
    .join('');

  const dailyRows = (analytics.aiUsage?.daily || [])
    .map((day) => `<tr><td>${escapeHtml(day.date)}</td><td>${day.count} yêu cầu</td></tr>`)
    .join('');

  const queue = analytics.moderationQueue || {};
  return `
    <div class="analytics-dashboard">
      <div class="analytics-row">
        <div class="analytics-card">
          <h4>Hàng đợi kiểm duyệt</h4>
          <div class="analytics-metric">${queue.pendingCount}</div>
          <p class="muted">${queue.pendingThreads} chủ đề, ${queue.pendingComments} bình luận chưa duyệt</p>
        </div>
        <div class="analytics-card">
          <h4>Thời gian chờ lâu nhất</h4>
          <div class="analytics-metric">${queue.oldestPendingAgeMinutes}m</div>
          <p class="muted">Tuổi của bài viết chờ duyệt lâu nhất</p>
        </div>
        <div class="analytics-card">
          <h4>Thời gian giải quyết TB</h4>
          <div class="analytics-metric">${queue.averageResolutionTimeMinutes}m</div>
          <p class="muted">Trung bình từ lúc đăng đến khi duyệt/xóa (Tổng: ${queue.resolvedCount || 0})</p>
        </div>
        <div class="analytics-card">
          <h4>Tổng lượt gọi AI</h4>
          <div class="analytics-metric">${analytics.aiUsage?.total || 0}</div>
          <p class="muted">Tóm tắt, gợi ý bình luận và viết lại nháp</p>
        </div>
      </div>

      <div class="analytics-grid">
        <div class="analytics-section">
          <h3>Hoạt động của Bảng tin</h3>
          <table class="analytics-table">
            <thead>
              <tr>
                <th>Bảng</th>
                <th>Chủ đề (Duyệt/Chờ/Xóa)</th>
                <th>Bình luận (Duyệt/Chờ/Xóa)</th>
                <th>Lượt báo cáo</th>
              </tr>
            </thead>
            <tbody>
              ${boardRows}
            </tbody>
          </table>
        </div>

        <div class="analytics-section">
          <h3>Sử dụng AI chi tiết</h3>
          <ul>
            ${kindList}
          </ul>
          <h3>Biểu đồ sử dụng hàng ngày (7 ngày qua)</h3>
          <table class="analytics-table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Số lượt gọi</th>
              </tr>
            </thead>
            <tbody>
              ${dailyRows}
            </tbody>
          </table>
        </div>
      </div>

      <div class="analytics-section">
        <h3>Bản tổng hợp bảng tin (AI)</h3>
        <p class="muted">Quản trị viên kích hoạt thủ công. Chỉ dùng nội dung bài viết công khai; không gửi dữ liệu tài khoản, IP hay token cho AI.</p>
        <button type="button" class="btn" data-board-digest>Tạo bản tổng hợp hôm nay</button>
        <div data-board-digest-result class="reports-summary-box hidden"></div>
      </div>
    </div>
  `;
}

function renderAdminAnalytics(analytics) {
  renderAdminTabs();
  els.pendingList.innerHTML = adminAnalyticsHtml(analytics);
  if (els.adminSelectAll) {
    els.adminSelectAll.checked = false;
  }
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

function healthStatusBadge(ready, label) {
  const color = ready ? '#2b8a3e' : '#c92a2a';
  const icon = ready ? '✔' : '✘';
  return `<span style="color:${color}; font-weight:bold;">${icon} ${escapeHtml(label)}</span>`;
}

function adminHealthHtml(health) {
  const overallColor = health.status === 'ok' ? '#2b8a3e' : '#c92a2a';
  const overallIcon = health.status === 'ok' ? '✔' : '⚠';

  const storeRows = health.store ? `
    <tr><td>Loại</td><td><strong>${escapeHtml(health.store.type || 'unknown')}</strong></td></tr>
    <tr><td>Trạng thái</td><td>${healthStatusBadge(health.store.ready, health.store.ready ? 'Sẵn sàng' : 'Không sẵn sàng')}</td></tr>
    ${health.store.threads !== undefined ? `<tr><td>Chủ đề</td><td>${health.store.threads}</td></tr>` : ''}
    ${health.store.comments !== undefined ? `<tr><td>Bình luận</td><td>${health.store.comments}</td></tr>` : ''}
    ${health.store.users !== undefined ? `<tr><td>Tài khoản</td><td>${health.store.users}</td></tr>` : ''}
    ${health.store.reports !== undefined ? `<tr><td>Báo cáo</td><td>${health.store.reports}</td></tr>` : ''}
    ${health.store.sanctions !== undefined ? `<tr><td>Lệnh chế tài</td><td>${health.store.sanctions}</td></tr>` : ''}
    ${health.store.moderationActions !== undefined ? `<tr><td>Kiểm duyệt</td><td>${health.store.moderationActions}</td></tr>` : ''}
    ${health.store.nextGlobalNumber !== undefined ? `<tr><td>Số bài kế tiếp</td><td>#${health.store.nextGlobalNumber}</td></tr>` : ''}
  ` : '<tr><td colspan="2" class="muted">Không có dữ liệu</td></tr>';

  const aiRows = health.ai ? `
    <tr><td>Provider</td><td><strong>${escapeHtml(health.ai.provider || 'unknown')}</strong></td></tr>
    <tr><td>Trạng thái</td><td>${healthStatusBadge(health.ai.configured, health.ai.configured ? 'Đã cấu hình' : 'Chưa cấu hình')}</td></tr>
    <tr><td>Model</td><td>${escapeHtml(health.ai.model || 'unknown')}</td></tr>
    <tr><td>Ngưỡng hàng đợi</td><td>${escapeHtml(moderationConfidenceText(health.ai.moderationConfidenceThreshold))}</td></tr>
  ` : '<tr><td colspan="2" class="muted">Không có dữ liệu</td></tr>';

  const imageRows = health.imageStorage ? `
    <tr><td>Loại</td><td><strong>${escapeHtml(health.imageStorage.type || 'unknown')}</strong></td></tr>
    <tr><td>Trạng thái</td><td>${healthStatusBadge(health.imageStorage.ready, health.imageStorage.ready ? 'Sẵn sàng' : 'Không sẵn sàng')}</td></tr>
    ${health.imageStorage.error ? `<tr><td>Lỗi</td><td style="color:#c92a2a;">${escapeHtml(health.imageStorage.error)}</td></tr>` : ''}
  ` : '<tr><td colspan="2" class="muted">Không có dữ liệu</td></tr>';

  const realtimeRows = health.realtime ? `
    <tr><td>SSE clients</td><td><strong>${health.realtime.clients ?? 0}</strong></td></tr>
    ${health.realtime.boards ? Object.entries(health.realtime.boards).map(([slug, count]) =>
      `<tr><td style="padding-left:20px;">/${escapeHtml(slug)}/</td><td>${count}</td></tr>`
    ).join('') : ''}
  ` : '<tr><td colspan="2" class="muted">Không có dữ liệu</td></tr>';

  const captchaRows = health.captcha ? `
    <tr><td>Provider</td><td><strong>${escapeHtml(health.captcha.provider || 'unknown')}</strong></td></tr>
    <tr><td>Trạng thái</td><td>${healthStatusBadge(health.captcha.configured, health.captcha.configured ? 'Đã cấu hình' : 'Chưa cấu hình')}</td></tr>
  ` : '';

  const securityWarnings = health.security?.warnings?.length
    ? health.security.warnings.map((w) => `<li style="color:#c92a2a;">${escapeHtml(w.replace(/_/g, ' '))}</li>`).join('')
    : '<li style="color:#2b8a3e;">Không có cảnh báo</li>';

  const processRows = health.process ? `
    <tr><td>Node.js</td><td><strong>${escapeHtml(health.process.nodeVersion)}</strong></td></tr>
    <tr><td>Platform</td><td>${escapeHtml(health.process.platform)} / ${escapeHtml(health.process.arch)}</td></tr>
    <tr><td>PID</td><td>${health.process.pid}</td></tr>
    <tr><td>Uptime</td><td><strong>${formatUptime(health.process.uptimeSeconds)}</strong></td></tr>
    <tr><td>RSS</td><td>${formatBytes(health.process.memory.rss)}</td></tr>
    <tr><td>Heap used</td><td>${formatBytes(health.process.memory.heapUsed)} / ${formatBytes(health.process.memory.heapTotal)}</td></tr>
    <tr><td>External</td><td>${formatBytes(health.process.memory.external)}</td></tr>
  ` : '';

  return `
    <div class="health-dashboard">
      <div class="health-header">
        <span style="color:${overallColor}; font-size:1.2em; font-weight:bold;">${overallIcon} ${health.status === 'ok' ? 'Hệ thống hoạt động bình thường' : 'Hệ thống đang gặp sự cố'}</span>
        <span class="muted" style="margin-left:12px;">Kiểm tra lúc ${escapeHtml(health.checkedAt ? new Date(health.checkedAt).toLocaleString('vi-VN') : '—')}</span>
      </div>
      <div class="health-grid">
        <div class="health-card">
          <h3>Cơ sở dữ liệu</h3>
          <table class="health-table"><tbody>${storeRows}</tbody></table>
        </div>
        <div class="health-card">
          <h3>AI kiểm duyệt</h3>
          <table class="health-table"><tbody>${aiRows}</tbody></table>
        </div>
        <div class="health-card">
          <h3>Lưu trữ ảnh</h3>
          <table class="health-table"><tbody>${imageRows}</tbody></table>
        </div>
        <div class="health-card">
          <h3>Kết nối thời gian thực</h3>
          <table class="health-table"><tbody>${realtimeRows}</tbody></table>
        </div>
        ${captchaRows ? `
        <div class="health-card">
          <h3>Captcha</h3>
          <table class="health-table"><tbody>${captchaRows}</tbody></table>
        </div>` : ''}
        <div class="health-card">
          <h3>Bảo mật</h3>
          <table class="health-table"><tbody>
            <tr><td>Admin auth</td><td>${healthStatusBadge(health.security?.adminConfigured, health.security?.adminConfigured ? 'Đã cấu hình' : 'Chưa cấu hình')}</td></tr>
          </tbody></table>
          <h4>Cảnh báo</h4>
          <ul class="health-warnings">${securityWarnings}</ul>
        </div>
        ${processRows ? `
        <div class="health-card">
          <h3>Tiến trình</h3>
          <table class="health-table"><tbody>${processRows}</tbody></table>
        </div>` : ''}
      </div>
    </div>
  `;
}

function renderAdminHealth(data) {
  renderAdminTabs();
  els.pendingList.innerHTML = adminHealthHtml(data);
  if (els.adminSelectAll) {
    els.adminSelectAll.checked = false;
  }
}

function syncAdminModerationSettings(settings = {}) {
  const threshold = Number(settings.moderationConfidenceThreshold ?? state.moderationConfidenceThreshold ?? 0);
  state.moderationConfidenceThreshold = Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0;
  if (els.adminQueueThresholdInput) {
    els.adminQueueThresholdInput.value = String(Math.round(state.moderationConfidenceThreshold * 100));
  }
}

async function loadAdminModerationSettings() {
  const settings = await api('/api/admin/moderation-settings');
  syncAdminModerationSettings(settings);
}

async function saveAdminModerationSettings() {
  const button = els.adminSaveModerationSettings;
  const restore = button ? setButtonLoading(button, 'Đang lưu...') : () => {};
  try {
    const settings = await api('/api/admin/moderation-settings', {
      method: 'PUT',
      body: JSON.stringify({
        moderationConfidenceThreshold: els.adminQueueThresholdInput?.value || 0
      })
    });
    syncAdminModerationSettings(settings);
    showToast('Đã lưu ngưỡng kiểm duyệt.');
  } catch (error) {
    showToast(error.message);
  } finally {
    restore();
  }
}

function adminQueryString() {
  const params = new URLSearchParams();
  if (els.adminBoardFilter.value) {
    params.set('boardSlug', els.adminBoardFilter.value);
  }
  if (state.adminTab !== 'reports' && els.adminLabelFilter.value) {
    params.set('label', els.adminLabelFilter.value);
  }
  if (state.adminTab === 'reports' && els.adminReportCategoryFilter.value) {
    params.set('category', els.adminReportCategoryFilter.value);
  }
  if (els.adminTimeFilter.value) {
    const since = new Date(Date.now() - (els.adminTimeFilter.value === '24h' ? 24 : 24 * 7) * 60 * 60 * 1000);
    params.set('since', since.toISOString());
  }
  if ((state.adminTab === 'pending' || state.adminTab === 'reports') && els.adminPriorityFilter.value) {
    params.set('priority', els.adminPriorityFilter.value);
  }
  if (state.adminTab === 'pending' && els.adminConfidenceFilter?.value) {
    params.set('confidence', els.adminConfidenceFilter.value);
  }
  if ((state.adminTab === 'pending' || state.adminTab === 'reports') && els.adminPrioritySort.value) {
    params.set('sort', els.adminPrioritySort.value);
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
    return `/api/admin/analytics`;
  }
  if (state.adminTab === 'health') {
    return '/api/admin/health';
  }
  return `/api/admin/pending${suffix}`;
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

function adminBoardPayload(root, { includeSlug = false } = {}) {
  const retentionPolicy = {
    maxActiveThreadsPerBoard: root.querySelector('[data-admin-board-retention-max]')?.value || '',
    bumpLimit: root.querySelector('[data-admin-board-retention-bump]')?.value || '',
    replyLimit: root.querySelector('[data-admin-board-retention-reply]')?.value || '',
    publicArchive: Boolean(root.querySelector('[data-admin-board-retention-public-archive]')?.checked)
  };
  const payload = {
    name: root.querySelector('[data-admin-board-name]')?.value || '',
    category: root.querySelector('[data-admin-board-category]')?.value || '',
    description: root.querySelector('[data-admin-board-description]')?.value || '',
    rules: (root.querySelector('[data-admin-board-rules]')?.value || '')
      .split(/\r?\n/)
      .map((rule) => rule.trim())
      .filter(Boolean),
    banner: {
      text: root.querySelector('[data-admin-board-banner-text]')?.value || '',
      imageUrl: root.querySelector('[data-admin-board-banner-image-url]')?.value || '',
      altText: root.querySelector('[data-admin-board-banner-alt]')?.value || ''
    },
    temporary: Boolean(root.querySelector('[data-admin-board-temporary]')?.checked),
    eventEndsAt: root.querySelector('[data-admin-board-event-ends-at]')?.value || '',
    isHidden: Boolean(root.querySelector('[data-admin-board-hidden]')?.checked),
    isArchived: Boolean(root.querySelector('[data-admin-board-archived]')?.checked),
    retentionPolicy
  };
  if (includeSlug) {
    payload.slug = root.querySelector('[data-admin-board-slug]')?.value || '';
  }
  return payload;
}

function formatDateTimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (number) => String(number).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + 'T' + [pad(date.getHours()), pad(date.getMinutes())].join(':');
}

function adminUserPayload(root, { includeUsername = false } = {}) {
  const payload = {
    role: root.querySelector('[data-admin-user-role]')?.value || 'viewer',
    disabled: Boolean(root.querySelector('[data-admin-user-disabled]')?.checked)
  };
  const password = root.querySelector('[data-admin-user-password]')?.value || '';
  if (password) {
    payload.password = password;
  }
  if (includeUsername) {
    payload.username = root.querySelector('[data-admin-user-username]')?.value || '';
    payload.password = password;
  }
  return payload;
}

function adminBoardsHtml(boards) {
  const lifecycle = state.lifecycle || {};
  const rows = boards
    .map((board) => {
      const retentionPolicy = board.retentionPolicy || {};
      const eventEndsAt = formatDateTimeLocal(board.eventEndsAt);
      const rulesText = Array.isArray(board.rules) ? board.rules.join('\n') : '';
      const banner = board.banner || {};
      return `
        <tr data-admin-board-row="${escapeHtml(board.slug)}">
          <td class="admin-board-slug-cell" data-label="Board"><code>/${escapeHtml(board.slug)}/</code></td>
          <td data-label="Tên"><input data-admin-board-name aria-label="Tên board /${escapeHtml(board.slug)}/" value="${escapeHtml(board.name)}" maxlength="80" /></td>
          <td data-label="Danh mục"><input data-admin-board-category aria-label="Danh mục board /${escapeHtml(board.slug)}/" value="${escapeHtml(board.category)}" maxlength="80" /></td>
          <td data-label="Mô tả"><input data-admin-board-description aria-label="Mô tả board /${escapeHtml(board.slug)}/" value="${escapeHtml(board.description)}" maxlength="240" /></td>
          <td data-label="Metadata">
            <div class="admin-board-metadata">
              <label><span>Nội quy</span><textarea data-admin-board-rules aria-label="Nội quy board /${escapeHtml(board.slug)}/" rows="3" maxlength="2000">${escapeHtml(rulesText)}</textarea></label>
              <label><span>Banner</span><input data-admin-board-banner-text aria-label="Banner board /${escapeHtml(board.slug)}/" value="${escapeHtml(banner.text || '')}" maxlength="180" /></label>
              <label><span>Ảnh banner</span><input data-admin-board-banner-image-url aria-label="URL ảnh banner board /${escapeHtml(board.slug)}/" value="${escapeHtml(banner.imageUrl || '')}" maxlength="300" /></label>
              <label><span>Alt ảnh</span><input data-admin-board-banner-alt aria-label="Alt ảnh banner board /${escapeHtml(board.slug)}/" value="${escapeHtml(banner.altText || '')}" maxlength="140" /></label>
            </div>
          </td>
          <td data-label="Retention">
            <div class="admin-board-retention">
              <label><span>Active</span><input data-admin-board-retention-max aria-label="Giới hạn chủ đề active board /${escapeHtml(board.slug)}/" type="number" min="1" step="1" value="${escapeHtml(retentionPolicy.maxActiveThreadsPerBoard ?? '')}" /></label>
              <label><span>Bump</span><input data-admin-board-retention-bump aria-label="Bump limit board /${escapeHtml(board.slug)}/" type="number" min="1" step="1" value="${escapeHtml(retentionPolicy.bumpLimit ?? '')}" /></label>
              <label><span>Reply</span><input data-admin-board-retention-reply aria-label="Reply limit board /${escapeHtml(board.slug)}/" type="number" min="1" step="1" value="${escapeHtml(retentionPolicy.replyLimit ?? '')}" /></label>
              <label><input data-admin-board-retention-public-archive type="checkbox" ${retentionPolicy.publicArchive === false ? '' : 'checked'} /> Public archive</label>
            </div>
          </td>
          <td data-label="Trạng thái">
            <div class="admin-board-flags">
              <label><input data-admin-board-hidden type="checkbox" ${board.isHidden ? 'checked' : ''} /> Ẩn</label>
              <label><input data-admin-board-archived type="checkbox" ${board.isArchived ? 'checked' : ''} /> Lưu trữ</label>
              <label><input data-admin-board-temporary type="checkbox" ${board.temporary ? 'checked' : ''} /> Tạm thời</label>
              <label><span>Kết thúc</span><input data-admin-board-event-ends-at aria-label="Thời điểm kết thúc board /${escapeHtml(board.slug)}/" type="datetime-local" value="${escapeHtml(eventEndsAt)}" /></label>
            </div>
          </td>
          <td data-label="Thao tác">
            <div class="admin-board-actions">
              <button class="ghost-button" data-admin-board-save type="button" aria-label="Lưu board /${escapeHtml(board.slug)}/">[Lưu]</button>
              <button class="danger-button" data-admin-board-delete type="button" aria-label="Xóa board /${escapeHtml(board.slug)}/">Xóa</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="admin-board-manager">
      <section class="admin-board-create" data-admin-board-create-form>
        <h2>Thêm bảng</h2>
        <div class="admin-board-create-grid">
          <label><span>Slug</span><input data-admin-board-slug placeholder="an-uong" maxlength="40" /></label>
          <label><span>Tên</span><input data-admin-board-name placeholder="Ăn uống" maxlength="80" /></label>
          <label><span>Danh mục</span><input data-admin-board-category placeholder="Đời sống" maxlength="80" /></label>
          <label><span>Mô tả</span><input data-admin-board-description placeholder="Chia sẻ quán ăn, căn tin, deal sinh viên" maxlength="240" /></label>
          <label><span>Nội quy</span><textarea data-admin-board-rules rows="3" maxlength="2000" placeholder="Mỗi dòng là một nội quy"></textarea></label>
          <label><span>Banner</span><input data-admin-board-banner-text maxlength="180" placeholder="Thông báo ngắn trên board" /></label>
          <label><span>Ảnh banner</span><input data-admin-board-banner-image-url maxlength="300" placeholder="/uploads/banner.png hoặc https://..." /></label>
          <label><span>Alt ảnh</span><input data-admin-board-banner-alt maxlength="140" placeholder="Mô tả ảnh banner" /></label>
          <label><span>Active cap</span><input data-admin-board-retention-max type="number" min="1" step="1" value="${escapeHtml(lifecycle.maxActiveThreadsPerBoard ?? 150)}" /></label>
          <label><span>Bump limit</span><input data-admin-board-retention-bump type="number" min="1" step="1" value="${escapeHtml(lifecycle.bumpLimit ?? 300)}" /></label>
          <label><span>Reply limit</span><input data-admin-board-retention-reply type="number" min="1" step="1" value="${escapeHtml(lifecycle.replyLimit ?? 500)}" /></label>
          <label><input data-admin-board-hidden type="checkbox" /> Ẩn khỏi public</label>
          <label><input data-admin-board-archived type="checkbox" /> Lưu trữ</label>
          <label><input data-admin-board-temporary type="checkbox" /> Board sự kiện tạm thời</label>
          <label><span>Kết thúc</span><input data-admin-board-event-ends-at type="datetime-local" /></label>
          <label><input data-admin-board-retention-public-archive type="checkbox" checked /> Public archive</label>
          <button class="primary-button" data-admin-board-create type="button">Tạo bảng</button>
        </div>
      </section>
      <div class="admin-board-table-wrap admin-board-table-wrap-boards">
        <table class="admin-board-table">
          <thead>
            <tr>
              <th>Board</th>
              <th>Tên</th>
              <th>Danh mục</th>
              <th>Mô tả</th>
              <th>Metadata</th>
              <th>Retention</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8">Chưa có board.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="muted">Xóa chỉ áp dụng cho board rỗng. Board đã có nội dung nên dùng Ẩn hoặc Lưu trữ.</p>
    </div>
  `;
}

function adminRoleLabel(role = '') {
  if (role === 'owner') return 'Owner';
  if (role === 'moderator') return 'Moderator';
  if (role === 'viewer') return 'Viewer';
  return role || 'User';
}

function adminRoleOptions(selected = 'viewer') {
  return ['owner', 'moderator', 'viewer']
    .map((role) => `<option value="${role}" ${selected === role ? 'selected' : ''}>${adminRoleLabel(role)}</option>`)
    .join('');
}

function adminUsersHtml(users = []) {
  const rows = users
    .map(
      (user) => `
        <tr data-admin-user-row="${escapeHtml(user.id)}">
          <td><strong>@${escapeHtml(user.username)}</strong></td>
          <td>
            <select data-admin-user-role aria-label="Vai trò @${escapeHtml(user.username)}">
              ${adminRoleOptions(user.role)}
            </select>
          </td>
          <td>${user.twoFactorEnabled ? 'Đã bật' : 'Chưa bật'}</td>
          <td><label><input data-admin-user-disabled type="checkbox" ${user.disabled ? 'checked' : ''} /> Vô hiệu hóa</label></td>
          <td><input data-admin-user-password aria-label="Đổi mật khẩu @${escapeHtml(user.username)}" type="password" minlength="10" placeholder="Đổi mật khẩu" autocomplete="new-password" /></td>
          <td class="admin-board-actions">
            <button class="ghost-button" data-admin-user-save type="button" aria-label="Lưu tài khoản @${escapeHtml(user.username)}">[Lưu]</button>
            <button class="danger-button" data-admin-user-disable type="button" aria-label="Tắt tài khoản @${escapeHtml(user.username)}" ${user.disabled ? 'disabled' : ''}>Tắt</button>
          </td>
        </tr>
      `
    )
    .join('');

  return `
    <div class="admin-board-manager">
      <section class="admin-board-create" data-admin-user-create-form>
        <h2>Thêm tài khoản quản trị</h2>
        <div class="admin-board-create-grid">
          <label><span>Tên đăng nhập</span><input data-admin-user-username maxlength="32" autocomplete="username" /></label>
          <label><span>Mật khẩu</span><input data-admin-user-password type="password" minlength="10" autocomplete="new-password" /></label>
          <label><span>Vai trò</span><select data-admin-user-role>${adminRoleOptions('viewer')}</select></label>
          <label><input data-admin-user-disabled type="checkbox" /> Tạo ở trạng thái tắt</label>
          <button class="primary-button" data-admin-user-create type="button">Tạo tài khoản</button>
        </div>
      </section>
      <div class="admin-board-table-wrap">
        <table class="admin-board-table">
          <thead>
            <tr>
              <th>Tài khoản</th>
              <th>Vai trò</th>
              <th>2FA</th>
              <th>Trạng thái</th>
              <th>Mật khẩu</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6">Chưa có tài khoản quản trị.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="muted">Owner quản lý cấu hình và tài khoản. Moderator xử lý kiểm duyệt. Viewer chỉ xem hàng đợi và nhật ký.</p>
    </div>
  `;
}

function renderAdminItems(items) {
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
    els.pendingList.innerHTML = adminBoardsHtml(items);
  } else if (state.adminTab === 'users') {
    els.pendingList.innerHTML = adminUsersHtml(items);
  } else {
    els.pendingList.innerHTML = `<div class="moderation-log">${historyActionsHtml(items)}</div>`;
  }
  if (els.adminSelectAll) {
    els.adminSelectAll.checked = false;
  }
}

function csvEscape(value = '') {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
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

function postSubmitToast(result, publishedMessage, pendingMessage) {
  const baseMessage = result.status === 'pending' ? pendingMessage : publishedMessage;
  if (result.appealToken) {
    return `${baseMessage} Mã kháng nghị: ${result.appealToken}`;
  }
  return baseMessage;
}

function syncAdminBoardFilter() {
  els.adminBoardFilter.innerHTML = `
    <option value="">Tất cả</option>
    ${state.boards.map((board) => `<option value="${board.slug}">${board.path} ${board.name}</option>`).join('')}
  `;
}

async function loadAdminDetail(globalNumber, host) {
  const detail = await api(`/api/admin/posts/${globalNumber}`);
  const container = host.querySelector('.admin-detail-host') || document.createElement('div');
  container.className = 'admin-detail-host';
  container.innerHTML = adminPostDetailHtml(detail);
  host.appendChild(container);
}

function selectedPendingIds() {
  return [...document.querySelectorAll('[data-admin-select]:checked')].map((input) => input.dataset.adminSelect);
}

async function bulkModerate(action) {
  const ids = selectedPendingIds();
  if (!ids.length) {
    showToast('Chưa chọn bài nào.');
    return;
  }
  const macroContext = action === 'approve' ? 'bulk-approve' : 'bulk-delete';
  const macroTitle = action === 'approve' ? `Lý do duyệt ${ids.length} bài:` : `Lý do xóa ${ids.length} bài:`;
  const reason = await showReasonModal(macroTitle, macroContext);
  if (reason === null) {
    return;
  }
  await api('/api/admin/pending/bulk', {
    method: 'POST',
    body: JSON.stringify({ action, ids, reason })
  });
  showToast(action === 'approve' ? 'Đã duyệt hàng loạt.' : 'Đã xóa hàng loạt.');
  await loadAdmin();
}

async function loadHome() {
  setScreen('home');
  renderBoards();
  renderHomeBoards();
  renderMyPosts();
  renderSubscribedBoards();
  const [threadsByBoard, latestPosts, watchedThreads, hotBoards, campusPulse, stats] = await Promise.all([
    loadHomeThreadsByBoard(),
    api('/api/posts/latest?limit=10'),
    loadWatchedThreadSummaries(),
    api('/api/boards/hot?limit=8'),
    api('/api/pulse?limit=12'),
    api('/api/stats')
  ]);
  renderHomeBoards(threadsByBoard, stats);
  renderPopularThreads(popularThreadsFrom(threadsByBoard));
  renderLatestPosts(latestPosts);
  state.watchedThreadSummaries = watchedThreads;
  renderWatchedThreads();
  renderMyPosts();
  renderSubscribedBoards();
  renderHotBoards(hotBoards);
  renderCampusPulse(campusPulse);
  renderStats(stats);
}

function renderPostLines(lines, options = {}) {
  const opNumber = Number(options.opNumber || 0);
  const knownBoards = new Set((state.boards || []).map((board) => board.slug));
  return lines
    .map((line) => {
      // Cross-board refs (>>>/slug/ or >>>/slug/123) first, so the >>N pass
      // below does not see the inner ">>" of a triple-arrow reference.
      let html = line.text.replace(/&gt;&gt;&gt;\/([a-z0-9-]+)\/(\d+)?/g, (match, slug, number) => {
        if (!knownBoards.has(slug)) {
          return match;
        }
        if (number) {
          return `<button class="ref-link cross-board" data-ref="${number}" type="button">&gt;&gt;&gt;/${slug}/${number}</button>`;
        }
        return `<a class="ref-link cross-board" href="#board/${slug}">&gt;&gt;&gt;/${slug}/</a>`;
      });
      html = html.replace(/&gt;&gt;(\d+)/g, (_match, number) => {
        const refNumber = Number(number);
        const isOpReference = opNumber > 0 && refNumber === opNumber;
        const isYouReference = myPostNumberSet().has(refNumber);
        const className = ['ref-link', isOpReference ? 'op-ref' : '', isYouReference ? 'you-ref' : '']
          .filter(Boolean)
          .join(' ');
        const opMark = isOpReference ? ' <span class="op-ref-marker">(OP)</span>' : '';
        const youMark = isYouReference ? ' <span class="you-ref-marker">(You)</span>' : '';
        return `<button class="${className}" data-ref="${number}" type="button">&gt;&gt;${number}${opMark}${youMark}</button>`;
      });
      html = renderInlineMarkup(html);
      html = renderSpoilerText(html);
      html = renderStickerText(html);
      return `<div class="post-line ${line.type === 'greentext' ? 'greentext' : ''}">${html || '&nbsp;'}</div>`;
    })
    .join('');
}

function selectedPostQuoteText(postElement) {
  const selection = window.getSelection?.();
  const body = postElement?.querySelector('.post-body');
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !body) {
    return '';
  }
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(body)) {
    return '';
  }
  const lines = selection
    .toString()
    .replace(/\r/g, '')
    .slice(0, 800)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return lines.map((line) => `>${line}`).join('\n');
}

// Inline text markup on already-sanitized, ref-linked HTML. Bold is matched
// before italic so the single-asterisk pass does not split `**`. The class
// names emitted by the ref/spoiler passes contain no `*`/`~`, so generated
// markup is never re-matched here.
function renderInlineMarkup(html) {
  return String(html)
    .replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^\n*]+?)\*/g, '<em>$1</em>')
    .replace(/~~([^\n~]+?)~~/g, '<del>$1</del>');
}

// Inline [spoiler]...[/spoiler] -> click-to-reveal span. Runs after ref
// linkification so refs nested inside a spoiler still work once revealed.
function renderSpoilerText(html) {
  return String(html).replace(
    /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi,
    (_match, inner) => `<span class="spoiler-text" data-spoiler tabindex="0" title="Bấm để hiện">${inner}</span>`
  );
}

function renderStickerText(html) {
  return String(html).replace(/\[sticker:([a-z0-9-]+)\]/gi, (match, key) => {
    const sticker = STICKERS[String(key).toLowerCase()];
    if (!sticker) {
      return match;
    }
    return `<span class="post-sticker" role="img" aria-label="${escapeHtml(sticker.label)}">${escapeHtml(sticker.icon)}</span>`;
  });
}

function formatPostDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${String(date.getFullYear()).slice(-2)}(${days[date.getDay()]})${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatEditedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dataUrlBytes(dataUrl = '') {
  const base64 = String(dataUrl).split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function imageSizeBytes(image = {}) {
  const sizeBytes = Number(image.sizeBytes);
  if (Number.isFinite(sizeBytes) && sizeBytes > 0) {
    return Math.round(sizeBytes);
  }
  return dataUrlBytes(image.dataUrl);
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${bytes} B`;
}

function imageInfoText(image = {}) {
  const size = formatBytes(imageSizeBytes(image));
  const width = Number(image.width);
  const height = Number(image.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return `${size}, ${Math.round(width)}x${Math.round(height)}`;
  }
  return size;
}

function mediaItemsFromPost(post = {}) {
  return mediaList(post.images?.length ? post.images : post.image);
}

function postMediaCount(post = {}) {
  return mediaItemsFromPost(post).length;
}

function mediaOriginalSrc(image = {}) {
  const value = image || {};
  return value.url || value.dataUrl || '';
}

function mediaThumbnailSrc(image = {}, options = {}) {
  const value = image || {};
  const src = value.thumbnail?.url || value.thumbnail?.dataUrl || '';
  return src || (options.fallbackOriginal ? mediaOriginalSrc(value) : '');
}

function fileTextHtml(image) {
  const name = escapeHtml(image?.name || 'tai-len');
  const src = escapeHtml(mediaOriginalSrc(image));
  const info = escapeHtml(imageInfoText(image));
  return `Tệp: <a href="${src}" target="_blank" rel="noopener">${name}</a> (${info})`;
}

function mediaToggleHtml(image, className = 'post-image') {
  const name = escapeHtml(image?.name || 'tai-len');
  const thumbnailSrc = mediaThumbnailSrc(image);
  const originalSrc = escapeHtml(mediaOriginalSrc(image));
  const spoiler = Boolean(image?.spoiler);
  const isVideo = mediaKind(image) === 'video';
  const mediaLabel = isVideo ? 'video' : 'ảnh';
  const preview = thumbnailSrc
    ? `<img class="${className}" src="${escapeHtml(thumbnailSrc)}" alt="${name}" data-full-src="${originalSrc}">`
    : `<span class="${className} placeholder image-lazy-placeholder" data-full-src="${originalSrc}">${isVideo ? 'Video' : 'Có tệp'}</span>`;
  const spoilerLabel = spoiler ? '<span class="spoiler-image-label">Spoiler — bấm để hiện</span>' : '';
  const toggleAttributes = `class="image-toggle" data-image-toggle${spoiler ? ' data-spoiler-image' : ''} data-media-type="${
    isVideo ? 'video' : 'image'
  }" data-full-src="${originalSrc}" data-image-name="${name}" data-image-class="${className}" aria-expanded="false" aria-label="Phóng to ${mediaLabel} ${name}"`;
  const toggleOpen = isVideo ? `<div ${toggleAttributes} role="button" tabindex="0">` : `<button ${toggleAttributes} type="button">`;
  const toggleClose = isVideo ? '</div>' : '</button>';
  return `
    <div class="thread-thumb-wrap${spoiler ? ' spoiler-image' : ''}">
      <div class="file-text">${fileTextHtml(image)}</div>
      ${toggleOpen}
        ${preview}
        ${spoilerLabel}
      ${toggleClose}
    </div>
  `;
}

function imageHtml(post) {
  const images = mediaItemsFromPost(post);
  if (!images.length) {
    return '';
  }
  return `<div class="post-media-gallery">${images.map((image) => mediaToggleHtml(image)).join('')}</div>`;
}

function posterId(post) {
  const value = post.posterHash || '????';
  return value.startsWith('ID:') ? value : `ID:${value}`;
}

function postDisplayName(post) {
  return String(post.displayName || 'Anonymous').trim() || 'Anonymous';
}

function postPermalink(post, options = {}) {
  const threadId = options.threadId || post.threadId || post.id || state.threadId;
  if (!threadId || !post.globalNumber) {
    return '#';
  }
  return `#thread/${encodeURIComponent(threadId)}?p=${encodeURIComponent(post.globalNumber)}`;
}

function absolutePostPermalink(permalink) {
  if (!permalink || permalink === '#') {
    return window.location.href;
  }
  return `${window.location.origin}${window.location.pathname}${permalink}`;
}

async function copyPostPermalink(permalink) {
  const absolutePermalink = absolutePostPermalink(permalink);
  try {
    await navigator.clipboard.writeText(absolutePermalink);
    showToast('Đã sao chép link bài viết.');
  } catch {
    showToast(absolutePermalink);
  }
}

function readVote(globalNumber) {
  try {
    return localStorage.getItem(`vote:${globalNumber}`) || '';
  } catch {
    return '';
  }
}

function writeVote(globalNumber, direction) {
  try {
    if (direction) {
      localStorage.setItem(`vote:${globalNumber}`, direction);
    } else {
      localStorage.removeItem(`vote:${globalNumber}`);
    }
  } catch {
    /* ignore storage errors */
  }
}

const REACTION_LABELS = [
  ['like', 'Thích', '+'],
  ['laugh', 'Cười', 'ha'],
  ['surprise', 'Ngạc nhiên', '!'],
  ['sad', 'Buồn', ':('],
  ['angry', 'Giận', '>'],
  ['thanks', 'Cảm ơn', 'ty']
];

function reactionControlHtml(post) {
  const reactions = post.reactions || {};
  return `
    <span class="post-reactions" aria-label="Cảm xúc bài viết">
      ${REACTION_LABELS.map(([type, label, shortLabel]) => {
        const count = Math.max(0, Number(reactions[type]) || 0);
        return `<button class="reaction-button" data-reaction="${type}" data-reaction-target="${post.globalNumber}" type="button" title="${label}" aria-label="${label}">${shortLabel}${count ? ` ${count}` : ''}</button>`;
      }).join('')}
    </span>
  `;
}

function voteControlHtml(post) {
  const votes = post.votes || { up: 0, down: 0, score: 0 };
  const score = Number(votes.score ?? (Number(votes.up || 0) - Number(votes.down || 0)));
  const myVote = readVote(post.globalNumber);
  return `
    <span class="post-votes">
      <button class="vote-button vote-up${myVote === 'up' ? ' active' : ''}" data-vote="up" data-vote-target="${post.globalNumber}" type="button" title="Upvote" aria-label="Upvote">▲</button>
      <span class="vote-score" title="Điểm">${score}</span>
      <button class="vote-button vote-down${myVote === 'down' ? ' active' : ''}" data-vote="down" data-vote-target="${post.globalNumber}" type="button" title="Downvote" aria-label="Downvote">▼</button>
    </span>
  `;
}

const COMMENT_SORT_LABELS = [
  ['best', 'tốt nhất'],
  ['top', 'nhiều điểm'],
  ['new', 'mới nhất'],
  ['controversial', 'gây tranh cãi'],
  ['old', 'cũ nhất']
];

function commentSortHtml(current = 'old') {
  const options = COMMENT_SORT_LABELS.map(
    ([value, label]) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`
  ).join('');
  return `
    <div class="comment-sort">
      <label>sắp xếp theo: <select data-comment-sort aria-label="Sắp xếp bình luận">${options}</select></label>
    </div>
  `;
}

function normalizeThreadSearchTerm(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function threadSearchHtml(detail = {}) {
  const term = state.threadSearchTerm;
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

const CAPCODE_LABELS = {
  admin: '## Quản trị viên',
  moderator: '## Điều hành viên'
};

function capcodeBadgeHtml(post) {
  const label = CAPCODE_LABELS[post?.capcode];
  if (!label) {
    return '';
  }
  return `<span class="capcode capcode-${post.capcode}" title="Chức danh đã xác minh">${label}</span>`;
}

function adminPostEditButtonHtml(post, { className = 'quote-button' } = {}) {
  if (!post?.globalNumber) {
    return '';
  }
  const encodedBody = encodeURIComponent(post.body || '');
  return `<button class="${className}" data-admin-edit-post="${post.globalNumber}" data-admin-edit-body="${escapeHtml(encodedBody)}" type="button">[Sửa]</button>`;
}

function adminPostRestoreButtonHtml(post, { className = 'ghost-button' } = {}) {
  if (!post?.globalNumber) {
    return '';
  }
  return `<button class="${className}" data-admin-restore-post="${post.globalNumber}" type="button">[Khôi phục]</button>`;
}

function accountPostEditButtonHtml(post, { className = 'quote-button' } = {}) {
  if (!isAccountPost(post) || !post?.globalNumber) {
    return '';
  }
  const encodedBody = encodeURIComponent(post.body || '');
  return `<button class="${className}" data-account-edit-post="${post.globalNumber}" data-account-edit-body="${escapeHtml(encodedBody)}" type="button">[Sửa bài]</button>`;
}

function anonymousPostActionsHtml(post, { className = 'quote-button' } = {}) {
  if (!isAnonymousMyPost(post) || !post?.globalNumber || post.isDeleted) {
    return '';
  }
  const encodedBody = encodeURIComponent(post.body || '');
  const deleteFileAction = postMediaCount(post)
    ? `<button class="${className}" data-self-delete-file-post="${post.globalNumber}" type="button">[Xóa tệp]</button>`
    : '';
  return `
    <button class="${className}" data-self-edit-post="${post.globalNumber}" data-self-edit-body="${escapeHtml(encodedBody)}" type="button">[Sửa]</button>
    <button class="${className}" data-self-delete-post="${post.globalNumber}" type="button">[Xóa]</button>
    ${deleteFileAction}
  `;
}

function meta(post, options = {}) {
  const labels = post.moderationLabels?.length
    ? `AI:${post.moderationLabels.map(moderationLabelText).join(',')}`
    : moderationStatusText(post.moderationStatus);
  const showCheckbox = options.checkbox !== false;
  const showReplyAction = options.replyAction !== false;
  const canReply = options.canReply !== false;
  const showPostActions = options.actions !== false;
  const accountEditAction = showPostActions ? accountPostEditButtonHtml(post) : '';
  const anonymousActions = showPostActions ? anonymousPostActionsHtml(post) : '';
  const permalink = postPermalink(post, options);
  const opNumber = Number(options.opNumber || 0);
  const isOpReply =
    opNumber > 0 &&
    Number(post.globalNumber) !== opNumber &&
    (post.isOp || (options.opPosterHash && post.posterHash === options.opPosterHash));
  const opMarker = isOpReply ? '<span class="op-post-marker">(OP)</span>' : '';
  const youMarker = isMyPost(post) ? '<span class="you-marker" title="Bài của bạn">(You)</span>' : '';
  const sageMarker = post.sage ? '<span class="sage-marker" title="Bài trả lời này không bump thread">sage</span>' : '';
  const lastEdited = post.editedAt ? `<span class="last-edited" title="Sửa lần cuối">Đã sửa ${formatEditedDate(post.editedAt)}</span>` : '';
  const posterNote = posterNoteForPost(post);
  const posterNoteBadge = posterNote
    ? '<span class="poster-note-badge" title="' +
      escapeHtml(posterNote.note || posterNote.label) +
      '">Ghi chú: ' +
      escapeHtml(posterNote.label || posterNote.note) +
      '</span>'
    : '';
  const posterIdentity = canReply
    ? `<button class="post-id-button hash" data-quick-reply="${post.globalNumber}" title="Trả lời bài này" type="button">${escapeHtml(posterId(post))}</button>`
    : `<span class="hash">${escapeHtml(posterId(post))}</span>`;
  return `
    <div class="post-meta">
      ${showCheckbox ? `<label class="post-check"><input type="checkbox" aria-label="Chọn bài ${post.globalNumber}"></label>` : ''}
      <span class="name">${escapeHtml(postDisplayName(post))}</span>${post.tripcode ? `<span class="tripcode" title="Tripcode">${escapeHtml(post.tripcode)}</span>` : ''}${capcodeBadgeHtml(post)}
      <span class="date">${formatPostDate(post.createdAt)}</span>
      <span class="post-number"><span class="post-number-prefix">No.</span><a class="number post-number-link" href="${permalink}" title="Liên kết tới bài này">${post.globalNumber}</a></span>
      ${posterIdentity}
      ${opMarker}
      ${youMarker}
      ${sageMarker}
      ${lastEdited}
      ${posterNoteBadge}
      ${stickyLabelHtml(post)}
      <span class="status">${labels}</span>
      ${voteControlHtml(post)}
      ${reactionControlHtml(post)}
      ${
        showReplyAction && canReply
          ? `<button class="quote-button" data-quote="&gt;&gt;${post.globalNumber}" type="button">[Trả lời]</button>`
          : ''
      }
      ${showPostActions ? `<button class="quote-button" data-copy-post-link="${escapeHtml(permalink)}" type="button">[Link]</button>` : ''}
      ${showPostActions ? `<button class="quote-button" data-collapse-post="${post.globalNumber}" type="button" aria-expanded="true">[Thu]</button>` : ''}
      ${anonymousActions}
      ${accountEditAction}
      <button class="quote-button" data-report="${post.globalNumber}" type="button">[Báo cáo]</button>
      <button class="quote-button" data-hide-post="${post.globalNumber}" type="button">[Ẩn]</button>
      <button class="quote-button" data-translate-post="${post.globalNumber}" type="button">[Dịch]</button>
      <button class="quote-button" data-tts-post="${post.globalNumber}" type="button">[Nghe]</button>
    </div>
  `;
}

function backlinksHtml(backlinks = []) {
  if (!backlinks.length) {
    return '';
  }
  return `
    <div class="backlinks">
      ${backlinks
        .map((number) => `<button class="ref-link" data-ref="${number}" type="button">&gt;&gt;${number}</button>`)
        .join(' ')}
    </div>
  `;
}

function diceRollsHtml(diceRolls = []) {
  if (!Array.isArray(diceRolls) || diceRolls.length === 0) {
    return '';
  }
  return `
    <div class="dice-rolls" aria-label="Kết quả gieo xúc xắc">
      ${diceRolls
        .map((roll) => {
          const rolls = Array.isArray(roll.rolls) ? roll.rolls.map((value) => Number(value)).filter(Number.isFinite) : [];
          const modifier = Number(roll.modifier) || 0;
          const modifierText = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : '';
          return `
            <span class="dice-roll">
              <span class="dice-expression">${escapeHtml(roll.expression || '')}</span>
              <span class="dice-values">[${escapeHtml(rolls.join(', '))}${escapeHtml(modifierText)}]</span>
              <strong>${escapeHtml(roll.total ?? '')}</strong>
            </span>
          `;
        })
        .join('')}
    </div>
  `;
}

function postHtml(post, type = 'post', options = {}) {
  const classes = String(type)
    .split(/\s+/)
    .filter(Boolean);
  if (!classes.includes('post')) {
    classes.unshift('post');
  }

  return `
    <article class="${classes.join(' ')}" id="p${post.globalNumber}">
      ${imageHtml(post)}
      ${meta(post, options)}
      ${classes.includes('op') ? threadSubjectHtml(post) : ''}
      <div class="post-body">${renderPostLines(post.bodyLines || [], options)}</div>
      ${diceRollsHtml(post.diceRolls)}
      ${backlinksHtml(post.backlinks)}
      ${classes.includes('op') ? pollHtml(post.poll, options.canReply !== false) : ''}
    </article>
  `;
}

function threadMediaGalleryItems(detail = {}) {
  return [detail.thread, ...(detail.comments || [])]
    .filter(Boolean)
    .flatMap((post) =>
      mediaItemsFromPost(post).map((image, index) => ({
        image,
        index,
        post
      }))
    );
}

function threadMediaGalleryHtml(detail) {
  const items = threadMediaGalleryItems(detail);
  if (!items.length) {
    return '';
  }

  return `
    <nav class="thread-media-index" aria-label="Media trong thread">
      <div class="thread-media-index-title">Media trong thread (${items.length})</div>
      <div class="thread-media-index-list">
        ${items
          .map(({ image, index, post }) => {
            const thumbnailSrc = mediaThumbnailSrc(image, { fallbackOriginal: mediaKind(image) !== 'video' });
            const href = postPermalink(post, { threadId: detail.thread.id });
            const postNumber = escapeHtml(post.globalNumber);
            const name = escapeHtml(image?.name || 'tai-len');
            const kind = mediaKind(image) === 'video' ? 'Video' : 'Ảnh';
            const preview = thumbnailSrc
              ? `<img src="${escapeHtml(thumbnailSrc)}" alt="${kind} ${name} trong bài số ${postNumber}">`
              : `<span>${escapeHtml(kind)}</span>`;
            return `
              <a class="thread-media-index-item" href="${escapeHtml(href)}" data-thread-media-jump="${postNumber}" title="${name}">
                ${preview}
                <span>No.${postNumber}${index > 0 ? `.${index + 1}` : ''}</span>
              </a>
            `;
          })
          .join('')}
      </div>
    </nav>
  `;
}

function threadFeedLinksHtml(detail) {
  if (!detail.thread?.id) {
    return '';
  }
  const threadId = encodeURIComponent(detail.thread.id);
  return `
      [<a data-thread-json-feed href="/feeds/threads/${threadId}/posts.json" target="_blank" rel="noopener noreferrer">JSON</a>]
      [<a data-thread-rss-feed href="/feeds/threads/${threadId}/posts.rss" target="_blank" rel="noopener noreferrer">RSS</a>]`;
}

function threadNavigationLinksHtml(detail) {
  const navigation = detail.threadNavigation || {};
  const links = [];
  if (navigation.previous?.id) {
    const label = navigation.previous.globalNumber ? `Trước No.${navigation.previous.globalNumber}` : 'Trước';
    links.push(
      `[<a data-thread-nav="previous" href="#thread/${encodeURIComponent(navigation.previous.id)}">${escapeHtml(label)}</a>]`
    );
  }
  if (navigation.next?.id) {
    const label = navigation.next.globalNumber ? `Sau No.${navigation.next.globalNumber}` : 'Sau';
    links.push(`[<a data-thread-nav="next" href="#thread/${encodeURIComponent(navigation.next.id)}">${escapeHtml(label)}</a>]`);
  }
  return links.join('\n      ');
}

function threadToolbarHtml(detail, position) {
  const posts = [detail.thread, ...detail.comments];
  const fileCount = posts.reduce((total, post) => total + postMediaCount(post), 0);
  const commentMeta = detail.commentPage;
  const canReply = !detail.thread.isArchived && !detail.thread.isLocked;
  const replyLink =
    position === 'bottom' && canReply
      ? '<button class="link-button toolbar-reply-link" data-open-reply type="button">Đăng trả lời</button>'
      : '<span></span>';
  const checked = state.autoUpdate ? 'checked' : '';
  const archivedLabel = detail.thread.isArchived ? '<span class="archived-label">Đã lưu trữ</span>' : '';
  const lockedLabel = detail.thread.isLocked ? '<span class="locked-label">🔒 Đã khóa</span>' : '';
  const watchLabel = isThreadWatched(detail.thread.id) ? 'Bỏ theo dõi' : 'Theo dõi';
  const slowModeLabel = detail.thread.slowModeUntil
    ? `<span class="archived-label">Chế độ chậm ${Number(detail.thread.slowModeSeconds || 0)}s</span>`
    : '';

  return `
    <div class="toolbar-links">
      [<a href="#board/${state.boardSlug}">Quay lại</a>]
      [<a href="#catalog/${state.boardSlug}">Danh mục</a>]
      ${threadNavigationLinksHtml(detail)}
      ${threadFeedLinksHtml(detail)}
      [<button class="link-button" data-toggle-watch type="button">${watchLabel}</button>]
      [<button class="link-button" data-scroll-page-top type="button">Lên đầu</button>]
      [<button class="link-button" data-thread-refresh type="button">Cập nhật</button>]
      [<button class="link-button" data-thread-collapse-posts type="button">Thu bài</button>]
      [<label title="Tự lấy phản hồi mới"><input type="checkbox" data-auto-update ${checked}> Tự động</label>]
      <span class="auto-countdown">${state.autoUpdate ? state.autoCountdown : ''}</span>
      ${archivedLabel}
      ${lockedLabel}
      ${slowModeLabel}
    </div>
    ${replyLink}
    <div class="toolbar-counts">${posts.length} / ${commentMeta?.total ?? detail.comments.length} / ${fileCount}</div>
    ${commentMeta ? `<div class="toolbar-pages">${pageControlsHtml(commentMeta, 'thread-comments')}</div>` : ''}
  `;
}

function moderationLabelText(label) {
  return (
    {
      Toxic: 'Độc hại',
      Spam: 'Nội dung rác',
      'Hate Speech': 'Thù ghét',
      'Fake News': 'Tin giả',
      'PII Risk': 'Rủi ro thông tin cá nhân'
    }[label] || label
  );
}

function moderationStatusText(status) {
  return (
    {
      Safe: 'An toàn',
      Flagged: 'Bị gắn cờ',
      ApprovedByAdmin: 'Quản trị viên đã duyệt'
    }[status] || status
  );
}

function syncAutoUpdateControls() {
  document.querySelectorAll('[data-auto-update]').forEach((checkbox) => {
    checkbox.checked = state.autoUpdate;
  });
  document.querySelectorAll('.auto-countdown').forEach((counter) => {
    counter.textContent = state.autoUpdate ? String(state.autoCountdown) : '';
  });
}

function stopAutoUpdateTimer() {
  if (state.autoTimer) {
    window.clearInterval(state.autoTimer);
    state.autoTimer = null;
  }
}

function audioWorkInProgress() {
  return (
    state.audioTranscribing.size > 0 ||
    Object.values(state.audioRecorders).some((item) => item?.recorder?.state === 'recording')
  );
}

function postponeAutoUpdateForAudio() {
  state.autoCountdown = 7;
  syncAutoUpdateControls();
}

function resetAutoUpdateTimer() {
  stopAutoUpdateTimer();
  state.autoCountdown = 7;
  syncAutoUpdateControls();
  if (!state.autoUpdate || !(window.location.hash || '').startsWith('#thread/')) {
    return;
  }
  state.autoTimer = window.setInterval(() => {
    if (!(window.location.hash || '').startsWith('#thread/')) {
      stopAutoUpdateTimer();
      return;
    }
    if (audioWorkInProgress()) {
      postponeAutoUpdateForAudio();
      return;
    }
    state.autoCountdown -= 1;
    if (state.autoCountdown <= 0) {
      state.autoCountdown = 7;
      syncAutoUpdateControls();
      loadThread().catch((error) => showToast(error.message));
      return;
    }
    syncAutoUpdateControls();
  }, 1000);
}

function setAutoUpdate(enabled) {
  state.autoUpdate = enabled;
  resetAutoUpdateTimer();
}

function currentPermalinkPost() {
  return new URLSearchParams((window.location.hash || '').split('?')[1] || '').get('p') || '';
}

function maxThreadPostNumber(detail) {
  return [detail.thread, ...(detail.comments || [])].reduce(
    (maxNumber, post) => Math.max(maxNumber, Number(post.globalNumber) || 0),
    0
  );
}

function stickyLabelHtml(thread) {
  return thread?.isSticky ? '<span class="sticky-label">Đã ghim</span>' : '';
}

function adminStickyButtonHtml(thread) {
  if (!thread?.id || thread.isArchived) {
    return '';
  }
  const nextSticky = !thread.isSticky;
  const label = nextSticky ? 'Ghim' : 'Gỡ ghim';
  return `<button class="ghost-button" data-admin-sticky-thread="${escapeHtml(thread.id)}" data-sticky-next="${nextSticky}" type="button">[${label}]</button>`;
}

function adminLockButtonHtml(thread) {
  if (!thread?.id || thread.isArchived) {
    return '';
  }
  const nextLocked = !thread.isLocked;
  const label = nextLocked ? 'Khóa' : 'Mở khóa';
  return `<button class="ghost-button" data-admin-lock-thread="${escapeHtml(thread.id)}" data-lock-next="${nextLocked}" type="button">[${label}]</button>`;
}

function canModerateFromAdminToken() {
  const payload = decodeJwtPayload(state.token);
  return Boolean(payload && ['admin', 'owner', 'moderator'].includes(payload.role));
}

function threadHeaderActionsHtml(detail = {}) {
  if (!canModerateFromAdminToken()) {
    return '';
  }
  const actions = [adminStickyButtonHtml(detail.thread), adminLockButtonHtml(detail.thread)].filter(Boolean);
  if (!actions.length) {
    return '';
  }
  return `<div class="thread-admin-action-group">${actions.join(' ')}</div>`;
}

function focusPermalinkPost(globalNumber, { scroll = false } = {}) {
  const postNumber = String(globalNumber || '').trim();
  if (!postNumber) {
    return;
  }

  const target = document.getElementById(`p${postNumber}`);
  if (!target) {
    return;
  }

  document.querySelectorAll('.permalink-target').forEach((post) => {
    post.classList.remove('permalink-target');
  });
  target.classList.add('permalink-target');
  if (scroll) {
    window.setTimeout(() => {
      target.scrollIntoView({ block: 'center' });
    }, 0);
  }
}

function threadMatchesSearch(thread, term) {
  const normalizedTerm = normalizeSearchValue(term);
  if (!normalizedTerm) {
    return true;
  }
  const haystack = normalizeSearchValue(
    `${boardHeading(state.boards.find((board) => board.slug === thread.boardSlug))} ${threadSubject(thread)} ${plainPreview(
      thread.bodyLines,
      ''
    )} No.${thread.globalNumber}`
  );
  return haystack.includes(normalizedTerm);
}

function catalogThreadFileCount(thread = {}) {
  const previewFileCount = (Array.isArray(thread.previewComments) ? thread.previewComments : []).reduce(
    (total, comment) => total + postMediaCount(comment),
    0
  );
  return postMediaCount(thread) + previewFileCount + Number(thread.omittedImageCount || 0);
}

function catalogThreadMediaItems(thread = {}) {
  const previewMedia = (Array.isArray(thread.previewComments) ? thread.previewComments : []).flatMap((comment) =>
    mediaItemsFromPost(comment)
  );
  return [...mediaItemsFromPost(thread), ...previewMedia];
}

function catalogThreadHasVideo(thread = {}) {
  return catalogThreadMediaItems(thread).some((media) => mediaKind(media) === 'video');
}

function catalogThreadHtml(thread) {
  const title = threadTitle(thread, 'Chưa có nội dung').slice(0, 260);
  const bodyPreview = plainPreview(thread.bodyLines, '').slice(0, 260);
  const stickyPrefix = thread.isSticky ? '[Ghim] ' : '';
  const images = mediaItemsFromPost(thread);
  const fileCount = catalogThreadFileCount(thread);
  const firstMedia = images[0];
  const thumbnailSrc = mediaThumbnailSrc(firstMedia);
  const spoiler = Boolean(firstMedia?.spoiler);
  const image = firstMedia && thumbnailSrc
    ? `<img src="${escapeHtml(thumbnailSrc)}" alt="${escapeHtml(firstMedia.name)}">`
    : firstMedia
      ? `<span class="catalog-placeholder">${mediaKind(firstMedia) === 'video' ? 'Video' : 'Có tệp'}</span>`
      : '<span class="catalog-placeholder">Không có tệp</span>';

  return `
    <a class="catalog-thread" href="#thread/${thread.id}">
      <span class="catalog-thumb${spoiler ? ' spoiler-summary-thumb' : ''}">${image}${spoiler ? spoilerSummaryLabelHtml() : ''}</span>
      <strong>${escapeHtml(`${stickyPrefix}${title.slice(0, 70)}`)}${title.length >= 70 ? '...' : ''}</strong>
      <span class="catalog-thread-stats">R: ${thread.replyCount} / I: ${fileCount} / No.${thread.globalNumber}</span>
      <p>${escapeHtml(bodyPreview || title)}${bodyPreview.length >= 260 ? '...' : ''}</p>
    </a>
  `;
}

function timestamp(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function hoursSince(value) {
  const time = timestamp(value);
  if (!time) {
    return 0;
  }
  return Math.max(0, (Date.now() - time) / (60 * 60 * 1000));
}

function catalogRecommendationScore(thread) {
  const activityAgeHours = hoursSince(thread.bumpedAt || thread.createdAt);
  const replyCount = Number(thread.replyCount || 0);
  const mediaCount = catalogThreadFileCount(thread);
  const voteScore = Number(thread.votes?.score || 0);
  const recencyScore = Math.exp(-activityAgeHours / 18) * 40;
  const replyScore = Math.log1p(replyCount) * 8;
  const mediaScore = Math.min(mediaCount, 4) * 2;
  const positiveVoteScore = Math.max(0, voteScore) * 3;
  const negativeVotePenalty = Math.max(0, -voteScore) * 4;
  const stickyScore = thread.isSticky ? 8 : 0;
  return recencyScore + replyScore + mediaScore + positiveVoteScore + stickyScore - negativeVotePenalty;
}

function normalizeCatalogSort(value) {
  const sort = String(value || '').trim().toLowerCase();
  return ['recommended', 'bump', 'latest-reply', 'created', 'replies', 'files'].includes(sort) ? sort : 'bump';
}

function sortedCatalogThreads(threads) {
  const copy = [...threads];
  const sort = normalizeCatalogSort(state.catalogSort);
  if (sort === 'recommended') {
    return copy.sort((left, right) => {
      const scoreCompare = catalogRecommendationScore(right) - catalogRecommendationScore(left);
      if (scoreCompare !== 0) return scoreCompare;
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      return stickyCompare || right.bumpedAt.localeCompare(left.bumpedAt);
    });
  }
  if (sort === 'created') {
    return copy.sort((left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      return stickyCompare || right.createdAt.localeCompare(left.createdAt);
    });
  }
  if (sort === 'replies') {
    return copy.sort((left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      return stickyCompare || Number(right.replyCount || 0) - Number(left.replyCount || 0);
    });
  }
  if (sort === 'files') {
    return copy.sort((left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      const fileCompare = catalogThreadFileCount(right) - catalogThreadFileCount(left);
      return stickyCompare || fileCompare || right.bumpedAt.localeCompare(left.bumpedAt);
    });
  }
  if (sort === 'latest-reply') {
    return copy.sort((left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      return stickyCompare || right.bumpedAt.localeCompare(left.bumpedAt);
    });
  }
  return copy.sort((left, right) => {
    const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
    return stickyCompare || right.bumpedAt.localeCompare(left.bumpedAt);
  });
}

function catalogThreadMatchesFilter(thread) {
  if (state.catalogFilter === 'image') {
    return catalogThreadFileCount(thread) > 0;
  }
  if (state.catalogFilter === 'video') {
    return catalogThreadHasVideo(thread);
  }
  if (state.catalogFilter === 'poll') {
    return Boolean(thread.poll?.options?.length);
  }
  if (state.catalogFilter === 'unread') {
    return readThreadLastSeen(thread.id) === 0;
  }
  return true;
}

function renderCatalogThreads(threads) {
  const term = els.catalogSearchInput.value.trim();
  const visibleThreads = sortedCatalogThreads(
    threads.filter((thread) => !isPostFiltered(thread) && catalogThreadMatchesFilter(thread) && threadMatchesSearch(thread, term))
  );
  els.catalogGrid.classList.toggle('catalog-grid-large', state.catalogImageSize === 'large');
  document.querySelectorAll('[data-catalog-sort]').forEach((button) => {
    const active = button.dataset.catalogSort === normalizeCatalogSort(state.catalogSort);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-catalog-filter]').forEach((button) => {
    const active = button.dataset.catalogFilter === state.catalogFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-catalog-size]').forEach((button) => {
    const active = button.dataset.catalogSize === state.catalogImageSize;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (!visibleThreads.length) {
    els.catalogGrid.innerHTML = '<p class="muted">Không có OP khớp tìm kiếm.</p>';
    return;
  }

  els.catalogGrid.innerHTML = visibleThreads.map(catalogThreadHtml).join('');
}

async function loadCatalog() {
  const board = currentBoard();
  if (!board) {
    return;
  }
  setScreen('catalog');
  renderBoards();
  els.catalogTitle.textContent = `${board.path} - ${board.name} Danh mục`;
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

function archiveThreadHtml(thread) {
  const title = plainPreview(thread.bodyLines, 'Chưa có nội dung').slice(0, 180);
  const archivedAt = thread.archivedAt ? new Date(thread.archivedAt).toLocaleString('vi-VN') : 'không rõ';
  return `
    <a class="archive-row" href="#thread/${thread.id}">
      <span class="archive-no">No.${thread.globalNumber}</span>
      <span class="archive-title">${escapeHtml(title)}${title.length >= 180 ? '...' : ''}</span>
      <span class="archive-meta">${thread.replyCount} trả lời · lưu lúc ${escapeHtml(archivedAt)}</span>
    </a>
  `;
}

function renderArchiveThreads(threads) {
  if (!threads.length) {
    els.archiveList.innerHTML = '<p class="muted">Kho lưu trữ chưa có chủ đề.</p>';
    return;
  }
  els.archiveList.innerHTML = threads.map(archiveThreadHtml).join('');
}

async function loadArchive() {
  const board = state.boards.find((item) => item.slug === state.boardSlug);
  setScreen('archive');
  renderBoards();
  if (!board) {
    els.archiveTitle.textContent = 'Không tìm thấy bảng';
    els.archiveDescription.textContent = `Bảng /${state.boardSlug}/ không tồn tại.`;
    els.archiveReturnTop.href = '#home';
    els.archiveReturnBottom.href = '#home';
    els.archiveList.innerHTML = '<p class="muted">Không có kho lưu trữ để hiển thị.</p>';
    return;
  }
  updateBoardPresentation(board);
  els.archiveTitle.textContent = `${board.path} - ${board.name} Kho lưu trữ`;
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

function omittedRepliesHtml(thread) {
  const replyCount = Number(thread.omittedReplyCount || 0);
  const imageCount = Number(thread.omittedImageCount || 0);
  if (replyCount <= 0 && imageCount <= 0) return "";
  const replyText = replyCount > 0 ? `${replyCount} phản hồi` : '';
  const imageText = imageCount > 0 ? `${imageCount} tệp` : '';
  return `<div class="omitted-replies">Bỏ qua ${[replyText, imageText].filter(Boolean).join(' và ')}.</div>`;
}

function boardReplyPreviewsHtml(thread) {
  const comments = (Array.isArray(thread.previewComments) ? thread.previewComments : []).filter(
    (comment) => !isPostFiltered(comment)
  );
  if (!comments.length && !thread.omittedReplyCount && !thread.omittedImageCount) return "";
  return `
    <div class="board-reply-previews">
      ${omittedRepliesHtml(thread)}
      ${comments.map((comment) => `
        <article class="reply-preview" id="p${comment.globalNumber}">
          ${meta(comment, { replyAction: false })}
          <div class="post-body">${renderPostLines(comment.bodyLines || [], { opNumber: thread.globalNumber })}</div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderBoardThreads(threads) {
  const term = els.boardSearchInput.value.trim();
  document.querySelectorAll('[data-board-sort]').forEach((button) => {
    const active = button.dataset.boardSort === state.boardSort;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-board-filter]').forEach((button) => {
    const active = button.dataset.boardFilter === state.boardFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const hidden = hiddenThreadIds();
  const visibleThreads = threads.filter(
    (thread) => !hidden.has(String(thread.id)) && !isPostFiltered(thread) && threadMatchesSearch(thread, term)
  );
  if (!visibleThreads.length) {
    els.threadList.innerHTML = term
      ? '<p class="muted">Không có OP khớp tìm kiếm.</p>'
      : '<p class="muted">Chưa có chủ đề công khai.</p>';
    els.boardPagination.innerHTML = pageControlsHtml(state.boardPageMeta, 'board');
    return;
  }

  els.threadList.innerHTML = visibleThreads
    .map((thread) => {
      return `
        <div class="thread ${thread.isSticky ? 'thread-sticky' : ''}" id="p${thread.globalNumber}">
          <div class="thread-op">
          ${
            mediaItemsFromPost(thread).length
              ? `<div class="post-media-gallery">${mediaItemsFromPost(thread).map((image) => mediaToggleHtml(image, 'thumb')).join('')}</div>`
              : '<div class="thread-thumb-wrap"><div class="thumb placeholder">Không có tệp</div></div>'
          }
            ${meta(thread, { replyAction: false })}
            <a class="thread-open" href="#thread/${thread.id}">[Trả lời]</a>
            ${threadSubjectHtml(thread)}
            <div class="post-body">${renderPostLines(thread.bodyLines || [], { opNumber: thread.globalNumber })}</div>
            ${diceRollsHtml(thread.diceRolls)}
            ${boardReplyPreviewsHtml(thread)}
            <div class="thread-meta">
              <span>${thread.replyCount} trả lời</span>
              <span>đẩy lúc ${new Date(thread.bumpedAt).toLocaleTimeString()}</span>
              <a href="#thread/${thread.id}">Xem chủ đề</a>
              <button class="link-button" data-hide-thread="${escapeHtml(thread.id)}" type="button">[Ẩn]</button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
  els.boardPagination.innerHTML = pageControlsHtml(state.boardPageMeta, 'board');
}

async function loadBoard() {
  const board = currentBoard();
  if (!board) {
    return;
  }
  setScreen('board');
  renderBoards();
  syncBoardSubscriptionButtons();
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

async function loadThread({ resetReply = false, focusPost = '' } = {}) {
  setScreen('thread');
  els.threadSummary.classList.add('hidden');
  const query = new URLSearchParams({
    commentsPage: String(state.threadCommentPage),
    commentsPageSize: String(state.threadCommentPageSize),
    commentsSort: state.commentsSort
  });
  const threadSearchTerm = normalizeThreadSearchTerm(state.threadSearchTerm);
  state.threadSearchTerm = threadSearchTerm;
  if (threadSearchTerm) {
    query.set('commentsSearch', threadSearchTerm);
  }
  const requestedPost = focusPost || currentPermalinkPost();
  if (requestedPost) {
    query.set('focusGlobalNumber', requestedPost);
  }
  const requestedThreadId = state.threadId;
  const requestId = ++state.threadLoadRequestId;
  const detail = await api(`/api/threads/${requestedThreadId}?${query.toString()}`);
  if (requestId !== state.threadLoadRequestId || state.threadId !== requestedThreadId) {
    return;
  }
  state.threadDetail = detail;
  const previousLastSeen = readThreadLastSeen(state.threadId);
  const currentMaxNumber = detail.commentPage?.currentMaxGlobalNumber || maxThreadPostNumber(detail);
  state.threadLastSeenBefore = previousLastSeen;
  state.threadCurrentMaxNumber = currentMaxNumber;
  state.threadCommentPageMeta = detail.commentPage || null;
  state.threadCommentPage = detail.commentPage?.page || state.threadCommentPage;
  state.threadSearchTerm = state.threadSearchTerm || detail.commentPage?.search || detail.commentsSearch || '';
  state.commentsSort = detail.commentPage?.sort || detail.commentsSort || state.commentsSort;
  writeThreadLastSeen(state.threadId, currentMaxNumber);
  syncWatchedThreadFromDetail(detail);
  state.boardSlug = detail.thread.boardSlug;
  setupRealtime();
  state.threadGlobalNumber = detail.thread.globalNumber;
  state.threadPosterHash = detail.thread.posterHash;
  state.threadIsArchived = Boolean(detail.thread.isArchived);
  state.threadIsLocked = Boolean(detail.thread.isLocked);
  if (resetReply || state.threadIsArchived || state.threadIsLocked) {
    closeReplyComposer({ clear: true });
  } else {
    syncReplyComposer();
  }
  const board = currentBoard();
  renderBoards();
  updateBoardPresentation(board);
  els.threadTitle.textContent = threadTitle(detail.thread, boardHeading(board) || detail.thread.boardSlug);
  els.threadAdminActions.innerHTML = threadHeaderActionsHtml(detail);
  els.threadBoardPath.textContent = board?.path || `/${detail.thread.boardSlug}/`;
  els.threadBoardDescription.textContent = board?.description || 'Diễn đàn ảnh sinh viên ẩn danh có AI kiểm duyệt';
  els.threadToolbarTop.innerHTML = threadToolbarHtml(detail, 'top');
  els.threadToolbarBottom.innerHTML = threadToolbarHtml(detail, 'bottom');
  const archivedNotice = detail.thread.isArchived
    ? `<div class="archived-notice">
        Chủ đề đã được lưu trữ${detail.thread.archivedAt ? ` lúc ${escapeHtml(formatPostDate(detail.thread.archivedAt))}` : ''}.
        Không thể đăng trả lời mới.
      </div>`
    : '';
  const lockedNotice = !detail.thread.isArchived && detail.thread.isLocked
    ? `<div class="archived-notice">
        🔒 Chủ đề đã bị khóa${detail.thread.lockedAt ? ` lúc ${escapeHtml(formatPostDate(detail.thread.lockedAt))}` : ''}.
        Không thể đăng trả lời mới.
      </div>`
    : '';
  const canReply = !detail.thread.isArchived && !detail.thread.isLocked;
  const hiddenPosts = hiddenPostNumbers();
  const visibleComments = detail.comments.filter(
    (comment) => !hiddenPosts.has(String(comment.globalNumber)) && !isPostFiltered(comment)
  );
  els.threadDetail.innerHTML = `
    ${archivedNotice}
    ${lockedNotice}
    ${postHtml(detail.thread, 'post op', {
      opNumber: detail.thread.globalNumber,
      opPosterHash: detail.thread.posterHash,
      canReply
    })}
    ${threadMediaGalleryHtml(detail)}
    ${threadSearchHtml(detail)}
    ${commentSortHtml(state.commentsSort)}
    <div class="comment-list">
      ${
        visibleComments.length
          ? visibleComments
              .map((comment) =>
                postHtml(comment, 'post comment', {
                  opNumber: detail.thread.globalNumber,
                  opPosterHash: detail.thread.posterHash,
                  canReply
                })
              )
              .join('')
          : state.threadSearchTerm
            ? '<p class="muted">Không có bình luận khớp tìm kiếm trong thread.</p>'
            : '<p class="muted">Chưa có bình luận công khai trên trang này.</p>'
      }
    </div>
  `;
  els.threadPagination.innerHTML = pageControlsHtml(state.threadCommentPageMeta, 'thread-comments');
  const focusedPost = requestedPost;
  focusPermalinkPost(focusedPost, { scroll: Boolean(focusPost) });
  syncThreadPostCollapseToolbarState();
  resetAutoUpdateTimer();
}

async function loadAdmin() {
  setScreen('admin');
  const loggedIn = Boolean(state.token);
  updateAccountNav();
  els.loginForm.classList.toggle('hidden', loggedIn);
  els.admin2FAVerifyForm?.classList.add('hidden');
  els.admin2FASetupPanel?.classList.add('hidden');
  els.logoutButton.classList.toggle('hidden', !loggedIn);
  els.adminTools.classList.toggle('hidden', !loggedIn);
  els.adminPasskeysPanel?.classList.add('hidden');
  if (!loggedIn) {
    els.pendingList.innerHTML = '';
    els.reportList.innerHTML = '';
    els.moderationActions.innerHTML = '';
    els.reportSection.classList.add('hidden');
    els.moderationSection.classList.add('hidden');
    return;
  }

  renderAdminPasskeys();

  try {
    await loadAdminModerationSettings();
    const data = await api(adminEndpoint());
    if (state.adminTab === 'analytics') {
      renderAdminAnalytics(data);
    } else if (state.adminTab === 'health') {
      renderAdminHealth(data);
    } else {
      renderAdminItems(data);
    }
  } catch (error) {
    if (error.setupRequired) {
      els.loginForm.classList.add('hidden');
      els.adminTools.classList.add('hidden');
      els.admin2FASetupPanel?.classList.remove('hidden');
      els.admin2FASetupStart?.classList.remove('hidden');
      els.admin2FASetupQR?.classList.add('hidden');
      showToast(error.message);
      return;
    }
    state.token = '';
    localStorage.removeItem('adminToken');
    showToast(error.message);
    loadAdmin();
  }
}

function loadPolicy(section = '') {
  setScreen('policy');
  const sectionId = {
    rules: 'policy-rules',
    privacy: 'policy-rules',
    feedback: 'policy-feedback',
    report: 'policy-report',
    appeal: 'policy-appeal',
    contact: 'policy-contact'
  }[section];
  if (sectionId) {
    document.querySelector(`#${sectionId}`)?.scrollIntoView({ block: 'start' });
  } else {
    window.scrollTo({ top: 0 });
  }
}

function route() {
  hideReferencePreview();
  const hash = window.location.hash || '#home';
  const [hashPath, hashQuery = ''] = hash.split('?');
  const [, name, id] = hashPath.match(/^#([^/]+)\/?(.+)?$/) || [];
  if (name === 'home' || !name) {
    loadHome().catch((error) => showToast(error.message));
  } else if (name === 'policy') {
    loadPolicy(id || '');
  } else if (name === 'register') {
    els.registerForm.classList.remove('hidden');
    els.registerRecoveryNotice.classList.add('hidden');
    setScreen('register');
    setFormError(els.registerError);
    window.scrollTo({ top: 0 });
  } else if (name === 'login') {
    setScreen('login');
    setFormError(els.accountLoginError);
    window.scrollTo({ top: 0 });
  } else if (name === 'forgot') {
    resetForgotPasswordForm();
    setScreen('forgot');
    setFormError(els.forgotError);
    window.scrollTo({ top: 0 });
  } else if (name === 'account') {
    loadAccountSettings().catch((error) => showToast(error.message));
  } else if (name === 'thread' && id) {
    const params = new URLSearchParams(hashQuery);
    const nextThreadId = decodeURIComponent(id);
    if (state.threadId !== nextThreadId) {
      state.threadSearchTerm = '';
    }
    state.threadId = nextThreadId;
    state.threadCommentPage = Math.max(1, Number(params.get('cp')) || 1);
    loadThread({ resetReply: true, focusPost: params.get('p') || '' }).catch((error) => showToast(error.message));
  } else if (name === 'catalog') {
    state.boardSlug = id || 'confession';
    state.boardSearchTerm = '';
    state.boardPage = 1;
    loadCatalog().catch((error) => showToast(error.message));
  } else if (name === 'archive') {
    state.boardSlug = id || 'confession';
    state.boardSearchTerm = '';
    state.boardPage = 1;
    loadArchive().catch((error) => showToast(error.message));
  } else if (name === 'admin') {
    loadAdmin().catch((error) => showToast(error.message));
  } else {
    const params = new URLSearchParams(hashQuery);
    state.boardSlug = id || 'confession';
    state.boardSearchTerm = params.get('q') || '';
    state.boardSort = normalizeBoardSort(params.get('sort') || state.boardSort);
    state.boardFilter = normalizeBoardFilter(params.get('filter') || 'all');
    state.boardPage = 1;
    loadBoard().catch((error) => showToast(error.message));
  }
  setupRealtime();
}

function isSupportedMediaFile(file) {
  return Boolean(file?.type?.startsWith('image/') || SUPPORTED_VIDEO_TYPES.has(file?.type));
}

function mediaKind(media = {}) {
  return String(media.type || '').startsWith('video/') ? 'video' : 'image';
}

function mediaList(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return value ? [value] : [];
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
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
        const selectedImage = {
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

function videoFileMetadata(file, dataUrl) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const timeout = window.setTimeout(() => finish(), 2500);

    const finish = (thumbnail = null) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      const selectedVideo = {
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

function createImageThumbnail(image, file) {
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

function createVideoThumbnail(video, file) {
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

function pollHtml(poll, canVote = true) {
  if (!poll?.options?.length) {
    return '';
  }
  const totalVotes = Number(poll.totalVotes || 0);
  return `
    <div class="poll-box">
      <div class="poll-title">Thăm dò ẩn danh · ${totalVotes} vote</div>
      ${poll.options
        .map((option) => {
          const votes = Number(option.votes || 0);
          const percent = totalVotes ? Math.round((votes / totalVotes) * 100) : 0;
          return `
            <div class="poll-option">
              <button data-poll-option="${escapeHtml(option.id)}" type="button" ${canVote ? '' : 'disabled'}>
                ${escapeHtml(option.text)}
              </button>
              <span class="poll-meter"><span style="width: ${percent}%"></span></span>
              <span>${votes} (${percent}%)</span>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function imagePreviewHtml(image) {
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

// Shared change handler for a file input that stages an image on `state[stateKey]`.
// Optionally renders a preview panel and/or updates a filename label.
function handleImageInputChange(input, { stateKey, preview = null, fileNameEl = null }) {
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
    const files = Array.from(input.files || []);
    if (!files.length) {
      reset();
      return;
    }
    if (files.length > MAX_MEDIA_PER_POST) {
      showToast(`Tối đa ${MAX_MEDIA_PER_POST} tệp mỗi bài viết.`);
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

function formValue(form, name) {
  return String(new FormData(form).get(name) || '');
}

function displayNameValue(form) {
  if (form?.elements?.useAccountName?.checked && state.account?.username) {
    return state.account.username;
  }
  return formValue(form, 'displayName');
}

function clearDisplayName(form) {
  if (form?.elements?.displayName) {
    form.elements.displayName.value = '';
  }
  if (form?.elements?.useAccountName) {
    form.elements.useAccountName.checked = false;
  }
}

function hasOption(value, option) {
  return String(value)
    .toLowerCase()
    .split(/[\s,]+/)
    .includes(option);
}

// Attaches the per-post "hide image (spoiler)" choice to the upload payload.
function withImageSpoiler(image, form) {
  return mediaList(image).map((item) => ({ ...item, spoiler: Boolean(form?.elements?.imageSpoiler?.checked) }));
}

// Whether the poster opted to stamp this post with their staff capcode. Only
// honored server-side for verified admin/moderator accounts.
function capcodeValue(form) {
  return isCapcodeEligible() && Boolean(form?.elements?.capcode?.checked);
}

async function confirmDuplicateThreadIfNeeded(body) {
  try {
    const result = await api(`/api/boards/${state.boardSlug}/threads/check-duplicate`, {
      method: 'POST',
      body: JSON.stringify({
        body,
        posterToken: state.posterToken
      })
    });
    if (!result?.isDuplicate) {
      return true;
    }
    return window.confirm(
      `Cảnh báo: bài viết này có vẻ trùng chủ đề với một chủ đề trước đó.\n\n${result.reason || 'AI phát hiện nội dung tương tự.'}\n\nBạn vẫn muốn đăng?`
    );
  } catch (error) {
    console.warn('Bỏ qua lỗi kiểm tra trùng lặp:', error);
    return true;
  }
}

async function submitThread(event) {
  event.preventDefault();
  const body = els.threadBody.value;
  const captchaToken = els.threadCaptcha.value.trim();
  if (!confirmPrivacyBeforeSubmit(body, els.threadPrivacyWarning)) {
    showToast('Đã dừng gửi để bạn chỉnh sửa nội dung.');
    return;
  }
  if (state.hcaptchaSiteKey && !captchaToken) {
    showToast('Vui lòng hoàn tất hCaptcha trước khi gửi.');
    return;
  }
  const button = event.submitter;
  const restoreButton = setButtonLoading(button);
  try {
    if (!(await confirmDuplicateThreadIfNeeded(body))) {
      showToast('Đã dừng gửi để bạn chỉnh sửa nội dung.');
      return;
    }
    const options = formValue(els.threadForm, 'options');
    const payload = {
      subject: formValue(els.threadForm, 'subject'),
      body,
      pollOptions: els.threadPollOptions.value
        .split('\n')
        .map((option) => option.trim())
        .filter(Boolean),
      options,
      displayName: displayNameValue(els.threadForm),
      deletePassword: deletePasswordValue(els.threadForm),
      captchaToken,
      posterToken: state.posterToken,
      capcode: capcodeValue(els.threadForm),
      images: withImageSpoiler(state.selectedImage, els.threadForm)
    };
    const result = await api(`/api/boards/${state.boardSlug}/threads`, {
      auth: 'account',
      method: 'POST',
      body: JSON.stringify(payload)
    });
    rememberMyPost(result.thread, 'thread');
    els.threadBody.value = '';
    els.threadPollOptions.value = '';
    if (els.threadForm.elements.subject) {
      els.threadForm.elements.subject.value = '';
    }
    clearDisplayName(els.threadForm);
    removeDraft(draftKey('thread', state.boardSlug));
    updatePrivacyWarning('', els.threadPrivacyWarning);
    if (els.threadAiRewriteLabel) {
      els.threadAiRewriteLabel.classList.add('hidden');
    }
    els.threadImage.value = '';
    state.selectedImage = [];
    if (els.threadForm.elements.imageSpoiler) {
      els.threadForm.elements.imageSpoiler.checked = false;
    }
    if (els.threadForm.elements.capcode) {
      els.threadForm.elements.capcode.checked = false;
    }
    els.imagePreview.classList.add('hidden');
    resetHcaptcha(els.threadCaptcha);
    closeThreadComposer();
    showToast(postSubmitToast(result, 'Chủ đề đã công khai.', 'Đã vào hàng đợi chờ quản trị viên duyệt.'));
    if (hasOption(options, 'noko') && result.thread?.id) {
      window.location.hash = `#thread/${result.thread.id}`;
    } else {
      await loadBoard();
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    restoreButton();
  }
}

async function submitAppeal(event) {
  event.preventDefault();
  setFormError(els.appealError);
  els.appealResult?.classList.add('hidden');
  const token = els.appealToken?.value.trim() || '';
  const reason = els.appealReason?.value.trim() || '';
  if (!token || !reason) {
    setFormError(els.appealError, 'Nhập mã kháng nghị và lý do.');
    return;
  }

  const button = event.submitter || els.appealForm?.querySelector('[type="submit"]');
  const restoreButton = setButtonLoading(button, 'Đang gửi...');
  try {
    const result = await api('/api/appeals', {
      method: 'POST',
      body: JSON.stringify({ token, reason, posterToken: state.posterToken })
    });
    if (els.appealResult) {
      els.appealResult.textContent = `Đã gửi kháng nghị No.${result.globalNumber}. Trạng thái: ${result.status}.`;
      els.appealResult.classList.remove('hidden');
    }
    els.appealToken.value = '';
    els.appealReason.value = '';
    showToast('Đã gửi kháng nghị.');
  } catch (error) {
    setFormError(els.appealError, error.message);
  } finally {
    restoreButton();
  }
}

async function submitComment(event) {
  event.preventDefault();
  if (state.threadIsArchived || state.threadIsLocked) {
    showToast(state.threadIsLocked ? 'Chủ đề đã bị khóa, không thể trả lời.' : 'Chủ đề đã lưu trữ, không thể trả lời.');
    return;
  }
  const button = event.submitter || els.commentForm.querySelector('[type="submit"]');
  const body = els.commentBody.value;
  const captchaToken = els.commentCaptcha.value.trim();
  if (!confirmPrivacyBeforeSubmit(body, els.commentPrivacyWarning)) {
    showToast('Đã dừng gửi để bạn chỉnh sửa nội dung.');
    return;
  }
  if (state.hcaptchaSiteKey && !captchaToken) {
    showToast('Vui lòng hoàn tất hCaptcha trước khi gửi.');
    return;
  }
  const restoreButton = setButtonLoading(button);
  try {
    const result = await createComment(body, captchaToken);
    rememberMyPost(result.comment, 'comment');
    els.commentBody.value = '';
    clearDisplayName(els.commentForm);
    removeDraft(draftKey('comment', state.threadId));
    updatePrivacyWarning('', els.commentPrivacyWarning);
    if (els.commentAiRewriteLabel) {
      els.commentAiRewriteLabel.classList.add('hidden');
    }
    els.commentImage.value = '';
    state.commentImage = [];
    if (els.commentForm.elements.imageSpoiler) {
      els.commentForm.elements.imageSpoiler.checked = false;
    }
    if (els.quickReplyForm?.elements?.imageSpoiler) {
      els.quickReplyForm.elements.imageSpoiler.checked = false;
    }
    if (els.commentForm.elements.capcode) {
      els.commentForm.elements.capcode.checked = false;
    }
    if (els.quickReplyForm?.elements?.capcode) {
      els.quickReplyForm.elements.capcode.checked = false;
    }
    els.commentImagePreview.innerHTML = '';
    els.commentImagePreview.classList.add('hidden');
    resetHcaptcha(els.commentCaptcha);
    showToast(postSubmitToast(result, 'Đã gửi.', 'Bình luận đang chờ duyệt.'));
    closeReplyComposer();
    await loadThread();
  } catch (error) {
    showToast(error.message);
  } finally {
    restoreButton();
  }
}

async function createComment(body, captchaToken) {
  const useQuickReply = !els.quickReply.classList.contains('hidden');
  const form = useQuickReply ? els.quickReplyForm : els.commentForm;
  const image = useQuickReply ? state.quickReplyImage : state.commentImage;
  return api(`/api/threads/${state.threadId}/comments`, {
    auth: 'account',
    method: 'POST',
    body: JSON.stringify({
      body,
      images: withImageSpoiler(image, form),
      captchaToken,
      posterToken: state.posterToken,
      displayName: displayNameValue(form),
      options: formValue(form, 'options'),
      deletePassword: deletePasswordValue(form),
      capcode: capcodeValue(form)
    })
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function positionQuickReply(event) {
  const width = Math.min(332, window.innerWidth - 8);
  const height = Math.min(334, window.innerHeight - 8);
  const left = clamp(event.clientX - 20, 6, window.innerWidth - width - 6);
  const top = clamp(event.clientY + 10, 6, window.innerHeight - height - 6);
  els.quickReply.style.left = `${left}px`;
  els.quickReply.style.top = `${top}px`;
}

function addQuoteToQuickReply(number) {
  const quote = `>>${number}`;
  const lines = els.quickReplyBody.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.includes(quote)) {
    lines.push(quote);
  }
  els.quickReplyBody.value = `${lines.join('\n')}\n`;
  updatePrivacyWarning(els.quickReplyBody.value, els.quickReplyPrivacyWarning);
}

function openQuickReply(number, event) {
  if (state.threadIsArchived || state.threadIsLocked) {
    showToast(state.threadIsLocked ? 'Chủ đề đã bị khóa, không thể trả lời.' : 'Chủ đề đã lưu trữ, không thể trả lời.');
    return;
  }
  const wasHidden = els.quickReply.classList.contains('hidden');
  const threadNumber = state.threadGlobalNumber || number;
  els.quickReplyTitle.textContent = `Trả lời chủ đề No.${threadNumber}`;
  if (wasHidden) {
    els.quickReplyBody.value = readDraft(draftKey('quickReply', state.threadId));
  }
  addQuoteToQuickReply(number);
  els.quickReplyCaptcha.value = state.hcaptchaSiteKey ? '' : els.commentCaptcha.value || 'dev-pass';
  els.quickReplyFile.value = '';
  state.quickReplyImage = [];
  els.quickReplyFileName.textContent = 'Chưa chọn tệp';
  if (wasHidden) {
    positionQuickReply(event);
  }
  els.quickReply.classList.remove('hidden');
  els.refPreview.classList.add('hidden');
  window.setTimeout(() => els.quickReplyBody.focus(), 0);
}

function closeQuickReply() {
  els.quickReply.classList.add('hidden');
  updatePrivacyWarning('', els.quickReplyPrivacyWarning);
  state.quickReplyDrag = null;
}

async function submitQuickReply(event) {
  event.preventDefault();
  if (state.threadIsArchived || state.threadIsLocked) {
    showToast(state.threadIsLocked ? 'Chủ đề đã bị khóa, không thể trả lời.' : 'Chủ đề đã lưu trữ, không thể trả lời.');
    closeQuickReply();
    return;
  }
  const button = event.submitter;
  const body = els.quickReplyBody.value;
  const captchaToken = els.quickReplyCaptcha.value.trim();
  if (!confirmPrivacyBeforeSubmit(body, els.quickReplyPrivacyWarning)) {
    showToast('Đã dừng gửi để bạn chỉnh sửa nội dung.');
    return;
  }
  if (state.hcaptchaSiteKey && !captchaToken) {
    showToast('Vui lòng hoàn tất hCaptcha trước khi gửi.');
    return;
  }
  const restoreButton = setButtonLoading(button);
  try {
    const result = await createComment(body, captchaToken);
    rememberMyPost(result.comment, 'comment');
    clearDisplayName(els.quickReplyForm);
    removeDraft(draftKey('quickReply', state.threadId));
    els.quickReplyFile.value = '';
    state.quickReplyImage = [];
    els.quickReplyFileName.textContent = 'Chưa chọn tệp';
    resetHcaptcha(els.quickReplyCaptcha);
    showToast(postSubmitToast(result, 'Đã gửi.', 'Bình luận đang chờ duyệt.'));
    closeQuickReply();
    await loadThread();
  } catch (error) {
    showToast(error.message);
  } finally {
    restoreButton();
  }
}

async function showSummary(target) {
  const box = target === 'board' ? els.boardSummary : els.threadSummary;
  const button = target === 'board' ? els.boardSummaryButton : els.threadSummaryButton;
  const defaultHeading = 'Nội dung do AI tổng hợp';
  if (!state.aiConfigured) {
    box.classList.remove('hidden');
    box.innerHTML = `<strong>${defaultHeading}</strong><p>${aiNotConfiguredMessage}</p>`;
    return;
  }
  const requestBody = { posterToken: state.posterToken };
  const summarizeSinceLastRead =
    target === 'thread' &&
    state.threadLastSeenBefore > 0 &&
    state.threadCurrentMaxNumber > state.threadLastSeenBefore;
  if (summarizeSinceLastRead) {
    requestBody.sinceGlobalNumber = state.threadLastSeenBefore;
  }
  const heading = summarizeSinceLastRead
    ? 'Nội dung do AI tổng hợp từ lần đọc trước'
    : defaultHeading;
  button.disabled = true;
  box.classList.remove('hidden');
  box.innerHTML = `<strong>${heading}</strong><p class="muted">Đang tóm tắt...</p>`;
  try {
    const path =
      target === 'board'
        ? `/api/boards/${state.boardSlug}/summary`
        : `/api/threads/${state.threadId}/summary`;
    const result = await api(path, { method: 'POST', body: JSON.stringify(requestBody) });
    box.innerHTML = `
      <strong>${heading}</strong>
      ${
        summarizeSinceLastRead
          ? `<p class="muted">Chỉ gồm bài mới sau No.${escapeHtml(state.threadLastSeenBefore)}.</p>`
          : ''
      }
      <ul>${result.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>
    `;
  } catch (error) {
    box.innerHTML = `<strong>${heading}</strong><p>${error.message}</p>`;
  } finally {
    button.disabled = false;
  }
}

async function loadSuggestions() {
  if (!state.aiConfigured) {
    els.suggestions.classList.remove('hidden');
    els.suggestions.textContent = aiNotConfiguredMessage;
    return;
  }
  els.suggestButton.disabled = true;
  els.suggestions.classList.remove('hidden');
  els.suggestions.textContent = 'Đang gợi ý...';
  try {
    const result = await api(`/api/threads/${state.threadId}/suggestions`, {
      method: 'POST',
      body: JSON.stringify({ posterToken: state.posterToken })
    });
    els.suggestions.innerHTML = result.suggestions
      .map((text) => `<button type="button" data-suggestion="${encodeURIComponent(text)}">${escapeHtml(text)}</button>`)
      .join('');
  } catch (error) {
    els.suggestions.textContent = error.message;
  } finally {
    els.suggestButton.disabled = false;
  }
}

async function rewriteDraft(target) {
  if (!state.aiConfigured) {
    showToast(aiNotConfiguredMessage);
    return;
  }
  const isThread = target === 'thread';
  const textarea = isThread ? els.threadBody : els.commentBody;
  const warningBox = isThread ? els.threadPrivacyWarning : els.commentPrivacyWarning;
  const button = isThread ? els.threadRewriteButton : els.rewriteButton;
  const toneSelect = isThread ? els.threadRewriteTone : els.rewriteTone;
  const label = isThread ? els.threadAiRewriteLabel : els.commentAiRewriteLabel;
  const body = textarea.value.trim();
  if (!body) {
    showToast('Chưa có nội dung để AI sửa.');
    return;
  }

  const restoreButton = setButtonLoading(button, 'Đang sửa...');
  try {
    const tone = toneSelect ? toneSelect.value : 'neutral';
    const result = await api('/api/ai/rewrite', {
      method: 'POST',
      body: JSON.stringify({ body, posterToken: state.posterToken, tone })
    });
    textarea.value = result.text || body;
    updatePrivacyWarning(textarea.value, warningBox);
    if (label) {
      label.classList.remove('hidden');
    }
    textarea.focus();
    showToast('Đã điền bản viết lại vào nháp. Kiểm tra trước khi gửi.');
  } catch (error) {
    showToast(error.message);
  } finally {
    restoreButton();
  }
}

// Reads the rendered text of a post body from the DOM so AI actions never need the raw payload.
function postBodyText(globalNumber) {
  const article = document.getElementById(`p${globalNumber}`);
  const body = article?.querySelector('.post-body');
  return body ? body.textContent.trim() : '';
}

async function translatePost(button) {
  if (!state.aiConfigured) {
    showToast(aiNotConfiguredMessage);
    return;
  }
  const number = button.dataset.translatePost;
  const text = postBodyText(number);
  if (!text) {
    showToast('Bài này không có nội dung để dịch.');
    return;
  }
  const article = document.getElementById(`p${number}`);
  const restore = setButtonLoading(button, '...');
  try {
    const targetLang = els.translateTarget ? els.translateTarget.value : 'en';
    const result = await api('/api/ai/translate', {
      method: 'POST',
      body: JSON.stringify({ text, targetLang, posterToken: state.posterToken })
    });
    let box = article.querySelector('.post-translation');
    if (!box) {
      box = document.createElement('div');
      box.className = 'post-translation';
      article.querySelector('.post-body').after(box);
    }
    box.textContent = `[${result.targetLang}] ${result.text}`;
  } catch (error) {
    showToast(error.message);
  } finally {
    restore();
  }
}

let aiAudioPlayer = null;
let aiTtsUnavailableUntil = 0;
let browserSpeechUtterance = null;

function browserSpeechSupported() {
  return Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
}

function vietnameseSpeechVoice() {
  if (!browserSpeechSupported()) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => /^vi([-_]|$)/i.test(voice.lang)) ||
    voices.find((voice) => /vietnam|việt|tieng viet|tiếng việt/i.test(`${voice.name} ${voice.lang}`)) ||
    null
  );
}

function stopCurrentSpeech() {
  if (aiAudioPlayer) {
    aiAudioPlayer.pause();
    aiAudioPlayer.currentTime = 0;
    aiAudioPlayer = null;
  }
  if (browserSpeechSupported()) {
    window.speechSynthesis.cancel();
  }
  browserSpeechUtterance = null;
}

function speakWithBrowser(text) {
  if (!browserSpeechSupported()) {
    throw new Error('Trình duyệt này chưa hỗ trợ đọc bài viết.');
  }

  stopCurrentSpeech();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 2000));
  utterance.lang = 'vi-VN';
  utterance.rate = 1;
  utterance.pitch = 1;
  const voice = vietnameseSpeechVoice();
  if (voice) {
    utterance.voice = voice;
  }
  browserSpeechUtterance = utterance;

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      callback();
    };
    const timer = window.setTimeout(() => settle(resolve), 300);
    utterance.onstart = () => settle(resolve);
    utterance.onend = () => {
      if (browserSpeechUtterance === utterance) {
        browserSpeechUtterance = null;
      }
    };
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') {
        settle(resolve);
        return;
      }
      if (browserSpeechUtterance === utterance) {
        browserSpeechUtterance = null;
      }
      settle(() => reject(new Error('Trình duyệt không đọc được bài này.')));
    };
    window.speechSynthesis.speak(utterance);
  });
}

function canFallbackToBrowserSpeech(error) {
  return [429, 502, 503, 504].includes(error?.statusCode);
}

async function speakPost(button) {
  const text = postBodyText(button.dataset.ttsPost);
  if (!text) {
    showToast('Bài này không có nội dung để đọc.');
    return;
  }
  const restore = setButtonLoading(button, '...');
  try {
    if (!state.aiConfigured || Date.now() < aiTtsUnavailableUntil) {
      await speakWithBrowser(text);
      showToast(state.aiConfigured ? 'Đang đọc bằng giọng trình duyệt do TTS đang giới hạn.' : 'Đang đọc bằng giọng trình duyệt.');
      return;
    }

    const result = await api('/api/ai/speak', {
      method: 'POST',
      timeoutMs: AI_SPEAK_TIMEOUT_MS,
      body: JSON.stringify({ text: text.slice(0, 2000), posterToken: state.posterToken })
    });
    stopCurrentSpeech();
    aiAudioPlayer = new Audio(`data:${result.mimeType};base64,${result.audio}`);
    await aiAudioPlayer.play();
  } catch (error) {
    if (canFallbackToBrowserSpeech(error) && browserSpeechSupported()) {
      aiTtsUnavailableUntil = Date.now() + AI_TTS_PROVIDER_COOLDOWN_MS;
      try {
        await speakWithBrowser(text);
        showToast('TTS đang bị giới hạn; đang đọc bằng giọng trình duyệt.');
        return;
      } catch {
        // Fall through and show the provider error if local speech cannot start.
      }
    }
    showToast(error.message);
  } finally {
    restore();
  }
}

// Caption (describe/OCR) the image already attached to a composer, inserting the result into the draft.
async function captionAttachedImage({ stateKey, textarea, mode = 'describe' } = {}) {
  if (!state.aiConfigured) {
    showToast(aiNotConfiguredMessage);
    return;
  }
  const image = mediaList(state[stateKey]).find((item) => mediaKind(item) === 'image');
  if (!image || !image.dataUrl) {
    showToast('Chưa có ảnh đính kèm để AI mô tả.');
    return;
  }
  try {
    const result = await api('/api/ai/caption', {
      method: 'POST',
      body: JSON.stringify({ data: image.dataUrl, mimeType: image.type, mode, posterToken: state.posterToken })
    });
    if (!result.text) {
      showToast(mode === 'ocr' ? 'Không tìm thấy chữ trong ảnh.' : 'AI chưa mô tả được ảnh.');
      return;
    }
    const prefix = textarea.value.trim() ? `${textarea.value.trim()}\n` : '';
    textarea.value = `${prefix}${result.text}`;
    textarea.focus();
    showToast('Đã chèn mô tả ảnh vào nháp. Kiểm tra trước khi gửi.');
  } catch (error) {
    showToast(error.message);
  }
}

function appendDraftText(textarea, text) {
  const prefix = textarea.value.trim() ? `${textarea.value.trim()}\n` : '';
  textarea.value = `${prefix}${text}`;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function preferredAudioRecordingType() {
  if (!window.MediaRecorder?.isTypeSupported) {
    return '';
  }
  return AUDIO_RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function audioExtension(mimeType = '') {
  const type = String(mimeType).toLowerCase();
  if (type.includes('mp4')) {
    return 'm4a';
  }
  if (type.includes('ogg')) {
    return 'ogg';
  }
  if (type.includes('mpeg') || type.includes('mp3')) {
    return 'mp3';
  }
  if (type.includes('wav')) {
    return 'wav';
  }
  return 'webm';
}

function stopAudioStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    track.stop();
  }
}

function setAudioTranscribing(key, active) {
  if (!key) {
    return;
  }
  if (active) {
    state.audioTranscribing.add(key);
    postponeAutoUpdateForAudio();
  } else {
    state.audioTranscribing.delete(key);
    syncAutoUpdateControls();
  }
}

function cancelAudioTranscription(key) {
  const controller = key ? state.audioTranscriptionControllers.get(key) : null;
  if (!controller) {
    return false;
  }
  controller.abort();
  return true;
}

// Reads an audio File as base64 and transcribes it into the given draft textarea.
async function transcribeAudioFile(file, textarea, { activityKey = '' } = {}) {
  if (!state.aiConfigured) {
    showToast(aiNotConfiguredMessage);
    return;
  }
  if (!file) {
    return;
  }
  const controller = window.AbortController ? new AbortController() : null;
  if (activityKey && controller) {
    state.audioTranscriptionControllers.set(activityKey, controller);
  }
  setAudioTranscribing(activityKey, true);
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Không đọc được tệp audio.'));
      reader.readAsDataURL(file);
    });
    const result = await api('/api/ai/transcribe', {
      method: 'POST',
      timeoutMs: AI_TRANSCRIBE_TIMEOUT_MS,
      signal: controller?.signal,
      body: JSON.stringify({ data: dataUrl, mimeType: file.type, filename: file.name, posterToken: state.posterToken })
    });
    if (!result.text) {
      showToast('Không nhận được nội dung từ audio.');
      return;
    }
    appendDraftText(textarea, result.text);
    showToast('Đã chèn lời thoại vào nháp. Kiểm tra trước khi gửi.');
  } catch (error) {
    if (error?.name === 'AbortError') {
      showToast('Đã dừng chép audio.');
      return;
    }
    showToast(error.message);
  } finally {
    if (activityKey) {
      state.audioTranscriptionControllers.delete(activityKey);
    }
    setAudioTranscribing(activityKey, false);
  }
}

function setRecordButtonState(button, stateName) {
  if (!button) {
    return;
  }
  const recording = stateName === 'recording';
  const transcribing = stateName === 'transcribing';
  button.classList.toggle('is-recording', recording);
  button.classList.toggle('is-transcribing', transcribing);
  button.setAttribute('aria-pressed', recording || transcribing ? 'true' : 'false');
  button.disabled = false;
  button.textContent =
    stateName === 'recording' ? '[Dừng ghi âm]' : stateName === 'transcribing' ? '[Dừng chép]' : '[Ghi âm]';
}

function stopActiveAudioRecording(key) {
  const active = state.audioRecorders[key];
  if (active?.recorder?.state === 'recording') {
    active.recorder.stop();
  }
}

async function toggleAudioRecording({ key, button, textarea }) {
  if (state.audioTranscribing.has(key)) {
    if (!cancelAudioTranscription(key)) {
      showToast('Đang dừng chép audio...');
    }
    return;
  }
  if (state.audioRecorders[key]?.recorder?.state === 'recording') {
    stopActiveAudioRecording(key);
    return;
  }
  if (!state.aiConfigured) {
    showToast(aiNotConfiguredMessage);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast('Trình duyệt này chưa hỗ trợ ghi âm trực tiếp.');
    return;
  }
  if (audioWorkInProgress()) {
    showToast('Đang xử lý audio ở form khác. Dừng hoặc đợi bản ghi đó trước.');
    return;
  }

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = preferredAudioRecordingType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size > 0) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener('stop', async () => {
      stopAudioStream(stream);
      setRecordButtonState(button, 'transcribing');
      try {
        if (!chunks.length) {
          showToast('Không nhận được audio từ microphone.');
          return;
        }
        const type = recorder.mimeType || chunks[0]?.type || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        const file = new File([blob], `recording-${Date.now()}.${audioExtension(type)}`, { type });
        await transcribeAudioFile(file, textarea, { activityKey: key });
      } finally {
        state.audioRecorders[key] = null;
        setRecordButtonState(button, 'idle');
      }
    });
    recorder.addEventListener('error', () => {
      stopAudioStream(stream);
      state.audioRecorders[key] = null;
      setAudioTranscribing(key, false);
      setRecordButtonState(button, 'idle');
      showToast('Ghi âm thất bại.');
    });
    state.audioRecorders[key] = { recorder, stream };
    recorder.start();
    postponeAutoUpdateForAudio();
    setRecordButtonState(button, 'recording');
  } catch (error) {
    stopAudioStream(stream);
    state.audioRecorders[key] = null;
    setAudioTranscribing(key, false);
    setRecordButtonState(button, 'idle');
    showToast(error?.name === 'NotAllowedError' ? 'Bạn chưa cấp quyền microphone.' : 'Không thể bắt đầu ghi âm.');
  }
}

function referencePreviewPositionSource(source) {
  const target = source?.target?.closest?.('.ref-link') || source?.currentTarget || source;
  if (Number.isFinite(source?.clientX) && Number.isFinite(source?.clientY)) {
    return { x: source.clientX + 10, y: source.clientY + 10 };
  }
  const rect = target?.getBoundingClientRect?.();
  if (rect) {
    return { x: rect.right + 10, y: rect.bottom + 6 };
  }
  return { x: 12, y: 12 };
}

function positionReferencePreview(source) {
  const previewWidth = Math.max(220, Math.min(420, window.innerWidth - 12));
  const previewHeight = Math.min(420, els.refPreview.offsetHeight || 226);
  const position = referencePreviewPositionSource(source);
  const left = clamp(position.x, 6, Math.max(6, window.innerWidth - previewWidth - 6));
  const top = clamp(position.y, 6, Math.max(6, window.innerHeight - previewHeight - 6));
  els.refPreview.style.left = `${left}px`;
  els.refPreview.style.top = `${top}px`;
  els.refPreview.style.maxWidth = `${previewWidth}px`;
}

function renderReferencePreviewPost(post, source) {
  els.refPreview.classList.remove('ref-preview-loading', 'ref-preview-error');
  els.refPreview.innerHTML = postHtml(post, 'post preview-post', {
    actions: false,
    checkbox: false,
    replyAction: false,
    opNumber: state.threadGlobalNumber,
    opPosterHash: state.threadPosterHash
  });
  positionReferencePreview(source);
}

function renderReferencePreviewMessage(message, className, source) {
  els.refPreview.classList.remove('ref-preview-loading', 'ref-preview-error');
  if (className) {
    els.refPreview.classList.add(className);
  }
  els.refPreview.textContent = message;
  positionReferencePreview(source);
}

async function showReference(number, source) {
  const refNumber = String(number || '').trim();
  if (!refNumber) {
    return;
  }
  window.clearTimeout(state.refPreviewHideTimer);
  const requestId = ++state.refPreviewRequestId;
  positionReferencePreview(source);
  els.refPreview.classList.remove('hidden', 'ref-preview-error');
  els.refPreview.classList.add('ref-preview-loading');
  els.refPreview.textContent = `Đang tải >>${refNumber}...`;

  const cached = state.refPreviewCache.get(refNumber);
  if (cached) {
    if (cached.ok) {
      renderReferencePreviewPost(cached.post, source);
    } else {
      renderReferencePreviewMessage(cached.message, 'ref-preview-error', source);
    }
    return;
  }

  try {
    const result = await api(`/api/posts/${refNumber}`);
    if (requestId !== state.refPreviewRequestId) {
      return;
    }
    state.refPreviewCache.set(refNumber, { ok: true, post: result.post });
    renderReferencePreviewPost(result.post, source);
  } catch {
    if (requestId !== state.refPreviewRequestId) {
      return;
    }
    const message = `Bài >>${refNumber} không tồn tại hoặc chưa công khai.`;
    state.refPreviewCache.set(refNumber, { ok: false, message });
    renderReferencePreviewMessage(message, 'ref-preview-error', source);
  }
}

function hideReferencePreview() {
  state.refPreviewRequestId += 1;
  window.clearTimeout(state.refPreviewHideTimer);
  els.refPreview.classList.add('hidden');
  els.refPreview.classList.remove('ref-preview-loading', 'ref-preview-error');
  els.refPreview.innerHTML = '';
}

function scheduleHideReferencePreview() {
  window.clearTimeout(state.refPreviewHideTimer);
  state.refPreviewHideTimer = window.setTimeout(hideReferencePreview, 140);
}

function handleReferencePointerEnter(event) {
  const ref = event.target.closest('.ref-link[data-ref]');
  if (!ref || ref.contains(event.relatedTarget)) {
    return;
  }
  showReference(ref.dataset.ref, event).catch(() => {});
}

function handleReferencePointerLeave(event) {
  const ref = event.target.closest('.ref-link[data-ref]');
  if (!ref || ref.contains(event.relatedTarget) || els.refPreview.contains(event.relatedTarget)) {
    return;
  }
  scheduleHideReferencePreview();
}

function handleReferenceFocusIn(event) {
  const ref = event.target.closest('.ref-link[data-ref]');
  if (!ref) {
    return;
  }
  showReference(ref.dataset.ref, ref).catch(() => {});
}

function handleReferenceFocusOut(event) {
  const ref = event.target.closest('.ref-link[data-ref]');
  if (!ref || els.refPreview.contains(event.relatedTarget)) {
    return;
  }
  scheduleHideReferencePreview();
}

async function submitAccountRegister(event) {
  event.preventDefault();
  setFormError(els.registerError);
  const captchaToken = (els.registerCaptcha?.value || '').trim();
  if (state.hcaptchaSiteKey && !captchaToken) {
    setFormError(els.registerError, 'Vui lòng hoàn tất xác minh hCaptcha trước khi đăng ký.');
    return;
  }
  const button = event.submitter;
  const restoreButton = setButtonLoading(button, 'Đang đăng ký...');
  try {
    const result = await api('/api/account/register', {
      auth: 'none',
      method: 'POST',
      body: JSON.stringify({
        username: els.registerUsername.value,
        password: els.registerPassword.value,
        captchaToken
      })
    });
    els.registerPassword.value = '';
    resetHcaptcha(els.registerCaptcha);
    await finishAccountLogin(result);
    showToast('Đã đăng ký và đăng nhập tài khoản.');
    // Reveal the one-time recovery code before sending the user to settings.
    if (result.recoveryCode) {
      els.registerRecoveryCode.textContent = result.recoveryCode;
      els.registerForm.classList.add('hidden');
      els.registerRecoveryNotice.classList.remove('hidden');
    } else {
      window.location.hash = '#account';
    }
  } catch (error) {
    resetHcaptcha(els.registerCaptcha);
    setFormError(els.registerError, error.message);
  } finally {
    restoreButton();
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Đã sao chép vào clipboard.');
  } catch {
    showToast('Không thể sao chép tự động, vui lòng copy thủ công.');
  }
}

function resetForgotPasswordForm() {
  if (!els.forgotPasswordForm) {
    return;
  }
  els.forgotPasswordForm.reset();
  els.forgotPasswordForm.classList.remove('hidden');
  els.forgotSuccess.classList.add('hidden');
  setFormError(els.forgotError);
  resetHcaptcha(els.forgotCaptcha);
}

async function submitForgotPassword(event) {
  event.preventDefault();
  setFormError(els.forgotError);
  const captchaToken = (els.forgotCaptcha?.value || '').trim();
  if (state.hcaptchaSiteKey && !captchaToken) {
    setFormError(els.forgotError, 'Vui lòng hoàn tất xác minh hCaptcha trước khi đặt lại mật khẩu.');
    return;
  }
  const button = event.submitter;
  const restoreButton = setButtonLoading(button, 'Đang đặt lại...');
  try {
    const result = await api('/api/account/forgot-password', {
      auth: 'none',
      method: 'POST',
      body: JSON.stringify({
        username: els.forgotUsername.value,
        recoveryCode: els.forgotRecoveryCode.value,
        newPassword: els.forgotNewPassword.value,
        captchaToken
      })
    });
    els.forgotNewPassword.value = '';
    els.forgotRecoveryCode.value = '';
    resetHcaptcha(els.forgotCaptcha);
    els.forgotNewRecoveryCode.textContent = result.recoveryCode || '';
    els.forgotPasswordForm.classList.add('hidden');
    els.forgotSuccess.classList.remove('hidden');
    showToast('Đã đặt lại mật khẩu. Vui lòng đăng nhập lại.');
  } catch (error) {
    resetHcaptcha(els.forgotCaptcha);
    setFormError(els.forgotError, error.message);
  } finally {
    restoreButton();
  }
}

async function submitRecoveryCodeRegen(event) {
  event.preventDefault();
  setFormError(els.recoveryCodeError);
  const button = event.submitter;
  const restoreButton = setButtonLoading(button, 'Đang tạo...');
  try {
    const result = await api('/api/account/recovery-code', {
      auth: 'account',
      method: 'POST',
      body: JSON.stringify({ password: els.recoveryCodePassword.value })
    });
    els.recoveryCodePassword.value = '';
    els.recoveryCodeResultValue.textContent = result.recoveryCode || '';
    els.recoveryCodeResult.classList.remove('hidden');
    if (state.account) {
      state.account.hasRecoveryCode = true;
    }
    showToast('Đã tạo mã khôi phục mới. Mã cũ đã hết hiệu lực.');
  } catch (error) {
    setFormError(els.recoveryCodeError, error.message);
  } finally {
    restoreButton();
  }
}

function renderAccountRecoveryPanel() {
  if (!els.accountRecoveryPanel) {
    return;
  }
  const loggedIn = Boolean(state.accountToken && state.account);
  els.accountRecoveryPanel.classList.toggle('hidden', !loggedIn);
  // Never keep a previously revealed code on screen across renders.
  els.recoveryCodeResult.classList.add('hidden');
  els.recoveryCodeResultValue.textContent = '';
  setFormError(els.recoveryCodeError);
}

async function submitAccountLogin(event) {
  event.preventDefault();
  setFormError(els.accountLoginError);
  const captchaToken = (els.accountLoginCaptcha?.value || '').trim();
  if (state.hcaptchaSiteKey && !captchaToken) {
    setFormError(els.accountLoginError, 'Vui lòng hoàn tất xác minh hCaptcha trước khi đăng nhập.');
    return;
  }
  const button = event.submitter;
  const restoreButton = setButtonLoading(button, 'Đang đăng nhập...');
  try {
    const result = await api('/api/account/login', {
      auth: 'none',
      method: 'POST',
      body: JSON.stringify({
        username: els.accountUsername.value,
        password: els.accountPassword.value,
        captchaToken
      })
    });
    els.accountPassword.value = '';
    resetHcaptcha(els.accountLoginCaptcha);
    if (result.requires2FA) {
      state.temp2FAToken = result.tempToken;
      els.account2FAVerifyForm.classList.remove('hidden');
      els.login2FACode.value = '';
      els.login2FACode.focus();
      showToast('Vui lòng nhập mã 2FA để hoàn tất đăng nhập.');
      return;
    }
    await finishAccountLogin(result);
    showToast('Đã đăng nhập tài khoản.');
    window.location.hash = '#account';
  } catch (error) {
    resetHcaptcha(els.accountLoginCaptcha);
    setFormError(els.accountLoginError, error.message);
  } finally {
    restoreButton();
  }
}

async function submitAccount2FAVerify(event) {
  event.preventDefault();
  setFormError(els.account2FAVerifyError);
  try {
    const code = (els.login2FACode.value || '').trim();
    if (!code) {
      throw new Error('Vui lòng nhập mã 2FA.');
    }
    const result = await api('/api/auth/2fa/verify', {
      auth: 'none',
      method: 'POST',
      body: JSON.stringify({ tempToken: state.temp2FAToken, code })
    });
    els.account2FAVerifyForm.classList.add('hidden');
    state.temp2FAToken = null;
    await finishAccountLogin(result);
    showToast('Xác thực 2FA thành công. Đã đăng nhập.');
    window.location.hash = '#account';
  } catch (error) {
    setFormError(els.account2FAVerifyError, error.message);
  }
}

async function submitBackupCodeLogin() {
  setFormError(els.account2FAVerifyError);
  try {
    const code = (els.loginBackupCode.value || '').trim();
    if (!code) {
      throw new Error('Vui lòng nhập mã dự phòng.');
    }
    const result = await api('/api/auth/2fa/backup-login', {
      auth: 'none',
      method: 'POST',
      body: JSON.stringify({ tempToken: state.temp2FAToken, code })
    });
    els.account2FAVerifyForm.classList.add('hidden');
    state.temp2FAToken = null;
    await finishAccountLogin(result);
    showToast('Đăng nhập bằng mã dự phòng thành công.');
    window.location.hash = '#account';
  } catch (error) {
    setFormError(els.account2FAVerifyError, error.message);
  }
}

async function submitAccountSettings(event) {
  event.preventDefault();
  setFormError(els.accountSettingsError);
  const button = event.submitter;
  const restoreButton = setButtonLoading(button, 'Đang lưu...');
  const displayPreferences = writeLocalDisplayPreferences({
    compactThreads: els.accountCompactThreads.checked,
    hideThumbnails: els.accountHideThumbnails.checked,
    watchedUnreadOnly: els.accountWatchedUnreadOnly.checked,
    watchedSort: els.accountWatchedSort.value
  });
  const browserWatchedThreads = await resolveBrowserWatchedThreadPreference(els.accountBrowserNotifyWatchedThreads.checked);
  const notificationPreferences = writeLocalNotificationPreferences({
    email: els.accountEmailNotifications.checked,
    watchedThreads: els.accountNotifyWatchedThreads.checked,
    boardSubscriptions: els.accountNotifyBoardSubscriptions.checked,
    browserWatchedThreads
  });
  const boardSubscriptions = [...els.accountBoardSubscriptions.querySelectorAll('[data-account-board-subscription]:checked')].map(
    (input) => input.value
  );
  applyTheme(els.accountTheme.value);
  localStorage.setItem(homeBoardKey, els.accountHomeBoard.value);
  applyDisplayPreferences(displayPreferences);
  applyNotificationPreferences(notificationPreferences);
  writeSubscribedBoardSlugs(boardSubscriptions);
  syncBoardSubscriptionButtons();
  try {
    if (!state.accountToken || !state.account) {
      fillAccountSettings();
      showToast('Đã lưu settings trên trình duyệt này.');
      return;
    }
    const account = await api('/api/account/settings', {
      auth: 'account',
      method: 'PUT',
      body: JSON.stringify({
        settings: {
          theme: els.accountTheme.value,
          homeBoard: els.accountHomeBoard.value,
          syncDrafts: els.accountSyncDrafts.checked,
          emailNotifications: notificationPreferences.email,
          displayPreferences,
          notificationPreferences,
          boardSubscriptions
        }
      })
    });
    state.account = account;
    applyAccountSyncedSettings(account);
    fillAccountSettings(account);
    updateAccountNav();
    showToast('Đã lưu settings tài khoản.');
  } catch (error) {
    setFormError(els.accountSettingsError, error.message);
    if (/đăng nhập|Phiên/.test(error.message)) {
      setAccountSession();
      fillAccountSettings();
    }
  } finally {
    restoreButton();
  }
}

function parseRealtimePayload(event) {
  try {
    const payload = JSON.parse(event?.data || '{}');
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return {};
  }
}

function rememberBrowserNotificationId(id) {
  state.browserNotificationIds.add(id);
  if (state.browserNotificationIds.size <= 100) {
    return;
  }
  const oldest = state.browserNotificationIds.values().next().value;
  if (oldest) {
    state.browserNotificationIds.delete(oldest);
  }
}

function notifyWatchedThreadPost(payload = {}) {
  const preferences = localNotificationPreferences();
  if (!preferences.browserWatchedThreads || !browserNotificationsSupported() || browserNotificationPermission() !== 'granted') {
    return;
  }
  const comment = payload.comment && typeof payload.comment === 'object' ? payload.comment : {};
  const threadId = String(payload.threadId || comment.threadId || '');
  if (!threadId) {
    return;
  }
  const watchedThreads = readWatchedThreads();
  const watched = watchedThreads[threadId];
  if (!watched) {
    return;
  }
  const globalNumber = Number(comment.globalNumber || 0);
  if (Number.isFinite(globalNumber) && globalNumber <= Number(watched.lastSeen || 0)) {
    return;
  }
  const notificationId = `${threadId}:${comment.id || comment.globalNumber || comment.createdAt || Date.now()}`;
  if (state.browserNotificationIds.has(notificationId)) {
    return;
  }
  rememberBrowserNotificationId(notificationId);

  watchedThreads[threadId] = {
    ...watched,
    maxNumber: Math.max(Number(watched.maxNumber || 0), globalNumber || 0),
    replyCount: Math.max(Number(watched.replyCount || 0), Number(watched.replyCount || 0) + 1),
    updatedAt: comment.createdAt || new Date().toISOString()
  };
  writeWatchedThreads(watchedThreads);

  const boardLabel = watched.boardPath || (watched.boardSlug ? `/${watched.boardSlug}/` : '36chan');
  const title = `${boardLabel} No.${watched.globalNumber || '?'}`;
  const body = plainPreview(comment.bodyLines || [], 'Có bài mới trong thread đang theo dõi.').slice(0, 140);
  const notification = new window.Notification(title, {
    body,
    tag: `watched-thread-${threadId}`,
    data: { threadId, globalNumber }
  });
  notification.onclick = () => {
    window.focus();
    window.location.hash = `#thread/${encodeURIComponent(threadId)}${globalNumber ? `?p=${encodeURIComponent(globalNumber)}` : ''}`;
    notification.close?.();
  };
}

function setupRealtime() {
  const context = new URLSearchParams();
  if ((window.location.hash || '').startsWith('#board/') || (window.location.hash || '').startsWith('#thread/')) {
    context.set('boardSlug', state.boardSlug);
  }
  if ((window.location.hash || '').startsWith('#thread/') && state.threadId) {
    context.set('threadId', state.threadId);
  }
  const contextKey = context.toString();
  if (state.realtimeSource && state.realtimeContextKey === contextKey) {
    return;
  }
  if (state.realtimeSource) {
    state.realtimeSource.close();
  }
  state.realtimeContextKey = contextKey;
  const source = new EventSource(realtimeEndpoint(contextKey));
  state.realtimeSource = source;
  source.addEventListener('connected', () => {
    els.socketStatus.textContent = 'trực tiếp';
    els.socketStatus.classList.add('live');
    els.socketStatus.classList.remove('offline');
  });
  source.onerror = () => {
    els.socketStatus.textContent = 'mất kết nối';
    els.socketStatus.classList.add('offline');
    els.socketStatus.classList.remove('live');
  };
  for (const eventName of ['thread:created', 'thread:bumped', 'thread:updated', 'comment:created', 'comment:updated', 'thread:archived']) {
    source.addEventListener(eventName, (event) => {
      if (eventName === 'comment:created') {
        notifyWatchedThreadPost(parseRealtimePayload(event));
      }
      const hash = window.location.hash || '#home';
      if (hash.startsWith('#home') || hash === '') {
        loadHome().catch(() => {});
      } else if (hash.startsWith('#thread/')) {
        if (!audioWorkInProgress()) {
          loadThread().catch(() => {});
        }
      } else if (hash.startsWith('#catalog/')) {
        loadCatalog().catch(() => {});
      } else if (hash.startsWith('#archive/')) {
        if (eventName === 'thread:archived') {
          loadArchive().catch(() => {});
        }
      } else if (hash.startsWith('#board/')) {
        loadBoard().catch(() => {});
      }
    });
  }
}

function eventInTextInput(event) {
  const target = event.target;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  );
}

function refreshCurrentScreen() {
  const hash = window.location.hash || '#home';
  if (hash.startsWith('#thread/')) {
    return loadThread();
  }
  if (hash.startsWith('#catalog/')) {
    return loadCatalog();
  }
  if (hash.startsWith('#archive/')) {
    return loadArchive();
  }
  if (hash.startsWith('#board/')) {
    return loadBoard();
  }
  return loadHome();
}

function keyboardNavigationTargets() {
  const hash = window.location.hash || '#home';
  if (hash.startsWith('#thread/')) {
    return [...els.threadDetail.querySelectorAll('article.post[id^="p"]')];
  }
  if (hash.startsWith('#catalog/')) {
    return [...els.catalogGrid.querySelectorAll('.catalog-thread')];
  }
  if (hash.startsWith('#archive/')) {
    return [...els.archiveList.querySelectorAll('.archive-row')];
  }
  if (hash.startsWith('#board/')) {
    return [...els.threadList.querySelectorAll('.thread[id^="p"]')];
  }
  return [];
}

function currentNavigationIndex(targets) {
  const top = 12;
  const firstBelowTop = targets.findIndex((target) => target.getBoundingClientRect().bottom > top);
  return firstBelowTop === -1 ? targets.length - 1 : firstBelowTop;
}

function focusNavigationTarget(target) {
  if (!target) {
    return;
  }
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
  }
  target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  target.focus({ preventScroll: true });
}

function moveKeyboardNavigation(direction) {
  const targets = keyboardNavigationTargets().filter((target) => target.offsetParent !== null);
  if (!targets.length) {
    return false;
  }
  const currentIndex = currentNavigationIndex(targets);
  const nextIndex = Math.max(0, Math.min(targets.length - 1, currentIndex + direction));
  focusNavigationTarget(targets[nextIndex]);
  return true;
}

function handleKeyboardShortcut(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || eventInTextInput(event)) {
    return;
  }
  if (event.key === 't') {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (event.key === 'u') {
    event.preventDefault();
    refreshCurrentScreen().catch((error) => showToast(error.message));
  } else if (event.key === 'r' && (window.location.hash || '').startsWith('#thread/')) {
    event.preventDefault();
    openReplyComposer();
  } else if (event.key === 'n') {
    if (moveKeyboardNavigation(1)) {
      event.preventDefault();
    }
  } else if (event.key === 'p') {
    if (moveKeyboardNavigation(-1)) {
      event.preventDefault();
    }
  } else if (event.key === 'b' && state.boardSlug) {
    event.preventDefault();
    window.location.hash = `#board/${state.boardSlug}`;
  }
}

function loadFullMediaForToggle(imageToggle) {
  const fullSrc = imageToggle.dataset.fullSrc;
  if (!fullSrc) {
    return;
  }

  if (imageToggle.dataset.mediaType === 'video') {
    let video = imageToggle.querySelector('video');
    if (!video) {
      video = document.createElement('video');
      video.className = imageToggle.dataset.imageClass || 'post-image';
      video.controls = true;
      video.preload = 'metadata';
      imageToggle.replaceChildren(video);
    }
    if (video.dataset.fullLoaded !== 'true') {
      video.src = fullSrc;
      video.dataset.fullLoaded = 'true';
    }
    return;
  }

  let image = imageToggle.querySelector('img');
  if (!image) {
    image = document.createElement('img');
    image.className = imageToggle.dataset.imageClass || 'post-image';
    image.alt = imageToggle.dataset.imageName || 'tai-len';
    imageToggle.replaceChildren(image);
  }

  if (image.dataset.fullLoaded !== 'true') {
    image.src = fullSrc;
    image.dataset.fullLoaded = 'true';
  }
}

function threadPosts() {
  return els.threadDetail ? [...els.threadDetail.querySelectorAll('article.post')] : [];
}

function setPostCollapsed(post, collapsed) {
  if (!post) {
    return;
  }
  post.classList.toggle('post-collapsed', collapsed);
  const button = post.querySelector('[data-collapse-post]');
  if (button) {
    button.textContent = collapsed ? '[Mở]' : '[Thu]';
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    button.title = collapsed ? 'Mở lại bài viết' : 'Thu gọn bài viết';
  }
}

function syncThreadPostCollapseToolbarState() {
  const posts = threadPosts();
  const buttons = document.querySelectorAll('[data-thread-collapse-posts]');
  const collapsedCount = posts.filter((post) => post.classList.contains('post-collapsed')).length;
  const allCollapsed = posts.length > 0 && collapsedCount === posts.length;
  buttons.forEach((button) => {
    button.disabled = posts.length === 0;
    button.textContent = allCollapsed ? 'Mở bài' : 'Thu bài';
    button.setAttribute('aria-pressed', allCollapsed ? 'true' : 'false');
    button.title = allCollapsed ? 'Mở toàn bộ bài trong thread' : 'Thu gọn toàn bộ bài trong thread';
  });
}

function toggleAllThreadPostsCollapsed() {
  const posts = threadPosts();
  if (!posts.length) {
    return false;
  }
  const shouldCollapse = posts.some((post) => !post.classList.contains('post-collapsed'));
  posts.forEach((post) => setPostCollapsed(post, shouldCollapse));
  syncThreadPostCollapseToolbarState();
  return shouldCollapse;
}

function bindEvents() {
  window.addEventListener('hashchange', route);
  window.addEventListener('keydown', handleKeyboardShortcut);
  // Image error events don't bubble, so listen in the capture phase. When a
  // thumbnail fails to load (e.g. a stale storage URL returning 404), swap the
  // broken-image icon for a neutral placeholder instead of leaving it ugly.
  document.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || img.dataset.thumbBroken === '1') {
        return;
      }
      if (!img.closest('.thread-thumb-wrap, .catalog-thumb, .popular-thumb')) {
        return;
      }
      img.dataset.thumbBroken = '1';
      const placeholder = document.createElement('span');
      placeholder.className = `${img.className} placeholder thumb-broken`.trim();
      placeholder.textContent = 'Tệp lỗi';
      if (img.dataset.fullSrc) {
        placeholder.dataset.fullSrc = img.dataset.fullSrc;
      }
      img.replaceWith(placeholder);
    },
    true
  );
  els.homeBoardSearchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const board = findBoardByQuery(els.homeBoardSearchInput.value);
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
  els.threadForm.addEventListener('submit', submitThread);
  els.appealForm?.addEventListener('submit', submitAppeal);
  els.commentForm.addEventListener('submit', submitComment);
  els.quickReplyForm.addEventListener('submit', submitQuickReply);
  els.deletePasswordInputs.forEach((input) => {
    input.addEventListener('input', () => updateDeletePassword(input.value));
  });
  els.threadBody.addEventListener('input', () => {
    writeDraft(draftKey('thread', state.boardSlug), els.threadBody.value);
    updatePrivacyWarning(els.threadBody.value, els.threadPrivacyWarning);
    if (els.threadAiRewriteLabel) {
      els.threadAiRewriteLabel.classList.add('hidden');
    }
  });
  els.commentBody.addEventListener('input', () => {
    writeDraft(draftKey('comment', state.threadId), els.commentBody.value);
    updatePrivacyWarning(els.commentBody.value, els.commentPrivacyWarning);
    if (els.commentAiRewriteLabel) {
      els.commentAiRewriteLabel.classList.add('hidden');
    }
  });
  els.quickReplyBody.addEventListener('input', () => {
    writeDraft(draftKey('quickReply', state.threadId), els.quickReplyBody.value);
    updatePrivacyWarning(els.quickReplyBody.value, els.quickReplyPrivacyWarning);
  });
  els.quickReplyClose.addEventListener('click', closeQuickReply);
  els.quickReplyHandle.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) {
      return;
    }
    const rect = els.quickReply.getBoundingClientRect();
    state.quickReplyDrag = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    event.preventDefault();
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.quickReplyDrag) {
      return;
    }
    const rect = els.quickReply.getBoundingClientRect();
    const left = clamp(event.clientX - state.quickReplyDrag.offsetX, 4, window.innerWidth - rect.width - 4);
    const top = clamp(event.clientY - state.quickReplyDrag.offsetY, 4, window.innerHeight - rect.height - 4);
    els.quickReply.style.left = `${left}px`;
    els.quickReply.style.top = `${top}px`;
  });
  window.addEventListener('mouseup', () => {
    state.quickReplyDrag = null;
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideReferencePreview();
    }
  });
  els.boardSummaryButton.addEventListener('click', () => showSummary('board'));
  els.threadSummaryButton.addEventListener('click', () => showSummary('thread'));
  els.suggestButton.addEventListener('click', loadSuggestions);
  els.threadRewriteButton.addEventListener('click', () => rewriteDraft('thread'));
  els.rewriteButton.addEventListener('click', () => rewriteDraft('comment'));
  els.threadCaptionButton?.addEventListener('click', () =>
    captionAttachedImage({ stateKey: 'selectedImage', textarea: els.threadBody, mode: 'describe' })
  );
  els.threadOcrButton?.addEventListener('click', () =>
    captionAttachedImage({ stateKey: 'selectedImage', textarea: els.threadBody, mode: 'ocr' })
  );
  els.commentCaptionButton?.addEventListener('click', () =>
    captionAttachedImage({ stateKey: 'commentImage', textarea: els.commentBody, mode: 'describe' })
  );
  els.commentOcrButton?.addEventListener('click', () =>
    captionAttachedImage({ stateKey: 'commentImage', textarea: els.commentBody, mode: 'ocr' })
  );
  els.threadAudio?.addEventListener('change', async () => {
    els.threadAudio.disabled = true;
    setRecordButtonState(els.threadRecordButton, 'transcribing');
    try {
      await transcribeAudioFile(els.threadAudio.files?.[0], els.threadBody, { activityKey: 'thread' });
    } finally {
      els.threadAudio.disabled = false;
      setRecordButtonState(els.threadRecordButton, 'idle');
    }
    els.threadAudio.value = '';
  });
  els.commentAudio?.addEventListener('change', async () => {
    els.commentAudio.disabled = true;
    setRecordButtonState(els.commentRecordButton, 'transcribing');
    try {
      await transcribeAudioFile(els.commentAudio.files?.[0], els.commentBody, { activityKey: 'comment' });
    } finally {
      els.commentAudio.disabled = false;
      setRecordButtonState(els.commentRecordButton, 'idle');
    }
    els.commentAudio.value = '';
  });
  els.threadRecordButton?.addEventListener('click', () =>
    toggleAudioRecording({ key: 'thread', button: els.threadRecordButton, textarea: els.threadBody })
  );
  els.commentRecordButton?.addEventListener('click', () =>
    toggleAudioRecording({ key: 'comment', button: els.commentRecordButton, textarea: els.commentBody })
  );
  els.threadImage.addEventListener(
    'change',
    handleImageInputChange(els.threadImage, { stateKey: 'selectedImage', preview: els.imagePreview })
  );
  els.commentImage.addEventListener(
    'change',
    handleImageInputChange(els.commentImage, { stateKey: 'commentImage', preview: els.commentImagePreview })
  );
  els.quickReplyFile.addEventListener(
    'change',
    handleImageInputChange(els.quickReplyFile, { stateKey: 'quickReplyImage', fileNameEl: els.quickReplyFileName })
  );
  document.body.addEventListener('keydown', (event) => {
    const mediaToggle = event.target.closest('[data-image-toggle][role="button"]');
    if (!mediaToggle || (event.key !== 'Enter' && event.key !== ' ')) {
      return;
    }
    event.preventDefault();
    mediaToggle.click();
  });

  document.body.addEventListener('mouseover', handleReferencePointerEnter);
  document.body.addEventListener('mouseout', handleReferencePointerLeave);
  document.body.addEventListener('focusin', handleReferenceFocusIn);
  document.body.addEventListener('focusout', handleReferenceFocusOut);
  els.refPreview.addEventListener('mouseenter', () => window.clearTimeout(state.refPreviewHideTimer));
  els.refPreview.addEventListener('mouseleave', scheduleHideReferencePreview);

  document.body.addEventListener('submit', (event) => {
    const threadSearchForm = event.target.closest('#threadSearchForm');
    if (!threadSearchForm) {
      return;
    }
    event.preventDefault();
    state.threadSearchTerm = normalizeThreadSearchTerm(new FormData(threadSearchForm).get('q'));
    state.threadCommentPage = 1;
    loadThread().catch((error) => showToast(error.message));
  });

  document.body.addEventListener('click', async (event) => {
    const composerInsertButton = event.target.closest('[data-composer-insert]');
    if (composerInsertButton) {
      const pickerRoot = composerInsertButton.closest('[data-composer-picker]');
      insertComposerToken(pickerRoot?.dataset.composerPicker, composerInsertButton.dataset.composerInsert);
      return;
    }

    const insertReplyTemplateButton = event.target.closest('[data-insert-reply-template]');
    if (insertReplyTemplateButton) {
      const picker = insertReplyTemplateButton.closest('[data-reply-template-picker]');
      const selectedId = picker?.querySelector('[data-reply-template-select]')?.value || '';
      insertReplyTemplate(insertReplyTemplateButton.dataset.insertReplyTemplate, selectedId);
      return;
    }

    const saveReplyTemplateButton = event.target.closest('[data-save-reply-template]');
    if (saveReplyTemplateButton) {
      saveComposerReplyTemplate(saveReplyTemplateButton.dataset.saveReplyTemplate);
      return;
    }

    const clearThreadSearchButton = event.target.closest('[data-clear-thread-search]');
    if (clearThreadSearchButton) {
      state.threadSearchTerm = '';
      state.threadCommentPage = 1;
      await loadThread().catch((error) => showToast(error.message));
      return;
    }

    const threadMediaJump = event.target.closest('[data-thread-media-jump]');
    if (threadMediaJump) {
      event.preventDefault();
      focusPermalinkPost(threadMediaJump.dataset.threadMediaJump, { scroll: true });
      return;
    }

    const imageToggle = event.target.closest('[data-image-toggle]');
    if (imageToggle) {
      if (imageToggle.classList.contains('expanded') && event.target.closest('video')) {
        return;
      }
      // A spoilered image reveals on its first click instead of zooming.
      if (imageToggle.hasAttribute('data-spoiler-image') && !imageToggle.classList.contains('spoiler-revealed')) {
        imageToggle.classList.add('spoiler-revealed');
        imageToggle.closest('.thread-thumb-wrap')?.classList.remove('spoiler-image');
        return;
      }
      const expanded = imageToggle.classList.toggle('expanded');
      if (expanded) {
        loadFullMediaForToggle(imageToggle);
      }
      imageToggle.closest('.thread-thumb-wrap')?.classList.toggle('image-expanded', expanded);
      imageToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      return;
    }

    const quickReplyNumber = event.target.closest('[data-quick-reply]');
    if (quickReplyNumber) {
      openQuickReply(quickReplyNumber.dataset.quickReply, event);
      return;
    }

    const selfEditPostButton = event.target.closest('[data-self-edit-post]');
    if (selfEditPostButton) {
      const globalNumber = selfEditPostButton.dataset.selfEditPost;
      const currentBody = decodeURIComponent(selfEditPostButton.dataset.selfEditBody || '');
      const edit = await showPostEditModal(globalNumber, currentBody, { showReason: false });
      if (!edit) {
        return;
      }
      try {
        const result = await api(`/api/posts/${globalNumber}`, {
          auth: 'none',
          method: 'PUT',
          body: JSON.stringify({ body: edit.body, password: myPostDeletePassword(globalNumber) })
        });
        rememberMyPost(result.post, result.type || 'thread');
        showToast(result.status === 'pending' ? 'Đã sửa bài. Nội dung đang chờ duyệt lại.' : 'Đã sửa bài.');
        await refreshCurrentScreen();
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const selfDeletePostButton = event.target.closest('[data-self-delete-post]');
    if (selfDeletePostButton) {
      const globalNumber = selfDeletePostButton.dataset.selfDeletePost;
      if (!window.confirm(`Xóa bài No.${globalNumber}?`)) {
        return;
      }
      try {
        await api(`/api/posts/${globalNumber}`, {
          auth: 'none',
          method: 'DELETE',
          body: JSON.stringify({ password: myPostDeletePassword(globalNumber) })
        });
        showToast('Đã xóa bài.');
        await refreshCurrentScreen();
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const selfDeleteFileButton = event.target.closest('[data-self-delete-file-post]');
    if (selfDeleteFileButton) {
      const globalNumber = selfDeleteFileButton.dataset.selfDeleteFilePost;
      if (!window.confirm(`Xóa tệp đính kèm của bài No.${globalNumber}?`)) {
        return;
      }
      try {
        await api(`/api/posts/${globalNumber}`, {
          auth: 'none',
          method: 'DELETE',
          body: JSON.stringify({ password: myPostDeletePassword(globalNumber), fileOnly: true })
        });
        showToast('Đã xóa tệp đính kèm.');
        await refreshCurrentScreen();
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const accountEditPostButton = event.target.closest('[data-account-edit-post]');
    if (accountEditPostButton) {
      const globalNumber = accountEditPostButton.dataset.accountEditPost;
      const currentBody = decodeURIComponent(accountEditPostButton.dataset.accountEditBody || '');
      const postElement = document.getElementById(`p${globalNumber}`);
      const currentMediaHtml = postElement?.querySelector('.post-media-gallery')?.innerHTML || '';
      const edit = await showPostEditModal(globalNumber, currentBody, {
        allowMedia: true,
        currentMediaHtml
      });
      if (!edit) {
        return;
      }
      const payload = { body: edit.body };
      if (edit.replaceImages) {
        payload.images = edit.images || [];
      }
      try {
        const result = await api(`/api/posts/${globalNumber}`, {
          auth: 'account',
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        rememberMyPost(result.post, result.type || 'thread');
        await refreshAccountPostNumbers();
        showToast(result.status === 'pending' ? 'Đã sửa bài. Nội dung đang chờ duyệt lại.' : 'Đã sửa bài.');
        if ((window.location.hash || '#home').startsWith('#home')) {
          renderMyPosts();
        } else {
          await refreshCurrentScreen();
        }
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    const refreshButton = event.target.closest('[data-thread-refresh]');
    if (refreshButton) {
      await loadThread().catch((error) => showToast(error.message));
      return;
    }

    const watchButton = event.target.closest('[data-toggle-watch]');
    if (watchButton) {
      toggleCurrentThreadWatch();
      return;
    }

    const unwatchThreadButton = event.target.closest('[data-unwatch-thread]');
    if (unwatchThreadButton) {
      removeWatchedThread(unwatchThreadButton.dataset.unwatchThread);
      showToast('Đã bỏ theo dõi chủ đề.');
      if ((window.location.hash || '#home').startsWith('#home')) {
        state.watchedThreadSummaries = await loadWatchedThreadSummaries();
        renderWatchedThreads();
      }
      return;
    }

    const watchedUnreadToggle = event.target.closest('#watchedUnreadToggle');
    if (watchedUnreadToggle) {
      const preferences = localDisplayPreferences();
      const displayPreferences = applyDisplayPreferences({
        ...preferences,
        watchedUnreadOnly: !preferences.watchedUnreadOnly
      });
      renderWatchedThreads();
      persistAccountSettings({ silent: true });
      showToast(displayPreferences.watchedUnreadOnly ? 'Đang chỉ hiện thread chưa đọc.' : 'Đang hiện toàn bộ watchlist.');
      return;
    }

    const watchedMarkAllRead = event.target.closest('#watchedMarkAllRead');
    if (watchedMarkAllRead) {
      const count = markAllWatchedThreadsRead();
      renderWatchedThreads();
      if (count) {
        persistAccountSettings({ silent: true });
        showToast(`Đã đánh dấu ${count.toLocaleString()} chủ đề là đã đọc.`);
      }
      return;
    }

    const boardRefreshButton = event.target.closest('[data-board-refresh]');
    if (boardRefreshButton) {
      await loadBoard().catch((error) => showToast(error.message));
      return;
    }

    const threadTemplateButton = event.target.closest('[data-thread-template]');
    if (threadTemplateButton) {
      insertThreadTemplate(threadTemplateButton.dataset.threadTemplate);
      return;
    }

    const threadTemplateDismissButton = event.target.closest('[data-thread-template-dismiss]');
    if (threadTemplateDismissButton) {
      dismissThreadTemplate();
      return;
    }

    const removeSavedSearchButton = event.target.closest('[data-remove-saved-search]');
    if (removeSavedSearchButton) {
      removeSavedSearch(removeSavedSearchButton.dataset.removeSavedSearch);
      return;
    }

    const addContentFilterButton = event.target.closest('[data-add-content-filter]');
    if (addContentFilterButton) {
      const form = addContentFilterButton.closest('.content-filter-form');
      const type = form?.querySelector('[data-content-filter-type]')?.value || 'keyword';
      const value = form?.querySelector('[data-content-filter-value]')?.value.trim() || '';
      const boardSlug = form?.querySelector('[data-content-filter-board]')?.value || '';
      if (!value) {
        showToast('Nhập giá trị bộ lọc trước.');
        return;
      }
      addContentFilter({ type, value, boardSlug });
      renderAccountPrivateData();
      showToast('Đã thêm bộ lọc nội dung.');
      return;
    }

    const removeContentFilterButton = event.target.closest('[data-remove-content-filter]');
    if (removeContentFilterButton) {
      removeContentFilter(removeContentFilterButton.dataset.removeContentFilter);
      renderAccountPrivateData();
      showToast('Đã xóa bộ lọc nội dung.');
      return;
    }

    const addReplyTemplateButton = event.target.closest('[data-add-reply-template]');
    if (addReplyTemplateButton) {
      const form = addReplyTemplateButton.closest('.reply-template-form');
      const title = form?.querySelector('[data-reply-template-title]')?.value.trim() || '';
      const body = form?.querySelector('[data-reply-template-body]')?.value.trim() || '';
      const boardSlug = form?.querySelector('[data-reply-template-board]')?.value || '';
      if (!body) {
        showToast('Nhập nội dung mẫu trước.');
        return;
      }
      addReplyTemplate({ title: title || body.slice(0, 40), body, boardSlug });
      renderAccountPrivateData();
      showToast('Đã thêm mẫu trả lời.');
      return;
    }

    const removeReplyTemplateButton = event.target.closest('[data-remove-reply-template]');
    if (removeReplyTemplateButton) {
      removeReplyTemplate(removeReplyTemplateButton.dataset.removeReplyTemplate);
      renderAccountPrivateData();
      showToast('Đã xóa mẫu trả lời.');
      return;
    }

    const addPosterNoteButton = event.target.closest('[data-add-poster-note]');
    if (addPosterNoteButton) {
      const form = addPosterNoteButton.closest('.poster-note-form');
      const posterId = form?.querySelector('[data-poster-note-id]')?.value.trim() || '';
      const label = form?.querySelector('[data-poster-note-label]')?.value.trim() || '';
      const note = form?.querySelector('[data-poster-note-text]')?.value.trim() || '';
      const boardSlug = form?.querySelector('[data-poster-note-board]')?.value || '';
      if (!posterId) {
        showToast('Nhập Poster ID trước.');
        return;
      }
      addPosterNote({ posterId, label, note, boardSlug });
      renderAccountPrivateData();
      showToast('Đã thêm ghi chú Poster ID.');
      return;
    }

    const removePosterNoteButton = event.target.closest('[data-remove-poster-note]');
    if (removePosterNoteButton) {
      removePosterNote(removePosterNoteButton.dataset.removePosterNote);
      renderAccountPrivateData();
      showToast('Đã xóa ghi chú Poster ID.');
      return;
    }

    const clearAccountPrivateButton = event.target.closest('[data-clear-account-private]');
    if (clearAccountPrivateButton) {
      const section = clearAccountPrivateButton.dataset.clearAccountPrivate;
      await clearAccountPrivateData(section).catch((error) => showToast(error.message));
      showToast(section ? 'Đã xóa mục dữ liệu riêng.' : 'Đã xóa toàn bộ dữ liệu riêng.');
      return;
    }

    const addPasskeyBtn = event.target.closest('#addPasskeyButton');
    if (addPasskeyBtn) {
      await addPasskey();
      return;
    }

    const loginPasskeyBtn = event.target.closest('#loginPasskeyButton');
    if (loginPasskeyBtn) {
      await loginWithPasskey();
      return;
    }

    const adminLoginPasskeyBtn = event.target.closest('#adminLoginPasskeyButton');
    if (adminLoginPasskeyBtn) {
      await loginAdminWithPasskey();
      return;
    }

    const adminAddPasskeyBtn = event.target.closest('#adminAddPasskeyButton');
    if (adminAddPasskeyBtn) {
      await addAdminPasskey();
      return;
    }

    const deletePasskeyBtn = event.target.closest('[data-delete-passkey]');
    if (deletePasskeyBtn) {
      const credentialId = deletePasskeyBtn.dataset.deletePasskey;
      const ok = window.confirm('Bạn chắc chắn muốn xóa thiết bị xác thực này?');
      if (ok) {
        try {
          await api(`/api/account/passkeys/${encodeURIComponent(credentialId)}`, {
            auth: 'account',
            method: 'DELETE'
          });
          showToast('Đã xóa Passkey.');
          await renderPasskeys();
        } catch (error) {
          showToast(`Lỗi khi xóa Passkey: ${error.message}`);
        }
      }
      return;
    }

    const deleteAdminPasskeyBtn = event.target.closest('[data-delete-admin-passkey]');
    if (deleteAdminPasskeyBtn) {
      const credentialId = deleteAdminPasskeyBtn.dataset.deleteAdminPasskey;
      const ok = window.confirm('Bạn chắc chắn muốn xóa thiết bị xác thực này?');
      if (ok) {
        try {
          await api(`/api/account/passkeys/${encodeURIComponent(credentialId)}`, {
            auth: 'admin',
            method: 'DELETE'
          });
          showToast('Đã xóa Passkey.');
          await renderAdminPasskeys();
        } catch (error) {
          showToast(`Lỗi khi xóa Passkey: ${error.message}`);
        }
      }
      return;
    }

    const boardSubscriptionButton = event.target.closest('[data-toggle-board-subscription]');
    if (boardSubscriptionButton) {
      await toggleBoardSubscription();
      syncBoardSubscriptionButtons();
      return;
    }

    const catalogRefreshButton = event.target.closest('[data-catalog-refresh]');
    if (catalogRefreshButton) {
      await loadCatalog().catch((error) => showToast(error.message));
      return;
    }

    const catalogSortButton = event.target.closest('[data-catalog-sort]');
    if (catalogSortButton) {
      state.catalogSort = normalizeCatalogSort(catalogSortButton.dataset.catalogSort);
      renderCatalogThreads(state.catalogThreads);
      return;
    }

    const boardSortButton = event.target.closest('[data-board-sort]');
    if (boardSortButton) {
      state.boardSort = normalizeBoardSort(boardSortButton.dataset.boardSort);
      state.boardPage = 1;
      await loadBoard().catch((error) => showToast(error.message));
      return;
    }

    const boardFilterButton = event.target.closest('[data-board-filter]');
    if (boardFilterButton) {
      state.boardFilter = normalizeBoardFilter(boardFilterButton.dataset.boardFilter);
      state.boardPage = 1;
      await loadBoard().catch((error) => showToast(error.message));
      return;
    }

    const catalogFilterButton = event.target.closest('[data-catalog-filter]');
    if (catalogFilterButton) {
      state.catalogFilter = catalogFilterButton.dataset.catalogFilter;
      renderCatalogThreads(state.catalogThreads);
      return;
    }

    const catalogSizeButton = event.target.closest('[data-catalog-size]');
    if (catalogSizeButton) {
      state.catalogImageSize = catalogSizeButton.dataset.catalogSize;
      renderCatalogThreads(state.catalogThreads);
      return;
    }

    const archiveRefreshButton = event.target.closest('[data-archive-refresh]');
    if (archiveRefreshButton) {
      await loadArchive().catch((error) => showToast(error.message));
      return;
    }

    const replyLink = event.target.closest('[data-open-reply]');
    if (replyLink) {
      openReplyComposer();
      els.replyComposer.scrollIntoView({ block: 'center' });
      return;
    }

    const pageTopButton = event.target.closest('[data-scroll-page-top]');
    if (pageTopButton) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const pageButton = event.target.closest('[data-page-action]');
    if (pageButton && !pageButton.disabled) {
      const nextPage = Math.max(1, Number(pageButton.dataset.page) || 1);
      if (pageButton.dataset.pageAction === 'board') {
        state.boardPage = nextPage;
        await loadBoard().catch((error) => showToast(error.message));
      } else if (pageButton.dataset.pageAction === 'thread-comments') {
        state.threadCommentPage = nextPage;
        await loadThread().catch((error) => showToast(error.message));
      }
      return;
    }

    const hideThreadButton = event.target.closest('[data-hide-thread]');
    if (hideThreadButton) {
      addLocalSetItem(hiddenThreadsKey, hideThreadButton.dataset.hideThread);
      renderBoardThreads(state.boardThreads);
      showToast('Đã ẩn chủ đề trên trình duyệt này.');
      return;
    }

    const hidePostButton = event.target.closest('[data-hide-post]');
    if (hidePostButton) {
      addLocalSetItem(hiddenPostsKey, hidePostButton.dataset.hidePost);
      const onThreadScreen = (window.location.hash || '').startsWith('#thread/') && state.threadId;
      if (onThreadScreen) {
        await loadThread().catch((error) => showToast(error.message));
      } else {
        hidePostButton.closest('article.post')?.remove();
      }
      showToast('Đã ẩn bài trên trình duyệt này.');
      return;
    }

    const translatePostButton = event.target.closest('[data-translate-post]');
    if (translatePostButton) {
      await translatePost(translatePostButton);
      return;
    }

    const ttsPostButton = event.target.closest('[data-tts-post]');
    if (ttsPostButton) {
      await speakPost(ttsPostButton);
      return;
    }

    const copyPostLinkButton = event.target.closest('[data-copy-post-link]');
    if (copyPostLinkButton) {
      await copyPostPermalink(copyPostLinkButton.dataset.copyPostLink);
      return;
    }

    const collapsePostButton = event.target.closest('[data-collapse-post]');
    if (collapsePostButton) {
      const post = collapsePostButton.closest('article.post');
      const collapsed = !post?.classList.contains('post-collapsed');
      setPostCollapsed(post, collapsed);
      syncThreadPostCollapseToolbarState();
      return;
    }

    const collapseThreadPostsButton = event.target.closest('[data-thread-collapse-posts]');
    if (collapseThreadPostsButton) {
      const collapsed = toggleAllThreadPostsCollapsed();
      showToast(collapsed ? 'Đã thu toàn bộ bài trong thread.' : 'Đã mở toàn bộ bài trong thread.');
      return;
    }

    const scrollButton = event.target.closest('[data-scroll-thread]');
    if (scrollButton) {
      const target = scrollButton.dataset.scrollThread === 'bottom' ? els.threadToolbarBottom : els.threadScreen;
      target.scrollIntoView({ block: scrollButton.dataset.scrollThread === 'bottom' ? 'end' : 'start' });
      return;
    }

    const quoteButton = event.target.closest('[data-quote]');
    if (quoteButton) {
      const quote = quoteButton.dataset.quote;
      const selectedQuote = selectedPostQuoteText(quoteButton.closest('.post'));
      const quoteBlock = selectedQuote ? `${quote}\n${selectedQuote}\n` : `${quote}\n`;
      openReplyComposer({ focus: false });
      const spacer = els.commentBody.value && !els.commentBody.value.endsWith('\n') ? '\n' : '';
      els.commentBody.value = `${els.commentBody.value}${spacer}${quoteBlock}`;
      updatePrivacyWarning(els.commentBody.value, els.commentPrivacyWarning);
      els.commentBody.focus();
      return;
    }

    const spoilerText = event.target.closest('.spoiler-text');
    if (spoilerText && !spoilerText.classList.contains('revealed')) {
      spoilerText.classList.add('revealed');
      return;
    }

    const ref = event.target.closest('.ref-link');
    if (ref) {
      // Cross-board refs without a post number are plain anchors; let the
      // browser navigate to the board instead of fetching a post preview.
      if (ref.dataset.ref) {
        await showReference(ref.dataset.ref, event);
      }
      return;
    }
    if (!event.target.closest('.ref-preview')) {
      hideReferencePreview();
    }

    const suggestion = event.target.closest('[data-suggestion]');
    if (suggestion) {
      els.commentBody.value = decodeURIComponent(suggestion.dataset.suggestion);
      updatePrivacyWarning(els.commentBody.value, els.commentPrivacyWarning);
      els.commentBody.focus();
      return;
    }

    const pollOption = event.target.closest('[data-poll-option]');
    if (pollOption) {
      try {
        await api(`/api/threads/${state.threadId}/poll`, {
          method: 'POST',
          body: JSON.stringify({ optionId: pollOption.dataset.pollOption, posterToken: state.posterToken })
        });
        showToast('Đã vote thăm dò.');
        await loadThread();
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const reactionButton = event.target.closest('[data-reaction]');
    if (reactionButton) {
      const globalNumber = reactionButton.dataset.reactionTarget;
      const reaction = reactionButton.dataset.reaction;
      try {
        await api(`/api/posts/${globalNumber}/reactions`, {
          auth: state.accountToken ? 'account' : 'none',
          method: 'POST',
          body: JSON.stringify({ reaction, posterToken: state.posterToken })
        });
        if (state.screen === 'thread') {
          await loadThread();
        } else if (state.screen === 'board') {
          await loadBoard();
        } else {
          await loadHome();
        }
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const voteButton = event.target.closest('[data-vote]');
    if (voteButton) {
      const globalNumber = voteButton.dataset.voteTarget;
      const direction = voteButton.dataset.vote;
      if (!state.accountToken) {
        showToast('Vui lòng đăng nhập tài khoản để vote.');
        return;
      }
      try {
        const result = await api(`/api/posts/${globalNumber}/vote`, {
          auth: 'account',
          method: 'POST',
          body: JSON.stringify({ direction, posterToken: state.posterToken })
        });
        writeVote(globalNumber, result.myVote || '');
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const reportButton = event.target.closest('[data-report]');
    if (reportButton) {
      const report = await showReportModal(reportButton.dataset.report);
      if (!report) {
        return;
      }
      try {
        await api(`/api/posts/${reportButton.dataset.report}`, {
          method: 'POST',
          body: JSON.stringify({ ...report, posterToken: state.posterToken })
        });
        showToast('Đã gửi báo cáo.');
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const adminTabButton = event.target.closest('[data-admin-tab]');
    if (adminTabButton) {
      state.adminTab = adminTabButton.dataset.adminTab;
      await loadAdmin();
      return;
    }

    if (event.target.closest('#adminRefresh')) {
      await loadAdmin();
      return;
    }

    if (event.target.closest('#adminExport')) {
      exportAdminCsv();
      return;
    }

    if (event.target.closest('#adminSaveModerationSettings')) {
      await saveAdminModerationSettings();
      return;
    }

    const adminBoardCreateButton = event.target.closest('[data-admin-board-create]');
    if (adminBoardCreateButton) {
      const form = adminBoardCreateButton.closest('[data-admin-board-create-form]');
      const restore = setButtonLoading(adminBoardCreateButton, 'Đang tạo...');
      try {
        await api('/api/admin/boards', {
          method: 'POST',
          body: JSON.stringify(adminBoardPayload(form, { includeSlug: true }))
        });
        showToast('Đã tạo board.');
        await refreshPublicBoards();
        await loadAdmin();
      } catch (error) {
        showToast(error.message);
      } finally {
        restore();
      }
      return;
    }

    const adminBoardSaveButton = event.target.closest('[data-admin-board-save]');
    if (adminBoardSaveButton) {
      const row = adminBoardSaveButton.closest('[data-admin-board-row]');
      const slug = row?.dataset.adminBoardRow;
      if (!slug) {
        return;
      }
      const restore = setButtonLoading(adminBoardSaveButton, 'Đang lưu...');
      try {
        await api(`/api/admin/boards/${encodeURIComponent(slug)}`, {
          method: 'PUT',
          body: JSON.stringify(adminBoardPayload(row))
        });
        showToast('Đã lưu board.');
        await refreshPublicBoards();
        await loadAdmin();
      } catch (error) {
        showToast(error.message);
      } finally {
        restore();
      }
      return;
    }

    const adminBoardDeleteButton = event.target.closest('[data-admin-board-delete]');
    if (adminBoardDeleteButton) {
      const row = adminBoardDeleteButton.closest('[data-admin-board-row]');
      const slug = row?.dataset.adminBoardRow;
      if (!slug || !window.confirm(`Xóa board /${slug}/? Chỉ board rỗng mới xóa được.`)) {
        return;
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
        restore();
      }
      return;
    }

    const adminUserCreateButton = event.target.closest('[data-admin-user-create]');
    if (adminUserCreateButton) {
      const form = adminUserCreateButton.closest('[data-admin-user-create-form]');
      try {
        await api('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify(adminUserPayload(form, { includeUsername: true }))
        });
        showToast('Đã tạo tài khoản quản trị.');
        await loadAdmin();
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const adminUserSaveButton = event.target.closest('[data-admin-user-save]');
    if (adminUserSaveButton) {
      const row = adminUserSaveButton.closest('[data-admin-user-row]');
      const id = row?.dataset.adminUserRow;
      if (!id) {
        return;
      }
      try {
        await api(`/api/admin/users/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(adminUserPayload(row))
        });
        showToast('Đã lưu tài khoản quản trị.');
        await loadAdmin();
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const adminUserDisableButton = event.target.closest('[data-admin-user-disable]');
    if (adminUserDisableButton) {
      const row = adminUserDisableButton.closest('[data-admin-user-row]');
      const id = row?.dataset.adminUserRow;
      const username = row?.querySelector('strong')?.textContent || 'tài khoản này';
      if (!id || !window.confirm(`Vô hiệu hóa ${username}?`)) {
        return;
      }
      try {
        await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
        showToast('Đã vô hiệu hóa tài khoản quản trị.');
        await loadAdmin();
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    if (event.target.closest('#adminBulkApprove')) {
      await bulkModerate('approve');
      return;
    }

    if (event.target.closest('#adminBulkDelete')) {
      await bulkModerate('delete');
      return;
    }

    const appealResolveButton = event.target.closest('[data-admin-resolve-appeal]');
    if (appealResolveButton) {
      const status = appealResolveButton.dataset.status === 'accepted' ? 'accepted' : 'rejected';
      const reason = await showReasonModal(
        status === 'accepted' ? 'Lý do chấp nhận kháng nghị:' : 'Lý do từ chối kháng nghị:',
        status === 'accepted' ? 'appeal-accept' : 'appeal-reject'
      );
      if (reason === null) {
        return;
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
      return;
    }

    const adminDetailButton = event.target.closest('[data-admin-detail]');
    if (adminDetailButton) {
      const host = adminDetailButton.closest('.pending-item') || adminDetailButton.closest('.moderation-log') || els.pendingList;
      try {
        await loadAdminDetail(adminDetailButton.dataset.adminDetail, host);
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const adminReportsSummaryButton = event.target.closest('[data-admin-reports-summary]');
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
      return;
    }

    const boardDigestButton = event.target.closest('[data-board-digest]');
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
      return;
    }

    const adminNoteButton = event.target.closest('[data-admin-note]');
    if (adminNoteButton) {
      const note = window.prompt(`Ghi chú nội bộ cho No.${adminNoteButton.dataset.adminNote}:`, '') || '';
      if (!note) {
        return;
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
      return;
    }

    const adminEditPostButton = event.target.closest('[data-admin-edit-post]');
    if (adminEditPostButton) {
      const globalNumber = adminEditPostButton.dataset.adminEditPost;
      const currentBody = decodeURIComponent(adminEditPostButton.dataset.adminEditBody || '');
      const edit = await showPostEditModal(globalNumber, currentBody);
      if (!edit) {
        return;
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
      return;
    }

    const adminRestorePostButton = event.target.closest('[data-admin-restore-post]');
    if (adminRestorePostButton) {
      const globalNumber = adminRestorePostButton.dataset.adminRestorePost;
      const reason = await showReasonModal(`Lý do khôi phục bài No.${globalNumber}:`, 'restore');
      if (reason === null) {
        return;
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
      return;
    }

    const adminDeletePostButton = event.target.closest('[data-admin-delete-post]');
    if (adminDeletePostButton) {
      const globalNumber = adminDeletePostButton.dataset.adminDeletePost;
      const fileOnly = adminDeletePostButton.dataset.fileOnly === 'true';
      const reason = await showReasonModal(
        fileOnly ? `Lý do xóa tệp của No.${globalNumber}:` : `Lý do xóa bài No.${globalNumber}:`,
        'delete'
      );
      if (reason === null) {
        return;
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
      return;
    }

    const adminStickyButton = event.target.closest('[data-admin-sticky-thread]');
    if (adminStickyButton) {
      const threadId = adminStickyButton.dataset.adminStickyThread;
      const nextSticky = adminStickyButton.dataset.stickyNext === 'true';
      const ok = window.confirm(nextSticky ? 'Ghim chủ đề này lên đầu board?' : 'Gỡ ghim chủ đề này?');
      if (!ok) {
        return;
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
      return;
    }

    const adminLockButton = event.target.closest('[data-admin-lock-thread]');
    if (adminLockButton) {
      const threadId = adminLockButton.dataset.adminLockThread;
      const nextLocked = adminLockButton.dataset.lockNext === 'true';
      const ok = window.confirm(nextLocked ? 'Khóa chủ đề này? Người dùng sẽ không thể trả lời.' : 'Mở khóa chủ đề này?');
      if (!ok) {
        return;
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
      return;
    }

    const adminSanctionButton = event.target.closest('[data-admin-sanction]');
    if (adminSanctionButton) {
      const kind = adminSanctionButton.dataset.adminSanction;
      const globalNumber = adminSanctionButton.dataset.globalNumber;
      const defaultMinutes = kind === 'ban' ? '1440' : '60';
      const durationMinutes = window.prompt(
        kind === 'ban' ? 'Tạm khóa trong bao nhiêu phút?' : 'Làm chậm trong bao nhiêu phút?',
        defaultMinutes
      );
      if (!durationMinutes) {
        return;
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
      return;
    }

    const revokeSanctionButton = event.target.closest('[data-admin-revoke-sanction]');
    if (revokeSanctionButton) {
      const reason = await showReasonModal('Lý do gỡ lệnh làm chậm/tạm khóa:', 'revoke');
      if (reason === null) {
        return;
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
      return;
    }

    const pendingButton = event.target.closest('[data-action]');
    if (pendingButton) {
      const item = pendingButton.closest('.pending-item');
      const action = pendingButton.dataset.action;
      const reason = await showReasonModal(
        action === 'approve' ? 'Lý do duyệt bài:' : 'Lý do xóa bài:',
        action === 'approve' ? 'approve' : 'delete'
      );
      if (reason === null) {
        return;
      }
      try {
        await api(
          action === 'approve'
            ? `/api/admin/pending/${item.dataset.id}/approve`
            : `/api/admin/pending/${item.dataset.id}`,
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
    }
  });

  document.body.addEventListener('change', (event) => {
    const autoUpdate = event.target.closest('[data-auto-update]');
    if (autoUpdate) {
      setAutoUpdate(autoUpdate.checked);
    }

    if (event.target.closest('#adminBoardFilter, #adminLabelFilter, #adminReportCategoryFilter, #adminTimeFilter, #adminPriorityFilter, #adminConfidenceFilter, #adminPrioritySort')) {
      loadAdmin().catch((error) => showToast(error.message));
    }

    if (event.target.closest('#adminSelectAll')) {
      document.querySelectorAll('[data-admin-select]').forEach((input) => {
        input.checked = els.adminSelectAll.checked;
      });
    }

    const themeSelect = event.target.closest('[data-theme-select]');
    if (themeSelect) {
      applyTheme(themeSelect.value);
      persistAccountSettings({ silent: true });
    }

    const commentSort = event.target.closest('[data-comment-sort]');
    if (commentSort) {
      state.commentsSort = commentSort.value;
      state.threadCommentPage = 1;
      loadThread().catch((error) => showToast(error.message));
    }

    const watchedSortSelect = event.target.closest('#watchedSortSelect');
    if (watchedSortSelect) {
      applyDisplayPreferences({
        ...localDisplayPreferences(),
        watchedSort: normalizeWatchedSort(watchedSortSelect.value)
      });
      renderWatchedThreads();
      persistAccountSettings({ silent: true });
      showToast('Đã đổi cách sắp xếp watchlist.');
    }
  });

  els.registerForm.addEventListener('submit', submitAccountRegister);
  els.registerRecoveryContinue?.addEventListener('click', () => {
    window.location.hash = '#account';
  });
  els.registerRecoveryCopy?.addEventListener('click', () => copyToClipboard(els.registerRecoveryCode.textContent || ''));
  els.accountLoginForm.addEventListener('submit', submitAccountLogin);
  els.forgotPasswordForm?.addEventListener('submit', submitForgotPassword);
  els.forgotRecoveryCopy?.addEventListener('click', () => copyToClipboard(els.forgotNewRecoveryCode.textContent || ''));
  els.recoveryCodeForm?.addEventListener('submit', submitRecoveryCodeRegen);
  els.recoveryCodeCopy?.addEventListener('click', () => copyToClipboard(els.recoveryCodeResultValue.textContent || ''));
  els.account2FAVerifyForm?.addEventListener('submit', submitAccount2FAVerify);
  els.accountSettingsForm.addEventListener('submit', submitAccountSettings);
  els.accountLogoutButton.addEventListener('click', () => logoutAccount());
  els.accountSettingsLogout.addEventListener('click', () => logoutAccount());
  els.enable2FAButton?.addEventListener('click', start2FASetup);
  els.verify2FASetupButton?.addEventListener('click', verify2FASetup);
  els.cancel2FASetupButton?.addEventListener('click', render2FAState);
  els.disable2FAButton?.addEventListener('click', disable2FA);
  els.useBackupCodeLink?.addEventListener('click', () => {
    els.backupCodeInputSection.classList.remove('hidden');
    els.loginBackupCode.focus();
  });
  els.submitBackupCodeButton?.addEventListener('click', submitBackupCodeLogin);
  els.useTotpLink?.addEventListener('click', () => {
    els.backupCodeInputSection.classList.add('hidden');
    els.loginBackupCode.value = '';
    els.login2FACode.focus();
  });

  els.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          username: els.adminUsername.value,
          password: els.adminPassword.value
        })
      });
      els.adminPassword.value = '';
      if (result.requires2FA) {
        state.adminTemp2FAToken = result.tempToken;
        els.loginForm.classList.add('hidden');
        els.admin2FAVerifyForm?.classList.remove('hidden');
        els.admin2FACode.value = '';
        els.admin2FACode.focus();
        showToast('Vui lòng nhập mã 2FA để hoàn tất đăng nhập quản trị.');
        return;
      }
      state.token = result.token;
      localStorage.setItem('adminToken', state.token);
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.admin2FAVerifyForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError(els.admin2FAVerifyError);
    try {
      const code = (els.admin2FACode.value || '').trim();
      if (!code) {
        throw new Error('Vui lòng nhập mã 2FA.');
      }
      const result = await api('/api/auth/2fa/verify', {
        auth: 'none',
        method: 'POST',
        body: JSON.stringify({ tempToken: state.adminTemp2FAToken, code })
      });
      state.adminTemp2FAToken = null;
      state.token = result.token;
      localStorage.setItem('adminToken', state.token);
      els.admin2FAVerifyForm.classList.add('hidden');
      showToast('Xác thực 2FA thành công.');
      await loadAdmin();
    } catch (error) {
      setFormError(els.admin2FAVerifyError, error.message);
    }
  });

  els.admin2FACancelButton?.addEventListener('click', () => {
    state.adminTemp2FAToken = null;
    els.admin2FAVerifyForm?.classList.add('hidden');
    els.loginForm.classList.remove('hidden');
  });

  els.adminStart2FAButton?.addEventListener('click', async () => {
    try {
      const data = await api('/api/account/2fa/setup', { auth: 'admin', method: 'POST' });
      els.admin2FAQRImage.src = data.qrCodeUrl;
      els.admin2FABackupCodes.value = data.backupCodes.join('\n');
      els.admin2FASetupStart.classList.add('hidden');
      els.admin2FASetupQR.classList.remove('hidden');
      els.admin2FASetupCode.value = '';
      els.admin2FASetupCode.focus();
    } catch (error) {
      showToast(`Lỗi thiết lập 2FA: ${error.message}`);
    }
  });

  els.adminVerify2FASetupButton?.addEventListener('click', async () => {
    const code = (els.admin2FASetupCode.value || '').trim();
    if (!code) {
      showToast('Vui lòng nhập mã 2FA để xác nhận.');
      return;
    }
    try {
      await api('/api/account/2fa/verify', {
        auth: 'admin',
        method: 'POST',
        body: JSON.stringify({ code })
      });
      showToast('Kích hoạt 2FA thành công! Vui lòng đăng nhập lại với mã 2FA.');
      state.token = '';
      localStorage.removeItem('adminToken');
      els.admin2FASetupPanel?.classList.add('hidden');
      loadAdmin();
    } catch (error) {
      showToast(`Kích hoạt 2FA thất bại: ${error.message}`);
    }
  });

  els.logoutButton.addEventListener('click', () => {
    state.token = '';
    localStorage.removeItem('adminToken');
    loadAdmin();
  });
}

async function init() {
  bindEvents();
  syncDeletePasswordInputs();
  applyTheme();
  applyDisplayPreferences();
  applyNotificationPreferences();
  const config = await api('/api/config');
  state.boards = config.boards;
  state.boardGroups = config.boardGroups || [];
  state.lifecycle = config.lifecycle || state.lifecycle;
  state.aiConfigured = Boolean(config.ai?.configured);
  state.moderationConfidenceThreshold = Number(config.ai?.moderationConfidenceThreshold || 0);
  syncAdminModerationSettings({ moderationConfidenceThreshold: state.moderationConfidenceThreshold });
  state.hcaptchaSiteKey = config.hcaptchaSiteKey || '';
  await refreshPublicBoards({ fallbackBoards: config.boards });
  setupHcaptcha().catch((error) => showToast(error.message));
  syncAccountHomeBoardOptions();
  await loadAccountSession();
  syncAdminBoardFilter();
  route();
}

init().catch((error) => showToast(error.message));
