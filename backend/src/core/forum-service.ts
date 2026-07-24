import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import {
  BOARDS,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_THUMBNAIL_BYTES,
  DEFAULT_SITE_CONTENT,
  THREAD_LIFECYCLE,
  aiConfigStatus,
  normalizeRetentionPolicy,
  normalizeSiteContent,
  publicBoardConfig,
  readModerationConfidenceThreshold,
  readPositiveInteger
} from './config.ts';
import {
  MAX_CUSTOM_STICKERS,
  assertCustomStickerKey,
  createCustomSticker,
  normalizeCustomStickers,
  normalizeImgurStickerUrl
} from './custom-stickers.ts';
import { redactSensitiveText } from './ai.ts';
import { assertAccountPassword } from './account-password-policy.ts';
import {
  MAX_DM_CONVERSATIONS_PER_USER,
  MAX_DM_GROUP_INVITE_BATCH,
  MAX_DM_GROUP_PARTICIPANTS,
  MAX_DM_MEDIA_PER_MESSAGE,
  MAX_DM_MESSAGE_PAGE,
  MAX_DM_SEARCH_RESULTS,
  canDeleteDmMessage,
  canEditDmMessage,
  canKickMember,
  canManageGroupMembers,
  conversationIncludesUser,
  conversationIsHiddenFor,
  conversationIsMutedFor,
  conversationKind,
  countUnreadForUser,
  createDmConversationRecord,
  createDmMessageRecord,
  createGroupConversationRecord,
  dmPreviewFromBody,
  dmServiceError,
  encryptStoredBody,
  ensureDmCollections,
  assertDmBodyMediaTokens,
  extractDmLinks,
  getMemberRole,
  getUserDmBlockedIds,
  hideConversationForUser,
  isDmBlockedBetween,
  normalizeDmBody,
  normalizeDmReaction,
  normalizeDmRoles,
  normalizeParticipantIds,
  participantKeyFor,
  recomputeConversationLastMessage,
  removeParticipantFromConversation,
  sanitizeGroupTitle,
  serializeDmConversation,
  serializeDmMessage,
  setConversationMuted,
  trimConversationMessages,
  unhideConversationForAll,
  unhideConversationForUser
} from './dm.ts';
import { resolveDmEncryptionSecret } from './dm-crypto.ts';
import { createDisabledEmailClient } from './email.ts';
import { createInlineImageStorage } from './image-storage.ts';
import {
  buildPostLinks,
  fetchLinkPreview,
  serializePostLinks
} from './link-preview.ts';
import { createModerationFingerprint, createPosterHash, createPosterProofHash, createTripcode, verifyHcaptcha } from './security.ts';
import { normalizeBody, parsePostText, sanitizeText } from './text-format.ts';
import * as defaultTotp from './totp-service.ts';
import * as defaultWebAuthn from './webauthn-service.ts';
import type { BoardConfig, SiteContent, ThreadLifecycle } from './config.ts';
import type { EmailClient, EmailMessage } from './email.ts';

type AnyRecord = Record<string, any>;

type RealtimeStateAdapter = {
  consumeUserRateLimit?: (
    userId: string,
    action: string,
    options: { limit: number; windowMs: number }
  ) => Promise<{ allowed: boolean; retryAfterMs: number }>;
  getUnreadCount?: (userId: string) => Promise<number | null>;
  setUnreadCount?: (userId: string, count: number) => Promise<void>;
  invalidateUnreadCount?: (userId: string) => Promise<void>;
  health?: () => { failureMode?: 'open' | 'closed' };
};

type ForumServiceOptions = {
  store: any;
  ai: any;
  realtime?: AnyRecord;
  now?: () => Date;
  lifecycle?: ThreadLifecycle;
  logger?: (entry: AnyRecord) => void;
  imageStorage?: any;
  emailClient?: EmailClient;
  appBaseUrl?: string;
  totp?: AnyRecord;
  webauthn?: AnyRecord;
  moderationConfidenceThreshold?: number;
  randomInt?: typeof crypto.randomInt;
  dmEncryptionSecret?: string;
  realtimeState?: RealtimeStateAdapter;
};

declare global {
  interface Error {
    statusCode?: number;
    retryAfter?: number;
  }
}

const noopLogger = (_entry?: AnyRecord) => {};
const noopRealtime: AnyRecord = {
  publish(_event?: string, _payload?: unknown) {},
  count: () => 0
};
const noopRealtimeState: RealtimeStateAdapter = {
  async consumeUserRateLimit() {
    return { allowed: true, retryAfterMs: 0 };
  },
  async getUnreadCount() {
    return null;
  },
  async setUnreadCount() {},
  async invalidateUnreadCount() {},
  health: () => ({ failureMode: 'open' })
};
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
const ACCOUNT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_FAILED_LOGINS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILED_TWO_FACTOR_ATTEMPTS = 5;
const TWO_FACTOR_LOCKOUT_MS = 15 * 60 * 1000;
const TWO_FACTOR_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const EMAIL_OTP_TTL_MS = 15 * 60 * 1000;
const EMAIL_OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const EMAIL_NOTIFICATION_RECIPIENT_LIMIT = 200;
const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const ACCOUNT_THEMES = new Set(['yotsuba-b', 'yotsuba', 'tomorrow', 'burichan']);
const MAX_ACCOUNT_WATCHLIST_ITEMS = 100;
const MAX_ACCOUNT_DRAFTS = 40;
const MAX_ACCOUNT_SAVED_SEARCHES = 50;
const MAX_ACCOUNT_CONTENT_FILTERS = 80;
const MAX_ACCOUNT_REPLY_TEMPLATES = 40;
const MAX_ACCOUNT_POSTER_NOTES = 120;
const MAX_ACCOUNT_HIDDEN_POSTS = 500;
const MAX_ACCOUNT_HIDDEN_THREADS = 200;
const MAX_ACCOUNT_DRAFT_LENGTH = 12_000;
const MAX_ACCOUNT_REPLY_TEMPLATE_LENGTH = 5_000;
const ACCOUNT_DISPLAY_PREFS = ['compactThreads', 'hideThumbnails', 'watchedUnreadOnly'];
const ACCOUNT_WATCHED_SORTS = new Set(['unread', 'recent', 'board']);
const ACCOUNT_COMMENT_COMPOSER_MODES = new Set(['floating', 'normal']);
const ACCOUNT_FONT_SIZES = new Set(['small', 'medium', 'large', 'xlarge']);
const ACCOUNT_NOTIFICATION_PREFS = [
  'email',
  'watchedThreads',
  'boardSubscriptions',
  'browserWatchedThreads',
  'browserBoardSubscriptions',
  'browserMentions',
  'emailMentions',
  'emailDirectMessages',
  'directMessages',
  'browserDirectMessages'
];
const BOARD_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_MEDIA_PER_POST = 4;
const THREAD_PREVIEW_REPLY_LIMIT = 3;
const MAX_DICE_ROLLS_PER_POST = 6;
const MAX_DICE_COUNT = 20;
const MAX_DICE_SIDES = 1_000;
const MAX_DICE_MODIFIER = 999;
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif'
]);
const SUPPORTED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
const SUPPORTED_MEDIA_TYPES = new Set([...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_VIDEO_TYPES]);
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
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 6;
const MAX_POLL_OPTION_LENGTH = 120;
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

function mediaStorageKeys(items = []) {
  const keys = new Set<string>();
  for (const item of items) {
    if (typeof item?.storageKey === 'string' && item.storageKey) {
      keys.add(item.storageKey);
    }
    if (typeof item?.thumbnail?.storageKey === 'string' && item.thumbnail.storageKey) {
      keys.add(item.thumbnail.storageKey);
    }
  }
  return [...keys];
}

async function deleteStoredMedia(
  imageStorage,
  items,
  { exceptKeys = new Set<string>(), onFailure = () => undefined }: AnyRecord = {}
) {
  if (typeof imageStorage?.deleteKey !== 'function') {
    return;
  }
  const failures = [];
  for (const storageKey of mediaStorageKeys(items)) {
    if (exceptKeys.has(storageKey)) {
      continue;
    }
    try {
      await imageStorage.deleteKey(storageKey);
    } catch (error) {
      failures.push(error);
      onFailure(storageKey, error);
    }
  }
  if (failures.length > 0) {
    const error = new Error('Không thể xóa hoàn toàn tệp đã lưu');
    error.statusCode = 502;
    throw error;
  }
}

function activePublicThread(thread) {
  return publicPost(thread) && !thread.isArchived;
}

function archivedPublicThread(thread) {
  return publicPost(thread) && thread.isArchived;
}

