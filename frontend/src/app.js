const state = {
  boards: [],
  boardGroups: [],
  aiConfigured: false,
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
  accountPrivateData: null,
  accountPrivateSaveTimer: null,
  posterToken: getPosterToken(),
  selectedImage: null,
  quickReplyDrag: null,
  replyComposerOpen: false,
  threadIsArchived: false,
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

function isBoardSubscribed(slug = state.boardSlug) {
  return subscribedBoardSlugs().has(String(slug));
}

function toggleBoardSubscription(slug = state.boardSlug) {
  const items = subscribedBoardSlugs();
  if (items.has(slug)) {
    items.delete(slug);
    showToast('Đã bỏ theo dõi bảng.');
  } else {
    items.add(slug);
    showToast('Đã theo dõi bảng.');
  }
  writeJsonLocal(subscribedBoardsKey, [...items]);
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
  suggestions: document.querySelector('#suggestions'),
  adminTitle: document.querySelector('#adminTitle'),
  loginForm: document.querySelector('#loginForm'),
  adminUsername: document.querySelector('#adminUsername'),
  adminPassword: document.querySelector('#adminPassword'),
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
  registerError: document.querySelector('#registerError'),
  accountLoginForm: document.querySelector('#accountLoginForm'),
  accountUsername: document.querySelector('#accountUsername'),
  accountPassword: document.querySelector('#accountPassword'),
  accountLoginError: document.querySelector('#accountLoginError'),
  accountStatus: document.querySelector('#accountStatus'),
  accountSettingsForm: document.querySelector('#accountSettingsForm'),
  accountSettingsError: document.querySelector('#accountSettingsError'),
  accountTheme: document.querySelector('#accountTheme'),
  accountHomeBoard: document.querySelector('#accountHomeBoard'),
  accountSyncDrafts: document.querySelector('#accountSyncDrafts'),
  accountEmailNotifications: document.querySelector('#accountEmailNotifications'),
  accountSettingsLogout: document.querySelector('#accountSettingsLogout'),
  accountPrivateDataPanel: document.querySelector('#accountPrivateDataPanel'),
  accountPrivateDataSummary: document.querySelector('#accountPrivateDataSummary'),
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
  quickReplyFileName: document.querySelector('#quickReplyFileName'),
  threadDeletePassword: document.querySelector('#threadDeletePassword'),
  commentDeletePassword: document.querySelector('#commentDeletePassword'),
  quickReplyDeletePassword: document.querySelector('#quickReplyDeletePassword'),
  deletePasswordInput: document.querySelector('#deletePasswordInput'),
  deleteFileOnly: document.querySelector('#deleteFileOnly'),
  deletePostButton: document.querySelector('#deletePostButton')
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add('hidden'), 3400);
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

function updateAccountNav() {
  const loggedIn = Boolean(state.accountToken && state.account);
  els.accountLoginLink.classList.toggle('hidden', loggedIn);
  els.accountRegisterLink.classList.toggle('hidden', loggedIn);
  els.accountSettingsLink.classList.toggle('hidden', !loggedIn);
  els.accountLogoutButton.classList.toggle('hidden', !loggedIn);
  els.accountSettingsLink.textContent = loggedIn ? `@${state.account.username}` : 'Tài khoản';
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
  const settings = account?.settings || {};
  els.accountStatus.textContent = account
    ? `Đang đăng nhập @${account.username}. Account không thay thế Anonymous trên bài public.`
    : 'Tài khoản tùy chọn cho dữ liệu riêng.';
  els.accountSettingsForm.classList.toggle('hidden', !account);
  els.accountLoggedOut.classList.toggle('hidden', Boolean(account));
  if (!account) {
    renderAccountPrivateData();
    return;
  }
  els.accountTheme.value = settings.theme || state.theme || 'yotsuba-b';
  els.accountHomeBoard.value = settings.homeBoard || state.boardSlug || 'confession';
  els.accountSyncDrafts.checked = settings.syncDrafts !== false;
  els.accountEmailNotifications.checked = Boolean(settings.emailNotifications);
  renderAccountPrivateData();
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
    throw new Error(payload.error?.message || 'Yêu cầu thất bại');
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

function updateBoardAds(board) {
  const label = board?.name?.toLowerCase() || '36chan';
  document.querySelectorAll('.board-ad').forEach((ad) => {
    ad.textContent = `Bảng ${label} sinh viên · QUẢNG CÁO Ở ĐÂY`;
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

function syncBoardSubscriptionButtons() {
  const label = isBoardSubscribed(state.boardSlug) ? 'Bỏ theo dõi bảng' : 'Theo dõi bảng';
  document.querySelectorAll('[data-toggle-board-subscription]').forEach((button) => {
    button.textContent = label;
  });
}

function openThreadComposer({ focus = true } = {}) {
  els.threadComposer.classList.remove('hidden');
  els.startThreadButton.classList.add('hidden');
  els.threadDeletePassword.value ||= defaultDeletePassword();
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
  const canReply = !state.threadIsArchived;
  els.replyComposer.classList.toggle('hidden', !state.replyComposerOpen || !canReply);
  els.postReplyToggle.classList.toggle('hidden', state.replyComposerOpen || !canReply);
  els.commentDeletePassword.value ||= defaultDeletePassword();
  if (!state.replyComposerOpen || !canReply) {
    els.suggestions.classList.add('hidden');
  }
}

function openReplyComposer({ focus = true } = {}) {
  if (state.threadIsArchived) {
    showToast('Chủ đề đã lưu trữ, không thể trả lời.');
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
  const groupedBoards = state.boardGroups.flatMap((group) => group.boards || []);
  const source = groupedBoards.length ? groupedBoards : state.boards;
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
      'admin:unsanction': 'Gỡ khóa'
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
        <button class="ghost-button" data-admin-sanction="cooldown" data-global-number="${post.globalNumber}" type="button">[Làm chậm]</button>
        <button class="ghost-button" data-admin-sanction="ban" data-global-number="${post.globalNumber}" type="button">[Tạm khóa]</button>
      </div>
      <h3>Báo cáo</h3>
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
  if (state.adminTab === 'audit') {
    return `/api/admin/moderation-actions${query ? `?limit=100&${query}` : '?limit=100'}`;
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
  const reason = window.prompt(action === 'approve' ? 'Lý do duyệt hàng loạt:' : 'Lý do xóa hàng loạt:', '') || '';
  const ok = window.confirm(action === 'approve' ? `Duyệt ${ids.length} bài đã chọn?` : `Xóa ${ids.length} bài đã chọn?`);
  if (!ok) {
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
      <span class="status">${labels}</span>
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
  const canReply = !detail.thread.isArchived;
  const replyLink =
    position === 'bottom' && canReply
      ? '<button class="link-button toolbar-reply-link" data-open-reply type="button">Đăng trả lời</button>'
      : '<span></span>';
  const checked = state.autoUpdate ? 'checked' : '';
  const archivedLabel = detail.thread.isArchived ? '<span class="archived-label">Đã lưu trữ</span>' : '';
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
  const thumbnailSrc = imageThumbnailSrc(thread.image);
  const image = thread.image && thumbnailSrc
    ? `<img src="${escapeHtml(thumbnailSrc)}" alt="${escapeHtml(thread.image.name)}">`
    : thread.image
      ? '<span class="catalog-placeholder">Có tệp</span>'
    : '<span class="catalog-placeholder">Không có tệp</span>';

  return `
    <a class="catalog-thread" href="#thread/${thread.id}">
      <span class="catalog-thumb">${image}</span>
      <strong>${escapeHtml(title.slice(0, 70))}${title.length >= 70 ? '...' : ''}</strong>
      <span class="catalog-thread-stats">R: ${thread.replyCount} / I: ${thread.image ? 1 : 0} / No.${thread.globalNumber}</span>
      <p>${escapeHtml(title)}${title.length >= 260 ? '...' : ''}</p>
    </a>
  `;
}

function sortedCatalogThreads(threads) {
  const copy = [...threads];
  if (state.catalogSort === 'created') {
    return copy.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  if (state.catalogSort === 'replies') {
    return copy.sort((left, right) => Number(right.replyCount || 0) - Number(left.replyCount || 0));
  }
  if (state.catalogSort === 'latest-reply') {
    return copy.sort((left, right) => right.bumpedAt.localeCompare(left.bumpedAt));
  }
  return copy.sort((left, right) => right.bumpedAt.localeCompare(left.bumpedAt));
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
  updateBoardAds(board);
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
        <div class="thread" id="p${thread.globalNumber}">
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
  updateBoardAds(board);
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
  if (resetReply || state.threadIsArchived) {
    closeReplyComposer({ clear: true });
  } else {
    syncReplyComposer();
  }
  const board = currentBoard();
  renderBoards();
  updateBoardAds(board);
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
  const canReply = !detail.thread.isArchived;
  const hiddenPosts = hiddenPostNumbers();
  const visibleComments = detail.comments.filter((comment) => !hiddenPosts.has(String(comment.globalNumber)));
  els.threadDetail.innerHTML = `
    ${archivedNotice}
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
  els.loginForm.classList.toggle('hidden', loggedIn);
  els.logoutButton.classList.toggle('hidden', !loggedIn);
  els.adminTools.classList.toggle('hidden', !loggedIn);
  if (!loggedIn) {
    els.pendingList.innerHTML = '';
    els.reportList.innerHTML = '';
    els.moderationActions.innerHTML = '';
    els.reportSection.classList.add('hidden');
    els.moderationSection.classList.add('hidden');
    return;
  }

  try {
    const items = await api(adminEndpoint());
    renderAdminItems(items);
  } catch (error) {
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
  if (!confirmPrivacyBeforeSubmit(body, els.threadPrivacyWarning)) {
    showToast('Đã dừng gửi để bạn chỉnh sửa nội dung.');
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
      deletePassword: els.threadDeletePassword.value,
      captchaToken: els.threadCaptcha.value,
      posterToken: state.posterToken,
      image: state.selectedImage
    };
    const result = await api(`/api/boards/${state.boardSlug}/threads`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    rememberMyPost(result.thread, 'thread');
    els.threadBody.value = '';
    els.threadPollOptions.value = '';
    clearDisplayName(els.threadForm);
    removeDraft(draftKey('thread', state.boardSlug));
    updatePrivacyWarning('', els.threadPrivacyWarning);
    els.threadImage.value = '';
    state.selectedImage = null;
    els.imagePreview.classList.add('hidden');
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
  if (state.threadIsArchived) {
    showToast('Chủ đề đã lưu trữ, không thể trả lời.');
    return;
  }
  const button = event.submitter || els.commentForm.querySelector('[type="submit"]');
  const body = els.commentBody.value;
  if (!confirmPrivacyBeforeSubmit(body, els.commentPrivacyWarning)) {
    showToast('Đã dừng gửi để bạn chỉnh sửa nội dung.');
    return;
  }
  const restoreButton = setButtonLoading(button);
  try {
    const result = await createComment(body, els.commentCaptcha.value);
    rememberMyPost(result.comment, 'comment');
    els.commentBody.value = '';
    clearDisplayName(els.commentForm);
    removeDraft(draftKey('comment', state.threadId));
    updatePrivacyWarning('', els.commentPrivacyWarning);
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
    method: 'POST',
    body: JSON.stringify({
      body,
      captchaToken,
      posterToken: state.posterToken,
      displayName: displayNameValue(form),
      options: formValue(form, 'options'),
      deletePassword: formValue(form, 'deletePassword')
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
  if (state.threadIsArchived) {
    showToast('Chủ đề đã lưu trữ, không thể trả lời.');
    return;
  }
  const wasHidden = els.quickReply.classList.contains('hidden');
  const threadNumber = state.threadGlobalNumber || number;
  els.quickReplyTitle.textContent = `Trả lời chủ đề No.${threadNumber}`;
  if (wasHidden) {
    els.quickReplyBody.value = readDraft(draftKey('quickReply', state.threadId));
  }
  addQuoteToQuickReply(number);
  els.quickReplyCaptcha.value = els.commentCaptcha.value || 'dev-pass';
  els.quickReplyDeletePassword.value ||= defaultDeletePassword();
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
  if (state.threadIsArchived) {
    showToast('Chủ đề đã lưu trữ, không thể trả lời.');
    closeQuickReply();
    return;
  }
  const button = event.submitter;
  const body = els.quickReplyBody.value;
  if (!confirmPrivacyBeforeSubmit(body, els.quickReplyPrivacyWarning)) {
    showToast('Đã dừng gửi để bạn chỉnh sửa nội dung.');
    return;
  }
  const restoreButton = setButtonLoading(button);
  try {
    const result = await createComment(body, els.quickReplyCaptcha.value);
    rememberMyPost(result.comment, 'comment');
    clearDisplayName(els.quickReplyForm);
    removeDraft(draftKey('quickReply', state.threadId));
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
  const body = textarea.value.trim();
  if (!body) {
    showToast('Chưa có nội dung để AI sửa.');
    return;
  }

  const restoreButton = setButtonLoading(button, 'Đang sửa...');
  try {
    const result = await api('/api/ai/rewrite', {
      method: 'POST',
      body: JSON.stringify({ body, posterToken: state.posterToken })
    });
    textarea.value = result.text || body;
    updatePrivacyWarning(textarea.value, warningBox);
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
  const button = event.submitter;
  const restoreButton = setButtonLoading(button, 'Đang đăng ký...');
  try {
    const result = await api('/api/account/register', {
      auth: 'none',
      method: 'POST',
      body: JSON.stringify({
        username: els.registerUsername.value,
        password: els.registerPassword.value
      })
    });
    els.registerPassword.value = '';
    setAccountSession({ token: result.token, account: result.account });
    await loadAccountPrivateData({ mergeLocal: true });
    showToast('Đã đăng ký và đăng nhập tài khoản.');
    window.location.hash = '#account';
  } catch (error) {
    setFormError(els.registerError, error.message);
  } finally {
    restoreButton();
  }
}

async function submitAccountLogin(event) {
  event.preventDefault();
  setFormError(els.accountLoginError);
  const button = event.submitter;
  const restoreButton = setButtonLoading(button, 'Đang đăng nhập...');
  try {
    const result = await api('/api/account/login', {
      auth: 'none',
      method: 'POST',
      body: JSON.stringify({
        username: els.accountUsername.value,
        password: els.accountPassword.value
      })
    });
    els.accountPassword.value = '';
    setAccountSession({ token: result.token, account: result.account });
    await loadAccountPrivateData({ mergeLocal: true });
    showToast('Đã đăng nhập tài khoản.');
    window.location.hash = '#account';
  } catch (error) {
    setFormError(els.accountLoginError, error.message);
  } finally {
    restoreButton();
  }
}

async function submitAccountSettings(event) {
  event.preventDefault();
  setFormError(els.accountSettingsError);
  const button = event.submitter;
  const restoreButton = setButtonLoading(button, 'Đang lưu...');
  try {
    const account = await api('/api/account/settings', {
      auth: 'account',
      method: 'PUT',
      body: JSON.stringify({
        settings: {
          theme: els.accountTheme.value,
          homeBoard: els.accountHomeBoard.value,
          syncDrafts: els.accountSyncDrafts.checked,
          emailNotifications: els.accountEmailNotifications.checked
        }
      })
    });
    state.account = account;
    applyTheme(account.settings.theme);
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
  for (const eventName of ['thread:created', 'thread:bumped', 'thread:updated', 'comment:created', 'thread:archived']) {
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
  });
  els.commentBody.addEventListener('input', () => {
    writeDraft(draftKey('comment', state.threadId), els.commentBody.value);
    updatePrivacyWarning(els.commentBody.value, els.commentPrivacyWarning);
  });
  els.quickReplyBody.addEventListener('input', () => {
    writeDraft(draftKey('quickReply', state.threadId), els.quickReplyBody.value);
    updatePrivacyWarning(els.quickReplyBody.value, els.quickReplyPrivacyWarning);
  });
  els.quickReplyClose.addEventListener('click', closeQuickReply);
  els.quickReplyCaptchaButton.addEventListener('click', () => {
    els.quickReplyCaptcha.value = 'dev-pass';
  });
  [els.threadDeletePassword, els.commentDeletePassword, els.quickReplyDeletePassword, els.deletePasswordInput].forEach((input) => {
    input.addEventListener('input', () => {
      localStorage.setItem(deletePasswordKey, input.value);
    });
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

    const boardSubscriptionButton = event.target.closest('[data-toggle-board-subscription]');
    if (boardSubscriptionButton) {
      toggleBoardSubscription();
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

    if (event.target.closest('#deletePostButton')) {
      const target = currentPermalinkPost() || state.threadGlobalNumber;
      if (!target) {
        showToast('Mở link No. của bài cần xóa trước.');
        return;
      }
      if (!els.deletePasswordInput.value) {
        showToast('Nhập mật khẩu xóa.');
        return;
      }
      const ok = window.confirm(`Xóa ${els.deleteFileOnly.checked ? 'tệp của ' : ''}No.${target}?`);
      if (!ok) {
        return;
      }
      try {
        await api(`/api/posts/${target}`, {
          method: 'DELETE',
          body: JSON.stringify({ password: els.deletePasswordInput.value, fileOnly: els.deleteFileOnly.checked })
        });
        showToast('Đã xóa.');
        await loadThread();
      } catch (error) {
        showToast(error.message);
      }
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
      const reason = window.prompt(kind === 'ban' ? 'Lý do tạm khóa:' : 'Lý do làm chậm:', '') || '';
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
      const reason = window.prompt('Lý do gỡ lệnh làm chậm/tạm khóa:', '') || '';
      const ok = window.confirm('Gỡ lệnh làm chậm/tạm khóa này?');
      if (!ok) {
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
      const ok = window.confirm(action === 'approve' ? 'Duyệt bài này?' : 'Xóa bài này?');
      if (!ok) {
        return;
      }
      const reason =
        window.prompt(action === 'approve' ? 'Lý do duyệt (tùy chọn):' : 'Lý do xóa (tùy chọn):', '') || '';
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
    }
  });

  els.registerForm.addEventListener('submit', submitAccountRegister);
  els.accountLoginForm.addEventListener('submit', submitAccountLogin);
  els.accountSettingsForm.addEventListener('submit', submitAccountSettings);
  els.accountLogoutButton.addEventListener('click', () => logoutAccount());
  els.accountSettingsLogout.addEventListener('click', () => logoutAccount());

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
      state.token = result.token;
      localStorage.setItem('adminToken', state.token);
      els.adminPassword.value = '';
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
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
  const config = await api('/api/config');
  state.boards = config.boards;
  state.boardGroups = config.boardGroups || [];
  state.aiConfigured = Boolean(config.ai?.configured);
  renderBoards();
  syncAccountHomeBoardOptions();
  await loadAccountSession();
  const password = defaultDeletePassword();
  els.threadDeletePassword.value = password;
  els.commentDeletePassword.value = password;
  els.quickReplyDeletePassword.value = password;
  els.deletePasswordInput.value = password;
  syncAdminBoardFilter();
  route();
}

init().catch((error) => showToast(error.message));
