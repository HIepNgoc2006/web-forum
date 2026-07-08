import { resetHcaptcha } from './hcaptcha';
import { createAiActions } from './ai-actions';
import { bindAiActionEvents } from './ai-events';
import { createAdminModerationSettingsController } from './admin-moderation-settings';
import { createAdminHelpers } from './admin-helpers';
import { api } from './api';
import { createAccountPreferencesController } from './account-preferences';
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
  normalizeBoardFilter,
  normalizeBoardSort,
  omittedRepliesHtml,
  popularThreadsFrom,
  threadMatchesSearch
} from './board';
import { bindBoardNavigationEvents, handleBoardCatalogControlClick } from './board-events';
import { createAccountStateController } from './account-state';
import { createAccountUiController } from './account-ui';
import { createAccountScreenController } from './account-screen';
import { handleAdminChange, handleAdminClick } from './admin-events';
import {
  archiveThreadHtml,
  catalogThreadHtml,
  catalogThreadMatchesFilter,
  normalizeCatalogSort,
  sortedCatalogThreads
} from './catalog';
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
import { createAutoUpdateController } from './autoupdate';
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
import { createHomeLoadController } from './home-loader';
import { eventInTextInput, moveKeyboardNavigation } from './keyboard';
import { createRouterController } from './router';
import { createThreadBoardRenderers } from './thread-board-renderers';
import { createPostEditModal, showReasonModal, showReportModal } from './modals';
import { createPostClipboardActions, selectedPostQuoteText } from './post-clipboard';
import { bindThreadEvents } from './thread-events';
import { bindQuickReplyEvents } from './quick-reply-events';
import { bindEvents } from './app-events';
import { bootstrapApp } from './bootstrap';
import { createBoardLoadController } from './board-loader';
import { createAdminLoadController } from './admin-loader';
import { createThreadLoadController } from './thread-loader';
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
import { createScreenHelpers } from './screen-helpers';
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
  homeBoardKey,
  hiddenThreadsKey,
  hiddenPostsKey,
  boardThreadsCachePrefix,
  MAX_MEDIA_PER_POST,
} from './constants';
import {
  escapeHtml,
  moderationPriorityHtml,
  moderationConfidenceHtml,
  moderationLabelText,
  moderationStatusText,
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
let syncAdminBoardFilter = () => {};
let renderAccountPrivateData = () => {};
let renderPasskeys = () => {};
let renderAccountRecoveryPanel = () => {};
let applyAccountNavState = () => {};
let loadAdmin = async () => {};
let loadThread: (options?: AnyRecord) => Promise<any> = async () => {};
function updateAccountNav() {
  applyAccountNavState();
}
const accountPreferencesController = createAccountPreferencesController({
  state,
  els,
  api,
  applyNotificationPreferences,
  updateAccountNav: () => updateAccountNav(),
  renderAccountPrivateData: () => renderAccountPrivateData()
});
const {
  applyTheme,
  applyDisplayPreferences,
  accountSettingsFromLocal,
  syncAccountBoardSubscriptionOptions,
  applyAccountSyncedSettings,
  persistAccountSettings,
  setAccountSession,
  isCapcodeEligible,
  updateCapcodeOptions,
  updateAccountDisplayOptions
} = accountPreferencesController;
const syncAccountHomeBoardOptions = accountPreferencesController.syncAccountHomeBoardOptions;
const {
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
  renderAccountPrivateData: () => renderAccountPrivateData(),
  renderReplyTemplatePickers: () => {
    if (replyTemplateController?.renderReplyTemplatePickers) {
      replyTemplateController.renderReplyTemplatePickers();
    }
  }
});
const watchlistController = createWatchlistController({ isPostFiltered, scheduleAccountPrivateDataSave });
const placeholderScreenHelpers: AnyRecord = {
  setScreen() {},
  currentBoard() { return null; },
  renderMissingBoard() {},
  boardThreadsCacheKey() { return ''; },
  firstBoardPageFromThreads() { return { items: [], page: 1, pageSize: 0, total: 0, totalPages: 1, hasMore: false }; },
  writeBoardThreadsCache() { return { threads: [], meta: { page: 1, pageSize: 0, total: 0, totalPages: 1, hasMore: false }, cachedAt: Date.now() }; },
  readBoardThreadsCache() { return null; },
  updateBoardPresentation() {},
  toggleCurrentThreadWatch() {},
  pageControlsHtml() { return ''; }
};
let screenHelpers: AnyRecord = placeholderScreenHelpers;
const homeController = createHomeController({
  isPostFiltered,
  writeBoardThreadsCache,
  persistAccountSettings,
  syncAdminBoardFilter,
  showToast
});
accountPreferencesController.setHomeSyncCallbacks({
  syncBoardSubscriptionButtons: homeController.syncBoardSubscriptionButtons,
  renderSubscribedBoards
});
const replyTemplateController = createReplyTemplateComposerController({
  state,
  readReplyTemplates,
  addReplyTemplate,
  showToast,
  composerTextarea,
  insertComposerBlock
});
const { renderReplyTemplatePickers, insertReplyTemplate, saveComposerReplyTemplate } = replyTemplateController;
const accountScreenController = createAccountScreenController({
  state,
  els,
  accountSettingsFromLocal,
  syncAccountBoardSubscriptionOptions,
  updateCapcodeOptions,
  updateAccountDisplayOptions,
  localDisplayPreferences,
  localNotificationPreferences,
  syncBrowserNotificationControls,
  renderPasskeys: () => renderPasskeys(),
  renderAccountPrivateData: () => renderAccountPrivateData(),
  renderAccountRecoveryPanel: () => renderAccountRecoveryPanel(),
  adminUsernameFromToken,
  render2FAState
});
const {
  fillAccountSettings,
  render2FASection,
  updateAccountNavState
} = accountScreenController;
applyAccountNavState = updateAccountNavState;
function render2FAState() {
  render2FASection();
}
const accountUiController = createAccountUiController({
  state,
  els,
  api,
  showToast,
  setScreen,
  setFormError,
  syncAccountHomeBoardOptions,
  applyAccountSyncedSettings,
  fillAccountSettings,
  updateAccountNav,
  readSavedSearches,
  writeSavedSearches,
  readContentFilters,
  readReplyTemplates,
  readPosterNotes,
  renderReplyTemplatePickers,
  setAccountSession,
  refreshAccountPostNumbers,
  loadAccountPrivateData,
  loadCurrentBoard: currentBoard,
  render2FAState
});
const {
  renderAccountPrivateData: renderAccountPrivateDataFromController,
  renderAccountRecoveryPanel: renderAccountRecoveryPanelFromController,
  saveCurrentBoardSearch,
  removeSavedSearch,
  loadAccountSession,
  loadAccountSettings
} = accountUiController;
renderAccountPrivateData = renderAccountPrivateDataFromController;
renderAccountRecoveryPanel = renderAccountRecoveryPanelFromController;
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
const { renderPasskeys: renderPasskeysFromController, handleAccountPasskeyClick } = bindAccountPasskeyEvents({
  els,
  state,
  api,
  showToast,
  setFormError,
  setButtonLoading,
  finishAccountLogin
});
renderPasskeys = renderPasskeysFromController;
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
function setScreen(name) {
  return screenHelpers.setScreen(name);
}
function currentBoard() {
  return screenHelpers.currentBoard();
}
function renderMissingBoard(screen = 'board') {
  return screenHelpers.renderMissingBoard(screen);
}
function boardThreadsCacheKey(options = {}) {
  return screenHelpers.boardThreadsCacheKey(options);
}
function firstBoardPageFromThreads(threads = [], options = {}) {
  return screenHelpers.firstBoardPageFromThreads(threads, options);
}
function writeBoardThreadsCache(boardSlug, payload, options = {}) {
  return screenHelpers.writeBoardThreadsCache(boardSlug, payload, options);
}
function readBoardThreadsCache(options = {}) {
  return screenHelpers.readBoardThreadsCache(options);
}
function updateBoardPresentation(board = null) {
  return screenHelpers.updateBoardPresentation(board);
}
function toggleCurrentThreadWatch() {
  return screenHelpers.toggleCurrentThreadWatch();
}
function pageControlsHtml(meta, actionName) {
  return screenHelpers.pageControlsHtml(meta, actionName);
}
const canModerateFromAdminToken = () => {
  const payload = decodeJwtPayload(state.token);
  return Boolean(payload && ['admin', 'owner', 'moderator'].includes(payload.role));
};

