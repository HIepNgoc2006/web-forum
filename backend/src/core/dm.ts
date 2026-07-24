import crypto from 'node:crypto';

import { decryptDmBody, encryptDmBody, type EncryptedDmPayload } from './dm-crypto.ts';
import { extractLinks } from './link-preview.ts';

export const MAX_DM_BODY_LENGTH = 4_000;
export const MAX_DM_MESSAGES_PER_CONVERSATION = 200;
export const MAX_DM_CONVERSATIONS_PER_USER = 100;
export const MAX_DM_MESSAGE_PAGE = 50;
export const MAX_DM_GROUP_PARTICIPANTS = 50;
export const MAX_DM_GROUP_TITLE_LENGTH = 80;
export const MAX_DM_GROUP_INVITE_BATCH = 20;
/** Own messages can be edited within this window (30 minutes). */
export const MAX_DM_EDIT_WINDOW_MS = 30 * 60 * 1000;
export const MAX_DM_MEDIA_PER_MESSAGE = 1;
export const MAX_DM_LINKS_PER_MESSAGE = 3;
export const MAX_DM_SEARCH_RESULTS = 40;
export const DM_REACTION_TYPES = new Set(['like', 'laugh', 'surprise', 'sad', 'agree', 'thanks']);
export const DM_TYPING_TTL_MS = 4_000;

export type AnyRecord = Record<string, any>;
export type DmConversationKind = 'direct' | 'group';
export type DmMemberRole = 'owner' | 'admin' | 'member';

export function participantKeyFor(userIdA: string, userIdB: string): string {
  return [String(userIdA), String(userIdB)].sort().join(':');
}

export function conversationKind(conversation: AnyRecord | null | undefined): DmConversationKind {
  if (!conversation) {
    return 'direct';
  }
  if (conversation.kind === 'group') {
    return 'group';
  }
  if (String(conversation.participantKey || '').startsWith('group:')) {
    return 'group';
  }
  return 'direct';
}

export function sanitizeGroupTitle(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DM_GROUP_TITLE_LENGTH);
}

export function normalizeDmRoles(
  roles: unknown,
  participantIds: string[],
  createdBy = ''
): Record<string, DmMemberRole> {
  const ids = normalizeParticipantIds(participantIds);
  const source =
    roles && typeof roles === 'object' && !Array.isArray(roles)
      ? (roles as Record<string, unknown>)
      : {};
  const result: Record<string, DmMemberRole> = {};
  let ownerId = '';
  for (const id of ids) {
    const raw = String(source[id] || '').toLowerCase();
    if (raw === 'owner' && !ownerId) {
      result[id] = 'owner';
      ownerId = id;
    } else if (raw === 'admin') {
      result[id] = 'admin';
    } else {
      result[id] = 'member';
    }
  }
  if (!ownerId) {
    const fallback = ids.includes(String(createdBy)) ? String(createdBy) : ids[0];
    if (fallback) {
      result[fallback] = 'owner';
      ownerId = fallback;
    }
  }
  for (const id of ids) {
    if (id !== ownerId && result[id] === 'owner') {
      result[id] = 'member';
    }
  }
  return result;
}

export function getMemberRole(conversation: AnyRecord, userId: string): DmMemberRole | '' {
  const id = String(userId || '');
  if (!id || !conversationIncludesUser(conversation, id)) {
    return '';
  }
  const roles = normalizeDmRoles(
    conversation.roles,
    conversation.participantIds,
    conversation.createdBy
  );
  return roles[id] || 'member';
}

export function canManageGroupMembers(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

export function canKickMember(
  actorRole: string,
  targetRole: string,
  actorId: string,
  targetId: string
): boolean {
  if (!actorId || !targetId || actorId === targetId) {
    return false;
  }
  if (targetRole === 'owner') {
    return false;
  }
  if (actorRole === 'owner') {
    return true;
  }
  if (actorRole === 'admin' && targetRole === 'member') {
    return true;
  }
  return false;
}

export function dmServiceError(message: string, statusCode = 400): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

export function normalizeParticipantIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    return [];
  }
  const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  unique.sort();
  return unique;
}

export function conversationIncludesUser(conversation: AnyRecord, userId: string): boolean {
  return normalizeParticipantIds(conversation?.participantIds).includes(String(userId));
}

export function normalizeDmBody(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_DM_BODY_LENGTH);
}

const STICKER_TOKEN_RE = /\[sticker:([a-z0-9-]+)\]/gi;
const GIF_TOKEN_RE = /\[gif:klipy:([^\]]+)\]/gi;
const KLIPY_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,120}$/i;