function boardRetentionPolicy(board: AnyRecord | null | undefined, defaults: ThreadLifecycle = THREAD_LIFECYCLE) {
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

function publicBoard(board: AnyRecord = {}) {
  return Boolean(board?.slug) && !board.isHidden && !board.isArchived;
}

function serializeBoard(board: AnyRecord = {}, { admin = false, retentionDefaults = THREAD_LIFECYCLE }: AnyRecord = {}) {
  const presentation = publicBoardConfig(board as BoardConfig);
  const serialized: AnyRecord = {
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

function findBoard(state: AnyRecord, slug: string, { publicOnly = false }: AnyRecord = {}) {
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
  { slug, name, category, description, rules, banner, isHidden, isArchived, temporary, eventEndsAt }: AnyRecord = {},
  { requireSlug = true }: AnyRecord = {}
) {
  const board: AnyRecord = {};
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

function mediaBytesStartWith(bytes, signature) {
  return bytes.length >= signature.length
    && signature.every((value, index) => bytes[index] === value);
}

function mediaAsciiAt(bytes, offset, value) {
  return bytes.length >= offset + value.length
    && bytes.subarray(offset, offset + value.length).toString('ascii') === value;
}

function matchesMediaMagicBytes(type, bytes) {
  switch (type) {
    case 'image/jpeg':
      return mediaBytesStartWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return mediaBytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif':
      return mediaAsciiAt(bytes, 0, 'GIF87a') || mediaAsciiAt(bytes, 0, 'GIF89a');
    case 'image/webp':
      return mediaAsciiAt(bytes, 0, 'RIFF') && mediaAsciiAt(bytes, 8, 'WEBP');
    case 'image/avif': {
      if (!mediaAsciiAt(bytes, 4, 'ftyp')) {
        return false;
      }
      for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
        const brand = bytes.subarray(offset, offset + 4).toString('ascii');
        if (brand === 'avif' || brand === 'avis') {
          return true;
        }
      }
      return false;
    }
    case 'video/mp4':
      return mediaAsciiAt(bytes, 4, 'ftyp')
        && !mediaAsciiAt(bytes, 8, 'avif')
        && !mediaAsciiAt(bytes, 8, 'avis');
    case 'video/webm':
      return mediaBytesStartWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    default:
      return false;
  }
}

function parseStrictMediaDataUrl(dataUrl, expectedType, errorMessage) {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match || match[1].toLowerCase() !== expectedType || match[2].length % 4 !== 0) {
    const error = new Error(errorMessage);
    error.statusCode = 400;
    throw error;
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== match[2] || !matchesMediaMagicBytes(expectedType, bytes)) {
    const error = new Error(errorMessage);
    error.statusCode = 400;
    throw error;
  }
  return {
    bytes,
    dataUrl: `data:${expectedType};base64,${match[2]}`
  };
}

function sanitizePositiveInteger(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.min(Math.round(number), max);
}

function paginationOptions({ page, pageSize, maxPageSize = 50 }: AnyRecord = {}) {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.max(1, Math.min(Math.floor(Number(pageSize) || maxPageSize), maxPageSize));
  return {
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize
  };
}

function pagedResult(items: any[], options: AnyRecord = {}) {
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

function normalizeAccountEmail(value = '') {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .slice(0, 254);
}

function assertAccountEmail(value = '') {
  const email = normalizeAccountEmail(value);
  if (!ACCOUNT_EMAIL_PATTERN.test(email)) {
    const error = new Error('Địa chỉ email không hợp lệ');
    error.statusCode = 400;
    throw error;
  }
  return email;
}

function findUserByAccountIdentifier(users = [], identifier = '') {
  const raw = String(identifier ?? '').trim();
  const username = normalizeAccountUsername(raw);
  const email = normalizeAccountEmail(raw);
  return users.find((user) =>
    normalizeAccountUsername(user.username) === username ||
    (email && normalizeAccountEmail(user.email) === email)
  );
}

function timingSafeEqualHex(left = '', right = '') {
  const leftBuffer = Buffer.from(String(left), 'hex');
  const rightBuffer = Buffer.from(String(right), 'hex');
  return leftBuffer.length > 0 && leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashEmailOtp({ userId, purpose, email, code }: AnyRecord = {}) {
  const secret = process.env.EMAIL_OTP_SECRET || process.env.JWT_SECRET || '36chan-email-otp-development-only';
  return crypto
    .createHmac('sha256', secret)
    .update(`${String(userId)}:${String(purpose)}:${normalizeAccountEmail(email)}:${String(code)}`)
    .digest('hex');
}

function escapeEmailHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
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

function isPrivilegedAccount(user: AnyRecord = {}) {
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
      watchedSort: 'unread',
      commentComposerMode: 'floating',
      fontSize: 'medium'
    },
    notificationPreferences: {
      email: false,
      watchedThreads: true,
      boardSubscriptions: false,
      browserWatchedThreads: false,
      browserBoardSubscriptions: false,
      browserMentions: false,
      emailMentions: false,
      emailDirectMessages: false,
      directMessages: true,
      browserDirectMessages: false
    },
    boardSubscriptions: [],
    hiddenBoards: []
  };
}

function normalizeBoardSubscriptionSlugs(values: any[] = [], state: AnyRecord = {}) {
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

function normalizeAccountSettings(state: AnyRecord, settings: AnyRecord = {}, current = defaultAccountSettings()) {
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
    boardSubscriptions: normalizeBoardSubscriptionSlugs(current.boardSubscriptions || defaults.boardSubscriptions, state),
    hiddenBoards: normalizeBoardSubscriptionSlugs(current.hiddenBoards || defaults.hiddenBoards, state)
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
    if (ACCOUNT_COMMENT_COMPOSER_MODES.has(settings.displayPreferences.commentComposerMode)) {
      safe.displayPreferences.commentComposerMode = settings.displayPreferences.commentComposerMode;
    }
    if (ACCOUNT_FONT_SIZES.has(String(settings.displayPreferences.fontSize || ''))) {
      safe.displayPreferences.fontSize = String(settings.displayPreferences.fontSize);
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
  if (Array.isArray(settings.hiddenBoards)) {
    safe.hiddenBoards = normalizeBoardSubscriptionSlugs(settings.hiddenBoards, state);
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

function normalizeAccountIdList(value: unknown = [], maxItems = 200) {
  const seen = new Set();
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => String(item ?? '').trim())
    .filter((item) => item && item.length <= 120)
    .filter((item) => {
      if (seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    })
    .slice(0, maxItems);
}

function defaultAccountPrivateData() {
  return {
    watchlist: [],
    drafts: [],
    savedSearches: [],
    contentFilters: [],
    replyTemplates: [],
    posterNotes: [],
    hiddenPosts: [],
    hiddenThreads: []
  };
}

function normalizeAccountPrivateData(value: AnyRecord = {}, current: AnyRecord = defaultAccountPrivateData()) {
  const input = value && typeof value === 'object' ? value : {};
  const previous = current && typeof current === 'object' ? current : defaultAccountPrivateData();
  const safe = {
    watchlist: normalizeAccountWatchlist(previous.watchlist),
    drafts: normalizeAccountDrafts(previous.drafts),
    savedSearches: normalizeAccountSavedSearches(previous.savedSearches),
    contentFilters: normalizeAccountContentFilters(previous.contentFilters),
    replyTemplates: normalizeAccountReplyTemplates(previous.replyTemplates),
    posterNotes: normalizeAccountPosterNotes(previous.posterNotes),
    hiddenPosts: normalizeAccountIdList(previous.hiddenPosts, MAX_ACCOUNT_HIDDEN_POSTS),
    hiddenThreads: normalizeAccountIdList(previous.hiddenThreads, MAX_ACCOUNT_HIDDEN_THREADS)
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
  if (Object.hasOwn(input, 'hiddenPosts')) {
    safe.hiddenPosts = normalizeAccountIdList(input.hiddenPosts, MAX_ACCOUNT_HIDDEN_POSTS);
  }
  if (Object.hasOwn(input, 'hiddenThreads')) {
    safe.hiddenThreads = normalizeAccountIdList(input.hiddenThreads, MAX_ACCOUNT_HIDDEN_THREADS);
  }
  return safe;
}

function serializeAccountPrivateData(value: AnyRecord = {}) {
  return normalizeAccountPrivateData(value, value);
}

function serializedEmailChallenge(user: AnyRecord, purpose: string, checkedAt: Date | null = null) {
  const challenge = user.emailChallenges?.[purpose] || null;
  if (!challenge || !checkedAt) {
    return challenge;
  }
  const expiresAt = new Date(challenge.expiresAt || 0).getTime();
  return Number.isFinite(expiresAt) && expiresAt > checkedAt.getTime() ? challenge : null;
}

function accountAuthEpoch(user: AnyRecord = {}) {
  const value = Number(user.authEpoch);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function bumpAccountAuthEpoch(user: AnyRecord) {
  user.authEpoch = accountAuthEpoch(user) + 1;
  return user.authEpoch;
}

function createWebAuthnChallenge(value: string, issuedAt: Date) {
  return {
    value,
    expiresAt: new Date(issuedAt.getTime() + WEBAUTHN_CHALLENGE_TTL_MS).toISOString()
  };
}

function activeWebAuthnChallenge(challenge: unknown, checkedAt: Date) {
  if (typeof challenge === 'string' && challenge) {
    return challenge;
  }
  if (!challenge || typeof challenge !== 'object') {
    return '';
  }
  const record = challenge as AnyRecord;
  const expiresAt = new Date(record.expiresAt || 0).getTime();
  return typeof record.value === 'string'
    && record.value
    && Number.isFinite(expiresAt)
    && expiresAt > checkedAt.getTime()
    ? record.value
    : '';
}

function serializeAccount(state: AnyRecord, user: AnyRecord = {}, checkedAt: Date | null = null) {
  const verificationChallenge = serializedEmailChallenge(user, 'verify-email', checkedAt);
  const changeChallenge = serializedEmailChallenge(user, 'change-email', checkedAt);
  return {
    id: user.id,
    username: user.username,
    role: normalizeAccountRole(user.role),
    disabled: Boolean(user.disabled),
    authEpoch: accountAuthEpoch(user),
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    hasRecoveryCode: Boolean(user.recoveryCodeHash),
    email: user.email || null,
    emailVerified: Boolean(user.email && user.emailVerifiedAt),
    emailVerifiedAt: user.emailVerifiedAt || null,
    pendingEmail: changeChallenge?.email || null,
    emailVerificationExpiresAt: verificationChallenge?.expiresAt || changeChallenge?.expiresAt || null,
    settings: normalizeAccountSettings(state, {}, user.settings),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function serializePrivilegedAccount(state: AnyRecord, user: AnyRecord = {}) {
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

function addBacklinks(posts: AnyRecord[]): AnyRecord[] {
  const postByNumber = new Map(posts.map((post) => [Number(post.globalNumber), post]));
  const backlinks = new Map<number, number[]>(posts.map((post) => [Number(post.globalNumber), []]));
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
  if (pollOptions === undefined || pollOptions === null) {
    return null;
  }
  if (!Array.isArray(pollOptions)) {
    const error = new Error('Thăm dò phải là danh sách lựa chọn');
    error.statusCode = 400;
    throw error;
  }
  if (pollOptions.length === 0) {
    return null;
  }

  const seen = new Set();
  const normalizedOptions: string[] = [];
  for (const option of pollOptions) {
    if (typeof option !== 'string') {
      const error = new Error('Lựa chọn thăm dò phải là văn bản');
      error.statusCode = 400;
      throw error;
    }
    const text = normalizeBody(option)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      const error = new Error('Lựa chọn thăm dò không được để trống');
      error.statusCode = 400;
      throw error;
    }
    if (text.length > MAX_POLL_OPTION_LENGTH) {
      const error = new Error('Mỗi lựa chọn thăm dò tối đa ' + MAX_POLL_OPTION_LENGTH + ' ký tự');
      error.statusCode = 400;
      throw error;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      const error = new Error('Các lựa chọn thăm dò không được trùng nhau');
      error.statusCode = 400;
      throw error;
    }
    seen.add(key);
    normalizedOptions.push(text);
    if (normalizedOptions.length > MAX_POLL_OPTIONS) {
      const error = new Error('Thăm dò có tối đa ' + MAX_POLL_OPTIONS + ' lựa chọn');
      error.statusCode = 400;
      throw error;
    }
  }

  if (normalizedOptions.length < MIN_POLL_OPTIONS) {
    const error = new Error('Thăm dò cần ít nhất ' + MIN_POLL_OPTIONS + ' lựa chọn');
    error.statusCode = 400;
    throw error;
  }
  const options = normalizedOptions.map((text, index) => ({ id: String(index + 1), text, votes: 0 }));
  return { options, totalVotes: 0 };
}

function publicVotes(post) {
  const up = Number(post?.votes?.up || 0);
  const down = Number(post?.votes?.down || 0);
  return { up, down, score: up - down };
}

function isAccountReactionKey(key) {
  return String(key || '').startsWith('account:');
}

/** Recount reactions from account keys only; drop legacy anon fingerprints. */
function syncPostReactions(post) {
  const rawVoters = post?.reactionVoters && typeof post.reactionVoters === 'object' ? post.reactionVoters : {};
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawVoters)) {
    const type = String(value || '');
    if (isAccountReactionKey(key) && POST_REACTION_TYPES.has(type)) {
      cleaned[key] = type;
    }
  }
  post.reactionVoters = cleaned;
  const reactions = Object.fromEntries([...POST_REACTION_TYPES].map((type) => [type, 0]));
  for (const type of Object.values(cleaned)) {
    reactions[type] += 1;
  }
  post.reactions = reactions;
  return reactions;
}

function publicReactions(post) {
  // Prefer live account-only recount when voter map is present so legacy anon
  // keys never inflate public counts after the account-only reaction change.
  if (post?.reactionVoters && typeof post.reactionVoters === 'object') {
    const reactions = Object.fromEntries([...POST_REACTION_TYPES].map((type) => [type, 0]));
    for (const [key, value] of Object.entries(post.reactionVoters)) {
      const type = String(value || '');
      if (isAccountReactionKey(key) && POST_REACTION_TYPES.has(type)) {
        reactions[type] += 1;
      }
    }
    return reactions;
  }
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

function normalizePriorityFilters(filters: AnyRecord = {}) {
  const priority = String(filters.priority || '').toLowerCase();
  const sort = String(filters.sort || '').toLowerCase();
  return {
    priority: PRIORITY_FILTERS.has(priority) ? priority : '',
    sort: PRIORITY_SORTS.has(sort) ? sort : 'priority'
  };
}

function matchesPriorityFilter(item: AnyRecord, filters: AnyRecord = {}) {
  const { priority } = normalizePriorityFilters(filters);
  return !priority || item.moderationPriority?.level === priority;
}

function compareAdminPriority(filters: AnyRecord = {}) {
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
  return SUPPORTED_MEDIA_TYPES.has(type);
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

  const parsedData = parseStrictMediaDataUrl(media.dataUrl, type, 'Dữ liệu tệp không hợp lệ');
  const dataUrl = parsedData.dataUrl;

  const maxBytes = readPositiveInteger(process.env.MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES);
  // Limit by decoded payload size (file size), not base64 data-URL string length.
  if (parsedData.bytes.length > maxBytes) {
    const error = new Error(type.startsWith('image/') ? 'Ảnh quá lớn' : 'Video quá lớn');
    error.statusCode = 413;
    throw error;
  }

  const safeMedia: AnyRecord = {
    name: sanitizeFileName(media.name),
    type,
    dataUrl,
    spoiler: Boolean(media.spoiler),
    sizeBytes: sanitizePositiveInteger(media.sizeBytes, maxBytes) ?? parsedData.bytes.length
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

function validateMediaList({ image, images }: AnyRecord = {}) {
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

function unavailableModeration(label = 'Media Scan Unavailable') {
  return { status: 'Unavailable', labels: [label] };
}

function mergeModerationResults(...results: any[]): AnyRecord {
  const confidences = results
    .map((result) => Number(result?.confidence))
    .filter((confidence) => Number.isFinite(confidence));
  const status = results.some((result) => result?.status === 'Flagged')
    ? 'Flagged'
    : results.length === 0 || results.some((result) => result?.status === 'Unavailable')
      ? 'Unavailable'
      : 'Safe';
  const merged: AnyRecord = {
    status,
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
    return unavailableModeration(
      media?.type?.startsWith('video/') ? 'Video Review Required' : 'Media Scan Unavailable'
    );
  }

  const results = [];
  if (typeof ai.moderateImage === 'function') {
    try {
      results.push(await ai.moderateImage(image));
    } catch {
      results.push(unavailableModeration());
    }
  } else {
    results.push(unavailableModeration());
  }

  if (typeof ai.caption === 'function') {
    try {
      results.push(await moderateOcrText(ai, await ai.caption(image, 'ocr')));
    } catch {
      results.push(unavailableModeration('OCR Scan Unavailable'));
    }
  } else {
    results.push(unavailableModeration('OCR Scan Unavailable'));
  }

  return mergeModerationResults(...results);
}

async function scanUploadsForModeration(ai, safeMedia) {
  if (!safeMedia.length) {
    return { status: 'Safe', labels: [] };
  }
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
  if (!SUPPORTED_IMAGE_TYPES.has(type)) {
    const error = new Error('Thumbnail ảnh không hợp lệ');
    error.statusCode = 400;
    throw error;
  }

  const parsedData = parseStrictMediaDataUrl(thumbnail.dataUrl, type, 'Dữ liệu thumbnail không hợp lệ');
  const dataUrl = parsedData.dataUrl;

  const maxBytes = readPositiveInteger(process.env.MAX_THUMBNAIL_BYTES, DEFAULT_MAX_THUMBNAIL_BYTES);
  if (parsedData.bytes.length > maxBytes) {
    const error = new Error('Thumbnail ảnh quá lớn');
    error.statusCode = 413;
    throw error;
  }

  const safeThumbnail: AnyRecord = {
    name: sanitizeFileName(thumbnail.name || 'thumbnail.jpg'),
    type,
    dataUrl,
    sizeBytes: sanitizePositiveInteger(thumbnail.sizeBytes, maxBytes) ?? parsedData.bytes.length
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
  try {
    for (const media of safeMedia) {
      stored.push(await imageStorage.save(media));
    }
  } catch (error) {
    await deleteStoredMedia(imageStorage, stored).catch(() => undefined);
    throw error;
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
    links: serializePostLinks(thread.links),
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
    diceRolls: Array.isArray(comment.diceRolls) ? comment.diceRolls : [],
    links: serializePostLinks(comment.links)
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

function postHasVideo(post: AnyRecord = {}) {
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

function threadNavigationItem(thread) {
  if (!thread) {
    return null;
  }
  return {
    id: thread.id,
    globalNumber: thread.globalNumber,
    subject: thread.subject ? sanitizeText(thread.subject) : ''
  };
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

function recommendedThreadFeatures(state: AnyRecord, thread: AnyRecord, referenceDate: Date, context: AnyRecord = {}) {
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

function incrementHotBoardMetric(metrics: Map<string, AnyRecord>, boardSlug: string, type: string, createdAt: string) {
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

function latestPostsFromState(state: AnyRecord, limit = 10) {
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
}

function hotBoardsFromState(state: AnyRecord, limit = 8, referenceDate = new Date()) {
  const publicBoards = state.boards.filter(publicBoard);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 8, publicBoards.length || 1));
  const oneDayAgo = referenceDate.getTime() - 24 * 60 * 60 * 1000;
  const inLast24h = (post) => new Date(post.createdAt).getTime() >= oneDayAgo;
  const activeThreadIds = new Set(
    state.threads
      .filter((thread) => publicThread(state, thread) && !thread.isArchived)
      .map((thread) => thread.id)
  );
  const metrics = new Map<string, AnyRecord>(
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
}

function campusPulseFromState(state: AnyRecord, limit = 12, referenceDate = new Date()) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 24));
  const oneDayAgo = referenceDate.getTime() - 24 * 60 * 60 * 1000;
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
}

function statsFromState(state: AnyRecord, referenceDate = new Date(), realtime: AnyRecord = {}) {
  const publicThreads = state.threads.filter((thread) => publicThread(state, thread));
  const publicComments = state.comments.filter((comment) => publicComment(state, comment));
  const publicPosts = [...publicThreads, ...publicComments];
  const activeBoards = new Set(publicThreads.map((thread) => thread.boardSlug));
  const publicBoards = state.boards.filter(publicBoard);
  const files = publicPosts.flatMap((post) => mediaItems(post));
  const nowMs = referenceDate.getTime();
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
}

function homeSnapshotFromState(
  state: AnyRecord,
  { lifecycle = THREAD_LIFECYCLE, referenceDate = new Date(), realtime = {} }: AnyRecord = {}
) {
  const boards = state.boards
    .filter(publicBoard)
    .map((board) => serializeBoard(board, { retentionDefaults: lifecycle }));
  const activeThreads = state.threads.filter((thread) => publicThread(state, thread) && !thread.isArchived);
  const activeThreadIds = new Set(activeThreads.map((thread) => thread.id));
  const boardPostCounts = Object.fromEntries(boards.map((board) => [board.slug, 0]));

  for (const thread of activeThreads) {
    boardPostCounts[thread.boardSlug] = Number(boardPostCounts[thread.boardSlug] || 0) + 1;
  }
  for (const comment of state.comments) {
    if (publicPost(comment) && activeThreadIds.has(comment.threadId)) {
      boardPostCounts[comment.boardSlug] = Number(boardPostCounts[comment.boardSlug] || 0) + 1;
    }
  }

  const popularThreads = [...activeThreads]
    .sort((left, right) => String(right.bumpedAt ?? '').localeCompare(String(left.bumpedAt ?? '')))
    .slice(0, 8)
    .map((thread) => serializeThread(thread, state.comments));

  return {
    generatedAt: referenceDate.toISOString(),
    boards,
    boardPostCounts,
    popularThreads,
    latestPosts: latestPostsFromState(state, 10),
    hotBoards: hotBoardsFromState(state, 8, referenceDate),
    campusPulse: campusPulseFromState(state, 12, referenceDate),
    stats: statsFromState(state, referenceDate, realtime)
  };
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

function matchesAdminFilters(item: AnyRecord, filters: AnyRecord = {}, dateField = 'createdAt') {
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

function serializeAdminPost(postType: string, post: AnyRecord, state: AnyRecord, priorityContext: AnyRecord = {}) {
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
  if (moderation.status === 'Unavailable') {
    return true;
  }
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

function serializeAdminReport(report: AnyRecord, state: AnyRecord, priorityContext: AnyRecord = {}) {
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

const CHAT_QUESTION_MAX_CHARS = 1_000;
const CHAT_HISTORY_MAX_MESSAGES = 6;
const CHAT_HISTORY_MESSAGE_MAX_CHARS = 800;
const CHAT_CONTEXT_MAX_CHARS = 16_000;
const CHAT_CONTEXT_TEXT_MAX_CHARS = 600;
const CHAT_BOARD_THREAD_LIMIT = 24;
const CHAT_THREAD_COMMENT_LIMIT = 30;
const CHAT_SIMILAR_THREAD_LIMIT = 5;
const CHAT_SIMILAR_MIN_SCORE = 0.08;
const CHAT_SOURCE_LIMIT = 24;
const CHAT_SCOPES = new Set(['site', 'board', 'thread']);
const CHAT_PAGES = new Set([
  'home',
  'policy',
  'board',
  'catalog',
  'archive',
  'thread',
  'register',
  'login',
  'forgot',
  'account',
  'admin'
]);
const CHAT_SIMILAR_QUESTION_RE =
  /tương tự|tuong tu|giống|giong|similar|related|cùng chủ đề|cung chu de|gợi ý thread|goi y thread/i;
const CHAT_SUMMARY_QUESTION_RE =
  /tóm tắt|tom tat|summary|summarize|ý chính|y chinh|điểm chính|diem chinh|nội dung chính|noi dung chinh/i;
const CHAT_ATTACHMENT_QUESTION_RE =
  /đính kèm|dinh kem|file|ảnh|anh|hình|hinh|media|attachment|link ngoài|link ngoai|url/i;
const CHAT_QUOTE_QUESTION_RE = /trích dẫn|trich dan|>>|quote|báo giá|bao gia|trích|trich/i;

function chatRequestError(message: string, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeChatQuestion(value: unknown) {
  const question = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (!question) {
    throw chatRequestError('Câu hỏi là bắt buộc');
  }
  if (question.length > CHAT_QUESTION_MAX_CHARS) {
    throw chatRequestError(`Câu hỏi tối đa ${CHAT_QUESTION_MAX_CHARS} ký tự`);
  }
  return redactSensitiveText(question);
}

function normalizeChatHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(-CHAT_HISTORY_MAX_MESSAGES)
    .map((message) => {
      const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : '';
      const content = redactSensitiveText(String(message?.content ?? '').trim()).slice(
        0,
        CHAT_HISTORY_MESSAGE_MAX_CHARS
      );
      return role && content ? { role, content } : null;
    })
    .filter(Boolean);
}

function normalizeChatScope(value: unknown) {
  const scope = String(value ?? 'site').trim().toLowerCase();
  if (!CHAT_SCOPES.has(scope)) {
    throw chatRequestError('Phạm vi chatbot không hợp lệ');
  }
  return scope;
}

function normalizeChatPage(value: unknown) {
  const page = String(value ?? 'home').trim().toLowerCase();
  return CHAT_PAGES.has(page) ? page : 'home';
}

function compactChatText(value: unknown, maxChars = CHAT_CONTEXT_TEXT_MAX_CHARS) {
  return redactSensitiveText(String(value ?? '').replace(/\s+/g, ' ').trim()).slice(0, maxChars);
}

function createChatContextWriter(maxChars = CHAT_CONTEXT_MAX_CHARS) {
  const lines: string[] = [];
  let length = 0;
  return {
    push(value: unknown) {
      const line = String(value ?? '').trim();
      if (!line || length >= maxChars) {
        return false;
      }
      const separatorLength = lines.length ? 1 : 0;
      const available = maxChars - length - separatorLength;
      if (available <= 0) {
        return false;
      }
      const next = line.slice(0, available);
      lines.push(next);
      length += separatorLength + next.length;
      return next.length === line.length;
    },
    text() {
      return lines.join('\n');
    }
  };
}

function createChatSourceCollector(limit = CHAT_SOURCE_LIMIT) {
  const sources: AnyRecord[] = [];
  const seen = new Set<string>();
  return {
    add(source: AnyRecord) {
      const href = String(source?.href || '').trim();
      if (!href || !href.startsWith('#thread/') || sources.length >= limit) {
        return false;
      }
      const key = `${source.kind || 'post'}:${href}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      sources.push({
        kind: source.kind === 'similar' ? 'similar' : source.kind === 'thread' ? 'thread' : 'post',
        label: compactChatText(source.label || href, 120),
        href: href.slice(0, 400),
        threadId: String(source.threadId || '').slice(0, 120),
        ...(Number.isFinite(Number(source.globalNumber))
          ? { globalNumber: Number(source.globalNumber) }
          : {})
      });
      return true;
    },
    list() {
      return sources;
    }
  };
}

function chatThreadHref(threadId: unknown) {
  const id = String(threadId ?? '').trim();
  return id ? `#thread/${encodeURIComponent(id)}` : '';
}

function chatPostHref(threadId: unknown, globalNumber: unknown) {
  const base = chatThreadHref(threadId);
  const number = Number(globalNumber);
  if (!base || !Number.isSafeInteger(number) || number <= 0) {
    return base;
  }
  return `${base}?p=${encodeURIComponent(String(number))}`;
}

function referencedChatPostNumbers(question = '') {
  const values = new Set<number>();
  for (const match of String(question).matchAll(/(?:>>|No\.?\s*)(\d{1,12})/gi)) {
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value > 0) {
      values.add(value);
    }
  }
  return values;
}

function quotedPostNumbersFromBody(body = '') {
  const values = new Set<number>();
  for (const match of String(body).matchAll(/>>(\d{1,12})/g)) {
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value > 0) {
      values.add(value);
    }
  }
  return values;
}

function chatAttachmentSummary(post: AnyRecord) {
  const items = mediaItems(post);
  if (!items.length) {
    return '';
  }
  return items
    .slice(0, 4)
    .map((item, index) => {
      const name = compactChatText(item?.name || item?.originalName || item?.filename || `file-${index + 1}`, 80);
      const type = compactChatText(item?.type || item?.mimeType || 'file', 48);
      const spoiler = item?.spoiler ? ', spoiler' : '';
      return `${name} (${type}${spoiler})`;
    })
    .join('; ');
}

function chatExternalLinksSummary(post: AnyRecord) {
  const links = serializePostLinks(post?.links);
  if (!links.length) {
    return '';
  }
  return links
    .slice(0, 4)
    .map((link) => {
      const title = compactChatText(link.title || link.domain || link.url, 100);
      const url = compactChatText(link.url, 180);
      const kind = compactChatText(link.kind || 'link', 24);
      return `${title} <${url}> [${kind}]`;
    })
    .join('; ');
}

function chatPostMetaSuffix(post: AnyRecord) {
  const parts: string[] = [];
  const quotes = [...quotedPostNumbersFromBody(post?.body)].slice(0, 8);
  if (quotes.length) {
    parts.push(`trích dẫn >>${quotes.join(', >>')}`);
  }
  const attachments = chatAttachmentSummary(post);
  if (attachments) {
    parts.push(`đính kèm: ${attachments}`);
  }
  const externalLinks = chatExternalLinksSummary(post);
  if (externalLinks) {
    parts.push(`link: ${externalLinks}`);
  }
  return parts.length ? ` | ${parts.join(' | ')}` : '';
}

function formatChatPostLine(post: AnyRecord, threadId: unknown, bodyMax = CHAT_CONTEXT_TEXT_MAX_CHARS) {
  const href = chatPostHref(threadId, post.globalNumber);
  return `- No.${post.globalNumber} (chi tiết: ${href}): ${compactChatText(post.body, bodyMax)}${chatPostMetaSuffix(post)}`;
}

function formatChatThreadLine(thread: AnyRecord, state: AnyRecord, { includeBoard = false } = {}) {
  const href = chatThreadHref(thread.id);
  const replyCount = publicReplyCount(state, thread.id);
  const boardPart = includeBoard ? ` tại /${compactChatText(thread.boardSlug, 80)}/` : '';
  const subject = compactChatText(thread.subject, 180);
  return `- No.${thread.globalNumber}${boardPart} (mở: ${href}, ${replyCount} phản hồi): ${subject} ${compactChatText(thread.body)}${chatPostMetaSuffix(thread)}`;
}

function chatTokenSet(text: unknown) {
  return new Set(pulseKeywords(String(text ?? '')));
}

function chatTokenJaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  return intersection / (left.size + right.size - intersection);
}

function scoreTextAgainstQuestion(text: unknown, questionTokens: Set<string>) {
  if (!questionTokens.size) {
    return 0;
  }
  const haystack = String(text ?? '');
  const textTokens = chatTokenSet(haystack);
  let hits = 0;
  for (const token of questionTokens) {
    if (textTokens.has(token) || haystack.toLowerCase().includes(token)) {
      hits += 1;
    }
  }
  return hits / questionTokens.size;
}

function readCachedChatBullets(state: AnyRecord, cacheKey: string) {
  const cached = state?.aiSummaryCache?.[cacheKey];
  if (!cached || !Array.isArray(cached.bullets)) {
    return [];
  }
  return cached.bullets
    .map((bullet: unknown) => compactChatText(bullet, 280))
    .filter(Boolean)
    .slice(0, 8);
}

function pushCachedSummary(writer: { push: (value: unknown) => boolean }, label: string, bullets: string[]) {
  if (!bullets.length) {
    return false;
  }
  writer.push(`${label} (đã cache; chỉ tham khảo, có thể cũ hơn bài mới):`);
  for (const bullet of bullets) {
    writer.push(`• ${bullet}`);
  }
  return true;
}

function selectThreadCommentsForChat(comments: AnyRecord[], question: string, limit = CHAT_THREAD_COMMENT_LIMIT) {
  if (!comments.length || limit <= 0) {
    return [];
  }
  const referencedNumbers = referencedChatPostNumbers(question);
  for (const comment of comments.slice(-Math.min(comments.length, limit * 2))) {
    for (const number of quotedPostNumbersFromBody(comment?.body)) {
      referencedNumbers.add(number);
    }
  }
  const referenced = comments.filter((comment) => referencedNumbers.has(Number(comment.globalNumber)));
  const remainingSlots = Math.max(0, limit - referenced.length);
  if (!remainingSlots) {
    return uniqueById(referenced)
      .sort((left, right) => Number(left.globalNumber) - Number(right.globalNumber))
      .slice(-limit);
  }

  const questionTokens = chatTokenSet(question);
  const recentPool = comments.slice(-Math.max(limit * 2, 20));
  const relevantPool =
    questionTokens.size > 0
      ? [...comments]
          .map((comment) => ({
            comment,
            score: scoreTextAgainstQuestion(
              `${comment.body || ''} ${chatAttachmentSummary(comment)} ${chatExternalLinksSummary(comment)}`,
              questionTokens
            )
          }))
          .filter((entry) => entry.score > 0)
          .sort(
            (left, right) =>
              right.score - left.score || Number(right.comment.globalNumber) - Number(left.comment.globalNumber)
          )
          .map((entry) => entry.comment)
      : [];

  const relevantCount = Math.min(remainingSlots, Math.max(Math.ceil(remainingSlots * 0.55), questionTokens.size ? 4 : 0));
  const relevant = relevantPool.slice(0, relevantCount);
  const recentCount = Math.max(0, remainingSlots - relevant.length);
  const recent = recentPool.slice(-recentCount);
  return uniqueById([...referenced, ...relevant, ...recent])
    .sort((left, right) => Number(left.globalNumber) - Number(right.globalNumber))
    .slice(-limit);
}

function rankThreadsForChat(
  threads: AnyRecord[],
  question: string,
  {
    limit,
    fallbackSort
  }: {
    limit: number;
    fallbackSort: (left: AnyRecord, right: AnyRecord) => number;
  }
) {
  if (!threads.length || limit <= 0) {
    return [];
  }
  const questionTokens = chatTokenSet(question);
  if (!questionTokens.size) {
    return [...threads].sort(fallbackSort).slice(0, limit);
  }
  return [...threads]
    .map((thread) => ({
      thread,
      score: scoreTextAgainstQuestion(
        `${thread.subject || ''} ${thread.body || ''} ${chatAttachmentSummary(thread)}`,
        questionTokens
      )
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return fallbackSort(left.thread, right.thread);
    })
    .slice(0, limit)
    .map((entry) => entry.thread);
}

function rankChatSources(sources: AnyRecord[], question: string, limit = 12) {
  if (!Array.isArray(sources) || !sources.length) {
    return [];
  }
  const questionTokens = chatTokenSet(question);
  const scored = sources.map((source, index) => ({
    source,
    index,
    score:
      scoreTextAgainstQuestion(`${source.label || ''} ${source.href || ''}`, questionTokens) +
      (source.kind === 'post' ? 0.05 : 0) +
      (source.kind === 'similar' && CHAT_SIMILAR_QUESTION_RE.test(question) ? 0.15 : 0)
  }));
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  // Keep OP-ish early sources if scores are flat: fall back to original order for top slice mix
  const top = scored.slice(0, limit).map((entry) => entry.source);
  return top;
}

function buildChatFollowUps(scope: string, question: string) {
  const q = String(question || '');
  if (scope === 'thread') {
    const followUps = [
      'Tóm tắt ngắn hơn bằng 3 gạch đầu dòng.',
      'Những ý nào còn tranh luận?',
      'Tìm chủ đề tương tự.',
      'Bài nào có đính kèm hoặc link đáng xem?'
    ];
    if (CHAT_SUMMARY_QUESTION_RE.test(q)) {
      return ['Điểm nào chưa rõ trong thread?', 'Tìm chủ đề tương tự.', 'Có file/link đính kèm không?'];
    }
    if (CHAT_SIMILAR_QUESTION_RE.test(q)) {
      return ['Tóm tắt chủ đề hiện tại.', 'So sánh nhanh với chủ đề tương tự đầu tiên.'];
    }
    if (CHAT_ATTACHMENT_QUESTION_RE.test(q) || CHAT_QUOTE_QUESTION_RE.test(q)) {
      return ['Tóm tắt nội dung chính của thread.', 'Tìm chủ đề tương tự.'];
    }
    return followUps;
  }
  if (scope === 'board') {
    return [
      'Chủ đề nào đáng đọc nhất lúc này?',
      'Tóm tắt các chủ đề đang hiển thị.',
      'Chủ đề nào có đính kèm?',
      'Bảng này dành cho nội dung gì?'
    ];
  }
  return [
    'Tôi nên bắt đầu từ bảng nào?',
    'Gợi ý vài chủ đề gần đây để đọc.',
    '36chan hoạt động như thế nào?',
    'Trang nội quy nói gì quan trọng?'
  ];
}

function findSimilarPublicThreads(
  state: AnyRecord,
  sourceThread: AnyRecord,
  { limit = CHAT_SIMILAR_THREAD_LIMIT, boardOnly = false } = {}
) {
  const sourceTokens = chatTokenSet(`${sourceThread.subject || ''} ${sourceThread.body || ''}`);
  if (sourceTokens.size < 2) {
    return [];
  }
  return state.threads
    .filter(
      (thread) =>
        thread.id !== sourceThread.id &&
        publicThread(state, thread) &&
        !thread.isArchived &&
        (!boardOnly || thread.boardSlug === sourceThread.boardSlug)
    )
    .map((thread) => ({
      thread,
      score: chatTokenJaccard(sourceTokens, chatTokenSet(`${thread.subject || ''} ${thread.body || ''}`))
    }))
    .filter((entry) => entry.score >= CHAT_SIMILAR_MIN_SCORE)
    .sort(
      (left, right) =>
        right.score - left.score ||
        String(right.thread.bumpedAt || right.thread.createdAt || '').localeCompare(
          String(left.thread.bumpedAt || left.thread.createdAt || '')
        )
    )
    .slice(0, limit);
}

function boardChatHeader(writer, board, page = 'board') {
  const path = compactChatText(board.path || `/${board.slug}/`, 80);
  const name = compactChatText(board.name || board.title || board.slug, 120);
  writer.push(`Trang hiện tại: ${page}. Bảng ${path} — ${name}.`);
  if (board.description) {
    writer.push(`Mô tả bảng: ${compactChatText(board.description, 400)}`);
  }
  const rules = Array.isArray(board.rules) ? board.rules : [];
  if (rules.length) {
    writer.push(`Nội quy riêng của bảng: ${rules.map((rule) => compactChatText(rule, 240)).filter(Boolean).join(' | ')}`);
  }
  writer.push(
    'Hướng dẫn liên kết: dùng link hash #thread/{id} hoặc #thread/{id}?p={No.} để dẫn người dùng xem chi tiết bài gốc.'
  );
}

function buildSiteChatContext(state: AnyRecord, page = 'home', question = '') {
  const writer = createChatContextWriter();
  const sources = createChatSourceCollector();
  const siteContent = normalizeSiteContent(state.adminSettings?.siteContent ?? DEFAULT_SITE_CONTENT);
  writer.push(`Trang hiện tại: ${page}. Đây là 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.`);
  writer.push(`Câu hỏi người dùng (để ưu tiên ngữ cảnh phù hợp): ${compactChatText(question, 400)}`);
  writer.push(`Tiêu đề chính sách: ${compactChatText(siteContent.policyTitle, 180)}`);
  writer.push(`Giới thiệu chính sách: ${compactChatText(siteContent.policySubtitle, 400)}`);
  writer.push(`Nội quy: ${siteContent.rules.map((line) => compactChatText(line, 300)).join(' | ')}`);
  writer.push(`Riêng tư: ${siteContent.privacy.map((line) => compactChatText(line, 300)).join(' | ')}`);
  writer.push(`Thông tin AI: ${siteContent.ai.map((line) => compactChatText(line, 300)).join(' | ')}`);
  writer.push(`Báo cáo: ${siteContent.report.map((line) => compactChatText(line, 300)).join(' | ')}`);
  writer.push(`Kháng nghị: ${compactChatText(siteContent.appealIntro, 500)}`);
  writer.push(`Góp ý: ${siteContent.feedback.map((line) => compactChatText(line, 300)).join(' | ')}`);
  writer.push(`Liên hệ: ${siteContent.contact.map((line) => compactChatText(line, 300)).join(' | ')}`);
  writer.push(`Cảnh báo PII: ${compactChatText(siteContent.pii, 800)}`);
  writer.push(
    'Hướng dẫn liên kết: khi nhắc chủ đề, dùng #thread/{id}; khi nhắc bài, dùng #thread/{id}?p={No.} để người dùng bấm xem chi tiết.'
  );

  const boards = state.boards.filter(publicBoard);
  const questionTokens = chatTokenSet(question);
  const rankedBoards = questionTokens.size
    ? [...boards]
        .map((board) => ({
          board,
          score: scoreTextAgainstQuestion(
            `${board.name || ''} ${board.description || ''} ${(board.rules || []).join(' ')}`,
            questionTokens
          )
        }))
        .sort((left, right) => right.score - left.score)
        .map((entry) => entry.board)
    : boards;
  writer.push('Các bảng công khai:');
  for (const board of rankedBoards) {
    writer.push(
      `- ${compactChatText(board.path || `/${board.slug}/`, 80)} ${compactChatText(board.name || board.slug, 120)}: ${compactChatText(board.description, 280)}`
    );
  }

  const candidateThreads = state.threads.filter((thread) => publicThread(state, thread) && !thread.isArchived);
  const rankedThreads = rankThreadsForChat(candidateThreads, question, {
    limit: 12,
    fallbackSort: (left, right) =>
      String(right.bumpedAt || right.createdAt || '').localeCompare(String(left.bumpedAt || left.createdAt || ''))
  });
  if (rankedThreads.length) {
    writer.push(
      questionTokens.size
        ? 'Chủ đề công khai liên quan/gần đây (đã xếp theo độ khớp câu hỏi):'
        : 'Một số chủ đề công khai gần đây:'
    );
    for (const thread of rankedThreads) {
      writer.push(formatChatThreadLine(thread, state, { includeBoard: true }));
      sources.add({
        kind: 'thread',
        label: `Chủ đề No.${thread.globalNumber}`,
        href: chatThreadHref(thread.id),
        threadId: thread.id,
        globalNumber: thread.globalNumber
      });
    }
  }
  return { scope: 'site', label: '36chan', context: writer.text(), sources: sources.list() };
}

function buildBoardChatContext(state: AnyRecord, boardSlug: unknown, page = 'board', question = '') {
  const slug = String(boardSlug ?? '').trim();
  if (!slug) {
    throw chatRequestError('Thiếu bảng cho chatbot');
  }
  const board = findBoard(state, slug, { publicOnly: true });
  if (!board) {
    throw chatRequestError('Không tìm thấy bảng', 404);
  }
  const writer = createChatContextWriter();
  const sources = createChatSourceCollector();
  boardChatHeader(writer, board, page);
  writer.push(`Câu hỏi người dùng (để ưu tiên ngữ cảnh phù hợp): ${compactChatText(question, 400)}`);
  pushCachedSummary(writer, 'Tóm tắt bảng đã cache', readCachedChatBullets(state, `board:${slug}`));
  const archived = page === 'archive';
  const boardThreads = state.threads.filter(
    (thread) => thread.boardSlug === slug && publicPost(thread) && Boolean(thread.isArchived) === archived
  );
  const threads = rankThreadsForChat(boardThreads, question, {
    limit: CHAT_BOARD_THREAD_LIMIT,
    fallbackSort: compareBoardThreads
  });
  writer.push(
    archived
      ? 'Các chủ đề công khai trong kho lưu trữ (ưu tiên khớp câu hỏi):'
      : 'Các chủ đề công khai đang hoạt động (ưu tiên khớp câu hỏi):'
  );
  for (const thread of threads) {
    writer.push(formatChatThreadLine(thread, state));
    sources.add({
      kind: 'thread',
      label: `No.${thread.globalNumber}${thread.subject ? ` · ${compactChatText(thread.subject, 60)}` : ''}`,
      href: chatThreadHref(thread.id),
      threadId: thread.id,
      globalNumber: thread.globalNumber
    });
  }
  if (!threads.length) {
    writer.push('Hiện chưa có chủ đề công khai phù hợp trong phạm vi này.');
  }
  return {
    scope: 'board',
    label: `${compactChatText(board.path || `/${board.slug}/`, 80)} ${compactChatText(board.name || board.slug, 120)}`.trim(),
    context: writer.text(),
    sources: sources.list()
  };
}

function buildThreadChatContext(state: AnyRecord, threadId: unknown, question: string) {
  const id = String(threadId ?? '').trim();
  if (!id) {
    throw chatRequestError('Thiếu chủ đề cho chatbot');
  }
  const thread = state.threads.find((item) => item.id === id && publicThread(state, item));
  if (!thread) {
    throw chatRequestError('Không tìm thấy chủ đề', 404);
  }
  const board = findBoard(state, thread.boardSlug, { publicOnly: true });
  const writer = createChatContextWriter();
  const sources = createChatSourceCollector();
  if (board) {
    boardChatHeader(writer, board, 'thread');
  }
  // Prefer subject; fall back to body preview so labels match the public UI title.
  const subject = compactChatText(thread.subject || '', 220);
  const bodyPreview = compactChatText(thread.body || '', 80);
  const title = subject || bodyPreview;
  const threadHref = chatThreadHref(thread.id);
  writer.push(`Câu hỏi người dùng (để ưu tiên phản hồi liên quan): ${compactChatText(question, 400)}`);
  if (title) {
    writer.push(
      `Chủ đề hiện tại: No.${thread.globalNumber}, tiêu đề "${compactChatText(title, 220)}" (mở: ${threadHref}).`
    );
  } else {
    writer.push(`Chủ đề hiện tại: No.${thread.globalNumber} (mở: ${threadHref}).`);
  }
  pushCachedSummary(writer, 'Tóm tắt thread đã cache', readCachedChatBullets(state, `thread:${id}`));
  writer.push(`Bài mở đầu (chi tiết: ${chatPostHref(thread.id, thread.globalNumber)}): ${compactChatText(thread.body, 1_000)}${chatPostMetaSuffix(thread)}`);
  sources.add({
    kind: 'post',
    label: `OP No.${thread.globalNumber}`,
    href: chatPostHref(thread.id, thread.globalNumber),
    threadId: thread.id,
    globalNumber: thread.globalNumber
  });

  const comments = state.comments
    .filter((comment) => comment.threadId === id && publicPost(comment))
    .sort((left, right) => Number(left.globalNumber) - Number(right.globalNumber));
  const commentsByNumber = new Map(comments.map((comment) => [Number(comment.globalNumber), comment]));
  const selected = selectThreadCommentsForChat(comments, question, CHAT_THREAD_COMMENT_LIMIT);
  const referencedNumbers = referencedChatPostNumbers(question);
  for (const post of [thread, ...selected]) {
    for (const number of quotedPostNumbersFromBody(post?.body)) {
      referencedNumbers.add(number);
    }
  }

  writer.push(
    `Phản hồi công khai (${comments.length} tổng cộng, cung cấp ${selected.length} phản hồi liên quan/trích dẫn/gần nhất):`
  );
  for (const comment of selected) {
    writer.push(formatChatPostLine(comment, thread.id));
    sources.add({
      kind: 'post',
      label: `No.${comment.globalNumber}`,
      href: chatPostHref(thread.id, comment.globalNumber),
      threadId: thread.id,
      globalNumber: comment.globalNumber
    });
  }
  if (!selected.length) {
    writer.push('Chủ đề chưa có phản hồi công khai.');
  }

  // If quotes point to posts outside the selected window, append short targets.
  const missingQuoteTargets: AnyRecord[] = [];
  for (const number of referencedNumbers) {
    if (number === Number(thread.globalNumber) || selected.some((item) => Number(item.globalNumber) === number)) {
      continue;
    }
    const comment = commentsByNumber.get(number);
    if (comment) {
      missingQuoteTargets.push(comment);
    }
    if (missingQuoteTargets.length >= 8) {
      break;
    }
  }
  if (missingQuoteTargets.length) {
    writer.push('Bài được trích dẫn (>>No.) ngoài cửa sổ phản hồi đã chọn:');
    for (const comment of missingQuoteTargets) {
      writer.push(formatChatPostLine(comment, thread.id, 360));
      sources.add({
        kind: 'post',
        label: `No.${comment.globalNumber}`,
        href: chatPostHref(thread.id, comment.globalNumber),
        threadId: thread.id,
        globalNumber: comment.globalNumber
      });
    }
  }

  const similarLimit = CHAT_SIMILAR_QUESTION_RE.test(String(question || ''))
    ? CHAT_SIMILAR_THREAD_LIMIT
    : Math.min(3, CHAT_SIMILAR_THREAD_LIMIT);
  const similar = findSimilarPublicThreads(state, thread, { limit: similarLimit, boardOnly: false });
  if (similar.length) {
    writer.push('Chủ đề công khai tương tự (điểm giao từ khóa; chỉ tham khảo):');
    for (const entry of similar) {
      const similarTitle =
        compactChatText(entry.thread.subject || '', 120) || compactChatText(entry.thread.body || '', 80) || `No.${entry.thread.globalNumber}`;
      writer.push(
        `- No.${entry.thread.globalNumber} tại /${compactChatText(entry.thread.boardSlug, 80)}/ (mở: ${chatThreadHref(entry.thread.id)}, điểm ${entry.score.toFixed(2)}): ${similarTitle}`
      );
      sources.add({
        kind: 'similar',
        label: `Tương tự No.${entry.thread.globalNumber}`,
        href: chatThreadHref(entry.thread.id),
        threadId: entry.thread.id,
        globalNumber: entry.thread.globalNumber
      });
    }
  } else if (CHAT_SIMILAR_QUESTION_RE.test(String(question || ''))) {
    writer.push('Không tìm thấy chủ đề công khai tương tự đủ gần trong dữ liệu hiện có.');
  }

  writer.push(
    'Gợi ý trả lời: mở đầu bằng câu trả lời trực tiếp; trích No. + link #thread/...; nêu đính kèm/trích dẫn nếu liên quan; kết thúc bằng 1 gợi ý bước tiếp theo ngắn.'
  );

  const threadLabel = title
    ? `Chủ đề "${title.length > 48 ? `${title.slice(0, 45).trimEnd()}...` : title}"`
    : `Chủ đề No.${thread.globalNumber}`;
  return {
    scope: 'thread',
    label: threadLabel,
    context: writer.text(),
    sources: sources.list()
  };
}

function buildChatContext(
  state: AnyRecord,
  { scope, page, boardSlug, threadId, question }: AnyRecord
) {
  if (scope === 'thread') {
    return buildThreadChatContext(state, threadId, question);
  }
  if (scope === 'board') {
    return buildBoardChatContext(state, boardSlug, page, question);
  }
  return buildSiteChatContext(state, page, question);
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

function consumeAiBudget(state: AnyRecord, { kind, ip, posterToken, actor, createdAt }: AnyRecord) {
  const limits = {
    summary: 20,
    suggestion: 30,
    chat: 30,
    chatIp: 120,
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

async function readEmailClientHealth(emailClient: EmailClient) {
  if (!emailClient.health) {
    return {
      type: emailClient.type,
      configured: emailClient.configured,
      ready: emailClient.configured
    };
  }
  try {
    return await emailClient.health();
  } catch {
    return {
      type: emailClient.type,
      configured: emailClient.configured,
      ready: false
    };
  }
}

export function createForumService({
  store,
  ai,
  realtime = noopRealtime,
  now = () => new Date(),
  lifecycle = THREAD_LIFECYCLE,
  logger = noopLogger,
  imageStorage = createInlineImageStorage(),
  emailClient = createDisabledEmailClient(),
  appBaseUrl = process.env.APP_BASE_URL,
  totp = defaultTotp,
  webauthn = defaultWebAuthn,
  moderationConfidenceThreshold = readModerationConfidenceThreshold(),
  randomInt = crypto.randomInt,
  dmEncryptionSecret,
  realtimeState = noopRealtimeState
}: ForumServiceOptions) {
  const dmSecret = (() => {
    try {
      return resolveDmEncryptionSecret(dmEncryptionSecret);
    } catch {
      return resolveDmEncryptionSecret(process.env.JWT_SECRET);
    }
  })();
  // In-memory token blacklist for session revocation (logout).
  // Each entry maps jti/token → revokedAt timestamp string.
  // Tokens are cleaned up after 14 days (matching JWT maxAge).
  const revokedTokens = new Map();
  const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  const mutationRealtimeEvents = new AsyncLocalStorage<Array<{
    event: string;
    payload: AnyRecord;
  }>>();

  function cleanExpiredRevocations() {
    const cutoff = now().getTime() - TOKEN_TTL_MS;
    for (const [token, revokedAt] of revokedTokens) {
      if (new Date(revokedAt).getTime() < cutoff) {
        revokedTokens.delete(token);
      }
    }
  }

  function publishRealtime(event: string, payload: AnyRecord): void {
    const pending = mutationRealtimeEvents.getStore();
    if (pending) {
      pending.push({ event, payload });
    } else {
      realtime.publish(event, payload);
    }
  }

  function logEvent(event: string, payload: AnyRecord = {}) {
    if (
      event.startsWith('moderation.') ||
      event.startsWith('admin.moderation') ||
      event.startsWith('appeal.') ||
      event.startsWith('report.')
    ) {
      const realtimeEvent = {
        kind: event,
        occurredAt: now().toISOString(),
        ...payload
      };
      publishRealtime('moderation:event', realtimeEvent);
    }
    if (logger === noopLogger) {
      return;
    }
    logger({ event, ...payload });
  }

  async function enforceRealtimeUserRateLimit(
    accountId: string,
    action: string,
    { limit, windowMs }: { limit: number; windowMs: number }
  ): Promise<void> {
    if (!accountId || !realtimeState.consumeUserRateLimit) {
      return;
    }
    let result;
    try {
      result = await realtimeState.consumeUserRateLimit(accountId, action, { limit, windowMs });
    } catch (cause) {
      logEvent('realtime.rate_limit.failure', {
        action,
        message: cause instanceof Error ? cause.message : String(cause)
      });
      const error = new Error('Dịch vụ giới hạn realtime tạm thời không khả dụng');
      error.statusCode = 503;
      throw error;
    }
    if (!result.allowed) {
      const error = new Error('Bạn thao tác quá nhanh. Vui lòng thử lại sau.');
      error.statusCode = 429;
      error.retryAfter = Math.max(1, Math.ceil(Number(result.retryAfterMs || 0) / 1000));
      throw error;
    }
  }

  async function cachedUnreadCount(accountId: string): Promise<number | null> {
    if (!realtimeState.getUnreadCount) {
      return null;
    }
    try {
      return await realtimeState.getUnreadCount(accountId);
    } catch (cause) {
      logEvent('realtime.unread_cache.read_failed', {
        message: cause instanceof Error ? cause.message : String(cause)
      });
      return null;
    }
  }

  async function cacheUnreadCount(accountId: string, count: number): Promise<void> {
    try {
      await realtimeState.setUnreadCount?.(accountId, count);
    } catch (cause) {
      logEvent('realtime.unread_cache.write_failed', {
        message: cause instanceof Error ? cause.message : String(cause)
      });
    }
  }

  async function invalidateUnreadCounts(accountIds: string[]): Promise<void> {
    await Promise.all(
      [...new Set(accountIds.map(String).filter(Boolean))].map(async (accountId) => {
        try {
          await realtimeState.invalidateUnreadCount?.(accountId);
        } catch (cause) {
          logEvent('realtime.unread_cache.invalidate_failed', {
            message: cause instanceof Error ? cause.message : String(cause)
          });
        }
      })
    );
  }

  // Serialize the whole read-modify-write. Mongo additionally supplies a
  // distributed lease so separate server processes cannot use stale snapshots.
  let mutateQueue = Promise.resolve();
  let emailQueue = Promise.resolve();
  function mutate(callback: (state: AnyRecord) => any, { write = null }: AnyRecord = {}) {
    const execute = () => mutationRealtimeEvents.run([], async () => {
      const state = await store.read();
      const result = await callback(state);
      if (write) {
        await write(state, result);
      } else {
        await store.write(state);
      }
      for (const realtimeEvent of mutationRealtimeEvents.getStore() ?? []) {
        realtime.publish(realtimeEvent.event, realtimeEvent.payload);
      }
      return result;
    });
    const run = mutateQueue.then(() => (
      typeof store.withMutationLock === 'function'
        ? store.withMutationLock(execute)
        : execute()
    ));
    // Keep the chain alive regardless of this mutation's outcome.
    mutateQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  function queueEmails(messages: EmailMessage[], event = 'notification') {
    if (!emailClient.configured || messages.length === 0) {
      return;
    }
    const uniqueMessages = [...new Map(messages.map((message) => [normalizeAccountEmail(message.to), message])).values()]
      .slice(0, EMAIL_NOTIFICATION_RECIPIENT_LIMIT);
    emailQueue = emailQueue.then(async () => {
      const results = await Promise.allSettled(uniqueMessages.map((message) => emailClient.send(message)));
      const failed = results.filter((result) => result.status === 'rejected').length;
      logEvent('email.batch', {
        emailEvent: event,
        attempted: uniqueMessages.length,
        delivered: uniqueMessages.length - failed,
        failed
      });
    }).catch(() => {
      logEvent('email.batch.failed', { emailEvent: event });
    });
  }

  function challengeFor(user: AnyRecord, purpose: string) {
    return user.emailChallenges?.[purpose] || null;
  }

  function activeChallengeFor(user: AnyRecord, purpose: string, { clearExpired = false }: AnyRecord = {}) {
    const challenge = challengeFor(user, purpose);
    if (!challenge) {
      return null;
    }
    const expiresAt = new Date(challenge.expiresAt || 0).getTime();
    if (Number.isFinite(expiresAt) && expiresAt > now().getTime()) {
      return challenge;
    }
    if (clearExpired && user.emailChallenges) {
      delete user.emailChallenges[purpose];
    }
    return null;
  }

  function serializeCurrentAccount(state: AnyRecord, user: AnyRecord = {}) {
    return serializeAccount(state, user, now());
  }

  function clearTwoFactorChallenge(user: AnyRecord) {
    user.twoFactorChallengeId = null;
    user.twoFactorChallengeExpiresAt = null;
  }

  function clearTwoFactorLoginFailures(user: AnyRecord) {
    user.failedTwoFactorAttempts = 0;
    user.twoFactorLockedUntil = null;
  }

  async function completeTwoFactorLogin(userId, challengeId, verifyFactor) {
    const outcome = await mutate(async (state) => {
      const user = state.users.find((item) => item.id === userId);
      if (!user) {
        return {
          write: false,
          error: { message: 'Không tìm thấy tài khoản', statusCode: 404 }
        };
      }

      const checkedAt = now();
      const lockedUntil = user.twoFactorLockedUntil
        ? new Date(user.twoFactorLockedUntil).getTime()
        : 0;
      if (lockedUntil && lockedUntil > checkedAt.getTime()) {
        return {
          write: false,
          error: {
            message: 'Xác thực 2FA tạm thời bị khóa do nhập sai nhiều lần. Vui lòng thử lại sau.',
            statusCode: 429,
            retryAfter: Math.ceil((lockedUntil - checkedAt.getTime()) / 1000)
          }
        };
      }

      const challengeExpiresAt = new Date(user.twoFactorChallengeExpiresAt || 0).getTime();
      const providedChallenge = Buffer.from(String(challengeId || ''));
      const expectedChallenge = Buffer.from(String(user.twoFactorChallengeId || ''));
      const challengeMatches = Boolean(
        challengeId
        && user.twoFactorChallengeId
        && providedChallenge.length === expectedChallenge.length
        && crypto.timingSafeEqual(providedChallenge, expectedChallenge)
      );
      if (!challengeMatches || !Number.isFinite(challengeExpiresAt) || challengeExpiresAt <= checkedAt.getTime()) {
        const shouldClear = Boolean(
          user.twoFactorChallengeId
          && Number.isFinite(challengeExpiresAt)
          && challengeExpiresAt <= checkedAt.getTime()
        );
        if (shouldClear) {
          clearTwoFactorChallenge(user);
          user.updatedAt = checkedAt.toISOString();
        }
        return {
          write: shouldClear,
          error: {
            message: 'Yêu cầu xác thực đã hết hạn hoặc không hợp lệ',
            statusCode: 400
          }
        };
      }

      const factor = verifyFactor(user);
      if (!factor.available) {
        return {
          write: false,
          error: { message: factor.message, statusCode: 400 }
        };
      }
      if (!factor.valid) {
        user.failedTwoFactorAttempts = (user.failedTwoFactorAttempts || 0) + 1;
        let retryAfter;
        let statusCode = 400;
        let message = factor.message;
        if (user.failedTwoFactorAttempts >= MAX_FAILED_TWO_FACTOR_ATTEMPTS) {
          user.failedTwoFactorAttempts = 0;
          user.twoFactorLockedUntil = new Date(
            checkedAt.getTime() + TWO_FACTOR_LOCKOUT_MS
          ).toISOString();
          clearTwoFactorChallenge(user);
          retryAfter = Math.ceil(TWO_FACTOR_LOCKOUT_MS / 1000);
          statusCode = 429;
          message = 'Xác thực 2FA tạm thời bị khóa do nhập sai nhiều lần. Vui lòng thử lại sau.';
        }
        user.updatedAt = checkedAt.toISOString();
        return {
          write: true,
          error: { message, statusCode, retryAfter }
        };
      }

      factor.consume?.();
      clearTwoFactorChallenge(user);
      clearTwoFactorLoginFailures(user);
      user.updatedAt = checkedAt.toISOString();
      return {
        write: true,
        result: { ok: true, account: serializeCurrentAccount(state, user) }
      };
    }, {
      write: async (state, result) => {
        if (result.write) {
          await store.write(state);
        }
      }
    });

    if (outcome.error) {
      const error = new Error(outcome.error.message);
      error.statusCode = outcome.error.statusCode;
      error.retryAfter = outcome.error.retryAfter;
      throw error;
    }
    return outcome.result;
  }

  function createEmailChallenge(user: AnyRecord, purpose: string, email: string) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const sentAt = now().toISOString();
    const expiresAt = new Date(now().getTime() + EMAIL_OTP_TTL_MS).toISOString();
    const challenge = {
      email,
      codeHash: hashEmailOtp({ userId: user.id, purpose, email, code }),
      sentAt,
      expiresAt,
      attempts: 0
    };
    user.emailChallenges = {
      ...(user.emailChallenges || {}),
      [purpose]: challenge
    };
    user.updatedAt = sentAt;
    return { code, challenge };
  }

  function resendAvailable(challenge: AnyRecord = {}) {
    const sentAt = new Date(challenge.sentAt || 0).getTime();
    return !sentAt || now().getTime() - sentAt >= EMAIL_OTP_RESEND_COOLDOWN_MS;
  }

  function consumeEmailChallenge(user: AnyRecord, purpose: string, code: string) {
    const challenge = challengeFor(user, purpose);
    if (!challenge || new Date(challenge.expiresAt || 0).getTime() <= now().getTime()) {
      if (user.emailChallenges) {
        delete user.emailChallenges[purpose];
      }
      return { ok: false, reason: 'expired' };
    }
    const actualHash = hashEmailOtp({
      userId: user.id,
      purpose,
      email: challenge.email,
      code: String(code ?? '').trim()
    });
    if (!timingSafeEqualHex(actualHash, challenge.codeHash)) {
      challenge.attempts = Number(challenge.attempts || 0) + 1;
      if (challenge.attempts >= EMAIL_OTP_MAX_ATTEMPTS) {
        delete user.emailChallenges[purpose];
      }
      user.updatedAt = now().toISOString();
      return { ok: false, reason: 'invalid' };
    }
    delete user.emailChallenges[purpose];
    user.updatedAt = now().toISOString();
    return { ok: true, email: challenge.email };
  }

  function securityCodeMessage({ to, username, code, purpose }: AnyRecord): EmailMessage {
    const labels = {
      'verify-email': 'Xác nhận email',
      'change-email': 'Xác nhận email mới',
      'password-reset': 'Đặt lại mật khẩu',
      'recovery-code-reset': 'Tạo lại mã khôi phục'
    };
    const action = labels[purpose] || 'Xác nhận tài khoản';
    const safeAction = escapeEmailHtml(action);
    const safeUsername = escapeEmailHtml(username);
    const safeCode = escapeEmailHtml(code);
    return {
      to,
      subject: `${action} 36chan: ${code}`,
      text: `${action} cho @${username}. Mã OTP: ${code}. Mã hết hạn sau 15 phút. Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.`,
      html: `<p>${safeAction} cho <strong>@${safeUsername}</strong>.</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${safeCode}</p><p>Mã hết hạn sau 15 phút. Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.</p>`
    };
  }

  async function sendSecurityCode({ user, purpose, email, code }: AnyRecord) {
    if (!emailClient.configured) {
      return false;
    }
    try {
      await emailClient.send(securityCodeMessage({
        to: email,
        username: user.username,
        code,
        purpose
      }));
      logEvent('account.email.code.sent', { accountId: user.id, purpose });
      return true;
    } catch {
      logEvent('account.email.code.failed', {
        accountId: user.id,
        purpose
      });
      return false;
    }
  }

  function postMentionsAccount(body: unknown, username: unknown) {
    const safeUsername = normalizeAccountUsername(String(username ?? ''));
    if (!ACCOUNT_USERNAME_PATTERN.test(safeUsername)) {
      return false;
    }
    const escapedUsername = safeUsername.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    return new RegExp(
      `(^|[^a-z0-9._-])@${escapedUsername}(?![a-z0-9._-])`,
      'i'
    ).test(String(body || '').normalize('NFKC'));
  }

  function postNotificationMessages(state: AnyRecord, { kind, thread, comment, authorAccountId }: AnyRecord) {
    const board = findBoard(state, thread.boardSlug);
    const boardLabel = board?.path || `/${thread.boardSlug}/`;
    const baseUrl = String(appBaseUrl || '').replace(/\/+$/, '');
    const threadUrl = `${baseUrl}/#thread/${encodeURIComponent(thread.id)}`;
    const postUrl = comment?.globalNumber
      ? `${threadUrl}?p=${encodeURIComponent(comment.globalNumber)}`
      : threadUrl;
    const preview = safePrivateString(comment?.body || thread.subject || thread.body, 180);
    const messages: EmailMessage[] = [];

    for (const user of state.users) {
      if (!user.email || !user.emailVerifiedAt || user.disabled || user.id === authorAccountId) {
        continue;
      }
      const settings = normalizeAccountSettings(state, {}, user.settings);
      if (!settings.notificationPreferences.email) {
        continue;
      }
      const watchesThread = normalizeAccountWatchlist(user.privateData?.watchlist)
        .some((item) => item.threadId === thread.id);
      const subscribedToBoard = settings.boardSubscriptions.includes(thread.boardSlug);
      const followsPost = kind === 'comment'
        ? settings.notificationPreferences.watchedThreads && watchesThread
        : settings.notificationPreferences.boardSubscriptions && subscribedToBoard;
      const mentioned = settings.notificationPreferences.emailMentions &&
        postMentionsAccount(comment?.body || thread.body, user.username);
      if (!followsPost && !mentioned) {
        continue;
      }
      const subject = mentioned
        ? `Bạn được nhắc đến trên ${boardLabel}`
        : kind === 'comment'
          ? `Phản hồi mới trong ${boardLabel}`
          : `Chủ đề mới trong ${boardLabel}`;
      messages.push({
        to: user.email,
        subject,
        text: `${subject}\n\n${preview}\n\n${postUrl}`,
        html: `<p><strong>${escapeEmailHtml(subject)}</strong></p><p>${escapeEmailHtml(preview)}</p><p><a href="${escapeEmailHtml(postUrl)}">Mở bài viết trên 36chan</a></p>`
      });
    }
    return messages;
  }

  function directMessageNotificationMessages(
    state: AnyRecord,
    { conversation, sender }: AnyRecord
  ): EmailMessage[] {
    const baseUrl = String(appBaseUrl || '').replace(/\/+$/, '');
    const conversationUrl = `${baseUrl}/#messages/${encodeURIComponent(conversation.id)}`;
    const senderUsername = String(sender?.username || 'ai đó');
    const subject = `Tin nhắn mới từ @${senderUsername}`;
    const messages: EmailMessage[] = [];
    for (const participantId of normalizeParticipantIds(conversation.participantIds)) {
      if (participantId === sender?.id || conversationIsMutedFor(conversation, participantId)) {
        continue;
      }
      const user = state.users.find((item: AnyRecord) => item.id === participantId);
      if (!user?.email || !user.emailVerifiedAt || user.disabled) {
        continue;
      }
      const settings = normalizeAccountSettings(state, {}, user.settings);
      if (
        !settings.notificationPreferences.email ||
        !settings.notificationPreferences.emailDirectMessages
      ) {
        continue;
      }
      messages.push({
        to: user.email,
        subject,
        text: `${subject}\n\nBạn có tin nhắn riêng mới. Nội dung tin nhắn không được đưa vào email.\n\n${conversationUrl}`,
        html: `<p><strong>${escapeEmailHtml(subject)}</strong></p><p>Bạn có tin nhắn riêng mới. Nội dung tin nhắn không được đưa vào email.</p><p><a href="${escapeEmailHtml(conversationUrl)}">Mở tin nhắn trên 36chan</a></p>`
      });
    }
    return messages;
  }

  async function queueApprovedPostNotifications(postType: string, postId: string) {
    if (!emailClient.configured) {
      return;
    }
    try {
      const state = await store.read();
      if (postType === 'thread') {
        const thread = state.threads.find((item) => item.id === postId && activePublicThread(item));
        if (!thread) {
          return;
        }
        queueEmails(postNotificationMessages(state, {
          kind: 'thread',
          thread,
          authorAccountId: thread.accountId
        }), 'post-notification');
        return;
      }
      const comment = state.comments.find((item) => item.id === postId && !item.isPending && !item.isDeleted);
      const thread = comment
        ? state.threads.find((item) => item.id === comment.threadId && activePublicThread(item))
        : null;
      if (!comment || !thread) {
        return;
      }
      queueEmails(postNotificationMessages(state, {
        kind: 'comment',
        thread,
        comment,
        authorAccountId: comment.accountId
      }), 'post-notification');
    } catch {
      logEvent('email.notification.prepare.failed', { postType });
    }
  }

  async function readUserById(userId) {
    if (typeof store.readUser === 'function') {
      const user = await store.readUser(userId);
      return { state: { boards: BOARDS }, user };
    }
    const state = await store.read();
    return {
      state,
      user: state.users.find((item) => item.id === userId)
    };
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
      publishRealtime('thread:archived', { thread: serializeThread(thread, state.comments) });
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
        publishRealtime('thread:archived', { thread: serializeThread(thread, state.comments) });
        changed = true;
    });
    return changed;
  }

  function hasExpiredEventThreads(state, boardSlug, checkedAt) {
    const board = state.boards.find((item) => item.slug === boardSlug);
    return boardEventEnded(board, checkedAt)
      && state.threads.some((thread) => thread.boardSlug === boardSlug && activePublicThread(thread));
  }

  async function stateAfterArchivingExpiredEvents(state, boardSlugs, checkedAt) {
    const slugs = [...new Set(boardSlugs.map(String).filter(Boolean))];
    if (!slugs.some((boardSlug) => hasExpiredEventThreads(state, boardSlug, checkedAt))) {
      return state;
    }
    // Re-read and archive under the same local queue / distributed mutation
    // lease used by writes. Never persist the stale snapshot from the public
    // read that first noticed an expired event.
    return mutate(async (latestState) => {
      for (const boardSlug of slugs) {
        archiveExpiredEventThreads(latestState, boardSlug, checkedAt);
      }
      return latestState;
    });
  }

  function restoreDeletedPostRecord(
    state: AnyRecord,
    found: AnyRecord,
    { reason = '', actor = 'admin', restoredAt = now().toISOString(), action = 'admin:restore' }: AnyRecord = {}
  ) {
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
        publishRealtime('thread:created', { thread: serializeThread(found.post, state.comments) });
      }
    } else {
      const parent = state.threads.find((thread) => thread.id === found.post.threadId);
      if (!found.post.isPending && parent && publicThread(state, parent)) {
        publishRealtime('thread:updated', { thread: serializeThread(parent, state.comments) });
        publishRealtime('comment:created', { threadId: parent.id, comment: serializeComment(found.post, parent) });
      }
    }

    return {
      ok: true,
      globalNumber: found.post.globalNumber,
      post: serializeAdminPost(found.postType, found.post, state)
    };
  }

  return {
    async getHomeSnapshot() {
      let state = await store.read();
      const referenceDate = now();
      const checkedAt = referenceDate.toISOString();
      state = await stateAfterArchivingExpiredEvents(
        state,
        state.boards.filter(publicBoard).map((board) => board.slug),
        checkedAt
      );
      return homeSnapshotFromState(state, { lifecycle, referenceDate, realtime });
    },

    async listBoards() {
      if (typeof store.readBoards === 'function') {
        const boards = await store.readBoards();
        return boards.filter(publicBoard).map((board) => serializeBoard(board, { retentionDefaults: lifecycle }));
      }
      const state = await store.read();
      return state.boards.filter(publicBoard).map((board) => serializeBoard(board, { retentionDefaults: lifecycle }));
    },

    async listAdminBoards() {
      if (typeof store.readBoards === 'function') {
        const boards = await store.readBoards();
        return boards.map((board) => serializeBoard(board, { admin: true, retentionDefaults: lifecycle }));
      }
      const state = await store.read();
      return state.boards.map((board) => serializeBoard(board, { admin: true, retentionDefaults: lifecycle }));
    },

    async getStats() {
      return statsFromState(await store.read(), now(), realtime);
    },

    async getModerationSettings() {
      const state = await store.read();
      return moderationSettingsForState(state, moderationConfidenceThreshold);
    },

    async updateModerationSettings(settings: AnyRecord = {}, { actor = 'admin' }: AnyRecord = {}) {
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

    async getSiteContent(): Promise<SiteContent> {
      const state = await store.read();
      return normalizeSiteContent(state.adminSettings?.siteContent ?? DEFAULT_SITE_CONTENT);
    },

    async updateSiteContent(content: AnyRecord = {}, { actor = 'admin' }: AnyRecord = {}) {
      return mutate(async (state) => {
        const nextContent = normalizeSiteContent({
          ...(state.adminSettings?.siteContent || {}),
          ...content
        });
        state.adminSettings = {
          ...state.adminSettings,
          siteContent: nextContent
        };
        logEvent('admin.site-content.update', {
          actor,
          sections: Object.keys(nextContent)
        });
        return nextContent;
      });
    },

    async getCustomStickers() {
      const state = await store.read();
      return normalizeCustomStickers(state.adminSettings?.customStickers);
    },

    async addCustomSticker(input: AnyRecord = {}, { actor = 'admin' }: AnyRecord = {}) {
      const url = normalizeImgurStickerUrl(input.url);
      return mutate(async (state) => {
        const stickers = normalizeCustomStickers(state.adminSettings?.customStickers);
        if (stickers.length >= MAX_CUSTOM_STICKERS) {
          const error = new Error(`Chỉ được lưu tối đa ${MAX_CUSTOM_STICKERS} sticker tùy chỉnh`);
          error.statusCode = 409;
          throw error;
        }
        if (stickers.some((sticker) => sticker.url === url)) {
          const error = new Error('Sticker Imgur này đã có trong danh sách');
          error.statusCode = 409;
          throw error;
        }
        const sticker = createCustomSticker({
          key: `custom-${crypto.randomUUID()}`,
          label: input.label,
          url,
          createdAt: now().toISOString()
        });
        state.adminSettings = {
          ...state.adminSettings,
          customStickers: [...stickers, sticker]
        };
        logEvent('admin.custom-sticker.create', {
          actor,
          stickerKey: sticker.key,
          imageHost: new URL(sticker.url).hostname
        });
        return sticker;
      });
    },

    async setCustomStickerActive(key: unknown, active: unknown, { actor = 'admin' }: AnyRecord = {}) {
      const safeKey = assertCustomStickerKey(key);
      if (typeof active !== 'boolean') {
        const error = new Error('Trạng thái sticker phải là true hoặc false');
        error.statusCode = 400;
        throw error;
      }
      return mutate(async (state) => {
        const stickers = normalizeCustomStickers(state.adminSettings?.customStickers);
        const index = stickers.findIndex((sticker) => sticker.key === safeKey);
        if (index < 0) {
          const error = new Error('Không tìm thấy sticker tùy chỉnh');
          error.statusCode = 404;
          throw error;
        }
        const sticker = { ...stickers[index], active };
        stickers[index] = sticker;
        state.adminSettings = {
          ...state.adminSettings,
          customStickers: stickers
        };
        logEvent('admin.custom-sticker.visibility', {
          actor,
          stickerKey: safeKey,
          active
        });
        return sticker;
      });
    },

    async getHealth() {
      const [storeHealth, imageStorageHealth, emailHealth] = await Promise.all([
        readStoreHealth(store),
        readImageStorageHealth(imageStorage),
        readEmailClientHealth(emailClient)
      ]);
      const realtimeHealth = realtime.metrics?.() ?? {
        clients: realtime.count?.() ?? 0,
        boards: realtime.boardCounts?.() ?? {}
      };
      const ready =
        storeHealth.ready !== false &&
        imageStorageHealth.ready !== false &&
        realtimeHealth.state?.ready !== false;
      return {
        status: ready ? 'ok' : 'degraded',
        checkedAt: now().toISOString(),
        store: storeHealth,
        ai: {
          ...aiConfigStatus(),
          moderationConfidenceThreshold
        },
        imageStorage: imageStorageHealth,
        email: emailHealth,
        realtime: realtimeHealth
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

    async flushEmailQueue() {
      await emailQueue;
      return { ok: true };
    },

    async registerAccount({ username, password, email, captchaToken, ip }: AnyRecord = {}) {
      await requireCaptcha(captchaToken, ip);
      const safeUsername = assertAccountUsername(username);
      const safePassword = assertAccountPassword(password, { username: safeUsername });
      const safeEmail = email ? assertAccountEmail(email) : '';
      let verificationDelivery = null;
      const result = await mutate(async (state) => {
        const existing = state.users.find((user) => normalizeAccountUsername(user.username) === safeUsername);
        if (existing) {
          const error = new Error('Tên tài khoản đã tồn tại');
          error.statusCode = 409;
          throw error;
        }
        if (safeEmail && state.users.some((user) =>
          normalizeAccountEmail(user.email) === safeEmail ||
          normalizeAccountEmail(activeChallengeFor(user, 'change-email', { clearExpired: true })?.email) === safeEmail
        )) {
          const error = new Error('Địa chỉ email đã được sử dụng');
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
          email: safeEmail || null,
          emailVerifiedAt: null,
          emailChallenges: {},
          authEpoch: 0,
          role: 'user',
          settings: defaultAccountSettings(),
          privateData: defaultAccountPrivateData(),
          createdAt,
          updatedAt: createdAt
        };
        state.users.push(user);
        if (safeEmail) {
          const { code } = createEmailChallenge(user, 'verify-email', safeEmail);
          verificationDelivery = { user, purpose: 'verify-email', email: safeEmail, code };
        }
        logEvent('account.register', { username: safeUsername });
        return { account: serializeCurrentAccount(state, user), recoveryCode };
      });
      const verificationEmailSent = verificationDelivery
        ? await sendSecurityCode(verificationDelivery)
        : false;
      return { ...result, verificationEmailSent };
    },

    async resendAccountEmailVerification(userId: string) {
      let verificationDelivery = null;
      const result = await mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        if (!user.email) {
          const error = new Error('Tài khoản chưa có địa chỉ email');
          error.statusCode = 400;
          throw error;
        }
        if (user.emailVerifiedAt) {
          return { account: serializeCurrentAccount(state, user), alreadyVerified: true };
        }
        const currentChallenge = activeChallengeFor(user, 'verify-email', { clearExpired: true });
        if (currentChallenge && !resendAvailable(currentChallenge)) {
          const retryAfter = Math.ceil(
            (EMAIL_OTP_RESEND_COOLDOWN_MS - (now().getTime() - new Date(currentChallenge.sentAt).getTime())) / 1000
          );
          const error = new Error(`Vui lòng chờ ${retryAfter} giây trước khi gửi lại mã`);
          error.statusCode = 429;
          error.retryAfter = retryAfter;
          throw error;
        }
        const { code, challenge } = createEmailChallenge(user, 'verify-email', user.email);
        verificationDelivery = { user, purpose: 'verify-email', email: user.email, code };
        return {
          account: serializeCurrentAccount(state, user),
          expiresAt: challenge.expiresAt,
          alreadyVerified: false
        };
      });
      const emailSent = verificationDelivery ? await sendSecurityCode(verificationDelivery) : false;
      return { ...result, emailSent };
    },

    async verifyAccountEmail(userId: string, code: string) {
      const outcome = await mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          return { ok: false, statusCode: 401, message: 'Phiên đăng nhập không còn hợp lệ' };
        }
        if (user.emailVerifiedAt) {
          return { ok: true, account: serializeCurrentAccount(state, user) };
        }
        const consumed = consumeEmailChallenge(user, 'verify-email', code);
        if (!consumed.ok) {
          return { ok: false, statusCode: 400, message: 'Mã OTP không đúng hoặc đã hết hạn' };
        }
        user.email = consumed.email;
        user.emailVerifiedAt = now().toISOString();
        user.updatedAt = user.emailVerifiedAt;
        logEvent('account.email.verified', { accountId: user.id });
        return { ok: true, account: serializeCurrentAccount(state, user) };
      });
      if (!outcome.ok) {
        const error = new Error(outcome.message);
        error.statusCode = outcome.statusCode;
        throw error;
      }
      return outcome.account;
    },

    async requestAccountEmailChange(userId: string, { newEmail, password }: AnyRecord = {}) {
      const safeEmail = assertAccountEmail(newEmail);
      let verificationDelivery = null;
      const result = await mutate(async (state) => {
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
        if (state.users.some((item) => item.id !== userId && (
          normalizeAccountEmail(item.email) === safeEmail ||
          normalizeAccountEmail(activeChallengeFor(item, 'change-email', { clearExpired: true })?.email) === safeEmail
        ))) {
          const error = new Error('Địa chỉ email đã được sử dụng');
          error.statusCode = 409;
          throw error;
        }
        const currentChallenge = activeChallengeFor(user, 'change-email', { clearExpired: true });
        if (currentChallenge && !resendAvailable(currentChallenge)) {
          const retryAfter = Math.ceil(
            (EMAIL_OTP_RESEND_COOLDOWN_MS - (now().getTime() - new Date(currentChallenge.sentAt).getTime())) / 1000
          );
          const error = new Error(`Vui lòng chờ ${retryAfter} giây trước khi gửi lại mã`);
          error.statusCode = 429;
          error.retryAfter = retryAfter;
          throw error;
        }
        const { code, challenge } = createEmailChallenge(user, 'change-email', safeEmail);
        verificationDelivery = { user, purpose: 'change-email', email: safeEmail, code };
        return { account: serializeCurrentAccount(state, user), expiresAt: challenge.expiresAt };
      });
      const emailSent = await sendSecurityCode(verificationDelivery);
      return { ...result, emailSent };
    },

    async confirmAccountEmailChange(userId: string, code: string) {
      const outcome = await mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          return { ok: false, statusCode: 401, message: 'Phiên đăng nhập không còn hợp lệ' };
        }
        const consumed = consumeEmailChallenge(user, 'change-email', code);
        if (!consumed.ok) {
          return { ok: false, statusCode: 400, message: 'Mã OTP không đúng hoặc đã hết hạn' };
        }
        user.email = consumed.email;
        user.emailVerifiedAt = now().toISOString();
        if (user.emailChallenges) {
          delete user.emailChallenges['verify-email'];
        }
        user.updatedAt = user.emailVerifiedAt;
        logEvent('account.email.changed', { accountId: user.id });
        return { ok: true, account: serializeCurrentAccount(state, user) };
      });
      if (!outcome.ok) {
        const error = new Error(outcome.message);
        error.statusCode = outcome.statusCode;
        throw error;
      }
      return outcome.account;
    },

    async requestAccountPasswordResetEmail({ identifier, captchaToken, ip }: AnyRecord = {}) {
      await requireCaptcha(captchaToken, ip);
      let verificationDelivery = null;
      await mutate(async (state) => {
        const user = findUserByAccountIdentifier(state.users, identifier);
        if (!user?.email || !user.emailVerifiedAt || user.disabled) {
          return;
        }
        const currentChallenge = activeChallengeFor(user, 'password-reset', { clearExpired: true });
        if (currentChallenge && !resendAvailable(currentChallenge)) {
          return;
        }
        const { code } = createEmailChallenge(user, 'password-reset', user.email);
        verificationDelivery = { user, purpose: 'password-reset', email: user.email, code };
      });
      if (verificationDelivery) {
        await sendSecurityCode(verificationDelivery);
      }
      return { ok: true, expiresInSeconds: EMAIL_OTP_TTL_MS / 1000 };
    },

    async resetAccountPasswordWithEmailCode({ identifier, code, newPassword }: AnyRecord = {}) {
      const safePassword = assertAccountPassword(newPassword);
      const outcome = await mutate(async (state) => {
        const user = findUserByAccountIdentifier(state.users, identifier);
        if (!user || !user.emailVerifiedAt) {
          hashEmailOtp({ userId: 'missing', purpose: 'password-reset', email: identifier, code });
          return { ok: false };
        }
        const consumed = consumeEmailChallenge(user, 'password-reset', code);
        if (!consumed.ok) {
          return { ok: false };
        }
        assertAccountPassword(safePassword, { username: user.username });
        user.passwordHash = accountPasswordHash(safePassword);
        const recoveryCode = generateRecoveryCode();
        user.recoveryCodeHash = hashRecoveryCode(recoveryCode);
        bumpAccountAuthEpoch(user);
        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
        user.updatedAt = now().toISOString();
        logEvent('account.password.reset.email', { accountId: user.id });
        return { ok: true, recoveryCode };
      });
      if (!outcome.ok) {
        const error = new Error('Mã OTP không đúng hoặc đã hết hạn');
        error.statusCode = 400;
        throw error;
      }
      return { recoveryCode: outcome.recoveryCode };
    },

    async requestRecoveryCodeResetEmail({ identifier, captchaToken, ip }: AnyRecord = {}) {
      await requireCaptcha(captchaToken, ip);
      let verificationDelivery = null;
      await mutate(async (state) => {
        const user = findUserByAccountIdentifier(state.users, identifier);
        if (!user?.email || !user.emailVerifiedAt || user.disabled) {
          return;
        }
        const currentChallenge = activeChallengeFor(user, 'recovery-code-reset', { clearExpired: true });
        if (currentChallenge && !resendAvailable(currentChallenge)) {
          return;
        }
        const { code } = createEmailChallenge(user, 'recovery-code-reset', user.email);
        verificationDelivery = { user, purpose: 'recovery-code-reset', email: user.email, code };
      });
      if (verificationDelivery) {
        await sendSecurityCode(verificationDelivery);
      }
      return { ok: true, expiresInSeconds: EMAIL_OTP_TTL_MS / 1000 };
    },

    async resetRecoveryCodeWithEmailCode({ identifier, code }: AnyRecord = {}) {
      const outcome = await mutate(async (state) => {
        const user = findUserByAccountIdentifier(state.users, identifier);
        if (!user || !user.emailVerifiedAt) {
          hashEmailOtp({ userId: 'missing', purpose: 'recovery-code-reset', email: identifier, code });
          return { ok: false };
        }
        const consumed = consumeEmailChallenge(user, 'recovery-code-reset', code);
        if (!consumed.ok) {
          return { ok: false };
        }
        const recoveryCode = generateRecoveryCode();
        user.recoveryCodeHash = hashRecoveryCode(recoveryCode);
        bumpAccountAuthEpoch(user);
        user.updatedAt = now().toISOString();
        logEvent('account.recoveryCode.reset.email', { accountId: user.id });
        return { ok: true, recoveryCode };
      });
      if (!outcome.ok) {
        const error = new Error('Mã OTP không đúng hoặc đã hết hạn');
        error.statusCode = 400;
        throw error;
      }
      return { recoveryCode: outcome.recoveryCode };
    },

    async loginAccount({ username, password, captchaToken, ip }: AnyRecord = {}) {
      await requireCaptcha(captchaToken, ip);
      const safeUsername = normalizeAccountUsername(username);
      const outcome = await mutate(async (state) => {
        const user = state.users.find((item) => normalizeAccountUsername(item.username) === safeUsername);
        const checkedAt = now();
        const lockedUntil = user?.lockedUntil ? new Date(user.lockedUntil).getTime() : 0;
        if (lockedUntil && lockedUntil > checkedAt.getTime()) {
          return {
            write: false,
            error: {
              message: 'Tài khoản tạm thời bị khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau.',
              statusCode: 429,
              retryAfter: Math.ceil((lockedUntil - checkedAt.getTime()) / 1000)
            }
          };
        }

        // Always run a PBKDF2 verification so the timing of a missing-user
        // login matches an existing user with the wrong password.
        const passwordOk = user
          ? verifyAccountPassword(password, user.passwordHash)
          : (verifyAccountPassword(password, DUMMY_PASSWORD_HASH), false);

        if (!user || !passwordOk) {
          if (user) {
            user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
            if (user.failedLoginAttempts >= MAX_FAILED_LOGINS) {
              user.lockedUntil = new Date(checkedAt.getTime() + LOGIN_LOCKOUT_MS).toISOString();
              user.failedLoginAttempts = 0;
            }
            user.updatedAt = checkedAt.toISOString();
          }
          return {
            write: Boolean(user),
            error: {
              message: 'Tên tài khoản hoặc mật khẩu không đúng',
              statusCode: 401
            }
          };
        }

        if (user.disabled) {
          return {
            write: false,
            error: {
              message: 'Tài khoản đã bị vô hiệu hóa',
              statusCode: 403
            }
          };
        }

        const shouldResetFailures = Boolean(user.failedLoginAttempts || user.lockedUntil);
        if (shouldResetFailures) {
          user.failedLoginAttempts = 0;
          user.lockedUntil = null;
          user.updatedAt = checkedAt.toISOString();
        }
        return {
          write: shouldResetFailures,
          account: serializeCurrentAccount(state, user)
        };
      }, {
        write: async (state, result) => {
          if (result.write) {
            await store.write(state);
          }
        }
      });

      if (outcome.error) {
        const error = new Error(outcome.error.message);
        error.statusCode = outcome.error.statusCode;
        error.retryAfter = outcome.error.retryAfter;
        throw error;
      }
      return outcome.account;
    },

    async resetAccountPasswordWithRecoveryCode({ username, recoveryCode, newPassword, captchaToken, ip }: AnyRecord = {}) {
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
        bumpAccountAuthEpoch(user);
        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
        user.updatedAt = now().toISOString();

        logEvent('account.password.reset', { username: user.username });
        return { account: serializeCurrentAccount(state, user), recoveryCode: nextRecoveryCode };
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
        bumpAccountAuthEpoch(user);
        user.updatedAt = now().toISOString();

        logEvent('account.recoveryCode.regenerate', { username: user.username });
        return { account: serializeCurrentAccount(state, user), recoveryCode };
      });
    },

    async getAccount(userId) {
      if (typeof store.readUser === 'function') {
        const user = await store.readUser(userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        return serializeCurrentAccount({ boards: BOARDS }, user);
      }
      const state = await store.read();
      const user = state.users.find((item) => item.id === userId);
      if (!user) {
        const error = new Error('Phiên đăng nhập không còn hợp lệ');
        error.statusCode = 401;
        throw error;
      }
      return serializeCurrentAccount(state, user);
    },

    async updateAccountSettings(userId: string, settings: AnyRecord = {}) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        user.settings = normalizeAccountSettings(state, settings, user.settings);
        if (!user.emailVerifiedAt) {
          user.settings.emailNotifications = false;
          user.settings.notificationPreferences.email = false;
        }
        user.updatedAt = now().toISOString();
        logEvent('account.settings.update', { username: user.username });
        return serializeCurrentAccount(state, user);
      });
    },

    async getAccountPrivateData(userId) {
      const user = typeof store.readUser === 'function'
        ? await store.readUser(userId)
        : (await store.read()).users.find((item) => item.id === userId);
      if (!user) {
        const error = new Error('Phiên đăng nhập không còn hợp lệ');
        error.statusCode = 401;
        throw error;
      }
      return serializeAccountPrivateData(user.privateData);
    },

    async updateAccountPrivateData(userId: string, privateData: AnyRecord = {}) {
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
      const allowedSections = new Set([
        'watchlist',
        'drafts',
        'savedSearches',
        'contentFilters',
        'replyTemplates',
        'posterNotes',
        'hiddenPosts',
        'hiddenThreads'
      ]);
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

    async logoutAccount(userIdOrToken, token = '') {
      const rawToken = token || String(userIdOrToken || '');
      const userId = token ? String(userIdOrToken || '') : '';
      if (userId) {
        await mutate(async (state) => {
          const user = state.users.find((item) => item.id === userId);
          if (user) {
            bumpAccountAuthEpoch(user);
            user.updatedAt = now().toISOString();
          }
        });
      }
      this.revokeSession(rawToken);
      return { ok: true };
    },

    async getOrCreateAdminAccount(username, password) {
      const safeUsername = normalizeAccountUsername(username);
      if (typeof store.upsertAdminAccount === 'function') {
        const actionAt = now().toISOString();
        const privilegedUsers = typeof store.readPrivilegedUsers === 'function'
          ? await store.readPrivilegedUsers()
          : [];
        const existing = privilegedUsers.find(
          (item) => normalizeAccountUsername(item.username) === safeUsername
        );
        const passwordMatches = Boolean(existing && verifyAccountPassword(password, existing.passwordHash));
        const admin = await store.upsertAdminAccount({
          username: safeUsername,
          passwordHash: passwordMatches ? existing.passwordHash : accountPasswordHash(password),
          role: 'owner',
          settings: defaultAccountSettings(),
          privateData: defaultAccountPrivateData(),
          authEpoch: existing ? accountAuthEpoch(existing) + (passwordMatches ? 0 : 1) : 0,
          disabled: false,
          createdAt: actionAt,
          updatedAt: actionAt
        });
        return serializeCurrentAccount({ boards: BOARDS }, admin);
      }
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
            authEpoch: 0,
            disabled: false,
            createdAt,
            updatedAt: createdAt
          };
          state.users.push(admin);
        } else {
          if (!verifyAccountPassword(password, admin.passwordHash)) {
            admin.passwordHash = accountPasswordHash(password);
            bumpAccountAuthEpoch(admin);
          }
          admin.role = 'owner';
          admin.disabled = false;
          admin.privateData = normalizeAccountPrivateData(admin.privateData);
          admin.updatedAt = now().toISOString();
        }
        return serializeCurrentAccount(state, admin);
      });
    },

    async listPrivilegedUsers() {
      if (typeof store.readPrivilegedUsers === 'function') {
        const users = await store.readPrivilegedUsers();
        return users
          .map((user) => serializePrivilegedAccount({ boards: BOARDS }, user))
          .sort((left, right) => left.username.localeCompare(right.username));
      }
      const state = await store.read();
      return state.users
        .filter(isPrivilegedAccount)
        .map((user) => serializePrivilegedAccount(state, user))
        .sort((left, right) => left.username.localeCompare(right.username));
    },

    async createPrivilegedUser(
      { username, password, role = 'viewer', disabled = false }: AnyRecord = {},
      { actor = 'admin' }: AnyRecord = {}
    ) {
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
          authEpoch: 0,
          disabled: Boolean(disabled),
          createdAt,
          updatedAt: createdAt
        };
        state.users.push(user);
        logEvent('admin.user.create', { actor, username: safeUsername, role: safeRole, disabled: user.disabled });
        return serializePrivilegedAccount(state, user);
      });
    },

    async updatePrivilegedUser(userId: string, updates: AnyRecord = {}, { actor = 'admin', actorId = '' }: AnyRecord = {}) {
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

        const securityStateChanged = nextRole !== currentRole || nextDisabled !== Boolean(user.disabled);
        user.role = nextRole;
        user.disabled = nextDisabled;
        if (updates.password !== undefined && String(updates.password || '').trim()) {
          const safePassword = assertAccountPassword(updates.password, { username: user.username });
          user.passwordHash = accountPasswordHash(safePassword);
          bumpAccountAuthEpoch(user);
        } else if (securityStateChanged) {
          bumpAccountAuthEpoch(user);
        }
        user.updatedAt = now().toISOString();
        logEvent('admin.user.update', { actor, username: user.username, role: user.role, disabled: user.disabled });
        return serializePrivilegedAccount(state, user);
      });
    },

    async disablePrivilegedUser(userId: string, { actor = 'admin', actorId = '' }: AnyRecord = {}) {
      return this.updatePrivilegedUser(userId, { disabled: true }, { actor, actorId });
    },

    async begin2FALogin(userId) {
      return mutate(async (state) => {
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

        const checkedAt = now();
        const lockedUntil = user.twoFactorLockedUntil
          ? new Date(user.twoFactorLockedUntil).getTime()
          : 0;
        if (lockedUntil && lockedUntil > checkedAt.getTime()) {
          const error = new Error(
            'Xác thực 2FA tạm thời bị khóa do nhập sai nhiều lần. Vui lòng thử lại sau.'
          );
          error.statusCode = 429;
          error.retryAfter = Math.ceil((lockedUntil - checkedAt.getTime()) / 1000);
          throw error;
        }
        if (lockedUntil) {
          clearTwoFactorLoginFailures(user);
        }

        const challengeId = crypto.randomUUID();
        const expiresAt = new Date(
          checkedAt.getTime() + TWO_FACTOR_CHALLENGE_TTL_MS
        ).toISOString();
        user.twoFactorChallengeId = challengeId;
        user.twoFactorChallengeExpiresAt = expiresAt;
        user.updatedAt = checkedAt.toISOString();
        return {
          account: serializeCurrentAccount(state, user),
          challengeId,
          expiresAt
        };
      });
    },

    async getAccountMfaState(userId) {
      const user = (await store.read()).users.find((item) => item.id === userId);
      if (!user) {
        const error = new Error('Phiên đăng nhập không còn hợp lệ');
        error.statusCode = 401;
        throw error;
      }
      return {
        totpEnabled: Boolean(user.twoFactorEnabled),
        passkeyCount: Array.isArray(user.passkeys) ? user.passkeys.length : 0
      };
    },

    async generate2FASetup(userId, { verifiedStepUp = false }: AnyRecord = {}) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        if (!verifiedStepUp && (user.twoFactorEnabled || (user.passkeys || []).length > 0)) {
          const error = new Error('Yêu cầu xác thực 2FA trước khi thay đổi phương thức xác thực');
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

    async verify2FASetup(userId, code, { verifiedStepUp = false }: AnyRecord = {}) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        if (!verifiedStepUp && (user.twoFactorEnabled || (user.passkeys || []).length > 0)) {
          const error = new Error('Yêu cầu xác thực 2FA trước khi thay đổi phương thức xác thực');
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
        clearTwoFactorChallenge(user);
        clearTwoFactorLoginFailures(user);
        bumpAccountAuthEpoch(user);
        user.updatedAt = now().toISOString();

        logEvent('account.2fa.enable', { username: user.username });
        return { ok: true, account: serializeCurrentAccount(state, user) };
      });
    },

    async verify2FALogin(userId, code, challengeId) {
      return completeTwoFactorLogin(userId, challengeId, (user) => {
        if (!user.twoFactorEnabled || !user.twoFactorSecret) {
          return {
            available: false,
            valid: false,
            message: 'Tài khoản chưa kích hoạt 2FA'
          };
        }
        return {
          available: true,
          valid: totp.verifyTOTP(code, user.twoFactorSecret),
          message: 'Mã xác thực 2FA không chính xác'
        };
      });
    },

    async verifyBackupCodeLogin(userId, code, challengeId) {
      return completeTwoFactorLogin(userId, challengeId, (user) => {
        if (!user.twoFactorEnabled || !user.backupCodes || user.backupCodes.length === 0) {
          return {
            available: false,
            valid: false,
            message: 'Tài khoản chưa kích hoạt 2FA hoặc không có mã dự phòng'
          };
        }
        const normalizedCode = String(code).toUpperCase().trim();
        const hashedInput = crypto.createHash('sha256').update(normalizedCode).digest('hex');
        const index = user.backupCodes.indexOf(hashedInput);
        return {
          available: true,
          valid: index !== -1,
          message: 'Mã dự phòng không hợp lệ',
          consume: index === -1
            ? undefined
            : () => {
                user.backupCodes.splice(index, 1);
                logEvent('account.2fa.backupCodeUsed', { username: user.username });
              }
        };
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
        clearTwoFactorChallenge(user);
        clearTwoFactorLoginFailures(user);
        bumpAccountAuthEpoch(user);
        user.updatedAt = now().toISOString();

        logEvent('account.2fa.disable', { username: user.username });
        return { ok: true, account: serializeCurrentAccount(state, user) };
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
        clearTwoFactorChallenge(user);
        clearTwoFactorLoginFailures(user);
        bumpAccountAuthEpoch(user);
        user.updatedAt = now().toISOString();
        logEvent('account.2fa.adminReset', { username: user.username });
        return { ok: true };
      });
    },

    async generateWebAuthnRegisterOptions(userId, rpID, { verifiedStepUp = false }: AnyRecord = {}) {
      return mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        if (!verifiedStepUp && (user.twoFactorEnabled || (user.passkeys || []).length > 0)) {
          const error = new Error('Yêu cầu xác thực 2FA trước khi thay đổi phương thức xác thực');
          error.statusCode = 401;
          throw error;
        }
        const options = await webauthn.getWebAuthnRegisterOptions({ user, rpID });
        user.webauthnRegistrationChallenge = createWebAuthnChallenge(options.challenge, now());
        user.updatedAt = now().toISOString();
        return options;
      });
    },

    async verifyWebAuthnRegisterResponse(userId, { body, origin, rpID, verifiedStepUp = false }) {
      const outcome = await mutate(async (state) => {
        const user = state.users.find((item) => item.id === userId);
        if (!user) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        if (!verifiedStepUp && (user.twoFactorEnabled || (user.passkeys || []).length > 0)) {
          const error = new Error('Yêu cầu xác thực 2FA trước khi thay đổi phương thức xác thực');
          error.statusCode = 401;
          throw error;
        }
        const expectedChallenge = activeWebAuthnChallenge(user.webauthnRegistrationChallenge, now());
        user.webauthnRegistrationChallenge = null;
        user.updatedAt = now().toISOString();
        if (!expectedChallenge) {
          return { ok: false, statusCode: 400, message: 'Yêu cầu đăng ký đã hết hạn hoặc không hợp lệ' };
        }
        let verification;
        try {
          verification = await webauthn.verifyWebAuthnRegisterResponse({
            body,
            expectedChallenge,
            origin,
            rpID
          });
        } catch {
          return { ok: false, statusCode: 400, message: 'Xác thực thiết bị WebAuthn thất bại' };
        }
        if (!verification.verified) {
          return { ok: false, statusCode: 400, message: 'Xác thực thiết bị WebAuthn thất bại' };
        }

        const { registrationInfo } = verification;
        const { credential, credentialDeviceType, credentialBackedUp } = registrationInfo;
        if (!credential?.id || !credential?.publicKey) {
          return { ok: false, statusCode: 400, message: 'Thiết bị WebAuthn không trả về credential hợp lệ' };
        }
        if ((user.passkeys || []).some((passkey) => passkey.credentialID === credential.id)) {
          return { ok: false, statusCode: 409, message: 'Passkey này đã được đăng ký' };
        }

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
        bumpAccountAuthEpoch(user);
        user.updatedAt = now().toISOString();
        logEvent('account.passkey.register', { username: user.username });
        return { ok: true, account: serializeCurrentAccount(state, user) };
      });
      if (!outcome.ok) {
        const error = new Error(outcome.message);
        error.statusCode = outcome.statusCode;
        throw error;
      }
      return outcome;
    },

    async generateWebAuthnLoginOptions(username, rpID) {
      const safeUsername = normalizeAccountUsername(username);
      return mutate(async (state) => {
        const user = state.users.find((item) => normalizeAccountUsername(item.username) === safeUsername);
        const targetUser = user || {
          id: crypto.createHash('sha256').update(`webauthn:${safeUsername}`).digest('hex'),
          username: safeUsername || 'account',
          passkeys: []
        };
        const options = await webauthn.getWebAuthnLoginOptions({ user: targetUser, rpID });
        if (user) {
          user.webauthnLoginChallenge = createWebAuthnChallenge(options.challenge, now());
          user.updatedAt = now().toISOString();
        }
        return { ...options, allowCredentials: [] };
      });
    },

    async verifyWebAuthnLoginResponse({ username, body, origin, rpID }) {
      const safeUsername = normalizeAccountUsername(username);
      const outcome = await mutate(async (state) => {
        const user = state.users.find((item) => normalizeAccountUsername(item.username) === safeUsername);
        if (!user) {
          return { ok: false, statusCode: 401, message: 'Tên tài khoản hoặc thiết bị đăng nhập không đúng' };
        }
        const expectedChallenge = activeWebAuthnChallenge(user.webauthnLoginChallenge, now());
        user.webauthnLoginChallenge = null;
        user.updatedAt = now().toISOString();
        if (!expectedChallenge) {
          return { ok: false, statusCode: 400, message: 'Yêu cầu đăng nhập không còn hiệu lực. Vui lòng thử lại' };
        }
        const passkey = (user.passkeys || []).find((p) => p.credentialID === body.id);
        if (!passkey) {
          return { ok: false, statusCode: 401, message: 'Tên tài khoản hoặc thiết bị đăng nhập không đúng' };
        }
        let verification;
        try {
          verification = await webauthn.verifyWebAuthnLoginResponse({
            body,
            expectedChallenge,
            origin,
            rpID,
            passkey
          });
        } catch {
          return { ok: false, statusCode: 401, message: 'Tên tài khoản hoặc thiết bị đăng nhập không đúng' };
        }
        if (!verification.verified) {
          return { ok: false, statusCode: 401, message: 'Tên tài khoản hoặc thiết bị đăng nhập không đúng' };
        }

        passkey.counter = verification.authenticationInfo.newCounter;
        user.updatedAt = now().toISOString();
        logEvent('account.passkey.login', { username: user.username });
        return { ok: true, account: serializeCurrentAccount(state, user) };
      });
      if (!outcome.ok) {
        const error = new Error(outcome.message);
        error.statusCode = outcome.statusCode;
        throw error;
      }
      return { account: outcome.account };
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
        const previousCount = (user.passkeys || []).length;
        user.passkeys = (user.passkeys || []).filter((p) => p.credentialID !== credentialId);
        if (user.passkeys.length === previousCount) {
          const error = new Error('Không tìm thấy passkey');
          error.statusCode = 404;
          throw error;
        }
        bumpAccountAuthEpoch(user);
        user.updatedAt = now().toISOString();
        logEvent('account.passkey.delete', { username: user.username });
        return { ok: true, account: serializeCurrentAccount(state, user) };
      });
    },

    async listLatestPosts(limit = 10) {
      return latestPostsFromState(await store.read(), limit);
    },

    async listRecommendedThreads(limit = 10, options: AnyRecord = {}) {
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
      return hotBoardsFromState(await store.read(), limit, now());
    },

    async listCampusPulse(limit = 12) {
      return campusPulseFromState(await store.read(), limit, now());
    },

    async listModerationActions(limit = 50, filters: AnyRecord = {}) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const actions = typeof store.readModerationActions === 'function'
        ? await store.readModerationActions({ limit: safeLimit, filters })
        : (await store.read()).moderationActions;
      return [...actions]
        .filter((action) => !filters.action || action.action === filters.action)
        .filter((action) => matchesAdminFilters(action, filters, 'createdAt'))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, safeLimit);
    },

    async listReports(limit = 50, filters: AnyRecord = {}) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const state = typeof store.readReportsModerationState === 'function'
        ? await store.readReportsModerationState({ limit: safeLimit, filters })
        : await store.read();
      const priorityContext = {
        reportCounts: state.reportCounts ?? openReportCountsByGlobalNumber(state.reports),
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

    async listThreads(boardSlug: string, options: AnyRecord = {}) {
      let state = await store.read();
      if (!findBoard(state, boardSlug, { publicOnly: true })) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }

      const checkedAt = now().toISOString();
      state = await stateAfterArchivingExpiredEvents(state, [boardSlug], checkedAt);
      if (!findBoard(state, boardSlug, { publicOnly: true })) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
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
      let state = await store.read();
      let board = findBoard(state, boardSlug);
      if (!board || board.isHidden || !boardRetentionPolicy(board, lifecycle).publicArchive) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }

      const checkedAt = now().toISOString();
      state = await stateAfterArchivingExpiredEvents(state, [boardSlug], checkedAt);
      board = findBoard(state, boardSlug);
      if (!board || board.isHidden || !boardRetentionPolicy(board, lifecycle).publicArchive) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
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
        publishRealtime('thread:archived', { thread: serialized });
        return serialized;
      });
    },

    async setThreadSticky(threadId: string, sticky: boolean, { actor = 'admin' }: AnyRecord = {}) {
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
        publishRealtime('thread:updated', { thread: serialized });
        return serialized;
      });
    },

    async setThreadLocked(threadId: string, locked: boolean, { actor = 'admin' }: AnyRecord = {}) {
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
        publishRealtime('thread:updated', { thread: serialized });
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
      const postLinks = await buildPostLinks(normalizedBody);
      const { displayName: normalizedDisplayName, tripcode } = parseDisplayNameWithTripcode(displayName);
      const createdAt = now().toISOString();
      assertEventBoardOpen(board, createdAt);
      const postCreateDelta = {
        thread: null,
        updatedThreads: [],
        moderationActions: [],
        appeals: [],
        notificationMessages: []
      };

      const result = await mutate(async (state) => {
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
          links: postLinks,
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
          publishRealtime('thread:created', { thread: serializeThread(thread, state.comments) });
          postCreateDelta.notificationMessages = postNotificationMessages(state, {
            kind: 'thread',
            thread,
            authorAccountId: accountId
          });
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
      queueEmails(postCreateDelta.notificationMessages, 'board-subscription');
      return result;
    },

    async getThread(threadId: string, options: AnyRecord = {}) {
      let state = await store.read();
      let thread = state.threads.find((item) => item.id === threadId && publicThread(state, item));
      if (!thread) {
        const error = new Error('Không tìm thấy chủ đề');
        error.statusCode = 404;
        throw error;
      }
      const checkedAt = now().toISOString();
      state = await stateAfterArchivingExpiredEvents(state, [thread.boardSlug], checkedAt);
      thread = state.threads.find((item) => item.id === threadId && publicThread(state, item));
      if (!thread) {
        const error = new Error('Không tìm thấy chủ đề');
        error.statusCode = 404;
        throw error;
      }

      const serializedThread = serializeThread(thread, state.comments);
      const serializedComments = state.comments
        .filter((comment) => comment.threadId === threadId && publicPost(comment))
        .sort((left, right) => left.globalNumber - right.globalNumber)
        .map((comment) => serializeComment(comment, thread));
      const withBacklinks = addBacklinks([serializedThread, ...serializedComments]);
      const [threadWithBacklinks, ...chronologicalComments] = withBacklinks;
      const boardThreads = state.threads
        .filter((item) => item.boardSlug === thread.boardSlug && activePublicThread(item))
        .sort(compareBoardThreads);
      const boardThreadIndex = boardThreads.findIndex((item) => item.id === thread.id);
      const threadNavigation = {
        previous: boardThreadIndex > 0 ? threadNavigationItem(boardThreads[boardThreadIndex - 1]) : null,
        next:
          boardThreadIndex >= 0 && boardThreadIndex < boardThreads.length - 1
            ? threadNavigationItem(boardThreads[boardThreadIndex + 1])
            : null
      };
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
          threadNavigation,
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
        threadNavigation,
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
      const postLinks = await buildPostLinks(normalizedBody);
      const { displayName: normalizedDisplayName, tripcode } = parseDisplayNameWithTripcode(displayName);
      const postCreateDelta = {
        comment: null,
        updatedThreads: [],
        moderationActions: [],
        appeals: [],
        notificationMessages: []
      };

      const result = await mutate(async (state) => {
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
          links: postLinks,
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
          publishRealtime('comment:created', { threadId, comment: serializeComment(comment, thread) });
          postCreateDelta.notificationMessages = postNotificationMessages(state, {
            kind: 'comment',
            thread,
            comment,
            authorAccountId: accountId
          });
          if (!postingOptions.sage && repliesBeforeCreate < retentionPolicy.bumpLimit) {
            thread.bumpedAt = createdAt;
            postCreateDelta.updatedThreads.push(thread);
            publishRealtime('thread:bumped', { thread: serializeThread(thread, state.comments) });
          }
        }
        if (slowModeRaised) {
          postCreateDelta.updatedThreads.push(thread);
          publishRealtime('thread:updated', { thread: serializeThread(thread, state.comments) });
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
      queueEmails(postCreateDelta.notificationMessages, 'watched-thread');
      return result;
    },

    async votePoll(threadId: string, { optionId, ip, posterToken }: AnyRecord = {}) {
      const selectedOptionId = String(optionId ?? '');
      return mutate(async (state) => {
        const thread = state.threads.find((item) => item.id === threadId && publicThread(state, item) && !item.isArchived);
        if (!thread?.poll) {
          const error = new Error('Không tìm thấy thăm dò');
          error.statusCode = 404;
          throw error;
        }
        if (thread.isLocked) {
          const error = new Error('Thăm dò đã đóng');
          error.statusCode = 409;
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
        publishRealtime('thread:updated', { thread: serialized });
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

    async submitAppeal({ token, reason, ip, posterToken }: AnyRecord = {}) {
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

    async votePost({ globalNumber, direction, accountId }: AnyRecord = {}) {
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
          publishRealtime('thread:updated', { thread: serializeThread(post, state.comments) });
        } else {
          const thread = state.threads.find((item) => item.id === post.threadId);
          publishRealtime('comment:updated', {
            threadId: post.threadId,
            comment: serializeComment(post, thread)
          });
        }
        return { votes: publicVotes(post), myVote };
      });
    },

    async reactPost({ globalNumber, reaction, accountId }: AnyRecord = {}) {
      const reactionType = normalizeReactionType(reaction);
      if (!accountId) {
        const error = new Error('Vui lòng đăng nhập tài khoản để react');
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
        // One reaction per account. Also prune legacy anon:* keys so old
        // fingerprint votes cannot double-count alongside account votes.
        const voterKey = `account:${String(accountId)}`;
        post.reactionVoters ??= {};
        if (post.reactionVoters[voterKey] === reactionType) {
          delete post.reactionVoters[voterKey];
        } else {
          post.reactionVoters[voterKey] = reactionType;
        }

        syncPostReactions(post);
        const myReaction = post.reactionVoters[voterKey] ?? null;

        if (found.postType === 'thread') {
          publishRealtime('thread:updated', { thread: serializeThread(post, state.comments) });
        } else {
          const thread = state.threads.find((item) => item.id === post.threadId);
          publishRealtime('comment:updated', {
            threadId: post.threadId,
            comment: serializeComment(post, thread)
          });
        }
        return { reactions: publicReactions(post), myReaction };
      });
    },

    async deletePost({ globalNumber, accountId, fileOnly = false }: AnyRecord = {}) {
      if (!accountId) {
        const error = new Error('Vui lòng đăng nhập tài khoản để xóa bài');
        error.statusCode = 401;
        throw error;
      }
      let removedMedia = [];
      const result = await mutate(async (state) => {
        const found = findPublicPostByGlobalNumber(state, globalNumber);
        if (!found) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }
        if (!found.post.accountId || found.post.accountId !== accountId) {
          const error = new Error('Chỉ tài khoản đã đăng bài mới được xóa bài này');
          error.statusCode = 403;
          throw error;
        }

        const deletedAt = now().toISOString();
        if (fileOnly) {
          if (mediaItems(found.post).length === 0) {
            const error = new Error('Bài viết không có tệp để xóa');
            error.statusCode = 400;
            throw error;
          }
          removedMedia = cloneMediaItems(found.post);
          found.post.image = null;
          found.post.images = [];
          found.post.fileDeletedAt = deletedAt;
        } else {
          found.post.isDeleted = true;
          found.post.deletedAt = deletedAt;
          found.post.deleteReason = 'account-delete';
        }
        recordModerationAction(state, {
          action: fileOnly ? 'user:delete-file' : 'user:delete',
          actor: `account:${accountId}`,
          postType: found.postType,
          post: found.post,
          reason: fileOnly ? 'file-only' : 'account-delete',
          createdAt: deletedAt
        });

        if (found.postType === 'thread') {
          publishRealtime('thread:updated', {
            threadId: found.post.id,
            boardSlug: found.post.boardSlug,
            deleted: !fileOnly,
            fileOnly: Boolean(fileOnly)
          });
        } else {
          const parent = state.threads.find((thread) => thread.id === found.post.threadId);
          publishRealtime('thread:updated', { thread: parent ? serializeThread(parent, state.comments) : null });
        }
        return { ok: true, fileOnly: Boolean(fileOnly), globalNumber: found.post.globalNumber };
      });
      if (fileOnly) {
        await deleteStoredMedia(imageStorage, removedMedia, {
          onFailure(storageKey, error) {
            logEvent('media.delete.failed', {
              globalNumber,
              storageKey,
              message: String(error?.message || 'unknown')
            });
          }
        });
      }
      return result;
    },

    async listPending(filters: AnyRecord = {}, limit = 100) {
      const state = typeof store.readPendingModerationState === 'function'
        ? await store.readPendingModerationState()
        : await store.read();
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

    async listDeleted(limit = 50, filters: AnyRecord = {}) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const state = typeof store.readDeletedModerationState === 'function'
        ? await store.readDeletedModerationState({ limit: safeLimit, filters })
        : await store.read();
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

    async listAppeals(limit = 50, filters: AnyRecord = {}) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const state = typeof store.readAppealsModerationState === 'function'
        ? await store.readAppealsModerationState({ limit: safeLimit, filters })
        : await store.read();
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

    async listApprovedHistory(limit = 50, filters: AnyRecord = {}) {
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

    async resolveAppeal(id: string, { status = 'rejected', reason = '', actor = 'admin' }: AnyRecord = {}) {
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

    async adminEditPost(globalNumber: number, { body = '', reason = '', actor = 'admin' }: AnyRecord = {}) {
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
          publishRealtime('thread:updated', { thread: serializeThread(found.post, state.comments) });
        } else {
          const parent = state.threads.find((thread) => thread.id === found.post.threadId);
          publishRealtime('comment:updated', {
            threadId: found.post.threadId,
            comment: serializeComment(found.post, parent)
          });
          publishRealtime('thread:updated', { thread: parent ? serializeThread(parent, state.comments) : null });
        }
        return {
          ok: true,
          globalNumber: found.post.globalNumber,
          post: serializeAdminPost(found.postType, found.post, state)
        };
      });
    },

    async adminDeletePost(globalNumber: number, { reason = '', actor = 'admin', fileOnly = false }: AnyRecord = {}) {
      let removedMedia = [];
      const result = await mutate(async (state) => {
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
          removedMedia = cloneMediaItems(found.post);
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
          publishRealtime('thread:updated', {
            threadId: found.post.id,
            boardSlug: found.post.boardSlug,
            deleted: !fileOnly,
            fileOnly: Boolean(fileOnly)
          });
        } else {
          const parent = state.threads.find((thread) => thread.id === found.post.threadId);
          publishRealtime('thread:updated', { thread: parent ? serializeThread(parent, state.comments) : null });
        }
        return { ok: true, fileOnly: Boolean(fileOnly), globalNumber: found.post.globalNumber };
      });
      if (fileOnly) {
        await deleteStoredMedia(imageStorage, removedMedia, {
          onFailure(storageKey, error) {
            logEvent('media.delete.failed', {
              globalNumber,
              storageKey,
              actor,
              message: String(error?.message || 'unknown')
            });
          }
        });
      }
      return result;
    },

    async editPostWithPassword(globalNumber: number, { password = '', body = '' }: AnyRecord = {}) {
      assertPostBodySize(body);
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung không được để trống');
        error.statusCode = 400;
        throw error;
      }
      const postLinks = await buildPostLinks(normalizedBody);

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
        found.post.links = postLinks;
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
            publishRealtime('thread:updated', { thread: serializeThread(found.post, state.comments) });
          } else {
            const parent = state.threads.find((thread) => thread.id === found.post.threadId);
            publishRealtime('comment:updated', {
              threadId: found.post.threadId,
              comment: serializeComment(found.post, parent)
            });
            publishRealtime('thread:updated', { thread: parent ? serializeThread(parent, state.comments) : null });
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

    async adminRestorePost(globalNumber: number, { reason = '', actor = 'admin' }: AnyRecord = {}) {
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

    async editAccountPost(globalNumber: number, { accountId, body = '', image, images, replaceImages = false }: AnyRecord = {}) {
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
      const postLinks = await buildPostLinks(normalizedBody);
      let previousMedia = [];
      let newMedia = [];
      let committed = false;

      try {
        const result = await mutate(async (state) => {
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
        if (shouldReplaceImages) {
          previousMedia = previousImages;
          newMedia = storedImages;
        }
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
        found.post.links = postLinks;
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
            publishRealtime('thread:updated', { thread: serializeThread(found.post, state.comments) });
          } else {
            const parent = state.threads.find((thread) => thread.id === found.post.threadId);
            publishRealtime('comment:updated', {
              threadId: found.post.threadId,
              comment: serializeComment(found.post, parent)
            });
            publishRealtime('thread:updated', { thread: parent ? serializeThread(parent, state.comments) : null });
          }
        }

        const parent = found.postType === 'comment' ? state.threads.find((thread) => thread.id === found.post.threadId) : null;
        return {
          status: found.post.isPending ? 'pending' : 'published',
          type: found.postType,
          post: found.postType === 'thread' ? serializeThread(found.post, state.comments) : serializeComment(found.post, parent)
        };
        });
        committed = true;
        if (shouldReplaceImages) {
          await deleteStoredMedia(imageStorage, previousMedia, {
            exceptKeys: new Set(mediaStorageKeys(newMedia)),
            onFailure(storageKey, error) {
              logEvent('media.replace.cleanup.failed', {
                globalNumber,
                storageKey,
                message: String(error?.message || 'unknown')
              });
            }
          });
        }
        return result;
      } catch (error) {
        if (shouldReplaceImages && !committed && newMedia.length > 0) {
          await deleteStoredMedia(imageStorage, newMedia, {
            onFailure(storageKey, cleanupError) {
              logEvent('media.replace.rollback.failed', {
                globalNumber,
                storageKey,
                message: String(cleanupError?.message || 'unknown')
              });
            }
          }).catch(() => undefined);
        }
        throw error;
      }
    },

    async addModeratorNote(globalNumber: number, { note = '', actor = 'admin' }: AnyRecord = {}) {
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

    async listSanctions(limit = 50, filters: AnyRecord = {}) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const sanctions = typeof store.readSanctions === 'function'
        ? await store.readSanctions({ limit: safeLimit, filters })
        : (await store.read()).sanctions;
      const checkedAt = now().toISOString();
      return [...sanctions]
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

    async createSanctionForPost(globalNumber: number, { kind = 'cooldown', durationMinutes, reason = '', actor = 'admin' }: AnyRecord = {}) {
      const safeKind = kind === 'ban' ? 'ban' : 'cooldown';
      const safeDuration = sanitizeDurationMinutes(durationMinutes, safeKind === 'ban' ? 24 * 60 : 60);
      const safeReason = sanitizeReason(reason) || (safeKind === 'ban' ? 'Tạm khóa' : 'Cooldown');
      if (typeof store.createSanctionForPost === 'function') {
        const createdAt = now().toISOString();
        const expiresAt = new Date(new Date(createdAt).getTime() + safeDuration * 60 * 1000).toISOString();
        const sanction = await store.createSanctionForPost({
          globalNumber,
          kind: safeKind,
          durationMinutes: safeDuration,
          reason: safeReason,
          actor,
          createdAt,
          expiresAt
        });
        logEvent('moderation.sanction', {
          kind: safeKind,
          boardSlug: sanction.boardSlug,
          globalNumber: sanction.sourceGlobalNumber,
          actor
        });
        return serializeSanction(sanction);
      }

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

    async revokeSanction(id: string, { reason = '', actor = 'admin' }: AnyRecord = {}) {
      if (typeof store.revokeSanction === 'function') {
        const revokedAt = now().toISOString();
        const revokeReason = sanitizeReason(reason);
        const revoked = await store.revokeSanction({ id, reason: revokeReason, actor, revokedAt });
        logEvent('moderation.unsanction', {
          kind: revoked.sanction.kind,
          boardSlug: revoked.sanction.boardSlug,
          sourceGlobalNumber: revoked.sanction.sourceGlobalNumber,
          actor
        });
        return serializeSanction(revoked.sanction);
      }

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

    async approvePending(id: string, { reason = '', actor = 'admin' }: AnyRecord = {}) {
      if (typeof store.approvePending === 'function') {
        const actionAt = now().toISOString();
        const moderationReason = sanitizeReason(reason);
        const approved = await store.approvePending({ id, reason: moderationReason, actor, createdAt: actionAt });
        if (approved.postType === 'thread') {
          logEvent('moderation.approve', {
            postType: 'thread',
            boardSlug: approved.post.boardSlug,
            globalNumber: approved.post.globalNumber,
            actor
          });
          const thread = serializeThread(approved.post, approved.comments ?? []);
          publishRealtime('thread:created', { thread });
          await queueApprovedPostNotifications('thread', approved.post.id);
          return thread;
        }
        if (approved.postType === 'comment') {
          logEvent('moderation.approve', {
            postType: 'comment',
            boardSlug: approved.post.boardSlug,
            globalNumber: approved.post.globalNumber,
            actor
          });
          const comment = serializeComment(approved.post, approved.parent);
          publishRealtime('comment:created', { threadId: approved.parent.id, comment });
          publishRealtime('thread:bumped', { thread: serializeThread(approved.parent, approved.comments ?? []) });
          await queueApprovedPostNotifications('comment', approved.post.id);
          return comment;
        }
      }
      let approvedPostType = '';
      const result = await mutate(async (state) => {
        const actionAt = now().toISOString();
        const thread = state.threads.find((item) => item.id === id && item.isPending && !item.isDeleted);
        if (thread) {
          approvedPostType = 'thread';
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
          publishRealtime('thread:created', { thread: serializeThread(thread, state.comments) });
          return serializeThread(thread, state.comments);
        }

        const comment = state.comments.find((item) => item.id === id && item.isPending && !item.isDeleted);
        if (comment) {
          approvedPostType = 'comment';
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
          publishRealtime('comment:created', { threadId: parent.id, comment: serializeComment(comment, parent) });
          publishRealtime('thread:bumped', { thread: serializeThread(parent, state.comments) });
          return serializeComment(comment, parent);
        }

        const error = new Error('Không tìm thấy bài đang chờ duyệt');
        error.statusCode = 404;
        throw error;
      });
      await queueApprovedPostNotifications(approvedPostType, id);
      return result;
    },

    async deletePending(id: string, { reason = '', actor = 'admin' }: AnyRecord = {}) {
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

    async checkDuplicateThread({ boardSlug, body, ip, posterToken, actor = 'public' }: AnyRecord = {}) {
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

    async summarizeThread(threadId: string, { ip, posterToken, actor = 'public', sinceGlobalNumber = 0 }: AnyRecord = {}) {
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

    async summarizeBoard(boardSlug: string, { ip, posterToken, actor = 'public' }: AnyRecord = {}) {
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
    async generateBoardDigest({ ip, actor = 'admin', limit = 50 }: AnyRecord = {}) {
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

    async suggestComments(threadId: string, { ip, posterToken, actor = 'public' }: AnyRecord = {}) {
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

    async answerChat({
      question,
      scope = 'site',
      page = 'home',
      boardSlug,
      threadId,
      history,
      ip,
      posterToken,
      actor = 'public'
    }: AnyRecord = {}) {
      if (typeof ai.answer !== 'function') {
        throw chatRequestError('Trợ lý AI chưa được cấu hình', 503);
      }
      const safeQuestion = normalizeChatQuestion(question);
      const safeScope = normalizeChatScope(scope);
      const safePage = normalizeChatPage(page);
      const safeHistory = normalizeChatHistory(history);
      const snapshot = await store.read();
      const chatContext = buildChatContext(snapshot, {
        scope: safeScope,
        page: safePage,
        boardSlug,
        threadId,
        question: safeQuestion
      });
      const createdAt = now().toISOString();
      await mutate((state) => {
        consumeAiBudget(state, {
          kind: 'chat',
          ip,
          posterToken,
          actor,
          createdAt
        });
        consumeAiBudget(state, {
          kind: 'chatIp',
          ip,
          posterToken: '',
          actor,
          createdAt
        });
        return null;
      });

      logEvent('ai.chat', {
        scope: chatContext.scope,
        boardSlug: chatContext.scope === 'board' ? String(boardSlug || '') : undefined,
        threadId: chatContext.scope === 'thread' ? String(threadId || '') : undefined,
        historyLength: safeHistory.length
      });
      const answer = String(await ai.answer(safeQuestion, chatContext.context, safeHistory))
        .trim()
        .slice(0, 5_000);
      if (!answer) {
        throw chatRequestError('AI chưa trả về câu trả lời. Vui lòng thử lại.', 502);
      }
      const rawSources = Array.isArray(chatContext.sources) ? chatContext.sources.slice(0, CHAT_SOURCE_LIMIT) : [];
      const sources = rankChatSources(rawSources, safeQuestion, 12);
      const followUps = buildChatFollowUps(chatContext.scope, safeQuestion).slice(0, 4);
      return {
        answer,
        context: {
          scope: chatContext.scope,
          label: chatContext.label
        },
        sources,
        followUps
      };
    },

    async rewriteDraft({ body, ip, posterToken, actor = 'public', tone = 'neutral' }: AnyRecord = {}) {
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

    async translateDraft({ text, targetLang = 'vi', ip, posterToken, actor = 'public' }: AnyRecord = {}) {
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

    async transcribeAudio({ audio, ip, posterToken, actor = 'public' }: AnyRecord = {}) {
      assertAiMedia(audio, 12 * 1024 * 1024, 'audio');
      return mutate(async (state) => {
        consumeAiBudget(state, { kind: 'transcribe', ip, posterToken, actor, createdAt: now().toISOString() });
        logEvent('ai.transcribe', { actor });
        return { text: await ai.transcribe(audio) };
      });
    },

    async captionImage({ image, mode = 'describe', ip, posterToken, actor = 'public' }: AnyRecord = {}) {
      assertAiMedia(image, 8 * 1024 * 1024, 'image');
      const safeMode = mode === 'ocr' ? 'ocr' : 'describe';
      return mutate(async (state) => {
        consumeAiBudget(state, { kind: 'caption', ip, posterToken, actor, createdAt: now().toISOString() });
        logEvent('ai.caption', { actor, mode: safeMode });
        return { text: await ai.caption(image, safeMode), mode: safeMode };
      });
    },

    async speakText({ text, voice, languageCode, ip, posterToken, actor = 'public' }: AnyRecord = {}) {
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

    async summarizePostReports(globalNumber: number, { ip, actor = 'admin' }: AnyRecord = {}) {
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
      const boardActivity = [];
      for (const board of state.boards) {
        const boardThreads = state.threads.filter((t) => t.boardSlug === board.slug);
        const boardComments = state.comments.filter((c) => c.boardSlug === board.slug);
        const boardReports = state.reports.filter((r) => r.boardSlug === board.slug);
        boardActivity.push({
          slug: board.slug,
          name: board.name,
          threads: {
            active: boardThreads.filter((t) => !t.isPending && !t.isDeleted).length,
            pending: boardThreads.filter((t) => t.isPending && !t.isDeleted).length,
            deleted: boardThreads.filter((t) => t.isDeleted).length
          },
          comments: {
            active: boardComments.filter((c) => !c.isPending && !c.isDeleted).length,
            pending: boardComments.filter((c) => c.isPending && !c.isDeleted).length,
            deleted: boardComments.filter((c) => c.isDeleted).length
          },
          reportsCount: boardReports.length
        });
      }

      let totalAiUsage = 0;
      const byKind = { moderation: 0, summary: 0, suggestion: 0, rewrite: 0 };
      const dailyUsage: AnyRecord = {};

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

    async createBoard(
      { slug, name, category, description, rules, banner, isHidden, isArchived, temporary, eventEndsAt, retentionPolicy }: AnyRecord = {},
      { actor }: AnyRecord = {}
    ) {
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
        const board: AnyRecord = {
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

    async updateBoard(
      slug: string,
      { name, category, description, rules, banner, isHidden, isArchived, temporary, eventEndsAt, retentionPolicy }: AnyRecord = {},
      { actor }: AnyRecord = {}
    ) {
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

    async deleteBoard(slug: string, { actor }: AnyRecord = {}) {
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
    },

    /**
     * Direct messages — account holders only (user / owner / moderator / viewer).
     * Message bodies are AES-256-GCM encrypted at rest. Anonymous posters cannot use DMs.
     */
    async listDmConversations(accountId: string) {
      if (!accountId) {
        const error = new Error('Vui lòng đăng nhập tài khoản');
        error.statusCode = 401;
        throw error;
      }
      const state = await store.read();
      ensureDmCollections(state);
      return state.dmConversations
        .filter(
          (conversation: AnyRecord) =>
            conversationIncludesUser(conversation, accountId) &&
            !conversationIsHiddenFor(conversation, accountId)
        )
        .map((conversation: AnyRecord) => serializeDmConversation(conversation, state, accountId, dmSecret))
        .sort((left: AnyRecord, right: AnyRecord) =>
          String(right.lastMessageAt || right.updatedAt || '').localeCompare(
            String(left.lastMessageAt || left.updatedAt || '')
          )
        );
    },

    async getDmUnreadCount(accountId: string) {
      if (!accountId) {
        const error = new Error('Vui lòng đăng nhập tài khoản');
        error.statusCode = 401;
        throw error;
      }
      const cached = await cachedUnreadCount(accountId);
      if (cached !== null) {
        return { unreadCount: cached };
      }
      const state = await store.read();
      const unreadCount = countUnreadForUser(state, accountId);
      await cacheUnreadCount(accountId, unreadCount);
      return { unreadCount };
    },

    async openDmConversation(accountId: string, { username }: AnyRecord = {}) {
      if (!accountId) {
        const error = new Error('Vui lòng đăng nhập tài khoản');
        error.statusCode = 401;
        throw error;
      }
      // Accept "@example" the way users type mentions; store usernames have no @.
      const safeUsername = normalizeAccountUsername(String(username ?? '').replace(/^@+/, ''));
      if (!safeUsername) {
        const error = new Error('Vui lòng nhập tên tài khoản người nhận');
        error.statusCode = 400;
        throw error;
      }

      return mutate(async (state) => {
        ensureDmCollections(state);
        const me = state.users.find((item: AnyRecord) => item.id === accountId);
        if (!me || me.disabled) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        const peer = state.users.find(
          (item: AnyRecord) => normalizeAccountUsername(item.username) === safeUsername
        );
        if (!peer || peer.disabled) {
          const error = new Error('Không tìm thấy tài khoản người nhận');
          error.statusCode = 404;
          throw error;
        }
        if (peer.id === me.id) {
          const error = new Error('Không thể nhắn tin cho chính mình');
          error.statusCode = 400;
          throw error;
        }
        if (isDmBlockedBetween(state, me.id, peer.id)) {
          throw dmServiceError('Không thể nhắn tin vì một bên đã chặn', 403);
        }

        const key = participantKeyFor(me.id, peer.id);
        let conversation = state.dmConversations.find(
          (item: AnyRecord) => item.participantKey === key
        );
        if (!conversation) {
          const mineCount = state.dmConversations.filter((item: AnyRecord) =>
            conversationIncludesUser(item, me.id)
          ).length;
          if (mineCount >= MAX_DM_CONVERSATIONS_PER_USER) {
            const error = new Error('Đã đạt giới hạn số cuộc trò chuyện');
            error.statusCode = 400;
            throw error;
          }
          conversation = createDmConversationRecord([me.id, peer.id], now().toISOString());
          state.dmConversations.push(conversation);
          logEvent('dm.conversation.open', {
            conversationId: conversation.id,
            from: me.username,
            to: peer.username
          });
        } else {
          unhideConversationForUser(conversation, accountId);
        }
        return serializeDmConversation(conversation, state, accountId, dmSecret);
      });
    },

    async listDmMessages(
      accountId: string,
      conversationId: string,
      { limit = 30, before }: AnyRecord = {}
    ) {
      if (!accountId) {
        const error = new Error('Vui lòng đăng nhập tài khoản');
        error.statusCode = 401;
        throw error;
      }
      const state = await store.read();
      ensureDmCollections(state);
      const conversation = state.dmConversations.find(
        (item: AnyRecord) => item.id === conversationId
      );
      if (!conversation || !conversationIncludesUser(conversation, accountId)) {
        const error = new Error('Không tìm thấy cuộc trò chuyện');
        error.statusCode = 404;
        throw error;
      }
      const safeLimit = Math.max(1, Math.min(Number(limit) || 30, MAX_DM_MESSAGE_PAGE));
      const beforeTs = before ? String(before) : '';
      let messages = state.dmMessages
        .filter((item: AnyRecord) => item.conversationId === conversationId)
        .sort((left: AnyRecord, right: AnyRecord) => left.createdAt.localeCompare(right.createdAt));
      if (beforeTs) {
        messages = messages.filter((item: AnyRecord) => item.createdAt < beforeTs);
      }
      const page = messages.slice(-safeLimit).map((item: AnyRecord) =>
        serializeDmMessage(item, dmSecret, state, accountId)
      );
      return {
        conversation: serializeDmConversation(conversation, state, accountId, dmSecret),
        messages: page,
        hasMore: messages.length > safeLimit
      };
    },

    async sendDmMessage(
      accountId: string,
      conversationId: string,
      { body, image, images, replyToId }: AnyRecord = {}
    ) {
      if (!accountId) {
        const error = new Error('Vui lòng đăng nhập tài khoản');
        error.statusCode = 401;
        throw error;
      }
      await enforceRealtimeUserRateLimit(accountId, 'dm:send', {
        limit: readPositiveInteger(process.env.DM_SEND_RATE_LIMIT, 30),
        windowMs: 60_000
      });
      const text = normalizeDmBody(body);
      assertDmBodyMediaTokens(text);
      const safeImages = validateMediaList({ image, images }).slice(0, MAX_DM_MEDIA_PER_MESSAGE);
      if (!text && !safeImages.length) {
        const error = new Error('Nội dung tin nhắn không được để trống');
        error.statusCode = 400;
        throw error;
      }
      const safeReplyToId = String(replyToId || '').trim() || null;
      const storedImages = safeImages.length
        ? await saveMediaList(imageStorage, safeImages)
        : [];

      const result = await mutate(async (state) => {
        ensureDmCollections(state);
        const me = state.users.find((item: AnyRecord) => item.id === accountId);
        if (!me || me.disabled) {
          const error = new Error('Phiên đăng nhập không còn hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          const error = new Error('Không tìm thấy cuộc trò chuyện');
          error.statusCode = 404;
          throw error;
        }
        if (conversationKind(conversation) === 'direct') {
          const peerId = normalizeParticipantIds(conversation.participantIds).find(
            (id) => id !== accountId
          );
          if (peerId && isDmBlockedBetween(state, accountId, peerId)) {
            throw dmServiceError('Không thể nhắn tin vì một bên đã chặn', 403);
          }
        }
        if (safeReplyToId) {
          const parent = state.dmMessages.find(
            (item: AnyRecord) =>
              item.id === safeReplyToId && item.conversationId === conversationId
          );
          if (!parent || parent.deletedAt) {
            throw dmServiceError('Tin nhắn được trả lời không tồn tại');
          }
        }
        const createdAt = now().toISOString();
        const message = createDmMessageRecord({
          conversationId,
          senderId: accountId,
          body: text || (storedImages.length ? '[Ảnh]' : ''),
          createdAt,
          secret: dmSecret,
          images: storedImages,
          replyToId: safeReplyToId,
          links: extractDmLinks(text)
        });
        state.dmMessages.push(message);
        conversation.updatedAt = createdAt;
        conversation.lastMessageAt = createdAt;
        conversation.lastMessageId = message.id;
        conversation.lastCiphertext = message.ciphertext;
        conversation.lastIv = message.iv;
        conversation.lastAuthTag = message.authTag;
        unhideConversationForAll(conversation);
        if (!conversation.unreadBy || typeof conversation.unreadBy !== 'object') {
          conversation.unreadBy = {};
        }
        for (const participantId of normalizeParticipantIds(conversation.participantIds)) {
          if (participantId === accountId) {
            conversation.unreadBy[participantId] = 0;
          } else {
            conversation.unreadBy[participantId] =
              Math.max(0, Number(conversation.unreadBy[participantId] || 0)) + 1;
          }
        }
        trimConversationMessages(state, conversationId);
        logEvent('dm.message.send', {
          conversationId,
          messageId: message.id,
          sender: me.username
        });
        const participantIds = normalizeParticipantIds(conversation.participantIds);
        return {
          conversation: serializeDmConversation(conversation, state, accountId, dmSecret),
          message: serializeDmMessage(message, dmSecret, state, accountId),
          participantIds,
          unreadCounts: Object.fromEntries(
            participantIds.map((participantId) => [
              participantId,
              countUnreadForUser(state, participantId)
            ])
          ),
          senderUsername: me.username,
          notificationMessages: directMessageNotificationMessages(state, {
            conversation,
            sender: me
          })
        };
      });

      await Promise.all(
        Object.entries(result.unreadCounts).map(([participantId, unreadCount]) =>
          cacheUnreadCount(participantId, Number(unreadCount))
        )
      );
      queueEmails(result.notificationMessages, 'direct-message');

      // Notification-only Socket.IO payload — never include decrypted body in fan-out.
      publishRealtime('dm:message', {
        conversationId,
        messageId: result.message.id,
        senderId: accountId,
        senderUsername: result.senderUsername,
        participantIds: result.participantIds,
        createdAt: result.message.createdAt
      });

      return {
        conversation: result.conversation,
        message: result.message
      };
    },

    async markDmConversationRead(accountId: string, conversationId: string) {
      if (!accountId) {
        const error = new Error('Vui lòng đăng nhập tài khoản');
        error.statusCode = 401;
        throw error;
      }
      await enforceRealtimeUserRateLimit(accountId, 'dm:read', {
        limit: readPositiveInteger(process.env.DM_READ_RATE_LIMIT, 120),
        windowMs: 60_000
      });
      const result = await mutate(async (state) => {
        ensureDmCollections(state);
        const me = state.users.find((item: AnyRecord) => item.id === accountId);
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          const error = new Error('Không tìm thấy cuộc trò chuyện');
          error.statusCode = 404;
          throw error;
        }
        if (!conversation.unreadBy || typeof conversation.unreadBy !== 'object') {
          conversation.unreadBy = {};
        }
        conversation.unreadBy[accountId] = 0;
        for (const message of state.dmMessages) {
          if (message.conversationId !== conversationId) {
            continue;
          }
          if (!Array.isArray(message.readBy)) {
            message.readBy = [];
          }
          if (!message.readBy.includes(accountId)) {
            message.readBy.push(accountId);
          }
        }
        const readAt = now().toISOString();
        conversation.updatedAt = readAt;
        return {
          conversation: serializeDmConversation(conversation, state, accountId, dmSecret),
          participantIds: normalizeParticipantIds(conversation.participantIds),
          readerUsername: String(me?.username || ''),
          readAt,
          lastReadMessageId: String(conversation.lastMessageId || ''),
          unreadCount: countUnreadForUser(state, accountId)
        };
      });
      await cacheUnreadCount(accountId, result.unreadCount);
      publishRealtime('dm:read', {
        conversationId,
        readerId: accountId,
        readerUsername: result.readerUsername,
        participantIds: result.participantIds,
        readAt: result.readAt,
        lastReadMessageId: result.lastReadMessageId
      });
      return result.conversation;
    },

    async createDmGroup(
      accountId: string,
      { title, usernames }: AnyRecord = {}
    ) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const safeTitle = sanitizeGroupTitle(title);
      if (!safeTitle) {
        throw dmServiceError('Vui lòng nhập tên nhóm');
      }
      const rawNames = Array.isArray(usernames)
        ? usernames
        : String(usernames || '')
            .split(/[\s,;]+/)
            .filter(Boolean);
      const requested = [
        ...new Set(
          rawNames
            .map((name: unknown) =>
              normalizeAccountUsername(String(name ?? '').replace(/^@+/, ''))
            )
            .filter(Boolean)
        )
      ].slice(0, MAX_DM_GROUP_INVITE_BATCH);

      return mutate(async (state) => {
        ensureDmCollections(state);
        const me = state.users.find((item: AnyRecord) => item.id === accountId);
        if (!me || me.disabled) {
          throw dmServiceError('Phiên đăng nhập không còn hợp lệ', 401);
        }
        const peerIds: string[] = [];
        for (const username of requested) {
          if (normalizeAccountUsername(me.username) === username) {
            continue;
          }
          const peer = state.users.find(
            (item: AnyRecord) => normalizeAccountUsername(item.username) === username
          );
          if (!peer || peer.disabled) {
            throw dmServiceError(`Không tìm thấy tài khoản @${username}`, 404);
          }
          peerIds.push(peer.id);
        }
        if (peerIds.length < 1) {
          throw dmServiceError('Nhóm cần ít nhất một thành viên khác');
        }
        const participantIds = normalizeParticipantIds([me.id, ...peerIds]);
        if (participantIds.length > MAX_DM_GROUP_PARTICIPANTS) {
          throw dmServiceError(`Nhóm tối đa ${MAX_DM_GROUP_PARTICIPANTS} thành viên`);
        }
        const mineCount = state.dmConversations.filter((item: AnyRecord) =>
          conversationIncludesUser(item, me.id)
        ).length;
        if (mineCount >= MAX_DM_CONVERSATIONS_PER_USER) {
          throw dmServiceError('Đã đạt giới hạn số cuộc trò chuyện');
        }
        const createdAt = now().toISOString();
        const conversation = createGroupConversationRecord({
          title: safeTitle,
          createdBy: me.id,
          participantIds,
          createdAt
        });
        state.dmConversations.push(conversation);
        logEvent('dm.group.create', {
          conversationId: conversation.id,
          owner: me.username,
          members: participantIds.length
        });
        return serializeDmConversation(conversation, state, accountId, dmSecret);
      });
    },

    async inviteDmGroupMembers(
      accountId: string,
      conversationId: string,
      { usernames }: AnyRecord = {}
    ) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const rawNames = Array.isArray(usernames)
        ? usernames
        : String(usernames || '')
            .split(/[\s,;]+/)
            .filter(Boolean);
      const requested = [
        ...new Set(
          rawNames
            .map((name: unknown) =>
              normalizeAccountUsername(String(name ?? '').replace(/^@+/, ''))
            )
            .filter(Boolean)
        )
      ].slice(0, MAX_DM_GROUP_INVITE_BATCH);
      if (!requested.length) {
        throw dmServiceError('Nhập ít nhất một @username để mời');
      }

      return mutate(async (state) => {
        ensureDmCollections(state);
        const me = state.users.find((item: AnyRecord) => item.id === accountId);
        if (!me || me.disabled) {
          throw dmServiceError('Phiên đăng nhập không còn hợp lệ', 401);
        }
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          throw dmServiceError('Không tìm thấy cuộc trò chuyện', 404);
        }
        if (conversationKind(conversation) !== 'group') {
          throw dmServiceError('Chỉ nhóm mới có thể mời thành viên');
        }
        const actorRole = getMemberRole(conversation, accountId);
        if (!canManageGroupMembers(actorRole)) {
          throw dmServiceError('Bạn không có quyền mời thành viên', 403);
        }
        const ids = normalizeParticipantIds(conversation.participantIds);
        const roles = normalizeDmRoles(conversation.roles, ids, conversation.createdBy);
        for (const username of requested) {
          if (normalizeAccountUsername(me.username) === username) {
            continue;
          }
          const peer = state.users.find(
            (item: AnyRecord) => normalizeAccountUsername(item.username) === username
          );
          if (!peer || peer.disabled) {
            throw dmServiceError(`Không tìm thấy tài khoản @${username}`, 404);
          }
          if (ids.includes(peer.id)) {
            continue;
          }
          if (ids.length >= MAX_DM_GROUP_PARTICIPANTS) {
            throw dmServiceError(`Nhóm tối đa ${MAX_DM_GROUP_PARTICIPANTS} thành viên`);
          }
          ids.push(peer.id);
          roles[peer.id] = 'member';
          if (!conversation.unreadBy || typeof conversation.unreadBy !== 'object') {
            conversation.unreadBy = {};
          }
          conversation.unreadBy[peer.id] = 0;
        }
        conversation.participantIds = normalizeParticipantIds(ids);
        conversation.roles = normalizeDmRoles(roles, conversation.participantIds, conversation.createdBy);
        conversation.updatedAt = now().toISOString();
        logEvent('dm.group.invite', {
          conversationId,
          actor: me.username,
          members: conversation.participantIds.length
        });
        return serializeDmConversation(conversation, state, accountId, dmSecret);
      });
    },

    async leaveDmConversation(accountId: string, conversationId: string) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const result = await mutate(async (state) => {
        ensureDmCollections(state);
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          throw dmServiceError('Không tìm thấy cuộc trò chuyện', 404);
        }
        if (conversationKind(conversation) === 'direct') {
          throw dmServiceError('Chat 1-1 không hỗ trợ rời nhóm — chỉ dùng cho nhóm');
        }
        const { emptied } = removeParticipantFromConversation(conversation, accountId);
        conversation.updatedAt = now().toISOString();
        if (emptied) {
          state.dmConversations = state.dmConversations.filter(
            (item: AnyRecord) => item.id !== conversationId
          );
          state.dmMessages = state.dmMessages.filter(
            (item: AnyRecord) => item.conversationId !== conversationId
          );
          logEvent('dm.group.delete', { conversationId, reason: 'empty' });
          return { left: true, deleted: true, conversation: null };
        }
        logEvent('dm.group.leave', { conversationId, userId: accountId });
        return { left: true, deleted: false, conversation: null };
      });
      await invalidateUnreadCounts([accountId]);
      return result;
    },

    async kickDmGroupMember(
      accountId: string,
      conversationId: string,
      { userId, username }: AnyRecord = {}
    ) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const result = await mutate(async (state) => {
        ensureDmCollections(state);
        const me = state.users.find((item: AnyRecord) => item.id === accountId);
        if (!me || me.disabled) {
          throw dmServiceError('Phiên đăng nhập không còn hợp lệ', 401);
        }
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          throw dmServiceError('Không tìm thấy cuộc trò chuyện', 404);
        }
        if (conversationKind(conversation) !== 'group') {
          throw dmServiceError('Chỉ nhóm mới có thể kick thành viên');
        }
        const actorRole = getMemberRole(conversation, accountId);
        let targetId = String(userId || '').trim();
        if (!targetId && username) {
          const safeUsername = normalizeAccountUsername(String(username).replace(/^@+/, ''));
          const peer = state.users.find(
            (item: AnyRecord) => normalizeAccountUsername(item.username) === safeUsername
          );
          targetId = peer?.id || '';
        }
        if (!targetId || !conversationIncludesUser(conversation, targetId)) {
          throw dmServiceError('Không tìm thấy thành viên cần kick', 404);
        }
        const targetRole = getMemberRole(conversation, targetId);
        if (!canKickMember(actorRole, targetRole, accountId, targetId)) {
          throw dmServiceError('Bạn không có quyền kick thành viên này', 403);
        }
        removeParticipantFromConversation(conversation, targetId);
        conversation.updatedAt = now().toISOString();
        logEvent('dm.group.kick', {
          conversationId,
          actor: me.username,
          targetId
        });
        return {
          conversation: serializeDmConversation(conversation, state, accountId, dmSecret),
          targetId
        };
      });
      await invalidateUnreadCounts([result.targetId]);
      return result.conversation;
    },

    async updateDmGroup(
      accountId: string,
      conversationId: string,
      { title }: AnyRecord = {}
    ) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const safeTitle = sanitizeGroupTitle(title);
      if (!safeTitle) {
        throw dmServiceError('Tên nhóm không hợp lệ');
      }
      return mutate(async (state) => {
        ensureDmCollections(state);
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          throw dmServiceError('Không tìm thấy cuộc trò chuyện', 404);
        }
        if (conversationKind(conversation) !== 'group') {
          throw dmServiceError('Chỉ nhóm mới có thể đổi tên');
        }
        if (!canManageGroupMembers(getMemberRole(conversation, accountId))) {
          throw dmServiceError('Bạn không có quyền đổi tên nhóm', 403);
        }
        conversation.title = safeTitle;
        conversation.updatedAt = now().toISOString();
        logEvent('dm.group.rename', { conversationId, title: safeTitle });
        return serializeDmConversation(conversation, state, accountId, dmSecret);
      });
    },

    async setDmGroupMemberRole(
      accountId: string,
      conversationId: string,
      { userId, username, role }: AnyRecord = {}
    ) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const nextRole = String(role || '').toLowerCase();
      if (nextRole !== 'admin' && nextRole !== 'member') {
        throw dmServiceError('Vai trò phải là admin hoặc member');
      }
      return mutate(async (state) => {
        ensureDmCollections(state);
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          throw dmServiceError('Không tìm thấy cuộc trò chuyện', 404);
        }
        if (conversationKind(conversation) !== 'group') {
          throw dmServiceError('Chỉ nhóm mới có phân quyền');
        }
        if (getMemberRole(conversation, accountId) !== 'owner') {
          throw dmServiceError('Chỉ chủ nhóm mới đổi vai trò', 403);
        }
        let targetId = String(userId || '').trim();
        if (!targetId && username) {
          const safeUsername = normalizeAccountUsername(String(username).replace(/^@+/, ''));
          const peer = state.users.find(
            (item: AnyRecord) => normalizeAccountUsername(item.username) === safeUsername
          );
          targetId = peer?.id || '';
        }
        if (!targetId || !conversationIncludesUser(conversation, targetId)) {
          throw dmServiceError('Không tìm thấy thành viên', 404);
        }
        if (targetId === accountId) {
          throw dmServiceError('Không thể đổi vai trò của chính chủ nhóm');
        }
        const ids = normalizeParticipantIds(conversation.participantIds);
        const roles = normalizeDmRoles(conversation.roles, ids, conversation.createdBy);
        roles[targetId] = nextRole as 'admin' | 'member';
        conversation.roles = roles;
        conversation.updatedAt = now().toISOString();
        logEvent('dm.group.role', {
          conversationId,
          targetId,
          role: nextRole
        });
        return serializeDmConversation(conversation, state, accountId, dmSecret);
      });
    },

    async editDmMessage(
      accountId: string,
      conversationId: string,
      messageId: string,
      { body }: AnyRecord = {}
    ) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const text = normalizeDmBody(body);
      if (!text) {
        throw dmServiceError('Nội dung tin nhắn không được để trống');
      }
      assertDmBodyMediaTokens(text);
      const editedAt = now().toISOString();
      const result = await mutate(async (state) => {
        ensureDmCollections(state);
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          throw dmServiceError('Không tìm thấy cuộc trò chuyện', 404);
        }
        const message = state.dmMessages.find(
          (item: AnyRecord) =>
            item.id === messageId && item.conversationId === conversationId
        );
        if (!message) {
          throw dmServiceError('Không tìm thấy tin nhắn', 404);
        }
        if (!canEditDmMessage(message, accountId, Date.parse(editedAt))) {
          throw dmServiceError(
            'Không thể sửa tin nhắn (chỉ người gửi, trong 30 phút, tin chưa xóa)',
            403
          );
        }
        const encrypted = encryptStoredBody(text, dmSecret);
        message.ciphertext = encrypted.ciphertext;
        message.iv = encrypted.iv;
        message.authTag = encrypted.authTag;
        message.editedAt = editedAt;
        if (conversation.lastMessageId === message.id) {
          conversation.lastCiphertext = message.ciphertext;
          conversation.lastIv = message.iv;
          conversation.lastAuthTag = message.authTag;
        }
        conversation.updatedAt = editedAt;
        unhideConversationForAll(conversation);
        logEvent('dm.message.edit', {
          conversationId,
          messageId,
          senderId: accountId
        });
        return {
          conversation: serializeDmConversation(conversation, state, accountId, dmSecret),
          message: serializeDmMessage(message, dmSecret, state, accountId),
          participantIds: normalizeParticipantIds(conversation.participantIds)
        };
      });
      publishRealtime('dm:message-updated', {
        conversationId,
        messageId: result.message.id,
        senderId: accountId,
        participantIds: result.participantIds,
        editedAt,
        deleted: false
      });
      return {
        conversation: result.conversation,
        message: result.message
      };
    },

    async deleteDmMessage(accountId: string, conversationId: string, messageId: string) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const deletedAt = now().toISOString();
      const result = await mutate(async (state) => {
        ensureDmCollections(state);
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          throw dmServiceError('Không tìm thấy cuộc trò chuyện', 404);
        }
        const message = state.dmMessages.find(
          (item: AnyRecord) =>
            item.id === messageId && item.conversationId === conversationId
        );
        if (!message) {
          throw dmServiceError('Không tìm thấy tin nhắn', 404);
        }
        if (!canDeleteDmMessage(message, conversation, accountId)) {
          throw dmServiceError('Bạn không có quyền xóa tin nhắn này', 403);
        }
        message.deletedAt = deletedAt;
        message.deletedBy = accountId;
        // Clear ciphertext so deleted content is not recoverable from disk snapshot.
        const redacted = encryptStoredBody('', dmSecret);
        message.ciphertext = redacted.ciphertext;
        message.iv = redacted.iv;
        message.authTag = redacted.authTag;
        recomputeConversationLastMessage(state, conversation);
        conversation.updatedAt = deletedAt;
        logEvent('dm.message.delete', {
          conversationId,
          messageId,
          actorId: accountId
        });
        return {
          conversation: serializeDmConversation(conversation, state, accountId, dmSecret),
          message: serializeDmMessage(message, dmSecret, state, accountId),
          participantIds: normalizeParticipantIds(conversation.participantIds)
        };
      });
      publishRealtime('dm:message-deleted', {
        conversationId,
        messageId: result.message.id,
        senderId: accountId,
        participantIds: result.participantIds,
        deletedAt
      });
      return {
        conversation: result.conversation,
        message: result.message
      };
    },

    /**
     * Hide conversation for the current user (default), or hard-delete a group
     * when the owner sets hard=true.
     */
    async deleteDmConversation(
      accountId: string,
      conversationId: string,
      { hard = false }: AnyRecord = {}
    ) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const result = await mutate(async (state) => {
        ensureDmCollections(state);
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          throw dmServiceError('Không tìm thấy cuộc trò chuyện', 404);
        }
        const kind = conversationKind(conversation);
        const wantHard = Boolean(hard);
        if (wantHard) {
          if (kind !== 'group') {
            throw dmServiceError('Chỉ chủ nhóm mới xóa hẳn nhóm (chat 1-1 chỉ ẩn cho bạn)');
          }
          if (getMemberRole(conversation, accountId) !== 'owner') {
            throw dmServiceError('Chỉ chủ nhóm mới xóa hẳn nhóm', 403);
          }
          const participantIds = normalizeParticipantIds(conversation.participantIds);
          state.dmConversations = state.dmConversations.filter(
            (item: AnyRecord) => item.id !== conversationId
          );
          state.dmMessages = state.dmMessages.filter(
            (item: AnyRecord) => item.conversationId !== conversationId
          );
          logEvent('dm.conversation.hard-delete', {
            conversationId,
            actorId: accountId,
            kind
          });
          return {
            deleted: true,
            hard: true,
            conversation: null,
            cacheUserIds: participantIds,
            realtimePayload: {
              conversationId,
              participantIds,
              hard: true
            }
          };
        }
        hideConversationForUser(conversation, accountId);
        conversation.updatedAt = now().toISOString();
        logEvent('dm.conversation.hide', {
          conversationId,
          actorId: accountId,
          kind
        });
        return {
          deleted: true,
          hard: false,
          conversation: null,
          cacheUserIds: [accountId],
          realtimePayload: null
        };
      });
      await invalidateUnreadCounts(result.cacheUserIds);
      if (result.realtimePayload) {
        publishRealtime('dm:conversation-deleted', result.realtimePayload);
      }
      return {
        deleted: result.deleted,
        hard: result.hard,
        conversation: result.conversation
      };
    },

    async setDmConversationMuted(
      accountId: string,
      conversationId: string,
      { muted = true }: AnyRecord = {}
    ) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      return mutate(async (state) => {
        ensureDmCollections(state);
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          throw dmServiceError('Không tìm thấy cuộc trò chuyện', 404);
        }
        setConversationMuted(conversation, accountId, Boolean(muted));
        conversation.updatedAt = now().toISOString();
        return serializeDmConversation(conversation, state, accountId, dmSecret);
      });
    },

    async setDmUserBlocked(
      accountId: string,
      { userId, username, blocked = true }: AnyRecord = {}
    ) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      return mutate(async (state) => {
        const me = state.users.find((item: AnyRecord) => item.id === accountId);
        if (!me || me.disabled) {
          throw dmServiceError('Phiên đăng nhập không còn hợp lệ', 401);
        }
        let targetId = String(userId || '').trim();
        if (!targetId && username) {
          const safeUsername = normalizeAccountUsername(String(username).replace(/^@+/, ''));
          const peer = state.users.find(
            (item: AnyRecord) => normalizeAccountUsername(item.username) === safeUsername
          );
          targetId = peer?.id || '';
        }
        if (!targetId || targetId === accountId) {
          throw dmServiceError('Không tìm thấy tài khoản cần chặn');
        }
        const target = state.users.find((item: AnyRecord) => item.id === targetId);
        if (!target) {
          throw dmServiceError('Không tìm thấy tài khoản cần chặn', 404);
        }
        const set = new Set(getUserDmBlockedIds(me));
        if (blocked) {
          set.add(targetId);
        } else {
          set.delete(targetId);
        }
        me.dmBlockedUserIds = [...set];
        me.updatedAt = now().toISOString();
        logEvent(blocked ? 'dm.block' : 'dm.unblock', {
          actorId: accountId,
          targetId
        });
        return {
          blocked: Boolean(blocked),
          userId: targetId,
          username: target.username,
          blockedUserIds: me.dmBlockedUserIds
        };
      });
    },

    async listDmBlockedUsers(accountId: string) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const state = await store.read();
      const me = state.users.find((item: AnyRecord) => item.id === accountId);
      if (!me) {
        throw dmServiceError('Phiên đăng nhập không còn hợp lệ', 401);
      }
      const ids = getUserDmBlockedIds(me);
      return {
        users: ids.map((id) => {
          const user = state.users.find((item: AnyRecord) => item.id === id);
          return user
            ? { id: user.id, username: user.username }
            : { id, username: 'đã-xóa' };
        })
      };
    },

    async reactDmMessage(
      accountId: string,
      conversationId: string,
      messageId: string,
      { reaction }: AnyRecord = {}
    ) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const reactionType = normalizeDmReaction(reaction);
      if (!reactionType) {
        throw dmServiceError('Biểu cảm không hợp lệ');
      }
      const result = await mutate(async (state) => {
        ensureDmCollections(state);
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === conversationId
        );
        if (!conversation || !conversationIncludesUser(conversation, accountId)) {
          throw dmServiceError('Không tìm thấy cuộc trò chuyện', 404);
        }
        const message = state.dmMessages.find(
          (item: AnyRecord) =>
            item.id === messageId && item.conversationId === conversationId
        );
        if (!message || message.deletedAt) {
          throw dmServiceError('Không tìm thấy tin nhắn', 404);
        }
        if (!message.reactionVoters || typeof message.reactionVoters !== 'object') {
          message.reactionVoters = {};
        }
        if (message.reactionVoters[accountId] === reactionType) {
          delete message.reactionVoters[accountId];
        } else {
          message.reactionVoters[accountId] = reactionType;
        }
        return {
          message: serializeDmMessage(message, dmSecret, state, accountId),
          participantIds: normalizeParticipantIds(conversation.participantIds)
        };
      });
      publishRealtime('dm:message-updated', {
        conversationId,
        messageId,
        participantIds: result.participantIds,
        reason: 'reaction'
      });
      return { message: result.message };
    },

    async signalDmTyping(accountId: string, conversationId: string) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      await enforceRealtimeUserRateLimit(accountId, 'dm:typing', {
        limit: readPositiveInteger(process.env.DM_TYPING_RATE_LIMIT, 30),
        windowMs: 10_000
      });
      const state = await store.read();
      ensureDmCollections(state);
      const me = state.users.find((item: AnyRecord) => item.id === accountId);
      const conversation = state.dmConversations.find(
        (item: AnyRecord) => item.id === conversationId
      );
      if (!me || !conversation || !conversationIncludesUser(conversation, accountId)) {
        throw dmServiceError('Không tìm thấy cuộc trò chuyện', 404);
      }
      const participantIds = normalizeParticipantIds(conversation.participantIds);
      publishRealtime('dm:typing', {
        conversationId,
        userId: accountId,
        username: me.username,
        participantIds,
        expiresAt: new Date(Date.now() + 4000).toISOString()
      });
      return { ok: true };
    },

    async searchDmMessages(accountId: string, { q = '', limit = 20 }: AnyRecord = {}) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      const query = String(q || '')
        .trim()
        .toLowerCase()
        .slice(0, 100);
      if (query.length < 2) {
        throw dmServiceError('Từ khóa tìm kiếm cần ít nhất 2 ký tự');
      }
      const state = await store.read();
      ensureDmCollections(state);
      const safeLimit = Math.max(1, Math.min(Number(limit) || 20, MAX_DM_SEARCH_RESULTS));
      const myConversationIds = new Set(
        state.dmConversations
          .filter(
            (conversation: AnyRecord) =>
              conversationIncludesUser(conversation, accountId) &&
              !conversationIsHiddenFor(conversation, accountId)
          )
          .map((conversation: AnyRecord) => conversation.id)
      );
      const hits: AnyRecord[] = [];
      const sorted = [...state.dmMessages].sort((left: AnyRecord, right: AnyRecord) =>
        String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
      );
      for (const message of sorted) {
        if (hits.length >= safeLimit) {
          break;
        }
        if (!myConversationIds.has(message.conversationId) || message.deletedAt) {
          continue;
        }
        const serialized = serializeDmMessage(message, dmSecret, state, accountId);
        const haystack = `${serialized.body} ${serialized.senderUsername}`.toLowerCase();
        if (!haystack.includes(query)) {
          continue;
        }
        const conversation = state.dmConversations.find(
          (item: AnyRecord) => item.id === message.conversationId
        );
        hits.push({
          message: serialized,
          conversation: conversation
            ? serializeDmConversation(conversation, state, accountId, dmSecret)
            : null
        });
      }
      return { results: hits, q: query };
    },

    async getLinkPreview({ url }: AnyRecord = {}) {
      return fetchLinkPreview(url);
    },

    async getDmLinkPreview(accountId: string, { url }: AnyRecord = {}) {
      if (!accountId) {
        throw dmServiceError('Vui lòng đăng nhập tài khoản', 401);
      }
      try {
        return await fetchLinkPreview(url);
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 400);
        throw dmServiceError(String((error as Error)?.message || 'URL không hợp lệ'), statusCode);
      }
    }
  };
}
