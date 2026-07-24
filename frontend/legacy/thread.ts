import {
  escapeHtml,
  mediaKind,
  mediaList,
  mediaThumbnailSrc,
  mediaToggleHtml
} from './format';

import type { AnyRecord } from './types';

export function firstUnreadPostNumber(posts = [], lastSeen = 0) {
  const seenNumber = Number(lastSeen || 0);
  const firstUnread = posts
    .map((post) => Number(post.globalNumber || 0))
    .filter((globalNumber) => Number.isFinite(globalNumber) && globalNumber > seenNumber)
    .sort((left, right) => left - right)[0];
  return firstUnread || 0;
}

export function watchedThreadHref(item: AnyRecord = {}) {
  if (item.unavailable || !item.threadId) {
    return '#home';
  }
  const threadPath = `#thread/${encodeURIComponent(item.threadId)}`;
  const firstUnreadNumber = Number(item.firstUnreadNumber || 0);
  const fallbackUnreadNumber =
    Number(item.maxNumber || 0) > Number(item.lastSeen || 0) ? Number(item.maxNumber || 0) : 0;
  const unreadNumber = firstUnreadNumber || fallbackUnreadNumber;
  return unreadNumber > 0 ? `${threadPath}?p=${encodeURIComponent(unreadNumber)}` : threadPath;
}

export function latestPostHref(post) {
  const threadId = post.threadId || post.id;
  if (!threadId) {
    return '#home';
  }
  return `#thread/${encodeURIComponent(threadId)}?p=${encodeURIComponent(post.globalNumber)}`;
}

export function mediaItemsFromPost(post: AnyRecord = {}) {
  return mediaList(post.images?.length ? post.images : post.image);
}

export function postMediaCount(post: AnyRecord = {}) {
  return mediaItemsFromPost(post).length;
}

export function imageHtml(post) {
  const images = mediaItemsFromPost(post);
  if (!images.length) {
    return '';
  }
  return `<div class="post-media-gallery">${images.map((image) => mediaToggleHtml(image)).join('')}</div>`;
}

export function postPermalink(post, options: AnyRecord = {}, fallbackThreadId = '') {
  const threadId = options.threadId || post.threadId || post.id || fallbackThreadId;
  if (!threadId || !post.globalNumber) {
    return '#';
  }
  return `#thread/${encodeURIComponent(threadId)}?p=${encodeURIComponent(post.globalNumber)}`;
}

