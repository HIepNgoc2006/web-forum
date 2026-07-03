import { escapeHtml, hoursSince, mediaKind, mediaList, mediaThumbnailSrc, plainPreview, threadTitle } from './format';
import { readThreadLastSeen } from './storage';

import type { AnyRecord } from './types';

function catalogMediaItemsFromPost(post: AnyRecord = {}) {
  return mediaList(post.images?.length ? post.images : post.image);
}

function catalogPostMediaCount(post: AnyRecord = {}) {
  return catalogMediaItemsFromPost(post).length;
}

function spoilerSummaryLabelHtml() {
  return '<span class="summary-spoiler-label">Spoiler</span>';
}

export function catalogThreadFileCount(thread: AnyRecord = {}) {
  const previewFileCount = (Array.isArray(thread.previewComments) ? thread.previewComments : []).reduce(
    (total, comment) => total + catalogPostMediaCount(comment),
    0
  );
  return catalogPostMediaCount(thread) + previewFileCount + Number(thread.omittedImageCount || 0);
}

export function catalogThreadMediaItems(thread: AnyRecord = {}) {
  const previewMedia = (Array.isArray(thread.previewComments) ? thread.previewComments : []).flatMap((comment) =>
    catalogMediaItemsFromPost(comment)
  );
  return [...catalogMediaItemsFromPost(thread), ...previewMedia];
}

export function catalogThreadHasVideo(thread: AnyRecord = {}) {
  return catalogThreadMediaItems(thread).some((media) => mediaKind(media) === 'video');
}

export function catalogThreadHtml(thread) {
  const title = threadTitle(thread, 'Chưa có nội dung').slice(0, 260);
  const bodyPreview = plainPreview(thread.bodyLines, '').slice(0, 260);
  const stickyPrefix = thread.isSticky ? '[Ghim] ' : '';
  const images = catalogMediaItemsFromPost(thread);
  const fileCount = catalogThreadFileCount(thread);
  const firstMedia = images[0];
  const thumbnailSrc = mediaThumbnailSrc(firstMedia);
  const spoiler = Boolean(firstMedia?.spoiler);
  const image = firstMedia && thumbnailSrc
    ? `<img src="${escapeHtml(thumbnailSrc)}" alt="${escapeHtml(firstMedia.name)}">`
    : firstMedia
      ? `<span class="catalog-placeholder">${mediaKind(firstMedia) === 'video' ? 'Video' : 'Có tệp'}</span>`
      : '<span class="catalog-placeholder">Không có tệp</span>';

  return `
    <a class="catalog-thread" href="#thread/${thread.id}">
      <span class="catalog-thumb${spoiler ? ' spoiler-summary-thumb' : ''}">${image}${spoiler ? spoilerSummaryLabelHtml() : ''}</span>
      <strong>${escapeHtml(`${stickyPrefix}${title.slice(0, 70)}`)}${title.length >= 70 ? '...' : ''}</strong>
      <span class="catalog-thread-stats">R: ${thread.replyCount} / I: ${fileCount} / No.${thread.globalNumber}</span>
      <p>${escapeHtml(bodyPreview || title)}${bodyPreview.length >= 260 ? '...' : ''}</p>
    </a>
  `;
}

function catalogRecommendationScore(thread) {
  const activityAgeHours = hoursSince(thread.bumpedAt || thread.createdAt);
  const replyCount = Number(thread.replyCount || 0);
  const mediaCount = catalogThreadFileCount(thread);
  const voteScore = Number(thread.votes?.score || 0);
  const recencyScore = Math.exp(-activityAgeHours / 18) * 40;
  const replyScore = Math.log1p(replyCount) * 8;
  const mediaScore = Math.min(mediaCount, 4) * 2;
  const positiveVoteScore = Math.max(0, voteScore) * 3;
  const negativeVotePenalty = Math.max(0, -voteScore) * 4;
  const stickyScore = thread.isSticky ? 8 : 0;
  return recencyScore + replyScore + mediaScore + positiveVoteScore + stickyScore - negativeVotePenalty;
}

export function normalizeCatalogSort(value) {
  const sort = String(value || '').trim().toLowerCase();
  return ['recommended', 'bump', 'latest-reply', 'created', 'replies', 'files'].includes(sort) ? sort : 'bump';
}

export function sortedCatalogThreads(threads, sortValue) {
  const copy = [...threads];
  const sort = normalizeCatalogSort(sortValue);
  if (sort === 'recommended') {
    return copy.sort((left, right) => {
      const scoreCompare = catalogRecommendationScore(right) - catalogRecommendationScore(left);
      if (scoreCompare !== 0) return scoreCompare;
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      return stickyCompare || right.bumpedAt.localeCompare(left.bumpedAt);
    });
  }
  if (sort === 'created') {
    return copy.sort((left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      return stickyCompare || right.createdAt.localeCompare(left.createdAt);
    });
  }
  if (sort === 'replies') {
    return copy.sort((left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      return stickyCompare || Number(right.replyCount || 0) - Number(left.replyCount || 0);
    });
  }
  if (sort === 'files') {
    return copy.sort((left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      const fileCompare = catalogThreadFileCount(right) - catalogThreadFileCount(left);
      return stickyCompare || fileCompare || right.bumpedAt.localeCompare(left.bumpedAt);
    });
  }
  if (sort === 'latest-reply') {
    return copy.sort((left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      return stickyCompare || right.bumpedAt.localeCompare(left.bumpedAt);
    });
  }
  return copy.sort((left, right) => {
    const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
    return stickyCompare || right.bumpedAt.localeCompare(left.bumpedAt);
  });
}

export function catalogThreadMatchesFilter(thread, filterValue) {
  if (filterValue === 'image') {
    return catalogThreadFileCount(thread) > 0;
  }
  if (filterValue === 'video') {
    return catalogThreadHasVideo(thread);
  }
  if (filterValue === 'poll') {
    return Boolean(thread.poll?.options?.length);
  }
  if (filterValue === 'unread') {
    return readThreadLastSeen(thread.id) === 0;
  }
  return true;
}

export function archiveThreadHtml(thread) {
  const title = threadTitle(thread, 'Chưa có nội dung').slice(0, 180);
  const archivedAt = thread.archivedAt ? new Date(thread.archivedAt).toLocaleString('vi-VN') : 'không rõ';
  return `
    <a class="archive-row" href="#thread/${thread.id}">
      <span class="archive-no">No.${thread.globalNumber}</span>
      <span class="archive-title">${escapeHtml(title)}${title.length >= 180 ? '...' : ''}</span>
      <span class="archive-meta">${thread.replyCount} trả lời · lưu lúc ${escapeHtml(archivedAt)}</span>
    </a>
  `;
}
