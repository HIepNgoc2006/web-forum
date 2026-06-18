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
  threadGlobalNumber: '',
  threadPosterHash: '',
  threadLastSeenBefore: 0,
  threadCurrentMaxNumber: 0,
  token: localStorage.getItem('adminToken') || '',
  accountToken: localStorage.getItem('accountToken') || '',
  account: null,
  temp2FAToken: null,
  adminTemp2FAToken: null,
  accountPrivateData: null,
  accountPrivateSaveTimer: null,
  posterToken: getPosterToken(),
  selectedImage: null,
  quickReplyDrag: null,
  replyComposerOpen: false,
  threadIsArchived: false,
  threadIsLocked: false,
  boardPage: 1,
  boardPageSize: 15,
  boardSearchTerm: '',
  boardPageMeta: null,
  threadCommentPage: 1,
  threadCommentPageSize: 50,
  threadCommentPageMeta: null,
  autoUpdate: true,
  autoCountdown: 7,
  autoTimer: null,
  realtimeSource: null,
  realtimeContextKey: '',
  boardThreads: [],
  catalogThreads: [],
  catalogSort: 'bump',
  catalogImageSize: 'small',
  catalogFilter: 'all',
  theme: localStorage.getItem('theme') || 'yotsuba-b',
  archiveThreads: [],
  adminTab: 'pending',
  adminItems: []
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

