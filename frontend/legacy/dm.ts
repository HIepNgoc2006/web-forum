import { fileToDataUrl, isSupportedMediaFile } from './composer';
import { els } from './dom';
import { dmPreviewFromBody, escapeHtml, formatDmMessageHtml } from './format';
import { closeComposerMediaPicker, requestComposerMediaHydration } from './composer-media-picker';
import {
  bindDmClickDelegation,
  isDmAccountSessionCurrent,
  syncDmAuthenticationDom
} from './dm-dom';
import {
  createTrailingAsyncCoalescer,
  isOwnDmMessageEvent,
  shouldLoadDmConversationsForRealtime
} from './dm-realtime';
import { emitRealtime } from './realtime';
import { state } from './state';

import type { AnyRecord } from './types';

const DM_REACTIONS = [
  { type: 'like', icon: '👍', label: 'Thích' },
  { type: 'laugh', icon: '😂', label: 'Cười' },
  { type: 'surprise', icon: '😮', label: 'Ngạc nhiên' },
  { type: 'sad', icon: '😢', label: 'Buồn' },
  { type: 'agree', icon: '🤝', label: 'Đồng ý' },
  { type: 'thanks', icon: '🙏', label: 'Cảm ơn' }
] as const;

const TYPING_SEND_MS = 2500;
const TYPING_SHOW_MS = 4000;

function setFormError(node: HTMLElement | null | undefined, message = '') {
  if (!node) {
    return;
  }
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}

function formatDmTime(value = '') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });
}

