import {
  escapeHtml,
  moderationLabelText,
  moderationStatusText,
  capcodeBadgeHtml,
  formatEditedDate,
  formatPostDate,
  postDisplayName,
  posterId,
  renderInlineMarkup,
  renderSpoilerText,
  renderStickerText,
  mediaToggleHtml,
  threadSubjectHtml
} from './format';

import {
  adminLockButtonHtml,
  adminStickyButtonHtml,
  backlinksHtml,
  diceRollsHtml,
  imageHtml,
  mediaItemsFromPost,
  postMediaCount,
  postPermalink,
  stickyLabelHtml,
  threadFeedLinksHtml,
  threadNavigationLinksHtml
} from './thread';
import { omittedRepliesHtml, threadMatchesSearch } from './board';
import {
  archiveThreadHtml,
  catalogThreadHtml,
  catalogThreadMatchesFilter,
  normalizeCatalogSort,
  sortedCatalogThreads
} from './catalog';
import { accountPostEditButtonHtml, selfDeletePostActionsHtml, selfEditPostButtonHtml } from './post-owner-actions';
import { reactionControlHtml, voteControlHtml } from './post-controls';
import { pollHtml } from './post-poll';

import type { AnyRecord } from './types';

type ThreadBoardRenderDependencies = {
  state: AnyRecord;
  els: AnyRecord;
  isMyPost: (post: AnyRecord) => boolean;
  isAccountPost: (post: AnyRecord) => boolean;
  isPostFiltered: (post: AnyRecord) => boolean;
  readHiddenThreadIds: () => Set<string>;
  isThreadWatched: (threadId: string) => boolean;
  pageControlsHtml: (meta: AnyRecord, actionName: string) => string;
  canModerateFromAdminToken: () => boolean;
  posterNoteForPost: (post: AnyRecord) => AnyRecord | null | undefined;
};

