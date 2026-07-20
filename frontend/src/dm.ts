import { els } from './dom';
import { escapeHtml } from './format';
import { state } from './state';

import type { AnyRecord } from './types';

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

export function createDmController(dependencies: AnyRecord) {
  const {
    api,
    showToast,
    setButtonLoading,
    setScreen,
    browserNotificationIds = new Set()
  } = dependencies;

  let activeConversationId = '';
  let conversations: AnyRecord[] = [];
  let messages: AnyRecord[] = [];
  let unreadCount = 0;
  let loadRequestId = 0;

  function isLoggedIn() {
    return Boolean(state.accountToken && state.account?.id);
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
    if (!loggedIn) {
      updateUnreadUi(0);
      activeConversationId = '';
      conversations = [];
      messages = [];
    }
  }

  function renderConversationList() {
    if (!els.dmConversationList) {
      return;
    }
    if (!conversations.length) {
      els.dmConversationList.innerHTML = '<p class="muted dm-empty-list">Chưa có hội thoại.</p>';
      return;
    }
    els.dmConversationList.innerHTML = conversations
      .map((conversation) => {
        const peerName = conversation.peer?.username || 'không rõ';
        const preview = String(conversation.lastMessagePreview || 'Chưa có tin nhắn').slice(0, 80);
        const active = conversation.id === activeConversationId ? ' is-active' : '';
        const unread = Number(conversation.unreadCount || 0);
        return `<button type="button" class="dm-conversation-item${active}" data-dm-conversation="${escapeHtml(conversation.id)}" role="listitem">
          <span class="dm-conversation-name">@${escapeHtml(peerName)}${unread > 0 ? ` <span class="dm-item-unread">${unread}</span>` : ''}</span>
          <span class="dm-conversation-preview">${escapeHtml(preview)}</span>
          <span class="dm-conversation-time muted">${escapeHtml(formatDmTime(conversation.lastMessageAt || conversation.updatedAt || ''))}</span>
        </button>`;
      })
      .join('');
  }

  function renderMessages() {
    if (!els.dmMessageList) {
      return;
    }
    const myId = String(state.account?.id || '');
    if (!messages.length) {
      els.dmMessageList.innerHTML = '<p class="muted">Chưa có tin nhắn. Hãy gửi lời chào.</p>';
      return;
    }
    els.dmMessageList.innerHTML = messages
      .map((message) => {
        const mine = String(message.senderId) === myId;
        return `<article class="dm-message ${mine ? 'is-mine' : 'is-peer'}">
          <div class="dm-message-body">${escapeHtml(message.body || '')}</div>
          <div class="dm-message-meta muted">${escapeHtml(formatDmTime(message.createdAt || ''))}</div>
        </article>`;
      })
      .join('');
    els.dmMessageList.scrollTop = els.dmMessageList.scrollHeight;
  }

  function showThread(conversation: AnyRecord | null) {
    const hasThread = Boolean(conversation?.id);
    els.dmEmptyState?.classList.toggle('hidden', hasThread);
    els.dmThread?.classList.toggle('hidden', !hasThread);
    if (!hasThread) {
      activeConversationId = '';
      messages = [];
      if (els.dmThreadTitle) {
        els.dmThreadTitle.textContent = 'Chat';
      }
      if (els.dmThreadMeta) {
        els.dmThreadMeta.textContent = '';
      }
      renderMessages();
      return;
    }
    activeConversationId = conversation.id;
    const peer = conversation.peer?.username || 'user';
    const role = conversation.peer?.role && conversation.peer.role !== 'user'
      ? ` · ${conversation.peer.role}`
      : '';
    if (els.dmThreadTitle) {
      els.dmThreadTitle.textContent = `@${peer}`;
    }
    if (els.dmThreadMeta) {
      els.dmThreadMeta.textContent = `Tin nhắn mã hóa AES-256-GCM${role}`;
    }
  }

  async function refreshUnreadCount() {
    if (!isLoggedIn()) {
      updateUnreadUi(0);
      return 0;
    }
    try {
      const result = await api('/api/dm/unread-count', { auth: 'account' });
      updateUnreadUi(result.unreadCount || 0);
      return Number(result.unreadCount || 0);
    } catch {
      return unreadCount;
    }
  }

  async function loadConversations({ preserveActive = true } = {}) {
    if (!isLoggedIn()) {
      return [];
    }
    const result = await api('/api/dm/conversations', { auth: 'account' });
    conversations = Array.isArray(result.conversations) ? result.conversations : [];
    if (preserveActive && activeConversationId) {
      const stillThere = conversations.some((item) => item.id === activeConversationId);
      if (!stillThere) {
        activeConversationId = '';
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
    const requestId = ++loadRequestId;
    const result = await api(
      `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`,
      { auth: 'account' }
    );
    if (requestId !== loadRequestId) {
      return null;
    }
    messages = Array.isArray(result.messages) ? result.messages : [];
    const conversation = result.conversation || conversations.find((item) => item.id === conversationId) || null;
    showThread(conversation);
    renderMessages();
    await api(`/api/dm/conversations/${encodeURIComponent(conversationId)}/read`, {
      auth: 'account',
      method: 'POST',
      body: '{}'
    }).catch(() => null);
    await loadConversations({ preserveActive: true });
    if (conversation) {
      const idx = conversations.findIndex((item) => item.id === conversationId);
      if (idx >= 0) {
        conversations[idx] = { ...conversations[idx], ...conversation, unreadCount: 0 };
        renderConversationList();
      }
    }
    window.location.hash = `#messages/${encodeURIComponent(conversationId)}`;
    return result;
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
    setFormError(els.dmStartError);
    setFormError(els.dmSendError);
    try {
      await loadConversations({ preserveActive: true });
      const targetId = conversationId || activeConversationId;
      if (targetId) {
        await openConversation(targetId);
      } else {
        showThread(null);
      }
    } catch (error) {
      showToast(error.message || 'Không tải được tin nhắn.');
    }
  }

  async function startConversation(event: Event) {
    event.preventDefault();
    if (!isLoggedIn()) {
      window.location.hash = '#login';
      return;
    }
    setFormError(els.dmStartError);
    // Strip leading @ so "@example" matches account username "example".
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
      if (els.dmPeerUsername) {
        els.dmPeerUsername.value = '';
      }
      await loadConversations({ preserveActive: false });
      if (result.conversation?.id) {
        await openConversation(result.conversation.id);
      }
    } catch (error) {
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
    setFormError(els.dmSendError);
    const body = String(els.dmMessageBody?.value || '').trim();
    if (!body) {
      setFormError(els.dmSendError, 'Tin nhắn trống.');
      return;
    }
    const button = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    const restore = setButtonLoading?.(button, 'Đang gửi...') || (() => {});
    try {
      const result = await api(
        `/api/dm/conversations/${encodeURIComponent(activeConversationId)}/messages`,
        {
          auth: 'account',
          method: 'POST',
          body: JSON.stringify({ body })
        }
      );
      if (els.dmMessageBody) {
        els.dmMessageBody.value = '';
      }
      if (result.message) {
        messages = [...messages, result.message];
        renderMessages();
      }
      if (result.conversation) {
        const idx = conversations.findIndex((item) => item.id === activeConversationId);
        if (idx >= 0) {
          conversations[idx] = { ...conversations[idx], ...result.conversation, unreadCount: 0 };
        } else {
          conversations = [result.conversation, ...conversations];
        }
        conversations.sort((left, right) =>
          String(right.lastMessageAt || '').localeCompare(String(left.lastMessageAt || ''))
        );
        renderConversationList();
      }
    } catch (error) {
      setFormError(els.dmSendError, error.message || 'Gửi thất bại.');
    } finally {
      restore();
    }
  }

  function handleDmClick(event: Event) {
    const target = event.target as HTMLElement | null;
    const button = target?.closest?.('[data-dm-conversation]') as HTMLElement | null;
    if (!button) {
      return false;
    }
    const conversationId = button.getAttribute('data-dm-conversation') || '';
    if (!conversationId) {
      return false;
    }
    openConversation(conversationId).catch((error) => showToast(error.message || 'Lỗi mở chat.'));
    return true;
  }

  async function handleIncomingDmEvent(payload: AnyRecord = {}) {
    if (!isLoggedIn()) {
      return;
    }
    const myId = String(state.account?.id || '');
    const participantIds = Array.isArray(payload.participantIds)
      ? payload.participantIds.map(String)
      : [];
    if (!participantIds.includes(myId)) {
      return;
    }
    const senderId = String(payload.senderId || '');
    if (senderId && senderId === myId) {
      return;
    }

    const conversationId = String(payload.conversationId || '');
    const hash = window.location.hash || '';
    const viewing =
      hash.startsWith('#messages') &&
      conversationId &&
      (activeConversationId === conversationId || hash.includes(conversationId));

    if (viewing && conversationId) {
      await openConversation(conversationId);
      return;
    }

    await refreshUnreadCount();
    if (hash.startsWith('#messages')) {
      await loadConversations({ preserveActive: true });
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

  function bindDmEvents() {
    els.dmStartForm?.addEventListener('submit', startConversation);
    els.dmSendForm?.addEventListener('submit', sendMessage);
    els.dmConversationList?.addEventListener('click', (event) => {
      handleDmClick(event);
    });
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
