import type { AnyRecord } from './types';
import { applyReactionControls, setReactionControlsBusy } from './post-controls';
import { focusPermalinkPost } from './thread-dom';

/** Posts with an in-flight reaction request (prevents double-count / toggle races). */
const pendingReactionPosts = new Set<string>();

type ThreadEventDependencies = {
  body?: EventTarget | null;
  els: AnyRecord;
  state: AnyRecord;
  showToast: (message: string, options?: { actionLabel?: string; onAction?: () => void; durationMs?: number }) => void;
  api: (input: string, options?: AnyRecord) => Promise<AnyRecord>;
  loadThread: (options?: AnyRecord) => Promise<any>;
  loadBoard: () => Promise<any>;
  loadCatalog: () => Promise<any>;
  loadArchive: () => Promise<any>;
  refreshCurrentScreen: () => Promise<any>;
  openQuickReply: (number: string, event: PointerEvent, options?: AnyRecord) => void;
  openReplyComposer: (options?: AnyRecord) => void;
  updatePrivacyWarning: (value: string, warningElement: Element | null) => void;
  selfDeletePost: (globalNumber: string, options?: AnyRecord) => Promise<any>;
  selfEditPost: (globalNumber: string, currentBody?: string) => Promise<any>;
  showPostEditModal: (globalNumber: string, currentBody: string, options?: AnyRecord) => Promise<any>;
  rememberMyPost: (post: AnyRecord, type: string) => void;
  refreshAccountPostNumbers: () => Promise<any>;
  renderMyPosts: () => void;
  insertComposerToken: (picker: string | undefined, token: string | undefined, options?: AnyRecord) => void;
  insertThreadTemplate: (templateId: string | undefined, options?: AnyRecord) => void;
  saveComposerReplyTemplate: (scope?: string) => void;
  dismissThreadTemplate: (options?: AnyRecord) => void;
  insertReplyTemplate: (templateId: string | undefined, selectedId?: string) => void;
  handleThreadMediaClick: (event: Event, options?: AnyRecord) => boolean;
  handleThreadPostCollapseClick: (event: Event, options?: AnyRecord) => boolean;
  showPostEditModalForRefresh?: AnyRecord;
  copyPostPermalink: (globalNumber: string) => void;
  selectedPostQuoteText: (post: Element | null) => string;
  handleReferencePreviewClick: (event: Event) => Promise<boolean>;
  addHiddenPost: (globalNumber: string | null) => string[];
  removeHiddenPost: (globalNumber: string | null) => string[];
  clearHiddenPosts: () => string[];
  addHiddenThread: (threadId: string | null) => string[];
  removeHiddenThread: (threadId: string | null) => string[];
  clearHiddenThreads: () => string[];
  renderBoardThreads: (threads: AnyRecord[]) => void;
  renderBrowserHiddenData?: () => void;
  addContentFilter: (options: AnyRecord) => void;
  addPosterNote: (options: AnyRecord) => void;
  watchlistController: AnyRecord;
  toggleCurrentThreadWatch: () => void;
  removeSavedSearch: (key: string) => void;
  handleAccountPrivateDataClick: (event: Event) => boolean | Promise<boolean | void>;
  handleAccountPasskeyClick: (event: Event) => boolean | Promise<boolean | void>;
  handleAdminPasskeyClick: (event: Event) => boolean | Promise<boolean | void>;
  applyTheme: (theme: string) => void;
  persistAccountSettings: (options?: AnyRecord) => Promise<any> | void;
  localDisplayPreferences: () => AnyRecord;
  applyDisplayPreferences: (preferences?: AnyRecord) => AnyRecord;
  normalizeWatchedSort: (value: string) => string;
  showReportModal: (globalNumber: string) => Promise<AnyRecord | null>;
  translatePost: (button: Element) => Promise<void>;
  speakPost: (button: Element) => Promise<void>;
  writeReaction: (globalNumber: string, reaction: string) => void;
  writeVote: (globalNumber: string, direction: string) => void;
};