/** Human-readable list preview for DM bodies that may contain media tokens. */
export function dmPreviewFromBody(body: string, maxChars = 140): string {
  const text = String(body || '').trim();
  if (!text) {
    return '';
  }
  const stickerMatches = [...text.matchAll(STICKER_TOKEN_RE)];
  const gifMatches = [...text.matchAll(GIF_TOKEN_RE)];
  const withoutMedia = text
    .replace(STICKER_TOKEN_RE, ' ')
    .replace(GIF_TOKEN_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!withoutMedia) {
    if (stickerMatches.length && !gifMatches.length) {
      return stickerMatches.length === 1 ? 'Sticker' : `${stickerMatches.length} sticker`;
    }
    if (gifMatches.length && !stickerMatches.length) {
      return gifMatches.length === 1 ? 'GIF' : `${gifMatches.length} GIF`;
    }
    if (stickerMatches.length || gifMatches.length) {
      const parts: string[] = [];
      if (stickerMatches.length) {
        parts.push(stickerMatches.length === 1 ? 'Sticker' : `${stickerMatches.length} sticker`);
      }
      if (gifMatches.length) {
        parts.push(gifMatches.length === 1 ? 'GIF' : `${gifMatches.length} GIF`);
      }
      return parts.join(' · ').slice(0, maxChars);
    }
    return '';
  }

  const withPlaceholders = text
    .replace(STICKER_TOKEN_RE, '[Sticker]')
    .replace(GIF_TOKEN_RE, '[GIF]')
    .replace(/\s+/g, ' ')
    .trim();
  return withPlaceholders.slice(0, maxChars);
}

/**
 * Light validation: reject clearly malformed GIF tokens. Stickers stay soft-fail
 * at render time so custom/unknown keys do not block send.
 */
export function assertDmBodyMediaTokens(body: string): void {
  const text = String(body || '');
  for (const match of text.matchAll(GIF_TOKEN_RE)) {
    const slug = String(match[1] || '').trim();
    if (!slug || !KLIPY_SLUG_RE.test(slug)) {
      const error = new Error('Mã GIF không hợp lệ');
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }
  }
}

export function ensureDmCollections(state: AnyRecord): void {
  if (!Array.isArray(state.dmConversations)) {
    state.dmConversations = [];
  }
  if (!Array.isArray(state.dmMessages)) {
    state.dmMessages = [];
  }
}

export function encryptStoredBody(body: string, secret?: string): EncryptedDmPayload {
  return encryptDmBody(body, secret);
}

export function decryptStoredBody(record: EncryptedDmPayload, secret?: string): string {
  try {
    return decryptDmBody(record, secret);
  } catch {
    return '[không giải mã được]';
  }
}

export function publicUserSummary(user: AnyRecord = {}): { id: string; username: string; role: string } {
  return {
    id: String(user.id || ''),
    username: String(user.username || ''),
    role: String(user.role || 'user')
  };
}

export function serializeDmMessage(
  message: AnyRecord,
  secret?: string,
  state?: AnyRecord,
  viewerId?: string
): AnyRecord {
  let senderUsername = '';
  if (state && Array.isArray(state.users)) {
    const sender = state.users.find((item: AnyRecord) => item.id === message.senderId);
    senderUsername = String(sender?.username || '');
  }
  const deleted = Boolean(message.deletedAt);
  const body = deleted
    ? ''
    : decryptStoredBody(
        {
          ciphertext: String(message.ciphertext || ''),
          iv: String(message.iv || ''),
          authTag: String(message.authTag || '')
        },
        secret
      );
  const images = deleted
    ? []
    : (Array.isArray(message.images) ? message.images : []).map(publicDmImage).filter(Boolean);
  const links = deleted
    ? []
    : Array.isArray(message.links) && message.links.length
      ? message.links
      : extractDmLinks(body);
  const reactionVoters =
    message.reactionVoters && typeof message.reactionVoters === 'object'
      ? message.reactionVoters
      : {};
  const reactions = Object.fromEntries([...DM_REACTION_TYPES].map((type) => [type, 0]));
  let myReaction: string | null = null;
  for (const [voterId, type] of Object.entries(reactionVoters)) {
    const reactionType = String(type || '');
    if (!DM_REACTION_TYPES.has(reactionType)) {
      continue;
    }
    reactions[reactionType] += 1;
    if (viewerId && String(voterId) === String(viewerId)) {
      myReaction = reactionType;
    }
  }
  let replyTo: AnyRecord | null = null;
  if (!deleted && message.replyToId && state && Array.isArray(state.dmMessages)) {
    const parent = state.dmMessages.find((item: AnyRecord) => item.id === message.replyToId);
    if (parent) {
      const parentDeleted = Boolean(parent.deletedAt);
      const parentBody = parentDeleted
        ? ''
        : decryptStoredBody(
            {
              ciphertext: String(parent.ciphertext || ''),
              iv: String(parent.iv || ''),
              authTag: String(parent.authTag || '')
            },
            secret
          );
      const parentSender = Array.isArray(state.users)
        ? state.users.find((item: AnyRecord) => item.id === parent.senderId)
        : null;
      replyTo = {
        id: parent.id,
        senderId: parent.senderId,
        senderUsername: String(parentSender?.username || ''),
        body: parentDeleted ? '' : parentBody.slice(0, 200),
        deleted: parentDeleted
      };
    }
  }
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderUsername,
    body,
    images,
    links,
    replyToId: message.replyToId || null,
    replyTo,
    reactions,
    myReaction,
    createdAt: message.createdAt,
    editedAt: message.editedAt || null,
    deleted,
    deletedAt: message.deletedAt || null,
    deletedBy: message.deletedBy || null,
    readBy: Array.isArray(message.readBy) ? message.readBy.map(String) : []
  };
}