const {
  renderPostLines,
  meta,
  postHtml,
  threadCommentsHtml,
  threadToolbarHtml,
  threadHeaderActionsHtml,
  boardReplyPreviewsHtml,
  renderBoardThreads,
  renderCatalogThreads,
  renderArchiveThreads
} = createThreadBoardRenderers({
  state,
  els,
  isMyPost,
  isAccountPost,
  isPostFiltered,
  readHiddenThreadIds: hiddenThreadIds,
  isThreadWatched,
  pageControlsHtml,
  canModerateFromAdminToken,
  posterNoteForPost
});

const autoUpdateController = createAutoUpdateController({
  state,
  loadThread: () => loadThread(),
  showToast
});
const {
  syncAutoUpdateControls,
  stopAutoUpdateTimer,
  audioWorkInProgress,
  postponeAutoUpdateForAudio,
  resetAutoUpdateTimer,
  setAutoUpdate
} = autoUpdateController;

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

const {
  deletedPostsHtml,
  pendingPostsHtml,
  editHistoryMediaHtml,
  editHistoryHtml,
  adminPostDetailHtml,
  renderAdminAnalytics,
  renderAdminHealth,
  adminQueryString,
  adminEndpoint,
  isAdminSessionError,
  isAbortError,
  renderAdminTabs,
  renderAdminItems,
  exportAdminCsv,
  syncAdminBoardFilter: syncAdminBoardFilterFromHelpers,
  loadAdminDetail,
  adminTableDetailHost,
  selectedPendingIds,
  bulkModerate
} = createAdminHelpers({
  state,
  els,
  showToast,
  api,
  loadAdmin: (...args) => loadAdmin(...args),
  renderPostLines,
  showReasonModal,
  adminLoadTimeoutMs: ADMIN_LOAD_TIMEOUT_MS,
  adminLoadTimeoutMessage: 'Chi tiết bài viết phản hồi quá lâu, vui lòng thử lại.'
});
syncAdminBoardFilter = syncAdminBoardFilterFromHelpers;
loadAdmin = createAdminLoadController({
  state,
  els,
  api,
  showToast,
  setScreen,
  updateAccountNav,
  renderAdminPasskeys,
  renderAdminTabs,
  renderAdminLoading: () => adminLoadingHtml(),
  renderAdminItems,
  renderAdminAnalytics,
  renderAdminHealth,
  renderAdminError: (error) => adminLoadErrorHtml(error),
  resetAdminModerationSettingsCache,
  loadAdminModerationSettingsInBackground,
  adminEndpoint,
  adminLoadTimeoutMs: ADMIN_LOAD_TIMEOUT_MS,
  isAbortError,
  isAdminSessionError
}).loadAdmin;

