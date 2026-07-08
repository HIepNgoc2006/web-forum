import { createAiActions } from './ai-actions';
import { bindAiActionEvents } from './ai-events';
import { bindBoardNavigationEvents, handleBoardCatalogControlClick } from './board-events';
import { bindAccountFormEvents } from './account-form-events';
import { bindAdminAuthEvents } from './admin-auth-events';
import { bindQuickReplyEvents } from './quick-reply-events';
import { bindThreadSearchEvents } from './thread-search';
import { handleAdminChange, handleAdminClick } from './admin-events';
import { bindThreadEvents } from './thread-events';
import { bindComposerMediaInputEvents } from './composer';
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
    syncBoardSubscriptionButtons,
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
    refreshPublicBoards,
    toggleBoardSubscription,
    loadAdmin,
    closeQuickReply,
    homeControllerRefreshPublicBoards,
    homeControllerToggleBoardSubscription,
    homeControllerSyncBoardSubscriptionButtons
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
    openReplyComposer
  });

  els.threadForm.addEventListener('submit', submitThread);
  els.appealForm?.addEventListener('submit', submitAppeal);
  els.commentForm.addEventListener('submit', submitComment);
  els.quickReplyForm.addEventListener('submit', submitQuickReply);
  bindDeletePasswordInputs();
  bindComposerInputEvents();
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
    showToast
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
    toggleBoardSubscription: toggleBoardSubscription || homeControllerToggleBoardSubscription,
    syncBoardSubscriptionButtons: syncBoardSubscriptionButtons || homeControllerSyncBoardSubscriptionButtons
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
