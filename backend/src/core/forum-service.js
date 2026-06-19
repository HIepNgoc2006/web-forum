import crypto from 'node:crypto';

import {
  BOARDS,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_THUMBNAIL_BYTES,
  THREAD_LIFECYCLE,
  aiConfigStatus,
  readPositiveInteger
} from './config.js';
import { redactSensitiveText } from './ai.js';
import { createInlineImageStorage } from './image-storage.js';
import { createModerationFingerprint, createPosterHash, createPosterProofHash, createTripcode, verifyHcaptcha } from './security.js';
import { normalizeBody, parsePostText, sanitizeText } from './text-format.js';
import * as defaultTotp from './totp-service.js';
import * as defaultWebAuthn from './webauthn-service.js';

const noopLogger = () => {};
const PULSE_STOP_WORDS = new Set([
  'anh',
  'ban',
  'bai',
  'binh',
  'cac',
  'cho',
  'con',
  'cong',
  'cua',
  'dang',
  'day',
  'den',
  'duoc',
  'hoc',
  'khai',
  'khong',
  'khi',
  'luan',
  'minh',
  'mot',
  'nay',
  'neu',
  'noi',
  'nua',
  'qua',
  'sinh',
  'tap',
  'thi',
  'thread',
  'trong',
  'voi'
]);
const SLOW_MODE_LABELS = new Set(['Toxic', 'Spam', 'Hate Speech', 'Fake News']);
const ANONYMOUS_DISPLAY_NAME = 'Anonymous';
const MAX_DISPLAY_NAME_LENGTH = 40;
const RESERVED_DISPLAY_NAMES = new Set(['admin', 'administrator', 'moderator', 'mod', 'system']);
const ACCOUNT_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const MAX_FAILED_LOGINS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const ACCOUNT_THEMES = new Set(['yotsuba-b', 'yotsuba', 'tomorrow']);
const MAX_ACCOUNT_WATCHLIST_ITEMS = 100;
const MAX_ACCOUNT_DRAFTS = 40;
const MAX_ACCOUNT_SAVED_SEARCHES = 50;
const MAX_ACCOUNT_DRAFT_LENGTH = 12_000;
const ACCOUNT_DISPLAY_PREFS = ['compactThreads', 'hideThumbnails'];
const ACCOUNT_NOTIFICATION_PREFS = ['email', 'watchedThreads', 'boardSubscriptions'];
const BOARD_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function publicPost(post) {
  return !post.isPending && !post.isDeleted;
}

function stripPrivatePostFields(post) {
  const {
    authorFingerprint: _authorFingerprint,
    opProofHash: _opProofHash,
    deletePasswordHash: _deletePasswordHash,
    pollVotes: _pollVotes,
    voters: _voters,
    stickiedBy: _stickiedBy,
    accountId: _accountId,
    ...publicFields
  } = post;
  if (publicFields.body) {
    publicFields.body = sanitizeText(publicFields.body);
  }
  return publicFields;
}

function activePublicThread(thread) {
  return publicPost(thread) && !thread.isArchived;
}

function archivedPublicThread(thread) {
  return publicPost(thread) && thread.isArchived;
}

function publicReplyCount(state, threadId) {
  return state.comments.filter((comment) => comment.threadId === threadId && publicPost(comment)).length;
}

function archiveThreadRecord(thread, reason, archivedAt) {
  thread.isArchived = true;
  thread.archivedAt = archivedAt;
  thread.archivedReason = reason;
  thread.isSticky = false;
  thread.stickiedAt = null;
  thread.stickiedBy = null;
}

function boardEventEnded(board, at) {
  return Boolean(board?.temporary && board.eventEndsAt && String(board.eventEndsAt).localeCompare(at) <= 0);
}

function publicBoard(board = {}) {
  return Boolean(board?.slug) && !board.isHidden && !board.isArchived;
}

function serializeBoard(board = {}, { admin = false } = {}) {
  const serialized = {
    slug: board.slug,
    path: board.path || `/${board.slug}/`,
    name: board.name,
    category: board.category,
    description: board.description,
    temporary: Boolean(board.temporary),
    eventEndsAt: board.eventEndsAt ?? null
  };
  if (admin) {
    serialized.isHidden = Boolean(board.isHidden);
    serialized.isArchived = Boolean(board.isArchived);
  }
  return serialized;
}

function findBoard(state, slug, { publicOnly = false } = {}) {
  const board = state.boards.find((item) => item.slug === slug);
  if (!board || (publicOnly && !publicBoard(board))) {
    return null;
  }
  return board;
}

function assertBoardText(value, field, maxLength) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    const error = new Error(`${field} là bắt buộc`);
    error.statusCode = 400;
    throw error;
  }
  return text.slice(0, maxLength);
}

function normalizeBoardInput({ slug, name, category, description, isHidden, isArchived } = {}, { requireSlug = true } = {}) {
  const board = {};
  if (requireSlug || slug !== undefined) {
    const safeSlug = String(slug ?? '').trim().toLowerCase();
    if (!BOARD_SLUG_PATTERN.test(safeSlug)) {
      const error = new Error('Slug board không hợp lệ');
      error.statusCode = 400;
      throw error;
    }
    board.slug = safeSlug;
    board.path = `/${safeSlug}/`;
  }
  if (name !== undefined || requireSlug) board.name = assertBoardText(name, 'Tên board', 80);
  if (category !== undefined || requireSlug) board.category = assertBoardText(category, 'Danh mục board', 80);
  if (description !== undefined || requireSlug) board.description = assertBoardText(description, 'Mô tả board', 240);
  if (typeof isHidden === 'boolean') board.isHidden = isHidden;
  if (typeof isArchived === 'boolean') board.isArchived = isArchived;
  return board;
}

function assertEventBoardOpen(board, at) {
  if (!boardEventEnded(board, at)) {
    return;
  }
  const error = new Error('Bảng sự kiện đã kết thúc và đã chuyển sang lưu trữ');
  error.statusCode = 409;
  throw error;
}

function daySalt(date) {
  return date.toISOString().slice(0, 10);
}

function dataUrlBytes(dataUrl = '') {
  const base64 = String(dataUrl).split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function sanitizePositiveInteger(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.min(Math.round(number), max);
}

function paginationOptions({ page, pageSize, maxPageSize = 50 } = {}) {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.max(1, Math.min(Math.floor(Number(pageSize) || maxPageSize), maxPageSize));
  return {
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize
  };
}

function pagedResult(items, options = {}) {
  const { page, pageSize, offset } = paginationOptions(options);
  const total = items.length;
  return {
    items: items.slice(offset, offset + pageSize),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    hasMore: offset + pageSize < total
  };
}

function normalizeSearchTerm(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .slice(0, 120);
}

function postMatchesSearch(post, term) {
  if (!term) {
    return true;
  }
  const haystack = [post.body, post.globalNumber, post.posterHash]
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return haystack.includes(term);
}

function threadMatchesSearch(state, thread, term) {
  if (!term || postMatchesSearch(thread, term)) {
    return true;
  }
  return state.comments.some((comment) => comment.threadId === thread.id && publicPost(comment) && postMatchesSearch(comment, term));
}

function parsePostingOptions(value = '') {
  const tokens = new Set(
    String(value)
      .toLowerCase()
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
  return {
    raw: [...tokens].join(' '),
    sage: tokens.has('sage'),
    noko: tokens.has('noko')
  };
}

function normalizeDisplayName(value = '') {
  const displayName = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[&<>"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH);
  return displayName;
}

function assertDisplayName(value = '') {
  const displayName = normalizeDisplayName(value);
  if (RESERVED_DISPLAY_NAMES.has(displayName.toLowerCase())) {
    const error = new Error('Tên hiển thị này không dùng được');
    error.statusCode = 400;
    throw error;
  }
  return displayName;
}

function publicDisplayName(value = '') {
  return normalizeDisplayName(value) || ANONYMOUS_DISPLAY_NAME;
}

// Splits a raw display-name field into a sanitized name and an optional
// tripcode. `name#secret` -> insecure trip, `name##secret` -> secure trip.
// The reserved-name and length rules apply to the name part only; the secret
// never reaches storage or the public surface.
function parseDisplayNameWithTripcode(value = '') {
  const raw = String(value ?? '');
  const hashIndex = raw.indexOf('#');
  if (hashIndex === -1) {
    return { displayName: assertDisplayName(raw), tripcode: null };
  }
  const namePart = raw.slice(0, hashIndex);
  const secret = raw.slice(hashIndex + 1);
  return {
    displayName: assertDisplayName(namePart),
    tripcode: createTripcode(secret)
  };
}

// Capcodes let a verified privileged account stamp a post with its role. The
// caller (http-app) resolves the role from the authenticated token; this guard
// only allows the known privileged roles so a forged value cannot leak through.
function normalizeCapcode(value) {
  return value === 'admin' || value === 'moderator' ? value : null;
}

function normalizeAccountUsername(value = '') {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .slice(0, 32);
}

function assertAccountUsername(value = '') {
  const username = normalizeAccountUsername(value);
  if (!ACCOUNT_USERNAME_PATTERN.test(username)) {
    const error = new Error('Tên tài khoản cần 3-32 ký tự: chữ thường, số, dấu chấm, gạch dưới hoặc gạch nối');
    error.statusCode = 400;
    throw error;
  }
  if (['admin', 'administrator', 'moderator', 'mod', 'system', 'anonymous'].includes(username)) {
    const error = new Error('Tên tài khoản này không dùng được');
    error.statusCode = 400;
    throw error;
  }
  return username;
}

const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 160;

// Small embedded blocklist of obviously weak/common passwords. Compared
// case-insensitively. Not exhaustive by design — an online breach (HIBP)
// check can be layered on later.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd',
  '1234567890', '0123456789', '12345678', '123456789', '123123123',
  'qwertyuiop', 'qwerty123', 'iloveyou1', 'letmein123', 'welcome123',
  'admin12345', 'changeme12', 'baseball12', 'football12', 'monkey1234',
  'abc1234567', 'dragon1234', 'sunshine12', 'princess12', '36chan1234'
]);

function isTrivialSequence(value = '') {
  if (value.length < 2) {
    return false;
  }
  let ascending = true;
  let descending = true;
  for (let i = 1; i < value.length; i += 1) {
    const delta = value.charCodeAt(i) - value.charCodeAt(i - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
  }
  return ascending || descending;
}

function assertAccountPassword(value = '', { username = '' } = {}) {
  const password = String(value ?? '');
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    const error = new Error(`Mật khẩu cần từ ${MIN_PASSWORD_LENGTH} đến ${MAX_PASSWORD_LENGTH} ký tự`);
    error.statusCode = 400;
    throw error;
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    const error = new Error('Mật khẩu quá phổ biến, vui lòng chọn mật khẩu khác');
    error.statusCode = 400;
    throw error;
  }
  if (username && lower === String(username).toLowerCase()) {
    const error = new Error('Mật khẩu không được trùng với tên tài khoản');
    error.statusCode = 400;
    throw error;
  }
  if (/^(.)\1+$/.test(password) || isTrivialSequence(lower)) {
    const error = new Error('Mật khẩu quá đơn giản, vui lòng chọn mật khẩu khác');
    error.statusCode = 400;
    throw error;
  }
  return password;
}

function accountPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 120_000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2-sha256:${iterations}:${salt}:${hash}`;
}

function verifyAccountPassword(password, stored = '') {
  const [algorithm, iterationsText, salt, expectedHash] = String(stored).split(':');
  const iterations = Number(iterationsText);
  if (algorithm !== 'pbkdf2-sha256' || !Number.isFinite(iterations) || !salt || !expectedHash) {
    return false;
  }
  const actualHash = crypto.pbkdf2Sync(String(password ?? ''), salt, iterations, 32, 'sha256').toString('hex');
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Recovery codes let a user reset a forgotten password without email/SMS:
// a one-time code is issued at registration (and can be regenerated while
// logged in), stored only as a SHA-256 hash, and rotated after each use.
function generateRecoveryCode() {
  const raw = crypto.randomBytes(10).toString('hex').toUpperCase();
  return raw.match(/.{1,5}/g).join('-');
}

function hashRecoveryCode(code) {
  const normalized = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// A well-formed hash used to equalize login timing when the account does not
// exist, so the expensive PBKDF2 path runs on both the "no such user" and the
// "user exists, wrong password" branches and the latency cannot be used to
// enumerate usernames.
const DUMMY_PASSWORD_HASH = accountPasswordHash(crypto.randomUUID());

function defaultAccountSettings() {
  return {
    theme: 'yotsuba-b',
    homeBoard: 'confession',
    syncDrafts: true,
    emailNotifications: false,
    displayPreferences: {
      compactThreads: false,
      hideThumbnails: false
    },
    notificationPreferences: {
      email: false,
      watchedThreads: true,
      boardSubscriptions: false
    },
    boardSubscriptions: []
  };
}

function normalizeBoardSubscriptionSlugs(values = [], state = {}) {
  const boards = Array.isArray(state.boards) && state.boards.length > 0 ? state.boards : BOARDS;
  const slugs = new Set();
  for (const item of values) {
    const slug = String(item || '').trim();
    if (boards.find((board) => board.slug === slug && !board.isArchived)) {
      slugs.add(slug);
    }
    if (slugs.size >= boards.length) {
      break;
    }
  }
  return [...slugs];
}

function normalizeAccountSettings(state, settings = {}, current = defaultAccountSettings()) {
  const defaults = defaultAccountSettings();
  const safe = {
    ...defaults,
    ...current,
    displayPreferences: {
      ...defaults.displayPreferences,
      ...(current.displayPreferences && typeof current.displayPreferences === 'object' ? current.displayPreferences : {})
    },
    notificationPreferences: {
      ...defaults.notificationPreferences,
      ...(current.notificationPreferences && typeof current.notificationPreferences === 'object'
        ? current.notificationPreferences
        : {})
    },
    boardSubscriptions: normalizeBoardSubscriptionSlugs(current.boardSubscriptions || defaults.boardSubscriptions, state)
  };
  if (typeof current.emailNotifications === 'boolean' && !current.notificationPreferences) {
    safe.notificationPreferences.email = current.emailNotifications;
  }
  const theme = String(settings.theme ?? safe.theme);
  if (ACCOUNT_THEMES.has(theme)) {
    safe.theme = theme;
  }
  const boardSlug = String(settings.homeBoard ?? safe.homeBoard);
  if (findBoard(state, boardSlug, { publicOnly: true })) {
    safe.homeBoard = boardSlug;
  }
  if (typeof settings.syncDrafts === 'boolean') {
    safe.syncDrafts = settings.syncDrafts;
  }
  if (typeof settings.emailNotifications === 'boolean') {
    safe.emailNotifications = settings.emailNotifications;
    safe.notificationPreferences.email = settings.emailNotifications;
  }
  if (settings.displayPreferences && typeof settings.displayPreferences === 'object') {
    for (const key of ACCOUNT_DISPLAY_PREFS) {
      if (typeof settings.displayPreferences[key] === 'boolean') {
        safe.displayPreferences[key] = settings.displayPreferences[key];
      }
    }
  }
  if (settings.notificationPreferences && typeof settings.notificationPreferences === 'object') {
    for (const key of ACCOUNT_NOTIFICATION_PREFS) {
      if (typeof settings.notificationPreferences[key] === 'boolean') {
        safe.notificationPreferences[key] = settings.notificationPreferences[key];
      }
    }
    safe.emailNotifications = safe.notificationPreferences.email;
  }
  if (Array.isArray(settings.boardSubscriptions)) {
    safe.boardSubscriptions = normalizeBoardSubscriptionSlugs(settings.boardSubscriptions, state);
  }
  return safe;
}

function safePrivateString(value = '', maxLength = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeDraftBody(value = '') {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .slice(0, MAX_ACCOUNT_DRAFT_LENGTH);
}

function normalizePrivateItems(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => ({ key, ...(item && typeof item === 'object' ? item : {}) }));
  }
  return [];
}

function normalizeAccountWatchlist(value = []) {
  const seen = new Set();
  return normalizePrivateItems(value)
    .map((item) => ({
      threadId: safePrivateString(item.threadId || item.id || item.key, 120),
      boardSlug: safePrivateString(item.boardSlug, 80),
      boardPath: safePrivateString(item.boardPath, 80),
      boardName: safePrivateString(item.boardName, 120),
      globalNumber: safePrivateString(item.globalNumber, 40),
      preview: safePrivateString(item.preview, 240),
      lastSeen: sanitizePositiveInteger(item.lastSeen, Number.MAX_SAFE_INTEGER) || 0,
      maxNumber: sanitizePositiveInteger(item.maxNumber, Number.MAX_SAFE_INTEGER) || 0,
      replyCount: sanitizePositiveInteger(item.replyCount, 1_000_000) || 0,
      fileCount: sanitizePositiveInteger(item.fileCount, 1_000_000) || 0,
      isArchived: Boolean(item.isArchived),
      updatedAt: safePrivateString(item.updatedAt || item.createdAt, 80)
    }))
    .filter((item) => item.threadId)
    .filter((item) => {
      if (seen.has(item.threadId)) {
        return false;
      }
      seen.add(item.threadId);
      return true;
    })
    .slice(0, MAX_ACCOUNT_WATCHLIST_ITEMS);
}

function normalizeAccountDrafts(value = []) {
  const seen = new Set();
  return normalizePrivateItems(value)
    .map((item) => ({
      key: safePrivateString(item.key, 160),
      kind: safePrivateString(item.kind, 40),
      id: safePrivateString(item.id, 120),
      boardSlug: safePrivateString(item.boardSlug, 80),
      threadId: safePrivateString(item.threadId, 120),
      body: safeDraftBody(item.body),
      updatedAt: safePrivateString(item.updatedAt, 80)
    }))
    .filter((item) => item.key && item.body)
    .filter((item) => {
      if (seen.has(item.key)) {
        return false;
      }
      seen.add(item.key);
      return true;
    })
    .slice(0, MAX_ACCOUNT_DRAFTS);
}

function normalizeAccountSavedSearches(value = []) {
  const seen = new Set();
  return normalizePrivateItems(value)
    .map((item) => ({
      id: safePrivateString(item.id || item.key || crypto.randomUUID(), 120),
      boardSlug: safePrivateString(item.boardSlug, 80),
      query: safePrivateString(item.query || item.term, 160),
      label: safePrivateString(item.label, 180),
      createdAt: safePrivateString(item.createdAt, 80),
      updatedAt: safePrivateString(item.updatedAt, 80)
    }))
    .filter((item) => item.boardSlug && item.query)
    .filter((item) => {
      const key = `${item.boardSlug}:${item.query}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ACCOUNT_SAVED_SEARCHES);
}