const { loadHome } = createHomeLoadController({
  setScreen,
  state,
  homeController,
  renderHomeBoards,
  renderMyPosts,
  renderSubscribedBoards,
  renderHotBoards,
  renderCampusPulse,
  renderStats,
  api,
  watchlistController
});

const boardLoadController = createBoardLoadController({
  state,
  els,
  api,
  homeController,
  setScreen,
  boardHeading,
  currentBoard,
  renderMissingBoard,
  updateBoardPresentation,
  openThreadComposer: (options) => openThreadComposer(options),
  closeThreadComposer: () => closeThreadComposer(),
  boardThreadsCacheKey,
  readBoardThreadsCache,
  writeBoardThreadsCache,
  renderBoardThreads,
  renderCatalogThreads,
  renderArchiveThreads
});
const {
  loadCatalog,
  loadArchive,
  loadBoard
} = boardLoadController;
loadThread = createThreadLoadController({
  state,
  els,
  api,
  setScreen,
  currentBoard,
  homeController,
  updateBoardPresentation,
  boardHeading,
  threadTitle,
  threadHeaderActionsHtml,
  threadToolbarHtml,
  threadMediaGalleryHtml,
  threadSearchHtml,
  commentSortHtml,
  postHtml,
  threadCommentsHtml,
  pageControlsHtml,
  escapeHtml,
  formatPostDate,
  hiddenPostNumbers,
  isPostFiltered,
  readThreadLastSeen,
  writeThreadLastSeen,
  maxThreadPostNumber,
  watchlistController,
  setupRealtime: () => setupRealtime(),
  closeReplyComposer: (options) => closeReplyComposer(options),
  syncReplyComposer: () => syncReplyComposer(),
  syncThreadMediaToolbarState,
  syncThreadPostCollapseToolbarState,
  resetAutoUpdateTimer,
  normalizeThreadSearchTerm
}).loadThread;
let openReplyComposerTarget = (_options: AnyRecord = {}) => {};
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
const { syncDeletePasswordInputs, deletePasswordValue, bindDeletePasswordInputs } = createDeletePasswordController({
  deletePasswordInputs: els.deletePasswordInputs,
  formValue
});
function notifyWatchedThreadPost(payload: AnyRecord = {}) {
  notifyWatchedThreadPostWithDependencies(payload, {
    readWatchedThreads,
    writeWatchedThreads: watchlistController.writeWatchedThreads,
    browserNotificationIds: state.browserNotificationIds
  });
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
const routerController = createRouterController({
  els,
  state,
  showToast,
  hideReferencePreview,
  setFormError,
  setScreen,
  loadHome: () => loadHome(),
  loadThread: (options?: AnyRecord) => loadThread(options),
  loadCatalog: () => loadCatalog(),
  loadArchive: () => loadArchive(),
  loadBoard: () => loadBoard(),
  loadAccountSettings,
  loadAdmin: () => loadAdmin(),
  resetForgotPasswordForm,
  normalizeBoardSort,
  normalizeBoardFilter,
  setupRealtime,
  moveKeyboardNavigation,
  eventInTextInput,
  openReplyComposer: (options) => openReplyComposerTarget(options)
});
const {
  route,
  refreshCurrentScreen,
  handleKeyboardShortcut
} = routerController;
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
openReplyComposerTarget = openReplyComposer;
screenHelpers = createScreenHelpers({
  state,
  els,
  homeController,
  stopAutoUpdateTimer,
  closeThreadComposer,
  showToast,
  readWatchedThreads,
  writeWatchedThreads: watchlistController.writeWatchedThreads,
  watchedThreadEntryFromDetail,
  threadToolbarHtml,
  boardThreadsCachePrefix
});


bootstrapApp({
  els,
  bindEvents,
  syncDeletePasswordInputs,
  applyTheme,
  applyDisplayPreferences,
  applyNotificationPreferences,
  setButtonLoading,
  route,
  handleKeyboardShortcut,
  submitThread,
  submitAppeal,
  submitComment,
  submitQuickReply,
  bindDeletePasswordInputs,
  bindComposerInputEvents,
  postponeAutoUpdateForAudio,
  syncAutoUpdateControls,
  audioWorkInProgress,
  saveCurrentBoardSearch,
  renderCatalogThreads,
  openThreadComposer,
  openReplyComposer,
  api,
  loadThread,
  loadCatalog,
  loadArchive,
  refreshCurrentScreen,
  openQuickReply,
  loadBoard,
  setAutoUpdate,
  updatePrivacyWarning,
  selfDeletePost,
  selfEditPost,
  showPostEditModal,
  rememberMyPost,
  refreshAccountPostNumbers,
  renderMyPosts,
  insertComposerToken,
  insertThreadTemplate,
  saveComposerReplyTemplate,
  dismissThreadTemplate,
  insertReplyTemplate,
  handleThreadMediaClick,
  handleThreadPostCollapseClick,
  copyPostPermalink,
  selectedPostQuoteText,
  handleReferencePreviewClick,
  addLocalSetItem,
  hiddenThreadsKey,
  hiddenPostsKey,
  renderBoardThreads,
  addContentFilter,
  addPosterNote,
  watchlistController,
  toggleCurrentThreadWatch,
  removeSavedSearch,
  handleAccountPrivateDataClick,
  handleAccountPasskeyClick,
  handleAdminPasskeyClick,
  persistAccountSettings,
  localDisplayPreferences,
  normalizeWatchedSort,
  showReportModal,
  writeReaction,
  writeVote,
  bindReferencePreviewEvents,
  normalizeThreadSearchTerm,
  setFormError,
  resetHcaptcha,
  finishAccountLogin,
  setAccountSession,
  fillAccountSettings,
  updateAccountNav,
  applyAccountSyncedSettings,
  resolveBrowserWatchedThreadPreference,
  writeLocalDisplayPreferences,
  writeLocalNotificationPreferences,
  writeSubscribedBoardSlugs,
  syncBoardSubscriptionButtons: homeController.syncBoardSubscriptionButtons,
  homeBoardKey,
  render2FAState,
  saveAdminModerationSettings,
  exportAdminCsv,
  adminBoardPayload,
  adminUserPayload,
  loadAdminDetail,
  adminTableDetailHost,
  bulkModerate,
  showReasonModal,
  refreshPublicBoards: homeController.refreshPublicBoards,
  toggleBoardSubscription: homeController.toggleBoardSubscription,
  loadAdmin,
  closeQuickReply,
  syncAccountHomeBoardOptions,
  loadAccountSession,
  syncAdminBoardFilter,
  syncAdminModerationSettings,
  state,
  showToast
}).catch((error: any) => showToast(error.message));


