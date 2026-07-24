import { focusPermalinkPost } from './thread-dom';
import { hydratePostLinkPreviews } from './link-preview';
import type { AnyRecord } from './types';

export function createThreadLoadController(dependencies: AnyRecord) {
  const {
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
    setupRealtime,
    closeReplyComposer = () => {},
    syncReplyComposer = () => {},
    prepareReplyComposerForThreadRender = () => () => {},
    syncThreadMediaToolbarState = () => {},
    syncThreadPostCollapseToolbarState = () => {},
    resetAutoUpdateTimer = () => {}
  } = dependencies;

  async function loadThread({
    resetReply = false,
    focusPost = '',
    preserveScroll = false
  }: AnyRecord = {}) {
    const restoreReplyComposerAfterRender = prepareReplyComposerForThreadRender();
    setScreen('thread');
    els.threadSummary.classList.add('hidden');
    const scrollY = preserveScroll ? window.scrollY : null;
    const query = new URLSearchParams({
      commentsPage: String(state.threadCommentPage),
      commentsPageSize: String(state.threadCommentPageSize),
      commentsSort: state.commentsSort
    });
    const threadSearchTerm = dependencies.normalizeThreadSearchTerm(state.threadSearchTerm);
    state.threadSearchTerm = threadSearchTerm;
    if (threadSearchTerm) {
      query.set('commentsSearch', threadSearchTerm);
    }
    const requestedPost = focusPost || new URLSearchParams((window.location.hash || '').split('?')[1] || '').get('p') || '';
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
    // Keep hidden posts as stubs with [Hiện lại]; only content-filters remove posts entirely.
    const commentsForRender = detail.comments.filter((comment) => !isPostFiltered(comment));
    const opIsHidden = hiddenPosts.has(String(detail.thread.globalNumber));
    const opBlock = opIsHidden
      ? (typeof dependencies.hiddenPostStubHtml === 'function'
          ? dependencies.hiddenPostStubHtml(detail.thread)
          : '')
      : postHtml(detail.thread, 'post op', {
          opNumber: detail.thread.globalNumber,
          opPosterHash: detail.thread.posterHash,
          canReply,
          showLinkPreviews: true
        });
    // Fallback if stub helper was not injected (older composition).
    const opHtml =
      opBlock ||
      postHtml(detail.thread, 'post op', {
        opNumber: detail.thread.globalNumber,
        opPosterHash: detail.thread.posterHash,
        canReply,
        showLinkPreviews: true
      });
    els.threadDetail.innerHTML = `
    ${archivedNotice}
    ${lockedNotice}
    ${opHtml}
    ${threadMediaGalleryHtml(detail)}
    ${threadSearchHtml(detail, state.threadSearchTerm)}
    ${commentSortHtml(state.commentsSort)}
    <div class="comment-list">
      ${threadCommentsHtml(commentsForRender, {
        opNumber: detail.thread.globalNumber,
        opPosterHash: detail.thread.posterHash,
        canReply,
        hiddenPosts
      })}
    </div>
  `;
    syncReplyComposer();
    els.threadPagination.innerHTML = pageControlsHtml(state.threadCommentPageMeta, 'thread-comments');
    syncThreadMediaToolbarState();
    hydratePostLinkPreviews(els.threadDetail, api);
    const focusedPost = requestedPost;
    if (preserveScroll && scrollY != null) {
      window.scrollTo(0, scrollY);
    } else {
      focusPermalinkPost(focusedPost, { scroll: Boolean(focusPost) });
    }
    syncThreadPostCollapseToolbarState();
    resetAutoUpdateTimer();
    restoreReplyComposerAfterRender();
  }

  return {
    loadThread
  };
}
