import type { AnyRecord } from './types';
import { normalizeCommentComposerMode } from './comment-composer-mode';
export { normalizeCommentComposerMode } from './comment-composer-mode';
import {
  WATCHED_THREAD_SORTS,
  deletePasswordKey,
  displayPreferencesKey,
  hiddenPostsKey,
  hiddenThreadsKey,
  myPostsKey,
  notificationPreferencesKey,
  subscribedBoardsKey
} from './constants';

export function getPosterToken() {
  const key = 'posterToken';
  const current = localStorage.getItem(key);
  if (current) {
    return current;
  }
  const next =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(key, next);
  return next;
}

const ADMIN_TOKEN_KEY = 'adminToken';
const ACCOUNT_TOKEN_KEY = 'accountToken';

function safeStorageGet(store: Storage | undefined, key: string): string {
  try {
    return store?.getItem(key) || '';
  } catch {
    return '';
  }
}

function safeStorageSet(store: Storage | undefined, key: string, value: string): void {
  try {
    if (!store) {
      return;
    }
    if (value) {
      store.setItem(key, value);
    } else {
      store.removeItem(key);
    }
  } catch {
    // Private mode / quota: ignore — memory state still holds the token for this page.
  }
}

/**
 * Admin/moderator tokens are high privilege. Prefer sessionStorage so they do not
 * survive browser restart, and migrate any legacy localStorage value once.
 * Note: still XSS-readable while the page is open; full mitigation needs httpOnly cookies.
 */
export function readAdminToken(): string {
  const session = safeStorageGet(typeof sessionStorage !== 'undefined' ? sessionStorage : undefined, ADMIN_TOKEN_KEY);
  if (session) {
    return session;
  }
  const legacy = safeStorageGet(typeof localStorage !== 'undefined' ? localStorage : undefined, ADMIN_TOKEN_KEY);
  if (legacy) {
    safeStorageSet(typeof sessionStorage !== 'undefined' ? sessionStorage : undefined, ADMIN_TOKEN_KEY, legacy);
    safeStorageSet(typeof localStorage !== 'undefined' ? localStorage : undefined, ADMIN_TOKEN_KEY, '');
    return legacy;
  }
  return '';
}

export function writeAdminToken(token = ''): void {
  const value = String(token || '');
  // Never keep admin tokens in localStorage.
  safeStorageSet(typeof localStorage !== 'undefined' ? localStorage : undefined, ADMIN_TOKEN_KEY, '');
  safeStorageSet(typeof sessionStorage !== 'undefined' ? sessionStorage : undefined, ADMIN_TOKEN_KEY, value);
}

export function clearAdminToken(): void {
  writeAdminToken('');
}

/** Account tokens stay in localStorage for "remember me" across restarts. */
export function readAccountToken(): string {
  return safeStorageGet(typeof localStorage !== 'undefined' ? localStorage : undefined, ACCOUNT_TOKEN_KEY);
}

export function writeAccountToken(token = ''): void {
  safeStorageSet(typeof localStorage !== 'undefined' ? localStorage : undefined, ACCOUNT_TOKEN_KEY, String(token || ''));
}

export function clearAccountToken(): void {
  writeAccountToken('');
}

export function threadLastSeenKey(threadId) {
  return `threadLastSeen:${threadId}`;
}

