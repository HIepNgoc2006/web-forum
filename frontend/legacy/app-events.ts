import { createAiActions } from './ai-actions';
import { bindAiActionEvents } from './ai-events';
import { bindComposerMediaInputEvents, updateDraftMeter } from './composer';
import { bindComposerMediaPicker } from './composer-media-picker';
import { bindComposerFormatToolbars } from './composer-format';
import { bindBoardNavigationEvents, handleBoardCatalogControlClick } from './board-events';
import { bindAccountFormEvents } from './account-form-events';
import { bindAdminAuthEvents } from './admin-auth-events';
import { bindQuickReplyEvents } from './quick-reply-events';
import { bindThreadSearchEvents } from './thread-search';
import { handleAdminChange, handleAdminClick } from './admin-events';
import { bindThreadEvents } from './thread-events';
import { handleBrokenThumbnailError } from './events';
import { bindThreadMediaKeyboardEvents } from './thread-dom';
import type { AnyRecord } from './types';

export function bindEvents(dependencies: AnyRecord): void {
  const {
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
    closeReplyComposer,
    api,
    loadThread,
    loadCatalog,
    loadArchive,
    refreshCurrentScreen,
    loadBoard,
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
    addHiddenPost,
    removeHiddenPost,
    clearHiddenPosts,
    addHiddenThread,
    removeHiddenThread,
    clearHiddenThreads,
    renderBoardThreads,
    renderBrowserHiddenData,
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
    writeHiddenBoardSlugs,
    syncBoardSubscriptionButtons,
    syncBoardHiddenButtons,
    homeBoardKey,
    render2FAState,
    saveAdminModerationSettings,
    exportAdminCsv,
    adminBoardPayload,
    adminUserPayload,
    adminSiteContentPayload,
    applySiteContent,
    loadAdminDetail,
    adminTableDetailHost,
    bulkModerate,
    showReasonModal,
    refreshPublicBoards,
    toggleBoardSubscription,
    toggleBoardHidden,
    loadAdmin,
    closeQuickReply,
    homeControllerRefreshPublicBoards,
    homeControllerToggleBoardSubscription,
    homeControllerSyncBoardSubscriptionButtons,
    homeControllerToggleBoardHidden,
    homeControllerSyncBoardHiddenButtons
  } = dependencies;

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
    openReplyComposer,
    closeReplyComposer
  });

  els.threadForm.addEventListener('submit', submitThread);
  els.appealForm?.addEventListener('submit', submitAppeal);
  els.commentForm.addEventListener('submit', submitComment);
  els.quickReplyForm.addEventListener('submit', submitQuickReply);
  bindDeletePasswordInputs();
  bindComposerInputEvents();
  bindComposerFormatToolbars({ els, showToast });
  updateDraftMeter(els.commentBody, els.commentDraftMeter);
  updateDraftMeter(els.quickReplyBody, els.quickReplyDraftMeter);
  bindQuickReplyEvents({
    els,
    state,
    closeQuickReply
  });
  bindReferencePreviewEvents();
  bindAiActionEvents({
    els,
    ai
  });
  bindComposerMediaInputEvents({
    els,
    state,
    showToast,
    maxMediaBytes: () => Number(state.maxImageBytes) || undefined
  });
  bindThreadSearchEvents({
    body: document.body,
    state,
    loadThread,
    normalizeThreadSearchTerm,
    showToast
  });
  bindThreadMediaKeyboardEvents({
    body: document.body
  });

  const adminEventDependencies = {
    els,
    state,
    showToast,
    setButtonLoading,
    api,
    loadAdmin,
    loadThread,
    loadBoard,
    refreshPublicBoards: refreshPublicBoards || homeControllerRefreshPublicBoards,
    saveAdminModerationSettings,
    exportAdminCsv,
    adminBoardPayload,
    adminUserPayload,
    adminSiteContentPayload,
    applySiteContent,
    loadAdminDetail,
    adminTableDetailHost,
    showReasonModal,
    showPostEditModal,
    bulkModerate
  };

  bindComposerMediaPicker({
    api,
    insertComposerToken,
    showToast
  });

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
    openReplyComposer,
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
    addHiddenPost,
    removeHiddenPost,
    clearHiddenPosts,
    addHiddenThread,
    removeHiddenThread,
    clearHiddenThreads,
    renderBoardThreads,
    renderBrowserHiddenData,
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
    toggleBoardSubscription: toggleBoardSubscription || homeControllerToggleBoardSubscription,
    syncBoardSubscriptionButtons: syncBoardSubscriptionButtons || homeControllerSyncBoardSubscriptionButtons,
    toggleBoardHidden: toggleBoardHidden || homeControllerToggleBoardHidden,
    syncBoardHiddenButtons: syncBoardHiddenButtons || homeControllerSyncBoardHiddenButtons
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

    const themeSelect = event.target.closest('[data-theme-select]');
    if (themeSelect) {
      applyTheme(themeSelect.value);
      persistAccountSettings({ silent: true });
      return;
    }

    const commentSort = event.target.closest('[data-comment-sort]');
    if (commentSort) {
      state.commentsSort = commentSort.value;
      state.threadCommentPage = 1;
      loadThread().catch((error) => showToast(error.message));
      return;
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
      return;
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
    writeHiddenBoardSlugs,
    syncBoardSubscriptionButtons,
    syncBoardHiddenButtons,
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