function publicDmImage(image: AnyRecord): AnyRecord | null {
  if (!image || typeof image !== 'object') {
    return null;
  }
  const url = String(image.url || '');
  if (!url && !image.storageKey) {
    return null;
  }
  const safe: AnyRecord = {
    name: String(image.name || 'file'),
    type: String(image.type || 'image/jpeg'),
    url: url || '',
    storageKey: image.storageKey || undefined,
    sizeBytes: Number(image.sizeBytes) || undefined,
    width: Number(image.width) || undefined,
    height: Number(image.height) || undefined,
    spoiler: Boolean(image.spoiler)
  };
  if (image.thumbnail && typeof image.thumbnail === 'object') {
    safe.thumbnail = {
      url: String(image.thumbnail.url || ''),
      width: Number(image.thumbnail.width) || undefined,
      height: Number(image.thumbnail.height) || undefined
    };
  }
  return safe;
}

export function extractDmLinks(body: string, max = MAX_DM_LINKS_PER_MESSAGE): AnyRecord[] {
  return extractLinks(body, max);
}

export function conversationIsMutedFor(
  conversation: AnyRecord,
  userId: string
): boolean {
  return (
    Array.isArray(conversation?.mutedBy) &&
    conversation.mutedBy.map(String).includes(String(userId))
  );
}

export function setConversationMuted(
  conversation: AnyRecord,
  userId: string,
  muted: boolean
): void {
  if (!Array.isArray(conversation.mutedBy)) {
    conversation.mutedBy = [];
  }
  const id = String(userId);
  const set = new Set(conversation.mutedBy.map(String));
  if (muted) {
    set.add(id);
  } else {
    set.delete(id);
  }
  conversation.mutedBy = [...set];
}

export function getUserDmBlockedIds(user: AnyRecord | null | undefined): string[] {
  if (!user || !Array.isArray(user.dmBlockedUserIds)) {
    return [];
  }
  return [...new Set(user.dmBlockedUserIds.map(String).filter(Boolean))];
}

export function isDmBlockedBetween(
  state: AnyRecord,
  userIdA: string,
  userIdB: string
): boolean {
  const a = (state.users || []).find((item: AnyRecord) => item.id === userIdA);
  const b = (state.users || []).find((item: AnyRecord) => item.id === userIdB);
  const blockedA = getUserDmBlockedIds(a);
  const blockedB = getUserDmBlockedIds(b);
  return blockedA.includes(String(userIdB)) || blockedB.includes(String(userIdA));
}

export function normalizeDmReaction(value: unknown): string {
  const type = String(value || '').toLowerCase().trim();
  return DM_REACTION_TYPES.has(type) ? type : '';
}

export function conversationIsHiddenFor(
  conversation: AnyRecord,
  userId: string
): boolean {
  return (
    Array.isArray(conversation?.hiddenBy) &&
    conversation.hiddenBy.map(String).includes(String(userId))
  );
}

export function hideConversationForUser(conversation: AnyRecord, userId: string): void {
  if (!Array.isArray(conversation.hiddenBy)) {
    conversation.hiddenBy = [];
  }
  const id = String(userId);
  if (!conversation.hiddenBy.map(String).includes(id)) {
    conversation.hiddenBy.push(id);
  }
}