export function readThreadLastSeen(threadId) {
  const value = Number(localStorage.getItem(threadLastSeenKey(threadId)) || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function writeThreadLastSeen(threadId, globalNumber) {
  const value = Number(globalNumber);
  if (threadId && Number.isFinite(value) && value > 0) {
    localStorage.setItem(threadLastSeenKey(threadId), String(Math.floor(value)));
  }
}

export function readJsonLocal(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeJsonLocal(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function readLocalList(key) {
  const value = readJsonLocal(key, []);
  return Array.isArray(value) ? value : [];
}

export function normalizeWatchedSort(value) {
  return WATCHED_THREAD_SORTS.has(value) ? value : 'unread';
}

export function localDisplayPreferences() {
  const value = readJsonLocal(displayPreferencesKey, {});
  return {
    compactThreads: Boolean(value.compactThreads),
    hideThumbnails: Boolean(value.hideThumbnails),
    watchedUnreadOnly: Boolean(value.watchedUnreadOnly),
    watchedSort: normalizeWatchedSort(value.watchedSort),
    commentComposerMode: normalizeCommentComposerMode(value.commentComposerMode)
  };
}

export function writeLocalDisplayPreferences(preferences: AnyRecord = {}) {
  const safe = {
    compactThreads: Boolean(preferences.compactThreads),
    hideThumbnails: Boolean(preferences.hideThumbnails),
    watchedUnreadOnly: Boolean(preferences.watchedUnreadOnly),
    watchedSort: normalizeWatchedSort(preferences.watchedSort),
    commentComposerMode: normalizeCommentComposerMode(preferences.commentComposerMode)
  };
  writeJsonLocal(displayPreferencesKey, safe);
  return safe;
}

export function localNotificationPreferences() {
  const value = readJsonLocal(notificationPreferencesKey, {});
  return {
    email: Boolean(value.email),
    watchedThreads: value.watchedThreads !== false,
    boardSubscriptions: Boolean(value.boardSubscriptions),
    browserWatchedThreads: Boolean(value.browserWatchedThreads)
  };
}

export function writeLocalNotificationPreferences(preferences: AnyRecord = {}) {
  const safe = {
    email: Boolean(preferences.email),
    watchedThreads: preferences.watchedThreads !== false,
    boardSubscriptions: Boolean(preferences.boardSubscriptions),
    browserWatchedThreads: Boolean(preferences.browserWatchedThreads)
  };
  writeJsonLocal(notificationPreferencesKey, safe);
  return safe;
}

export function addLocalSetItem(key, value) {
  const items = new Set(readLocalList(key).map(String));
  items.add(String(value));
  writeJsonLocal(key, [...items]);
}

export function removeLocalSetItem(key, value) {
  const items = new Set(readLocalList(key).map(String));
  items.delete(String(value));
  writeJsonLocal(key, [...items]);
}

export function clearLocalSet(key) {
  writeJsonLocal(key, []);
}

export function defaultDeletePassword() {
  const current = localStorage.getItem(deletePasswordKey);
  if (current) {
    return current;
  }
  const next = Math.random().toString(36).slice(2, 10);
  localStorage.setItem(deletePasswordKey, next);
  return next;
}

export function normalizeDeletePassword(value = '') {
  return String(value ?? '').trim().slice(0, 120);
}

export function draftKey(kind, id) {
  return `draft:${kind}:${id}`;
}

const DRAFT_UPDATED_AT_PREFIX = 'draftUpdatedAt:';
const LEGACY_DRAFT_UPDATED_AT = '1970-01-01T00:00:00.000Z';

export function draftUpdatedAtKey(key = '') {
  return `${DRAFT_UPDATED_AT_PREFIX}${String(key)}`;
}

export function writeLocalDraft(key = '', body = '', updatedAt = new Date().toISOString()) {
  const safeKey = String(key);
  const safeBody = String(body ?? '');
  if (!safeBody) {
    removeLocalDraft(safeKey);
    return '';
  }
  localStorage.setItem(safeKey, safeBody);
  localStorage.setItem(draftUpdatedAtKey(safeKey), String(updatedAt || new Date().toISOString()));
  return safeBody;
}

export function removeLocalDraft(key = '') {
  const safeKey = String(key);
  localStorage.removeItem(safeKey);
  localStorage.removeItem(draftUpdatedAtKey(safeKey));
}

export function parseDraftKey(key = '') {
  const [, kind = '', id = ''] = String(key).split(':');
  return { kind, id };
}

export function localDraftEntries() {
  const drafts = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('draft:')) {
      continue;
    }
    const body = localStorage.getItem(key) || '';
    if (!body) {
      continue;
    }
    const { kind, id } = parseDraftKey(key);
    const updatedAt = localStorage.getItem(draftUpdatedAtKey(key)) || LEGACY_DRAFT_UPDATED_AT;
    drafts.push({ key, kind, id, body, updatedAt });
  }
  return drafts;
}

export function myPosts() {
  return readLocalList(myPostsKey).filter((item) => item && typeof item === 'object');
}

export function hiddenThreadIds() {
  return new Set(readLocalList(hiddenThreadsKey).map(String));
}

export function hiddenPostNumbers() {
  return new Set(readLocalList(hiddenPostsKey).map(String));
}

export function subscribedBoardSlugs() {
  return new Set(readLocalList(subscribedBoardsKey).map(String));
}

export function writeSubscribedBoardSlugs(slugs = []) {
  const items = [...new Set(slugs.map((slug) => String(slug).trim()).filter(Boolean))];
  writeJsonLocal(subscribedBoardsKey, items);
  return items;
}

export function readVote(globalNumber) {
  try {
    return localStorage.getItem(`vote:${globalNumber}`) || '';
  } catch {
    return '';
  }
}

export function writeVote(globalNumber, direction) {
  try {
    if (direction) {
      localStorage.setItem(`vote:${globalNumber}`, direction);
    } else {
      localStorage.removeItem(`vote:${globalNumber}`);
    }
  } catch {
    /* ignore storage errors */
  }
}

export function readReaction(globalNumber) {
  try {
    return localStorage.getItem(`reaction:${globalNumber}`) || '';
  } catch {
    return '';
  }
}

export function writeReaction(globalNumber, reaction) {
  try {
    if (reaction) {
      localStorage.setItem(`reaction:${globalNumber}`, reaction);
    } else {
      localStorage.removeItem(`reaction:${globalNumber}`);
    }
  } catch {
    /* ignore storage errors */
  }
}