export function createThreadBoardRenderers(dependencies: ThreadBoardRenderDependencies) {
  const {
    state,
    els,
    isMyPost,
    isAccountPost,
    isPostFiltered,
    readHiddenThreadIds,
    isThreadWatched,
    pageControlsHtml,
    canModerateFromAdminToken,
    posterNoteForPost
  } = dependencies;

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
    const compactActions = Boolean(options.compactActions);
    const accountEditAction = showPostActions ? accountPostEditButtonHtml(post, { isAccountPost }) : '';
    const selfEditAction = showPostActions ? selfEditPostButtonHtml(post) : '';
    const canDeletePost = (candidate: AnyRecord = {}) =>
      Boolean(isAccountPost?.(candidate) || canModerateFromAdminToken?.());
    const selfDeleteActions = showPostActions
      ? selfDeletePostActionsHtml(post, { canDeletePost })
      : '';
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
    const posterIdentityHtml = canReply && showPostActions
      ? `<button class="post-id-button hash" data-quick-reply="${post.globalNumber}" title="Trả lời bài này" type="button">${escapeHtml(posterId(post))}</button>`
      : `<span class="hash">${escapeHtml(posterId(post))}</span>`;
    const primaryActions = showPostActions
      ? `${
          showReplyAction && canReply
            ? `<button class="quote-button" data-quote="&gt;&gt;${post.globalNumber}" type="button">[Trả lời]</button>`
            : ''
        }
      <button class="quote-button" data-copy-post-link="${escapeHtml(permalink)}" type="button">[Link]</button>
      <button class="quote-button" data-collapse-post="${post.globalNumber}" type="button" aria-expanded="true">[Thu]</button>
      ${selfEditAction}
      ${selfDeleteActions}
      ${accountEditAction}
      <button class="quote-button" data-report="${post.globalNumber}" type="button">[Báo cáo]</button>
      <button class="quote-button" data-hide-post="${post.globalNumber}" type="button">[Ẩn]</button>`
      : '';
    const secondaryActions = showPostActions && !compactActions
      ? `<button class="quote-button post-action-secondary" data-filter-poster="${escapeHtml(posterId(post))}" data-filter-board="${escapeHtml(post.boardSlug || '')}" type="button">[Lọc ID]</button>
      <button class="quote-button post-action-secondary" data-note-poster="${escapeHtml(posterId(post))}" data-note-board="${escapeHtml(post.boardSlug || '')}" type="button">[Ghi chú ID]</button>
      <button class="quote-button post-action-secondary" data-translate-post="${post.globalNumber}" type="button">[Dịch]</button>
      <button class="quote-button post-action-secondary" data-tts-post="${post.globalNumber}" type="button">[Nghe]</button>`
      : '';
    return `
    <div class="post-meta${compactActions ? ' post-meta-compact' : ''}">
      <span class="post-meta-identity">
        ${showCheckbox ? `<label class="post-check"><input type="checkbox" aria-label="Chọn bài ${post.globalNumber}"></label>` : ''}
        <span class="name">${escapeHtml(postDisplayName(post))}</span>${post.tripcode ? `<span class="tripcode" title="Tripcode">${escapeHtml(post.tripcode)}</span>` : ''}${capcodeBadgeHtml(post)}
        <span class="date">${formatPostDate(post.createdAt)}</span>
        <span class="post-number"><span class="post-number-prefix">No.</span><a class="number post-number-link" href="${permalink}" data-quick-reply="${post.globalNumber}" title="Trả lời bài này (No.${post.globalNumber})">${post.globalNumber}</a></span>
        ${posterIdentityHtml}
        ${opMarker}
        ${youMarker}
        ${sageMarker}
        ${lastEdited}
        ${posterNoteBadge}
        ${stickyLabelHtml(post)}
        <span class="status">${labels}</span>
      </span>
      ${
        showPostActions
          ? `<span class="post-meta-actions">
        ${voteControlHtml(post)}
        ${reactionControlHtml(post)}
        ${primaryActions}
        ${secondaryActions}
      </span>`
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

  function renderArchiveThreads(threads) {
    const visibleThreads = threads.filter((thread) => !isPostFiltered(thread));
    if (!visibleThreads.length) {
      els.archiveList.innerHTML = '<p class="muted">Kho lưu trữ chưa có chủ đề.</p>';
      return;
    }
    els.archiveList.innerHTML = visibleThreads.map(archiveThreadHtml).join('');
  }

  function boardReplyPreviewsHtml(thread) {
    const comments = (Array.isArray(thread.previewComments) ? thread.previewComments : []).filter(
      (comment) => !isPostFiltered(comment)
    );
    if (!comments.length && !thread.omittedReplyCount && !thread.omittedImageCount) {
      return '';
    }
    return `
      <div class="board-reply-previews">
        ${omittedRepliesHtml(thread)}
        ${comments
          .map(
            (comment) => `
          <article class="reply-preview" id="p${comment.globalNumber}">
            ${meta(comment, { replyAction: false, compactActions: true })}
            <div class="post-body">${renderPostLines(comment.bodyLines || [], { opNumber: thread.globalNumber })}</div>
          </article>
        `
          )
          .join('')}
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
    const hidden = readHiddenThreadIds();
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
      .map(
        (thread) => `
          <div class="thread ${thread.isSticky ? 'thread-sticky' : ''}" id="p${thread.globalNumber}">
            <div class="thread-op">
              ${
                mediaItemsFromPost(thread).length
                  ? `<div class="post-media-gallery">${mediaItemsFromPost(thread)
                      .map((image) => mediaToggleHtml(image, 'thumb'))
                      .join('')}</div>`
                  : '<div class="thread-thumb-wrap"><div class="thumb placeholder">Không có tệp</div></div>'
              }
              ${meta(thread, { replyAction: false, compactActions: true })}
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
        `
      )
      .join('');
    els.boardPagination.innerHTML = pageControlsHtml(state.boardPageMeta, 'board');
  }

  return {
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
  };
}

