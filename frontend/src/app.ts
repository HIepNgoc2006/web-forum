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
import { createPostEditModal, showReasonModal, showReportModal } from './modals';
import { createPostClipboardActions, selectedPostQuoteText } from './post-clipboard';
import { bindThreadEvents } from './thread-events';
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
let renderAccountPrivateData = () => {};
let syncAdminBoardFilter = () => {};
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
  updateAccountDisplayOptions,
  isCapcodeEligible,
  updateCapcodeOptions
} = accountPreferencesController;
const syncAccountHomeBoardOptions = accountPreferencesController.syncAccountHomeBoardOptions;
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
  renderAccountRecoveryPanel,
  saveCurrentBoardSearch,
  removeSavedSearch,
  loadAccountSession,
  loadAccountSettings
} = accountUiController;
renderAccountPrivateData = renderAccountPrivateDataFromController;
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
  els.accountHomeBoard.value = settings.homeBoard || state.boardSlug || 'confession';
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
  const adminEventDependencies = {
    els,
    state,
    showToast,
    setButtonLoading,
    api,
    loadAdmin,
    loadThread,
    loadBoard,
    refreshPublicBoards: homeController.refreshPublicBoards,
    saveAdminModerationSettings,
    exportAdminCsv,
    adminBoardPayload,
    adminUserPayload,
    loadAdminDetail,
    adminTableDetailHost,
    showReasonModal,
    showPostEditModal,
    bulkModerate
  };
  bindThreadEvents({
    body: document.body,
    els,
    state,
    showToast,
    api,
    loadThread,
    loadBoard,
    loadCatalog,
    loadArchive,
    refreshCurrentScreen,
    openQuickReply,
    openReplyComposer,
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
    setAutoUpdate,
    showReportModal,
    translatePost: ai.translatePost,
    speakPost: ai.speakPost,
    writeReaction,
    writeVote
  });
  const boardCatalogEventDependencies = {
    state,
    showToast,
    loadBoard,
    loadCatalog,
    loadArchive,
    renderCatalogThreads,
    toggleBoardSubscription: homeController.toggleBoardSubscription,
    syncBoardSubscriptionButtons: homeController.syncBoardSubscriptionButtons
  };
  document.body.addEventListener('click', async (event) => {
    const boardCatalogControlClick = handleBoardCatalogControlClick(event, boardCatalogEventDependencies);
    if (boardCatalogControlClick) {
      await boardCatalogControlClick;
      return;
    }
    if (await handleAdminClick(event, adminEventDependencies)) {
      return;
    }
  });
  document.body.addEventListener('change', (event) => {
    if (handleAdminChange(event, adminEventDependencies)) {
      return;
    }
    const autoUpdate = event.target.closest('[data-auto-update]');
    if (autoUpdate) {
      setAutoUpdate(autoUpdate.checked);
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
    syncBoardSubscriptionButtons: homeController.syncBoardSubscriptionButtons,
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
  await homeController.refreshPublicBoards({ fallbackBoards: config.boards });
  setupHcaptcha(showToast).catch((error) => showToast(error.message));
  syncAccountHomeBoardOptions();
  await loadAccountSession();
  syncAdminBoardFilter();
  route();
}
init().catch((error) => showToast(error.message));