export function unhideConversationForUser(conversation: AnyRecord, userId: string): void {
  if (!Array.isArray(conversation.hiddenBy)) {
    return;
  }
  conversation.hiddenBy = conversation.hiddenBy
    .map(String)
    .filter((id) => id !== String(userId));
}

export function unhideConversationForAll(conversation: AnyRecord): void {
  conversation.hiddenBy = [];
}

export function recomputeConversationLastMessage(
  state: AnyRecord,
  conversation: AnyRecord
): void {
  const messages = (state.dmMessages || [])
    .filter(
      (item: AnyRecord) =>
        item.conversationId === conversation.id && !item.deletedAt
    )
    .sort((left: AnyRecord, right: AnyRecord) =>
      left.createdAt.localeCompare(right.createdAt)
    );
  const last = messages[messages.length - 1];
  if (!last) {
    conversation.lastMessageAt = null;
    conversation.lastMessageId = null;
    conversation.lastCiphertext = null;
    conversation.lastIv = null;
    conversation.lastAuthTag = null;
    return;
  }
  conversation.lastMessageAt = last.createdAt;
  conversation.lastMessageId = last.id;
  conversation.lastCiphertext = last.ciphertext;
  conversation.lastIv = last.iv;
  conversation.lastAuthTag = last.authTag;
}

export function canEditDmMessage(
  message: AnyRecord,
  accountId: string,
  nowMs: number
): boolean {
  if (!message || message.deletedAt) {
    return false;
  }
  if (String(message.senderId) !== String(accountId)) {
    return false;
  }
  const createdMs = Date.parse(String(message.createdAt || ''));
  if (!Number.isFinite(createdMs)) {
    return false;
  }
  return nowMs - createdMs <= MAX_DM_EDIT_WINDOW_MS;
}

export function canDeleteDmMessage(
  message: AnyRecord,
  conversation: AnyRecord,
  accountId: string
): boolean {
  if (!message || message.deletedAt) {
    return false;
  }
  if (String(message.senderId) === String(accountId)) {
    return true;
  }
  if (conversationKind(conversation) !== 'group') {
    return false;
  }
  return canManageGroupMembers(getMemberRole(conversation, accountId));
}

export function serializeDmConversation(
  conversation: AnyRecord,
  state: AnyRecord,
  viewerId: string,
  secret?: string
): AnyRecord {
  const kind = conversationKind(conversation);
  const participantIds = normalizeParticipantIds(conversation.participantIds);
  const roles = normalizeDmRoles(conversation.roles, participantIds, conversation.createdBy);
  const participants = participantIds.map((id) => {
    const user = (state.users || []).find((item: AnyRecord) => item.id === id);
    const summary = user
      ? publicUserSummary(user)
      : { id, username: 'đã-xóa', role: 'user' };
    return {
      ...summary,
      memberRole: roles[id] || 'member'
    };
  });
  const peer =
    kind === 'direct'
      ? participants.find((item) => item.id !== viewerId) || participants[0] || null
      : null;
  let lastMessagePreview = '';
  if (conversation.lastCiphertext && conversation.lastIv && conversation.lastAuthTag) {
    lastMessagePreview = dmPreviewFromBody(
      decryptStoredBody(
        {
          ciphertext: conversation.lastCiphertext,
          iv: conversation.lastIv,
          authTag: conversation.lastAuthTag
        },
        secret
      ),
      140
    );
  }
  const unreadBy = conversation.unreadBy && typeof conversation.unreadBy === 'object'
    ? conversation.unreadBy
    : {};
  const title =
    kind === 'group'
      ? sanitizeGroupTitle(conversation.title) || 'Nhóm chat'
      : '';
  const ownerId = Object.keys(roles).find((id) => roles[id] === 'owner') || '';
  return {
    id: conversation.id,
    kind,
    title,
    createdBy: String(conversation.createdBy || ownerId || ''),
    participantIds,
    participants,
    participantCount: participantIds.length,
    myRole: roles[viewerId] || (conversationIncludesUser(conversation, viewerId) ? 'member' : ''),
    peer,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt || conversation.updatedAt,
    lastMessageId: conversation.lastMessageId || null,
    lastMessagePreview,
    unreadCount: Math.max(0, Number(unreadBy[viewerId] || 0)),
    muted: conversationIsMutedFor(conversation, viewerId)
  };
}

