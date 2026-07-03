import type { AnyRecord } from './types';

export function defaultAccountPrivateData() {
  return {
    watchlist: [],
    drafts: [],
    savedSearches: [],
    contentFilters: [],
    replyTemplates: [],
    posterNotes: []
  };
}

export function privateItemId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function normalizePrivateItems(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => ({
      key,
      ...(item && typeof item === 'object' ? item : {})
    }));
  }
  return [];
}

export function safePrivateText(value = '', maxLength = 160) {
  return [...String(value ?? '')]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function safeReplyTemplateBody(value = '') {
  return [...String(value ?? '')]
    .filter((char) => char.charCodeAt(0) !== 0)
    .join('')
    .trim()
    .slice(0, 5000);
}

export function normalizeContentFilters(value = []) {
  const allowedTypes = new Set(['keyword', 'poster', 'thread', 'post']);
  const seen = new Set();
  return normalizePrivateItems(value)
    .map((item) => ({
      id: safePrivateText(item?.id || item?.key || privateItemId(), 120),
      type: safePrivateText(item?.type, 40).toLowerCase(),
      value: safePrivateText(item?.value || item?.keyword || item?.posterHash || item?.threadId || item?.globalNumber || item?.key, 160),
      label: safePrivateText(item?.label, 180),
      boardSlug: safePrivateText(item?.boardSlug, 80),
      createdAt: safePrivateText(item?.createdAt || new Date().toISOString(), 80)
    }))
    .filter((item) => allowedTypes.has(item.type) && item.value)
    .filter((item) => {
      const key = `${item.type}:${item.boardSlug}:${item.value.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 80);
}

export function normalizeReplyTemplates(value = []) {
  const seen = new Set();
  return normalizePrivateItems(value)
    .map((item) => {
      const body = safeReplyTemplateBody(item?.body || item?.text || item?.value);
      return {
        id: safePrivateText(item?.id || item?.key || privateItemId(), 120),
        title: safePrivateText(item?.title || item?.label || body.split('\n').find((line) => line.trim()) || 'Mẫu trả lời', 120),
        body,
        boardSlug: safePrivateText(item?.boardSlug, 80),
        createdAt: safePrivateText(item?.createdAt || new Date().toISOString(), 80),
        updatedAt: safePrivateText(item?.updatedAt || item?.createdAt || new Date().toISOString(), 80)
      };
    })
    .filter((item) => item.body)
    .filter((item) => {
      const key = `${item.boardSlug}:${item.title.toLowerCase()}:${item.body}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 40);
}

export function normalizePosterNotes(value = []) {
  const seen = new Set();
  return normalizePrivateItems(value)
    .map((item) => ({
      id: safePrivateText(item?.id || item?.key || privateItemId(), 120),
      posterId: safePrivateText(item?.posterId || item?.posterHash || item?.poster || item?.value || item?.idText || item?.key, 80),
      label: safePrivateText(item?.label || item?.title, 120),
      note: safePrivateText(item?.note || item?.body || item?.text, 500),
      boardSlug: safePrivateText(item?.boardSlug, 80),
      createdAt: safePrivateText(item?.createdAt || new Date().toISOString(), 80),
      updatedAt: safePrivateText(item?.updatedAt || item?.createdAt || new Date().toISOString(), 80)
    }))
    .filter((item) => item.posterId && (item.label || item.note))
    .filter((item) => {
      const key = `${item.boardSlug}:${item.posterId.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 120);
}

export function normalizeAccountPrivateData(value: AnyRecord = {}) {
  return {
    watchlist: Array.isArray(value.watchlist) ? value.watchlist.filter((item) => item?.threadId).slice(0, 100) : [],
    drafts: Array.isArray(value.drafts) ? value.drafts.filter((item) => item?.key && item?.body).slice(0, 40) : [],
    savedSearches: Array.isArray(value.savedSearches)
      ? value.savedSearches.filter((item) => item?.boardSlug && item?.query).slice(0, 50)
      : [],
    contentFilters: normalizeContentFilters(value.contentFilters),
    replyTemplates: normalizeReplyTemplates(value.replyTemplates),
    posterNotes: normalizePosterNotes(value.posterNotes)
  };
}

export function mergeByKey(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (key) {
      map.set(key, item);
    }
  });
  return [...map.values()];
}
