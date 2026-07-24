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
  renderStickerText,
  renderGifText,
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
import { hydratePostLinkPreviews, postLinksHtml } from './link-preview';

import type { AnyRecord } from './types';

type ThreadBoardRenderDependencies = {
  state: AnyRecord;
  els: AnyRecord;
  isMyPost: (post: AnyRecord) => boolean;
  isAccountPost: (post: AnyRecord) => boolean;
  isPostFiltered: (post: AnyRecord) => boolean;
  readHiddenThreadIds: () => Set<string>;
  readHiddenPostNumbers: () => Set<string>;
  isThreadWatched: (threadId: string) => boolean;
  pageControlsHtml: (meta: AnyRecord, actionName: string) => string;
  canModerateFromAdminToken: () => boolean;
  posterNoteForPost: (post: AnyRecord) => AnyRecord | null | undefined;
  /** Optional: used to hydrate incomplete OG cards after board render. */
  api?: (path: string, options?: AnyRecord) => Promise<AnyRecord>;
};

export function createThreadBoardRenderers(dependencies: ThreadBoardRenderDependencies) {
  const {
    state,
    els,
    isMyPost,
    isAccountPost,
    isPostFiltered,
    readHiddenThreadIds,
    readHiddenPostNumbers,
    isThreadWatched,
    pageControlsHtml,
    canModerateFromAdminToken,
    posterNoteForPost,
    api
  } = dependencies;

  /** Visible placeholder so users can always unhide (anonymous local + account). */
  function hiddenPostStubHtml(post: AnyRecord = {}) {
    const number = String(post.globalNumber || '');
    if (!number) {
      return '';
    }
    return `
      <article class="post post-hidden-stub" id="p${escapeHtml(number)}" data-hidden-post="${escapeHtml(number)}">
        <div class="hidden-stub-row">
          <div class="hidden-stub-text">
            <strong>No.${escapeHtml(number)}</strong>
            <span class="muted">— bài đã ẩn trên trình duyệt này</span>
          </div>
          <button class="primary-button unhide-action" data-unhide-post="${escapeHtml(number)}" type="button">[Hiện lại]</button>
        </div>
      </article>
    `;
  }

  function hiddenThreadStubHtml(thread: AnyRecord = {}) {
    const threadId = String(thread.id || '');
    const number = String(thread.globalNumber || '');
    if (!threadId) {
      return '';
    }
    const numberLabel = number ? `No.${escapeHtml(number)}` : 'Chủ đề';
    const preview = String(thread.subject || '')
      .trim()
      .slice(0, 48);
    return `
      <div class="thread thread-hidden-stub" id="${number ? `p${escapeHtml(number)}` : ''}" data-hidden-thread="${escapeHtml(threadId)}">
        <div class="hidden-stub-row">
          <div class="hidden-stub-text">
            <strong>${numberLabel}</strong>
            <span class="muted">— chủ đề đã ẩn${preview ? `: ${escapeHtml(preview)}` : ''}</span>
          </div>
          <button class="primary-button unhide-action" data-unhide-thread="${escapeHtml(threadId)}" type="button">[Hiện lại]</button>
        </div>
      </div>
    `;
  }

  function catalogHiddenThreadStubHtml(thread: AnyRecord = {}) {
    const threadId = String(thread.id || '');
    const number = String(thread.globalNumber || '');
    if (!threadId) {
      return '';
    }
    return `
      <div class="catalog-thread catalog-thread-hidden-stub" data-hidden-thread="${escapeHtml(threadId)}">
        <div class="hidden-stub-row">
          <div class="hidden-stub-text">
            <strong>No.${escapeHtml(number || '?')}</strong>
            <span class="muted">đã ẩn</span>
          </div>
          <button class="primary-button unhide-action" data-unhide-thread="${escapeHtml(threadId)}" type="button">[Hiện lại]</button>
        </div>
      </div>
    `;
  }

  function linkifyRefs(html: string, opNumber: number, knownBoards: Set<string>) {
    // Cross-board refs (>>>/slug/ or >>>/slug/123) first, so the >>N pass
    // below does not see the inner ">>" of a triple-arrow reference.
    let out = String(html).replace(/&gt;&gt;&gt;\/([a-z0-9-]+)\/(\d+)?/g, (match, slug, number) => {
      if (!knownBoards.has(slug)) {
        return match;
      }
      if (number) {
        return `<button class="ref-link cross-board" data-ref="${number}" type="button">&gt;&gt;&gt;/${slug}/${number}</button>`;
      }
      return `<a class="ref-link cross-board" href="#board/${slug}">&gt;&gt;&gt;/${slug}/</a>`;
    });
    out = out.replace(/&gt;&gt;(\d+)/g, (_match, number) => {
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
    return out;
  }

  function wrapPostLines(html: string) {
    const slots: string[] = [];
    const park = (chunk: string) => {
      const token = `\uE010${slots.length}\uE011`;
      slots.push(chunk);
      return token;
    };
    // Keep block BBCode output intact; only wrap free text lines.
    let out = String(html)
      .replace(/<(pre|table|ul|ol|blockquote|h[3-5]|div)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => park(m))
      .replace(/<hr\b[^>]*\/?>/gi, (m) => park(m));

    out = out
      .split(/(\uE010\d+\uE011)/g)
      .map((piece) => {
        const slot = piece.match(/^\uE010(\d+)\uE011$/);
        if (slot) {
          return slots[Number(slot[1])] || '';
        }
        return piece
          .split('\n')
          .map((line) => {
            const isGreentext = /^&gt;(?!&gt;)/.test(line);
            return `<div class="post-line ${isGreentext ? 'greentext' : ''}">${line || '&nbsp;'}</div>`;
          })
          .join('');
      })
      .join('');
    return out;
  }

  function renderPostLines(lines, options: AnyRecord = {}) {
    const opNumber = Number(options.opNumber || 0);
    const knownBoards = new Set<string>(
      (state.boards || []).map((board: AnyRecord) => String(board?.slug || '')).filter(Boolean)
    );
    // Join first so multi-line BBCode (quote/list/table/code) can span lines.
    let html = (lines || []).map((line) => line.text).join('\n');
    html = linkifyRefs(html, opNumber, knownBoards);
    html = renderInlineMarkup(html);
    html = renderStickerText(html);
    html = renderGifText(html);
    return wrapPostLines(html);
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
    const quickReplyThreadAttr = options.threadId
      ? ` data-quick-reply-thread="${escapeHtml(options.threadId)}"`
      : '';
    const posterIdentityHtml = canReply && showPostActions
      ? `<button class="post-id-button hash" data-quick-reply="${post.globalNumber}"${quickReplyThreadAttr} title="Trả lời bài này" type="button">${escapeHtml(posterId(post))}</button>`
      : `<span class="hash">${escapeHtml(posterId(post))}</span>`;
    const primaryActions = showPostActions
      ? `${
          showReplyAction && canReply
            ? `<button class="quote-button" data-quote="&gt;&gt;${post.globalNumber}"${quickReplyThreadAttr} type="button">[Trả lời]</button>`
            : ''
        }
      <button class="quote-button" data-copy-post-link="${escapeHtml(permalink)}" type="button">[Link]</button>
      <button class="quote-button" data-collapse-post="${post.globalNumber}" type="button" aria-expanded="true">[Thu]</button>
      ${selfEditAction}
      ${selfDeleteActions}
      ${accountEditAction}
      <button class="quote-button" data-report="${post.globalNumber}" type="button">[Báo cáo]</button>
      ${
        options.hideAsThread && post.id
          ? `<button class="quote-button" data-hide-thread="${escapeHtml(post.id)}" type="button">[Ẩn]</button>`
          : `<button class="quote-button" data-hide-post="${post.globalNumber}" type="button">[Ẩn]</button>`
      }`
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
        ${showCheckbox ? `<label class="post-check"><input type="checkbox" name="selectedPost" value="${escapeHtml(post.globalNumber)}" aria-label="Chọn bài ${post.globalNumber}"></label>` : ''}
        <span class="name">${escapeHtml(postDisplayName(post))}</span>${post.tripcode ? `<span class="tripcode" title="Tripcode">${escapeHtml(post.tripcode)}</span>` : ''}${capcodeBadgeHtml(post)}
        <span class="date">${formatPostDate(post.createdAt)}</span>
        <span class="post-number"><span class="post-number-prefix">No.</span><a class="number post-number-link" href="${permalink}" data-quick-reply="${post.globalNumber}"${quickReplyThreadAttr} title="Trả lời bài này (No.${post.globalNumber})">${post.globalNumber}</a></span>
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
    const linkPreviews =
      options.showLinkPreviews === true && !classes.includes('preview-post')
        ? postLinksHtml(post)
        : '';
    return `
      <article class="${classes.join(' ')}" id="p${post.globalNumber}">
        ${imageHtml(post)}
        ${meta(post, options)}
        ${classes.includes('op') ? threadSubjectHtml(post) : ''}
        <div class="post-body">${renderPostLines(post.bodyLines || [], options)}</div>
        ${linkPreviews}
        ${diceRollsHtml(post.diceRolls)}
        ${backlinksHtml(post.backlinks)}
        ${classes.includes('op') ? pollHtml(post.poll, options.canReply !== false) : ''}
      </article>
    `;
  }

  function threadCommentsHtml(comments, { opNumber, opPosterHash, canReply, hiddenPosts }: AnyRecord = {}) {
    if (!comments.length) {
      return state.threadSearchTerm
        ? '<p class="muted">Không có bình luận khớp tìm kiếm trong thread.</p>'
        : '<p class="muted">Chưa có bình luận công khai trên trang này.</p>';
    }
    const hidden =
      hiddenPosts instanceof Set
        ? hiddenPosts
        : typeof readHiddenPostNumbers === 'function'
          ? readHiddenPostNumbers()
          : new Set();
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
        if (hidden.has(String(comment.globalNumber))) {
          return `${marker}${hiddenPostStubHtml(comment)}`;
        }
        return `${marker}${postHtml(comment, 'post comment', {
          opNumber,
          opPosterHash,
          canReply,
          showLinkPreviews: true
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
    const hidden = readHiddenThreadIds();
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
    els.catalogGrid.innerHTML = visibleThreads
      .map((thread) =>
        hidden.has(String(thread.id)) ? catalogHiddenThreadStubHtml(thread) : catalogThreadHtml(thread)
      )
      .join('');
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
    const hiddenPosts = typeof readHiddenPostNumbers === 'function' ? readHiddenPostNumbers() : new Set();
    const comments = (Array.isArray(thread.previewComments) ? thread.previewComments : []).filter(
      (comment) => !isPostFiltered(comment) && !hiddenPosts.has(String(comment.globalNumber))
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
            ${meta(comment, {
              replyAction: false,
              compactActions: true,
              threadId: thread.id,
              canReply: !thread.isArchived && !thread.isLocked
            })}
            <div class="post-body">${renderPostLines(comment.bodyLines || [], { opNumber: thread.globalNumber })}</div>
            ${postLinksHtml(comment)}
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
    const listedThreads = threads.filter(
      (thread) => !isPostFiltered(thread) && threadMatchesSearch(thread, term, state.boards)
    );
    if (!listedThreads.length) {
      els.threadList.innerHTML = term
        ? '<p class="muted">Không có OP khớp tìm kiếm.</p>'
        : '<p class="muted">Chưa có chủ đề công khai.</p>';
      els.boardPagination.innerHTML = pageControlsHtml(state.boardPageMeta, 'board');
      return;
    }
    els.threadList.innerHTML = listedThreads
      .map((thread) => {
        if (hidden.has(String(thread.id))) {
          return hiddenThreadStubHtml(thread);
        }
        return `
          <div class="thread ${thread.isSticky ? 'thread-sticky' : ''}" id="p${thread.globalNumber}">
            <div class="thread-op">
              ${
                mediaItemsFromPost(thread).length
                  ? `<div class="post-media-gallery">${mediaItemsFromPost(thread)
                      .map((image) => mediaToggleHtml(image, 'thumb'))
                      .join('')}</div>`
                  : ''
              }
              ${meta(thread, {
                replyAction: false,
                compactActions: true,
                hideAsThread: true,
                threadId: thread.id,
                canReply: !thread.isArchived && !thread.isLocked
              })}
              ${
                thread.isArchived || thread.isLocked
                  ? `<a class="thread-open" href="#thread/${encodeURIComponent(thread.id)}" title="Mở chủ đề">[Xem chủ đề]</a>`
                  : `<button class="link-button thread-open" data-board-reply="${escapeHtml(thread.id)}" data-board-reply-number="${escapeHtml(thread.globalNumber)}" data-board-reply-locked="${thread.isLocked ? '1' : ''}" data-board-reply-archived="${thread.isArchived ? '1' : ''}" type="button" title="Trả lời nhanh (không rời bảng)">[Trả lời]</button>`
              }
              ${threadSubjectHtml(thread)}
              <div class="post-body">${renderPostLines(thread.bodyLines || [], { opNumber: thread.globalNumber })}</div>
              ${postLinksHtml(thread)}
              ${diceRollsHtml(thread.diceRolls)}
              ${boardReplyPreviewsHtml(thread)}
              <div class="thread-meta">
                <span>${thread.replyCount} trả lời</span>
                <span>đẩy lúc ${new Date(thread.bumpedAt).toLocaleTimeString()}</span>
                <a href="#thread/${encodeURIComponent(thread.id)}">Xem chủ đề</a>
                <button class="link-button" data-hide-thread="${escapeHtml(thread.id)}" type="button">[Ẩn chủ đề]</button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
    els.boardPagination.innerHTML = pageControlsHtml(state.boardPageMeta, 'board');
    if (typeof api === 'function' && els.threadList) {
      hydratePostLinkPreviews(els.threadList, api);
    }
  }

  return {
    renderPostLines,
    meta,
    postHtml,
    hiddenPostStubHtml,
    threadCommentsHtml,
    threadToolbarHtml,
    threadHeaderActionsHtml,
    boardReplyPreviewsHtml,
    renderBoardThreads,
    renderCatalogThreads,
    renderArchiveThreads
  };
}