export function normalizeThreadSearchTerm(value: any = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function backlinksHtml(backlinks = []) {
  if (!backlinks.length) {
    return '';
  }
  return `
    <div class="backlinks">
      <span class="backlinks-label">Phản hồi:</span>
      ${backlinks
        .map((number) => `<button class="ref-link" data-ref="${number}" type="button">&gt;&gt;${number}</button>`)
        .join(' ')}
    </div>
  `;
}

export function diceRollsHtml(diceRolls = []) {
  if (!Array.isArray(diceRolls) || diceRolls.length === 0) {
    return '';
  }
  return `
    <div class="dice-rolls" aria-label="Kết quả gieo xúc xắc">
      ${diceRolls
        .map((roll) => {
          const rolls = Array.isArray(roll.rolls) ? roll.rolls.map((value) => Number(value)).filter(Number.isFinite) : [];
          const modifier = Number(roll.modifier) || 0;
          const modifierText = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : '';
          return `
            <span class="dice-roll">
              <span class="dice-roll-label">Xúc xắc:</span>
              <span class="dice-expression">${escapeHtml(roll.expression || '')}</span>
              <span class="dice-values">[${escapeHtml(rolls.join(', '))}${escapeHtml(modifierText)}]</span>
              <strong>${escapeHtml(roll.total ?? '')}</strong>
            </span>
          `;
        })
        .join('')}
    </div>
  `;
}

export function threadMediaGalleryItems(detail: AnyRecord = {}) {
  return [detail.thread, ...(detail.comments || [])]
    .filter(Boolean)
    .flatMap((post) =>
      mediaItemsFromPost(post).map((image, index) => ({
        image,
        index,
        post
      }))
    );
}

export function threadMediaGalleryHtml(detail) {
  const items = threadMediaGalleryItems(detail);
  if (!items.length) {
    return '';
  }

  return `
    <nav class="thread-media-index" aria-label="Media trong thread">
      <div class="thread-media-index-title">Media trong thread (${items.length})</div>
      <div class="thread-media-index-list">
        ${items
          .map(({ image, index, post }) => {
            const thumbnailSrc = mediaThumbnailSrc(image, { fallbackOriginal: mediaKind(image) !== 'video' });
            const href = postPermalink(post, { threadId: detail.thread.id });
            const postNumber = escapeHtml(post.globalNumber);
            const name = escapeHtml(image?.name || 'tai-len');
            const kind = mediaKind(image) === 'video' ? 'Video' : 'Ảnh';
            const preview = thumbnailSrc
              ? `<img src="${escapeHtml(thumbnailSrc)}" alt="${kind} ${name} trong bài số ${postNumber}">`
              : `<span>${escapeHtml(kind)}</span>`;
            return `
              <a class="thread-media-index-item" href="${escapeHtml(href)}" data-thread-media-jump="${postNumber}" title="${name}">
                ${preview}
                <span>No.${postNumber}${index > 0 ? `.${index + 1}` : ''}</span>
              </a>
            `;
          })
          .join('')}
      </div>
    </nav>
  `;
}

export function threadFeedLinksHtml(detail) {
  if (!detail.thread?.id) {
    return '';
  }
  const threadId = encodeURIComponent(detail.thread.id);
  return `
      [<a data-thread-json-feed href="/feeds/threads/${threadId}/posts.json" target="_blank" rel="noopener noreferrer">JSON</a>]
      [<a data-thread-rss-feed href="/feeds/threads/${threadId}/posts.rss" target="_blank" rel="noopener noreferrer">RSS</a>]`;
}

export function threadNavigationLinksHtml(detail) {
  const navigation = detail.threadNavigation || {};
  const links = [];
  if (navigation.previous?.id) {
    const label = navigation.previous.globalNumber ? `Trước No.${navigation.previous.globalNumber}` : 'Trước';
    links.push(
      `[<a data-thread-nav="previous" href="#thread/${encodeURIComponent(navigation.previous.id)}">${escapeHtml(label)}</a>]`
    );
  }
  if (navigation.next?.id) {
    const label = navigation.next.globalNumber ? `Sau No.${navigation.next.globalNumber}` : 'Sau';
    links.push(`[<a data-thread-nav="next" href="#thread/${encodeURIComponent(navigation.next.id)}">${escapeHtml(label)}</a>]`);
  }
  return links.join('\n      ');
}

export function maxThreadPostNumber(detail) {
  return [detail.thread, ...(detail.comments || [])].reduce(
    (maxNumber, post) => Math.max(maxNumber, Number(post.globalNumber) || 0),
    0
  );
}

export function stickyLabelHtml(thread) {
  return thread?.isSticky ? '<span class="sticky-label">Đã ghim</span>' : '';
}

export function adminStickyButtonHtml(thread) {
  if (!thread?.id || thread.isArchived) {
    return '';
  }
  const nextSticky = !thread.isSticky;
  const label = nextSticky ? 'Ghim' : 'Gỡ ghim';
  return `<button class="ghost-button" data-admin-sticky-thread="${escapeHtml(thread.id)}" data-sticky-next="${nextSticky}" type="button">[${label}]</button>`;
}

export function adminLockButtonHtml(thread) {
  if (!thread?.id || thread.isArchived) {
    return '';
  }
  const nextLocked = !thread.isLocked;
  const label = nextLocked ? 'Khóa' : 'Mở khóa';
  return `<button class="ghost-button" data-admin-lock-thread="${escapeHtml(thread.id)}" data-lock-next="${nextLocked}" type="button">[${label}]</button>`;
}
