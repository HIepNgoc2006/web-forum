import { resetHcaptcha, setupHcaptcha } from './hcaptcha';
import { createAiActions } from './ai-actions';
import { bindAiActionEvents } from './ai-events';
import { createAdminModerationSettingsController } from './admin-moderation-settings';
import { api } from './api';
import { bindAdminAuthEvents } from './admin-auth-events';
import {
  adminAnalyticsHtml,
  adminBoardPayload,
  adminBoardsHtml,
  adminHealthHtml,
  adminLoadErrorHtml,
  adminLoadingHtml,
  adminPostEditButtonHtml,
  adminPostRestoreButtonHtml,
  adminUserPayload,
  adminUsersHtml,
  appealsHtml,
  compactReportsHtml,
  csvEscape,
  historyActionsHtml,
  moderationActionsHtml,
  postSubmitToast,
  reportsHtml,
  sanctionsHtml
} from './admin';
import {
  boardHeading,
  boardRulesForDisplay,
  normalizeBoardFilter,
  normalizeBoardSort,
  normalizeBoardThreadsPayload,
  omittedRepliesHtml,
  popularThreadsFrom,
  threadMatchesSearch
} from './board';
import { bindBoardNavigationEvents, handleBoardCatalogControlClick } from './board-events';
import { createAccountStateController } from './account-state';
import {
  archiveThreadHtml,
  catalogThreadHtml,
  catalogThreadMatchesFilter,
  normalizeCatalogSort,
  sortedCatalogThreads
} from './catalog';
import {
  defaultAccountPrivateData
} from './account';
import { bindAccountPasskeyEvents, bindAccountPrivateDataEvents, bindAdminPasskeyEvents } from './account-events';
import { bindAccountFormEvents } from './account-form-events';
import { createDeletePasswordController } from './delete-password';
import { els } from './dom';
import { setButtonLoading, setFormError, showToast } from './feedback';
import {
  bindComposerMediaInputEvents,
  composerTextarea,

  createReplyTemplateComposerController,
  fileToDataUrl,
  imagePreviewHtml,
  insertComposerBlock,
  insertThreadTemplate,
  dismissThreadTemplate,
  insertComposerToken,
  isSupportedMediaFile,
  updatePrivacyWarning,
  writeTextareaValue
} from './composer';
import { createComposerController } from './composer-events';
import { handleBrokenThumbnailError } from './events';
import { formValue } from './post-form';
import {
  createHomeController,
  renderCampusPulse,
  renderHomeBoards,
  renderHotBoards,
  renderMyPosts,
  renderStats,
  renderSubscribedBoards
} from './home';
import { eventInTextInput, moveKeyboardNavigation } from './keyboard';
import { createPostEditModal, showReasonModal, showReportModal } from './modals';
import { createPostClipboardActions, selectedPostQuoteText } from './post-clipboard';
import { bindQuickReplyEvents } from './quick-reply-events';
import { reactionControlHtml, voteControlHtml } from './post-controls';
import { accountPostEditButtonHtml, selfDeletePostActionsHtml, selfEditPostButtonHtml } from './post-owner-actions';
import { pollHtml } from './post-poll';
import { bindThreadSearchEvents, threadSearchHtml } from './thread-search';
import { state } from './state';
import {
  applyNotificationPreferences,
  notifyWatchedThreadPost as notifyWatchedThreadPostWithDependencies,
  resolveBrowserWatchedThreadPreference,
  syncBrowserNotificationControls
} from './notifications';
import { setupRealtime as setupRealtimeConnection } from './realtime';
import { createReferencePreviewController } from './reference-preview';
import {
  adminLockButtonHtml,
  adminStickyButtonHtml,
  backlinksHtml,
  diceRollsHtml,
  imageHtml,
  maxThreadPostNumber,
  mediaItemsFromPost,
  normalizeThreadSearchTerm,
  postMediaCount,
  postPermalink,
  stickyLabelHtml,
  threadFeedLinksHtml,
  threadMediaGalleryHtml,
  threadNavigationLinksHtml
} from './thread';
import {
  bindThreadMediaKeyboardEvents,
  handleThreadMediaClick,
  handleThreadPostCollapseClick,
  syncThreadMediaToolbarState,
  syncThreadPostCollapseToolbarState
} from './thread-dom';
import type { AnyRecord } from './types';
import {
  createWatchlistController,
  isThreadWatched,
  readWatchedThreads,
  syncWatchedControls,
  watchedThreadEntryFromDetail
} from './watchlist';
import {
  ADMIN_LOAD_TIMEOUT_MS,
  hiddenThreadsKey,
  hiddenPostsKey,
  themeKey,
  homeBoardKey,
  boardThreadsCachePrefix,
  MAX_MEDIA_PER_POST,
  SUPPORTED_THEMES
} from './constants';
import {
  escapeHtml,
  moderationPriorityHtml,
  moderationConfidenceHtml,
  filterTypeLabel,
  moderationLabelText,
  moderationStatusText,
  normalizeSearchValue,
  plainPreview,
  threadTitle,
  threadSubjectHtml,
  formatPostDate,
  formatEditedDate,
  mediaKind,
  mediaList,
  renderInlineMarkup,
  renderSpoilerText,
  renderStickerText,
  mediaToggleHtml,
  commentSortHtml,
  capcodeBadgeHtml,
  posterId,
  postDisplayName,
  clamp
} from './format';
import {
  readThreadLastSeen,
  writeThreadLastSeen,
  readJsonLocal,
  writeJsonLocal,
  readLocalList,
  normalizeWatchedSort,
  localDisplayPreferences,
  writeLocalDisplayPreferences,
  localNotificationPreferences,
  writeLocalNotificationPreferences,
  addLocalSetItem,
  defaultDeletePassword,
  normalizeDeletePassword,
  draftKey,
  hiddenThreadIds,
  hiddenPostNumbers,
  subscribedBoardSlugs,
  writeSubscribedBoardSlugs,
  writeVote,
  writeReaction
} from './storage';
const showPostEditModal = createPostEditModal({
  showToast,
  maxMediaPerPost: MAX_MEDIA_PER_POST,
  isSupportedMediaFile,
  fileToDataUrl,
  imagePreviewHtml
});
const { copyPostPermalink } = createPostClipboardActions({ showToast });
const {
  accountDraftSyncEnabled,
  readSavedSearches,
  writeSavedSearches,
  readContentFilters,
  writeContentFilters,
  addContentFilter,
  removeContentFilter,
  readReplyTemplates,
  writeReplyTemplates,
  addReplyTemplate,
  removeReplyTemplate,
  readPosterNotes,
  writePosterNotes,
  addPosterNote,
  removePosterNote,
  posterNoteForPost,
  postPlainText,
  contentFilterMatch,
  isPostFiltered,
  readDraft,
  writeDraft,
  removeDraft,
  isMyPost,
  myPostDeletePassword,
  isAccountPost,
  refreshAccountPostNumbers,
  rememberMyPost,
  mergeAccountPrivateData,
  saveAccountPrivateData,
  scheduleAccountPrivateDataSave,
  loadAccountPrivateData,
  finishAccountLogin,
  clearAccountPrivateData
} = createAccountStateController({
  api,
  showToast,
  setAccountSession,
  renderAccountPrivateData,
  renderReplyTemplatePickers: () => {
    if (replyTemplateController?.renderReplyTemplatePickers) {
      replyTemplateController.renderReplyTemplatePickers();
    }
  }
});
const watchlistController = createWatchlistController({ isPostFiltered, scheduleAccountPrivateDataSave });
const homeController = createHomeController({ isPostFiltered, writeBoardThreadsCache });
const replyTemplateController = createReplyTemplateComposerController({
  state,
  readReplyTemplates,
  addReplyTemplate,
  showToast,
  composerTextarea,
  insertComposerBlock
});
const { renderReplyTemplatePickers, insertReplyTemplate, saveComposerReplyTemplate } = replyTemplateController;

