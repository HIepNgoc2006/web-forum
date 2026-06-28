import crypto from 'node:crypto';

import {
  BOARDS,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_THUMBNAIL_BYTES,
  THREAD_LIFECYCLE,
  aiConfigStatus,
  normalizeRetentionPolicy,
  publicBoardConfig,
  readModerationConfidenceThreshold,
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
const ACCOUNT_THEMES = new Set(['yotsuba-b', 'yotsuba', 'tomorrow', 'burichan']);
const MAX_ACCOUNT_WATCHLIST_ITEMS = 100;
const MAX_ACCOUNT_DRAFTS = 40;
const MAX_ACCOUNT_SAVED_SEARCHES = 50;
const MAX_ACCOUNT_CONTENT_FILTERS = 80;
const MAX_ACCOUNT_REPLY_TEMPLATES = 40;
const MAX_ACCOUNT_POSTER_NOTES = 120;
const MAX_ACCOUNT_DRAFT_LENGTH = 12_000;
const MAX_ACCOUNT_REPLY_TEMPLATE_LENGTH = 5_000;
const ACCOUNT_DISPLAY_PREFS = ['compactThreads', 'hideThumbnails', 'watchedUnreadOnly'];
const ACCOUNT_WATCHED_SORTS = new Set(['unread', 'recent', 'board']);
const ACCOUNT_NOTIFICATION_PREFS = ['email', 'watchedThreads', 'boardSubscriptions', 'browserWatchedThreads'];
const BOARD_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_MEDIA_PER_POST = 4;
const THREAD_PREVIEW_REPLY_LIMIT = 3;
const MAX_DICE_ROLLS_PER_POST = 6;
const MAX_DICE_COUNT = 20;
const MAX_DICE_SIDES = 1_000;
const MAX_DICE_MODIFIER = 999;
const SUPPORTED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
const UNSAFE_IMAGE_TYPES = new Set(['image/svg+xml']);
const REPORT_CATEGORIES = new Set(['Spam', 'Toxic', 'PII', 'Fake News', 'Illegal', 'Other']);
const APPEAL_RESOLUTION_STATUSES = new Set(['accepted', 'rejected']);
const PRIORITY_FILTERS = new Set(['high', 'medium', 'low']);
const PRIORITY_SORTS = new Set(['priority', 'newest', 'oldest', 'confidence-desc', 'confidence-asc']);
const PII_PRIORITY_LABELS = new Set(['PII Risk', 'PII']);
const HIGH_RISK_REPORT_CATEGORIES = new Set(['PII', 'Illegal']);
const PRIVILEGED_ACCOUNT_ROLES = new Set(['owner', 'admin', 'moderator', 'viewer']);
const MANAGED_PRIVILEGED_ROLES = new Set(['owner', 'moderator', 'viewer']);
const RECOMMENDED_THREAD_WINDOW_HOURS = 7 * 24;
const RECOMMENDED_THREAD_MAX_LIMIT = 50;
const RECOMMENDED_THREAD_HIGH_RISK_LABELS = new Set(['PII Risk', 'PII', 'Illegal', 'Hate Speech', 'Toxic']);
const RECOMMENDED_THREAD_MEDIUM_RISK_LABELS = new Set(['Spam', 'Fake News']);
const MAX_EDIT_HISTORY_ENTRIES = 100;
const MAX_THREAD_SUBJECT_LENGTH = 120;
const POST_REACTION_TYPES = new Set(['like', 'laugh', 'surprise', 'sad', 'angry', 'thanks']);

function publicPost(post) {
  return !post.isPending && !post.isDeleted;
}

function publicThread(state, thread) {
  return Boolean(thread && publicPost(thread) && findBoard(state, thread.boardSlug, { publicOnly: true }));
}

function publicComment(state, comment) {
  if (!publicPost(comment)) {
    return false;
  }
  const thread = state.threads.find((item) => item.id === comment.threadId);
  return publicThread(state, thread);
}

function stripPrivatePostFields(post) {
  const {
    authorFingerprint: _authorFingerprint,
    opProofHash: _opProofHash,
    deletePasswordHash: _deletePasswordHash,
    pollVotes: _pollVotes,
    voters: _voters,
    reactionVoters: _reactionVoters,
    stickiedBy: _stickiedBy,
    accountId: _accountId,
    ip: _ip,
    posterToken: _posterToken,
    captchaToken: _captchaToken,
    adminToken: _adminToken,
    editedBy: _editedBy,
    editReason: _editReason,
    editHistory: _editHistory,
    restoredAt: _restoredAt,
    restoredBy: _restoredBy,
    restoreReason: _restoreReason,
    ...publicFields
  } = post;
  if (publicFields.body) {
    publicFields.body = sanitizeText(publicFields.body);
  }
  if (publicFields.subject) {
    publicFields.subject = sanitizeText(publicFields.subject);
  }
  return publicFields;
}

function mediaItems(post) {
  if (Array.isArray(post?.images)) {
    return post.images.filter(Boolean);
  }
  return post?.image ? [post.image] : [];
}

function cloneMediaItems(post) {
  return mediaItems(post).map((item) => JSON.parse(JSON.stringify(item)));
}

function activePublicThread(thread) {
  return publicPost(thread) && !thread.isArchived;
}

function archivedPublicThread(thread) {
  return publicPost(thread) && thread.isArchived;
}

function boardRetentionPolicy(board, defaults = THREAD_LIFECYCLE) {
  return normalizeRetentionPolicy(board?.retentionPolicy, defaults);
}

function publicReplyCount(state, threadId) {
  return state.comments.filter((comment) => comment.threadId === threadId && publicPost(comment)).length;
}

function uniqueById(items = []) {
  return [...new Map(items.filter((item) => item?.id).map((item) => [item.id, item])).values()];
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

function serializeBoard(board = {}, { admin = false, retentionDefaults = THREAD_LIFECYCLE } = {}) {
  const presentation = publicBoardConfig(board);
  const serialized = {
    slug: board.slug,
    path: board.path || '/' + board.slug + '/',
    name: presentation.name,
    category: presentation.category,
    description: presentation.description,
    rules: presentation.rules,
    banner: presentation.banner,
    temporary: Boolean(board.temporary),
    eventEndsAt: board.eventEndsAt ?? null,
    retentionPolicy: boardRetentionPolicy(board, retentionDefaults)
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

function optionalBoardText(value = '', maxLength = 400) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeEventEndsAt(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('Thời điểm kết thúc sự kiện không hợp lệ');
    error.statusCode = 400;
    throw error;
  }
  return date.toISOString();
}

function normalizeBoardRulesInput(value) {
  if (value === undefined) {
    return undefined;
  }
  const values = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
  return values
    .map((rule) => optionalBoardText(rule, 240))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeBoardBannerInput(value) {
  if (value === undefined) {
    return undefined;
  }
  const banner = value && typeof value === 'object' ? value : {};
  const imageUrl = optionalBoardText(banner.imageUrl, 300);
  return {
    text: optionalBoardText(banner.text, 180),
    imageUrl: /^(?:\/(?!\/)|https:\/\/)/i.test(imageUrl) ? imageUrl : '',
    altText: optionalBoardText(banner.altText, 140)
  };
}

function normalizeBoardInput(
  { slug, name, category, description, rules, banner, isHidden, isArchived, temporary, eventEndsAt } = {},
  { requireSlug = true } = {}
) {
  const board = {};
  if (requireSlug || slug !== undefined) {
    const safeSlug = String(slug ?? '').trim().toLowerCase();
    if (!BOARD_SLUG_PATTERN.test(safeSlug)) {
      const error = new Error('Slug board không hợp lệ');
      error.statusCode = 400;
      throw error;
    }
    board.slug = safeSlug;
    board.path = '/' + safeSlug + '/';
  }
  if (name !== undefined || requireSlug) board.name = assertBoardText(name, 'Tên board', 80);
  if (category !== undefined || requireSlug) board.category = assertBoardText(category, 'Danh mục board', 80);
  if (description !== undefined || requireSlug) board.description = assertBoardText(description, 'Mô tả board', 240);
  const normalizedRules = normalizeBoardRulesInput(rules);
  if (normalizedRules !== undefined) board.rules = normalizedRules;
  const normalizedBanner = normalizeBoardBannerInput(banner);
  if (normalizedBanner !== undefined) board.banner = normalizedBanner;
  if (typeof isHidden === 'boolean') board.isHidden = isHidden;
  if (typeof isArchived === 'boolean') board.isArchived = isArchived;
  if (typeof temporary === 'boolean') board.temporary = temporary;
  if (eventEndsAt !== undefined) board.eventEndsAt = normalizeEventEndsAt(eventEndsAt);
  if (board.temporary === false) board.eventEndsAt = null;
  return board;
}

function retentionPolicyInput(value) {
  return value && typeof value === 'object' ? value : {};
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
  if (normalizeSearchTerm(thread.subject).includes(term)) {
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

function normalizeThreadSubject(value = '') {
  return normalizeBody(value).replace(/\s+/g, ' ').slice(0, MAX_THREAD_SUBJECT_LENGTH);
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

function normalizeAccountRole(value = 'user') {
  const role = String(value || 'user').toLowerCase();
  if (role === 'admin') {
    return 'owner';
  }
  if (role === 'owner' || role === 'moderator' || role === 'viewer') {
    return role;
  }
  return 'user';
}

function normalizeManagedPrivilegedRole(value = '') {
  const role = normalizeAccountRole(value);
  if (!MANAGED_PRIVILEGED_ROLES.has(role)) {
    const error = new Error('Vai trò quản trị không hợp lệ');
    error.statusCode = 400;
    throw error;
  }
  return role;
}

function isPrivilegedAccount(user = {}) {
  return PRIVILEGED_ACCOUNT_ROLES.has(String(user.role || '').toLowerCase());
}

function activeOwnerCount(users = []) {
  return users.filter((user) => normalizeAccountRole(user.role) === 'owner' && !user.disabled).length;
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
      hideThumbnails: false,
      watchedUnreadOnly: false,
      watchedSort: 'unread'
    },
    notificationPreferences: {
      email: false,
      watchedThreads: true,
      boardSubscriptions: false,
      browserWatchedThreads: false
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
    if (ACCOUNT_WATCHED_SORTS.has(settings.displayPreferences.watchedSort)) {
      safe.displayPreferences.watchedSort = settings.displayPreferences.watchedSort;
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

function safeReplyTemplateBody(value = '') {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, MAX_ACCOUNT_REPLY_TEMPLATE_LENGTH);
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

function normalizeAccountContentFilters(value = []) {
  const seen = new Set();
  const allowedTypes = new Set(['keyword', 'poster', 'thread', 'post']);
  return normalizePrivateItems(value)
    .map((item) => {
      const type = safePrivateString(item.type, 40).toLowerCase();
      const value = safePrivateString(item.value || item.keyword || item.posterHash || item.id || item.key, 160);
      return {
        id: safePrivateString(item.id || item.key || crypto.randomUUID(), 120),
        type,
        value,
        label: safePrivateString(item.label, 180),
        boardSlug: safePrivateString(item.boardSlug, 80),
        createdAt: safePrivateString(item.createdAt, 80)
      };
    })
    .filter((item) => allowedTypes.has(item.type) && item.value)
    .filter((item) => {
      const key = `${item.type}:${item.boardSlug}:${item.value.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ACCOUNT_CONTENT_FILTERS);
}

function normalizeAccountReplyTemplates(value = []) {
  const seen = new Set();
  return normalizePrivateItems(value)
    .map((item) => {
      const body = safeReplyTemplateBody(item.body || item.text || item.value);
      return {
        id: safePrivateString(item.id || item.key || crypto.randomUUID(), 120),
        title: safePrivateString(item.title || item.label || body.split('\n')[0], 120),
        body,
        boardSlug: safePrivateString(item.boardSlug, 80),
        createdAt: safePrivateString(item.createdAt, 80),
        updatedAt: safePrivateString(item.updatedAt || item.createdAt, 80)
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
    .slice(0, MAX_ACCOUNT_REPLY_TEMPLATES);
}

function normalizeAccountPosterNotes(value = []) {
  const seen = new Set();
  return normalizePrivateItems(value)
    .map((item) => {
      const posterId = safePrivateString(item.posterId || item.poster || item.value || item.key, 80);
      return {
        id: safePrivateString(item.id || item.key || crypto.randomUUID(), 120),
        posterId,
        boardSlug: safePrivateString(item.boardSlug, 80),
        label: safePrivateString(item.label || item.title, 120),
        note: safePrivateString(item.note || item.body || item.text, 500),
        createdAt: safePrivateString(item.createdAt, 80),
        updatedAt: safePrivateString(item.updatedAt || item.createdAt, 80)
      };
    })
    .filter((item) => item.posterId && (item.label || item.note))
    .filter((item) => {
      const key = `${item.boardSlug}:${item.posterId.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ACCOUNT_POSTER_NOTES);
}

function defaultAccountPrivateData() {
  return {
    watchlist: [],
    drafts: [],
    savedSearches: [],
    contentFilters: [],
    replyTemplates: [],
    posterNotes: []
  };
}

function normalizeAccountPrivateData(value = {}, current = defaultAccountPrivateData()) {
  const input = value && typeof value === 'object' ? value : {};
  const previous = current && typeof current === 'object' ? current : defaultAccountPrivateData();
  const safe = {
    watchlist: normalizeAccountWatchlist(previous.watchlist),
    drafts: normalizeAccountDrafts(previous.drafts),
    savedSearches: normalizeAccountSavedSearches(previous.savedSearches),
    contentFilters: normalizeAccountContentFilters(previous.contentFilters),
    replyTemplates: normalizeAccountReplyTemplates(previous.replyTemplates),
    posterNotes: normalizeAccountPosterNotes(previous.posterNotes)
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
  if (Object.hasOwn(input, 'contentFilters')) {
    safe.contentFilters = normalizeAccountContentFilters(input.contentFilters);
  }
  if (Object.hasOwn(input, 'replyTemplates')) {
    safe.replyTemplates = normalizeAccountReplyTemplates(input.replyTemplates);
  }
  if (Object.hasOwn(input, 'posterNotes')) {
    safe.posterNotes = normalizeAccountPosterNotes(input.posterNotes);
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
    role: normalizeAccountRole(user.role),
    disabled: Boolean(user.disabled),
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    hasRecoveryCode: Boolean(user.recoveryCodeHash),
    settings: normalizeAccountSettings(state, {}, user.settings),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function serializePrivilegedAccount(state, user = {}) {
  const account = serializeAccount(state, user);
  return {
    id: account.id,
    username: account.username,
    role: account.role,
    disabled: account.disabled,
    twoFactorEnabled: account.twoFactorEnabled,
    hasRecoveryCode: account.hasRecoveryCode,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
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

function publicReactions(post) {
  const existing = post?.reactions && typeof post.reactions === 'object' ? post.reactions : {};
  return Object.fromEntries([...POST_REACTION_TYPES].map((type) => [type, Math.max(0, Number(existing[type]) || 0)]));
}

function rollDie(randomInt, sides) {
  const value = Number(randomInt(1, sides + 1));
  if (Number.isInteger(value) && value >= 1 && value <= sides) {
    return value;
  }
  return crypto.randomInt(1, sides + 1);
}

function normalizeDiceModifier(sign, value) {
  const modifier = Math.min(Number(value) || 0, MAX_DICE_MODIFIER);
  return sign === '-' ? -modifier : modifier;
}

function diceExpression({ dice, sides, modifier }) {
  const suffix = modifier > 0 ? `+${modifier}` : modifier < 0 ? String(modifier) : '';
  return `${dice}d${sides}${suffix}`;
}

function createDiceRoll({ dice, sides, modifier }, randomInt, id) {
  const rolls = Array.from({ length: dice }, () => rollDie(randomInt, sides));
  return {
    id: String(id),
    expression: diceExpression({ dice, sides, modifier }),
    dice,
    sides,
    modifier,
    rolls,
    total: rolls.reduce((sum, value) => sum + value, modifier)
  };
}

function parseDiceMatches(body, pattern, randomInt, rolls) {
  for (const match of String(body).matchAll(pattern)) {
    if (rolls.length >= MAX_DICE_ROLLS_PER_POST) {
      break;
    }
    const dice = Number(match.groups?.dice);
    const sides = Number(match.groups?.sides);
    if (!Number.isInteger(dice) || !Number.isInteger(sides) || dice < 1 || dice > MAX_DICE_COUNT || sides < 2 || sides > MAX_DICE_SIDES) {
      continue;
    }
    rolls.push(
      createDiceRoll(
        {
          dice,
          sides,
          modifier: normalizeDiceModifier(match.groups?.sign, match.groups?.modifier)
        },
        randomInt,
        rolls.length + 1
      )
    );
  }
}

function createDiceRolls(body, randomInt) {
  const rolls = [];
  parseDiceMatches(
    body,
    /(?:^|\s)(?:#dice|\/roll)\s+(?<dice>\d{1,2})d(?<sides>\d{1,4})(?:\s*(?<sign>[+-])\s*(?<modifier>\d{1,4}))?/gi,
    randomInt,
    rolls
  );
  parseDiceMatches(
    body,
    /\[dice\]\s*(?<dice>\d{1,2})d(?<sides>\d{1,4})(?:\s*(?<sign>[+-])\s*(?<modifier>\d{1,4}))?\s*\[\/dice\]/gi,
    randomInt,
    rolls
  );
  return rolls;
}

function normalizeReactionType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (POST_REACTION_TYPES.has(type)) {
    return type;
  }
  const error = new Error('Reaction không hợp lệ');
  error.statusCode = 400;
  throw error;
}

const COMMENT_SORTS = new Set(['best', 'top', 'new', 'controversial', 'old']);

function normalizeCommentSort(value) {
  const sort = String(value || '').toLowerCase();
  return COMMENT_SORTS.has(sort) ? sort : 'old';
}

function normalizeReportCategory(value) {
  const normalized = String(value || '').trim();
  return REPORT_CATEGORIES.has(normalized) ? normalized : 'Other';
}

function openReportCountsByGlobalNumber(reports = []) {
  const counts = new Map();
  for (const report of reports) {
    if (report.status && report.status !== 'open') {
      continue;
    }
    const key = Number(report.globalNumber);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function recencyPriority(createdAt, referenceDate) {
  const createdMs = new Date(createdAt).getTime();
  const referenceMs = referenceDate instanceof Date ? referenceDate.getTime() : new Date(referenceDate).getTime();
  if (!Number.isFinite(createdMs) || !Number.isFinite(referenceMs)) {
    return 0;
  }
  const ageHours = Math.max(0, (referenceMs - createdMs) / (60 * 60 * 1000));
  if (ageHours <= 1) return 20;
  if (ageHours <= 24) return 14;
  if (ageHours <= 72) return 8;
  if (ageHours <= 168) return 3;
  return 0;
}

function moderationPriorityLevel(score) {
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

function moderationPriorityDetails({ createdAt, labels = [], moderationStatus = '', category = '', reportCount = 0 }, referenceDate) {
  const normalizedLabels = labels.filter(Boolean);
  let labelScore = 0;
  if (normalizedLabels.some((label) => PII_PRIORITY_LABELS.has(label)) || HIGH_RISK_REPORT_CATEGORIES.has(category)) {
    labelScore = 50;
  } else if (normalizedLabels.some((label) => label === 'Hate Speech' || label === 'Toxic') || category === 'Toxic') {
    labelScore = 25;
  } else if (normalizedLabels.some((label) => label === 'Spam' || label === 'Fake News') || category === 'Spam' || category === 'Fake News') {
    labelScore = 15;
  } else if (moderationStatus === 'Flagged') {
    labelScore = 10;
  }

  const cappedReportCount = Math.min(5, Math.max(0, Number(reportCount) || 0));
  const reportScore = cappedReportCount <= 1 ? cappedReportCount * 10 : cappedReportCount * 20;
  const score = reportScore + labelScore + recencyPriority(createdAt, referenceDate);
  return {
    score,
    level: moderationPriorityLevel(score),
    reportCount: Math.max(0, Number(reportCount) || 0),
    hasPiiRisk: normalizedLabels.some((label) => PII_PRIORITY_LABELS.has(label)) || category === 'PII'
  };
}

function normalizePriorityFilters(filters = {}) {
  const priority = String(filters.priority || '').toLowerCase();
  const sort = String(filters.sort || '').toLowerCase();
  return {
    priority: PRIORITY_FILTERS.has(priority) ? priority : '',
    sort: PRIORITY_SORTS.has(sort) ? sort : 'priority'
  };
}

function matchesPriorityFilter(item, filters = {}) {
  const { priority } = normalizePriorityFilters(filters);
  return !priority || item.moderationPriority?.level === priority;
}

function compareAdminPriority(filters = {}) {
  const { sort } = normalizePriorityFilters(filters);
  return (left, right) => {
    if (sort === 'confidence-desc' || sort === 'confidence-asc') {
      const leftConfidence = Number(left.moderationConfidence);
      const rightConfidence = Number(right.moderationConfidence);
      const leftHasConfidence = Number.isFinite(leftConfidence);
      const rightHasConfidence = Number.isFinite(rightConfidence);
      if (leftHasConfidence !== rightHasConfidence) {
        return leftHasConfidence ? -1 : 1;
      }
      if (leftHasConfidence && rightHasConfidence) {
        const confidenceCompare =
          sort === 'confidence-desc' ? rightConfidence - leftConfidence : leftConfidence - rightConfidence;
        if (confidenceCompare !== 0) {
          return confidenceCompare;
        }
      }
      return String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
    }
    if (sort === 'newest') {
      return String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
    }
    if (sort === 'oldest') {
      return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''));
    }
    const priorityCompare = (right.moderationPriority?.score ?? 0) - (left.moderationPriority?.score ?? 0);
    if (priorityCompare !== 0) {
      return priorityCompare;
    }
    return String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
  };
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

function supportedMediaType(type) {
  if (UNSAFE_IMAGE_TYPES.has(type)) {
    return false;
  }
  return type.startsWith('image/') || SUPPORTED_VIDEO_TYPES.has(type);
}

function assertPostBodySize(value) {
  if (String(value ?? '').length <= 5000) {
    return;
  }
  const error = new Error('Dữ liệu gửi lên quá lớn');
  error.statusCode = 413;
  throw error;
}

function validateMedia(media) {
  if (!media) {
    return null;
  }

  const type = String(media.type ?? '').toLowerCase();
  if (!supportedMediaType(type)) {
    const error = new Error('Chỉ hỗ trợ tải ảnh hoặc video lên');
    error.statusCode = 415;
    throw error;
  }

  const dataUrl = media.dataUrl ?? '';
  const dataPrefix = type.startsWith('video/') ? 'data:video/' : 'data:image/';
  if (!dataUrl.startsWith(dataPrefix)) {
    const error = new Error('Dữ liệu tệp không hợp lệ');
    error.statusCode = 400;
    throw error;
  }

  const maxBytes = readPositiveInteger(process.env.MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES);
  if (Buffer.byteLength(dataUrl) > maxBytes) {
    const error = new Error(type.startsWith('image/') ? 'Ảnh quá lớn' : 'Video quá lớn');
    error.statusCode = 413;
    throw error;
  }

  const safeMedia = {
    name: sanitizeFileName(media.name),
    type,
    dataUrl,
    spoiler: Boolean(media.spoiler),
    sizeBytes: sanitizePositiveInteger(media.sizeBytes, maxBytes) ?? dataUrlBytes(dataUrl)
  };

  const width = sanitizePositiveInteger(media.width, 20_000);
  const height = sanitizePositiveInteger(media.height, 20_000);
  if (width) {
    safeMedia.width = width;
  }
  if (height) {
    safeMedia.height = height;
  }

  const thumbnail = validateImageThumbnail(media.thumbnail);
  if (thumbnail) {
    safeMedia.thumbnail = thumbnail;
  }

  return safeMedia;
}

function validateMediaList({ image, images } = {}) {
  const rawItems = Array.isArray(images) ? images : image ? [image] : [];
  if (rawItems.length > MAX_MEDIA_PER_POST) {
    const error = new Error(`Tối đa ${MAX_MEDIA_PER_POST} tệp mỗi bài viết`);
    error.statusCode = 400;
    throw error;
  }
  return rawItems.map((item) => validateMedia(item)).filter(Boolean);
}

function imageMediaForAi(media) {
  if (!media?.type?.startsWith('image/') || !media.dataUrl) {
    return null;
  }
  return {
    data: media.dataUrl,
    mimeType: media.type
  };
}

function uniqueModerationLabels(results) {
  const labels = new Set();
  for (const result of results) {
    for (const label of result?.labels ?? []) {
      const safeLabel = String(label ?? '').trim();
      if (safeLabel) {
        labels.add(safeLabel);
      }
    }
  }
  return [...labels];
}

function mergeModerationResults(...results) {
  const confidences = results
    .map((result) => Number(result?.confidence))
    .filter((confidence) => Number.isFinite(confidence));
  const merged = {
    status: results.some((result) => result?.status === 'Flagged') ? 'Flagged' : 'Safe',
    labels: uniqueModerationLabels(results)
  };
  return confidences.length ? { ...merged, confidence: Math.max(...confidences) } : merged;
}

async function moderateOcrText(ai, text) {
  const ocrText = String(text ?? '').trim();
  if (!ocrText || typeof ai.moderate !== 'function') {
    return { status: 'Safe', labels: [] };
  }

  const redactedText = redactSensitiveText(ocrText);
  const localPrivacyResult =
    redactedText === ocrText ? { status: 'Safe', labels: [] } : { status: 'Flagged', labels: ['PII Risk'] };
  const aiResult = await ai.moderate(redactedText);
  return mergeModerationResults(localPrivacyResult, aiResult);
}

async function scanImageForModeration(ai, media) {
  const image = imageMediaForAi(media);
  if (!image) {
    return { status: 'Safe', labels: [] };
  }

  const results = [];
  if (typeof ai.moderateImage === 'function') {
    try {
      results.push(await ai.moderateImage(image));
    } catch {
      // Image AI is optional for upload moderation; text moderation still runs.
    }
  }

  if (typeof ai.caption === 'function') {
    try {
      results.push(await moderateOcrText(ai, await ai.caption(image, 'ocr')));
    } catch {
      // Missing vision/OCR support must not block otherwise valid uploads.
    }
  }

  return mergeModerationResults(...results);
}

async function scanUploadsForModeration(ai, safeMedia) {
  const results = [];
  for (const media of safeMedia) {
    results.push(await scanImageForModeration(ai, media));
  }
  return mergeModerationResults(...results);
}

function validateImageThumbnail(thumbnail) {
  if (!thumbnail) {
    return null;
  }

  const type = String(thumbnail.type ?? '').toLowerCase();
  if (!type.startsWith('image/') || UNSAFE_IMAGE_TYPES.has(type)) {
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
function applyMediaSpoiler(storedMedia, safeMedia) {
  if (!storedMedia) {
    return storedMedia;
  }
  return { ...storedMedia, spoiler: Boolean(safeMedia?.spoiler) };
}

function applyMediaSpoilers(storedMedia, safeMedia) {
  return storedMedia.map((item, index) => applyMediaSpoiler(item, safeMedia[index]));
}

async function saveMediaList(imageStorage, safeMedia) {
  const stored = [];
  for (const media of safeMedia) {
    stored.push(await imageStorage.save(media));
  }
  return applyMediaSpoilers(stored.filter(Boolean), safeMedia);
}

function serializeThread(thread, comments) {
  const publicComments = comments.filter((comment) => comment.threadId === thread.id && publicPost(comment));
  const orderedComments = [...publicComments].sort((left, right) => {
    const createdCompare = String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''));
    if (createdCompare !== 0) {
      return createdCompare;
    }
    return Number(left.globalNumber || 0) - Number(right.globalNumber || 0);
  });
  const previewComments = orderedComments.slice(-THREAD_PREVIEW_REPLY_LIMIT);
  const omittedComments = orderedComments.slice(0, Math.max(0, orderedComments.length - previewComments.length));
  const images = mediaItems(thread);
  return {
    ...stripPrivatePostFields(thread),
    image: images[0] ?? null,
    images,
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
    reactions: publicReactions(thread),
    diceRolls: Array.isArray(thread.diceRolls) ? thread.diceRolls : [],
    replyCount: publicComments.length,
    previewComments: previewComments.map((comment) => serializeComment(comment, thread)),
    omittedReplyCount: omittedComments.length,
    omittedImageCount: omittedComments.reduce((total, comment) => total + mediaItems(comment).length, 0)
  };
}

function serializeComment(comment, thread = null) {
  const images = mediaItems(comment);
  return {
    ...stripPrivatePostFields(comment),
    image: images[0] ?? null,
    images,
    displayName: publicDisplayName(comment.displayName),
    tripcode: comment.tripcode ?? null,
    capcode: normalizeCapcode(comment.capcode),
    isOp: Boolean(thread?.opProofHash && comment.opProofHash && thread.opProofHash === comment.opProofHash),
    bodyLines: parsePostText(comment.body),
    votes: publicVotes(comment),
    reactions: publicReactions(comment),
    diceRolls: Array.isArray(comment.diceRolls) ? comment.diceRolls : []
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

function compareBoardThreadsBySort(sort, state) {
  if (sort === 'created') {
    return (left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      if (stickyCompare !== 0) return stickyCompare;
      const createdCompare = String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
      if (createdCompare !== 0) return createdCompare;
      return Number(right.globalNumber) - Number(left.globalNumber);
    };
  }
  if (sort === 'replies') {
    return (left, right) => {
      const stickyCompare = Number(Boolean(right.isSticky)) - Number(Boolean(left.isSticky));
      if (stickyCompare !== 0) return stickyCompare;
      const replyCompare = publicReplyCount(state, right.id) - publicReplyCount(state, left.id);
      if (replyCompare !== 0) return replyCompare;
      return compareBoardThreads(left, right);
    };
  }
  return compareBoardThreads;
}

function normalizeBoardThreadSort(value) {
  const sort = String(value || '').trim().toLowerCase();
  return ['created', 'replies'].includes(sort) ? sort : 'bump';
}

function normalizeBoardThreadFilter(value) {
  const filter = String(value || '').trim().toLowerCase();
  return ['media', 'video', 'poll', 'unanswered'].includes(filter) ? filter : 'all';
}

function postHasVideo(post = {}) {
  return mediaItems(post).some((item) => String(item.type || '').startsWith('video/'));
}

function threadHasPublicMedia(state, thread) {
  return (
    mediaItems(thread).length > 0 ||
    state.comments.some((comment) => comment.threadId === thread.id && publicPost(comment) && mediaItems(comment).length > 0)
  );
}

function threadHasPublicVideo(state, thread) {
  return (
    postHasVideo(thread) ||
    state.comments.some((comment) => comment.threadId === thread.id && publicPost(comment) && postHasVideo(comment))
  );
}

function threadMatchesBoardFilter(state, thread, filter) {
  const normalizedFilter = normalizeBoardThreadFilter(filter);
  if (normalizedFilter === 'media') return threadHasPublicMedia(state, thread);
  if (normalizedFilter === 'video') return threadHasPublicVideo(state, thread);
  if (normalizedFilter === 'poll') return Boolean(thread.poll?.options?.length);
  if (normalizedFilter === 'unanswered') return publicReplyCount(state, thread.id) === 0;
  return true;
}

function dateValue(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function hoursBetween(laterMs, earlierMs) {
  if (!laterMs || !earlierMs) {
    return 0;
  }
  return Math.max(0, (laterMs - earlierMs) / (60 * 60 * 1000));
}

function rounded(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function recommendedThreadCandidateSources(state, oldestActivityMs) {
  const candidates = new Map();
  const addCandidate = (thread, source) => {
    if (!publicThread(state, thread) || !activePublicThread(thread)) {
      return;
    }
    if (dateValue(thread.bumpedAt || thread.createdAt) < oldestActivityMs) {
      return;
    }
    const candidate = candidates.get(thread.id) ?? { thread, sources: new Set() };
    candidate.sources.add(source);
    candidates.set(thread.id, candidate);
  };

  for (const thread of state.threads) {
    addCandidate(thread, thread.isSticky ? 'sticky' : 'recent-activity');
  }

  for (const thread of state.threads) {
    if (publicReplyCount(state, thread.id) > 0 || publicVotes(thread).score > 0 || mediaItems(thread).length > 0) {
      addCandidate(thread, 'engagement');
    }
  }

  return [...candidates.values()].map((candidate) => ({
    thread: candidate.thread,
    sources: [...candidate.sources].sort()
  }));
}

function recommendedModerationRisk(thread) {
  const labels = thread.moderationLabels ?? [];
  const highRiskCount = labels.filter((label) => RECOMMENDED_THREAD_HIGH_RISK_LABELS.has(label)).length;
  const mediumRiskCount = labels.filter((label) => RECOMMENDED_THREAD_MEDIUM_RISK_LABELS.has(label)).length;
  const statusRisk = thread.moderationStatus && thread.moderationStatus !== 'Safe' ? 1 : 0;
  const confidence = Number(thread.moderationConfidence);
  const confidenceRisk = Number.isFinite(confidence) && confidence >= 0.8 ? 1 : 0;
  return Math.min(5, highRiskCount * 2 + mediumRiskCount + statusRisk + confidenceRisk);
}

function recommendedThreadFeatures(state, thread, referenceDate, context = {}) {
  const referenceMs = referenceDate.getTime();
  const createdMs = dateValue(thread.createdAt);
  const lastActivityAt = thread.bumpedAt || thread.createdAt;
  const lastActivityMs = dateValue(lastActivityAt);
  const oneDayAgoMs = referenceMs - 24 * 60 * 60 * 1000;
  const replies = state.comments.filter((comment) => comment.threadId === thread.id && publicPost(comment));
  const recentReplyCount = replies.filter((comment) => dateValue(comment.createdAt) >= oneDayAgoMs).length;
  const votes = publicVotes(thread);
  const openReportCount = context.reportCounts?.get(Number(thread.globalNumber)) ?? 0;
  return {
    sources: context.sources ?? [],
    activityAgeHours: hoursBetween(referenceMs, lastActivityMs || createdMs),
    threadAgeHours: hoursBetween(referenceMs, createdMs),
    replyCount: replies.length,
    recentReplyCount,
    mediaCount: mediaItems(thread).length,
    voteScore: votes.score,
    upVotes: votes.up,
    downVotes: votes.down,
    openReportCount,
    moderationRisk: recommendedModerationRisk(thread),
    isSticky: Boolean(thread.isSticky)
  };
}

function recommendedThreadReasons(features) {
  const reasons = [];
  if (features.activityAgeHours <= 6) {
    reasons.push('recent-activity');
  }
  if (features.recentReplyCount >= 2) {
    reasons.push('active-discussion');
  }
  if (features.mediaCount > 0) {
    reasons.push('has-media');
  }
  if (features.voteScore > 0) {
    reasons.push('positive-votes');
  }
  if (features.isSticky) {
    reasons.push('sticky');
  }
  if (features.openReportCount > 0 || features.moderationRisk > 0 || features.downVotes > 0) {
    reasons.push('safety-penalty');
  }
  return reasons;
}

function scoreRecommendedThread(features) {
  const recencyScore = Math.exp(-features.activityAgeHours / 18) * 40;
  const replyScore = Math.log1p(features.replyCount) * 8;
  const recentReplyScore = Math.log1p(features.recentReplyCount) * 14;
  const mediaScore = Math.min(features.mediaCount, 4) * 2;
  const positiveVoteScore = Math.max(0, features.voteScore) * 3;
  const negativeVotePenalty = Math.max(0, -features.voteScore) * 4;
  const downVotePenalty = Math.min(features.downVotes, 10) * 2;
  const reportPenalty = Math.min(features.openReportCount, 5) * 10;
  const moderationPenalty = Math.min(features.moderationRisk, 5) * 6;
  const stickyScore = features.isSticky ? 8 : 0;
  return rounded(
    recencyScore +
      replyScore +
      recentReplyScore +
      mediaScore +
      positiveVoteScore +
      stickyScore -
      negativeVotePenalty -
      downVotePenalty -
      reportPenalty -
      moderationPenalty
  );
}

function compareRecommendedThreads(left, right) {
  const scoreCompare = Number(right.recommendation?.score || 0) - Number(left.recommendation?.score || 0);
  if (scoreCompare !== 0) {
    return scoreCompare;
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

function sanitizeAppealReason(reason) {
  return normalizeBody(reason ?? '').slice(0, 2000);
}

function normalizeAppealToken(token = '') {
  return String(token ?? '').trim().slice(0, 160);
}

function createAppealToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function appealTokenHash(token) {
  return crypto.createHash('sha256').update(normalizeAppealToken(token)).digest('hex');
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
  const entry = {
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
    ...(Number.isFinite(Number(post.moderationConfidence)) ? { moderationConfidence: Number(post.moderationConfidence) } : {}),
    createdAt
  };
  state.moderationActions.push(entry);
  return entry;
}

function issueAppealToken(state, { postType, post, createdAt }) {
  let token = createAppealToken();
  let tokenHash = appealTokenHash(token);
  while (state.appeals.some((appeal) => appeal.tokenHash === tokenHash)) {
    token = createAppealToken();
    tokenHash = appealTokenHash(token);
  }
  const appeal = {
    id: crypto.randomUUID(),
    tokenHash,
    postType,
    postId: post.id,
    threadId: postType === 'thread' ? post.id : post.threadId,
    boardSlug: post.boardSlug,
    globalNumber: post.globalNumber,
    status: 'issued',
    createdAt,
    history: [
      {
        action: 'issued',
        actor: 'system',
        createdAt
      }
    ]
  };
  state.appeals.push(appeal);
  return { token, appeal };
}

function findPublicPostByGlobalNumber(state, globalNumber) {
  const number = Number(globalNumber);
  const thread = state.threads.find((item) => item.globalNumber === number && publicThread(state, item));
  if (thread) {
    return { postType: 'thread', post: thread };
  }

  const comment = state.comments.find((item) => item.globalNumber === number && publicComment(state, item));
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

  const hasConfidenceFilter = filters.confidence !== undefined && filters.confidence !== null && String(filters.confidence).trim() !== '';
  const confidenceFilter = Number(filters.confidence);
  if (hasConfidenceFilter && Number.isFinite(confidenceFilter)) {
    const minimumConfidence = Math.min(1, Math.max(0, confidenceFilter > 1 ? confidenceFilter / 100 : confidenceFilter));
    const itemConfidence = Number(item.moderationConfidence);
    if (!Number.isFinite(itemConfidence) || itemConfidence < minimumConfidence) {
      return false;
    }
  }

  return true;
}

function serializeAdminPost(postType, post, state, priorityContext = {}) {
  const parent = postType === 'comment' ? state.threads.find((thread) => thread.id === post.threadId) : null;
  return {
    type: postType,
    ...(postType === 'thread' ? serializeThread(post, state.comments) : serializeComment(post, parent)),
    moderationPriority: moderationPriorityDetails(
      {
        createdAt: post.createdAt,
        labels: post.moderationLabels ?? [],
        moderationStatus: post.moderationStatus,
        reportCount: priorityContext.reportCounts?.get(Number(post.globalNumber)) ?? 0
      },
      priorityContext.referenceDate ?? new Date()
    )
  };
}

function serializeEditHistory(post) {
  if (!Array.isArray(post?.editHistory)) {
    return [];
  }
  return [...post.editHistory]
    .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
    .map((entry) => {
      const previousBody = String(entry.previousBody ?? '');
      const newBody = String(entry.newBody ?? entry.body ?? '');
      return {
        id: entry.id,
        actor: entry.actor ?? 'admin',
        reason: entry.reason ?? '',
        createdAt: entry.createdAt,
        previousBody,
        newBody,
        previousImages: Array.isArray(entry.previousImages) ? entry.previousImages.filter(Boolean) : [],
        newImages: Array.isArray(entry.newImages) ? entry.newImages.filter(Boolean) : [],
        previousBodyLines: parsePostText(previousBody),
        newBodyLines: parsePostText(newBody)
      };
    });
}

function appendEditHistory(post, { actor, reason, previousBody, newBody, previousImages, newImages, createdAt }) {
  post.editHistory = Array.isArray(post.editHistory) ? post.editHistory : [];
  post.editHistory.push({
    id: crypto.randomUUID(),
    actor: String(actor || 'user').slice(0, 80),
    reason: sanitizeReason(reason),
    previousBody: String(previousBody ?? ''),
    newBody: String(newBody ?? ''),
    previousImages: Array.isArray(previousImages) ? previousImages : [],
    newImages: Array.isArray(newImages) ? newImages : [],
    createdAt
  });
  if (post.editHistory.length > MAX_EDIT_HISTORY_ENTRIES) {
    post.editHistory = post.editHistory.slice(-MAX_EDIT_HISTORY_ENTRIES);
  }
}

function serializeAppeal(appeal, state) {
  const found = findAnyPostByGlobalNumber(state, appeal.globalNumber);
  const post = found ? serializeAdminPost(found.postType, found.post, state) : null;
  return {
    id: appeal.id,
    status: appeal.status,
    postType: appeal.postType,
    postId: appeal.postId,
    threadId: appeal.threadId,
    boardSlug: appeal.boardSlug,
    globalNumber: appeal.globalNumber,
    reason: appeal.reason ?? '',
    resolutionReason: appeal.resolutionReason ?? '',
    resolvedBy: appeal.resolvedBy ?? null,
    createdAt: appeal.createdAt,
    submittedAt: appeal.submittedAt ?? null,
    resolvedAt: appeal.resolvedAt ?? null,
    reporterHashPreview: appeal.reporterHash ? fingerprintPreview(appeal.reporterHash) : null,
    history: Array.isArray(appeal.history)
      ? appeal.history.map((entry) => ({
          action: entry.action,
          actor: entry.actor,
          reason: entry.reason ?? '',
          createdAt: entry.createdAt
        }))
      : [],
    post
  };
}

function shouldQueueModeration(moderation, threshold) {
  if (moderation.status !== 'Flagged') {
    return false;
  }
  const confidence = Number(moderation.confidence);
  return !Number.isFinite(confidence) || confidence >= threshold;
}

function moderationSettingsForState(state, fallbackThreshold) {
  return {
    moderationConfidenceThreshold: readModerationConfidenceThreshold(
      state.adminSettings?.moderationConfidenceThreshold ?? fallbackThreshold
    )
  };
}

function serializeAdminReport(report, state, priorityContext = {}) {
  const found = findAnyPostByGlobalNumber(state, report.globalNumber);
  const post = found?.post;
  return {
    ...report,
    moderationPriority: moderationPriorityDetails(
      {
        createdAt: report.createdAt,
        labels: post?.moderationLabels ?? [],
        moderationStatus: post?.moderationStatus ?? '',
        category: report.category,
        reportCount: priorityContext.reportCounts?.get(Number(report.globalNumber)) ?? 0
      },
      priorityContext.referenceDate ?? new Date()
    )
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
    duplicateCheck: 40,
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
    appeals: state.appeals.length,
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
  webauthn = defaultWebAuthn,
  moderationConfidenceThreshold = readModerationConfidenceThreshold(),
  randomInt = crypto.randomInt
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
  function mutate(callback, { write = null } = {}) {
    const run = mutateQueue.then(async () => {
      const state = await store.read();
      const result = await callback(state);
      if (write) {
        await write(state, result);
      } else {
        await store.write(state);
      }
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
    const board = findBoard(state, boardSlug);
    const retentionPolicy = boardRetentionPolicy(board, lifecycle);
    const archivedThreads = [];
    const activeThreads = state.threads
      .filter((thread) => thread.boardSlug === boardSlug && activePublicThread(thread))
      .sort((left, right) => left.bumpedAt.localeCompare(right.bumpedAt));

    while (activeThreads.length > retentionPolicy.maxActiveThreadsPerBoard) {
      const thread = activeThreads.shift();
      archiveThreadRecord(thread, 'board-limit', archivedAt);
      archivedThreads.push(thread);
      realtime.publish('thread:archived', { thread: serializeThread(thread, state.comments) });
    }
    return archivedThreads;
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

  function restoreDeletedPostRecord(state, found, { reason = '', actor = 'admin', restoredAt = now().toISOString(), action = 'admin:restore' } = {}) {
    const safeReason = sanitizeReason(reason);
    found.post.isDeleted = false;
    found.post.restoredAt = restoredAt;
    found.post.restoredBy = actor;
    found.post.restoreReason = safeReason;
    found.post.deletedAt = null;
    found.post.deleteReason = null;
    recordModerationAction(state, {
      action,
      actor,
      postType: found.postType,
      post: found.post,
      reason: safeReason || (action === 'admin:appeal-restore' ? 'appeal-restore' : 'admin-restore'),
      createdAt: restoredAt
    });
    logEvent(action === 'admin:appeal-restore' ? 'appeal.restore' : 'moderation.restore', {
      postType: found.postType,
      boardSlug: found.post.boardSlug,
      globalNumber: found.post.globalNumber,
      actor
    });

    if (found.postType === 'thread') {
      if (!found.post.isPending && publicThread(state, found.post)) {
        realtime.publish('thread:created', { thread: serializeThread(found.post, state.comments) });
      }
    } else {
      const parent = state.threads.find((thread) => thread.id === found.post.threadId);
      if (!found.post.isPending && parent && publicThread(state, parent)) {
        realtime.publish('thread:updated', { thread: serializeThread(parent, state.comments) });
        realtime.publish('comment:created', { threadId: parent.id, comment: serializeComment(found.post, parent) });
      }
    }

    return {
      ok: true,
      globalNumber: found.post.globalNumber,
      post: serializeAdminPost(found.postType, found.post, state)
    };
  }

  return {
    async listBoards() {
      const state = await store.read();
      return state.boards.filter(publicBoard).map((board) => serializeBoard(board, { retentionDefaults: lifecycle }));
    },

    async listAdminBoards() {
      const state = await store.read();
      return state.boards.map((board) => serializeBoard(board, { admin: true, retentionDefaults: lifecycle }));
    },

    async getStats() {
      const state = await store.read();
      const publicThreads = state.threads.filter((thread) => publicThread(state, thread));
      const publicComments = state.comments.filter((comment) => publicComment(state, comment));
      const publicPosts = [...publicThreads, ...publicComments];
      const activeBoards = new Set(publicThreads.map((thread) => thread.boardSlug));
      const publicBoards = state.boards.filter(publicBoard);
      const files = publicPosts.flatMap((post) => mediaItems(post));
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

    async getModerationSettings() {
      const state = await store.read();
      return moderationSettingsForState(state, moderationConfidenceThreshold);
    },

    async updateModerationSettings(settings = {}, { actor = 'admin' } = {}) {
      return mutate(async (state) => {
        const nextSettings = moderationSettingsForState(
          {
            adminSettings: {
              ...state.adminSettings,
              moderationConfidenceThreshold: settings.moderationConfidenceThreshold
            }
          },
          moderationConfidenceThreshold
        );
        state.adminSettings = {
          ...state.adminSettings,
          ...nextSettings
        };
        logEvent('admin.moderation-settings.update', {
          actor,
          moderationConfidenceThreshold: nextSettings.moderationConfidenceThreshold
        });
        return nextSettings;
      });
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
        ai: {
          ...aiConfigStatus(),
          moderationConfidenceThreshold
        },
        imageStorage: imageStorageHealth,
        realtime: realtime.metrics?.() ?? {
          clients: realtime.count?.() ?? 0,
          boards: realtime.boardCounts?.() ?? {}
        }
      };
    },

    async getAdminHealth() {
      const health = await this.getHealth();
      const moderationSettings = await this.getModerationSettings();
      const mem = process.memoryUsage();
      return {
        ...health,
        ai: {
          ...health.ai,
          ...moderationSettings
        },
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

      if (user.disabled) {
        const error = new Error('Tài khoản đã bị vô hiệu hóa');
        error.statusCode = 403;
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
      const allowedSections = new Set(['watchlist', 'drafts', 'savedSearches', 'contentFilters', 'replyTemplates', 'posterNotes']);
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
            role: 'owner',
            settings: defaultAccountSettings(),
            privateData: defaultAccountPrivateData(),
            disabled: false,
            createdAt,
            updatedAt: createdAt
          };
          state.users.push(admin);
        } else {
          admin.passwordHash = accountPasswordHash(password);
          admin.role = 'owner';
          admin.disabled = false;
          admin.privateData = normalizeAccountPrivateData(admin.privateData);
          admin.updatedAt = now().toISOString();
        }
        return serializeAccount(state, admin);
      });
    },

    async listPrivilegedUsers() {
      const state = await store.read();
      return state.users
        .filter(isPrivilegedAccount)
        .map((user) => serializePrivilegedAccount(state, user))
        .sort((left, right) => left.username.localeCompare(right.username));
    },

    async createPrivilegedUser({ username, password, role = 'viewer', disabled = false } = {}, { actor = 'admin' } = {}) {
      const safeUsername = assertAccountUsername(username);
      const safePassword = assertAccountPassword(password, { username: safeUsername });
      const safeRole = normalizeManagedPrivilegedRole(role);
      return mutate(async (state) => {
        const existing = state.users.find((user) => normalizeAccountUsername(user.username) === safeUsername);
        if (existing) {
          const error = new Error('Tên tài khoản đã tồn tại');
          error.statusCode = 409;
          throw error;
        }
        const createdAt = now().toISOString();
        const user = {
          id: crypto.randomUUID(),
          username: safeUsername,
          passwordHash: accountPasswordHash(safePassword),
          role: safeRole,
          settings: defaultAccountSettings(),
          privateData: defaultAccountPrivateData(),
          disabled: Boolean(disabled),
          createdAt,
          updatedAt: createdAt
        };
        state.users.push(user);
        logEvent('admin.user.create', { actor, username: safeUsername, role: safeRole, disabled: user.disabled });
        return serializePrivilegedAccount(state, user);
      });
    },

    async updatePrivilegedUser(userId, updates = {}, { actor = 'admin', actorId = '' } = {}) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user || !isPrivilegedAccount(user)) {
          const error = new Error('Không tìm thấy tài khoản quản trị');
          error.statusCode = 404;
          throw error;
        }

        const currentRole = normalizeAccountRole(user.role);
        const nextRole = updates.role === undefined ? currentRole : normalizeManagedPrivilegedRole(updates.role);
        const nextDisabled = updates.disabled === undefined ? Boolean(user.disabled) : Boolean(updates.disabled);
        if (user.id === actorId && (nextRole !== currentRole || nextDisabled)) {
          const error = new Error('Không thể hạ quyền hoặc vô hiệu hóa chính tài khoản đang dùng');
          error.statusCode = 409;
          throw error;
        }
        if (currentRole === 'owner' && !user.disabled && (nextRole !== 'owner' || nextDisabled) && activeOwnerCount(state.users) <= 1) {
          const error = new Error('Cần giữ lại ít nhất một owner đang hoạt động');
          error.statusCode = 409;
          throw error;
        }

        user.role = nextRole;
        user.disabled = nextDisabled;
        if (updates.password !== undefined && String(updates.password || '').trim()) {
          const safePassword = assertAccountPassword(updates.password, { username: user.username });
          user.passwordHash = accountPasswordHash(safePassword);
        }
        user.updatedAt = now().toISOString();
        logEvent('admin.user.update', { actor, username: user.username, role: user.role, disabled: user.disabled });
        return serializePrivilegedAccount(state, user);
      });
    },

    async disablePrivilegedUser(userId, { actor = 'admin', actorId = '' } = {}) {
      return this.updatePrivilegedUser(userId, { disabled: true }, { actor, actorId });
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
      const publicThreadIds = new Set(
        state.threads
          .filter((thread) => publicThread(state, thread) && !thread.isArchived)
          .map((thread) => thread.id)
      );
      const threads = state.threads
        .filter((thread) => publicThread(state, thread) && !thread.isArchived)
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

    async listRecommendedThreads(limit = 10, options = {}) {
      const state = await store.read();
      const referenceDate = now();
      const referenceMs = referenceDate.getTime();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 10, RECOMMENDED_THREAD_MAX_LIMIT));
      const maxAgeHours = Math.max(
        1,
        Math.min(Number(options.maxAgeHours) || RECOMMENDED_THREAD_WINDOW_HOURS, 30 * 24)
      );
      const oldestActivityMs = referenceMs - maxAgeHours * 60 * 60 * 1000;

      const reportCounts = openReportCountsByGlobalNumber(state.reports);

      return recommendedThreadCandidateSources(state, oldestActivityMs)
        .map(({ thread, sources }) => {
          const features = recommendedThreadFeatures(state, thread, referenceDate, { reportCounts, sources });
          return {
            ...serializeThread(thread, state.comments),
            recommendation: {
              sources,
              score: scoreRecommendedThread(features),
              reasons: recommendedThreadReasons(features),
              features: {
                sources: features.sources,
                activityAgeHours: rounded(features.activityAgeHours, 1),
                threadAgeHours: rounded(features.threadAgeHours, 1),
                replyCount: features.replyCount,
                recentReplyCount: features.recentReplyCount,
                mediaCount: features.mediaCount,
                voteScore: features.voteScore,
                upVotes: features.upVotes,
                downVotes: features.downVotes,
                openReportCount: features.openReportCount,
                moderationRisk: features.moderationRisk
              }
            }
          };
        })
        .sort(compareRecommendedThreads)
        .slice(0, safeLimit);
    },

    async listHotBoards(limit = 8) {
      const state = await store.read();
      const publicBoards = state.boards.filter(publicBoard);
      const safeLimit = Math.max(1, Math.min(Number(limit) || 8, publicBoards.length || 1));
      const oneDayAgo = now().getTime() - 24 * 60 * 60 * 1000;
      const inLast24h = (post) => new Date(post.createdAt).getTime() >= oneDayAgo;
      const activeThreadIds = new Set(
        state.threads
          .filter((thread) => publicThread(state, thread) && !thread.isArchived)
          .map((thread) => thread.id)
      );
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
        if (publicThread(state, thread) && !thread.isArchived && inLast24h(thread)) {
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
      const activeThreadIds = new Set(
        state.threads
          .filter((thread) => publicThread(state, thread) && !thread.isArchived)
          .map((thread) => thread.id)
      );
      const metrics = new Map();
      const publicPosts = [
        ...state.threads.filter((thread) => publicThread(state, thread) && !thread.isArchived && inLast24h(thread)),
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
      const priorityContext = {
        reportCounts: openReportCountsByGlobalNumber(state.reports),
        referenceDate: now()
      };
      return [...state.reports]
        .filter((report) => !filters.status || report.status === filters.status)
        .filter((report) => !filters.category || normalizeReportCategory(report.category) === filters.category)
        .filter((report) => matchesAdminFilters(report, filters, 'createdAt'))
        .map((report) => serializeAdminReport(report, state, priorityContext))
        .filter((report) => matchesPriorityFilter(report, filters))
        .sort(compareAdminPriority(filters))
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
      const sort = normalizeBoardThreadSort(options.sort);
      const filter = normalizeBoardThreadFilter(options.filter);
      const threads = state.threads
        .filter((thread) => thread.boardSlug === boardSlug && activePublicThread(thread))
        .filter((thread) => threadMatchesSearch(state, thread, term))
        .filter((thread) => threadMatchesBoardFilter(state, thread, filter))
        .sort(compareBoardThreadsBySort(sort, state))
        .map((thread) => serializeThread(thread, state.comments));
      if (options.paged) {
        return pagedResult(threads, { page: options.page, pageSize: options.pageSize, maxPageSize: 50 });
      }
      return threads;
    },

    async listArchivedThreads(boardSlug) {
      const state = await store.read();
      const board = findBoard(state, boardSlug);
      if (!board || board.isHidden || !boardRetentionPolicy(board, lifecycle).publicArchive) {
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
      subject = '',
      body,
      image,
      images,
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
      assertPostBodySize(body);
      const normalizedBody = normalizeBody(body);
      const normalizedSubject = normalizeThreadSubject(subject);
      if (!normalizedBody) {
        const error = new Error('Nội dung là bắt buộc');
        error.statusCode = 400;
        throw error;
      }
      const safeImages = validateMediaList({ image, images });
      const poll = createPoll(pollOptions);
      const postingOptions = parsePostingOptions(options);
      const diceRolls = createDiceRolls(normalizedBody, randomInt);
      const { displayName: normalizedDisplayName, tripcode } = parseDisplayNameWithTripcode(displayName);
      const createdAt = now().toISOString();
      assertEventBoardOpen(board, createdAt);
      const postCreateDelta = {
        thread: null,
        updatedThreads: [],
        moderationActions: [],
        appeals: []
      };

      return mutate(async (state) => {
        const authorFingerprint = enforceSanctions(state, { ip, posterToken, createdAt });
        const moderation = mergeModerationResults(
          await ai.moderate(normalizedBody),
          await scanUploadsForModeration(ai, safeImages)
        );
        const id = crypto.randomUUID();
        const storedImages = await saveMediaList(imageStorage, safeImages);
        const thread = {
          id,
          boardSlug,
          subject: normalizedSubject,
          body: normalizedBody,
          displayName: normalizedDisplayName,
          tripcode,
          capcode: normalizeCapcode(capcode),
          accountId,
          image: storedImages[0] ?? null,
          images: storedImages,
          poll,
          pollVotes: poll ? {} : undefined,
          diceRolls,
          authorFingerprint,
          globalNumber: nextNumber(state),
          posterHash: createPosterHash({ ip, threadId: id, salt: daySalt(new Date(createdAt)), posterToken }),
          opProofHash: createPosterProofHash({ threadId: id, posterToken }),
          deletePasswordHash: deletePasswordHash(deletePassword),
          options: postingOptions.raw,
          sage: postingOptions.sage,
          noko: postingOptions.noko,
          isPending: shouldQueueModeration(
            moderation,
            moderationSettingsForState(state, moderationConfidenceThreshold).moderationConfidenceThreshold
          ),
          isDeleted: false,
          moderationStatus: moderation.status,
          moderationLabels: moderation.labels ?? [],
          ...(Number.isFinite(Number(moderation.confidence)) ? { moderationConfidence: Number(moderation.confidence) } : {}),
          createdAt,
          bumpedAt: createdAt
        };
        state.threads.push(thread);
        postCreateDelta.thread = thread;
        postCreateDelta.moderationActions.push(recordModerationAction(state, {
          action: 'ai:moderate',
          actor: 'ai',
          postType: 'thread',
          post: thread,
          reason: moderation.labels?.join(', ') || moderation.status,
          createdAt
        }));
        logEvent('post.create', {
          postType: 'thread',
          boardSlug,
          globalNumber: thread.globalNumber,
          moderationStatus: thread.moderationStatus,
          moderationLabels: thread.moderationLabels,
          moderationConfidence: thread.moderationConfidence,
          isPending: thread.isPending
        });

        const issuedAppeal = issueAppealToken(state, { postType: 'thread', post: thread, createdAt });
        const appealToken = issuedAppeal.token;
        postCreateDelta.appeals.push(issuedAppeal.appeal);

        if (!thread.isPending) {
          postCreateDelta.updatedThreads.push(...enforceBoardThreadCap(state, boardSlug, createdAt));
          realtime.publish('thread:created', { thread: serializeThread(thread, state.comments) });
        }

        return {
          status: thread.isPending ? 'pending' : 'published',
          thread: serializeThread(thread, state.comments),
          appealToken
        };
      }, {
        write: async (state) => {
          if (typeof store.appendPostCreate !== 'function') {
            await store.write(state);
            return;
          }
          await store.appendPostCreate({
            state,
            thread: postCreateDelta.thread,
            updatedThreads: uniqueById(postCreateDelta.updatedThreads),
            moderationActions: postCreateDelta.moderationActions,
            appeals: postCreateDelta.appeals
          });
        }
      });
    },

    async getThread(threadId, options = {}) {
      const state = await store.read();
      const thread = state.threads.find((item) => item.id === threadId && publicThread(state, item));
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
      const commentsSearch = normalizeSearchTerm(options.commentsSearch || options.q);
      const searchedComments = commentsSearch
        ? chronologicalComments.filter((comment) => postMatchesSearch(comment, commentsSearch))
        : chronologicalComments;
      const commentsWithBacklinks = sortComments(searchedComments, commentsSort);
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
            sort: commentsSort,
            search: commentsSearch
          }
        };
      }
      return {
        thread: threadWithBacklinks,
        comments: commentsWithBacklinks,
        commentsSort,
        commentsSearch
      };
    },

    async createComment({
      threadId,
      body,
      image,
      images,
      captchaToken,
      ip,
      posterToken,
      displayName = '',
      options = '',
      deletePassword = '',
      capcode = null,
      accountId
    }) {
      await requireCaptcha(captchaToken, ip);
      assertPostBodySize(body);
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung là bắt buộc');
        error.statusCode = 400;
        throw error;
      }
      const safeImages = validateMediaList({ image, images });
      const createdAt = now().toISOString();
      const postingOptions = parsePostingOptions(options);
      const diceRolls = createDiceRolls(normalizedBody, randomInt);
      const { displayName: normalizedDisplayName, tripcode } = parseDisplayNameWithTripcode(displayName);
      const postCreateDelta = {
        comment: null,
        updatedThreads: [],
        moderationActions: [],
        appeals: []
      };

      return mutate(async (state) => {
        const authorFingerprint = enforceSanctions(state, { ip, posterToken, createdAt });
        const thread = state.threads.find((item) => item.id === threadId && publicThread(state, item) && !item.isArchived);
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

        const retentionPolicy = boardRetentionPolicy(findBoard(state, thread.boardSlug), lifecycle);
        const repliesBeforeCreate = publicReplyCount(state, threadId);
        if (repliesBeforeCreate >= retentionPolicy.replyLimit) {
          const error = new Error('Chủ đề đã đạt giới hạn phản hồi');
          error.statusCode = 409;
          throw error;
        }
        const moderation = mergeModerationResults(
          await ai.moderate(normalizedBody),
          await scanUploadsForModeration(ai, safeImages)
        );
        const storedImages = await saveMediaList(imageStorage, safeImages);

        const comment = {
          id: crypto.randomUUID(),
          threadId,
          boardSlug: thread.boardSlug,
          body: normalizedBody,
          displayName: normalizedDisplayName,
          tripcode,
          capcode: normalizeCapcode(capcode),
          accountId,
          image: storedImages[0] ?? null,
          images: storedImages,
          diceRolls,
          authorFingerprint,
          globalNumber: nextNumber(state),
          posterHash: createPosterHash({ ip, threadId, salt: daySalt(new Date(createdAt)), posterToken }),
          opProofHash: createPosterProofHash({ threadId, posterToken }),
          deletePasswordHash: deletePasswordHash(deletePassword),
          options: postingOptions.raw,
          sage: postingOptions.sage,
          noko: postingOptions.noko,
          isPending: shouldQueueModeration(
            moderation,
            moderationSettingsForState(state, moderationConfidenceThreshold).moderationConfidenceThreshold
          ),
          isDeleted: false,
          moderationStatus: moderation.status,
          moderationLabels: moderation.labels ?? [],
          ...(Number.isFinite(Number(moderation.confidence)) ? { moderationConfidence: Number(moderation.confidence) } : {}),
          createdAt
        };
        state.comments.push(comment);
        postCreateDelta.comment = comment;
        postCreateDelta.moderationActions.push(recordModerationAction(state, {
          action: 'ai:moderate',
          actor: 'ai',
          postType: 'comment',
          post: comment,
          reason: moderation.labels?.join(', ') || moderation.status,
          createdAt
        }));
        logEvent('post.create', {
          postType: 'comment',
          boardSlug: comment.boardSlug,
          threadId,
          globalNumber: comment.globalNumber,
          moderationStatus: comment.moderationStatus,
          moderationLabels: comment.moderationLabels,
          moderationConfidence: comment.moderationConfidence,
          isPending: comment.isPending
        });
        const slowModeRaised = raiseThreadSlowMode(thread, comment.moderationLabels, createdAt);
        const issuedAppeal = issueAppealToken(state, { postType: 'comment', post: comment, createdAt });
        const appealToken = issuedAppeal.token;
        postCreateDelta.appeals.push(issuedAppeal.appeal);

        if (!comment.isPending) {
          realtime.publish('comment:created', { threadId, comment: serializeComment(comment, thread) });
          if (!postingOptions.sage && repliesBeforeCreate < retentionPolicy.bumpLimit) {
            thread.bumpedAt = createdAt;
            postCreateDelta.updatedThreads.push(thread);
            realtime.publish('thread:bumped', { thread: serializeThread(thread, state.comments) });
          }
        }
        if (slowModeRaised) {
          postCreateDelta.updatedThreads.push(thread);
          realtime.publish('thread:updated', { thread: serializeThread(thread, state.comments) });
        }

        return {
          status: comment.isPending ? 'pending' : 'published',
          comment: serializeComment(comment, thread),
          appealToken
        };
      }, {
        write: async (state) => {
          if (typeof store.appendPostCreate !== 'function') {
            await store.write(state);
            return;
          }
          await store.appendPostCreate({
            state,
            comment: postCreateDelta.comment,
            updatedThreads: uniqueById(postCreateDelta.updatedThreads),
            moderationActions: postCreateDelta.moderationActions,
            appeals: postCreateDelta.appeals
          });
        }
      });
    },

    async votePoll(threadId, { optionId, ip, posterToken } = {}) {
      const selectedOptionId = String(optionId ?? '');
      return mutate(async (state) => {
        const thread = state.threads.find((item) => item.id === threadId && publicThread(state, item) && !item.isArchived);
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

    async reportPost({ globalNumber, reason, category, ip, posterToken }) {
      const safeReason = sanitizeReason(reason);
      if (!safeReason) {
        const error = new Error('Lý do báo cáo là bắt buộc');
        error.statusCode = 400;
        throw error;
      }
      const safeCategory = normalizeReportCategory(category);

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
          category: safeCategory,
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
          postType: report.postType,
          category: report.category
        });
        return report;
      });
    },

    async submitAppeal({ token, reason, ip, posterToken } = {}) {
      const safeToken = normalizeAppealToken(token);
      const safeReason = sanitizeAppealReason(reason);
      if (!safeToken || !safeReason) {
        const error = new Error('Mã kháng nghị và lý do là bắt buộc');
        error.statusCode = 400;
        throw error;
      }

      return mutate(async (state) => {
        const appeal = state.appeals.find((item) => item.tokenHash === appealTokenHash(safeToken));
        if (!appeal) {
          const error = new Error('Mã kháng nghị không hợp lệ');
          error.statusCode = 404;
          throw error;
        }
        if (appeal.status !== 'issued') {
          const error = new Error('Mã kháng nghị đã được sử dụng');
          error.statusCode = 409;
          throw error;
        }
        const found = findAnyPostByGlobalNumber(state, appeal.globalNumber);
        if (!found || (!found.post.isPending && !found.post.isDeleted)) {
          const error = new Error('Bài viết này không còn đủ điều kiện kháng nghị');
          error.statusCode = 409;
          throw error;
        }

        const submittedAt = now().toISOString();
        appeal.status = 'open';
        appeal.reason = safeReason;
        appeal.submittedAt = submittedAt;
        appeal.reporterHash = createPosterHash({
          ip,
          threadId: `appeal:${appeal.id}`,
          salt: daySalt(new Date(submittedAt)),
          posterToken
        });
        appeal.history ??= [];
        appeal.history.push({
          action: 'submitted',
          actor: 'anonymous',
          reason: safeReason,
          createdAt: submittedAt
        });
        logEvent('appeal.submit', {
          boardSlug: appeal.boardSlug,
          globalNumber: appeal.globalNumber,
          postType: appeal.postType
        });
        return serializeAppeal(appeal, state);
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

    async reactPost({ globalNumber, reaction, accountId, ip, posterToken } = {}) {
      const reactionType = normalizeReactionType(reaction);

      return mutate(async (state) => {
        const found = findPublicPostByGlobalNumber(state, globalNumber);
        if (!found) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }

        const post = found.post;
        const voterKey = accountId
          ? `account:${accountId}`
          : `anon:${createModerationFingerprint({ ip, posterToken })}`;
        post.reactionVoters ??= {};
        if (post.reactionVoters[voterKey] === reactionType) {
          delete post.reactionVoters[voterKey];
        } else {
          post.reactionVoters[voterKey] = reactionType;
        }

        const reactions = Object.fromEntries([...POST_REACTION_TYPES].map((type) => [type, 0]));
        for (const value of Object.values(post.reactionVoters)) {
          if (POST_REACTION_TYPES.has(value)) {
            reactions[value] += 1;
          }
        }
        post.reactions = reactions;
        const myReaction = post.reactionVoters[voterKey] ?? null;

        if (found.postType === 'thread') {
          realtime.publish('thread:updated', { thread: serializeThread(post, state.comments) });
        } else {
          const thread = state.threads.find((item) => item.id === post.threadId);
          realtime.publish('comment:updated', {
            threadId: post.threadId,
            comment: serializeComment(post, thread)
          });
        }
        return { reactions: publicReactions(post), myReaction };
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
          if (mediaItems(found.post).length === 0) {
            const error = new Error('Bài viết không có tệp để xóa');
            error.statusCode = 400;
            throw error;
          }
          found.post.image = null;
          found.post.images = [];
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

    async listPending(filters = {}, limit = 100) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
      const priorityContext = {
        reportCounts: openReportCountsByGlobalNumber(state.reports),
        referenceDate: now()
      };
      const threads = state.threads
        .filter((thread) => thread.isPending && !thread.isDeleted)
        .filter((thread) => matchesAdminFilters(thread, filters, 'createdAt'))
        .map((thread) => serializeAdminPost('thread', thread, state, priorityContext));
      const comments = state.comments
        .filter((comment) => comment.isPending && !comment.isDeleted)
        .filter((comment) => matchesAdminFilters(comment, filters, 'createdAt'))
        .map((comment) => serializeAdminPost('comment', comment, state, priorityContext));
      return [...threads, ...comments]
        .filter((item) => matchesPriorityFilter(item, filters))
        .sort(compareAdminPriority(filters))
        .slice(0, safeLimit);
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

    async listAppeals(limit = 50, filters = {}) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      return state.appeals
        .filter((appeal) => appeal.status !== 'issued')
        .filter((appeal) => !filters.boardSlug || appeal.boardSlug === filters.boardSlug)
        .filter((appeal) => {
          if (!filters.since) {
            return true;
          }
          const appealDate = appeal.submittedAt ?? appeal.resolvedAt ?? appeal.createdAt ?? '';
          return String(appealDate).localeCompare(filters.since) >= 0;
        })
        .sort((left, right) => {
          const leftDate = left.submittedAt ?? left.resolvedAt ?? left.createdAt ?? '';
          const rightDate = right.submittedAt ?? right.resolvedAt ?? right.createdAt ?? '';
          return String(rightDate).localeCompare(String(leftDate));
        })
        .slice(0, safeLimit)
        .map((appeal) => serializeAppeal(appeal, state));
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
      const appeals = state.appeals
        .filter((appeal) => appeal.globalNumber === found.post.globalNumber && appeal.status !== 'issued')
        .sort((left, right) => String(right.submittedAt ?? '').localeCompare(String(left.submittedAt ?? '')))
        .map((appeal) => serializeAppeal(appeal, state));
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
        appeals,
        actions,
        sanctions,
        editHistory: serializeEditHistory(found.post)
      };
    },

    async resolveAppeal(id, { status = 'rejected', reason = '', actor = 'admin' } = {}) {
      const safeStatus = APPEAL_RESOLUTION_STATUSES.has(String(status)) ? String(status) : '';
      if (!safeStatus) {
        const error = new Error('Trạng thái kháng nghị không hợp lệ');
        error.statusCode = 400;
        throw error;
      }

      return mutate(async (state) => {
        const appeal = state.appeals.find((item) => item.id === id && item.status === 'open');
        if (!appeal) {
          const error = new Error('Không tìm thấy kháng nghị đang mở');
          error.statusCode = 404;
          throw error;
        }
        const found = findAnyPostByGlobalNumber(state, appeal.globalNumber);
        if (!found) {
          const error = new Error('Không tìm thấy bài viết cho kháng nghị');
          error.statusCode = 404;
          throw error;
        }

        const resolvedAt = now().toISOString();
        const safeReason = sanitizeReason(reason);
        appeal.status = safeStatus;
        appeal.resolutionReason = safeReason;
        appeal.resolvedBy = actor;
        appeal.resolvedAt = resolvedAt;
        appeal.history ??= [];
        appeal.history.push({
          action: safeStatus,
          actor,
          reason: safeReason,
          createdAt: resolvedAt
        });
        if (safeStatus === 'accepted' && found.post.isDeleted) {
          restoreDeletedPostRecord(state, found, {
            reason: safeReason || 'appeal accepted',
            actor,
            restoredAt: resolvedAt,
            action: 'admin:appeal-restore'
          });
        }
        recordModerationAction(state, {
          action: safeStatus === 'accepted' ? 'admin:appeal-accept' : 'admin:appeal-reject',
          actor,
          postType: found.postType,
          post: found.post,
          reason: safeReason || (safeStatus === 'accepted' ? 'accept appeal' : 'reject appeal'),
          createdAt: resolvedAt
        });
        logEvent('appeal.resolve', {
          status: safeStatus,
          boardSlug: appeal.boardSlug,
          globalNumber: appeal.globalNumber,
          actor
        });
        return serializeAppeal(appeal, state);
      });
    },

    async adminEditPost(globalNumber, { body = '', reason = '', actor = 'admin' } = {}) {
      assertPostBodySize(body);
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung không được để trống');
        error.statusCode = 400;
        throw error;
      }

      return mutate(async (state) => {
        const found = findAnyPostByGlobalNumber(state, globalNumber);
        if (!found || found.post.isDeleted) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }

        const editedAt = now().toISOString();
        const safeReason = sanitizeReason(reason);
        const previousBody = String(found.post.body ?? '');
        const previousImages = cloneMediaItems(found.post);
        appendEditHistory(found.post, {
          actor: String(actor || 'admin').slice(0, 80),
          reason: safeReason,
          previousBody,
          newBody: normalizedBody,
          previousImages,
          newImages: previousImages,
          createdAt: editedAt
        });
        found.post.body = normalizedBody;
        found.post.editedAt = editedAt;
        found.post.editedBy = actor;
        found.post.editReason = safeReason;
        recordModerationAction(state, {
          action: 'admin:edit',
          actor,
          postType: found.postType,
          post: found.post,
          reason: safeReason || 'admin-edit',
          createdAt: editedAt
        });
        logEvent('moderation.edit', {
          postType: found.postType,
          boardSlug: found.post.boardSlug,
          globalNumber: found.post.globalNumber,
          actor
        });

        if (found.postType === 'thread') {
          realtime.publish('thread:updated', { thread: serializeThread(found.post, state.comments) });
        } else {
          const parent = state.threads.find((thread) => thread.id === found.post.threadId);
          realtime.publish('comment:updated', {
            threadId: found.post.threadId,
            comment: serializeComment(found.post, parent)
          });
          realtime.publish('thread:updated', { thread: parent ? serializeThread(parent, state.comments) : null });
        }
        return {
          ok: true,
          globalNumber: found.post.globalNumber,
          post: serializeAdminPost(found.postType, found.post, state)
        };
      });
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
          if (mediaItems(found.post).length === 0) {
            const error = new Error('Bài viết không có tệp để xóa');
            error.statusCode = 400;
            throw error;
          }
          found.post.image = null;
          found.post.images = [];
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

    async editPostWithPassword(globalNumber, { password = '', body = '' } = {}) {
      assertPostBodySize(body);
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung không được để trống');
        error.statusCode = 400;
        throw error;
      }

      return mutate(async (state) => {
        const found = findAnyPostByGlobalNumber(state, globalNumber);
        if (!found || found.post.isDeleted) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }
        verifyDeletePassword(found.post, password);

        const editedAt = now().toISOString();
        const previousBody = String(found.post.body ?? '');
        const previousImages = cloneMediaItems(found.post);
        const moderation = await ai.moderate(normalizedBody);
        const wasPending = Boolean(found.post.isPending);
        const nextPending =
          wasPending ||
          shouldQueueModeration(
            moderation,
            moderationSettingsForState(state, moderationConfidenceThreshold).moderationConfidenceThreshold
          );

        found.post.body = normalizedBody;
        found.post.editedAt = editedAt;
        found.post.editedBy = 'anonymous';
        found.post.editReason = 'self-edit';
        found.post.isPending = nextPending;
        found.post.moderationStatus = moderation.status;
        found.post.moderationLabels = moderation.labels ?? [];
        if (Number.isFinite(Number(moderation.confidence))) {
          found.post.moderationConfidence = Number(moderation.confidence);
        } else {
          delete found.post.moderationConfidence;
        }
        appendEditHistory(found.post, {
          actor: 'anonymous',
          reason: 'self-edit',
          previousBody,
          newBody: normalizedBody,
          previousImages,
          newImages: previousImages,
          createdAt: editedAt
        });
        recordModerationAction(state, {
          action: 'user:edit',
          actor: 'anonymous',
          postType: found.postType,
          post: found.post,
          reason: 'self-edit',
          createdAt: editedAt
        });
        logEvent('post.edit', {
          postType: found.postType,
          boardSlug: found.post.boardSlug,
          globalNumber: found.post.globalNumber,
          isPending: found.post.isPending
        });

        if (!found.post.isPending) {
          if (found.postType === 'thread') {
            realtime.publish('thread:updated', { thread: serializeThread(found.post, state.comments) });
          } else {
            const parent = state.threads.find((thread) => thread.id === found.post.threadId);
            realtime.publish('comment:updated', {
              threadId: found.post.threadId,
              comment: serializeComment(found.post, parent)
            });
            realtime.publish('thread:updated', { thread: parent ? serializeThread(parent, state.comments) : null });
          }
        }

        const parent = found.postType === 'comment' ? state.threads.find((thread) => thread.id === found.post.threadId) : null;
        return {
          status: found.post.isPending ? 'pending' : 'published',
          type: found.postType,
          post: found.postType === 'thread' ? serializeThread(found.post, state.comments) : serializeComment(found.post, parent)
        };
      });
    },

    async adminRestorePost(globalNumber, { reason = '', actor = 'admin' } = {}) {
      return mutate(async (state) => {
        const found = findAnyPostByGlobalNumber(state, globalNumber);
        if (!found || !found.post.isDeleted) {
          const error = new Error('Không tìm thấy bài đã xóa');
          error.statusCode = 404;
          throw error;
        }

        const restoredAt = now().toISOString();
        return restoreDeletedPostRecord(state, found, { reason, actor, restoredAt });
      });
    },

    async editAccountPost(globalNumber, { accountId, body = '', image, images, replaceImages = false } = {}) {
      if (!accountId) {
        const error = new Error('Vui lòng đăng nhập tài khoản để sửa bài');
        error.statusCode = 401;
        throw error;
      }
      assertPostBodySize(body);
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung không được để trống');
        error.statusCode = 400;
        throw error;
      }
      const shouldReplaceImages = Boolean(replaceImages);
      const safeImages = shouldReplaceImages ? validateMediaList({ image, images }) : [];

      return mutate(async (state) => {
        const found = findAnyPostByGlobalNumber(state, globalNumber);
        if (!found || found.post.isDeleted) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }
        if (!found.post.accountId || found.post.accountId !== accountId) {
          const error = new Error('Chỉ tài khoản đã đăng bài mới được sửa bài này');
          error.statusCode = 403;
          throw error;
        }

        const editedAt = now().toISOString();
        const previousBody = String(found.post.body ?? '');
        const previousImages = cloneMediaItems(found.post);
        const storedImages = shouldReplaceImages ? await saveMediaList(imageStorage, safeImages) : previousImages;
        const moderation = mergeModerationResults(
          await ai.moderate(normalizedBody),
          shouldReplaceImages ? await scanUploadsForModeration(ai, safeImages) : { status: 'Safe', labels: [] }
        );
        const wasPending = Boolean(found.post.isPending);
        const nextPending =
          wasPending ||
          shouldQueueModeration(
            moderation,
            moderationSettingsForState(state, moderationConfidenceThreshold).moderationConfidenceThreshold
          );

        found.post.body = normalizedBody;
        if (shouldReplaceImages) {
          found.post.image = storedImages[0] ?? null;
          found.post.images = storedImages;
          found.post.fileDeletedAt = storedImages.length ? null : editedAt;
        }
        found.post.editedAt = editedAt;
        found.post.editedBy = `account:${accountId}`;
        found.post.editReason = 'account-edit';
        found.post.isPending = nextPending;
        found.post.moderationStatus = moderation.status;
        found.post.moderationLabels = moderation.labels ?? [];
        if (Number.isFinite(Number(moderation.confidence))) {
          found.post.moderationConfidence = Number(moderation.confidence);
        } else {
          delete found.post.moderationConfidence;
        }
        appendEditHistory(found.post, {
          actor: `account:${accountId}`,
          reason: 'account-edit',
          previousBody,
          newBody: normalizedBody,
          previousImages,
          newImages: cloneMediaItems(found.post),
          createdAt: editedAt
        });
        recordModerationAction(state, {
          action: 'user:edit',
          actor: `account:${accountId}`,
          postType: found.postType,
          post: found.post,
          reason: 'account-edit',
          createdAt: editedAt
        });
        logEvent('post.edit', {
          postType: found.postType,
          boardSlug: found.post.boardSlug,
          globalNumber: found.post.globalNumber,
          isPending: found.post.isPending
        });

        if (!found.post.isPending) {
          if (found.postType === 'thread') {
            realtime.publish('thread:updated', { thread: serializeThread(found.post, state.comments) });
          } else {
            const parent = state.threads.find((thread) => thread.id === found.post.threadId);
            realtime.publish('comment:updated', {
              threadId: found.post.threadId,
              comment: serializeComment(found.post, parent)
            });
            realtime.publish('thread:updated', { thread: parent ? serializeThread(parent, state.comments) : null });
          }
        }

        const parent = found.postType === 'comment' ? state.threads.find((thread) => thread.id === found.post.threadId) : null;
        return {
          status: found.post.isPending ? 'pending' : 'published',
          type: found.postType,
          post: found.postType === 'thread' ? serializeThread(found.post, state.comments) : serializeComment(found.post, parent)
        };
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

    async checkDuplicateThread({ boardSlug, body, ip, posterToken, actor = 'public' } = {}) {
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung là bắt buộc');
        error.statusCode = 400;
        throw error;
      }
      const snapshot = await store.read();
      if (!findBoard(snapshot, boardSlug, { publicOnly: true })) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }
      if (!aiConfigStatus().configured || typeof ai.checkDuplicateThread !== 'function') {
        return { isDuplicate: false, matchedThreadId: null, reason: null };
      }

      const createdAt = now().toISOString();
      const existingThreads = await mutate(async (state) => {
        consumeAiBudget(state, { kind: 'duplicateCheck', ip, posterToken, actor, createdAt });
        return state.threads
          .filter((thread) => thread.boardSlug === boardSlug && activePublicThread(thread))
          .sort(compareBoardThreads)
          .slice(0, 30)
          .map((thread) => ({
            id: thread.id,
            globalNumber: thread.globalNumber,
            body: redactSensitiveText(thread.body)
          }));
      });

      if (!existingThreads.length) {
        return { isDuplicate: false, matchedThreadId: null, reason: null };
      }

      try {
        logEvent('ai.duplicate-check', { boardSlug, candidateCount: existingThreads.length });
        const result = await ai.checkDuplicateThread(normalizedBody, existingThreads);
        const matched = existingThreads.some((thread) => thread.id === result?.matchedThreadId);
        return {
          isDuplicate: Boolean(result?.isDuplicate && matched),
          matchedThreadId: matched ? result.matchedThreadId : null,
          reason: result?.isDuplicate && matched ? (result.reason ?? null) : null
        };
      } catch {
        return { isDuplicate: false, matchedThreadId: null, reason: null };
      }
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

    async createBoard({ slug, name, category, description, rules, banner, isHidden, isArchived, temporary, eventEndsAt, retentionPolicy } = {}, { actor } = {}) {
      const input = normalizeBoardInput({ slug, name, category, description, rules, banner, isHidden, isArchived, temporary, eventEndsAt });
      if (input.temporary && !input.eventEndsAt) {
        const error = new Error('Board sự kiện cần thời điểm kết thúc');
        error.statusCode = 400;
        throw error;
      }
      return mutate(async (state) => {
        if (state.boards.find((b) => b.slug === input.slug)) {
          const error = new Error('Board đã tồn tại');
          error.statusCode = 409;
          throw error;
        }
        const board = {
          ...input,
          isHidden: Boolean(input.isHidden),
          isArchived: Boolean(input.isArchived),
          retentionPolicy: normalizeRetentionPolicy(retentionPolicyInput(retentionPolicy), lifecycle)
        };
        state.boards.push(board);
        logEvent('board.created', { slug: board.slug, actor });
        return { board: serializeBoard(board, { admin: true, retentionDefaults: lifecycle }) };
      });
    },

    async updateBoard(slug, { name, category, description, rules, banner, isHidden, isArchived, temporary, eventEndsAt, retentionPolicy } = {}, { actor } = {}) {
      const safeSlug = String(slug ?? '').trim().toLowerCase();
      if (!BOARD_SLUG_PATTERN.test(safeSlug)) {
        const error = new Error('Slug board không hợp lệ');
        error.statusCode = 400;
        throw error;
      }
      const updates = normalizeBoardInput(
        { name, category, description, rules, banner, isHidden, isArchived, temporary, eventEndsAt },
        { requireSlug: false }
      );
      return mutate(async (state) => {
        const board = state.boards.find((b) => b.slug === safeSlug);
        if (!board) {
          const error = new Error('Không tìm thấy board');
          error.statusCode = 404;
          throw error;
        }
        const nextBoard = { ...board, ...updates };
        if (nextBoard.temporary && !nextBoard.eventEndsAt) {
          const error = new Error('Board sự kiện cần thời điểm kết thúc');
          error.statusCode = 400;
          throw error;
        }
        Object.assign(board, updates);
        if (retentionPolicy !== undefined) {
          board.retentionPolicy = normalizeRetentionPolicy(
            {
              ...boardRetentionPolicy(board, lifecycle),
              ...retentionPolicyInput(retentionPolicy)
            },
            lifecycle
          );
        }

        logEvent('board.updated', { slug: safeSlug, actor });
        return { board: serializeBoard(board, { admin: true, retentionDefaults: lifecycle }) };
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
        return { board: serializeBoard(board, { admin: true, retentionDefaults: lifecycle }) };
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
