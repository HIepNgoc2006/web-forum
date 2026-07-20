import crypto from 'node:crypto';

import { decryptDmBody, encryptDmBody, type EncryptedDmPayload } from './dm-crypto.ts';

export const MAX_DM_BODY_LENGTH = 4_000;
export const MAX_DM_MESSAGES_PER_CONVERSATION = 200;
export const MAX_DM_CONVERSATIONS_PER_USER = 100;
export const MAX_DM_MESSAGE_PAGE = 50;

export type AnyRecord = Record<string, any>;

export function participantKeyFor(userIdA: string, userIdB: string): string {
  return [String(userIdA), String(userIdB)].sort().join(':');
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

export function serializeDmMessage(message: AnyRecord, secret?: string): AnyRecord {
  const body = decryptStoredBody(
    {
      ciphertext: String(message.ciphertext || ''),
      iv: String(message.iv || ''),
      authTag: String(message.authTag || '')
    },
    secret
  );
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body,
    createdAt: message.createdAt,
    readBy: Array.isArray(message.readBy) ? message.readBy.map(String) : []
  };
}

export function serializeDmConversation(
  conversation: AnyRecord,
  state: AnyRecord,
  viewerId: string,
  secret?: string
): AnyRecord {
  const participantIds = normalizeParticipantIds(conversation.participantIds);
  const participants = participantIds.map((id) => {
    const user = (state.users || []).find((item: AnyRecord) => item.id === id);
    return user
      ? publicUserSummary(user)
      : { id, username: 'đã-xóa', role: 'user' };
  });
  const peer = participants.find((item) => item.id !== viewerId) || participants[0] || null;
  let lastMessagePreview = '';
  if (conversation.lastCiphertext && conversation.lastIv && conversation.lastAuthTag) {
    lastMessagePreview = decryptStoredBody(
      {
        ciphertext: conversation.lastCiphertext,
        iv: conversation.lastIv,
        authTag: conversation.lastAuthTag
      },
      secret
    ).slice(0, 140);
  }
  const unreadBy = conversation.unreadBy && typeof conversation.unreadBy === 'object'
    ? conversation.unreadBy
    : {};
  return {
    id: conversation.id,
    participantIds,
    participants,
    peer,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt || conversation.updatedAt,
    lastMessageId: conversation.lastMessageId || null,
    lastMessagePreview,
    unreadCount: Math.max(0, Number(unreadBy[viewerId] || 0))
  };
}

export function createDmConversationRecord(participantIds: string[], createdAt: string): AnyRecord {
  const ids = normalizeParticipantIds(participantIds);
  return {
    id: crypto.randomUUID(),
    participantKey: ids.join(':'),
    participantIds: ids,
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

export function createDmMessageRecord({
  conversationId,
  senderId,
  body,
  createdAt,
  secret
}: {
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  secret?: string;
}): AnyRecord {
  const encrypted = encryptStoredBody(body, secret);
  return {
    id: crypto.randomUUID(),
    conversationId,
    senderId,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
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
    total += Math.max(0, Number(conversation.unreadBy?.[userId] || 0));
  }
  return total;
}