function isBoardSubscribed(slug = state.boardSlug) {
  return subscribedBoardSlugs().has(String(slug));
}

async function toggleBoardSubscription(slug = state.boardSlug) {
  const items = subscribedBoardSlugs();
  if (items.has(slug)) {
    items.delete(slug);
    showToast('\u0110\u00e3 b\u1ecf theo d\u00f5i b\u1ea3ng.');
  } else {
    items.add(slug);
    showToast('\u0110\u00e3 theo d\u00f5i b\u1ea3ng.');
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

async function persistAccountSettings({ silent = false }: AnyRecord = {}) {
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
    if (/\u0111\u0103ng nh\u1eadp|Phi\u00ean/.test(error.message)) {
      setAccountSession();
    }
    return null;
  }
}

function setAccountSession({ token = '', account = null }: AnyRecord = {}) {
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
const { renderPasskeys, handleAccountPasskeyClick } = bindAccountPasskeyEvents({
  els,
  state,
  api,
  showToast,
  setFormError,
  setButtonLoading,
  finishAccountLogin
});
const { handleAccountPrivateDataClick } = bindAccountPrivateDataEvents({
  showToast,
  removeSavedSearch,
  addContentFilter,
  removeContentFilter,
  addReplyTemplate,
  removeReplyTemplate,
  addPosterNote,
  removePosterNote,
  clearAccountPrivateData,
  renderAccountPrivateData
});
const { renderAdminPasskeys, handleAdminPasskeyClick } = bindAdminPasskeyEvents({
  els,
  state,
  api,
  showToast,
  setButtonLoading,
  loadAdmin
});
const {
  loadAdminModerationSettingsInBackground,
  resetAdminModerationSettingsCache,
  saveAdminModerationSettings,
  syncAdminModerationSettings
} = createAdminModerationSettingsController({
  els,
  state,
  api,
  showToast,
  setButtonLoading
});
const {
  bindReferencePreviewEvents,
  handleReferencePreviewClick,
  hideReferencePreview
} = createReferencePreviewController({
  state,
  refPreview: els.refPreview,
  fetchPost: async (number) => (await api('/api/posts/' + number)).post,
  renderPostPreviewHtml: (post) =>
    postHtml(post, 'post preview-post', {
      actions: false,
      checkbox: false,
      replyAction: false,
      canReply: false,
      opNumber: state.threadGlobalNumber,
      opPosterHash: state.threadPosterHash
    })
});
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
  if (!board) {
    showToast('Không tìm thấy bảng để lưu tìm kiếm.');
    return;
  }
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
  return state.boards.find((board) => board.slug === state.boardSlug) || null;
}
function renderMissingBoard(screen = 'board') {
  const slug = state.boardSlug || 'unknown';
  setScreen(screen);
  renderBoards();
  updateBoardPresentation(null);
  if (screen === 'catalog') {
    els.catalogTitle.textContent = 'Không tìm thấy bảng';
    els.catalogDescription.textContent = `Không có bảng /${slug}/.`;
    els.catalogReturnTop.href = '#home';
    els.catalogReturnBottom.href = '#home';
    els.catalogGrid.innerHTML = '<p class="muted">Hãy chọn một bảng khác từ thanh điều hướng.</p>';
    return;
  }
  els.boardTitle.textContent = 'Không tìm thấy bảng';
  els.boardPath.textContent = `/${slug}/`;
  els.boardDescription.textContent = 'Bảng này không tồn tại hoặc đã bị ẩn.';
  els.boardCatalogLink.href = '#home';
  els.boardArchiveLink.href = '#home';
  els.boardCatalogLinkBottom.href = '#home';
  els.boardArchiveLinkBottom.href = '#home';
  els.boardJsonFeedLink.href = '#home';
  els.boardRssFeedLink.href = '#home';
  els.boardJsonFeedLinkBottom.href = '#home';
  els.boardRssFeedLinkBottom.href = '#home';
  els.boardSummary.classList.add('hidden');
  els.threadList.innerHTML = '<p class="muted">Hãy chọn một bảng khác từ thanh điều hướng.</p>';
  els.boardPagination.innerHTML = '';
  closeThreadComposer();
}
function boardThreadsCacheKey({
  boardSlug = state.boardSlug,
  page = state.boardPage,
  pageSize = state.boardPageSize,
  q = state.boardSearchTerm,
  sort = state.boardSort,
  filter = state.boardFilter
}: AnyRecord = {}) {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.max(1, Math.floor(Number(pageSize) || state.boardPageSize));
  return [boardSlug, safePage, safePageSize, normalizeSearchValue(q), normalizeBoardSort(sort), normalizeBoardFilter(filter)].join('|');
}
function firstBoardPageFromThreads(threads = [], { page = 1, pageSize = state.boardPageSize }: AnyRecord = {}) {
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
function writeBoardThreadsCache(boardSlug, payload, options: AnyRecord = {}) {
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
function readBoardThreadsCache(options: AnyRecord = {}) {
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
function renderBoards() {
  els.boardNav.innerHTML = state.boards
    .map(
      (board) =>
        `<a class="${board.slug === state.boardSlug ? 'active' : ''}" href="#board/${board.slug}" title="${board.path}">${board.name}</a>`
    )
    .join('');
}
async function refreshPublicBoards({ fallbackBoards = state.boards }: AnyRecord = {}) {
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
function toggleCurrentThreadWatch() {
  if (!state.threadDetail?.thread?.id) {
    return;
  }
  const watchedThreads = readWatchedThreads();
  const threadId = state.threadDetail.thread.id;
  if (watchedThreads[threadId]) {
    delete watchedThreads[threadId];
    watchlistController.writeWatchedThreads(watchedThreads);
    showToast('Đã bỏ theo dõi chủ đề.');
  } else {
    watchedThreads[threadId] = watchedThreadEntryFromDetail(state.threadDetail, {}, { markSeen: true });
    watchlistController.writeWatchedThreads(watchedThreads);
    showToast('Đã theo dõi chủ đề.');
  }
  els.threadToolbarTop.innerHTML = threadToolbarHtml(state.threadDetail, 'top');
  els.threadToolbarBottom.innerHTML = threadToolbarHtml(state.threadDetail, 'bottom');
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
function adminPostDetailHtml(detail, options: AnyRecord = {}) {
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
function renderAdminAnalytics(analytics) {
  renderAdminTabs();
  els.pendingList.innerHTML = adminAnalyticsHtml(analytics, state.boards);
  if (els.adminSelectAll) {
    els.adminSelectAll.checked = false;
  }
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
    return `/api/admin/analytics`;
  }
  if (state.adminTab === 'health') {
    return '/api/admin/health';
  }
  return `/api/admin/pending${suffix}`;
}
function isAdminSessionError(error) {
  return error?.statusCode === 401 || error?.requires2FA;
}
function isAbortError(error) {
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
async function loadAdminDetail(globalNumber, host, options: AnyRecord = {}) {
  const detail = await api(`/api/admin/posts/${globalNumber}`, {
    timeoutMs: ADMIN_LOAD_TIMEOUT_MS,
    timeoutMessage: 'Chi tiết bài viết phản hồi quá lâu, vui lòng thử lại.'
  });
  const container = host.querySelector('.admin-detail-host') || document.createElement('div');
  container.className = 'admin-detail-host';
  container.innerHTML = adminPostDetailHtml(detail, options);
  host.appendChild(container);
}
function adminTableDetailHost(button) {
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
  table.querySelectorAll('[data-admin-detail][aria-expanded="true"]').forEach((detailButton) => {
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
    homeController.loadHomeThreadsByBoard(),
    api('/api/posts/latest?limit=10'),
    watchlistController.loadWatchedThreadSummaries(),
    api('/api/boards/hot?limit=8'),
    api('/api/pulse?limit=12'),
    api('/api/stats')
  ]);
  renderHomeBoards(threadsByBoard, stats);
  homeController.renderPopularThreads(popularThreadsFrom(threadsByBoard));
  homeController.renderLatestPosts(latestPosts);
  state.watchedThreadSummaries = watchedThreads;
  watchlistController.renderWatchedThreads();
  renderMyPosts();
  renderSubscribedBoards();
  renderHotBoards(hotBoards);
  renderCampusPulse(campusPulse);
  renderStats(stats);
}
function renderPostLines(lines, options: AnyRecord = {}) {
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
        const isYouReference = isMyPost({ globalNumber: refNumber });
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
function meta(post, options: AnyRecord = {}) {
  const labels = post.moderationLabels?.length
    ? `AI:${post.moderationLabels.map(moderationLabelText).join(',')}`
    : moderationStatusText(post.moderationStatus);
  const showCheckbox = options.checkbox !== false;
  const showReplyAction = options.replyAction !== false;
  const canReply = options.canReply !== false;
  const showPostActions = options.actions !== false;
  const accountEditAction = showPostActions ? accountPostEditButtonHtml(post, { isAccountPost }) : '';
  const selfEditAction = showPostActions ? selfEditPostButtonHtml(post) : '';
  const selfDeleteActions = showPostActions ? selfDeletePostActionsHtml(post) : '';
  const permalink = postPermalink(post, options, state.threadId);
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
  const posterIdentity = canReply && showPostActions
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
      ${showPostActions ? voteControlHtml(post) : ''}
      ${showPostActions ? reactionControlHtml(post) : ''}
      ${
        showPostActions && showReplyAction && canReply
          ? `<button class="quote-button" data-quote="&gt;&gt;${post.globalNumber}" type="button">[Trả lời]</button>`
          : ''
      }
      ${showPostActions ? `<button class="quote-button" data-copy-post-link="${escapeHtml(permalink)}" type="button">[Link]</button>` : ''}
      ${showPostActions ? `<button class="quote-button" data-collapse-post="${post.globalNumber}" type="button" aria-expanded="true">[Thu]</button>` : ''}
      ${selfEditAction}
      ${selfDeleteActions}
      ${accountEditAction}
      ${
        showPostActions
          ? `<button class="quote-button" data-report="${post.globalNumber}" type="button">[Báo cáo]</button>
      <button class="quote-button" data-hide-post="${post.globalNumber}" type="button">[Ẩn]</button>
      <button class="quote-button" data-filter-poster="${escapeHtml(posterId(post))}" data-filter-board="${escapeHtml(post.boardSlug || '')}" type="button">[Lọc ID]</button>
      <button class="quote-button" data-note-poster="${escapeHtml(posterId(post))}" data-note-board="${escapeHtml(post.boardSlug || '')}" type="button">[Ghi chú ID]</button>
      <button class="quote-button" data-translate-post="${post.globalNumber}" type="button">[Dịch]</button>
      <button class="quote-button" data-tts-post="${post.globalNumber}" type="button">[Nghe]</button>`
          : ''
      }
    </div>
  `;
}
function postHtml(post, type = 'post', options: AnyRecord = {}) {
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
function threadCommentsHtml(comments, { opNumber, opPosterHash, canReply }: AnyRecord = {}) {
  if (!comments.length) {
    return state.threadSearchTerm
      ? '<p class="muted">Không có bình luận khớp tìm kiếm trong thread.</p>'
      : '<p class="muted">Chưa có bình luận công khai trên trang này.</p>';
  }
  const lastSeen = Number(state.threadLastSeenBefore || 0);
  let markerShown = false;
  return comments
    .map((comment) => {
      const isUnread = lastSeen > 0 && Number(comment.globalNumber || 0) > lastSeen;
      const marker =
        isUnread && !markerShown
          ? `<div class="new-posts-divider" role="separator">Bài mới từ lần đọc trước · sau No.${escapeHtml(String(lastSeen))}</div>`
          : '';
      if (isUnread) {
        markerShown = true;
      }
      return `${marker}${postHtml(comment, 'post comment', {
        opNumber,
        opPosterHash,
        canReply
      })}`;
    })
    .join('');
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
  const mediaToggle = fileCount
    ? '[<button class="link-button" data-thread-media-toggle type="button" aria-pressed="false">Mở media</button>]'
    : '';
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
      ${mediaToggle}
      [<button class="link-button" data-scroll-page-top type="button">Lên đầu</button>]
      [<button class="link-button" data-thread-refresh type="button">Cập nhật</button>]
      [<button class="link-button" data-thread-collapse-posts type="button" aria-pressed="false">Thu bài</button>]
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
    Object.values(state.audioRecorders as AnyRecord).some((item) => item?.recorder?.state === 'recording')
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
function canModerateFromAdminToken() {
  const payload = decodeJwtPayload(state.token);
  return Boolean(payload && ['admin', 'owner', 'moderator'].includes(payload.role));
}
function threadHeaderActionsHtml(detail: AnyRecord = {}) {
  if (!canModerateFromAdminToken()) {
    return '';
  }
  const actions = [adminStickyButtonHtml(detail.thread), adminLockButtonHtml(detail.thread)].filter(Boolean);
  if (!actions.length) {
    return '';
  }
  return `<div class="thread-admin-action-group">${actions.join(' ')}</div>`;
}
function focusPermalinkPost(globalNumber, { scroll = false }: AnyRecord = {}) {
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
function renderCatalogThreads(threads) {
  const term = els.catalogSearchInput.value.trim();
  const visibleThreads = sortedCatalogThreads(
    threads.filter((thread) =>
      !isPostFiltered(thread) && catalogThreadMatchesFilter(thread, state.catalogFilter) && threadMatchesSearch(thread, term, state.boards)
    ),
    state.catalogSort
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
    renderMissingBoard('catalog');
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
function renderArchiveThreads(threads) {
  const visibleThreads = threads.filter((thread) => !isPostFiltered(thread));
  if (!visibleThreads.length) {
    els.archiveList.innerHTML = '<p class="muted">Kho lưu trữ chưa có chủ đề.</p>';
    return;
  }
  els.archiveList.innerHTML = visibleThreads.map(archiveThreadHtml).join('');
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
    (thread) => !hidden.has(String(thread.id)) && !isPostFiltered(thread) && threadMatchesSearch(thread, term, state.boards)
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
    renderMissingBoard('board');
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
async function loadThread({ resetReply = false, focusPost = '' }: AnyRecord = {}) {
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
  watchlistController.syncWatchedThreadFromDetail(detail);
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
    ${threadSearchHtml(detail, state.threadSearchTerm)}
    ${commentSortHtml(state.commentsSort)}
    <div class="comment-list">
      ${threadCommentsHtml(visibleComments, {
        opNumber: detail.thread.globalNumber,
        opPosterHash: detail.thread.posterHash,
        canReply
      })}
    </div>
  `;
  els.threadPagination.innerHTML = pageControlsHtml(state.threadCommentPageMeta, 'thread-comments');
  syncThreadMediaToolbarState();
  const focusedPost = requestedPost;
  focusPermalinkPost(focusedPost, { scroll: Boolean(focusPost) });
  syncThreadPostCollapseToolbarState();
  resetAutoUpdateTimer();
}
let adminLoadRequestId = 0;
let adminLoadController = null;
async function loadAdmin() {
  const requestId = ++adminLoadRequestId;
  const requestedTab = state.adminTab;
  if (adminLoadController) {
    adminLoadController.abort();
  }
  adminLoadController = window.AbortController ? new AbortController() : null;
  const adminLoadSignal = adminLoadController?.signal;
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
    resetAdminModerationSettingsCache();
    adminLoadController = null;
    els.pendingList.innerHTML = '';
    els.reportList.innerHTML = '';
    els.moderationActions.innerHTML = '';
    els.reportSection.classList.add('hidden');
    els.moderationSection.classList.add('hidden');
    return;
  }
  renderAdminPasskeys();
  renderAdminTabs();
  els.pendingList.innerHTML = adminLoadingHtml();
  loadAdminModerationSettingsInBackground();
  try {
    const endpoint = adminEndpoint();
    const data = await api(endpoint, {
      signal: adminLoadSignal,
      timeoutMs: ADMIN_LOAD_TIMEOUT_MS,
      timeoutMessage: 'Dữ liệu quản trị phản hồi quá lâu, vui lòng thử lại.'
    });
    if (requestId !== adminLoadRequestId || requestedTab !== state.adminTab) {
      return;
    }
    if (requestedTab === 'analytics') {
      renderAdminAnalytics(data);
    } else if (requestedTab === 'health') {
      renderAdminHealth(data);
    } else {
      renderAdminItems(data);
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    if (error.setupRequired) {
      els.loginForm.classList.add('hidden');
      els.adminTools.classList.add('hidden');
      els.admin2FASetupPanel?.classList.remove('hidden');
      els.admin2FASetupStart?.classList.remove('hidden');
      els.admin2FASetupQR?.classList.add('hidden');
      showToast(error.message);
      return;
    }
    if (requestId !== adminLoadRequestId || requestedTab !== state.adminTab) {
      return;
    }
    if (!isAdminSessionError(error)) {
      renderAdminTabs();
      els.pendingList.innerHTML = adminLoadErrorHtml(error);
      showToast('Không tải được dữ liệu quản trị. Vui lòng thử cập nhật lại.');
      return;
    }
    state.token = '';
    localStorage.removeItem('adminToken');
    showToast(error.message);
    loadAdmin();
  } finally {
    if (requestId === adminLoadRequestId) {
      adminLoadController = null;
    }
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
const { syncDeletePasswordInputs, deletePasswordValue, bindDeletePasswordInputs } = createDeletePasswordController({
  deletePasswordInputs: els.deletePasswordInputs,
  formValue
});

const {
  submitThread,
  submitAppeal,
  submitComment,
  submitQuickReply,
  selfEditPost,
  selfDeletePost,
  openThreadComposer,
  closeThreadComposer,
  syncReplyComposer,
  openReplyComposer,
  closeReplyComposer,
  openQuickReply,
  closeQuickReply,
  bindComposerInputEvents
} = createComposerController({
  state,
  els,
  api,
  showToast,
  setButtonLoading,
  setFormError,
  resetHcaptcha,
  draftKey,
  readDraft,
  writeDraft,
  removeDraft,
  rememberMyPost,
  myPostDeletePassword,
  refreshCurrentScreen,
  loadThread,
  loadBoard,
  isCapcodeEligible,
  deletePasswordValue,
  clamp,
  showPostEditModal,
  postSubmitToast
});
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
function notifyWatchedThreadPost(payload: AnyRecord = {}) {
  notifyWatchedThreadPostWithDependencies(payload, {
    readWatchedThreads,
    writeWatchedThreads: watchlistController.writeWatchedThreads,
    browserNotificationIds: state.browserNotificationIds
  });
}
function setupRealtime() {
  setupRealtimeConnection({
    loadHome,
    loadThread,
    loadCatalog,
    loadArchive,
    loadBoard,
    audioWorkInProgress,
    notifyWatchedThreadPost
  });
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
function bindEvents() {
  const ai = createAiActions({
    showToast,
    setButtonLoading,
    postponeAutoUpdateForAudio,
    syncAutoUpdateControls,
    audioWorkInProgress
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('keydown', handleKeyboardShortcut);
  // Image error events don't bubble, so listen in the capture phase. When a
  // thumbnail fails to load (e.g. a stale storage URL returning 404), swap the
  // broken-image icon for a neutral placeholder instead of leaving it ugly.
  document.addEventListener('error', handleBrokenThumbnailError, true);
  bindBoardNavigationEvents({
    els,
    state,
    showToast,
    loadBoard,
    saveCurrentBoardSearch,
    renderCatalogThreads,
    openThreadComposer,
    openReplyComposer
  });
  els.threadForm.addEventListener('submit', submitThread);
  els.appealForm?.addEventListener('submit', submitAppeal);
  els.commentForm.addEventListener('submit', submitComment);
  els.quickReplyForm.addEventListener('submit', submitQuickReply);
  bindDeletePasswordInputs();
  bindComposerInputEvents();
  bindQuickReplyEvents({ els, state, closeQuickReply });
  bindReferencePreviewEvents();
  bindAiActionEvents({ els, ai });
  bindComposerMediaInputEvents({ els, state, showToast });
  bindThreadSearchEvents({ body: document.body, state, loadThread, normalizeThreadSearchTerm, showToast });
  bindThreadMediaKeyboardEvents({ body: document.body });
  document.body.addEventListener('click', async (event) => {
    const composerInsertButton = event.target.closest('[data-composer-insert]');
    if (composerInsertButton) {
      const pickerRoot = composerInsertButton.closest('[data-composer-picker]');
      insertComposerToken(pickerRoot?.dataset.composerPicker, composerInsertButton.dataset.composerInsert, { showToast });
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
    const threadMediaJump = event.target.closest('[data-thread-media-jump]');
    if (threadMediaJump) {
      event.preventDefault();
      focusPermalinkPost(threadMediaJump.dataset.threadMediaJump, { scroll: true });
      return;
    }
    if (handleThreadMediaClick(event, { showToast })) {
      return;
    }
    const quickReplyNumber = event.target.closest('[data-quick-reply]');
    if (quickReplyNumber) {
      openQuickReply(quickReplyNumber.dataset.quickReply, event);
      return;
    }
    const selfDeletePostButton = event.target.closest('[data-self-delete-post]');
    if (selfDeletePostButton) {
      try {
        await selfDeletePost(selfDeletePostButton.dataset.selfDeletePost, {
          fileOnly: selfDeletePostButton.dataset.fileOnly === 'true',
          sourceElement: selfDeletePostButton
        });
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    const selfEditPostButton = event.target.closest('[data-self-edit-post]');
    if (selfEditPostButton) {
      try {
        await selfEditPost(
          selfEditPostButton.dataset.selfEditPost,
          decodeURIComponent(selfEditPostButton.dataset.selfEditBody || '')
        );
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
      const payload: AnyRecord = { body: edit.body };
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
      watchlistController.removeWatchedThread(unwatchThreadButton.dataset.unwatchThread);
      showToast('Đã bỏ theo dõi chủ đề.');
      if ((window.location.hash || '#home').startsWith('#home')) {
        state.watchedThreadSummaries = await watchlistController.loadWatchedThreadSummaries();
        watchlistController.renderWatchedThreads();
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
      watchlistController.renderWatchedThreads();
      persistAccountSettings({ silent: true });
      showToast(displayPreferences.watchedUnreadOnly ? 'Đang chỉ hiện thread chưa đọc.' : 'Đang hiện toàn bộ watchlist.');
      return;
    }
    const watchedMarkAllRead = event.target.closest('#watchedMarkAllRead');
    if (watchedMarkAllRead) {
      const count = watchlistController.markAllWatchedThreadsRead();
      watchlistController.renderWatchedThreads();
      if (count) {
        persistAccountSettings({ silent: true });
        showToast(`Đã đánh dấu ${count.toLocaleString()} chủ đề là đã đọc.`);
      }
      return;
    }
    const markWatchReadButton = event.target.closest('[data-mark-watch-read]');
    if (markWatchReadButton) {
      if (watchlistController.markWatchedThreadRead(markWatchReadButton.dataset.markWatchRead)) {
        watchlistController.renderWatchedThreads();
        persistAccountSettings({ silent: true });
        showToast('Đã đánh dấu chủ đề là đã đọc.');
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
      insertThreadTemplate(threadTemplateButton.dataset.threadTemplate, { showToast });
      return;
    }
    const threadTemplateDismissButton = event.target.closest('[data-thread-template-dismiss]');
    if (threadTemplateDismissButton) {
      dismissThreadTemplate({ showToast });
      return;
    }
    const removeSavedSearchButton = event.target.closest('[data-remove-saved-search]');
    if (removeSavedSearchButton) {
      removeSavedSearch(removeSavedSearchButton.dataset.removeSavedSearch);
      return;
    }
    const accountPrivateDataClick = handleAccountPrivateDataClick(event);
    if (accountPrivateDataClick) {
      await accountPrivateDataClick;
      return;
    }
    const accountPasskeyClick = handleAccountPasskeyClick(event);
    if (accountPasskeyClick) {
      await accountPasskeyClick;
      return;
    }
    const adminPasskeyClick = handleAdminPasskeyClick(event);
    if (adminPasskeyClick) {
      await adminPasskeyClick;
      return;
    }
    const boardCatalogControlClick = handleBoardCatalogControlClick(event, {
      state,
      showToast,
      loadBoard,
      loadCatalog,
      loadArchive,
      renderCatalogThreads,
      toggleBoardSubscription,
      syncBoardSubscriptionButtons
    });
    if (boardCatalogControlClick) {
      await boardCatalogControlClick;
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
    const filterPosterButton = event.target.closest('[data-filter-poster]');
    if (filterPosterButton) {
      const posterIdValue = filterPosterButton.dataset.filterPoster || '';
      if (!posterIdValue || posterIdValue === 'ID:????') {
        showToast('Không có Poster ID để lọc.');
        return;
      }
      addContentFilter({
        type: 'poster',
        value: posterIdValue,
        label: posterIdValue,
        boardSlug: filterPosterButton.dataset.filterBoard || ''
      });
      showToast('Đã thêm bộ lọc Poster ID.');
      return;
    }
    const notePosterButton = event.target.closest('[data-note-poster]');
    if (notePosterButton) {
      const posterIdValue = notePosterButton.dataset.notePoster || '';
      if (!posterIdValue || posterIdValue === 'ID:????') {
        showToast('Không có Poster ID để ghi chú.');
        return;
      }
      const label = window.prompt('Nhãn cho ' + posterIdValue + ':', posterIdValue) || '';
      if (!label.trim()) {
        return;
      }
      const note = window.prompt('Ghi chú cho ' + posterIdValue + ':', '') || '';
      addPosterNote({
        posterId: posterIdValue,
        label,
        note,
        boardSlug: notePosterButton.dataset.noteBoard || ''
      });
      showToast('Đã lưu ghi chú Poster ID.');
      return;
    }
    const translatePostButton = event.target.closest('[data-translate-post]');
    if (translatePostButton) {
      await ai.translatePost(translatePostButton);
      return;
    }
    const ttsPostButton = event.target.closest('[data-tts-post]');
    if (ttsPostButton) {
      await ai.speakPost(ttsPostButton);
      return;
    }
    const copyPostLinkButton = event.target.closest('[data-copy-post-link]');
    if (copyPostLinkButton) {
      await copyPostPermalink(copyPostLinkButton.dataset.copyPostLink);
      return;
    }
    if (handleThreadPostCollapseClick(event, { showToast })) {
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
    const referencePreviewClick = await handleReferencePreviewClick(event);
    if (referencePreviewClick) {
      return;
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
        const result = await api(`/api/posts/${globalNumber}/reactions`, {
          auth: state.accountToken ? 'account' : 'none',
          method: 'POST',
          body: JSON.stringify({ reaction, posterToken: state.posterToken })
        });
        writeReaction(globalNumber, result.myReaction || '');
        await refreshCurrentScreen();
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
    if (event.target.closest('#adminRefresh, [data-admin-retry]')) {
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
      const isTableDetail = Boolean(adminDetailButton.closest('tr')?.closest('.moderation-log-table'));
      const tableHost = isTableDetail ? adminTableDetailHost(adminDetailButton) : null;
      if (isTableDetail && !tableHost) {
        return;
      }
      const host = tableHost || adminDetailButton.closest('.pending-item') || els.pendingList;
      if (!host) {
        return;
      }
      try {
        await loadAdminDetail(adminDetailButton.dataset.adminDetail, host, {
          compactReports: Boolean(tableHost)
        });
      } catch (error) {
        if (tableHost) {
          tableHost.innerHTML = `<div class="admin-detail-host"><p class="error">${escapeHtml(error.message)}</p></div>`;
        }
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
      watchlistController.renderWatchedThreads();
      persistAccountSettings({ silent: true });
      showToast('Đã đổi cách sắp xếp watchlist.');
    }
  });
  bindAccountFormEvents({
    els,
    state,
    api,
    showToast,
    setFormError,
    setButtonLoading,
    resetHcaptcha,
    finishAccountLogin,
    setAccountSession,
    fillAccountSettings,
    updateAccountNav,
    applyAccountSyncedSettings,
    applyTheme,
    applyDisplayPreferences,
    applyNotificationPreferences,
    resolveBrowserWatchedThreadPreference,
    writeLocalDisplayPreferences,
    writeLocalNotificationPreferences,
    writeSubscribedBoardSlugs,
    syncBoardSubscriptionButtons,
    homeBoardKey,
    render2FAState
  });
  bindAdminAuthEvents({
    els,
    state,
    api,
    showToast,
    setFormError,
    loadAdmin
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
  setupHcaptcha(showToast).catch((error) => showToast(error.message));
  syncAccountHomeBoardOptions();
  await loadAccountSession();
  syncAdminBoardFilter();
  route();
}
init().catch((error) => showToast(error.message));