function showReasonModal(title, context) {
  return new Promise((resolve) => {
    const macros = REASON_MACROS[context] || REASON_MACROS.approve;
    const overlay = document.createElement('div');
    overlay.className = 'reason-modal-overlay';
    overlay.innerHTML = `
      <div class="reason-modal">
        <div class="reason-modal-title">${title}</div>
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

    select.addEventListener('change', () => {
      const index = select.value;
      if (index !== '') {
        textarea.value = macros[Number(index)];
      } else {
        textarea.value = '';
      }
      textarea.focus();
    });

    function cleanup() {
      overlay.remove();
    }

    confirmBtn.addEventListener('click', () => {
      const value = textarea.value.trim();
      cleanup();
      resolve(value);
    });

    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        cleanup();
        resolve(null);
      }
    });

    textarea.focus();
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
const myPostsKey = 'myPosts';
const hiddenThreadsKey = 'hiddenThreads';
const hiddenPostsKey = 'hiddenPosts';
const deletePasswordKey = 'deletePassword';
const subscribedBoardsKey = 'subscribedBoards';
const themeKey = 'theme';
const homeBoardKey = 'homeBoard';
const displayPreferencesKey = 'displayPreferences';
const notificationPreferencesKey = 'notificationPreferences';
const aiNotConfiguredMessage =
  'Chưa cấu hình Google AI Studio. Thêm GOOGLE_AI_API_KEY vào backend/.env để dùng tính năng AI này.';

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
  return Array.isArray(readJsonLocal(key, [])) ? readJsonLocal(key, []) : [];
}

function localDisplayPreferences() {
  const value = readJsonLocal(displayPreferencesKey, {});
  return {
    compactThreads: Boolean(value.compactThreads),
    hideThumbnails: Boolean(value.hideThumbnails)
  };
}

function writeLocalDisplayPreferences(preferences = {}) {
  const safe = {
    compactThreads: Boolean(preferences.compactThreads),
    hideThumbnails: Boolean(preferences.hideThumbnails)
  };
  writeJsonLocal(displayPreferencesKey, safe);
  return safe;
}

function localNotificationPreferences() {
  const value = readJsonLocal(notificationPreferencesKey, {});
  return {
    email: Boolean(value.email),
    watchedThreads: value.watchedThreads !== false,
    boardSubscriptions: Boolean(value.boardSubscriptions)
  };
}

function writeLocalNotificationPreferences(preferences = {}) {
  const safe = {
    email: Boolean(preferences.email),
    watchedThreads: preferences.watchedThreads !== false,
    boardSubscriptions: Boolean(preferences.boardSubscriptions)
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

function draftKey(kind, id) {
  return `draft:${kind}:${id}`;
}

function defaultAccountPrivateData() {
  return {
    watchlist: [],
    drafts: [],
    savedSearches: []
  };
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

function myPosts() {
  return readLocalList(myPostsKey).filter((item) => item && typeof item === 'object');
}

function rememberMyPost(post, type) {
  if (!post?.globalNumber) {
    return;
  }
  const items = myPosts().filter((item) => Number(item.globalNumber) !== Number(post.globalNumber));
  items.unshift({
    type,
    threadId: post.threadId || post.id || state.threadId,
    boardSlug: post.boardSlug || state.boardSlug,
    globalNumber: post.globalNumber,
    preview: plainPreview(post.bodyLines, post.body || 'Không có nội dung').slice(0, 160),
    createdAt: post.createdAt || new Date().toISOString()
  });
  writeJsonLocal(myPostsKey, items.slice(0, 50));
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
  const safeTheme = ['yotsuba-b', 'yotsuba', 'tomorrow'].includes(theme) ? theme : 'yotsuba-b';
  state.theme = safeTheme;
  document.body.classList.remove('theme-yotsuba-b', 'theme-yotsuba', 'theme-tomorrow');
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
  return safe;
}

const els = {
  homeScreen: document.querySelector('#homeScreen'),
  policyScreen: document.querySelector('#policyScreen'),
  homeBoards: document.querySelector('#homeBoards'),
  homeBoardSearchForm: document.querySelector('#homeBoardSearchForm'),
  homeBoardSearchInput: document.querySelector('#homeBoardSearchInput'),
  popularThreads: document.querySelector('#popularThreads'),
  latestPosts: document.querySelector('#latestPosts'),
  watchedThreads: document.querySelector('#watchedThreads'),
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
  boardCatalogLinkBottom: document.querySelector('#boardCatalogLinkBottom'),
  boardArchiveLinkBottom: document.querySelector('#boardArchiveLinkBottom'),
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
  threadCaptcha: document.querySelector('#threadCaptcha'),
  imagePreview: document.querySelector('#imagePreview'),
  refreshThreads: document.querySelector('#refreshThreads'),
  boardSummaryButton: document.querySelector('#boardSummaryButton'),
  boardSummary: document.querySelector('#boardSummary'),
  backToBoard: document.querySelector('#backToBoard'),
  threadTitle: document.querySelector('#threadTitle'),
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
  adminTimeFilter: document.querySelector('#adminTimeFilter'),
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
  accountEmailNotifications: document.querySelector('#accountEmailNotifications'),
  accountNotifyWatchedThreads: document.querySelector('#accountNotifyWatchedThreads'),
  accountNotifyBoardSubscriptions: document.querySelector('#accountNotifyBoardSubscriptions'),
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
  quickReplyCaptchaButton: document.querySelector('#quickReplyCaptchaButton'),
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
    const existing = document.querySelector('script[data-hcaptcha-script]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.hcaptchaScript = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', reject, { once: true });
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
      : []
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
  const drafts = accountDraftSyncEnabled()
    ? mergeByKey([...(serverData.drafts || []), ...localDraftEntries()], (item) => item.key)
    : serverData.drafts || [];
  return normalizeAccountPrivateData({
    watchlist: mergeByKey([...(serverData.watchlist || []), ...localWatchlist], (item) => item.threadId),
    drafts,
    savedSearches: mergeByKey(
      [...(serverData.savedSearches || []), ...localSearches],
      (item) => `${item.boardSlug}:${item.query}`
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
  return payload && payload.role === 'admin' ? payload.username || '' : '';
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
}

function logoutAccount({ message = 'Đã đăng xuất tài khoản.' } = {}) {
  setAccountSession();
  if (message) {
    showToast(message);
  }
  if (['#account', '#login', '#register'].some((prefix) => (window.location.hash || '').startsWith(prefix))) {
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
    ? `Đang đăng nhập @${account.username}. Account không thay thế Anonymous trên bài public.`
    : 'Chưa đăng nhập. Settings bên dưới chỉ lưu trên trình duyệt này.';
  els.accountSettingsForm.classList.remove('hidden');
  els.accountLoggedOut.classList.toggle('hidden', Boolean(account));
  els.accountSettingsLogout.classList.toggle('hidden', !account);
  els.accountTheme.value = settings.theme || state.theme || 'yotsuba-b';
  els.accountHomeBoard.value = settings.homeBoard || localStorage.getItem(homeBoardKey) || state.boardSlug || 'confession';
  els.accountSyncDrafts.checked = settings.syncDrafts !== false;
  els.accountCompactThreads.checked = Boolean(displayPreferences.compactThreads);
  els.accountHideThumbnails.checked = Boolean(displayPreferences.hideThumbnails);
  els.accountEmailNotifications.checked = Boolean(notificationPreferences.email ?? settings.emailNotifications);
  els.accountNotifyWatchedThreads.checked = notificationPreferences.watchedThreads !== false;
  els.accountNotifyBoardSubscriptions.checked = Boolean(notificationPreferences.boardSubscriptions);
  syncAccountBoardSubscriptionOptions(settings);
  renderAccountPrivateData();
  render2FAState();
  renderPasskeys();
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

    setAccountSession({ token: result.token, account: result.account });
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

function renderAccountPrivateData() {
  if (!els.accountPrivateDataPanel || !els.accountPrivateDataSummary) {
    return;
  }
  const loggedIn = Boolean(state.accountToken && state.account);
  els.accountPrivateDataPanel.classList.toggle('hidden', !loggedIn);
  if (!loggedIn) {
    els.accountPrivateDataSummary.innerHTML = '';
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
  `;
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
  const { auth = 'admin', ...fetchOptions } = options;
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  if (auth === 'account' && state.accountToken) {
    headers.authorization = `Bearer ${state.accountToken}`;
  } else if (auth === 'admin' && state.token) {
    headers.authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, { ...fetchOptions, headers });
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
    els.accountScreen,
    els.adminScreen
  ]) {
    screen.classList.remove('active');
  }
  document.body.classList.toggle('home-page', name === 'home');
  document.body.classList.toggle('policy-page', name === 'policy');
  document.body.classList.toggle('account-page', ['register', 'login', 'account'].includes(name));
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
    .trim();
  return text || fallback;
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
  const fileCount = posts.filter((post) => post.image).length;
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

function sortWatchedThreads(left, right) {
  const unreadDelta = Number(right.unreadCount || 0) - Number(left.unreadCount || 0);
  if (unreadDelta !== 0) {
    return unreadDelta;
  }
  return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
}

async function loadWatchedThreadSummaries() {
  const watchedEntries = Object.values(readWatchedThreads());
  if (!watchedEntries.length) {
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
  return results.sort(sortWatchedThreads);
}

async function loadHomeThreadsByBoard() {
  const entries = await Promise.all(
    state.boards.map(async (board) => {
      try {
        return [board.slug, await api(`/api/boards/${board.slug}/threads`)];
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

function renderPopularThreads(threads) {
  if (!threads.length) {
    els.popularThreads.classList.add('popular-empty');
    els.popularThreads.innerHTML = `
      <p>
        Chưa có chủ đề nổi bật. Chủ đề công khai sẽ xuất hiện ở đây sau khi có người đăng bài.
      </p>
    `;
    return;
  }

  els.popularThreads.classList.remove('popular-empty');
  els.popularThreads.innerHTML = threads
    .map((thread) => {
      const board = state.boards.find((item) => item.slug === thread.boardSlug);
      const href = `#thread/${thread.id}`;
      const title = plainPreview(thread.bodyLines, board?.description).slice(0, 120);
      const initials = (board?.name || thread.boardSlug).slice(0, 2).toUpperCase();
      const thumbnailSrc = imageThumbnailSrc(thread.image);

      return `
        <a class="popular-item" href="${href}">
          <strong>${board?.name || thread.boardSlug}</strong>
          ${
            thread.image && thumbnailSrc
              ? `<img src="${escapeHtml(thumbnailSrc)}" alt="${escapeHtml(thread.image.name)}">`
              : `<span class="popular-placeholder">${initials}</span>`
          }
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
  if (!posts.length) {
    els.latestPosts.innerHTML = '<p class="latest-empty">Chưa có bài công khai.</p>';
    return;
  }

  els.latestPosts.innerHTML = posts
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

function renderWatchedThreads(watchedThreads) {
  if (!watchedThreads.length) {
    els.watchedThreads.innerHTML =
      '<p class="latest-empty">Chưa theo dõi chủ đề nào. Vào một thread và bấm [Theo dõi].</p>';
    return;
  }

  els.watchedThreads.innerHTML = watchedThreads
    .map((item) => {
      const boardLabel = item.boardPath || `/${item.boardSlug || '?'}/`;
      const preview = item.unavailable
        ? 'Chủ đề không còn truy cập được hoặc đã bị xóa.'
        : item.preview || 'Không có nội dung';
      const href = item.unavailable ? '#home' : `#thread/${encodeURIComponent(item.threadId)}`;
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

function adminPostDetailHtml(detail) {
  const post = detail.post;
  const actions = detail.actions || [];
  const reports = detail.reports || [];
  const sanctions = detail.sanctions || [];
  return `
    <div class="admin-detail">
      <div class="post-meta">
        <span>${post.type === 'thread' ? 'chủ đề' : 'bình luận'}</span>
        <span>No.${post.globalNumber}</span>
        <span>${escapeHtml(post.boardSlug)}</span>
        <span>${escapeHtml((post.moderationLabels || []).map(moderationLabelText).join(', ') || moderationStatusText(post.moderationStatus))}</span>
      </div>
      ${detail.thread ? `<p class="muted">Ngữ cảnh thread: No.${detail.thread.globalNumber} · ${escapeHtml(detail.thread.boardSlug)}</p>` : ''}
      <div class="post-body">${renderPostLines(post.bodyLines || [])}</div>
      <div class="pending-actions">
        <button class="ghost-button" data-admin-note="${post.globalNumber}" type="button">[Ghi chú]</button>
        ${post.type === 'thread' ? adminStickyButtonHtml(post) : ''}
        ${post.type === 'thread' ? adminLockButtonHtml(post) : ''}
        <button class="ghost-button" data-admin-sanction="cooldown" data-global-number="${post.globalNumber}" type="button">[Làm chậm]</button>
        <button class="ghost-button" data-admin-sanction="ban" data-global-number="${post.globalNumber}" type="button">[Tạm khóa]</button>
        ${post.image ? `<button class="ghost-button" data-admin-delete-post="${post.globalNumber}" data-file-only="true" type="button">[Xóa tệp]</button>` : ''}
        <button class="danger-button" data-admin-delete-post="${post.globalNumber}" type="button">Xóa bài</button>
      </div>
      <h3>Báo cáo ${reports.length ? `<button class="ghost-button" data-admin-reports-summary="${post.globalNumber}" type="button">[Tóm tắt báo cáo AI]</button>` : ''}</h3>
      <div id="adminReportsSummaryBox-${post.globalNumber}" class="admin-reports-summary-box hidden"></div>
      ${reports.length ? reportsHtml(reports) : '<p class="muted">Không có báo cáo.</p>'}
      <h3>Làm chậm/Tạm khóa</h3>
      ${sanctions.length ? sanctionsHtml(sanctions) : '<p class="muted">Không có lệnh làm chậm/tạm khóa.</p>'}
      <h3>Nhật ký</h3>
      ${actions.length ? moderationActionsHtml(actions) : '<p class="muted">Không có nhật ký.</p>'}
    </div>
  `;
}

function historyActionsHtml(actions) {
  return moderationActionsHtml(actions);
}

function adminAnalyticsHtml(analytics) {
  const boardRows = (analytics.boardActivity || [])
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

function adminQueryString() {
  const params = new URLSearchParams();
  if (els.adminBoardFilter.value) {
    params.set('boardSlug', els.adminBoardFilter.value);
  }
  if (els.adminLabelFilter.value) {
    params.set('label', els.adminLabelFilter.value);
  }
  if (els.adminTimeFilter.value) {
    const since = new Date(Date.now() - (els.adminTimeFilter.value === '24h' ? 24 : 24 * 7) * 60 * 60 * 1000);
    params.set('since', since.toISOString());
  }
  return params.toString();
}

function adminEndpoint() {
  const query = adminQueryString();
  const suffix = query ? `?${query}` : '';
  if (state.adminTab === 'reports') {
    return `/api/admin/reports${query ? `?limit=100&${query}` : '?limit=100'}`;
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
  els.reportSection.classList.toggle('hidden', true);
  els.moderationSection.classList.toggle('hidden', true);
}

function adminBoardPayload(root, { includeSlug = false } = {}) {
  const payload = {
    name: root.querySelector('[data-admin-board-name]')?.value || '',
    category: root.querySelector('[data-admin-board-category]')?.value || '',
    description: root.querySelector('[data-admin-board-description]')?.value || '',
    isHidden: Boolean(root.querySelector('[data-admin-board-hidden]')?.checked),
    isArchived: Boolean(root.querySelector('[data-admin-board-archived]')?.checked)
  };
  if (includeSlug) {
    payload.slug = root.querySelector('[data-admin-board-slug]')?.value || '';
  }
  return payload;
}

function adminBoardsHtml(boards) {
  const rows = boards
    .map(
      (board) => `
        <tr data-admin-board-row="${escapeHtml(board.slug)}">
          <td><code>/${escapeHtml(board.slug)}/</code></td>
          <td><input data-admin-board-name value="${escapeHtml(board.name)}" maxlength="80" /></td>
          <td><input data-admin-board-category value="${escapeHtml(board.category)}" maxlength="80" /></td>
          <td><input data-admin-board-description value="${escapeHtml(board.description)}" maxlength="240" /></td>
          <td class="admin-board-flags">
            <label><input data-admin-board-hidden type="checkbox" ${board.isHidden ? 'checked' : ''} /> Ẩn</label>
            <label><input data-admin-board-archived type="checkbox" ${board.isArchived ? 'checked' : ''} /> Lưu trữ</label>
          </td>
          <td class="admin-board-actions">
            <button class="ghost-button" data-admin-board-save type="button">[Lưu]</button>
            <button class="danger-button" data-admin-board-delete type="button">Xóa</button>
          </td>
        </tr>
      `
    )
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
          <label><input data-admin-board-hidden type="checkbox" /> Ẩn khỏi public</label>
          <label><input data-admin-board-archived type="checkbox" /> Lưu trữ</label>
          <button class="primary-button" data-admin-board-create type="button">Tạo bảng</button>
        </div>
      </section>
      <div class="admin-board-table-wrap">
        <table class="admin-board-table">
          <thead>
            <tr>
              <th>Board</th>
              <th>Tên</th>
              <th>Danh mục</th>
              <th>Mô tả</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6">Chưa có board.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="muted">Xóa chỉ áp dụng cho board rỗng. Board đã có nội dung nên dùng Ẩn hoặc Lưu trữ.</p>
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
  } else if (state.adminTab === 'deleted') {
    els.pendingList.innerHTML = deletedPostsHtml(items);
  } else if (state.adminTab === 'sanctions') {
    els.pendingList.innerHTML = `<div class="moderation-log">${sanctionsHtml(items)}</div>`;
  } else if (state.adminTab === 'boards') {
    els.pendingList.innerHTML = adminBoardsHtml(items);
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
  const rows = [['tab', 'time', 'board', 'globalNumber', 'typeOrAction', 'reason']];
  for (const item of state.adminItems) {
    rows.push([
      state.adminTab,
      item.createdAt || item.deletedAt || '',
      item.boardSlug || '',
      item.globalNumber || item.sourceGlobalNumber || '',
      item.type || item.action || item.kind || '',
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
  renderWatchedThreads(watchedThreads);
  renderMyPosts();
  renderSubscribedBoards();
  renderHotBoards(hotBoards);
  renderCampusPulse(campusPulse);
  renderStats(stats);
}

function renderPostLines(lines, options = {}) {
  const opNumber = Number(options.opNumber || 0);
  return lines
    .map((line) => {
      const html = line.text.replace(/&gt;&gt;(\d+)/g, (_match, number) => {
        const refNumber = Number(number);
        const isOpReference = opNumber > 0 && refNumber === opNumber;
        const className = isOpReference ? 'ref-link op-ref' : 'ref-link';
        const marker = isOpReference ? ' <span class="op-ref-marker">(OP)</span>' : '';
        return `<button class="${className}" data-ref="${number}" type="button">&gt;&gt;${number}${marker}</button>`;
      });
      return `<div class="post-line ${line.type === 'greentext' ? 'greentext' : ''}">${html || '&nbsp;'}</div>`;
    })
    .join('');
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

function imageOriginalSrc(image = {}) {
  const value = image || {};
  return value.url || value.dataUrl || '';
}

function imageThumbnailSrc(image = {}, options = {}) {
  const value = image || {};
  const src = value.thumbnail?.url || value.thumbnail?.dataUrl || '';
  return src || (options.fallbackOriginal ? imageOriginalSrc(value) : '');
}

function fileTextHtml(image) {
  const name = escapeHtml(image?.name || 'tai-len');
  const src = escapeHtml(imageOriginalSrc(image));
  const info = escapeHtml(imageInfoText(image));
  return `Tệp: <a href="${src}" target="_blank" rel="noopener">${name}</a> (${info})`;
}

function imageToggleHtml(image, className = 'post-image') {
  const name = escapeHtml(image?.name || 'tai-len');
  const thumbnailSrc = imageThumbnailSrc(image);
  const originalSrc = escapeHtml(imageOriginalSrc(image));
  const preview = thumbnailSrc
    ? `<img class="${className}" src="${escapeHtml(thumbnailSrc)}" alt="${name}" data-full-src="${originalSrc}">`
    : `<span class="${className} placeholder image-lazy-placeholder" data-full-src="${originalSrc}">Có tệp</span>`;
  return `
    <div class="thread-thumb-wrap">
      <div class="file-text">${fileTextHtml(image)}</div>
      <button class="image-toggle" data-image-toggle data-full-src="${originalSrc}" data-image-name="${name}" data-image-class="${className}" type="button" aria-expanded="false" aria-label="Phóng to ảnh ${name}">
        ${preview}
      </button>
    </div>
  `;
}

function imageHtml(post) {
  return post.image ? imageToggleHtml(post.image) : '';
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

function meta(post, options = {}) {
  const labels = post.moderationLabels?.length
    ? `AI:${post.moderationLabels.map(moderationLabelText).join(',')}`
    : moderationStatusText(post.moderationStatus);
  const showCheckbox = options.checkbox !== false;
  const showReplyAction = options.replyAction !== false;
  const canReply = options.canReply !== false;
  const permalink = postPermalink(post, options);
  const opNumber = Number(options.opNumber || 0);
  const isOpReply =
    opNumber > 0 &&
    Number(post.globalNumber) !== opNumber &&
    (post.isOp || (options.opPosterHash && post.posterHash === options.opPosterHash));
  const opMarker = isOpReply ? '<span class="op-post-marker">(OP)</span>' : '';
  const posterIdentity = canReply
    ? `<button class="post-id-button hash" data-quick-reply="${post.globalNumber}" title="Trả lời bài này" type="button">${escapeHtml(posterId(post))}</button>`
    : `<span class="hash">${escapeHtml(posterId(post))}</span>`;
  return `
    <div class="post-meta">
      ${showCheckbox ? `<label class="post-check"><input type="checkbox" aria-label="Chọn bài ${post.globalNumber}"></label>` : ''}
      <span class="name">${escapeHtml(postDisplayName(post))}</span>
      <span class="date">${formatPostDate(post.createdAt)}</span>
      <span class="post-number"><span class="post-number-prefix">No.</span><a class="number post-number-link" href="${permalink}" title="Liên kết tới bài này">${post.globalNumber}</a></span>
      ${posterIdentity}
      ${opMarker}
      ${stickyLabelHtml(post)}
      <span class="status">${labels}</span>
      ${voteControlHtml(post)}
      ${
        showReplyAction && canReply
          ? `<button class="quote-button" data-quote="&gt;&gt;${post.globalNumber}" type="button">[Trả lời]</button>`
          : ''
      }
      <button class="quote-button" data-report="${post.globalNumber}" type="button">[Báo cáo]</button>
      <button class="quote-button" data-hide-post="${post.globalNumber}" type="button">[Ẩn]</button>
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
      <div class="post-body">${renderPostLines(post.bodyLines || [], options)}</div>
      ${backlinksHtml(post.backlinks)}
      ${classes.includes('op') ? pollHtml(post.poll, options.canReply !== false) : ''}
    </article>
  `;
}

function threadToolbarHtml(detail, position) {
  const posts = [detail.thread, ...detail.comments];
  const fileCount = posts.filter((post) => post.image).length;
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
      [<button class="link-button" data-toggle-watch type="button">${watchLabel}</button>]
      [<button class="link-button" data-scroll-page-top type="button">Lên đầu</button>]
      [<button class="link-button" data-thread-refresh type="button">Cập nhật</button>]
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
    `${boardHeading(state.boards.find((board) => board.slug === thread.boardSlug))} ${plainPreview(
      thread.bodyLines,
      ''
    )} No.${thread.globalNumber}`
  );
  return haystack.includes(normalizedTerm);
}

function catalogThreadHtml(thread) {
  const title = plainPreview(thread.bodyLines, 'Chưa có nội dung').slice(0, 260);
  const stickyPrefix = thread.isSticky ? '[Ghim] ' : '';
  const thumbnailSrc = imageThumbnailSrc(thread.image);
  const image = thread.image && thumbnailSrc
    ? `<img src="${escapeHtml(thumbnailSrc)}" alt="${escapeHtml(thread.image.name)}">`
    : thread.image
      ? '<span class="catalog-placeholder">Có tệp</span>'
    : '<span class="catalog-placeholder">Không có tệp</span>';

  return `
    <a class="catalog-thread" href="#thread/${thread.id}">
      <span class="catalog-thumb">${image}</span>
      <strong>${escapeHtml(`${stickyPrefix}${title.slice(0, 70)}`)}${title.length >= 70 ? '...' : ''}</strong>
      <span class="catalog-thread-stats">R: ${thread.replyCount} / I: ${thread.image ? 1 : 0} / No.${thread.globalNumber}</span>
      <p>${escapeHtml(title)}${title.length >= 260 ? '...' : ''}</p>
    </a>
  `;
}

function sortedCatalogThreads(threads) {
  const copy = [...threads];
  if (state.catalogSort === 'created') {
    return copy.sort((left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      return stickyCompare || right.createdAt.localeCompare(left.createdAt);
    });
  }
  if (state.catalogSort === 'replies') {
    return copy.sort((left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      return stickyCompare || Number(right.replyCount || 0) - Number(left.replyCount || 0);
    });
  }
  if (state.catalogSort === 'latest-reply') {
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
    return Boolean(thread.image);
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
    threads.filter((thread) => catalogThreadMatchesFilter(thread) && threadMatchesSearch(thread, term))
  );
  els.catalogGrid.classList.toggle('catalog-grid-large', state.catalogImageSize === 'large');
  document.querySelectorAll('[data-catalog-sort]').forEach((button) => {
    button.classList.toggle('active', button.dataset.catalogSort === state.catalogSort);
  });
  document.querySelectorAll('[data-catalog-filter]').forEach((button) => {
    button.classList.toggle('active', button.dataset.catalogFilter === state.catalogFilter);
  });
  document.querySelectorAll('[data-catalog-size]').forEach((button) => {
    button.classList.toggle('active', button.dataset.catalogSize === state.catalogImageSize);
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

  const threads = await api(`/api/boards/${board.slug}/archive`);
  state.archiveThreads = threads;
  renderArchiveThreads(threads);
}

function renderBoardThreads(threads) {
  const term = els.boardSearchInput.value.trim();
  const hidden = hiddenThreadIds();
  const visibleThreads = threads.filter((thread) => !hidden.has(String(thread.id)) && threadMatchesSearch(thread, term));
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
            thread.image
              ? imageToggleHtml(thread.image, 'thumb')
              : '<div class="thread-thumb-wrap"><div class="thumb placeholder">Không có tệp</div></div>'
          }
            ${meta(thread, { replyAction: false })}
            <a class="thread-open" href="#thread/${thread.id}">[Trả lời]</a>
            <div class="post-body">${renderPostLines(thread.bodyLines || [], { opNumber: thread.globalNumber })}</div>
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
  els.boardCatalogLinkBottom.href = `#catalog/${board.slug}`;
  els.boardArchiveLinkBottom.href = `#archive/${board.slug}`;
  els.boardSearchInput.value = state.boardSearchTerm;
  els.boardSummary.classList.add('hidden');
  const shouldOpenComposer = new URLSearchParams(window.location.hash.split('?')[1] || '').get('new') === '1';
  if (shouldOpenComposer) {
    openThreadComposer({ focus: true });
  } else {
    closeThreadComposer();
  }

  const query = new URLSearchParams({
    page: String(state.boardPage),
    pageSize: String(state.boardPageSize)
  });
  if (state.boardSearchTerm.trim()) {
    query.set('q', state.boardSearchTerm.trim());
  }
  const payload = await api(`/api/boards/${board.slug}/threads?${query.toString()}`);
  const threads = Array.isArray(payload) ? payload : payload.items || [];
  state.boardThreads = threads;
  state.boardPageMeta = Array.isArray(payload) ? null : payload;
  renderBoardThreads(threads);
}

async function loadThread({ resetReply = false, focusPost = '' } = {}) {
  setScreen('thread');
  els.threadSummary.classList.add('hidden');
  const query = new URLSearchParams({
    commentsPage: String(state.threadCommentPage),
    commentsPageSize: String(state.threadCommentPageSize)
  });
  const requestedPost = focusPost || currentPermalinkPost();
  if (requestedPost) {
    query.set('focusGlobalNumber', requestedPost);
  }
  const detail = await api(`/api/threads/${state.threadId}?${query.toString()}`);
  state.threadDetail = detail;
  const previousLastSeen = readThreadLastSeen(state.threadId);
  const currentMaxNumber = detail.commentPage?.currentMaxGlobalNumber || maxThreadPostNumber(detail);
  state.threadLastSeenBefore = previousLastSeen;
  state.threadCurrentMaxNumber = currentMaxNumber;
  state.threadCommentPageMeta = detail.commentPage || null;
  state.threadCommentPage = detail.commentPage?.page || state.threadCommentPage;
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
  els.threadTitle.textContent = boardHeading(board) || detail.thread.boardSlug;
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
  const visibleComments = detail.comments.filter((comment) => !hiddenPosts.has(String(comment.globalNumber)));
  els.threadDetail.innerHTML = `
    ${archivedNotice}
    ${lockedNotice}
    ${postHtml(detail.thread, 'post op', {
      opNumber: detail.thread.globalNumber,
      opPosterHash: detail.thread.posterHash,
      canReply
    })}
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
          : '<p class="muted">Chưa có bình luận công khai trên trang này.</p>'
      }
    </div>
  `;
  els.threadPagination.innerHTML = pageControlsHtml(state.threadCommentPageMeta, 'thread-comments');
  const focusedPost = requestedPost;
  focusPermalinkPost(focusedPost, { scroll: Boolean(focusPost) });
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

function loadPolicy() {
  setScreen('policy');
  window.scrollTo({ top: 0 });
}

function route() {
  hideReferencePreview();
  const hash = window.location.hash || '#home';
  const [hashPath, hashQuery = ''] = hash.split('?');
  const [, name, id] = hashPath.match(/^#([^/]+)\/?(.+)?$/) || [];
  if (name === 'home' || !name) {
    loadHome().catch((error) => showToast(error.message));
  } else if (name === 'policy') {
    loadPolicy();
  } else if (name === 'register') {
    setScreen('register');
    setFormError(els.registerError);
    window.scrollTo({ top: 0 });
  } else if (name === 'login') {
    setScreen('login');
    setFormError(els.accountLoginError);
    window.scrollTo({ top: 0 });
  } else if (name === 'account') {
    loadAccountSettings().catch((error) => showToast(error.message));
  } else if (name === 'thread' && id) {
    const params = new URLSearchParams(hashQuery);
    state.threadId = decodeURIComponent(id);
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
    state.boardPage = 1;
    loadBoard().catch((error) => showToast(error.message));
  }
  setupRealtime();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc ảnh'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
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
  return `
    <img src="${escapeHtml(imageOriginalSrc(image))}" alt="${escapeHtml(image.name)}">
    <div class="file-text">${fileTextHtml(image)}</div>
  `;
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
    const options = formValue(els.threadForm, 'options');
    const payload = {
      body,
      pollOptions: els.threadPollOptions.value
        .split('\n')
        .map((option) => option.trim())
        .filter(Boolean),
      options,
      displayName: displayNameValue(els.threadForm),
      deletePassword: defaultDeletePassword(),
      captchaToken,
      posterToken: state.posterToken,
      image: state.selectedImage
    };
    const result = await api(`/api/boards/${state.boardSlug}/threads`, {
      auth: 'account',
      method: 'POST',
      body: JSON.stringify(payload)
    });
    rememberMyPost(result.thread, 'thread');
    els.threadBody.value = '';
    els.threadPollOptions.value = '';
    clearDisplayName(els.threadForm);
    removeDraft(draftKey('thread', state.boardSlug));
    updatePrivacyWarning('', els.threadPrivacyWarning);
    if (els.threadAiRewriteLabel) {
      els.threadAiRewriteLabel.classList.add('hidden');
    }
    els.threadImage.value = '';
    state.selectedImage = null;
    els.imagePreview.classList.add('hidden');
    resetHcaptcha(els.threadCaptcha);
    closeThreadComposer();
    showToast(result.status === 'pending' ? 'Đã vào hàng đợi chờ quản trị viên duyệt.' : 'Chủ đề đã công khai.');
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
    resetHcaptcha(els.commentCaptcha);
    showToast(result.status === 'pending' ? 'Bình luận đang chờ duyệt.' : 'Đã gửi.');
    closeReplyComposer();
    await loadThread();
  } catch (error) {
    showToast(error.message);
  } finally {
    restoreButton();
  }
}

async function createComment(body, captchaToken) {
  const form = els.quickReply.classList.contains('hidden') ? els.commentForm : els.quickReplyForm;
  return api(`/api/threads/${state.threadId}/comments`, {
    auth: 'account',
    method: 'POST',
    body: JSON.stringify({
      body,
      captchaToken,
      posterToken: state.posterToken,
      displayName: displayNameValue(form),
      options: formValue(form, 'options'),
      deletePassword: defaultDeletePassword()
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
    resetHcaptcha(els.quickReplyCaptcha);
    showToast(result.status === 'pending' ? 'Bình luận đang chờ duyệt.' : 'Đã gửi.');
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

async function showReference(number, event) {
  const previewWidth = Math.min(360, window.innerWidth - 12);
  const left = clamp(event.clientX + 10, 6, window.innerWidth - previewWidth - 6);
  const top = clamp(event.clientY + 10, 6, window.innerHeight - 226);
  els.refPreview.style.left = `${left}px`;
  els.refPreview.style.top = `${top}px`;
  els.refPreview.style.maxWidth = `${previewWidth}px`;
  try {
    const result = await api(`/api/posts/${number}`);
    els.refPreview.innerHTML = postHtml(result.post, 'post', {
      opNumber: state.threadGlobalNumber,
      opPosterHash: state.threadPosterHash
    });
    els.refPreview.classList.remove('hidden');
  } catch {
    els.refPreview.textContent = `Bài >>${number} không tồn tại hoặc chưa công khai.`;
    els.refPreview.classList.remove('hidden');
  }
}

function hideReferencePreview() {
  els.refPreview.classList.add('hidden');
  els.refPreview.innerHTML = '';
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
    setAccountSession({ token: result.token, account: result.account });
    await loadAccountPrivateData({ mergeLocal: true });
    showToast('Đã đăng ký và đăng nhập tài khoản.');
    window.location.hash = '#account';
  } catch (error) {
    resetHcaptcha(els.registerCaptcha);
    setFormError(els.registerError, error.message);
  } finally {
    restoreButton();
  }
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
    setAccountSession({ token: result.token, account: result.account });
    await loadAccountPrivateData({ mergeLocal: true });
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
    setAccountSession({ token: result.token, account: result.account });
    await loadAccountPrivateData({ mergeLocal: true });
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
    setAccountSession({ token: result.token, account: result.account });
    await loadAccountPrivateData({ mergeLocal: true });
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
    hideThumbnails: els.accountHideThumbnails.checked
  });
  const notificationPreferences = writeLocalNotificationPreferences({
    email: els.accountEmailNotifications.checked,
    watchedThreads: els.accountNotifyWatchedThreads.checked,
    boardSubscriptions: els.accountNotifyBoardSubscriptions.checked
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
  const source = new EventSource(`/events${contextKey ? `?${contextKey}` : ''}`);
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
    source.addEventListener(eventName, () => {
      const hash = window.location.hash || '#home';
      if (hash.startsWith('#home') || hash === '') {
        loadHome().catch(() => {});
      } else if (hash.startsWith('#thread/')) {
        loadThread().catch(() => {});
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
  } else if (event.key === 'b' && state.boardSlug) {
    event.preventDefault();
    window.location.hash = `#board/${state.boardSlug}`;
  }
}

function loadFullImageForToggle(imageToggle) {
  const fullSrc = imageToggle.dataset.fullSrc;
  if (!fullSrc) {
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
      if (!img.closest('.thread-thumb-wrap, .catalog-thumb')) {
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
  els.commentForm.addEventListener('submit', submitComment);
  els.quickReplyForm.addEventListener('submit', submitQuickReply);
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
  els.quickReplyCaptchaButton.addEventListener('click', () => {
    if (state.hcaptchaSiteKey) {
      showToast('Hãy hoàn tất hCaptcha trong khung xác minh.');
      return;
    }
    els.quickReplyCaptcha.value = 'dev-pass';
  });
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
  els.boardSummaryButton.addEventListener('click', () => showSummary('board'));
  els.threadSummaryButton.addEventListener('click', () => showSummary('thread'));
  els.suggestButton.addEventListener('click', loadSuggestions);
  els.threadRewriteButton.addEventListener('click', () => rewriteDraft('thread'));
  els.rewriteButton.addEventListener('click', () => rewriteDraft('comment'));
  els.threadImage.addEventListener('change', async () => {
    const file = els.threadImage.files?.[0];
    if (!file) {
      state.selectedImage = null;
      els.imagePreview.innerHTML = '';
      els.imagePreview.classList.add('hidden');
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast('Chỉ hỗ trợ ảnh.');
      els.threadImage.value = '';
      state.selectedImage = null;
      els.imagePreview.innerHTML = '';
      els.imagePreview.classList.add('hidden');
      return;
    }
    try {
      state.selectedImage = await fileToDataUrl(file);
      els.imagePreview.innerHTML = imagePreviewHtml(state.selectedImage);
      els.imagePreview.classList.remove('hidden');
    } catch (error) {
      showToast(error.message);
      els.threadImage.value = '';
      state.selectedImage = null;
      els.imagePreview.innerHTML = '';
      els.imagePreview.classList.add('hidden');
    }
  });

  document.body.addEventListener('click', async (event) => {
    const imageToggle = event.target.closest('[data-image-toggle]');
    if (imageToggle) {
      const expanded = imageToggle.classList.toggle('expanded');
      if (expanded) {
        loadFullImageForToggle(imageToggle);
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
        renderWatchedThreads(await loadWatchedThreadSummaries());
      }
      return;
    }

    const boardRefreshButton = event.target.closest('[data-board-refresh]');
    if (boardRefreshButton) {
      await loadBoard().catch((error) => showToast(error.message));
      return;
    }

    const removeSavedSearchButton = event.target.closest('[data-remove-saved-search]');
    if (removeSavedSearchButton) {
      removeSavedSearch(removeSavedSearchButton.dataset.removeSavedSearch);
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
      state.catalogSort = catalogSortButton.dataset.catalogSort;
      renderCatalogThreads(state.catalogThreads);
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
      await loadThread().catch((error) => showToast(error.message));
      showToast('Đã ẩn bài trên trình duyệt này.');
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
      openReplyComposer({ focus: false });
      const spacer = els.commentBody.value && !els.commentBody.value.endsWith('\n') ? '\n' : '';
      els.commentBody.value = `${els.commentBody.value}${spacer}${quote}\n`;
      updatePrivacyWarning(els.commentBody.value, els.commentPrivacyWarning);
      els.commentBody.focus();
      return;
    }

    const ref = event.target.closest('.ref-link');
    if (ref) {
      await showReference(ref.dataset.ref, event);
      return;
    }
    if (!event.target.closest('.ref-preview')) {
      els.refPreview.classList.add('hidden');
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
      const reason = window.prompt(`Lý do báo cáo No.${reportButton.dataset.report}:`, '');
      if (!reason) {
        return;
      }
      try {
        await api(`/api/posts/${reportButton.dataset.report}`, {
          method: 'POST',
          body: JSON.stringify({ reason, posterToken: state.posterToken })
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

    const adminBoardCreateButton = event.target.closest('[data-admin-board-create]');
    if (adminBoardCreateButton) {
      const form = adminBoardCreateButton.closest('[data-admin-board-create-form]');
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
      try {
        await api(`/api/admin/boards/${encodeURIComponent(slug)}`, { method: 'DELETE' });
        showToast('Đã xóa board.');
        await refreshPublicBoards();
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

    if (event.target.closest('#adminBoardFilter, #adminLabelFilter, #adminTimeFilter')) {
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
  });

  els.registerForm.addEventListener('submit', submitAccountRegister);
  els.accountLoginForm.addEventListener('submit', submitAccountLogin);
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
  applyTheme();
  applyDisplayPreferences();
  applyNotificationPreferences();
  const config = await api('/api/config');
  state.boards = config.boards;
  state.boardGroups = config.boardGroups || [];
  state.aiConfigured = Boolean(config.ai?.configured);
  state.hcaptchaSiteKey = config.hcaptchaSiteKey || '';
  await refreshPublicBoards({ fallbackBoards: config.boards });
  setupHcaptcha().catch((error) => showToast(error.message));
  syncAccountHomeBoardOptions();
  await loadAccountSession();
  syncAdminBoardFilter();
  route();
}

init().catch((error) => showToast(error.message));