function getTarget(event: Event) {
  const target = event.target;
  if (target instanceof Element) {
    return target;
  }
  // Clicks on text nodes inside buttons/links must still resolve to an element.
  if (target instanceof Text && target.parentElement) {
    return target.parentElement;
  }
  return null;
}

export function bindThreadEvents(dependencies: ThreadEventDependencies) {
  const {
    body = document.body,
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
    renderBrowserHiddenData = () => {},
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
    translatePost,
    speakPost,
    writeVote
  } = dependencies;

  body.addEventListener('click', async (event) => {
    const target = getTarget(event);
    if (!target) {
      return;
    }

    const composerInsertButton = target.closest('[data-composer-insert]');
    if (composerInsertButton) {
      const pickerRoot = composerInsertButton.closest('[data-composer-picker]');
      insertComposerToken(pickerRoot?.dataset.composerPicker, composerInsertButton.dataset.composerInsert, { showToast });
      return;
    }

    const insertReplyTemplateButton = target.closest('[data-insert-reply-template]');
    if (insertReplyTemplateButton) {
      const picker = insertReplyTemplateButton.closest('[data-reply-template-picker]');
      const selectedId = picker?.querySelector('[data-reply-template-select]')?.value || '';
      insertReplyTemplate(insertReplyTemplateButton.dataset.insertReplyTemplate, selectedId);
      return;
    }

    const saveReplyTemplateButton = target.closest('[data-save-reply-template]');
    if (saveReplyTemplateButton) {
      saveComposerReplyTemplate(saveReplyTemplateButton.dataset.saveReplyTemplate);
      return;
    }

    const threadMediaJump = target.closest('[data-thread-media-jump]');
    if (threadMediaJump) {
      event.preventDefault();
      focusPermalinkPost(threadMediaJump.dataset.threadMediaJump, { scroll: true });
      return;
    }

    if (handleThreadMediaClick(event, { showToast })) {
      return;
    }

    const boardReplyButton = target.closest('[data-board-reply]');
    if (boardReplyButton) {
      event.preventDefault();
      openQuickReply(boardReplyButton.dataset.boardReplyNumber, event as PointerEvent, {
        threadId: boardReplyButton.dataset.boardReply,
        isLocked: boardReplyButton.dataset.boardReplyLocked === '1',
        isArchived: boardReplyButton.dataset.boardReplyArchived === '1',
        fromBoard: true
      });
      return;
    }

    const quickReplyNumber = target.closest('[data-quick-reply]');
    if (quickReplyNumber) {
      const boundThreadId = quickReplyNumber.dataset.quickReplyThread || '';
      const onBoard = (window.location.hash || '').startsWith('#board/');
      // Post-number links keep their permalink when not inside an open thread
      // or when the thread cannot accept replies (4chan-style quote vs navigate).
      if (
        quickReplyNumber instanceof HTMLAnchorElement &&
        !boundThreadId &&
        (!state.threadId || state.threadIsArchived || state.threadIsLocked)
      ) {
        return;
      }
      event.preventDefault();
      const selectedQuote = selectedPostQuoteText(
        quickReplyNumber.closest('.post, .thread-op, article.reply-preview')
      );
      openQuickReply(quickReplyNumber.dataset.quickReply, event as PointerEvent, {
        selectedQuote,
        threadId: boundThreadId || undefined,
        fromBoard: onBoard || Boolean(boundThreadId && !String(window.location.hash || '').startsWith('#thread/'))
      });
      return;
    }

    const selfDeletePostButton = target.closest('[data-self-delete-post]');
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

    const selfEditPostButton = target.closest('[data-self-edit-post]');
    if (selfEditPostButton) {
      try {
        await selfEditPost(selfEditPostButton.dataset.selfEditPost, decodeURIComponent(selfEditPostButton.dataset.selfEditBody || ''));
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const accountEditPostButton = target.closest('[data-account-edit-post]');
    if (accountEditPostButton) {
      try {
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
        }
        if ((window.location.hash || '').startsWith('#thread/') || (window.location.hash || '').startsWith('#home')) {
          await refreshCurrentScreen();
        }
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const refreshButton = target.closest('[data-thread-refresh]');
    if (refreshButton) {
      await loadThread().catch((error) => showToast(error.message));
      return;
    }

    const watchButton = target.closest('[data-toggle-watch]');
    if (watchButton) {
      toggleCurrentThreadWatch();
      return;
    }

    const unwatchThreadButton = target.closest('[data-unwatch-thread]');
    if (unwatchThreadButton) {
      watchlistController.removeWatchedThread(unwatchThreadButton.dataset.unwatchThread);
      showToast('Đã bỏ theo dõi chủ đề.');
      if ((window.location.hash || '#home').startsWith('#home')) {
        const watchedThreads = await watchlistController.loadWatchedThreadSummaries();
        watchlistController.renderWatchedThreads(watchedThreads);
      }
      return;
    }

    const watchedUnreadToggle = target.closest('#watchedUnreadToggle');
    if (watchedUnreadToggle) {
      const preferences = localDisplayPreferences();
      applyDisplayPreferences({
        ...preferences,
        watchedUnreadOnly: !preferences.watchedUnreadOnly
      });
      watchlistController.renderWatchedThreads();
      await persistAccountSettings({ silent: true });
      showToast(preferences.watchedUnreadOnly ? 'Đang chỉ hiện thread chưa đọc.' : 'Đang hiện toàn bộ watchlist.');
      return;
    }

    const watchedMarkAllRead = target.closest('#watchedMarkAllRead');
    if (watchedMarkAllRead) {
      const count = watchlistController.markAllWatchedThreadsRead();
      watchlistController.renderWatchedThreads();
      if (count) {
        await persistAccountSettings({ silent: true });
        showToast(`Đã đánh dấu ${count.toLocaleString()} chủ đề là đã đọc.`);
      }
      return;
    }

    const markWatchReadButton = target.closest('[data-mark-watch-read]');
    if (markWatchReadButton) {
      if (watchlistController.markWatchedThreadRead(markWatchReadButton.dataset.markWatchRead)) {
        watchlistController.renderWatchedThreads();
        await persistAccountSettings({ silent: true });
        showToast('Đã đánh dấu chủ đề là đã đọc.');
      }
      return;
    }

    const boardRefreshButton = target.closest('[data-board-refresh]');
    if (boardRefreshButton) {
      await loadBoard().catch((error) => showToast(error.message));
      return;
    }

    const threadTemplateButton = target.closest('[data-thread-template]');
    if (threadTemplateButton) {
      insertThreadTemplate(threadTemplateButton.dataset.threadTemplate, { showToast });
      return;
    }

    const threadTemplateDismissButton = target.closest('[data-thread-template-dismiss]');
    if (threadTemplateDismissButton) {
      dismissThreadTemplate({ showToast });
      return;
    }

    const removeSavedSearchButton = target.closest('[data-remove-saved-search]');
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

    const replyLink = target.closest('[data-open-reply]');
    if (replyLink) {
      openReplyComposer();
      els.replyComposer.scrollIntoView({ block: 'center' });
      return;
    }

    const pageTopButton = target.closest('[data-scroll-page-top]');
    if (pageTopButton) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const pageButton = target.closest('[data-page-action]');
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

    const unhideThreadButton = target.closest('[data-unhide-thread]');
    if (unhideThreadButton) {
      event.preventDefault();
      const threadId = unhideThreadButton.dataset.unhideThread || '';
      if (threadId) {
        removeHiddenThread(threadId);
        renderBrowserHiddenData();
        if ((window.location.hash || '').startsWith('#board/')) {
          renderBoardThreads(state.boardThreads);
        } else if ((window.location.hash || '').startsWith('#catalog/')) {
          await loadCatalog().catch((error) => showToast(error.message));
        } else {
          await refreshCurrentScreen().catch((error) => showToast(error.message));
        }
        showToast(state.accountToken ? 'Đã hiện lại chủ đề (đồng bộ tài khoản).' : 'Đã hiện lại chủ đề trên trình duyệt này.');
      }
      return;
    }

    const unhidePostButton = target.closest('[data-unhide-post]');
    if (unhidePostButton) {
      event.preventDefault();
      const postNumber = String(unhidePostButton.dataset.unhidePost || '').trim();
      if (postNumber) {
        // Always clear local + in-memory first so any concurrent reload sees the new set.
        removeHiddenPost(postNumber);
        renderBrowserHiddenData();
        const onThread = (window.location.hash || '').startsWith('#thread/') && state.threadId;
        if (onThread) {
          // Focus the restored post so it is obvious after reload.
          await loadThread({ focusPost: postNumber, preserveScroll: true }).catch((error) => showToast(error.message));
        } else if ((window.location.hash || '').startsWith('#board/')) {
          renderBoardThreads(state.boardThreads);
        } else {
          await refreshCurrentScreen().catch((error) => showToast(error.message));
        }
        showToast(state.accountToken ? 'Đã hiện lại bài (đồng bộ tài khoản).' : 'Đã hiện lại bài trên trình duyệt này.');
      }
      return;
    }

    const clearHiddenThreadsButton = target.closest('[data-clear-hidden-threads]');
    if (clearHiddenThreadsButton) {
      event.preventDefault();
      clearHiddenThreads();
      renderBrowserHiddenData();
      if ((window.location.hash || '').startsWith('#board/')) {
        renderBoardThreads(state.boardThreads);
      } else {
        await refreshCurrentScreen().catch((error) => showToast(error.message));
      }
      showToast(state.accountToken ? 'Đã hiện lại tất cả chủ đề đã ẩn (đồng bộ tài khoản).' : 'Đã hiện lại tất cả chủ đề đã ẩn.');
      return;
    }

    const clearHiddenPostsButton = target.closest('[data-clear-hidden-posts]');
    if (clearHiddenPostsButton) {
      event.preventDefault();
      clearHiddenPosts();
      renderBrowserHiddenData();
      if ((window.location.hash || '').startsWith('#thread/') && state.threadId) {
        await loadThread({ preserveScroll: true }).catch((error) => showToast(error.message));
      } else if ((window.location.hash || '').startsWith('#board/')) {
        renderBoardThreads(state.boardThreads);
      } else {
        await refreshCurrentScreen().catch((error) => showToast(error.message));
      }
      showToast(state.accountToken ? 'Đã hiện lại tất cả bài đã ẩn (đồng bộ tài khoản).' : 'Đã hiện lại tất cả bài đã ẩn.');
      return;
    }

    const hideThreadButton = target.closest('[data-hide-thread]');
    if (hideThreadButton) {
      event.preventDefault();
      const threadId = hideThreadButton.dataset.hideThread || '';
      if (threadId) {
        addHiddenThread(threadId);
        // Always re-render current list so the stub appears immediately.
        if ((window.location.hash || '').startsWith('#board/')) {
          renderBoardThreads(state.boardThreads);
        } else if ((window.location.hash || '').startsWith('#catalog/')) {
          await loadCatalog().catch((error) => showToast(error.message));
        } else {
          await refreshCurrentScreen().catch((error) => showToast(error.message));
        }
        renderBrowserHiddenData();
        showToast(
          state.accountToken
            ? 'Đã ẩn chủ đề (đồng bộ tài khoản). Bấm [Hiện lại] trên dòng stub hoặc Cài đặt.'
            : 'Đã ẩn chủ đề. Dòng stub [Hiện lại] vẫn hiện trên bảng/danh mục.',
          {
            actionLabel: 'Hoàn tác',
            durationMs: 8000,
            onAction: async () => {
              removeHiddenThread(threadId);
              if ((window.location.hash || '').startsWith('#board/')) {
                renderBoardThreads(state.boardThreads);
              } else {
                await refreshCurrentScreen().catch((error) => showToast(error.message));
              }
              renderBrowserHiddenData();
              showToast(state.accountToken ? 'Đã hiện lại chủ đề (đồng bộ tài khoản).' : 'Đã hiện lại chủ đề trên trình duyệt này.');
            }
          }
        );
      }
      return;
    }

    const hidePostButton = target.closest('[data-hide-post]');
    if (hidePostButton) {
      event.preventDefault();
      const postNumber = hidePostButton.dataset.hidePost || '';
      // Board OP lives in .thread (not article.post). Hiding OP there means hide the whole thread.
      const boardThreadRoot = hidePostButton.closest('.thread');
      const boardHideThreadId =
        boardThreadRoot && !(window.location.hash || '').startsWith('#thread/')
          ? boardThreadRoot.querySelector('[data-hide-thread]')?.getAttribute('data-hide-thread') ||
            boardThreadRoot.querySelector('a[href^="#thread/"]')?.getAttribute('href')?.replace(/^#thread\//, '') ||
            ''
          : '';
      if (boardHideThreadId) {
        addHiddenThread(boardHideThreadId);
        if ((window.location.hash || '').startsWith('#board/')) {
          renderBoardThreads(state.boardThreads);
        } else {
          await refreshCurrentScreen().catch((error) => showToast(error.message));
        }
        renderBrowserHiddenData();
        showToast('Đã ẩn chủ đề. Bấm [Hiện lại] trên dòng stub hoặc Cài đặt → Nội dung đã ẩn.', {
          actionLabel: 'Hoàn tác',
          durationMs: 8000,
          onAction: () => {
            removeHiddenThread(boardHideThreadId);
            renderBoardThreads(state.boardThreads);
            renderBrowserHiddenData();
            showToast('Đã hiện lại chủ đề trên trình duyệt này.');
          }
        });
        return;
      }

      addHiddenPost(postNumber);
      const onThreadScreen = (window.location.hash || '').startsWith('#thread/') && state.threadId;
      if (onThreadScreen) {
        await loadThread({ preserveScroll: true }).catch((error) => showToast(error.message));
      } else {
        const postEl = hidePostButton.closest('article.post, article.reply-preview');
        const safeNumber = String(postNumber).replace(/[^\d]/g, '');
        if (postEl && safeNumber) {
          postEl.outerHTML = `
            <article class="post post-hidden-stub" id="p${safeNumber}" data-hidden-post="${safeNumber}">
              <div class="hidden-stub-row">
                <div class="hidden-stub-text">
                  <strong>No.${safeNumber}</strong>
                  <span class="muted">— bài đã ẩn trên trình duyệt này</span>
                </div>
                <button class="primary-button unhide-action" data-unhide-post="${safeNumber}" type="button">[Hiện lại]</button>
              </div>
            </article>
          `;
        }
      }
      renderBrowserHiddenData();
      showToast(
        state.accountToken
          ? 'Đã ẩn bài (đồng bộ tài khoản). Bấm [Hiện lại] trên dòng stub hoặc Cài đặt.'
          : 'Đã ẩn bài. Bấm [Hiện lại] trên dòng stub hoặc Cài đặt → Nội dung đã ẩn.',
        {
          actionLabel: 'Hoàn tác',
          durationMs: 8000,
          onAction: async () => {
            removeHiddenPost(postNumber);
            renderBrowserHiddenData();
            if ((window.location.hash || '').startsWith('#thread/') && state.threadId) {
              await loadThread({ preserveScroll: true, focusPost: postNumber }).catch((error) => showToast(error.message));
            } else {
              await refreshCurrentScreen().catch((error) => showToast(error.message));
            }
            showToast(state.accountToken ? 'Đã hiện lại bài (đồng bộ tài khoản).' : 'Đã hiện lại bài trên trình duyệt này.');
          }
        }
      );
      return;
    }

    const filterPosterButton = target.closest('[data-filter-poster]');
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

    const notePosterButton = target.closest('[data-note-poster]');
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

    const translatePostButton = target.closest('[data-translate-post]');
    if (translatePostButton) {
      await translatePost(translatePostButton);
      return;
    }

    const ttsPostButton = target.closest('[data-tts-post]');
    if (ttsPostButton) {
      await speakPost(ttsPostButton);
      return;
    }

    const copyPostLinkButton = target.closest('[data-copy-post-link]');
    if (copyPostLinkButton) {
      copyPostPermalink(copyPostLinkButton.dataset.copyPostLink);
      return;
    }

    if (handleThreadPostCollapseClick(event, { showToast })) {
      return;
    }

    const scrollButton = target.closest('[data-scroll-thread]');
    if (scrollButton) {
      const targetElement = scrollButton.dataset.scrollThread === 'bottom' ? els.threadToolbarBottom : els.threadScreen;
      targetElement.scrollIntoView({ block: scrollButton.dataset.scrollThread === 'bottom' ? 'end' : 'start' });
      return;
    }

    const quoteButton = target.closest('[data-quote]');
    if (quoteButton) {
      // 4chan-style floating quick-reply window instead of the bottom form.
      const quoteMatch = String(quoteButton.dataset.quote || '').match(/(\d+)/);
      const quoteNumber = quoteMatch?.[1] || '';
      if (!quoteNumber) {
        return;
      }
      const selectedQuote = selectedPostQuoteText(quoteButton.closest('.post, .thread-op, article.reply-preview'));
      openQuickReply(quoteNumber, event as PointerEvent, {
        selectedQuote,
        threadId: quoteButton.dataset.quickReplyThread || undefined,
        fromBoard: (window.location.hash || '').startsWith('#board/')
      });
      return;
    }

    const spoilerText = target.closest('.spoiler-text');
    if (spoilerText && !spoilerText.classList.contains('revealed')) {
      spoilerText.classList.add('revealed');
      return;
    }

    const referencePreviewClick = await handleReferencePreviewClick(event);
    if (referencePreviewClick) {
      return;
    }

    const suggestion = target.closest('[data-suggestion]');
    if (suggestion) {
      const useQuickReply =
        Boolean(suggestion.closest('#quickReply')) || !els.quickReply?.classList?.contains('hidden');
      const textarea = useQuickReply ? els.quickReplyBody : els.commentBody;
      const warningBox = useQuickReply ? els.quickReplyPrivacyWarning : els.commentPrivacyWarning;
      if (!textarea) {
        return;
      }
      textarea.value = decodeURIComponent(suggestion.dataset.suggestion);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      updatePrivacyWarning(textarea.value, warningBox);
      textarea.focus();
      return;
    }

    const pollOption = target.closest('[data-poll-option]');
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

    const reactionButton = target.closest('[data-reaction]');
    if (reactionButton) {
      if (!state.accountToken) {
        showToast('Vui lòng đăng nhập tài khoản để react.');
        return;
      }
      const globalNumber = String(reactionButton.dataset.reactionTarget || '');
      const reaction = String(reactionButton.dataset.reaction || '');
      if (!globalNumber || !reaction) {
        return;
      }
      // Prevent double-submit (rapid click / double-tap) which toggled twice
      // and made counts jump by 2 or immediately cancel the reaction.
      if (pendingReactionPosts.has(globalNumber)) {
        return;
      }
      pendingReactionPosts.add(globalNumber);
      setReactionControlsBusy(globalNumber, true);
      try {
        const result = await api(`/api/posts/${globalNumber}/reactions`, {
          auth: 'account',
          method: 'POST',
          body: JSON.stringify({ reaction })
        });
        applyReactionControls(globalNumber, result.reactions || {}, result.myReaction || '');
        // Do not full-refresh: SSE + refresh raced and re-applied stale counts.
      } catch (error) {
        setReactionControlsBusy(globalNumber, false);
        showToast(error.message);
      } finally {
        pendingReactionPosts.delete(globalNumber);
      }
      return;
    }

    const voteButton = target.closest('[data-vote]');
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

    const reportButton = target.closest('[data-report]');
    if (reportButton) {
      try {
        const report = await showReportModal(reportButton.dataset.report);
        if (!report) {
          return;
        }
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
  });

  body.addEventListener('change', (event) => {
    const target = getTarget(event);
    if (!target) {
      return;
    }

    const themeSelect = target.closest('[data-theme-select]');
    if (themeSelect) {
      applyTheme(themeSelect.value);
      persistAccountSettings({ silent: true });
    }

    const commentSort = target.closest('[data-comment-sort]');
    if (commentSort) {
      state.commentsSort = commentSort.value;
      state.threadCommentPage = 1;
      loadThread().catch((error) => showToast(error.message));
    }

    const watchedSortSelect = target.closest('#watchedSortSelect');
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
}


