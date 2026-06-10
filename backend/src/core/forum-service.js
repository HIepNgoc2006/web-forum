import crypto from 'node:crypto';

import {
  BOARDS,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_THUMBNAIL_BYTES,
  THREAD_LIFECYCLE,
  getBoard,
  readPositiveInteger
} from './config.js';
import { createInlineImageStorage } from './image-storage.js';
import { createModerationFingerprint, createPosterHash, createPosterProofHash, verifyHcaptcha } from './security.js';
import { normalizeBody, parsePostText } from './text-format.js';

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
const ACCOUNT_THEMES = new Set(['yotsuba-b', 'yotsuba', 'tomorrow']);

function publicPost(post) {
  return !post.isPending && !post.isDeleted;
}

function stripPrivatePostFields(post) {
  const {
    authorFingerprint: _authorFingerprint,
    opProofHash: _opProofHash,
    deletePasswordHash: _deletePasswordHash,
    pollVotes: _pollVotes,
    ...publicFields
  } = post;
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
}

function boardEventEnded(board, at) {
  return Boolean(board?.temporary && board.eventEndsAt && String(board.eventEndsAt).localeCompare(at) <= 0);
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

function assertAccountPassword(value = '') {
  const password = String(value ?? '');
  if (password.length < 8 || password.length > 160) {
    const error = new Error('Mật khẩu cần từ 8 đến 160 ký tự');
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

function defaultAccountSettings() {
  return {
    theme: 'yotsuba-b',
    homeBoard: 'confession',
    syncDrafts: true,
    emailNotifications: false
  };
}

function normalizeAccountSettings(settings = {}, current = defaultAccountSettings()) {
  const safe = { ...defaultAccountSettings(), ...current };
  const theme = String(settings.theme ?? safe.theme);
  if (ACCOUNT_THEMES.has(theme)) {
    safe.theme = theme;
  }
  const boardSlug = String(settings.homeBoard ?? safe.homeBoard);
  if (getBoard(boardSlug)) {
    safe.homeBoard = boardSlug;
  }
  if (typeof settings.syncDrafts === 'boolean') {
    safe.syncDrafts = settings.syncDrafts;
  }
  if (typeof settings.emailNotifications === 'boolean') {
    safe.emailNotifications = settings.emailNotifications;
  }
  return safe;
}

function serializeAccount(user = {}) {
  return {
    id: user.id,
    username: user.username,
    role: user.role || 'user',
    settings: normalizeAccountSettings({}, user.settings),
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
  return [...String(body).matchAll(/>>(\d+)/g)].map((match) => Number(match[1])).filter((number) => Number.isFinite(number));
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

function serializeThread(thread, comments) {
  const publicComments = comments.filter((comment) => comment.threadId === thread.id && publicPost(comment));
  return {
    ...stripPrivatePostFields(thread),
    displayName: publicDisplayName(thread.displayName),
    poll: serializePoll(thread.poll),
    isArchived: Boolean(thread.isArchived),
    archivedAt: thread.archivedAt ?? null,
    archivedReason: thread.archivedReason ?? null,
    slowModeUntil: thread.slowModeUntil ?? null,
    slowModeSeconds: Number(thread.slowModeSeconds || 0),
    bodyLines: parsePostText(thread.body),
    replyCount: publicComments.length
  };
}

function serializeComment(comment, thread = null) {
  return {
    ...stripPrivatePostFields(comment),
    displayName: publicDisplayName(comment.displayName),
    isOp: Boolean(thread?.opProofHash && comment.opProofHash && thread.opProofHash === comment.opProofHash),
    bodyLines: parsePostText(comment.body)
  };
}

function compareNewestPosts(left, right) {
  const dateCompare = right.createdAt.localeCompare(left.createdAt);
  if (dateCompare !== 0) {
    return dateCompare;
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
    rewrite: 20
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
      ...health,
      configured: health.configured ?? true,
      ready: health.ready ?? health.configured !== false
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
  imageStorage = createInlineImageStorage()
}) {
  function logEvent(event, payload = {}) {
    if (logger === noopLogger) {
      return;
    }
    logger({ event, ...payload });
  }

  async function mutate(callback) {
    const state = await store.read();
    const result = await callback(state);
    await store.write(state);
    return result;
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
    const board = getBoard(boardSlug);
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
      const { BOARDS } = await import('./config.js');
      return BOARDS;
    },

    async getStats() {
      const state = await store.read();
      const publicThreads = state.threads.filter(publicPost);
      const publicComments = state.comments.filter(publicPost);
      const publicPosts = [...publicThreads, ...publicComments];
      const activeBoards = new Set(publicThreads.map((thread) => thread.boardSlug));
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
        publicBoardCount: BOARDS.length,
        totalBoardCount: BOARDS.length,
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
        ai: {
          provider: 'google-ai-studio',
          configured: Boolean(process.env.GOOGLE_AI_API_KEY),
          model: process.env.GOOGLE_AI_MODEL ?? 'gemini-1.5-flash'
        },
        imageStorage: imageStorageHealth,
        realtime: {
          clients: realtime.count?.() ?? 0,
          boards: realtime.boardCounts?.() ?? {}
        }
      };
    },

    async registerAccount({ username, password } = {}) {
      const safeUsername = assertAccountUsername(username);
      const safePassword = assertAccountPassword(password);
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
          role: 'user',
          settings: defaultAccountSettings(),
          createdAt,
          updatedAt: createdAt
        };
        state.users.push(user);
        logEvent('account.register', { username: safeUsername });
        return serializeAccount(user);
      });
    },

    async loginAccount({ username, password } = {}) {
      const safeUsername = normalizeAccountUsername(username);
      const user = (await store.read()).users.find((item) => normalizeAccountUsername(item.username) === safeUsername);
      if (!user || !verifyAccountPassword(password, user.passwordHash)) {
        const error = new Error('Tên tài khoản hoặc mật khẩu không đúng');
        error.statusCode = 401;
        throw error;
      }
      return serializeAccount(user);
    },

    async getAccount(userId) {
      const user = (await store.read()).users.find((item) => item.id === userId);
      if (!user) {
        const error = new Error('Phiên đăng nhập không còn hợp lệ');
        error.statusCode = 401;
        throw error;
      }
      return serializeAccount(user);
    },

    async updateAccountSettings(userId, settings = {}) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        user.settings = normalizeAccountSettings(settings, user.settings);
        user.updatedAt = now().toISOString();
        logEvent('account.settings.update', { username: user.username });
        return serializeAccount(user);
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
      const safeLimit = Math.max(1, Math.min(Number(limit) || 8, BOARDS.length));
      const oneDayAgo = now().getTime() - 24 * 60 * 60 * 1000;
      const inLast24h = (post) => new Date(post.createdAt).getTime() >= oneDayAgo;
      const activeThreadIds = new Set(state.threads.filter(activePublicThread).map((thread) => thread.id));
      const metrics = new Map(
        BOARDS.map((board) => [
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
      if (!getBoard(boardSlug)) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }

      const state = await store.read();
      const checkedAt = now().toISOString();
      if (archiveExpiredEventThreads(state, boardSlug, checkedAt)) {
        await store.write(state);
      }
      const term = normalizeSearchTerm(options.q);
      const threads = state.threads
        .filter((thread) => thread.boardSlug === boardSlug && activePublicThread(thread))
        .filter((thread) => threadMatchesSearch(state, thread, term))
        .sort((left, right) => right.bumpedAt.localeCompare(left.bumpedAt))
        .map((thread) => serializeThread(thread, state.comments));
      if (options.paged) {
        return pagedResult(threads, { page: options.page, pageSize: options.pageSize, maxPageSize: 50 });
      }
      return threads;
    },

    async listArchivedThreads(boardSlug) {
      if (!getBoard(boardSlug)) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }

      const state = await store.read();
      const checkedAt = now().toISOString();
      if (archiveExpiredEventThreads(state, boardSlug, checkedAt)) {
        await store.write(state);
      }
      return state.threads
        .filter((thread) => thread.boardSlug === boardSlug && archivedPublicThread(thread))
        .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''))
        .map((thread) => serializeThread(thread, state.comments));
    },

    async searchArchive({ q, boardSlug, since, until, page, pageSize } = {}) {
      const state = await store.read();
      const term = normalizeSearchTerm(q);

      // Filter archived threads
      let candidates = state.threads.filter((thread) => {
        if (!archivedPublicThread(thread)) return false;
        if (boardSlug && thread.boardSlug !== boardSlug) return false;
        if (since && (thread.archivedAt ?? thread.createdAt ?? '').localeCompare(since) < 0) return false;
        if (until && (thread.archivedAt ?? thread.createdAt ?? '').localeCompare(until) > 0) return false;
        return true;
      });

      // Apply text search filter
      if (term) {
        candidates = candidates.filter((thread) => threadMatchesSearch(state, thread, term));
      }

      // Sort newest archived first
      candidates.sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''));

      const serialized = candidates.map((thread) => serializeThread(thread, state.comments));
      return pagedResult(serialized, { page, pageSize, maxPageSize: 50 });
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
      deletePassword = ''
    }) {
      const board = getBoard(boardSlug);
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
      const normalizedDisplayName = assertDisplayName(displayName);
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
          image: storedImage,
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
      const [threadWithBacklinks, ...commentsWithBacklinks] = withBacklinks;
      const currentMaxGlobalNumber = withBacklinks.reduce(
        (maxNumber, post) => Math.max(maxNumber, Number(post.globalNumber) || 0),
        0
      );
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
            currentMaxGlobalNumber
          }
        };
      }
      return {
        thread: threadWithBacklinks,
        comments: commentsWithBacklinks
      };
    },

    async createComment({ threadId, body, captchaToken, ip, posterToken, displayName = '', options = '', deletePassword = '' }) {
      await requireCaptcha(captchaToken, ip);
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung là bắt buộc');
        error.statusCode = 400;
        throw error;
      }
      const createdAt = now().toISOString();
      const postingOptions = parsePostingOptions(options);
      const normalizedDisplayName = assertDisplayName(displayName);

      return mutate(async (state) => {
        const authorFingerprint = enforceSanctions(state, { ip, posterToken, createdAt });
        const thread = state.threads.find((item) => item.id === threadId && activePublicThread(item));
        if (!thread) {
          const error = new Error('Không tìm thấy chủ đề');
          error.statusCode = 404;
          throw error;
        }
        assertEventBoardOpen(getBoard(thread.boardSlug), createdAt);
        enforceThreadSlowMode(state, thread, { authorFingerprint, createdAt });

        const repliesBeforeCreate = publicReplyCount(state, threadId);
        if (repliesBeforeCreate >= lifecycle.replyLimit) {
          const error = new Error('Chủ đề đã đạt giới hạn phản hồi');
          error.statusCode = 409;
          throw error;
        }
        const moderation = await ai.moderate(normalizedBody);

        const comment = {
          id: crypto.randomUUID(),
          threadId,
          boardSlug: thread.boardSlug,
          body: normalizedBody,
          displayName: normalizedDisplayName,
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
      const items = (sinceNumber ? comments : [detail.thread, ...comments]).map((item) => ({ body: item.body }));
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
      const items = threads.map((thread) => ({ body: thread.body }));
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

    async suggestComments(threadId, { ip, posterToken, actor = 'public' } = {}) {
      const detail = await this.getThread(threadId);
      const items = [detail.thread, ...detail.comments.slice(-3)].map((item) => ({ body: item.body }));
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

    async rewriteDraft({ body, ip, posterToken, actor = 'public' } = {}) {
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
        return ai.rewrite(normalizedBody);
      });
    }
  };
}
