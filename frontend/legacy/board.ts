import { normalizeSearchValue, plainPreview, threadSubject } from './format';

import type { AnyRecord } from './types';

export function normalizeBoardSort(value) {
  const sort = String(value || '').trim().toLowerCase();
  return ['bump', 'created', 'replies'].includes(sort) ? sort : 'bump';
}

export function normalizeBoardFilter(value) {
  const filter = String(value || '').trim().toLowerCase();
  return ['all', 'media', 'video', 'poll', 'unanswered'].includes(filter) ? filter : 'all';
}

export function normalizeBoardThreadsPayload(payload) {
  if (Array.isArray(payload)) {
    return { threads: payload, meta: null };
  }
  const threads = Array.isArray(payload?.items) ? payload.items : [];
  return { threads, meta: payload && typeof payload === 'object' ? payload : null };
}

export function findBoardByQuery(query, boards = []) {
  const normalized = normalizeSearchValue(query);
  if (!normalized) {
    return null;
  }
  return boards.find((board) => {
    const slug = normalizeSearchValue(board.slug);
    const path = normalizeSearchValue(board.path).replaceAll('/', '');
    const name = normalizeSearchValue(board.name);
    return slug === normalized || path === normalized.replaceAll('/', '') || name.includes(normalized);
  }) || null;
}

export function boardHeading(board) {
  if (!board) {
    return '36chan';
  }
  return `${board.path} - ${board.name}`;
}

export function boardRulesForDisplay(board) {
  const rules = Array.isArray(board?.rules) ? board.rules : [];
  return rules.length ? rules : [board?.description || 'Diễn đàn ảnh sinh viên ẩn danh có AI kiểm duyệt.'];
}

export function boardPostCount(threads = []) {
  return threads.reduce((total, thread) => total + 1 + Number(thread.replyCount || 0), 0);
}

export function popularThreadsFrom(threadsByBoard: AnyRecord) {
  return Object.values(threadsByBoard)
    .flat()
    .sort((left, right) => right.bumpedAt.localeCompare(left.bumpedAt))
    .slice(0, 8);
}

export function threadMatchesSearch(thread, term, boards = []) {
  const normalizedTerm = normalizeSearchValue(term);
  if (!normalizedTerm) {
    return true;
  }
  const board = boards.find((item) => item.slug === thread.boardSlug);
  const haystack = normalizeSearchValue(
    `${boardHeading(board)} ${threadSubject(thread)} ${plainPreview(thread.bodyLines, '')} No.${thread.globalNumber}`
  );
  return haystack.includes(normalizedTerm);
}

export function omittedRepliesHtml(thread) {
  const replyCount = Number(thread.omittedReplyCount || 0);
  const imageCount = Number(thread.omittedImageCount || 0);
  if (replyCount <= 0 && imageCount <= 0) return '';
  const replyText = replyCount > 0 ? `${replyCount} phản hồi` : '';
  const imageText = imageCount > 0 ? `${imageCount} tệp` : '';
  return `<div class="omitted-replies">Bỏ qua ${[replyText, imageText].filter(Boolean).join(' và ')}.</div>`;
}