function defaultAccountPrivateData() {
  return {
    watchlist: [],
    drafts: [],
    savedSearches: []
  };
}

function normalizeAccountPrivateData(value = {}, current = defaultAccountPrivateData()) {
  const input = value && typeof value === 'object' ? value : {};
  const previous = current && typeof current === 'object' ? current : defaultAccountPrivateData();
  const safe = {
    watchlist: normalizeAccountWatchlist(previous.watchlist),
    drafts: normalizeAccountDrafts(previous.drafts),
    savedSearches: normalizeAccountSavedSearches(previous.savedSearches)
  };
  if (Object.hasOwn(input, 'watchlist')) {
    safe.watchlist = normalizeAccountWatchlist(input.watchlist);
  }
  if (Object.hasOwn(input, 'drafts')) {
    safe.drafts = normalizeAccountDrafts(input.drafts);
  }
  if (Object.hasOwn(input, 'savedSearches')) {
    safe.savedSearches = normalizeAccountSavedSearches(input.savedSearches);
  }
  return safe;
}

function serializeAccountPrivateData(value = {}) {
  return normalizeAccountPrivateData(value, value);
}

function serializeAccount(state, user = {}) {
  return {
    id: user.id,
    username: user.username,
    role: user.role || 'user',
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    hasRecoveryCode: Boolean(user.recoveryCodeHash),
    settings: normalizeAccountSettings(state, {}, user.settings),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function deletePasswordHash(password) {
  const value = String(password || '').slice(0, 120);
  if (!value) {
    return '';
  }
  return crypto
    .createHash('sha256')
    .update(`${process.env.DELETE_PASSWORD_SECRET || process.env.JWT_SECRET || '36chan-delete'}:${value}`)
    .digest('hex');
}

function verifyDeletePassword(post, password) {
  if (!post.deletePasswordHash || post.deletePasswordHash !== deletePasswordHash(password)) {
    const error = new Error('Mật khẩu xóa không đúng');
    error.statusCode = 403;
    throw error;
  }
}

function referencedPostNumbers(body = '') {
  return [...String(body).matchAll(/(?:>>|&gt;&gt;)(\d+)/g)].map((match) => Number(match[1])).filter((number) => Number.isFinite(number));
}

function addBacklinks(posts) {
  const postByNumber = new Map(posts.map((post) => [Number(post.globalNumber), post]));
  const backlinks = new Map(posts.map((post) => [Number(post.globalNumber), []]));
  for (const source of posts) {
    for (const targetNumber of referencedPostNumbers(source.body)) {
      if (targetNumber !== Number(source.globalNumber) && postByNumber.has(targetNumber)) {
        backlinks.get(targetNumber)?.push(Number(source.globalNumber));
      }
    }
  }
  return posts.map((post) => ({
    ...post,
    backlinks: [...new Set(backlinks.get(Number(post.globalNumber)) || [])].sort((left, right) => left - right)
  }));
}

function sanitizeFileName(name) {
  return (
    String(name ?? 'tai-len')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[&<>"']/g, '')
      .slice(0, 120) || 'tai-len'
  );
}

function createPoll(pollOptions) {
  if (!Array.isArray(pollOptions)) {
    return null;
  }
  const seen = new Set();
  const options = pollOptions
    .map((option) => normalizeBody(option).slice(0, 120))
    .filter(Boolean)
    .filter((option) => {
      const key = option.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map((text, index) => ({ id: String(index + 1), text, votes: 0 }));

  if (options.length < 2) {
    return null;
  }
  return { options, totalVotes: 0 };
}

function publicVotes(post) {
  const up = Number(post?.votes?.up || 0);
  const down = Number(post?.votes?.down || 0);
  return { up, down, score: up - down };
}

const COMMENT_SORTS = new Set(['best', 'top', 'new', 'controversial', 'old']);

function normalizeCommentSort(value) {
  const sort = String(value || '').toLowerCase();
  return COMMENT_SORTS.has(sort) ? sort : 'old';
}

// Wilson score lower bound (95% confidence) — Reddit's "best" ranking. Rewards
// a high upvote ratio while discounting low-sample posts.
function wilsonLowerBound(up, down) {
  const n = up + down;
  if (n <= 0) {
    return 0;
  }
  const z = 1.96;
  const phat = up / n;
  return (phat + (z * z) / (2 * n) - z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
}

// Reddit-style controversy: high total engagement with a balanced up/down split.
function controversyScore(up, down) {
  if (up <= 0 || down <= 0) {
    return 0;
  }
  const magnitude = up + down;
  const balance = up > down ? down / up : up / down;
  return magnitude ** balance;
}

function sortComments(comments, sort) {
  const list = [...comments];
  const byNumberAsc = (left, right) => Number(left.globalNumber) - Number(right.globalNumber);
  switch (sort) {
    case 'new':
      return list.sort((left, right) => Number(right.globalNumber) - Number(left.globalNumber));
    case 'top':
      return list.sort((left, right) => right.votes.score - left.votes.score || byNumberAsc(left, right));
    case 'best':
      return list.sort(
        (left, right) =>
          wilsonLowerBound(right.votes.up, right.votes.down) - wilsonLowerBound(left.votes.up, left.votes.down) ||
          right.votes.score - left.votes.score ||
          byNumberAsc(left, right)
      );
    case 'controversial':
      return list.sort(
        (left, right) =>
          controversyScore(right.votes.up, right.votes.down) - controversyScore(left.votes.up, left.votes.down) ||
          right.votes.up + right.votes.down - (left.votes.up + left.votes.down) ||
          byNumberAsc(left, right)
      );
    case 'old':
    default:
      return list.sort(byNumberAsc);
  }
}

function serializePoll(poll) {
  if (!poll?.options?.length) {
    return null;
  }
  const options = poll.options.map((option) => ({
    id: option.id,
    text: option.text,
    votes: Number(option.votes || 0)
  }));
  return {
    options,
    totalVotes: options.reduce((total, option) => total + option.votes, 0),
    updatedAt: poll.updatedAt ?? null
  };
}

function validateImage(image) {
  if (!image) {
    return null;
  }

  const type = String(image.type ?? '').toLowerCase();
  if (!type.startsWith('image/')) {
    const error = new Error('Chỉ hỗ trợ tải ảnh lên');
    error.statusCode = 415;
    throw error;
  }

  const dataUrl = image.dataUrl ?? '';
  if (!dataUrl.startsWith('data:image/')) {
    const error = new Error('Dữ liệu ảnh không hợp lệ');
    error.statusCode = 400;
    throw error;
  }

  const maxBytes = readPositiveInteger(process.env.MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES);
  if (Buffer.byteLength(dataUrl) > maxBytes) {
    const error = new Error('Ảnh quá lớn');
    error.statusCode = 413;
    throw error;
  }

  const safeImage = {
    name: sanitizeFileName(image.name),
    type,
    dataUrl,
    spoiler: Boolean(image.spoiler),
    sizeBytes: sanitizePositiveInteger(image.sizeBytes, maxBytes) ?? dataUrlBytes(dataUrl)
  };

  const width = sanitizePositiveInteger(image.width, 20_000);
  const height = sanitizePositiveInteger(image.height, 20_000);
  if (width) {
    safeImage.width = width;
  }
  if (height) {
    safeImage.height = height;
  }

  const thumbnail = validateImageThumbnail(image.thumbnail);
  if (thumbnail) {
    safeImage.thumbnail = thumbnail;
  }

  return safeImage;
}

function validateImageThumbnail(thumbnail) {
  if (!thumbnail) {
    return null;
  }

  const type = String(thumbnail.type ?? '').toLowerCase();
  if (!type.startsWith('image/')) {
    const error = new Error('Thumbnail ảnh không hợp lệ');
    error.statusCode = 400;
    throw error;
  }

  const dataUrl = thumbnail.dataUrl ?? '';
  if (!dataUrl.startsWith('data:image/')) {
    const error = new Error('Dữ liệu thumbnail không hợp lệ');
    error.statusCode = 400;
    throw error;
  }

  const maxBytes = readPositiveInteger(process.env.MAX_THUMBNAIL_BYTES, DEFAULT_MAX_THUMBNAIL_BYTES);
  if (Buffer.byteLength(dataUrl) > maxBytes) {
    const error = new Error('Thumbnail ảnh quá lớn');
    error.statusCode = 413;
    throw error;
  }

  const safeThumbnail = {
    name: sanitizeFileName(thumbnail.name || 'thumbnail.jpg'),
    type,
    dataUrl,
    sizeBytes: sanitizePositiveInteger(thumbnail.sizeBytes, maxBytes) ?? dataUrlBytes(dataUrl)
  };

  const width = sanitizePositiveInteger(thumbnail.width, 2_000);
  const height = sanitizePositiveInteger(thumbnail.height, 2_000);
  if (width) {
    safeThumbnail.width = width;
  }
  if (height) {
    safeThumbnail.height = height;
  }

  return safeThumbnail;
}

// Re-applies the spoiler flag onto the stored image. The image storage driver
// returns its own object (local/S3 metadata) and may drop unknown fields, so
// the poster's spoiler choice is carried over from the validated upload.
function applyImageSpoiler(storedImage, safeImage) {
  if (!storedImage) {
    return storedImage;
  }
  return { ...storedImage, spoiler: Boolean(safeImage?.spoiler) };
}

function serializeThread(thread, comments) {
  const publicComments = comments.filter((comment) => comment.threadId === thread.id && publicPost(comment));
  return {
    ...stripPrivatePostFields(thread),
    displayName: publicDisplayName(thread.displayName),
    tripcode: thread.tripcode ?? null,
    capcode: normalizeCapcode(thread.capcode),
    poll: serializePoll(thread.poll),
    isArchived: Boolean(thread.isArchived),
    archivedAt: thread.archivedAt ?? null,
    archivedReason: thread.archivedReason ?? null,
    isLocked: Boolean(thread.isLocked),
    lockedAt: thread.lockedAt ?? null,
    isSticky: Boolean(thread.isSticky && activePublicThread(thread)),
    stickiedAt: thread.isSticky && activePublicThread(thread) ? (thread.stickiedAt ?? null) : null,
    slowModeUntil: thread.slowModeUntil ?? null,
    slowModeSeconds: Number(thread.slowModeSeconds || 0),
    bodyLines: parsePostText(thread.body),
    votes: publicVotes(thread),
    replyCount: publicComments.length
  };
}

function serializeComment(comment, thread = null) {
  return {
    ...stripPrivatePostFields(comment),
    displayName: publicDisplayName(comment.displayName),
    tripcode: comment.tripcode ?? null,
    capcode: normalizeCapcode(comment.capcode),
    isOp: Boolean(thread?.opProofHash && comment.opProofHash && thread.opProofHash === comment.opProofHash),
    bodyLines: parsePostText(comment.body),
    votes: publicVotes(comment)
  };
}

function compareNewestPosts(left, right) {
  const dateCompare = right.createdAt.localeCompare(left.createdAt);
  if (dateCompare !== 0) {
    return dateCompare;
  }
  return Number(right.globalNumber) - Number(left.globalNumber);
}

function compareBoardThreads(left, right) {
  const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
  if (stickyCompare !== 0) {
    return stickyCompare;
  }
  if (left.isSticky && right.isSticky) {
    const stickiedCompare = String(right.stickiedAt ?? '').localeCompare(String(left.stickiedAt ?? ''));
    if (stickiedCompare !== 0) {
      return stickiedCompare;
    }
  }
  const bumpedCompare = String(right.bumpedAt ?? '').localeCompare(String(left.bumpedAt ?? ''));
  if (bumpedCompare !== 0) {
    return bumpedCompare;
  }
  return Number(right.globalNumber) - Number(left.globalNumber);
}

function incrementHotBoardMetric(metrics, boardSlug, type, createdAt) {
  const metric = metrics.get(boardSlug);
  if (!metric) {
    return;
  }

  metric.postCountLast24h += 1;
  if (type === 'thread') {
    metric.threadCountLast24h += 1;
  } else {
    metric.replyCountLast24h += 1;
  }
  if (!metric.latestActivityAt || createdAt.localeCompare(metric.latestActivityAt) > 0) {
    metric.latestActivityAt = createdAt;
  }
}

function pulseKeywords(body = '') {
  const normalized = String(body)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return [
    ...new Set(
      normalized
        .match(/[\p{L}\p{N}]{3,}/gu)
        ?.filter((word) => !PULSE_STOP_WORDS.has(word) && !/^\d+$/.test(word)) ?? []
    )
  ];
}

function sanitizeReason(reason) {
  return normalizeBody(reason ?? '').slice(0, 240);
}

function sanitizeDurationMinutes(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.round(number), 60 * 24 * 30));
}

function sanitizeSinceGlobalNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return 0;
  }
  return Math.floor(number);
}

function fingerprintPreview(fingerprint = '') {
  return `${String(fingerprint).slice(0, 12)}...`;
}

function activeSanctionFor(state, fingerprint, createdAt) {
  return state.sanctions
    .filter((sanction) => sanction.fingerprint === fingerprint && !sanction.revokedAt)
    .filter((sanction) => !sanction.expiresAt || sanction.expiresAt.localeCompare(createdAt) > 0)
    .sort((left, right) => String(right.expiresAt ?? '').localeCompare(String(left.expiresAt ?? '')))[0];
}

function slowModeActive(thread, createdAt) {
  return Boolean(thread.slowModeUntil && thread.slowModeUntil.localeCompare(createdAt) > 0);
}

function enforceThreadSlowMode(state, thread, { authorFingerprint, createdAt }) {
  if (!slowModeActive(thread, createdAt)) {
    return;
  }
  const slowModeSeconds = Number(thread.slowModeSeconds || 0);
  if (!slowModeSeconds) {
    return;
  }
  const lastPost = state.comments
    .filter((comment) => comment.threadId === thread.id && !comment.isDeleted && comment.authorFingerprint === authorFingerprint)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!lastPost) {
    return;
  }
  const elapsedSeconds = (new Date(createdAt).getTime() - new Date(lastPost.createdAt).getTime()) / 1000;
  if (elapsedSeconds < slowModeSeconds) {
    const error = new Error(`Chủ đề đang bật chế độ chậm. Thử lại sau ${Math.ceil(slowModeSeconds - elapsedSeconds)} giây.`);
    error.statusCode = 429;
    throw error;
  }
}

function raiseThreadSlowMode(thread, labels = [], createdAt) {
  if (!labels.some((label) => SLOW_MODE_LABELS.has(label))) {
    return false;
  }
  const level = Math.min(Number(thread.slowModeLevel || 0) + 1, 4);
  const slowModeSeconds = Math.min(level * 30, 120);
  const until = new Date(new Date(createdAt).getTime() + 15 * 60 * 1000).toISOString();
  thread.slowModeLevel = level;
  thread.slowModeSeconds = slowModeSeconds;
  if (!thread.slowModeUntil || until.localeCompare(thread.slowModeUntil) > 0) {
    thread.slowModeUntil = until;
  }
  return true;
}

function enforceSanctions(state, { ip, posterToken, createdAt }) {
  const fingerprint = createModerationFingerprint({ ip, posterToken });
  const sanction = activeSanctionFor(state, fingerprint, createdAt);
  if (sanction) {
    const error = new Error(`Bạn đang bị tạm khóa đăng bài đến ${sanction.expiresAt}`);
    error.statusCode = 403;
    throw error;
  }
  return fingerprint;
}

function serializeSanction(sanction) {
  const { fingerprint: _fingerprint, ...publicFields } = sanction;
  return {
    ...publicFields,
    fingerprintPreview: sanction.fingerprintPreview ?? fingerprintPreview(sanction.fingerprint)
  };
}

function recordModerationAction(state, { action, actor = 'system', postType, post, reason = '', createdAt }) {
  state.moderationActions.push({
    id: crypto.randomUUID(),
    action,
    actor: String(actor || 'system').slice(0, 80),
    reason: sanitizeReason(reason),
    postType,
    postId: post.id,
    threadId: postType === 'thread' ? post.id : post.threadId,
    boardSlug: post.boardSlug,
    globalNumber: post.globalNumber,
    moderationStatus: post.moderationStatus,
    moderationLabels: post.moderationLabels ?? [],
    createdAt
  });
}

function findPublicPostByGlobalNumber(state, globalNumber) {
  const number = Number(globalNumber);
  const thread = state.threads.find((item) => item.globalNumber === number && publicPost(item));
  if (thread) {
    return { postType: 'thread', post: thread };
  }

  const comment = state.comments.find((item) => item.globalNumber === number && publicPost(item));
  if (comment) {
    return { postType: 'comment', post: comment };
  }

  return null;
}

function findAnyPostByGlobalNumber(state, globalNumber) {
  const number = Number(globalNumber);
  const thread = state.threads.find((item) => item.globalNumber === number);
  if (thread) {
    return { postType: 'thread', post: thread };
  }

  const comment = state.comments.find((item) => item.globalNumber === number);
  if (comment) {
    return { postType: 'comment', post: comment };
  }

  return null;
}

function matchesAdminFilters(item, filters = {}, dateField = 'createdAt') {
  if (filters.boardSlug && item.boardSlug !== filters.boardSlug) {
    return false;
  }

  if (filters.label) {
    const labels = item.moderationLabels ?? [];
    if (!labels.includes(filters.label) && item.moderationStatus !== filters.label) {
      return false;
    }
  }

  if (filters.since && String(item[dateField] ?? item.createdAt ?? '').localeCompare(filters.since) < 0) {
    return false;
  }

  return true;
}

function serializeAdminPost(postType, post, state) {
  const parent = postType === 'comment' ? state.threads.find((thread) => thread.id === post.threadId) : null;
  return {
    type: postType,
    ...(postType === 'thread' ? serializeThread(post, state.comments) : serializeComment(post, parent))
  };
}

function aiBudgetKey({ kind, ip = '', posterToken = '', actor = 'public', createdAt }) {
  const day = daySalt(new Date(createdAt));
  const identity = crypto
    .createHash('sha256')
    .update(`${actor}:${ip}:${posterToken}`)
    .digest('hex')
    .slice(0, 24);
  return `${day}:${kind}:${identity}`;
}

function consumeAiBudget(state, { kind, ip, posterToken, actor, createdAt }) {
  const limits = {
    summary: 20,
    suggestion: 30,
    rewrite: 20,
    translate: 40,
    transcribe: 15,
    caption: 30,
    speak: 20,
    digest: Number(process.env.ADMIN_DIGEST_DAILY_LIMIT) || 5
  };
  const limit = limits[kind] ?? 10;
  const key = aiBudgetKey({ kind, ip, posterToken, actor, createdAt });
  const current = state.aiUsage[key] ?? { count: 0 };
  if (current.count >= limit) {
    const error = new Error('Đã đạt giới hạn dùng AI trong ngày. Thử lại sau.');
    error.statusCode = 429;
    throw error;
  }
  state.aiUsage[key] = {
    count: current.count + 1,
    updatedAt: createdAt
  };
}

// Validates an AI media payload ({ data: base64, mimeType }) and enforces a byte cap.
// `maxBytes` is the decoded size limit; base64 inflates ~4/3 so we compare against the encoded length.
function assertAiMedia(media, maxBytes, kind) {
  if (!media || typeof media.data !== 'string' || !media.data) {
    const error = new Error(`Thiếu dữ liệu ${kind === 'audio' ? 'audio' : 'ảnh'} để xử lý.`);
    error.statusCode = 400;
    throw error;
  }
  const base64 = media.data.includes(',') ? media.data.slice(media.data.indexOf(',') + 1) : media.data;
  const approxBytes = Math.floor(base64.length * 0.75);
  if (approxBytes > maxBytes) {
    const error = new Error(`Tệp ${kind === 'audio' ? 'audio' : 'ảnh'} quá lớn.`);
    error.statusCode = 413;
    throw error;
  }
}

function cacheSummary(state, key, fingerprint, producer, createdAt) {
  const cached = state.aiSummaryCache[key];
  if (cached?.fingerprint === fingerprint && Array.isArray(cached.bullets)) {
    return cached.bullets;
  }

  return producer().then((bullets) => {
    state.aiSummaryCache[key] = {
      fingerprint,
      bullets,
      cachedAt: createdAt
    };
    return bullets;
  });
}

function threadSummaryFingerprint(detail, sinceGlobalNumber = 0) {
  const comments = sinceGlobalNumber
    ? detail.comments.filter((comment) => Number(comment.globalNumber) > sinceGlobalNumber)
    : detail.comments;
  return [
    detail.thread.id,
    detail.thread.bumpedAt,
    detail.thread.replyCount,
    sinceGlobalNumber,
    ...comments.map((comment) => comment.globalNumber)
  ].join(':');
}

function boardSummaryFingerprint(threads) {
  return threads.map((thread) => `${thread.id}:${thread.bumpedAt}:${thread.replyCount}`).join('|');
}

function stateCounts(state) {
  return {
    threads: state.threads.length,
    comments: state.comments.length,
    users: Array.isArray(state.users) ? state.users.length : 0,
    reports: state.reports.length,
    sanctions: state.sanctions.length,
    moderationActions: state.moderationActions.length,
    nextGlobalNumber: state.nextGlobalNumber
  };
}

async function readStoreHealth(store) {
  const type = store.type ?? 'json';
  if (store.health) {
    try {
      const health = await store.health();
      return {
        type,
        ...health,
        configured: health.configured ?? true,
        ready: health.ready ?? true
      };
    } catch {
      return {
        type,
        configured: true,
        ready: false,
        error: 'unavailable'
      };
    }
  }

  try {
    const state = await store.read();
    return {
      type,
      configured: true,
      ready: true,
      ...stateCounts(state)
    };
  } catch {
    return {
      type,
      configured: true,
      ready: false,
      error: 'unavailable'
    };
  }
}

async function readImageStorageHealth(imageStorage) {
  const type = imageStorage.type ?? 'unknown';
  if (!imageStorage.health) {
    return { type, configured: true, ready: true };
  }

  try {
    const health = await imageStorage.health();
    return {
      type,
      configured: health.configured ?? true,
      ready: health.ready ?? health.configured !== false,
      ...(health.error ? { error: health.error } : {})
    };
  } catch {
    return {
      type,
      configured: false,
      ready: false,
      error: 'unavailable'
    };
  }
}

export function createForumService({
  store,
  ai,
  realtime = { publish() {}, count: () => 0 },
  now = () => new Date(),
  lifecycle = THREAD_LIFECYCLE,
  logger = noopLogger,
  imageStorage = createInlineImageStorage(),
  totp = defaultTotp,
  webauthn = defaultWebAuthn
}) {
  // In-memory token blacklist for session revocation (logout).
  // Each entry maps jti/token → revokedAt timestamp string.
  // Tokens are cleaned up after 14 days (matching JWT maxAge).
  const revokedTokens = new Map();
  const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

  function cleanExpiredRevocations() {
    const cutoff = now().getTime() - TOKEN_TTL_MS;
    for (const [token, revokedAt] of revokedTokens) {
      if (new Date(revokedAt).getTime() < cutoff) {
        revokedTokens.delete(token);
      }
    }
  }

  function logEvent(event, payload = {}) {
    if (logger === noopLogger) {
      return;
    }
    logger({ event, ...payload });
  }

  // Serialize the whole read-modify-write so concurrent mutations cannot
  // interleave. The store model is whole-state RMW and callbacks await slow
  // work (AI moderation, image upload); without this, two in-flight posts read
  // the same snapshot and the second write clobbers the first — the post
  // returns 200 but the thread/comment silently vanishes (and global numbers
  // collide). Queue is process-local; multi-instance deployments still need a
  // shared lock (see store notes).
  let mutateQueue = Promise.resolve();
  function mutate(callback) {
    const run = mutateQueue.then(async () => {
      const state = await store.read();
      const result = await callback(state);
      await store.write(state);
      return result;
    });
    // Keep the chain alive regardless of this mutation's outcome.
    mutateQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function requireCaptcha(token, ip) {
    const ok = await verifyHcaptcha(token, ip);
    if (!ok) {
      const error = new Error('Xác minh hCaptcha thất bại');
      error.statusCode = 403;
      throw error;
    }
  }

  function nextNumber(state) {
    const value = state.nextGlobalNumber;
    state.nextGlobalNumber += 1;
    return value;
  }

  function enforceBoardThreadCap(state, boardSlug, archivedAt) {
    const activeThreads = state.threads
      .filter((thread) => thread.boardSlug === boardSlug && activePublicThread(thread))
      .sort((left, right) => left.bumpedAt.localeCompare(right.bumpedAt));

    while (activeThreads.length > lifecycle.maxActiveThreadsPerBoard) {
      const thread = activeThreads.shift();
      archiveThreadRecord(thread, 'board-limit', archivedAt);
      realtime.publish('thread:archived', { thread: serializeThread(thread, state.comments) });
    }
  }

  function archiveExpiredEventThreads(state, boardSlug, archivedAt) {
    const board = state.boards.find(b => b.slug === boardSlug);
    if (!boardEventEnded(board, archivedAt)) {
      return false;
    }

    let changed = false;
    state.threads
      .filter((thread) => thread.boardSlug === boardSlug && activePublicThread(thread))
      .forEach((thread) => {
        archiveThreadRecord(thread, 'event-ended', archivedAt);
        realtime.publish('thread:archived', { thread: serializeThread(thread, state.comments) });
        changed = true;
      });
    return changed;
  }

  return {
    async listBoards() {
      const state = await store.read();
      return state.boards.filter(publicBoard).map((board) => serializeBoard(board));
    },

    async listAdminBoards() {
      const state = await store.read();
      return state.boards.map((board) => serializeBoard(board, { admin: true }));
    },

    async getStats() {
      const state = await store.read();
      const publicThreads = state.threads.filter(publicPost);
      const publicComments = state.comments.filter(publicPost);
      const publicPosts = [...publicThreads, ...publicComments];
      const activeBoards = new Set(publicThreads.map((thread) => thread.boardSlug));
      const publicBoards = state.boards.filter(publicBoard);
      const files = publicPosts.map((post) => post.image).filter(Boolean);
      const nowMs = now().getTime();
      const oneHourAgo = nowMs - 60 * 60 * 1000;
      const oneDayAgo = nowMs - 24 * 60 * 60 * 1000;
      const postTime = (post) => new Date(post.createdAt).getTime();
      const fileBytes = files.reduce((total, file) => total + (file.sizeBytes ?? dataUrlBytes(file.dataUrl)), 0);

      return {
        totalThreads: publicThreads.length,
        totalPosts: publicPosts.length,
        activeBoards: activeBoards.size,
        publicBoardCount: publicBoards.length,
        totalBoardCount: state.boards.length,
        postCountLast24h: publicPosts.filter((post) => postTime(post) >= oneDayAgo).length,
        postCountLastHour: publicPosts.filter((post) => postTime(post) >= oneHourAgo).length,
        fileCount: files.length,
        fileMegabytes: Number((fileBytes / 1024 / 1024).toFixed(1)),
        activeContentMb: Number((fileBytes / 1024 / 1024).toFixed(1)),
        currentUsers: Math.max(1, realtime.count?.() ?? 1),
        boardUsers: realtime.boardCounts?.() ?? {}
      };
    },

    async getHealth() {
      const [storeHealth, imageStorageHealth] = await Promise.all([
        readStoreHealth(store),
        readImageStorageHealth(imageStorage)
      ]);
      const ready = storeHealth.ready !== false && imageStorageHealth.ready !== false;
      return {
        status: ready ? 'ok' : 'degraded',
        checkedAt: now().toISOString(),
        store: storeHealth,
        ai: aiConfigStatus(),
        imageStorage: imageStorageHealth,
        realtime: realtime.metrics?.() ?? {
          clients: realtime.count?.() ?? 0,
          boards: realtime.boardCounts?.() ?? {}
        }
      };
    },

    async getAdminHealth() {
      const health = await this.getHealth();
      const mem = process.memoryUsage();
      return {
        ...health,
        process: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
          uptimeSeconds: Math.floor(process.uptime()),
          memory: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            external: mem.external
          }
        }
      };
    },

    async registerAccount({ username, password, captchaToken, ip } = {}) {
      await requireCaptcha(captchaToken, ip);
      const safeUsername = assertAccountUsername(username);
      const safePassword = assertAccountPassword(password, { username: safeUsername });
      return mutate(async (state) => {
        const existing = state.users.find((user) => normalizeAccountUsername(user.username) === safeUsername);
        if (existing) {
          const error = new Error('Tên tài khoản đã tồn tại');
          error.statusCode = 409;
          throw error;
        }

        const createdAt = now().toISOString();
        const recoveryCode = generateRecoveryCode();
        const user = {
          id: crypto.randomUUID(),
          username: safeUsername,
          passwordHash: accountPasswordHash(safePassword),
          recoveryCodeHash: hashRecoveryCode(recoveryCode),
          role: 'user',
          settings: defaultAccountSettings(),
          privateData: defaultAccountPrivateData(),
          createdAt,
          updatedAt: createdAt
        };
        state.users.push(user);
        logEvent('account.register', { username: safeUsername });
        return { account: serializeAccount(state, user), recoveryCode };
      });
    },

    async loginAccount({ username, password, captchaToken, ip } = {}) {
      await requireCaptcha(captchaToken, ip);
      const safeUsername = normalizeAccountUsername(username);
      const state = await store.read();
      const user = state.users.find((item) => normalizeAccountUsername(item.username) === safeUsername);

      const lockedUntil = user && user.lockedUntil ? new Date(user.lockedUntil).getTime() : 0;
      if (lockedUntil && lockedUntil > now().getTime()) {
        const retryAfter = Math.ceil((lockedUntil - now().getTime()) / 1000);
        const error = new Error('Tài khoản tạm thời bị khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau.');
        error.statusCode = 429;
        error.retryAfter = retryAfter;
        throw error;
      }

      // Always run a PBKDF2 verification so the timing of a missing-user login
      // matches that of an existing user with the wrong password (prevents
      // username enumeration via response latency).
      const passwordOk = user
        ? verifyAccountPassword(password, user.passwordHash)
        : (verifyAccountPassword(password, DUMMY_PASSWORD_HASH), false);

      if (!user || !passwordOk) {
        if (user) {
          user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
          if (user.failedLoginAttempts >= MAX_FAILED_LOGINS) {
            user.lockedUntil = new Date(now().getTime() + LOGIN_LOCKOUT_MS).toISOString();
            user.failedLoginAttempts = 0;
          }
          user.updatedAt = now().toISOString();
          await store.write(state);
        }
        const error = new Error('Tên tài khoản hoặc mật khẩu không đúng');
        error.statusCode = 401;
        throw error;
      }

      if (user.failedLoginAttempts || user.lockedUntil) {
        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
        user.updatedAt = now().toISOString();
        await store.write(state);
      }
      return serializeAccount(state, user);
    },

    async resetAccountPasswordWithRecoveryCode({ username, recoveryCode, newPassword, captchaToken, ip } = {}) {
      await requireCaptcha(captchaToken, ip);
      const safeUsername = normalizeAccountUsername(username);
      const safePassword = assertAccountPassword(newPassword, { username: safeUsername });
      return mutate(async (state) => {
        const user = state.users.find((item) => normalizeAccountUsername(item.username) === safeUsername);
        // Same error for "no such user" and "wrong code" so the response cannot
        // be used to confirm which usernames exist.
        const providedHash = hashRecoveryCode(recoveryCode);
        const codeOk =
          user &&
          user.recoveryCodeHash &&
          crypto.timingSafeEqual(Buffer.from(providedHash, 'hex'), Buffer.from(user.recoveryCodeHash, 'hex'));
        if (!user || !codeOk) {
          const error = new Error('Tên tài khoản hoặc mã khôi phục không đúng');
          error.statusCode = 400;
          throw error;
        }

        user.passwordHash = accountPasswordHash(safePassword);
        // Rotate the recovery code: the used one is now spent.
        const nextRecoveryCode = generateRecoveryCode();
        user.recoveryCodeHash = hashRecoveryCode(nextRecoveryCode);
        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
        user.updatedAt = now().toISOString();

        logEvent('account.password.reset', { username: user.username });
        return { account: serializeAccount(state, user), recoveryCode: nextRecoveryCode };
      });
    },

    async regenerateRecoveryCode(userId, password) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        if (!verifyAccountPassword(password, user.passwordHash)) {
          const error = new Error('Mật khẩu không đúng');
          error.statusCode = 401;
          throw error;
        }

        const recoveryCode = generateRecoveryCode();
        user.recoveryCodeHash = hashRecoveryCode(recoveryCode);
        user.updatedAt = now().toISOString();

        logEvent('account.recoveryCode.regenerate', { username: user.username });
        return { account: serializeAccount(state, user), recoveryCode };
      });
    },

    async getAccount(userId) {
      const state = await store.read();
      const user = state.users.find((item) => item.id === userId);
      if (!user) {
        const error = new Error('Phiên đăng nhập không còn hợp lệ');
        error.statusCode = 401;
        throw error;
      }
      return serializeAccount(state, user);
    },

    async updateAccountSettings(userId, settings = {}) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        user.settings = normalizeAccountSettings(state, settings, user.settings);
        user.updatedAt = now().toISOString();
        logEvent('account.settings.update', { username: user.username });
        return serializeAccount(state, user);
      });
    },

    async getAccountPrivateData(userId) {
      const user = (await store.read()).users.find((item) => item.id === userId);
      if (!user) {
        const error = new Error('Phiên đăng nhập không còn hợp lệ');
        error.statusCode = 401;
        throw error;
      }
      return serializeAccountPrivateData(user.privateData);
    },

    async updateAccountPrivateData(userId, privateData = {}) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        user.privateData = normalizeAccountPrivateData(privateData, user.privateData);
        user.updatedAt = now().toISOString();
        logEvent('account.privateData.update', { username: user.username });
        return serializeAccountPrivateData(user.privateData);
      });
    },

    async clearAccountPrivateData(userId, section = '') {
      const allowedSections = new Set(['watchlist', 'drafts', 'savedSearches']);
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        const current = serializeAccountPrivateData(user.privateData);
        if (section) {
          if (!allowedSections.has(section)) {
            const error = new Error('Mục dữ liệu riêng không hợp lệ');
            error.statusCode = 400;
            throw error;
          }
          current[section] = [];
          user.privateData = current;
        } else {
          user.privateData = defaultAccountPrivateData();
        }
        user.updatedAt = now().toISOString();
        logEvent('account.privateData.clear', { username: user.username, section: section || 'all' });
        return serializeAccountPrivateData(user.privateData);
      });
    },

    revokeSession(token) {
      cleanExpiredRevocations();
      revokedTokens.set(token, now().toISOString());
      logEvent('session.revoke');
    },

    isSessionRevoked(token) {
      cleanExpiredRevocations();
      return revokedTokens.has(token);
    },

    async logoutAccount(token) {
      this.revokeSession(token);
      return { ok: true };
    },

    async getOrCreateAdminAccount(username, password) {
      const safeUsername = normalizeAccountUsername(username);
      return mutate(async (state) => {
        let admin = state.users.find((item) => normalizeAccountUsername(item.username) === safeUsername);
        if (!admin) {
          const createdAt = now().toISOString();
          admin = {
            id: crypto.randomUUID(),
            username: safeUsername,
            passwordHash: accountPasswordHash(password),
            role: 'admin',
            settings: defaultAccountSettings(),
            createdAt,
            updatedAt: createdAt
          };
          state.users.push(admin);
        } else {
          admin.passwordHash = accountPasswordHash(password);
          admin.role = 'admin';
          admin.updatedAt = now().toISOString();
        }
        return serializeAccount(state, admin);
      });
    },

    async generate2FASetup(userId) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        const secret = totp.generateSecret();
        const codes = totp.generateBackupCodes();
        const qrCodeUrl = await totp.generateQrCodeDataUrl(user.username, secret);

        user.tempTwoFactorSecret = secret;
        user.tempBackupCodes = codes.map((code) => crypto.createHash('sha256').update(code).digest('hex'));
        user.updatedAt = now().toISOString();

        return { secret, qrCodeUrl, backupCodes: codes };
      });
    },

    async verify2FASetup(userId, code) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        if (!user.tempTwoFactorSecret) {
          const error = new Error('Không tìm thấy yêu cầu cài đặt 2FA');
          error.statusCode = 400;
          throw error;
        }
        if (!totp.verifyTOTP(code, user.tempTwoFactorSecret)) {
          const error = new Error('Mã xác thực 2FA không chính xác');
          error.statusCode = 400;
          throw error;
        }

        user.twoFactorSecret = user.tempTwoFactorSecret;
        user.backupCodes = user.tempBackupCodes;
        user.twoFactorEnabled = true;
        user.tempTwoFactorSecret = null;
        user.tempBackupCodes = null;
        user.updatedAt = now().toISOString();

        logEvent('account.2fa.enable', { username: user.username });
        return { ok: true, account: serializeAccount(state, user) };
      });
    },

    async verify2FALogin(userId, code) {
      const state = await store.read();
      const user = state.users.find((item) => item.id === userId);
      if (!user) {
        const error = new Error('Không tìm thấy tài khoản');
        error.statusCode = 404;
        throw error;
      }
      if (!user.twoFactorEnabled || !user.twoFactorSecret) {
        const error = new Error('Tài khoản chưa kích hoạt 2FA');
        error.statusCode = 400;
        throw error;
      }
      if (!totp.verifyTOTP(code, user.twoFactorSecret)) {
        const error = new Error('Mã xác thực 2FA không chính xác');
        error.statusCode = 400;
        throw error;
      }
      return { ok: true, account: serializeAccount(state, user) };
    },

    async verifyBackupCodeLogin(userId, code) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Không tìm thấy tài khoản');
          error.statusCode = 404;
          throw error;
        }
        if (!user.twoFactorEnabled || !user.backupCodes || user.backupCodes.length === 0) {
          const error = new Error('Tài khoản chưa kích hoạt 2FA hoặc không có mã dự phòng');
          error.statusCode = 400;
          throw error;
        }

        const normalizedCode = String(code).toUpperCase().trim();
        const hashedInput = crypto.createHash('sha256').update(normalizedCode).digest('hex');
        const index = user.backupCodes.indexOf(hashedInput);
        if (index === -1) {
          const error = new Error('Mã dự phòng không hợp lệ');
          error.statusCode = 400;
          throw error;
        }

        user.backupCodes.splice(index, 1);
        user.updatedAt = now().toISOString();

        logEvent('account.2fa.backupCodeUsed', { username: user.username });
        return { ok: true, account: serializeAccount(state, user) };
      });
    },

    async disable2FA(userId, password) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        if (!verifyAccountPassword(password, user.passwordHash)) {
          const error = new Error('Mật khẩu không đúng');
          error.statusCode = 401;
          throw error;
        }

        user.twoFactorEnabled = false;
        user.twoFactorSecret = null;
        user.backupCodes = null;
        user.updatedAt = now().toISOString();

        logEvent('account.2fa.disable', { username: user.username });
        return { ok: true, account: serializeAccount(state, user) };
      });
    },

    async resetUser2FA(username) {
      const safeUsername = normalizeAccountUsername(username);
      return mutate(async (state) => {
        const user = state.users.find((item) => normalizeAccountUsername(item.username) === safeUsername);
        if (!user) {
          const error = new Error('Không tìm thấy tài khoản');
          error.statusCode = 404;
          throw error;
        }
        user.twoFactorEnabled = false;
        user.twoFactorSecret = null;
        user.backupCodes = null;
        user.updatedAt = now().toISOString();
        logEvent('account.2fa.adminReset', { username: user.username });
        return { ok: true };
      });
    },

    async generateWebAuthnRegisterOptions(userId, rpID) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        const options = await webauthn.getWebAuthnRegisterOptions({ user, rpID });
        user.webauthnRegistrationChallenge = options.challenge;
        user.updatedAt = now().toISOString();
        return options;
      });
    },

    async verifyWebAuthnRegisterResponse(userId, { body, origin, rpID }) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        if (!user.webauthnRegistrationChallenge) {
          const error = new Error('Không tìm thấy yêu cầu đăng ký tương ứng');
          error.statusCode = 400;
          throw error;
        }
        const verification = await webauthn.verifyWebAuthnRegisterResponse({
          body,
          expectedChallenge: user.webauthnRegistrationChallenge,
          origin,
          rpID
        });
        if (!verification.verified) {
          const error = new Error('Xác thực thiết bị WebAuthn thất bại');
          error.statusCode = 400;
          throw error;
        }

        const { registrationInfo } = verification;
        const { credential, credentialDeviceType, credentialBackedUp } = registrationInfo;
        if (!credential?.id || !credential?.publicKey) {
          const error = new Error('Thiết bị WebAuthn không trả về credential hợp lệ');
          error.statusCode = 400;
          throw error;
        }

        user.webauthnRegistrationChallenge = null;
        user.passkeys = user.passkeys || [];
        user.passkeys.push({
          credentialID: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: credential.counter ?? 0,
          credentialDeviceType,
          credentialBackedUp,
          transports: credential.transports || body.response?.transports || [],
          createdAt: now().toISOString()
        });
        user.updatedAt = now().toISOString();
        logEvent('account.passkey.register', { username: user.username });
        return { ok: true };
      });
    },

    async generateWebAuthnLoginOptions(username, rpID) {
      const safeUsername = normalizeAccountUsername(username);
      return mutate(async (state) => {
        const user = state.users.find((item) => normalizeAccountUsername(item.username) === safeUsername);
        if (!user) {
          const error = new Error('Tên tài khoản hoặc thiết bị đăng nhập không đúng');
          error.statusCode = 401;
          throw error;
        }
        const options = await webauthn.getWebAuthnLoginOptions({ user, rpID });
        user.webauthnLoginChallenge = options.challenge;
        user.updatedAt = now().toISOString();
        return options;
      });
    },

    async verifyWebAuthnLoginResponse({ username, body, origin, rpID }) {
      const safeUsername = normalizeAccountUsername(username);
      return mutate(async (state) => {
        const user = state.users.find((item) => normalizeAccountUsername(item.username) === safeUsername);
        if (!user) {
          const error = new Error('Tên tài khoản hoặc mật khẩu không đúng');
          error.statusCode = 401;
          throw error;
        }
        if (!user.webauthnLoginChallenge) {
          const error = new Error('Yêu cầu đăng nhập không còn hiệu lực. Vui lòng thử lại');
          error.statusCode = 400;
          throw error;
        }
        const passkey = (user.passkeys || []).find((p) => p.credentialID === body.id);
        if (!passkey) {
          const error = new Error('Thiết bị xác thực không hợp lệ cho tài khoản này');
          error.statusCode = 401;
          throw error;
        }
        const verification = await webauthn.verifyWebAuthnLoginResponse({
          body,
          expectedChallenge: user.webauthnLoginChallenge,
          origin,
          rpID,
          passkey
        });
        if (!verification.verified) {
          const error = new Error('Xác thực chữ ký thiết bị thất bại');
          error.statusCode = 401;
          throw error;
        }

        user.webauthnLoginChallenge = null;
        passkey.counter = verification.authenticationInfo.newCounter;
        user.updatedAt = now().toISOString();
        logEvent('account.passkey.login', { username: user.username });
        return { account: serializeAccount(state, user) };
      });
    },

    async listPasskeys(userId) {
      const user = (await store.read()).users.find((item) => item.id === userId);
      if (!user) {
        const error = new Error('Phiên đăng nhập không còn hợp lệ');
        error.statusCode = 401;
        throw error;
      }
      return (user.passkeys || []).map((p) => ({
        id: p.credentialID,
        credentialDeviceType: p.credentialDeviceType,
        createdAt: p.createdAt
      }));
    },

    async deletePasskey(userId, credentialId) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        user.passkeys = (user.passkeys || []).filter((p) => p.credentialID !== credentialId);
        user.updatedAt = now().toISOString();
        logEvent('account.passkey.delete', { username: user.username });
        return { ok: true };
      });
    },

    async listLatestPosts(limit = 10) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 20));
      const publicThreadIds = new Set(state.threads.filter(activePublicThread).map((thread) => thread.id));
      const threads = state.threads
        .filter(activePublicThread)
        .map((thread) => ({
          type: 'thread',
          threadId: thread.id,
          ...serializeThread(thread, state.comments)
        }));
      const comments = state.comments
        .filter((comment) => publicPost(comment) && publicThreadIds.has(comment.threadId))
        .map((comment) => ({
          type: 'comment',
          ...serializeComment(comment, state.threads.find((thread) => thread.id === comment.threadId))
        }));

      return [...threads, ...comments].sort(compareNewestPosts).slice(0, safeLimit);
    },

    async listHotBoards(limit = 8) {
      const state = await store.read();
      const publicBoards = state.boards.filter(publicBoard);
      const safeLimit = Math.max(1, Math.min(Number(limit) || 8, publicBoards.length || 1));
      const oneDayAgo = now().getTime() - 24 * 60 * 60 * 1000;
      const inLast24h = (post) => new Date(post.createdAt).getTime() >= oneDayAgo;
      const activeThreadIds = new Set(state.threads.filter(activePublicThread).map((thread) => thread.id));
      const metrics = new Map(
        publicBoards.map((board) => [
          board.slug,
          {
            boardSlug: board.slug,
            postCountLast24h: 0,
            threadCountLast24h: 0,
            replyCountLast24h: 0,
            latestActivityAt: null
          }
        ])
      );

      for (const thread of state.threads) {
        if (activePublicThread(thread) && inLast24h(thread)) {
          incrementHotBoardMetric(metrics, thread.boardSlug, 'thread', thread.createdAt);
        }
      }
      for (const comment of state.comments) {
        if (publicPost(comment) && activeThreadIds.has(comment.threadId) && inLast24h(comment)) {
          incrementHotBoardMetric(metrics, comment.boardSlug, 'comment', comment.createdAt);
        }
      }

      return [...metrics.values()]
        .filter((metric) => metric.postCountLast24h > 0)
        .sort((left, right) => {
          const postCompare = right.postCountLast24h - left.postCountLast24h;
          if (postCompare !== 0) {
            return postCompare;
          }
          return (right.latestActivityAt ?? '').localeCompare(left.latestActivityAt ?? '');
        })
        .slice(0, safeLimit);
    },

    async listCampusPulse(limit = 12) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 24));
      const oneDayAgo = now().getTime() - 24 * 60 * 60 * 1000;
      const inLast24h = (post) => new Date(post.createdAt).getTime() >= oneDayAgo;
      const activeThreadIds = new Set(state.threads.filter(activePublicThread).map((thread) => thread.id));
      const metrics = new Map();
      const publicPosts = [
        ...state.threads.filter((thread) => activePublicThread(thread) && inLast24h(thread)),
        ...state.comments.filter((comment) => publicPost(comment) && activeThreadIds.has(comment.threadId) && inLast24h(comment))
      ];

      for (const post of publicPosts) {
        for (const keyword of pulseKeywords(post.body)) {
          const metric = metrics.get(keyword) ?? {
            keyword,
            count: 0,
            boardSlugs: new Set(),
            latestActivityAt: null
          };
          metric.count += 1;
          metric.boardSlugs.add(post.boardSlug);
          if (!metric.latestActivityAt || post.createdAt.localeCompare(metric.latestActivityAt) > 0) {
            metric.latestActivityAt = post.createdAt;
          }
          metrics.set(keyword, metric);
        }
      }

      return [...metrics.values()]
        .sort((left, right) => {
          const countCompare = right.count - left.count;
          if (countCompare !== 0) {
            return countCompare;
          }
          return (right.latestActivityAt ?? '').localeCompare(left.latestActivityAt ?? '');
        })
        .slice(0, safeLimit)
        .map((metric) => ({
          keyword: metric.keyword,
          count: metric.count,
          boardCount: metric.boardSlugs.size,
          latestActivityAt: metric.latestActivityAt
        }));
    },

    async listModerationActions(limit = 50, filters = {}) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      return [...state.moderationActions]
        .filter((action) => !filters.action || action.action === filters.action)
        .filter((action) => matchesAdminFilters(action, filters, 'createdAt'))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, safeLimit);
    },

    async listReports(limit = 50, filters = {}) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      return [...state.reports]
        .filter((report) => !filters.status || report.status === filters.status)
        .filter((report) => matchesAdminFilters(report, filters, 'createdAt'))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, safeLimit);
    },

    async listThreads(boardSlug, options = {}) {
      const state = await store.read();
      if (!findBoard(state, boardSlug, { publicOnly: true })) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }

      const checkedAt = now().toISOString();
      if (archiveExpiredEventThreads(state, boardSlug, checkedAt)) {
        await store.write(state);
      }
      const term = normalizeSearchTerm(options.q);
      const threads = state.threads
        .filter((thread) => thread.boardSlug === boardSlug && activePublicThread(thread))
        .filter((thread) => threadMatchesSearch(state, thread, term))
        .sort(compareBoardThreads)
        .map((thread) => serializeThread(thread, state.comments));
      if (options.paged) {
        return pagedResult(threads, { page: options.page, pageSize: options.pageSize, maxPageSize: 50 });
      }
      return threads;
    },

    async listArchivedThreads(boardSlug) {
      const state = await store.read();
      const board = findBoard(state, boardSlug);
      if (!board || board.isHidden) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }

      const checkedAt = now().toISOString();
      if (archiveExpiredEventThreads(state, boardSlug, checkedAt)) {
        await store.write(state);
      }
      return state.threads
        .filter((thread) => thread.boardSlug === boardSlug && archivedPublicThread(thread))
        .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''))
        .map((thread) => serializeThread(thread, state.comments));
    },

    async archiveThread(threadId, reason = 'manual') {
      return mutate(async (state) => {
        const thread = state.threads.find((item) => item.id === threadId && activePublicThread(item));
        if (!thread) {
          const error = new Error('Không tìm thấy chủ đề công khai');
          error.statusCode = 404;
          throw error;
        }

        archiveThreadRecord(thread, reason, now().toISOString());
        const serialized = serializeThread(thread, state.comments);
        realtime.publish('thread:archived', { thread: serialized });
        return serialized;
      });
    },

    async setThreadSticky(threadId, sticky, { actor = 'admin' } = {}) {
      return mutate(async (state) => {
        const thread = state.threads.find((item) => item.id === threadId && activePublicThread(item));
        if (!thread) {
          const error = new Error('Không tìm thấy chủ đề công khai');
          error.statusCode = 404;
          throw error;
        }

        const actionAt = now().toISOString();
        const nextSticky = Boolean(sticky);
        thread.isSticky = nextSticky;
        thread.stickiedAt = nextSticky ? actionAt : null;
        thread.stickiedBy = nextSticky ? actor : null;
        recordModerationAction(state, {
          action: nextSticky ? 'admin:sticky' : 'admin:unsticky',
          actor,
          postType: 'thread',
          post: thread,
          reason: nextSticky ? 'sticky' : 'unsticky',
          createdAt: actionAt
        });
        logEvent(nextSticky ? 'thread.sticky' : 'thread.unsticky', {
          boardSlug: thread.boardSlug,
          globalNumber: thread.globalNumber,
          actor
        });
        const serialized = serializeThread(thread, state.comments);
        realtime.publish('thread:updated', { thread: serialized });
        return serialized;
      });
    },

    async setThreadLocked(threadId, locked, { actor = 'admin' } = {}) {
      return mutate(async (state) => {
        const thread = state.threads.find((item) => item.id === threadId && activePublicThread(item));
        if (!thread) {
          const error = new Error('Không tìm thấy chủ đề công khai');
          error.statusCode = 404;
          throw error;
        }

        const actionAt = now().toISOString();
        const nextLocked = Boolean(locked);
        thread.isLocked = nextLocked;
        thread.lockedAt = nextLocked ? actionAt : null;
        thread.lockedBy = nextLocked ? actor : null;
        recordModerationAction(state, {
          action: nextLocked ? 'admin:lock' : 'admin:unlock',
          actor,
          postType: 'thread',
          post: thread,
          reason: nextLocked ? 'lock' : 'unlock',
          createdAt: actionAt
        });
        logEvent(nextLocked ? 'thread.lock' : 'thread.unlock', {
          boardSlug: thread.boardSlug,
          globalNumber: thread.globalNumber,
          actor
        });
        const serialized = serializeThread(thread, state.comments);
        realtime.publish('thread:updated', { thread: serialized });
        return serialized;
      });
    },

    async createThread({
      boardSlug,
      body,
      image,
      pollOptions,
      captchaToken,
      ip,
      posterToken,
      displayName = '',
      options = '',
      deletePassword = '',
      capcode = null,
      accountId
    }) {
      const state = await store.read();
      const board = findBoard(state, boardSlug, { publicOnly: true });
      if (!board) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }

      await requireCaptcha(captchaToken, ip);
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung là bắt buộc');
        error.statusCode = 400;
        throw error;
      }
      const safeImage = validateImage(image);
      const poll = createPoll(pollOptions);
      const postingOptions = parsePostingOptions(options);
      const { displayName: normalizedDisplayName, tripcode } = parseDisplayNameWithTripcode(displayName);
      const createdAt = now().toISOString();
      assertEventBoardOpen(board, createdAt);

      return mutate(async (state) => {
        const authorFingerprint = enforceSanctions(state, { ip, posterToken, createdAt });
        const moderation = await ai.moderate(normalizedBody);
        const id = crypto.randomUUID();
        const storedImage = safeImage ? await imageStorage.save(safeImage) : null;
        const thread = {
          id,
          boardSlug,
          body: normalizedBody,
          displayName: normalizedDisplayName,
          tripcode,
          capcode: normalizeCapcode(capcode),
          accountId,
          image: applyImageSpoiler(storedImage, safeImage),
          poll,
          pollVotes: poll ? {} : undefined,
          authorFingerprint,
          globalNumber: nextNumber(state),
          posterHash: createPosterHash({ ip, threadId: id, salt: daySalt(new Date(createdAt)), posterToken }),
          opProofHash: createPosterProofHash({ threadId: id, posterToken }),
          deletePasswordHash: deletePasswordHash(deletePassword),
          options: postingOptions.raw,
          sage: postingOptions.sage,
          noko: postingOptions.noko,
          isPending: moderation.status === 'Flagged',
          isDeleted: false,
          moderationStatus: moderation.status,
          moderationLabels: moderation.labels ?? [],
          createdAt,
          bumpedAt: createdAt
        };
        state.threads.push(thread);
        recordModerationAction(state, {
          action: 'ai:moderate',
          actor: 'ai',
          postType: 'thread',
          post: thread,
          reason: moderation.labels?.join(', ') || moderation.status,
          createdAt
        });
        logEvent('post.create', {
          postType: 'thread',
          boardSlug,
          globalNumber: thread.globalNumber,
          moderationStatus: thread.moderationStatus,
          moderationLabels: thread.moderationLabels,
          isPending: thread.isPending
        });

        if (!thread.isPending) {
          enforceBoardThreadCap(state, boardSlug, createdAt);
          realtime.publish('thread:created', { thread: serializeThread(thread, state.comments) });
        }

        return { status: thread.isPending ? 'pending' : 'published', thread: serializeThread(thread, state.comments) };
      });
    },

    async getThread(threadId, options = {}) {
      const state = await store.read();
      const thread = state.threads.find((item) => item.id === threadId && publicPost(item));
      if (!thread) {
        const error = new Error('Không tìm thấy chủ đề');
        error.statusCode = 404;
        throw error;
      }
      const checkedAt = now().toISOString();
      if (archiveExpiredEventThreads(state, thread.boardSlug, checkedAt)) {
        await store.write(state);
      }

      const serializedThread = serializeThread(thread, state.comments);
      const serializedComments = state.comments
        .filter((comment) => comment.threadId === threadId && publicPost(comment))
        .sort((left, right) => left.globalNumber - right.globalNumber)
        .map((comment) => serializeComment(comment, thread));
      const withBacklinks = addBacklinks([serializedThread, ...serializedComments]);
      const [threadWithBacklinks, ...chronologicalComments] = withBacklinks;
      const currentMaxGlobalNumber = withBacklinks.reduce(
        (maxNumber, post) => Math.max(maxNumber, Number(post.globalNumber) || 0),
        0
      );
      const commentsSort = normalizeCommentSort(options.commentsSort);
      const commentsWithBacklinks = sortComments(chronologicalComments, commentsSort);
      if (options.paged) {
        const firstPageOptions = paginationOptions({
          page: options.commentsPage || options.page,
          pageSize: options.commentsPageSize || options.pageSize,
          maxPageSize: 100
        });
        const focusGlobalNumber = Number(options.focusGlobalNumber || 0);
        const focusIndex = focusGlobalNumber
          ? commentsWithBacklinks.findIndex((comment) => Number(comment.globalNumber) === focusGlobalNumber)
          : -1;
        const focusedPage =
          focusIndex >= 0 ? Math.floor(focusIndex / firstPageOptions.pageSize) + 1 : firstPageOptions.page;
        const page = pagedResult(commentsWithBacklinks, {
          page: focusedPage,
          pageSize: firstPageOptions.pageSize,
          maxPageSize: 100
        });
        return {
          thread: threadWithBacklinks,
          comments: page.items,
          commentPage: {
            page: page.page,
            pageSize: page.pageSize,
            total: page.total,
            totalPages: page.totalPages,
            hasMore: page.hasMore,
            currentMaxGlobalNumber,
            sort: commentsSort
          }
        };
      }
      return {
        thread: threadWithBacklinks,
        comments: commentsWithBacklinks,
        commentsSort
      };
    },

    async createComment({ threadId, body, image, captchaToken, ip, posterToken, displayName = '', options = '', deletePassword = '', capcode = null, accountId }) {
      await requireCaptcha(captchaToken, ip);
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung là bắt buộc');
        error.statusCode = 400;
        throw error;
      }
      const safeImage = validateImage(image);
      const createdAt = now().toISOString();
      const postingOptions = parsePostingOptions(options);
      const { displayName: normalizedDisplayName, tripcode } = parseDisplayNameWithTripcode(displayName);

      return mutate(async (state) => {
        const authorFingerprint = enforceSanctions(state, { ip, posterToken, createdAt });
        const thread = state.threads.find((item) => item.id === threadId && activePublicThread(item));
        if (!thread) {
          const error = new Error('Không tìm thấy chủ đề');
          error.statusCode = 404;
          throw error;
        }
        if (thread.isLocked) {
          const error = new Error('Chủ đề đã bị khóa, không thể trả lời');
          error.statusCode = 403;
          throw error;
        }
        assertEventBoardOpen(findBoard(state, thread.boardSlug), createdAt);
        enforceThreadSlowMode(state, thread, { authorFingerprint, createdAt });

        const repliesBeforeCreate = publicReplyCount(state, threadId);
        if (repliesBeforeCreate >= lifecycle.replyLimit) {
          const error = new Error('Chủ đề đã đạt giới hạn phản hồi');
          error.statusCode = 409;
          throw error;
        }
        const moderation = await ai.moderate(normalizedBody);
        const storedImage = safeImage ? await imageStorage.save(safeImage) : null;

        const comment = {
          id: crypto.randomUUID(),
          threadId,
          boardSlug: thread.boardSlug,
          body: normalizedBody,
          displayName: normalizedDisplayName,
          tripcode,
          capcode: normalizeCapcode(capcode),
          accountId,
          image: applyImageSpoiler(storedImage, safeImage),
          authorFingerprint,
          globalNumber: nextNumber(state),
          posterHash: createPosterHash({ ip, threadId, salt: daySalt(new Date(createdAt)), posterToken }),
          opProofHash: createPosterProofHash({ threadId, posterToken }),
          deletePasswordHash: deletePasswordHash(deletePassword),
          options: postingOptions.raw,
          sage: postingOptions.sage,
          noko: postingOptions.noko,
          isPending: moderation.status === 'Flagged',
          isDeleted: false,
          moderationStatus: moderation.status,
          moderationLabels: moderation.labels ?? [],
          createdAt
        };
        state.comments.push(comment);
        recordModerationAction(state, {
          action: 'ai:moderate',
          actor: 'ai',
          postType: 'comment',
          post: comment,
          reason: moderation.labels?.join(', ') || moderation.status,
          createdAt
        });
        logEvent('post.create', {
          postType: 'comment',
          boardSlug: comment.boardSlug,
          threadId,
          globalNumber: comment.globalNumber,
          moderationStatus: comment.moderationStatus,
          moderationLabels: comment.moderationLabels,
          isPending: comment.isPending
        });
        const slowModeRaised = raiseThreadSlowMode(thread, comment.moderationLabels, createdAt);

        if (!comment.isPending) {
          realtime.publish('comment:created', { threadId, comment: serializeComment(comment, thread) });
          if (!postingOptions.sage && repliesBeforeCreate < lifecycle.bumpLimit) {
            thread.bumpedAt = createdAt;
            realtime.publish('thread:bumped', { thread: serializeThread(thread, state.comments) });
          }
        }
        if (slowModeRaised) {
          realtime.publish('thread:updated', { thread: serializeThread(thread, state.comments) });
        }

        return {
          status: comment.isPending ? 'pending' : 'published',
          comment: serializeComment(comment, thread)
        };
      });
    },

    async votePoll(threadId, { optionId, ip, posterToken } = {}) {
      const selectedOptionId = String(optionId ?? '');
      return mutate(async (state) => {
        const thread = state.threads.find((item) => item.id === threadId && activePublicThread(item));
        if (!thread?.poll) {
          const error = new Error('Không tìm thấy thăm dò');
          error.statusCode = 404;
          throw error;
        }
        const option = thread.poll.options.find((item) => item.id === selectedOptionId);
        if (!option) {
          const error = new Error('Lựa chọn không hợp lệ');
          error.statusCode = 400;
          throw error;
        }
        const fingerprint = createModerationFingerprint({ ip, posterToken });
        thread.pollVotes ??= {};
        if (thread.pollVotes[fingerprint]) {
          const error = new Error('Bạn đã vote thăm dò này');
          error.statusCode = 409;
          throw error;
        }

        option.votes = Number(option.votes || 0) + 1;
        thread.poll.totalVotes = Number(thread.poll.totalVotes || 0) + 1;
        thread.poll.updatedAt = now().toISOString();
        thread.pollVotes[fingerprint] = option.id;
        const serialized = serializeThread(thread, state.comments);
        realtime.publish('thread:updated', { thread: serialized });
        return serialized.poll;
      });
    },

    async lookupPost(globalNumber) {
      const state = await store.read();
      const found = findPublicPostByGlobalNumber(state, globalNumber);
      if (found?.postType === 'thread') {
        return { type: 'thread', post: serializeThread(found.post, state.comments) };
      }
      if (found?.postType === 'comment') {
        const thread = state.threads.find((item) => item.id === found.post.threadId);
        return { type: 'comment', post: serializeComment(found.post, thread) };
      }
      const error = new Error('Không tìm thấy bài viết');
      error.statusCode = 404;
      throw error;
    },

    async reportPost({ globalNumber, reason, ip, posterToken }) {
      const safeReason = sanitizeReason(reason);
      if (!safeReason) {
        const error = new Error('Lý do báo cáo là bắt buộc');
        error.statusCode = 400;
        throw error;
      }

      return mutate(async (state) => {
        const found = findPublicPostByGlobalNumber(state, globalNumber);
        if (!found) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }

        const createdAt = now().toISOString();
        const report = {
          id: crypto.randomUUID(),
          postType: found.postType,
          postId: found.post.id,
          threadId: found.postType === 'thread' ? found.post.id : found.post.threadId,
          boardSlug: found.post.boardSlug,
          globalNumber: found.post.globalNumber,
          reason: safeReason,
          reporterHash: createPosterHash({
            ip,
            threadId: `report:${found.post.globalNumber}`,
            salt: daySalt(new Date(createdAt)),
            posterToken
          }),
          status: 'open',
          createdAt
        };
        state.reports.push(report);
        logEvent('report.create', {
          boardSlug: report.boardSlug,
          globalNumber: report.globalNumber,
          postType: report.postType
        });
        return report;
      });
    },

    async votePost({ globalNumber, direction, accountId } = {}) {
      const dir = direction === 'up' || direction === 'down' ? direction : null;
      if (!dir) {
        const error = new Error('Lựa chọn vote không hợp lệ');
        error.statusCode = 400;
        throw error;
      }
      if (!accountId) {
        const error = new Error('Vui lòng đăng nhập tài khoản để vote');
        error.statusCode = 401;
        throw error;
      }

      return mutate(async (state) => {
        const found = findPublicPostByGlobalNumber(state, globalNumber);
        if (!found) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }

        const post = found.post;
        // Key votes by account so each account votes once, regardless of IP.
        const voterKey = `account:${accountId}`;
        post.voters ??= {};
        if (post.voters[voterKey] === dir) {
          delete post.voters[voterKey];
        } else {
          post.voters[voterKey] = dir;
        }

        let up = 0;
        let down = 0;
        for (const value of Object.values(post.voters)) {
          if (value === 'up') {
            up += 1;
          } else if (value === 'down') {
            down += 1;
          }
        }
        post.votes = { up, down };
        const myVote = post.voters[voterKey] ?? null;

        if (found.postType === 'thread') {
          realtime.publish('thread:updated', { thread: serializeThread(post, state.comments) });
        } else {
          const thread = state.threads.find((item) => item.id === post.threadId);
          realtime.publish('comment:updated', {
            threadId: post.threadId,
            comment: serializeComment(post, thread)
          });
        }
        return { votes: publicVotes(post), myVote };
      });
    },

    async deletePost({ globalNumber, password, fileOnly = false } = {}) {
      return mutate(async (state) => {
        const found = findPublicPostByGlobalNumber(state, globalNumber);
        if (!found) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }
        verifyDeletePassword(found.post, password);

        const deletedAt = now().toISOString();
        if (fileOnly) {
          if (!found.post.image) {
            const error = new Error('Bài viết không có tệp để xóa');
            error.statusCode = 400;
            throw error;
          }
          found.post.image = null;
          found.post.fileDeletedAt = deletedAt;
        } else {
          found.post.isDeleted = true;
          found.post.deletedAt = deletedAt;
          found.post.deleteReason = 'self-delete';
        }
        recordModerationAction(state, {
          action: fileOnly ? 'user:delete-file' : 'user:delete',
          actor: 'anonymous',
          postType: found.postType,
          post: found.post,
          reason: fileOnly ? 'file-only' : 'self-delete',
          createdAt: deletedAt
        });

        if (found.postType === 'thread') {
          realtime.publish('thread:updated', { threadId: found.post.id, deleted: !fileOnly, fileOnly: Boolean(fileOnly) });
        } else {
          const parent = state.threads.find((thread) => thread.id === found.post.threadId);
          realtime.publish('thread:updated', { thread: parent ? serializeThread(parent, state.comments) : null });
        }
        return { ok: true, fileOnly: Boolean(fileOnly), globalNumber: found.post.globalNumber };
      });
    },

    async listPending(filters = {}) {
      const state = await store.read();
      const threads = state.threads
        .filter((thread) => thread.isPending && !thread.isDeleted)
        .filter((thread) => matchesAdminFilters(thread, filters, 'createdAt'))
        .map((thread) => serializeAdminPost('thread', thread, state));
      const comments = state.comments
        .filter((comment) => comment.isPending && !comment.isDeleted)
        .filter((comment) => matchesAdminFilters(comment, filters, 'createdAt'))
        .map((comment) => serializeAdminPost('comment', comment, state));
      return [...threads, ...comments].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },

    async listDeleted(limit = 50, filters = {}) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const threads = state.threads
        .filter((thread) => thread.isDeleted)
        .filter((thread) => matchesAdminFilters(thread, filters, 'deletedAt'))
        .map((thread) => serializeAdminPost('thread', thread, state));
      const comments = state.comments
        .filter((comment) => comment.isDeleted)
        .filter((comment) => matchesAdminFilters(comment, filters, 'deletedAt'))
        .map((comment) => serializeAdminPost('comment', comment, state));
      return [...threads, ...comments]
        .sort((left, right) => String(right.deletedAt ?? '').localeCompare(String(left.deletedAt ?? '')))
        .slice(0, safeLimit);
    },

    async listApprovedHistory(limit = 50, filters = {}) {
      return this.listModerationActions(limit, { ...filters, action: 'admin:approve' });
    },

    async getAdminPostDetail(globalNumber) {
      const state = await store.read();
      const found = findAnyPostByGlobalNumber(state, globalNumber);
      if (!found) {
        const error = new Error('Không tìm thấy bài viết');
        error.statusCode = 404;
        throw error;
      }

      const post = serializeAdminPost(found.postType, found.post, state);
      const thread =
        found.postType === 'thread'
          ? serializeThread(found.post, state.comments)
          : state.threads.find((item) => item.id === found.post.threadId);
      const reports = state.reports
        .filter((report) => report.globalNumber === found.post.globalNumber)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const actions = state.moderationActions
        .filter((action) => action.globalNumber === found.post.globalNumber)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const sanctions = state.sanctions
        .filter((sanction) => sanction.sourceGlobalNumber === found.post.globalNumber)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(serializeSanction);

      return {
        post,
        thread: thread ? serializeThread(thread, state.comments) : null,
        reports,
        actions,
        sanctions
      };
    },

    async adminDeletePost(globalNumber, { reason = '', actor = 'admin', fileOnly = false } = {}) {
      return mutate(async (state) => {
        const found = findAnyPostByGlobalNumber(state, globalNumber);
        if (!found || found.post.isDeleted) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }

        const deletedAt = now().toISOString();
        const safeReason = sanitizeReason(reason);
        if (fileOnly) {
          if (!found.post.image) {
            const error = new Error('Bài viết không có tệp để xóa');
            error.statusCode = 400;
            throw error;
          }
          found.post.image = null;
          found.post.fileDeletedAt = deletedAt;
        } else {
          found.post.isDeleted = true;
          found.post.deletedAt = deletedAt;
          found.post.deleteReason = safeReason || 'admin-delete';
        }
        recordModerationAction(state, {
          action: fileOnly ? 'admin:delete-file' : 'admin:delete',
          actor,
          postType: found.postType,
          post: found.post,
          reason: safeReason || (fileOnly ? 'file-only' : 'admin-delete'),
          createdAt: deletedAt
        });
        logEvent('moderation.delete', {
          postType: found.postType,
          boardSlug: found.post.boardSlug,
          globalNumber: found.post.globalNumber,
          actor,
          fileOnly: Boolean(fileOnly)
        });

        if (found.postType === 'thread') {
          realtime.publish('thread:updated', { threadId: found.post.id, deleted: !fileOnly, fileOnly: Boolean(fileOnly) });
        } else {
          const parent = state.threads.find((thread) => thread.id === found.post.threadId);
          realtime.publish('thread:updated', { thread: parent ? serializeThread(parent, state.comments) : null });
        }
        return { ok: true, fileOnly: Boolean(fileOnly), globalNumber: found.post.globalNumber };
      });
    },

    async addModeratorNote(globalNumber, { note = '', actor = 'admin' } = {}) {
      const safeNote = sanitizeReason(note);
      if (!safeNote) {
        const error = new Error('Ghi chú là bắt buộc');
        error.statusCode = 400;
        throw error;
      }

      return mutate(async (state) => {
        const found = findAnyPostByGlobalNumber(state, globalNumber);
        if (!found) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }

        const createdAt = now().toISOString();
        recordModerationAction(state, {
          action: 'admin:note',
          actor,
          postType: found.postType,
          post: found.post,
          reason: safeNote,
          createdAt
        });
        logEvent('moderation.note', {
          postType: found.postType,
          boardSlug: found.post.boardSlug,
          globalNumber: found.post.globalNumber,
          actor
        });
        return state.moderationActions.at(-1);
      });
    },

    async listSanctions(limit = 50, filters = {}) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const checkedAt = now().toISOString();
      return [...state.sanctions]
        .filter((sanction) => !filters.kind || sanction.kind === filters.kind)
        .filter((sanction) => !filters.boardSlug || sanction.boardSlug === filters.boardSlug)
        .filter((sanction) => {
          if (filters.status === 'active') {
            return !sanction.revokedAt && (!sanction.expiresAt || sanction.expiresAt.localeCompare(checkedAt) > 0);
          }
          if (filters.status === 'revoked') {
            return Boolean(sanction.revokedAt);
          }
          if (filters.status === 'expired') {
            return !sanction.revokedAt && sanction.expiresAt && sanction.expiresAt.localeCompare(checkedAt) <= 0;
          }
          return true;
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, safeLimit)
        .map(serializeSanction);
    },

    async createSanctionForPost(globalNumber, { kind = 'cooldown', durationMinutes, reason = '', actor = 'admin' } = {}) {
      const safeKind = kind === 'ban' ? 'ban' : 'cooldown';
      const safeDuration = sanitizeDurationMinutes(durationMinutes, safeKind === 'ban' ? 24 * 60 : 60);
      const safeReason = sanitizeReason(reason) || (safeKind === 'ban' ? 'Tạm khóa' : 'Cooldown');

      return mutate(async (state) => {
        const found = findAnyPostByGlobalNumber(state, globalNumber);
        if (!found) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }
        if (!found.post.authorFingerprint) {
          const error = new Error('Bài viết này chưa có fingerprint vận hành');
          error.statusCode = 409;
          throw error;
        }

        const createdAt = now().toISOString();
        const expiresAt = new Date(new Date(createdAt).getTime() + safeDuration * 60 * 1000).toISOString();
        const sanction = {
          id: crypto.randomUUID(),
          kind: safeKind,
          fingerprint: found.post.authorFingerprint,
          fingerprintPreview: fingerprintPreview(found.post.authorFingerprint),
          sourceGlobalNumber: found.post.globalNumber,
          sourcePostType: found.postType,
          boardSlug: found.post.boardSlug,
          reason: safeReason,
          actor,
          createdAt,
          expiresAt
        };
        state.sanctions.push(sanction);
        recordModerationAction(state, {
          action: safeKind === 'ban' ? 'admin:ban' : 'admin:cooldown',
          actor,
          postType: found.postType,
          post: found.post,
          reason: `${safeReason} (${safeDuration} phút)`,
          createdAt
        });
        logEvent('moderation.sanction', {
          kind: safeKind,
          boardSlug: found.post.boardSlug,
          globalNumber: found.post.globalNumber,
          actor
        });
        return serializeSanction(sanction);
      });
    },

    async revokeSanction(id, { reason = '', actor = 'admin' } = {}) {
      return mutate(async (state) => {
        const sanction = state.sanctions.find((item) => item.id === id && !item.revokedAt);
        if (!sanction) {
          const error = new Error('Không tìm thấy khóa tạm đang hoạt động');
          error.statusCode = 404;
          throw error;
        }

        sanction.revokedAt = now().toISOString();
        sanction.revokeReason = sanitizeReason(reason);
        sanction.revokedBy = actor;
        const found = findAnyPostByGlobalNumber(state, sanction.sourceGlobalNumber);
        if (found) {
          recordModerationAction(state, {
            action: 'admin:unsanction',
            actor,
            postType: found.postType,
            post: found.post,
            reason: sanction.revokeReason || 'Gỡ khóa tạm',
            createdAt: sanction.revokedAt
          });
        }
        logEvent('moderation.unsanction', {
          kind: sanction.kind,
          boardSlug: sanction.boardSlug,
          sourceGlobalNumber: sanction.sourceGlobalNumber,
          actor
        });
        return serializeSanction(sanction);
      });
    },

    async approvePending(id, { reason = '', actor = 'admin' } = {}) {
      return mutate(async (state) => {
        const actionAt = now().toISOString();
        const thread = state.threads.find((item) => item.id === id && item.isPending && !item.isDeleted);
        if (thread) {
          thread.isPending = false;
          thread.moderationStatus = 'ApprovedByAdmin';
          thread.moderationReason = sanitizeReason(reason);
          thread.bumpedAt = actionAt;
          recordModerationAction(state, {
            action: 'admin:approve',
            actor,
            postType: 'thread',
            post: thread,
            reason,
            createdAt: actionAt
          });
          logEvent('moderation.approve', {
            postType: 'thread',
            boardSlug: thread.boardSlug,
            globalNumber: thread.globalNumber,
            actor
          });
          realtime.publish('thread:created', { thread: serializeThread(thread, state.comments) });
          return serializeThread(thread, state.comments);
        }

        const comment = state.comments.find((item) => item.id === id && item.isPending && !item.isDeleted);
        if (comment) {
          const parent = state.threads.find((item) => item.id === comment.threadId && activePublicThread(item));
          if (!parent) {
            const error = new Error('Không tìm thấy chủ đề cha');
            error.statusCode = 404;
            throw error;
          }
          comment.isPending = false;
          comment.moderationStatus = 'ApprovedByAdmin';
          comment.moderationReason = sanitizeReason(reason);
          parent.bumpedAt = actionAt;
          recordModerationAction(state, {
            action: 'admin:approve',
            actor,
            postType: 'comment',
            post: comment,
            reason,
            createdAt: actionAt
          });
          logEvent('moderation.approve', {
            postType: 'comment',
            boardSlug: comment.boardSlug,
            globalNumber: comment.globalNumber,
            actor
          });
          realtime.publish('comment:created', { threadId: parent.id, comment: serializeComment(comment, parent) });
          realtime.publish('thread:bumped', { thread: serializeThread(parent, state.comments) });
          return serializeComment(comment, parent);
        }

        const error = new Error('Không tìm thấy bài đang chờ duyệt');
        error.statusCode = 404;
        throw error;
      });
    },

    async deletePending(id, { reason = '', actor = 'admin' } = {}) {
      return mutate(async (state) => {
        const post =
          state.threads.find((item) => item.id === id && item.isPending && !item.isDeleted) ??
          state.comments.find((item) => item.id === id && item.isPending && !item.isDeleted);
        if (!post) {
          const error = new Error('Không tìm thấy bài đang chờ duyệt');
          error.statusCode = 404;
          throw error;
        }
        post.isDeleted = true;
        post.deletedAt = now().toISOString();
        post.deleteReason = sanitizeReason(reason);
        recordModerationAction(state, {
          action: 'admin:delete',
          actor,
          postType: post.threadId ? 'comment' : 'thread',
          post,
          reason,
          createdAt: post.deletedAt
        });
        logEvent('moderation.delete', {
          postType: post.threadId ? 'comment' : 'thread',
          boardSlug: post.boardSlug,
          globalNumber: post.globalNumber,
          actor
        });
        return { ok: true };
      });
    },

    async summarizeThread(threadId, { ip, posterToken, actor = 'public', sinceGlobalNumber = 0 } = {}) {
      const detail = await this.getThread(threadId);
      const sinceNumber = sanitizeSinceGlobalNumber(sinceGlobalNumber);
      const comments = sinceNumber
        ? detail.comments.filter((comment) => Number(comment.globalNumber) > sinceNumber)
        : detail.comments;
      const items = (sinceNumber ? comments : [detail.thread, ...comments]).map((item) => ({
        body: redactSensitiveText(item.body)
      }));
      if (sinceNumber && !items.length) {
        return ['Chưa có bình luận mới từ lần đọc trước.'];
      }
      return mutate(async (state) => {
        const createdAt = now().toISOString();
        const fingerprint = threadSummaryFingerprint(detail, sinceNumber);
        const cacheKey = sinceNumber ? `thread:${threadId}:since:${sinceNumber}` : `thread:${threadId}`;
        if (state.aiSummaryCache[cacheKey]?.fingerprint !== fingerprint) {
          consumeAiBudget(state, { kind: 'summary', ip, posterToken, actor, createdAt });
        }
        logEvent('ai.summary', { target: 'thread', threadId, sinceGlobalNumber: sinceNumber || null });
        return cacheSummary(state, cacheKey, fingerprint, () => ai.summarize(items), createdAt);
      });
    },

    async summarizeBoard(boardSlug, { ip, posterToken, actor = 'public' } = {}) {
      const threads = await this.listThreads(boardSlug);
      const items = threads.map((thread) => ({ body: redactSensitiveText(thread.body) }));
      return mutate(async (state) => {
        const createdAt = now().toISOString();
        const fingerprint = boardSummaryFingerprint(threads);
        const cacheKey = `board:${boardSlug}`;
        if (state.aiSummaryCache[cacheKey]?.fingerprint !== fingerprint) {
          consumeAiBudget(state, { kind: 'summary', ip, posterToken, actor, createdAt });
        }
        logEvent('ai.summary', { target: 'board', boardSlug });
        return cacheSummary(state, cacheKey, fingerprint, () => ai.summarize(items), createdAt);
      });
    },

    // Admin-triggered daily board digest (#119). Public board content only; no
    // account data, IPs, session/poster/admin tokens, or captcha tokens are
    // read or sent to AI. Result is explicitly labelled as AI-generated, cached
    // per day, and guarded by a stricter admin digest budget.
    async generateBoardDigest({ ip, actor = 'admin', limit = 50 } = {}) {
      const label = 'Nội dung do AI tổng hợp';
      return mutate(async (state) => {
        const createdAt = now().toISOString();
        const publicBoardSlugs = new Set(state.boards.filter(publicBoard).map((board) => board.slug));
        const threads = state.threads
          .filter((thread) => publicBoardSlugs.has(thread.boardSlug) && activePublicThread(thread))
          .sort(compareBoardThreads)
          .slice(0, Math.max(1, Math.min(Number(limit) || 50, 100)));
        // Only redacted public thread bodies are sent to AI.
        const items = threads.map((thread) => ({ body: redactSensitiveText(thread.body) }));

        if (!items.length) {
          logEvent('ai.digest', { target: 'board-digest', threadCount: 0, empty: true });
          return {
            label,
            generatedAt: createdAt,
            boardCount: publicBoardSlugs.size,
            threadCount: 0,
            bullets: ['Chưa đủ dữ liệu công khai để tạo bản tổng hợp.']
          };
        }

        const fingerprint = `${daySalt(now())}:${boardSummaryFingerprint(threads)}`;
        const cacheKey = `digest:${daySalt(now())}`;
        if (state.aiSummaryCache[cacheKey]?.fingerprint !== fingerprint) {
          consumeAiBudget(state, { kind: 'digest', ip, actor, createdAt });
        }
        logEvent('ai.digest', { target: 'board-digest', threadCount: threads.length });
        const bullets = await cacheSummary(state, cacheKey, fingerprint, () => ai.summarize(items), createdAt);
        return {
          label,
          generatedAt: createdAt,
          boardCount: publicBoardSlugs.size,
          threadCount: threads.length,
          bullets
        };
      });
    },

    async suggestComments(threadId, { ip, posterToken, actor = 'public' } = {}) {
      const detail = await this.getThread(threadId);
      const items = [detail.thread, ...detail.comments.slice(-3)].map((item) => ({
        body: redactSensitiveText(item.body)
      }));
      return mutate(async (state) => {
        consumeAiBudget(state, {
          kind: 'suggestion',
          ip,
          posterToken,
          actor,
          createdAt: now().toISOString()
        });
        logEvent('ai.suggestion', { threadId });
        return ai.suggest(items);
      });
    },

    async rewriteDraft({ body, ip, posterToken, actor = 'public', tone = 'neutral' } = {}) {
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung là bắt buộc');
        error.statusCode = 400;
        throw error;
      }

      return mutate(async (state) => {
        consumeAiBudget(state, {
          kind: 'rewrite',
          ip,
          posterToken,
          actor,
          createdAt: now().toISOString()
        });
        logEvent('ai.rewrite', { actor });
        return ai.rewrite(normalizedBody, tone);
      });
    },

    async translateDraft({ text, targetLang = 'vi', ip, posterToken, actor = 'public' } = {}) {
      const normalizedText = normalizeBody(text);
      if (!normalizedText) {
        const error = new Error('Nội dung là bắt buộc');
        error.statusCode = 400;
        throw error;
      }
      const allowedLangs = new Set(['vi', 'en', 'ja', 'ko', 'zh', 'fr', 'es', 'de', 'th']);
      const lang = allowedLangs.has(String(targetLang)) ? String(targetLang) : 'vi';
      return mutate(async (state) => {
        consumeAiBudget(state, { kind: 'translate', ip, posterToken, actor, createdAt: now().toISOString() });
        logEvent('ai.translate', { actor, targetLang: lang });
        return { text: await ai.translate(normalizedText, lang), targetLang: lang };
      });
    },

    async transcribeAudio({ audio, ip, posterToken, actor = 'public' } = {}) {
      assertAiMedia(audio, 12 * 1024 * 1024, 'audio');
      return mutate(async (state) => {
        consumeAiBudget(state, { kind: 'transcribe', ip, posterToken, actor, createdAt: now().toISOString() });
        logEvent('ai.transcribe', { actor });
        return { text: await ai.transcribe(audio) };
      });
    },

    async captionImage({ image, mode = 'describe', ip, posterToken, actor = 'public' } = {}) {
      assertAiMedia(image, 8 * 1024 * 1024, 'image');
      const safeMode = mode === 'ocr' ? 'ocr' : 'describe';
      return mutate(async (state) => {
        consumeAiBudget(state, { kind: 'caption', ip, posterToken, actor, createdAt: now().toISOString() });
        logEvent('ai.caption', { actor, mode: safeMode });
        return { text: await ai.caption(image, safeMode), mode: safeMode };
      });
    },

    async speakText({ text, voice, languageCode, ip, posterToken, actor = 'public' } = {}) {
      const normalizedText = normalizeBody(text);
      if (!normalizedText) {
        const error = new Error('Nội dung là bắt buộc');
        error.statusCode = 400;
        throw error;
      }
      if (normalizedText.length > 2000) {
        const error = new Error('Văn bản quá dài để chuyển thành giọng nói (tối đa 2000 ký tự).');
        error.statusCode = 413;
        throw error;
      }
      return mutate(async (state) => {
        consumeAiBudget(state, { kind: 'speak', ip, posterToken, actor, createdAt: now().toISOString() });
        logEvent('ai.speak', { actor });
        const audio = await ai.speak(normalizedText, { voice, languageCode });
        return { audio: audio.data, mimeType: audio.mimeType };
      });
    },

    async summarizePostReports(globalNumber, { ip, actor = 'admin' } = {}) {
      return mutate(async (state) => {
        const found = findAnyPostByGlobalNumber(state, globalNumber);
        if (!found) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }
        const reports = state.reports.filter((report) => report.globalNumber === Number(globalNumber));
        if (!reports.length) {
          return 'Chưa có báo cáo vi phạm nào.';
        }
        consumeAiBudget(state, {
          kind: 'summary',
          ip,
          actor,
          createdAt: now().toISOString()
        });
        const reasons = reports.map((report) => redactSensitiveText(report.reason));
        return ai.summarizeReports(reasons);
      });
    },

    async getAnalytics() {
      const state = await store.read();
      const boardActivity = {};
      for (const board of state.boards) {
        const boardThreads = state.threads.filter((t) => t.boardSlug === board.slug);
        const boardComments = state.comments.filter((c) => c.boardSlug === board.slug);
        const boardReports = state.reports.filter((r) => r.boardSlug === board.slug);
        boardActivity[board.slug] = {
          activeThreads: boardThreads.filter((t) => !t.isPending && !t.isDeleted).length,
          activeComments: boardComments.filter((c) => !c.isPending && !c.isDeleted).length,
          pendingThreads: boardThreads.filter((t) => t.isPending && !t.isDeleted).length,
          pendingComments: boardComments.filter((c) => c.isPending && !c.isDeleted).length,
          deletedThreads: boardThreads.filter((t) => t.isDeleted).length,
          deletedComments: boardComments.filter((c) => c.isDeleted).length,
          totalReports: boardReports.length
        };
      }

      let totalAiUsage = 0;
      const byKind = { moderation: 0, summary: 0, suggestion: 0, rewrite: 0 };
      const dailyUsage = {};

      for (const key of Object.keys(state.aiUsage || {})) {
        const val = state.aiUsage[key];
        const parts = key.split(':');
        if (parts.length >= 2) {
          const date = parts[0];
          const kind = parts[1];
          const count = val.count || 0;

          totalAiUsage += count;
          if (byKind[kind] !== undefined) {
            byKind[kind] += count;
          } else {
            byKind[kind] = (byKind[kind] || 0) + count;
          }

          dailyUsage[date] = (dailyUsage[date] || 0) + count;
        }
      }

      const sortedDailyUsage = Object.keys(dailyUsage)
        .sort()
        .slice(-7)
        .map((date) => ({ date, count: dailyUsage[date] }));

      const pendingThreadsCount = state.threads.filter((t) => t.isPending && !t.isDeleted).length;
      const pendingCommentsCount = state.comments.filter((c) => c.isPending && !c.isDeleted).length;
      const pendingCount = pendingThreadsCount + pendingCommentsCount;

      let oldestPendingAgeMinutes = 0;
      const allPending = [
        ...state.threads.filter((t) => t.isPending && !t.isDeleted),
        ...state.comments.filter((c) => c.isPending && !c.isDeleted)
      ];

      if (allPending.length > 0) {
        const oldest = allPending.reduce((oldestAcc, current) => {
          return new Date(current.createdAt) < new Date(oldestAcc.createdAt) ? current : oldestAcc;
        }, allPending[0]);
        oldestPendingAgeMinutes = Math.max(0, Math.round((now().getTime() - new Date(oldest.createdAt).getTime()) / 60000));
      }

      let totalResolutionTimeMs = 0;
      let resolvedCount = 0;

      for (const action of state.moderationActions || []) {
        if (action.action === 'admin:approve' || action.action === 'admin:delete') {
          const post = state.threads.find((t) => t.id === action.postId) || state.comments.find((c) => c.id === action.postId);
          if (post && post.createdAt && action.createdAt) {
            const durationMs = new Date(action.createdAt).getTime() - new Date(post.createdAt).getTime();
            if (durationMs >= 0) {
              totalResolutionTimeMs += durationMs;
              resolvedCount += 1;
            }
          }
        }
      }
      const averageResolutionTimeMinutes = resolvedCount > 0
        ? Math.round((totalResolutionTimeMs / resolvedCount) / 60000)
        : 0;

      return {
        boardActivity,
        aiUsage: {
          total: totalAiUsage,
          byKind,
          daily: sortedDailyUsage
        },
        moderationQueue: {
          pendingCount,
          pendingThreads: pendingThreadsCount,
          pendingComments: pendingCommentsCount,
          oldestPendingAgeMinutes,
          averageResolutionTimeMinutes,
          resolvedCount
        }
      };
    },

    async createBoard({ slug, name, category, description, isHidden, isArchived } = {}, { actor } = {}) {
      const input = normalizeBoardInput({ slug, name, category, description, isHidden, isArchived });
      return mutate(async (state) => {
        if (state.boards.find((b) => b.slug === input.slug)) {
          const error = new Error('Board đã tồn tại');
          error.statusCode = 409;
          throw error;
        }
        const board = {
          ...input,
          isHidden: Boolean(input.isHidden),
          isArchived: Boolean(input.isArchived)
        };
        state.boards.push(board);
        logEvent('board.created', { slug: board.slug, actor });
        return { board: serializeBoard(board, { admin: true }) };
      });
    },

    async updateBoard(slug, { name, category, description, isHidden, isArchived } = {}, { actor } = {}) {
      const safeSlug = String(slug ?? '').trim().toLowerCase();
      if (!BOARD_SLUG_PATTERN.test(safeSlug)) {
        const error = new Error('Slug board không hợp lệ');
        error.statusCode = 400;
        throw error;
      }
      const updates = normalizeBoardInput(
        { name, category, description, isHidden, isArchived },
        { requireSlug: false }
      );
      return mutate(async (state) => {
        const board = state.boards.find((b) => b.slug === safeSlug);
        if (!board) {
          const error = new Error('Không tìm thấy board');
          error.statusCode = 404;
          throw error;
        }
        Object.assign(board, updates);

        logEvent('board.updated', { slug: safeSlug, actor });
        return { board: serializeBoard(board, { admin: true }) };
      });
    },

    async deleteBoard(slug, { actor } = {}) {
      const safeSlug = String(slug ?? '').trim().toLowerCase();
      if (!BOARD_SLUG_PATTERN.test(safeSlug)) {
        const error = new Error('Slug board không hợp lệ');
        error.statusCode = 400;
        throw error;
      }

      return mutate(async (state) => {
        const index = state.boards.findIndex((board) => board.slug === safeSlug);
        if (index === -1) {
          const error = new Error('Không tìm thấy board');
          error.statusCode = 404;
          throw error;
        }

        const hasContent =
          state.threads.some((thread) => thread.boardSlug === safeSlug) ||
          state.comments.some((comment) => comment.boardSlug === safeSlug) ||
          (state.reports || []).some((report) => report.boardSlug === safeSlug) ||
          (state.sanctions || []).some((sanction) => sanction.boardSlug === safeSlug);
        if (hasContent) {
          const error = new Error('Board đã có dữ liệu, hãy ẩn hoặc lưu trữ thay vì xóa');
          error.statusCode = 409;
          throw error;
        }

        const [board] = state.boards.splice(index, 1);
        logEvent('board.deleted', { slug: safeSlug, actor });
        return { board: serializeBoard(board, { admin: true }) };
      });
    },

    async listAccountPosts(accountId) {
      if (!accountId) return [];
      const state = await store.read();
      const threads = state.threads
        .filter((thread) => thread.accountId === accountId && !thread.isDeleted)
        .map((thread) => ({ type: 'thread', post: serializeThread(thread, state.comments) }));
      const comments = state.comments
        .filter((comment) => comment.accountId === accountId && !comment.isDeleted)
        .map((comment) => {
          const thread = state.threads.find((item) => item.id === comment.threadId);
          return { type: 'comment', post: serializeComment(comment, thread) };
        });

      return [...threads, ...comments].sort((left, right) => {
        const timeDiff = right.post.createdAt.localeCompare(left.post.createdAt);
        if (timeDiff !== 0) return timeDiff;
        return right.post.globalNumber - left.post.globalNumber;
      });
    }
  };
}