export function createDmConversationRecord(participantIds: string[], createdAt: string): AnyRecord {
  const ids = normalizeParticipantIds(participantIds);
  return {
    id: crypto.randomUUID(),
    kind: 'direct',
    participantKey: ids.join(':'),
    participantIds: ids,
    roles: Object.fromEntries(ids.map((id) => [id, 'member'])),
    createdBy: ids[0] || '',
    createdAt,
    updatedAt: createdAt,
    lastMessageAt: null,
    lastMessageId: null,
    lastCiphertext: null,
    lastIv: null,
    lastAuthTag: null,
    unreadBy: Object.fromEntries(ids.map((id) => [id, 0]))
  };
}

export function createGroupConversationRecord({
  title,
  createdBy,
  participantIds,
  createdAt
}: {
  title: string;
  createdBy: string;
  participantIds: string[];
  createdAt: string;
}): AnyRecord {
  const ids = normalizeParticipantIds(participantIds);
  if (!ids.includes(String(createdBy))) {
    ids.push(String(createdBy));
    ids.sort();
  }
  const id = crypto.randomUUID();
  const roles = normalizeDmRoles({}, ids, createdBy);
  return {
    id,
    kind: 'group',
    title: sanitizeGroupTitle(title) || 'Nhóm chat',
    participantKey: `group:${id}`,
    participantIds: ids,
    roles,
    createdBy: String(createdBy),
    createdAt,
    updatedAt: createdAt,
    lastMessageAt: null,
    lastMessageId: null,
    lastCiphertext: null,
    lastIv: null,
    lastAuthTag: null,
    unreadBy: Object.fromEntries(ids.map((pid) => [pid, 0]))
  };
}

export function removeParticipantFromConversation(
  conversation: AnyRecord,
  userId: string
): { emptied: boolean } {
  const leavingId = String(userId);
  const ids = normalizeParticipantIds(conversation.participantIds).filter((id) => id !== leavingId);
  if (ids.length === 0) {
    conversation.participantIds = [];
    conversation.roles = {};
    conversation.unreadBy = {};
    return { emptied: true };
  }
  const wasOwner = getMemberRole(conversation, leavingId) === 'owner';
  conversation.participantIds = ids;
  const roles = normalizeDmRoles(conversation.roles, ids, conversation.createdBy);
  delete roles[leavingId];
  if (wasOwner || !ids.some((id) => roles[id] === 'owner')) {
    const nextOwner =
      ids.find((id) => roles[id] === 'admin') ||
      ids[0];
    if (nextOwner) {
      for (const id of ids) {
        if (roles[id] === 'owner' && id !== nextOwner) {
          roles[id] = 'member';
        }
      }
      roles[nextOwner] = 'owner';
      conversation.createdBy = nextOwner;
    }
  }
  conversation.roles = roles;
  if (conversation.unreadBy && typeof conversation.unreadBy === 'object') {
    delete conversation.unreadBy[leavingId];
  }
  return { emptied: false };
}

export function createDmMessageRecord({
  conversationId,
  senderId,
  body,
  createdAt,
  secret,
  images = [],
  replyToId = null,
  links = []
}: {
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  secret?: string;
  images?: AnyRecord[];
  replyToId?: string | null;
  links?: AnyRecord[];
}): AnyRecord {
  const encrypted = encryptStoredBody(body, secret);
  return {
    id: crypto.randomUUID(),
    conversationId,
    senderId,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    images: Array.isArray(images) ? images : [],
    links: Array.isArray(links) ? links : extractDmLinks(body),
    replyToId: replyToId || null,
    reactionVoters: {},
    createdAt,
    readBy: [senderId]
  };
}

export function trimConversationMessages(state: AnyRecord, conversationId: string): void {
  const messages = (state.dmMessages || [])
    .filter((item: AnyRecord) => item.conversationId === conversationId)
    .sort((left: AnyRecord, right: AnyRecord) => left.createdAt.localeCompare(right.createdAt));
  if (messages.length <= MAX_DM_MESSAGES_PER_CONVERSATION) {
    return;
  }
  const dropIds = new Set(
    messages.slice(0, messages.length - MAX_DM_MESSAGES_PER_CONVERSATION).map((item: AnyRecord) => item.id)
  );
  state.dmMessages = state.dmMessages.filter((item: AnyRecord) => !dropIds.has(item.id));
}

export function countUnreadForUser(state: AnyRecord, userId: string): number {
  ensureDmCollections(state);
  let total = 0;
  for (const conversation of state.dmConversations) {
    if (!conversationIncludesUser(conversation, userId)) {
      continue;
    }
    if (conversationIsHiddenFor(conversation, userId)) {
      continue;
    }
    total += Math.max(0, Number(conversation.unreadBy?.[userId] || 0));
  }
  return total;
}