function truncateText(value = '', max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function createDmController(dependencies: AnyRecord) {
  const {
    api,
    showToast,
    setButtonLoading,
    setScreen,
    browserNotificationIds = new Set()
  } = dependencies;

  let activeConversationId = '';
  let activeConversation: AnyRecord | null = null;
  let conversations: AnyRecord[] = [];
  let messages: AnyRecord[] = [];
  let unreadCount = 0;
  let loadRequestId = 0;
  let hasMoreMessages = false;
  let loadingOlder = false;
  let replyToMessage: AnyRecord | null = null;
  let pendingImage: AnyRecord | null = null;
  let editingMessageId = '';
  let lastTypingSentAt = 0;
  const typingUsers = new Map<string, { username: string; expiresAt: number }>();
  let typingUiTimer: number | null = null;
  const linkPreviewCache = new Map<string, AnyRecord | null>();
  const readAcknowledgements = new Map<string, Promise<void>>();

  function isLoggedIn() {
    return Boolean(state.accountToken && state.account?.id);
  }

  function isGroupConversation(conversation: AnyRecord | null | undefined) {
    return String(conversation?.kind || '') === 'group';
  }

  function conversationDisplayName(conversation: AnyRecord | null | undefined) {
    if (!conversation) {
      return 'Chat';
    }
    if (isGroupConversation(conversation)) {
      return String(conversation.title || 'Nhóm chat');
    }
    return `@${conversation.peer?.username || 'user'}`;
  }

  function parseUsernameList(raw: string): string[] {
    return [
      ...new Set(
        String(raw || '')
          .split(/[\s,;]+/)
          .map((part) => part.trim().replace(/^@+/, '').toLowerCase())
          .filter(Boolean)
      )
    ];
  }

  function updateUnreadUi(count = unreadCount) {
    unreadCount = Math.max(0, Number(count) || 0);
    const label = unreadCount > 99 ? '99+' : String(unreadCount);
    if (els.dmNavBadge) {
      els.dmNavBadge.textContent = label;
      els.dmNavBadge.classList.toggle('hidden', unreadCount <= 0);
    }
    if (els.dmUnreadBadge) {
      els.dmUnreadBadge.textContent = unreadCount > 0 ? `${label} chưa đọc` : '0';
      els.dmUnreadBadge.classList.toggle('hidden', unreadCount <= 0);
    }
    if (els.dmNavLink) {
      els.dmNavLink.setAttribute(
        'aria-label',
        unreadCount > 0 ? `Tin nhắn, ${unreadCount} chưa đọc` : 'Tin nhắn'
      );
    }
  }

  function updateDmNavVisibility() {
    const loggedIn = isLoggedIn();
    if (els.dmNavLink) {
      els.dmNavLink.classList.toggle('hidden', !loggedIn);
    }
    if (loggedIn) {
      syncDmAuthenticationDom(els, true);
      return;
    }
    loadRequestId += 1;
    updateUnreadUi(0);
    activeConversationId = '';
    activeConversation = null;
    conversations = [];
    messages = [];
    hasMoreMessages = false;
    loadingOlder = false;
    editingMessageId = '';
    lastTypingSentAt = 0;
    linkPreviewCache.clear();
    readAcknowledgements.clear();
    clearReplyTarget();
    clearPendingImage();
    clearTypingUsers();
    showThread(null);
    syncDmAuthenticationDom(els, false);
  }

  function updateLoadOlderButton() {
    if (!els.dmLoadOlder) {
      return;
    }
    const show = Boolean(activeConversationId && hasMoreMessages);
    els.dmLoadOlder.classList.toggle('hidden', !show);
    els.dmLoadOlder.disabled = loadingOlder;
    els.dmLoadOlder.textContent = loadingOlder ? 'Đang tải...' : 'Tải tin nhắn cũ hơn';
  }

  function clearReplyTarget() {
    replyToMessage = null;
    if (els.dmReplyBanner) {
      els.dmReplyBanner.classList.add('hidden');
    }
    if (els.dmReplyPreview) {
      els.dmReplyPreview.textContent = '';
    }
  }

  function setReplyTarget(message: AnyRecord | null) {
    if (!message?.id || message.deleted) {
      clearReplyTarget();
      return;
    }
    replyToMessage = message;
    const who = message.senderUsername
      ? `@${message.senderUsername}`
      : String(message.senderId) === String(state.account?.id)
        ? 'Bạn'
        : 'Tin nhắn';
    const preview = truncateText(dmPreviewFromBody(message.body || '', 100) || '[nội dung]', 100);
    if (els.dmReplyPreview) {
      els.dmReplyPreview.textContent = `${who}: ${preview}`;
    }
    els.dmReplyBanner?.classList.remove('hidden');
    els.dmMessageBody?.focus();
  }

  function clearPendingImage() {
    pendingImage = null;
    if (els.dmImageInput) {
      els.dmImageInput.value = '';
    }
    if (els.dmAttachPreview) {
      els.dmAttachPreview.classList.add('hidden');
      els.dmAttachPreview.innerHTML = '';
    }
  }

  function renderAttachPreview() {
    if (!els.dmAttachPreview) {
      return;
    }
    if (!isDmAccountSessionCurrent(state, state.accountToken)) {
      clearPendingImage();
      return;
    }
    if (!pendingImage?.dataUrl) {
      els.dmAttachPreview.classList.add('hidden');
      els.dmAttachPreview.innerHTML = '';
      return;
    }
    els.dmAttachPreview.classList.remove('hidden');
    els.dmAttachPreview.innerHTML = `
      <div class="dm-attach-preview-inner">
        <img src="${escapeHtml(pendingImage.dataUrl)}" alt="${escapeHtml(pendingImage.name || 'ảnh')}" />
        <button type="button" class="link-button" data-dm-clear-attach>[Bỏ ảnh]</button>
      </div>
    `;
  }

  function clearTypingUsers() {
    typingUsers.clear();
    if (typingUiTimer != null) {
      window.clearInterval(typingUiTimer);
      typingUiTimer = null;
    }
    if (els.dmTypingStatus) {
      els.dmTypingStatus.classList.add('hidden');
      els.dmTypingStatus.textContent = '';
    }
  }

  function renderTypingStatus() {
    if (!els.dmTypingStatus) {
      return;
    }
    const now = Date.now();
    for (const [userId, info] of [...typingUsers.entries()]) {
      if (info.expiresAt <= now || userId === String(state.account?.id || '')) {
        typingUsers.delete(userId);
      }
    }
    if (!typingUsers.size) {
      els.dmTypingStatus.classList.add('hidden');
      els.dmTypingStatus.textContent = '';
      return;
    }
    const names = [...typingUsers.values()].map((item) => `@${item.username || 'user'}`);
    els.dmTypingStatus.classList.remove('hidden');
    els.dmTypingStatus.textContent =
      names.length === 1 ? `${names[0]} đang gõ...` : `${names.join(', ')} đang gõ...`;
  }

  function noteTypingEvent(payload: AnyRecord = {}) {
    const conversationId = String(payload.conversationId || '');
    if (!conversationId || conversationId !== activeConversationId) {
      return;
    }
    const userId = String(payload.userId || '');
    if (!userId || userId === String(state.account?.id || '')) {
      return;
    }
    const expiresAt = payload.expiresAt
      ? Date.parse(String(payload.expiresAt))
      : Date.now() + TYPING_SHOW_MS;
    typingUsers.set(userId, {
      username: String(payload.username || 'user'),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + TYPING_SHOW_MS
    });
    renderTypingStatus();
    if (typingUiTimer == null) {
      typingUiTimer = window.setInterval(renderTypingStatus, 800);
    }
  }

  async function signalTyping() {
    if (!activeConversationId || !isLoggedIn()) {
      return;
    }
    const now = Date.now();
    if (now - lastTypingSentAt < TYPING_SEND_MS) {
      return;
    }
    lastTypingSentAt = now;
    try {
      await emitRealtime(
        'dm:typing',
        { conversationId: activeConversationId },
        { timeoutMs: 2_000 }
      );
      return;
    } catch {
      // Fall back to REST while a Socket.IO reconnect is in progress.
    }
    try {
      await api(`/api/dm/conversations/${encodeURIComponent(activeConversationId)}/typing`, {
        auth: 'account',
        method: 'POST',
        body: '{}'
      });
    } catch {
      // typing is best-effort
    }
  }

  function reactionBarHtml(message: AnyRecord) {
    if (message.deleted) {
      return '';
    }
    const reactions = message.reactions && typeof message.reactions === 'object' ? message.reactions : {};
    const myReaction = message.myReaction ? String(message.myReaction) : '';
    return `<div class="dm-message-reactions" aria-label="Biểu cảm">
      ${DM_REACTIONS.map((item) => {
        const count = Math.max(0, Number(reactions[item.type]) || 0);
        const active = myReaction === item.type ? ' active' : '';
        return `<button type="button" class="reaction-button dm-reaction-button${active}" data-dm-react="${escapeHtml(message.id)}" data-reaction="${item.type}" title="${escapeHtml(item.label)}" aria-label="${escapeHtml(item.label)}">
          <span aria-hidden="true">${item.icon}</span>${count ? `<span class="reaction-count">${count}</span>` : ''}
        </button>`;
      }).join('')}
    </div>`;
  }

  function replyQuoteHtml(message: AnyRecord) {
    if (!message.replyTo) {
      return '';
    }
    const parent = message.replyTo;
    const who = parent.senderUsername ? `@${parent.senderUsername}` : 'Tin nhắn';
    const body = parent.deleted
      ? 'Tin nhắn đã xóa'
      : truncateText(dmPreviewFromBody(parent.body || '', 120) || '[nội dung]', 120);
    return `<button type="button" class="dm-reply-quote" data-dm-scroll-msg="${escapeHtml(parent.id || '')}">
      <strong>${escapeHtml(who)}</strong>
      <span>${escapeHtml(body)}</span>
    </button>`;
  }

  function imagesHtml(message: AnyRecord) {
    const images = Array.isArray(message.images) ? message.images : [];
    if (!images.length) {
      return '';
    }
    return `<div class="dm-message-images">${images
      .map((image: AnyRecord) => {
        const src = String(image.url || image.thumbnail?.url || '');
        if (!src) {
          return '';
        }
        return `<a class="dm-message-image" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">
          <img src="${escapeHtml(src)}" alt="${escapeHtml(image.name || 'ảnh')}" loading="lazy" />
        </a>`;
      })
      .join('')}</div>`;
  }

  function linksHtml(message: AnyRecord) {
    const links = Array.isArray(message.links) ? message.links : [];
    if (!links.length || message.deleted) {
      return '';
    }
    return `<div class="dm-message-links">${links
      .map((link: AnyRecord) => {
        const url = String(link.url || '');
        if (!url) {
          return '';
        }
        const domain = String(link.domain || '');
        const cached = linkPreviewCache.get(url);
        const title = cached?.title || domain || url;
        const description = cached?.description || '';
        const image = cached?.image || '';
        return `<a class="dm-link-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" data-dm-link="${escapeHtml(url)}">
          ${image ? `<img class="dm-link-card-image" src="${escapeHtml(image)}" alt="" loading="lazy" />` : ''}
          <span class="dm-link-card-body">
            <span class="dm-link-card-title">${escapeHtml(truncateText(String(title), 90))}</span>
            ${description ? `<span class="dm-link-card-desc muted">${escapeHtml(truncateText(String(description), 120))}</span>` : ''}
            <span class="dm-link-card-domain muted">${escapeHtml(domain || url)}</span>
          </span>
        </a>`;
      })
      .join('')}</div>`;
  }

  function renderConversationList() {
    if (!els.dmConversationList) {
      return;
    }
    if (!isDmAccountSessionCurrent(state, state.accountToken)) {
      els.dmConversationList.replaceChildren();
      return;
    }
    if (!conversations.length) {
      els.dmConversationList.innerHTML = '<p class="muted dm-empty-list">Chưa có hội thoại.</p>';
      return;
    }
    els.dmConversationList.innerHTML = conversations
      .map((conversation) => {
        const name = conversationDisplayName(conversation);
        const kindBadge = isGroupConversation(conversation)
          ? ' <span class="dm-kind-badge">nhóm</span>'
          : '';
        const muteBadge = conversation.muted
          ? ' <span class="dm-kind-badge dm-muted-badge">tắt TB</span>'
          : '';
        const rawPreview = String(conversation.lastMessagePreview || '').trim();
        const preview = (rawPreview ? dmPreviewFromBody(rawPreview, 80) : '') || 'Chưa có tin nhắn';
        const active = conversation.id === activeConversationId ? ' is-active' : '';
        const unread = Number(conversation.unreadCount || 0);
        return `<button type="button" class="dm-conversation-item${active}" data-dm-conversation="${escapeHtml(conversation.id)}" role="listitem">
          <span class="dm-conversation-name">${escapeHtml(name)}${kindBadge}${muteBadge}${unread > 0 ? ` <span class="dm-item-unread">${unread}</span>` : ''}</span>
          <span class="dm-conversation-preview">${escapeHtml(preview)}</span>
          <span class="dm-conversation-time muted">${escapeHtml(formatDmTime(conversation.lastMessageAt || conversation.updatedAt || ''))}</span>
        </button>`;
      })
      .join('');
  }

  function canEditMessageLocal(message: AnyRecord) {
    if (message.deleted || message.deletedAt) {
      return false;
    }
    const myId = String(state.account?.id || '');
    if (String(message.senderId) !== myId) {
      return false;
    }
    const createdMs = Date.parse(String(message.createdAt || ''));
    if (!Number.isFinite(createdMs)) {
      return false;
    }
    return Date.now() - createdMs <= 30 * 60 * 1000;
  }

  function canDeleteMessageLocal(message: AnyRecord) {
    if (message.deleted || message.deletedAt) {
      return false;
    }
    const myId = String(state.account?.id || '');
    if (String(message.senderId) === myId) {
      return true;
    }
    if (!isGroupConversation(activeConversation)) {
      return false;
    }
    const myRole = String(activeConversation?.myRole || '');
    return myRole === 'owner' || myRole === 'admin';
  }

  function messageArticleHtml(message: AnyRecord, { preserveEdit = false } = {}) {
    const myId = String(state.account?.id || '');
    const group = isGroupConversation(activeConversation);
    const mine = String(message.senderId) === myId;
    const deleted = Boolean(message.deleted || message.deletedAt);
    const isEditing = preserveEdit && editingMessageId === message.id && canEditMessageLocal(message);
    const senderLabel =
      group && !mine && message.senderUsername
        ? `<div class="dm-message-sender">@${escapeHtml(message.senderUsername)}</div>`
        : '';
    const bodyHtml = deleted
      ? `<div class="dm-message-body dm-message-deleted muted"><em>Tin nhắn đã xóa</em></div>`
      : isEditing
        ? `<div class="dm-inline-edit" data-dm-edit-form="${escapeHtml(message.id)}">
        <textarea id="dmEditMessageBody" class="dm-inline-edit-input" rows="3" maxlength="4000">${escapeHtml(message.body || '')}</textarea>
        <div class="composer-picker dm-inline-edit-picker" data-composer-picker="dmEdit" aria-label="Emoji và sticker khi sửa tin nhắn">
          <button class="link-button" data-composer-insert="🙂" type="button" aria-label="Chèn emoji vui">🙂</button>
          <button class="link-button" data-composer-insert="😂" type="button" aria-label="Chèn emoji cười">😂</button>
          <button class="link-button" data-composer-insert="😢" type="button" aria-label="Chèn emoji buồn">😢</button>
          <button class="link-button" data-composer-insert="🔥" type="button" aria-label="Chèn emoji nóng">🔥</button>
          <button class="link-button" data-composer-insert="🙏" type="button" aria-label="Chèn emoji cảm ơn">🙏</button>
          <button
            class="link-button composer-media-trigger"
            data-composer-media-open="dmEdit"
            type="button"
            aria-controls="composerMediaPicker"
            aria-expanded="false"
            aria-label="Chọn sticker hoặc GIF"
          >Sticker / GIF</button>
        </div>
        <div class="dm-inline-edit-actions">
          <button type="button" class="primary-button" data-dm-save-edit="${escapeHtml(message.id)}">Lưu</button>
          <button type="button" class="link-button" data-dm-cancel-edit>Hủy</button>
        </div>
      </div>`
        : `<div class="dm-message-body">${formatDmMessageHtml(message.body || '')}</div>${imagesHtml(message)}${linksHtml(message)}`;
    let edited =
      !deleted && message.editedAt
        ? ` · đã sửa ${escapeHtml(formatDmTime(message.editedAt))}`
        : '';
    const readByOthers = Array.isArray(message.readBy)
      ? message.readBy.map(String).filter((userId) => userId && userId !== String(state.account?.id || ''))
      : [];
    if (mine && readByOthers.length) {
      edited += ' · Đã đọc' + (readByOthers.length > 1 ? ' (' + readByOthers.length + ')' : '');
    }
    const actions: string[] = [];
    if (!deleted) {
      actions.push(
        `<button type="button" class="link-button" data-dm-reply-msg="${escapeHtml(message.id)}">[Trả lời]</button>`
      );
    }
    if (!deleted && canEditMessageLocal(message) && !isEditing) {
      actions.push(
        `<button type="button" class="link-button" data-dm-edit-msg="${escapeHtml(message.id)}">[Sửa]</button>`
      );
    }
    if (canDeleteMessageLocal(message)) {
      actions.push(
        `<button type="button" class="link-button" data-dm-delete-msg="${escapeHtml(message.id)}">[Xóa]</button>`
      );
    }
    const actionsHtml = actions.length
      ? `<div class="dm-message-actions">${actions.join(' ')}</div>`
      : '';
    return `<article class="dm-message ${mine ? 'is-mine' : 'is-peer'}${deleted ? ' is-deleted' : ''}" data-message-id="${escapeHtml(message.id)}" id="dm-msg-${escapeHtml(message.id)}">
      ${senderLabel}
      ${replyQuoteHtml(message)}
      ${bodyHtml}
      <div class="dm-message-meta muted">${escapeHtml(formatDmTime(message.createdAt || ''))}${edited}</div>
      ${deleted || isEditing ? '' : reactionBarHtml(message)}
      ${actionsHtml}
    </article>`;
  }

  function renderMessages({ stickToBottom = true, preserveScrollTop = false } = {}) {
    if (!els.dmMessageList) {
      return;
    }
    if (!isDmAccountSessionCurrent(state, state.accountToken)) {
      els.dmMessageList.replaceChildren();
      updateLoadOlderButton();
      return;
    }
    const previousHeight = els.dmMessageList.scrollHeight;
    const previousTop = els.dmMessageList.scrollTop;
    if (!messages.length) {
      els.dmMessageList.innerHTML = '<p class="muted">Chưa có tin nhắn. Hãy gửi lời chào.</p>';
      updateLoadOlderButton();
      return;
    }
    els.dmMessageList.innerHTML = messages
      .map((message) => messageArticleHtml(message, { preserveEdit: true }))
      .join('');
    if (stickToBottom) {
      els.dmMessageList.scrollTop = els.dmMessageList.scrollHeight;
    } else if (preserveScrollTop) {
      els.dmMessageList.scrollTop = previousTop;
    } else {
      els.dmMessageList.scrollTop = els.dmMessageList.scrollHeight - previousHeight + previousTop;
    }
    updateLoadOlderButton();
    requestComposerMediaHydration();
    hydrateLinkPreviews();
  }

  function hydrateLinkPreviews() {
    const accountToken = state.accountToken;
    if (!isDmAccountSessionCurrent(state, accountToken)) {
      return;
    }
    const cards = els.dmMessageList?.querySelectorAll('[data-dm-link]') || [];
    cards.forEach((node) => {
      const url = node.getAttribute('data-dm-link') || '';
      if (!url || linkPreviewCache.has(url)) {
        return;
      }
      linkPreviewCache.set(url, null);
      api('/api/dm/link-preview', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({ url })
      })
        .then((preview) => {
          if (!isDmAccountSessionCurrent(state, accountToken)) {
            return;
          }
          linkPreviewCache.set(url, preview || null);
          // Refresh only the matching cards without full re-render when possible.
          document.querySelectorAll(`[data-dm-link="${CSS.escape(url)}"]`).forEach((card) => {
            const title = String(preview?.title || preview?.domain || url);
            const description = String(preview?.description || '');
            const image = String(preview?.image || '');
            const domain = String(preview?.domain || '');
            const titleEl = card.querySelector('.dm-link-card-title');
            const descEl = card.querySelector('.dm-link-card-desc');
            const domainEl = card.querySelector('.dm-link-card-domain');
            if (titleEl) {
              titleEl.textContent = truncateText(title, 90);
            }
            if (domainEl) {
              domainEl.textContent = domain || url;
            }
            if (description) {
              if (descEl) {
                descEl.textContent = truncateText(description, 120);
              } else {
                const span = document.createElement('span');
                span.className = 'dm-link-card-desc muted';
                span.textContent = truncateText(description, 120);
                card.querySelector('.dm-link-card-body')?.insertBefore(span, domainEl);
              }
            }
            if (image && !card.querySelector('.dm-link-card-image')) {
              const img = document.createElement('img');
              img.className = 'dm-link-card-image';
              img.src = image;
              img.alt = '';
              img.loading = 'lazy';
              card.insertBefore(img, card.firstChild);
            }
          });
        })
        .catch(() => {
          // keep bare link card
        });
    });
  }

  function renderThreadActions(conversation: AnyRecord | null) {
    const host = els.dmThreadActions as HTMLElement | null;
    if (!host) {
      return;
    }
    if (!conversation) {
      host.innerHTML = '';
      return;
    }
    const muted = Boolean(conversation.muted);
    const buttons: string[] = [
      `<button type="button" class="link-button" data-dm-mute="${muted ? '0' : '1'}">${muted ? '[Bật thông báo]' : '[Tắt thông báo]'}</button>`,
      '<button type="button" class="link-button" data-dm-hide-chat>[Ẩn chat]</button>'
    ];
    if (!isGroupConversation(conversation) && conversation.peer?.id) {
      buttons.push(
        `<button type="button" class="link-button" data-dm-block="${escapeHtml(conversation.peer.id)}">[Chặn @${escapeHtml(conversation.peer.username || 'user')}]</button>`
      );
    }
    if (isGroupConversation(conversation) && conversation.myRole === 'owner') {
      buttons.push('<button type="button" class="link-button" data-dm-delete-group>[Xóa nhóm]</button>');
    }
    host.innerHTML = buttons.join(' ');
  }

  function renderGroupPanel(conversation: AnyRecord | null) {
    const panel = els.dmGroupPanel as HTMLElement | null;
    if (!panel) {
      return;
    }
    if (!conversation || !isGroupConversation(conversation)) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
      return;
    }
    const myRole = String(conversation.myRole || 'member');
    const canManage = myRole === 'owner' || myRole === 'admin';
    const isOwner = myRole === 'owner';
    const members = Array.isArray(conversation.participants) ? conversation.participants : [];
    const memberRows = members
      .map((member: AnyRecord) => {
        const memberRole = String(member.memberRole || 'member');
        const actions: string[] = [];
        if (canManage && member.id !== state.account?.id) {
          if (
            (isOwner && memberRole !== 'owner') ||
            (myRole === 'admin' && memberRole === 'member')
          ) {
            actions.push(
              `<button type="button" class="link-button" data-dm-kick="${escapeHtml(member.id)}">[Kick]</button>`
            );
          }
          if (isOwner && memberRole === 'member') {
            actions.push(
              `<button type="button" class="link-button" data-dm-role="${escapeHtml(member.id)}" data-role="admin">[Lên admin]</button>`
            );
          }
          if (isOwner && memberRole === 'admin') {
            actions.push(
              `<button type="button" class="link-button" data-dm-role="${escapeHtml(member.id)}" data-role="member">[Xuống member]</button>`
            );
          }
          if (member.id) {
            actions.push(
              `<button type="button" class="link-button" data-dm-block="${escapeHtml(member.id)}">[Chặn]</button>`
            );
          }
        }
        return `<div class="dm-group-member-row">
          <span>@${escapeHtml(member.username || 'đã-xóa')} · ${escapeHtml(memberRole)}</span>
          ${actions.length ? `<span class="dm-group-member-actions">${actions.join('')}</span>` : ''}
        </div>`;
      })
      .join('');
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="dm-group-members" aria-label="Thành viên nhóm">${memberRows || '<span class="muted">Chưa có thành viên.</span>'}</div>
      ${
        canManage
          ? `<div class="dm-group-invite-row">
              <input id="dmGroupInviteInput" type="text" maxlength="200" placeholder="Mời @user1, @user2" />
              <button type="button" class="link-button" data-dm-invite> [Mời]</button>
            </div>
            <div class="dm-group-rename-row">
              <input id="dmGroupRenameInput" type="text" maxlength="80" value="${escapeHtml(conversation.title || '')}" placeholder="Tên nhóm" />
              <button type="button" class="link-button" data-dm-rename>[Đổi tên]</button>
            </div>`
          : ''
      }
      <div class="dm-group-invite-row">
        <button type="button" class="link-button" data-dm-leave>[Rời nhóm]</button>
      </div>
    `;
  }

  function showThread(conversation: AnyRecord | null) {
    if (!isDmAccountSessionCurrent(state, state.accountToken)) {
      conversation = null;
    }
    const hasThread = Boolean(conversation?.id);
    els.dmEmptyState?.classList.toggle('hidden', hasThread);
    els.dmThread?.classList.toggle('hidden', !hasThread);
    if (!hasThread) {
      activeConversationId = '';
      activeConversation = null;
      messages = [];
      hasMoreMessages = false;
      clearReplyTarget();
      clearPendingImage();
      clearTypingUsers();
      editingMessageId = '';
      if (els.dmThreadTitle) {
        els.dmThreadTitle.textContent = 'Chat';
      }
      if (els.dmThreadMeta) {
        els.dmThreadMeta.textContent = '';
      }
      renderThreadActions(null);
      renderGroupPanel(null);
      renderMessages();
      return;
    }
    activeConversationId = conversation.id;
    activeConversation = conversation;
    if (els.dmThreadTitle) {
      els.dmThreadTitle.textContent = conversationDisplayName(conversation);
    }
    if (els.dmThreadMeta) {
      if (isGroupConversation(conversation)) {
        const count = Number(conversation.participantCount || conversation.participants?.length || 0);
        const role = conversation.myRole ? ` · bạn: ${conversation.myRole}` : '';
        const mute = conversation.muted ? ' · đã tắt TB' : '';
        els.dmThreadMeta.textContent = `Nhóm · ${count} thành viên · AES-256-GCM${role}${mute}`;
      } else {
        const role =
          conversation.peer?.role && conversation.peer.role !== 'user'
            ? ` · ${conversation.peer.role}`
            : '';
        const mute = conversation.muted ? ' · đã tắt TB' : '';
        els.dmThreadMeta.textContent = `Tin nhắn mã hóa AES-256-GCM${role}${mute}`;
      }
    }
    renderThreadActions(conversation);
    renderGroupPanel(conversation);
  }

  function mergeActiveConversation(conversation: AnyRecord | null | undefined) {
    if (!conversation?.id) {
      return;
    }
    activeConversation = { ...(activeConversation || {}), ...conversation };
    const idx = conversations.findIndex((item) => item.id === conversation.id);
    if (idx >= 0) {
      conversations[idx] = { ...conversations[idx], ...conversation };
    } else {
      conversations = [conversation, ...conversations];
    }
    if (activeConversationId === conversation.id || !activeConversationId) {
      activeConversationId = conversation.id;
      showThread(activeConversation);
    }
    renderConversationList();
  }

  function mergeMessage(message: AnyRecord | null | undefined) {
    if (!message?.id) {
      return;
    }
    const idx = messages.findIndex((item) => item.id === message.id);
    if (idx >= 0) {
      messages[idx] = { ...messages[idx], ...message };
    } else {
      messages = [...messages, message].sort((left, right) =>
        String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
      );
    }
  }

  function mergeReadConversation(conversation: AnyRecord | null | undefined) {
    if (!conversation?.id) {
      return;
    }
    mergeActiveConversation({ ...conversation, unreadCount: 0 });
    conversations.sort((left, right) =>
      String(right.lastMessageAt || '').localeCompare(String(left.lastMessageAt || ''))
    );
    renderConversationList();
    updateUnreadUi(
      conversations.reduce(
        (sum, item) => sum + Math.max(0, Number(item.unreadCount || 0)),
        0
      )
    );
  }

  function acknowledgeConversationRead(conversationId: string, accountToken: string) {
    const key = `${accountToken}:${conversationId}`;
    const pending = readAcknowledgements.get(key);
    if (pending) {
      return pending;
    }
    const request: Promise<void> = (async () => {
      try {
        const conversation = await emitRealtime(
          'dm:read',
          { conversationId },
          { timeoutMs: 4_000 }
        );
        if (isDmAccountSessionCurrent(state, accountToken)) {
          mergeReadConversation(conversation as AnyRecord);
        }
        return;
      } catch {
        // Socket reconnects are transparent; REST keeps read state durable meanwhile.
      }
      try {
        const result = await api(
          `/api/dm/conversations/${encodeURIComponent(conversationId)}/read`,
          {
            auth: 'account',
            method: 'POST',
            body: '{}'
          }
        );
        if (isDmAccountSessionCurrent(state, accountToken)) {
          mergeReadConversation(result.conversation);
        }
      } catch {
        if (isDmAccountSessionCurrent(state, accountToken)) {
          await refreshUnreadCount();
        }
      }
    })()
      .finally(() => {
        if (readAcknowledgements.get(key) === request) {
          readAcknowledgements.delete(key);
        }
      });
    readAcknowledgements.set(key, request);
    return request;
  }

  async function refreshUnreadCount() {
    const accountToken = state.accountToken;
    if (!isLoggedIn()) {
      updateUnreadUi(0);
      return 0;
    }
    try {
      const result = await api('/api/dm/unread-count', { auth: 'account' });
      if (!isLoggedIn() || state.accountToken !== accountToken) {
        return unreadCount;
      }
      updateUnreadUi(result.unreadCount || 0);
      return Number(result.unreadCount || 0);
    } catch {
      return unreadCount;
    }
  }

  async function loadConversations({ preserveActive = true } = {}) {
    const accountToken = state.accountToken;
    if (!isLoggedIn()) {
      return [];
    }
    const result = await api('/api/dm/conversations', { auth: 'account' });
    if (!isLoggedIn() || state.accountToken !== accountToken) {
      return [];
    }
    conversations = Array.isArray(result.conversations) ? result.conversations : [];
    if (preserveActive && activeConversationId) {
      const stillThere = conversations.find((item) => item.id === activeConversationId);
      if (!stillThere) {
        activeConversationId = '';
        activeConversation = null;
      } else {
        activeConversation = { ...(activeConversation || {}), ...stillThere };
      }
    }
    renderConversationList();
    const totalUnread = conversations.reduce(
      (sum, item) => sum + Math.max(0, Number(item.unreadCount || 0)),
      0
    );
    updateUnreadUi(totalUnread);
    return conversations;
  }

  async function openConversation(conversationId: string) {
    if (!isLoggedIn() || !conversationId) {
      return null;
    }
    const accountToken = state.accountToken;
    const requestId = ++loadRequestId;
    editingMessageId = '';
    clearReplyTarget();
    clearPendingImage();
    clearTypingUsers();
    const result = await api(
      `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`,
      { auth: 'account' }
    );
    if (
      requestId !== loadRequestId ||
      !isLoggedIn() ||
      state.accountToken !== accountToken
    ) {
      return null;
    }
    messages = Array.isArray(result.messages) ? result.messages : [];
    hasMoreMessages = Boolean(result.hasMore);
    const conversation = result.conversation || conversations.find((item) => item.id === conversationId) || null;
    const needsReadAcknowledgement = Number(conversation?.unreadCount || 0) > 0;
    if (conversation) {
      showThread(conversation);
      mergeReadConversation(conversation);
    } else {
      showThread(null);
    }
    renderMessages({ stickToBottom: true });
    if (needsReadAcknowledgement) {
      acknowledgeConversationRead(conversationId, accountToken);
    }
    window.location.hash = `#messages/${encodeURIComponent(conversationId)}`;
    return result;
  }

  async function refreshIncomingConversation({
    conversationId,
    accountToken
  }: {
    conversationId: string;
    accountToken: string;
  }) {
    const messageList = els.dmMessageList;
    const stickToBottom = messageList
      ? messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight <= 120
      : true;
    const result = await api(
      `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages?limit=${Math.max(messages.length, 50)}`,
      { auth: 'account' }
    );
    if (
      !isDmAccountSessionCurrent(state, accountToken) ||
      activeConversationId !== conversationId
    ) {
      return;
    }
    if (Array.isArray(result.messages)) {
      messages = result.messages;
      hasMoreMessages = Boolean(result.hasMore);
    }
    const needsReadAcknowledgement = Number(result.conversation?.unreadCount || 0) > 0;
    if (result.conversation) {
      mergeReadConversation(result.conversation);
    }
    renderMessages({
      stickToBottom,
      preserveScrollTop: !stickToBottom
    });
    if (needsReadAcknowledgement) {
      acknowledgeConversationRead(conversationId, accountToken);
    }
  }

  const scheduleIncomingConversationRefresh = createTrailingAsyncCoalescer(
    refreshIncomingConversation
  );

  async function loadOlderMessages() {
    if (!activeConversationId || !hasMoreMessages || loadingOlder || !messages.length) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    const oldest = messages[0];
    const before = String(oldest?.createdAt || '');
    if (!before) {
      return;
    }
    loadingOlder = true;
    updateLoadOlderButton();
    try {
      const result = await api(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages?limit=50&before=${encodeURIComponent(before)}`,
        { auth: 'account' }
      );
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      const older = Array.isArray(result.messages) ? result.messages : [];
      hasMoreMessages = Boolean(result.hasMore);
      if (older.length) {
        const existing = new Set(messages.map((item) => item.id));
        const unique = older.filter((item: AnyRecord) => !existing.has(item.id));
        messages = [...unique, ...messages];
        renderMessages({ stickToBottom: false });
      } else {
        updateLoadOlderButton();
      }
    } catch (error) {
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      showToast?.(error.message || 'Không tải được tin nhắn cũ.');
      updateLoadOlderButton();
    } finally {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      loadingOlder = false;
      updateLoadOlderButton();
    }
  }

  async function loadMessagesScreen(conversationId = '') {
    setScreen('messages');
    const loggedIn = isLoggedIn();
    els.dmLoggedOut?.classList.toggle('hidden', loggedIn);
    els.dmLoggedIn?.classList.toggle('hidden', !loggedIn);
    if (!loggedIn) {
      showThread(null);
      return;
    }
    const accountToken = state.accountToken;
    setFormError(els.dmStartError);
    setFormError(els.dmGroupError);
    setFormError(els.dmSendError);
    try {
      await loadConversations({ preserveActive: true });
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      const targetId = conversationId || activeConversationId;
      if (targetId) {
        await openConversation(targetId);
      } else {
        showThread(null);
      }
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showToast(error.message || 'Không tải được tin nhắn.');
    }
  }

  async function startConversation(event: Event) {
    event.preventDefault();
    if (!isLoggedIn()) {
      window.location.hash = '#login';
      return;
    }
    const accountToken = state.accountToken;
    setFormError(els.dmStartError);
    const username = String(els.dmPeerUsername?.value || '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    if (!username) {
      setFormError(els.dmStartError, 'Nhập tên tài khoản người nhận.');
      return;
    }
    const button = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    const restore = setButtonLoading?.(button, 'Đang mở...') || (() => {});
    try {
      const result = await api('/api/dm/conversations', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({ username })
      });
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      if (els.dmPeerUsername) {
        els.dmPeerUsername.value = '';
      }
      await loadConversations({ preserveActive: false });
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      if (result.conversation?.id) {
        await openConversation(result.conversation.id);
      }
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      setFormError(els.dmStartError, error.message || 'Không mở được chat.');
    } finally {
      restore();
    }
  }

  async function sendMessage(event: Event) {
    event.preventDefault();
    if (!isLoggedIn() || !activeConversationId) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    setFormError(els.dmSendError);
    const body = String(els.dmMessageBody?.value || '').trim();
    if (!body && !pendingImage) {
      setFormError(els.dmSendError, 'Tin nhắn trống.');
      return;
    }
    const button = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    const restore = setButtonLoading?.(button, 'Đang gửi...') || (() => {});
    const payload: AnyRecord = { body };
    if (pendingImage) {
      payload.image = pendingImage;
    }
    if (replyToMessage?.id) {
      payload.replyToId = replyToMessage.id;
    }
    try {
      let result: AnyRecord | null = null;
      if (!pendingImage) {
        try {
          result = await emitRealtime(
            'dm:send',
            { conversationId, ...payload },
            { timeoutMs: 10_000 }
          ) as AnyRecord;
        } catch (error) {
          // Only fall back before a Socket.IO send was accepted; retrying after
          // an acknowledgement timeout could create a duplicate message.
          if ((error as AnyRecord).code !== 'SOCKET_DISCONNECTED') {
            throw error;
          }
        }
      }
      result ??= await api(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          auth: 'account',
          method: 'POST',
          body: JSON.stringify(payload)
        }
      );
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      if (els.dmMessageBody) {
        els.dmMessageBody.value = '';
      }
      clearPendingImage();
      clearReplyTarget();
      if (result.message) {
        if (!result.message.senderUsername && state.account?.username) {
          result.message.senderUsername = state.account.username;
        }
        mergeMessage(result.message);
        renderMessages({ stickToBottom: true });
      }
      if (result.conversation) {
        mergeActiveConversation({ ...result.conversation, unreadCount: 0 });
        conversations.sort((left, right) =>
          String(right.lastMessageAt || '').localeCompare(String(left.lastMessageAt || ''))
        );
        renderConversationList();
      }
    } catch (error) {
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      setFormError(els.dmSendError, error.message || 'Gửi thất bại.');
    } finally {
      restore();
    }
  }

  async function createGroup(event: Event) {
    event.preventDefault();
    if (!isLoggedIn()) {
      window.location.hash = '#login';
      return;
    }
    const accountToken = state.accountToken;
    setFormError(els.dmGroupError);
    const title = String(els.dmGroupTitle?.value || '').trim();
    const usernames = parseUsernameList(String(els.dmGroupUsernames?.value || ''));
    if (!title) {
      setFormError(els.dmGroupError, 'Nhập tên nhóm.');
      return;
    }
    if (!usernames.length) {
      setFormError(els.dmGroupError, 'Nhập ít nhất một @username thành viên.');
      return;
    }
    const button = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    const restore = setButtonLoading?.(button, 'Đang tạo...') || (() => {});
    try {
      const result = await api('/api/dm/groups', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({ title, usernames })
      });
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      if (els.dmGroupTitle) {
        els.dmGroupTitle.value = '';
      }
      if (els.dmGroupUsernames) {
        els.dmGroupUsernames.value = '';
      }
      await loadConversations({ preserveActive: false });
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      if (result.conversation?.id) {
        const opened = await openConversation(result.conversation.id);
        if (!opened || !isDmAccountSessionCurrent(state, accountToken)) {
          return;
        }
        showToast?.('Đã tạo nhóm chat.');
      }
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      setFormError(els.dmGroupError, error.message || 'Không tạo được nhóm.');
    } finally {
      restore();
    }
  }

  async function inviteGroupMembers() {
    if (!activeConversationId || !isGroupConversation(activeConversation)) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    const input = document.querySelector('#dmGroupInviteInput') as HTMLInputElement | null;
    const usernames = parseUsernameList(input?.value || '');
    if (!usernames.length) {
      showToast?.('Nhập @username để mời.');
      return;
    }
    try {
      const result = await api(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/invite`,
        {
          auth: 'account',
          method: 'POST',
          body: JSON.stringify({ usernames })
        }
      );
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      if (input) {
        input.value = '';
      }
      mergeActiveConversation(result.conversation);
      showToast?.('Đã mời thành viên.');
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showToast?.(error.message || 'Mời thất bại.');
    }
  }

  async function renameGroup() {
    if (!activeConversationId || !isGroupConversation(activeConversation)) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    const input = document.querySelector('#dmGroupRenameInput') as HTMLInputElement | null;
    const title = String(input?.value || '').trim();
    if (!title) {
      showToast?.('Tên nhóm trống.');
      return;
    }
    try {
      const result = await api(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}`,
        {
          auth: 'account',
          method: 'PATCH',
          body: JSON.stringify({ title })
        }
      );
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      mergeActiveConversation(result.conversation);
      showToast?.('Đã đổi tên nhóm.');
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showToast?.(error.message || 'Đổi tên thất bại.');
    }
  }

  async function leaveGroup() {
    if (!activeConversationId || !isGroupConversation(activeConversation)) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    if (!window.confirm('Rời nhóm chat này?')) {
      return;
    }
    try {
      await api(`/api/dm/conversations/${encodeURIComponent(conversationId)}/leave`, {
        auth: 'account',
        method: 'POST',
        body: '{}'
      });
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      activeConversationId = '';
      activeConversation = null;
      messages = [];
      await loadConversations({ preserveActive: false });
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showThread(null);
      window.location.hash = '#messages';
      showToast?.('Đã rời nhóm.');
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showToast?.(error.message || 'Không rời được nhóm.');
    }
  }

  async function kickMember(userId: string) {
    if (!activeConversationId || !userId) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    try {
      const result = await api(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/kick`,
        {
          auth: 'account',
          method: 'POST',
          body: JSON.stringify({ userId })
        }
      );
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      mergeActiveConversation(result.conversation);
      showToast?.('Đã kick thành viên.');
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showToast?.(error.message || 'Kick thất bại.');
    }
  }

  async function setMemberRole(userId: string, role: string) {
    if (!activeConversationId || !userId || !role) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    try {
      const result = await api(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/roles`,
        {
          auth: 'account',
          method: 'POST',
          body: JSON.stringify({ userId, role })
        }
      );
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      mergeActiveConversation(result.conversation);
      showToast?.('Đã cập nhật vai trò.');
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showToast?.(error.message || 'Đổi vai trò thất bại.');
    }
  }

  function beginInlineEdit(messageId: string) {
    const existing = messages.find((item) => item.id === messageId);
    if (!existing || !canEditMessageLocal(existing)) {
      return;
    }
    closeComposerMediaPicker({ restoreFocus: false });
    editingMessageId = messageId;
    renderMessages({ stickToBottom: false });
    const input = els.dmMessageList?.querySelector(
      `[data-dm-edit-form="${CSS.escape(messageId)}"] textarea`
    ) as HTMLTextAreaElement | null;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }

  function cancelInlineEdit() {
    closeComposerMediaPicker({ restoreFocus: false });
    editingMessageId = '';
    renderMessages({ stickToBottom: false });
  }

  async function saveInlineEdit(messageId: string) {
    if (!activeConversationId || !messageId) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    const form = els.dmMessageList?.querySelector(
      `[data-dm-edit-form="${CSS.escape(messageId)}"]`
    ) as HTMLElement | null;
    const input = form?.querySelector('textarea') as HTMLTextAreaElement | null;
    const body = String(input?.value || '').trim();
    if (!body) {
      showToast?.('Nội dung trống.');
      return;
    }
    try {
      const result = await api(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
        {
          auth: 'account',
          method: 'PATCH',
          body: JSON.stringify({ body })
        }
      );
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      closeComposerMediaPicker({ restoreFocus: false });
      editingMessageId = '';
      if (result.message) {
        mergeMessage(result.message);
        renderMessages({ stickToBottom: false });
      }
      if (result.conversation) {
        mergeActiveConversation(result.conversation);
      }
      showToast?.('Đã sửa tin nhắn.');
    } catch (error) {
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      showToast?.(error.message || 'Sửa thất bại.');
    }
  }

  async function deleteMessage(messageId: string) {
    if (!activeConversationId || !messageId) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    if (!window.confirm('Xóa tin nhắn này?')) {
      return;
    }
    try {
      const result = await api(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
        {
          auth: 'account',
          method: 'DELETE'
        }
      );
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      if (result.message) {
        mergeMessage({ ...result.message, deleted: true, body: '' });
        renderMessages({ stickToBottom: false });
      }
      if (result.conversation) {
        mergeActiveConversation(result.conversation);
      }
      showToast?.('Đã xóa tin nhắn.');
    } catch (error) {
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      showToast?.(error.message || 'Xóa tin nhắn thất bại.');
    }
  }

  async function reactMessage(messageId: string, reaction: string) {
    if (!activeConversationId || !messageId || !reaction) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    try {
      const result = await api(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`,
        {
          auth: 'account',
          method: 'POST',
          body: JSON.stringify({ reaction })
        }
      );
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      if (result.message) {
        mergeMessage(result.message);
        renderMessages({ stickToBottom: false });
      }
    } catch (error) {
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      showToast?.(error.message || 'Không gửi được biểu cảm.');
    }
  }

  async function setMuted(muted: boolean) {
    if (!activeConversationId) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    try {
      const result = await api(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/mute`,
        {
          auth: 'account',
          method: muted ? 'POST' : 'DELETE',
          body: muted ? JSON.stringify({ muted: true }) : undefined
        }
      );
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      if (result.conversation) {
        mergeActiveConversation(result.conversation);
        showThread(activeConversation);
      }
      showToast?.(muted ? 'Đã tắt thông báo hội thoại.' : 'Đã bật lại thông báo.');
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showToast?.(error.message || 'Không đổi được trạng thái mute.');
    }
  }

  async function blockUser(userId: string) {
    if (!userId) {
      return;
    }
    const accountToken = state.accountToken;
    if (!window.confirm('Chặn người này? Họ sẽ không nhắn được cho bạn (1-1).')) {
      return;
    }
    try {
      await api('/api/dm/block', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({ userId, blocked: true })
      });
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showToast?.('Đã chặn người dùng.');
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showToast?.(error.message || 'Chặn thất bại.');
    }
  }

  async function hideOrDeleteConversation({ hard = false } = {}) {
    if (!activeConversationId) {
      return;
    }
    const accountToken = state.accountToken;
    const conversationId = activeConversationId;
    const group = isGroupConversation(activeConversation);
    const confirmText = hard
      ? 'Xóa hẳn nhóm và toàn bộ tin nhắn cho mọi thành viên?'
      : group
        ? 'Ẩn nhóm này khỏi danh sách của bạn?'
        : 'Ẩn / xóa hội thoại này khỏi danh sách của bạn?';
    if (!window.confirm(confirmText)) {
      return;
    }
    try {
      const qs = hard ? '?hard=1' : '';
      await api(`/api/dm/conversations/${encodeURIComponent(conversationId)}${qs}`, {
        auth: 'account',
        method: 'DELETE'
      });
      if (
        !isDmAccountSessionCurrent(state, accountToken) ||
        activeConversationId !== conversationId
      ) {
        return;
      }
      activeConversationId = '';
      activeConversation = null;
      messages = [];
      await loadConversations({ preserveActive: false });
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showThread(null);
      window.location.hash = '#messages';
      showToast?.(hard ? 'Đã xóa nhóm.' : 'Đã ẩn hội thoại.');
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showToast?.(error.message || 'Thao tác thất bại.');
    }
  }

  async function runSearch(event?: Event) {
    event?.preventDefault();
    if (!isLoggedIn() || !els.dmSearchResults) {
      return;
    }
    const accountToken = state.accountToken;
    const q = String(els.dmSearchInput?.value || '').trim();
    if (q.length < 2) {
      els.dmSearchResults.classList.remove('hidden');
      els.dmSearchResults.innerHTML = '<p class="muted">Nhập ít nhất 2 ký tự.</p>';
      return;
    }
    els.dmSearchResults.classList.remove('hidden');
    els.dmSearchResults.innerHTML = '<p class="muted">Đang tìm...</p>';
    try {
      const result = await api(`/api/dm/search?q=${encodeURIComponent(q)}&limit=20`, {
        auth: 'account'
      });
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      const hits = Array.isArray(result.results) ? result.results : [];
      if (!hits.length) {
        els.dmSearchResults.innerHTML = '<p class="muted">Không có kết quả.</p>';
        return;
      }
      els.dmSearchResults.innerHTML = hits
        .map((hit: AnyRecord) => {
          const conversation = hit.conversation || {};
          const message = hit.message || {};
          const title = conversationDisplayName(conversation);
          const preview = truncateText(dmPreviewFromBody(message.body || '', 100) || '', 100);
          return `<button type="button" class="dm-search-hit" data-dm-search-open="${escapeHtml(conversation.id || '')}" data-dm-search-msg="${escapeHtml(message.id || '')}" role="listitem">
            <span class="dm-search-hit-title">${escapeHtml(title)}</span>
            <span class="dm-search-hit-body">${escapeHtml(preview)}</span>
            <span class="muted dm-search-hit-time">${escapeHtml(formatDmTime(message.createdAt || ''))}</span>
          </button>`;
        })
        .join('');
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      els.dmSearchResults.innerHTML = `<p class="muted">${escapeHtml(error.message || 'Tìm kiếm thất bại.')}</p>`;
    }
  }

  async function handleImagePicked(event: Event) {
    const accountToken = state.accountToken;
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/') || !isSupportedMediaFile(file)) {
      showToast?.('Chỉ hỗ trợ ảnh JPEG/PNG/GIF/WebP.');
      clearPendingImage();
      return;
    }
    try {
      const image = await fileToDataUrl(file);
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      pendingImage = image;
      renderAttachPreview();
    } catch (error) {
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      showToast?.(error.message || 'Không đọc được ảnh.');
      clearPendingImage();
    }
  }

  function scrollToMessage(messageId: string) {
    if (!messageId) {
      return;
    }
    const node = document.getElementById(`dm-msg-${messageId}`);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node.classList.add('dm-message-flash');
      window.setTimeout(() => node.classList.remove('dm-message-flash'), 1200);
    }
  }

  function handleDmClick(event: Event) {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return false;
    }

    const clearAttach = target.closest?.('[data-dm-clear-attach]') as HTMLElement | null;
    if (clearAttach) {
      clearPendingImage();
      return true;
    }
    const attachBtn = target.closest?.('[data-dm-attach]') as HTMLElement | null;
    if (attachBtn) {
      els.dmImageInput?.click();
      return true;
    }
    const cancelReply = target.closest?.('[data-dm-cancel-reply]') as HTMLElement | null;
    if (cancelReply) {
      clearReplyTarget();
      return true;
    }
    const replyMsg = target.closest?.('[data-dm-reply-msg]') as HTMLElement | null;
    if (replyMsg) {
      const messageId = replyMsg.getAttribute('data-dm-reply-msg') || '';
      const message = messages.find((item) => item.id === messageId) || null;
      setReplyTarget(message);
      return true;
    }
    const scrollMsg = target.closest?.('[data-dm-scroll-msg]') as HTMLElement | null;
    if (scrollMsg) {
      scrollToMessage(scrollMsg.getAttribute('data-dm-scroll-msg') || '');
      return true;
    }
    const reactBtn = target.closest?.('[data-dm-react]') as HTMLElement | null;
    if (reactBtn) {
      reactMessage(
        reactBtn.getAttribute('data-dm-react') || '',
        reactBtn.getAttribute('data-reaction') || ''
      ).catch((error) => showToast(error.message || 'Lỗi reaction.'));
      return true;
    }
    const saveEdit = target.closest?.('[data-dm-save-edit]') as HTMLElement | null;
    if (saveEdit) {
      saveInlineEdit(saveEdit.getAttribute('data-dm-save-edit') || '').catch((error) =>
        showToast(error.message || 'Lỗi lưu.')
      );
      return true;
    }
    const cancelEdit = target.closest?.('[data-dm-cancel-edit]') as HTMLElement | null;
    if (cancelEdit) {
      cancelInlineEdit();
      return true;
    }
    const editMsg = target.closest?.('[data-dm-edit-msg]') as HTMLElement | null;
    if (editMsg) {
      beginInlineEdit(editMsg.getAttribute('data-dm-edit-msg') || '');
      return true;
    }
    const deleteMsg = target.closest?.('[data-dm-delete-msg]') as HTMLElement | null;
    if (deleteMsg) {
      deleteMessage(deleteMsg.getAttribute('data-dm-delete-msg') || '').catch((error) =>
        showToast(error.message || 'Lỗi xóa.')
      );
      return true;
    }
    const muteBtn = target.closest?.('[data-dm-mute]') as HTMLElement | null;
    if (muteBtn) {
      setMuted(muteBtn.getAttribute('data-dm-mute') === '1').catch((error) =>
        showToast(error.message || 'Lỗi mute.')
      );
      return true;
    }
    const blockBtn = target.closest?.('[data-dm-block]') as HTMLElement | null;
    if (blockBtn) {
      blockUser(blockBtn.getAttribute('data-dm-block') || '').catch((error) =>
        showToast(error.message || 'Lỗi chặn.')
      );
      return true;
    }
    const hideChat = target.closest?.('[data-dm-hide-chat]') as HTMLElement | null;
    if (hideChat) {
      hideOrDeleteConversation({ hard: false }).catch((error) =>
        showToast(error.message || 'Lỗi ẩn chat.')
      );
      return true;
    }
    const deleteGroup = target.closest?.('[data-dm-delete-group]') as HTMLElement | null;
    if (deleteGroup) {
      hideOrDeleteConversation({ hard: true }).catch((error) =>
        showToast(error.message || 'Lỗi xóa nhóm.')
      );
      return true;
    }
    const inviteBtn = target.closest?.('[data-dm-invite]') as HTMLElement | null;
    if (inviteBtn) {
      inviteGroupMembers().catch((error) => showToast(error.message || 'Lỗi mời.'));
      return true;
    }
    const renameBtn = target.closest?.('[data-dm-rename]') as HTMLElement | null;
    if (renameBtn) {
      renameGroup().catch((error) => showToast(error.message || 'Lỗi đổi tên.'));
      return true;
    }
    const leaveBtn = target.closest?.('[data-dm-leave]') as HTMLElement | null;
    if (leaveBtn) {
      leaveGroup().catch((error) => showToast(error.message || 'Lỗi rời nhóm.'));
      return true;
    }
    const kickBtn = target.closest?.('[data-dm-kick]') as HTMLElement | null;
    if (kickBtn) {
      kickMember(kickBtn.getAttribute('data-dm-kick') || '').catch((error) =>
        showToast(error.message || 'Lỗi kick.')
      );
      return true;
    }
    const roleBtn = target.closest?.('[data-dm-role]') as HTMLElement | null;
    if (roleBtn) {
      setMemberRole(
        roleBtn.getAttribute('data-dm-role') || '',
        roleBtn.getAttribute('data-role') || ''
      ).catch((error) => showToast(error.message || 'Lỗi vai trò.'));
      return true;
    }
    const searchHit = target.closest?.('[data-dm-search-open]') as HTMLElement | null;
    if (searchHit) {
      const accountToken = state.accountToken;
      const conversationId = searchHit.getAttribute('data-dm-search-open') || '';
      const messageId = searchHit.getAttribute('data-dm-search-msg') || '';
      openConversation(conversationId)
        .then((result) => {
          if (
            !result ||
            !isDmAccountSessionCurrent(state, accountToken) ||
            activeConversationId !== conversationId
          ) {
            return;
          }
          if (messageId) {
            window.setTimeout(() => {
              if (
                isDmAccountSessionCurrent(state, accountToken) &&
                activeConversationId === conversationId
              ) {
                scrollToMessage(messageId);
              }
            }, 80);
          }
        })
        .catch((error) => {
          if (isDmAccountSessionCurrent(state, accountToken)) {
            showToast(error.message || 'Lỗi mở chat.');
          }
        });
      return true;
    }
    const button = target.closest?.('[data-dm-conversation]') as HTMLElement | null;
    if (!button) {
      return false;
    }
    const conversationId = button.getAttribute('data-dm-conversation') || '';
    if (!conversationId) {
      return false;
    }
    const accountToken = state.accountToken;
    openConversation(conversationId).catch((error) => {
      if (isDmAccountSessionCurrent(state, accountToken)) {
        showToast(error.message || 'Lỗi mở chat.');
      }
    });
    return true;
  }

  async function handleIncomingDmEvent(payload: AnyRecord = {}, eventName = 'dm:message') {
    if (!isLoggedIn()) {
      return;
    }
    const accountToken = state.accountToken;
    const myId = String(state.account?.id || '');
    const participantIds = Array.isArray(payload.participantIds)
      ? payload.participantIds.map(String)
      : [];
    if (participantIds.length && !participantIds.includes(myId)) {
      return;
    }

    const conversationId = String(payload.conversationId || '');
    const senderId = String(payload.senderId || '');
    if (isOwnDmMessageEvent(eventName, senderId, myId)) {
      return;
    }
    const hash = window.location.hash || '';
    const viewing =
      hash.startsWith('#messages') &&
      conversationId &&
      (activeConversationId === conversationId || hash.includes(conversationId));

    if (eventName === 'dm:typing') {
      noteTypingEvent(payload);
      return;
    }
    if (eventName === 'dm:read' && String(payload.readerId || '') === myId) {
      return;
    }

    if (eventName === 'dm:conversation-deleted') {
      if (activeConversationId === conversationId) {
        activeConversationId = '';
        activeConversation = null;
        messages = [];
        showThread(null);
      }
      await loadConversations({ preserveActive: true });
      await refreshUnreadCount();
      if (!isDmAccountSessionCurrent(state, accountToken)) {
        return;
      }
      if (payload.hard) {
        showToast?.('Một nhóm chat đã bị xóa.');
      }
      return;
    }

    if (viewing && conversationId && (
      eventName === 'dm:message' ||
      eventName === 'dm:message-updated' ||
      eventName === 'dm:message-deleted' ||
      eventName === 'dm:read'
    )) {
      try {
        await scheduleIncomingConversationRefresh({ conversationId, accountToken });
      } catch {
        if (isDmAccountSessionCurrent(state, accountToken)) {
          await refreshUnreadCount();
        }
      }
      return;
    }

    if (shouldLoadDmConversationsForRealtime(eventName, hash)) {
      try {
        await loadConversations({ preserveActive: true });
      } catch {
        await refreshUnreadCount();
      }
    } else {
      await refreshUnreadCount();
    }
    if (!isDmAccountSessionCurrent(state, accountToken)) {
      return;
    }

    if (eventName === 'dm:message') {
      const conversation = conversations.find((item) => item.id === conversationId);
      if (conversation?.muted) {
        return;
      }
      const senderName = payload.senderUsername || 'ai đó';
      dependencies.notifyDirectMessage?.({
        conversationId,
        senderId,
        senderUsername: senderName,
        messageId: payload.messageId,
        createdAt: payload.createdAt,
        browserNotificationIds
      });
    }
  }

  function bindDmEvents() {
    els.dmStartForm?.addEventListener('submit', startConversation);
    els.dmCreateGroupForm?.addEventListener('submit', createGroup);
    els.dmSendForm?.addEventListener('submit', sendMessage);
    els.dmSearchForm?.addEventListener('submit', runSearch);
    els.dmLoadOlder?.addEventListener('click', () => {
      loadOlderMessages().catch((error) => showToast(error.message || 'Lỗi tải tin cũ.'));
    });
    els.dmImageInput?.addEventListener('change', (event) => {
      handleImagePicked(event).catch((error) => showToast(error.message || 'Lỗi ảnh.'));
    });
    els.dmMessageBody?.addEventListener('input', () => {
      signalTyping().catch(() => {});
    });
    bindDmClickDelegation(els, handleDmClick);
  }

  return {
    bindDmEvents,
    loadMessagesScreen,
    updateDmNavVisibility,
    refreshUnreadCount,
    handleIncomingDmEvent,
    openConversation,
    getActiveConversationId: () => activeConversationId
  };
}
