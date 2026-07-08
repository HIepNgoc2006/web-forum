import { resetHcaptcha, setupHcaptcha } from './hcaptcha';
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
  loadAdmin,
  renderPostLines,
  showReasonModal,
  adminLoadTimeoutMs: ADMIN_LOAD_TIMEOUT_MS,
  adminLoadTimeoutMessage: 'Chi tiết bài viết phản hồi quá lâu, vui lòng thử lại.'
});
syncAdminBoardFilter = syncAdminBoardFilterFromHelpers;

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

function currentPermalinkPost() {
  return new URLSearchParams((window.location.hash || '').split('?')[1] || '').get('p') || '';
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
async function loadCatalog() {
  const board = currentBoard();
  if (!board) {
    renderMissingBoard('catalog');
    return;
  }
  setScreen('catalog');
  homeController.renderBoards();
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
async function loadArchive() {
  const board = state.boards.find((item) => item.slug === state.boardSlug);
  setScreen('archive');
  homeController.renderBoards();
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
async function loadBoard() {
  const board = currentBoard();
  if (!board) {
    renderMissingBoard('board');
    return;
  }
  setScreen('board');
  homeController.renderBoards();
  homeController.syncBoardSubscriptionButtons();
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
  homeController.renderBoards();
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
  loadHome,
  loadThread,
  loadCatalog,
  loadArchive,
  loadBoard,
  loadAccountSettings,
  loadAdmin,
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
async function init() {
  bindEvents({
    els,
    state,
    showToast,
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
    focusPermalinkPost,
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
    applyTheme,
    persistAccountSettings,
    localDisplayPreferences,
    applyDisplayPreferences,
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
    applyNotificationPreferences,
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
    closeQuickReply
  });
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
  await homeController.refreshPublicBoards({ fallbackBoards: config.boards });
  setupHcaptcha(showToast).catch((error) => showToast(error.message));
  syncAccountHomeBoardOptions();
  await loadAccountSession();
  syncAdminBoardFilter();
  route();
}
init().catch((error) => showToast(error.message));





















