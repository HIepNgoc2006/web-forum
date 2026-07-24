import type { AnyRecord } from './types';

function localNotificationPreferences() {
  let value: AnyRecord = {};
  try {
    const parsed = JSON.parse(localStorage.getItem('notificationPreferences') || '');
    value = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    value = {};
  }
  return {
    email: Boolean(value.email),
    watchedThreads: value.watchedThreads !== false,
    boardSubscriptions: Boolean(value.boardSubscriptions),
    browserWatchedThreads: Boolean(value.browserWatchedThreads),
    browserBoardSubscriptions: Boolean(value.browserBoardSubscriptions),
    browserMentions: Boolean(value.browserMentions),
    emailMentions: Boolean(value.emailMentions),
    emailDirectMessages: Boolean(value.emailDirectMessages),
    directMessages: value.directMessages !== false,
    browserDirectMessages: Boolean(value.browserDirectMessages)
  };
}

function notificationPreview(lines: AnyRecord[] = [], fallback = '') {
  const text = lines
    .map((line) => String(line?.text || ''))
    .join(' ')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
    .replace(/\[\/?(?:spoiler|b|i|u|s|code|icode|quote|h[123]|left|center|right|justify|indent|list(?:=1)?|table|tr|th|td|\*|hr)\]/gi, '')
    .replace(/\[(?:size|color|font)=[^\]]+\]/gi, '')
    .replace(/\[\/(?:size|color|font)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
}

export function browserNotificationsSupported() {
  return typeof window !== 'undefined' && typeof window.Notification === 'function';
}

export function browserNotificationPermission() {
  if (!browserNotificationsSupported()) {
    return 'unsupported';
  }
  return window.Notification.permission || 'default';
}

export function browserNotificationStatusText(
  preferences: AnyRecord = {},
  supported = browserNotificationsSupported(),
  permission = browserNotificationPermission()
) {
  const enabled = Boolean(
    preferences.browserWatchedThreads ||
    preferences.browserBoardSubscriptions ||
    preferences.browserMentions ||
    preferences.browserDirectMessages
  );
  if (!supported) {
    return 'Trình duyệt này không hỗ trợ thông báo trình duyệt.';
  }
  if (permission === 'denied') {
    return 'Trình duyệt đang chặn thông báo của trang này.';
  }
  if (permission === 'granted' && enabled) {
    return 'Thông báo trình duyệt đang bật (bảng / chủ đề / lượt nhắc / tin nhắn riêng).';
  }
  if (permission === 'granted') {
    return 'Đã cấp quyền thông báo trình duyệt; các tùy chọn đang tắt.';
  }
  if (enabled) {
    return 'Cần cấp quyền thông báo trình duyệt khi lưu cài đặt.';
  }
  return 'Tắt thông báo trình duyệt cho chủ đề / tin nhắn riêng.';
}

function showPermissionToast(showToast, message: string) {
  if (typeof showToast === 'function') {
    showToast(message);
  }
}

export async function resolveBrowserWatchedThreadPreference(requested, showToast) {
  if (!requested) {
    return false;
  }
  if (!browserNotificationsSupported()) {
    showPermissionToast(showToast, 'Trình duyệt này không hỗ trợ thông báo trình duyệt.');
    return false;
  }
  const permission = browserNotificationPermission();
  if (permission === 'granted') {
    return true;
  }
  if (permission === 'denied') {
    showPermissionToast(showToast, 'Thông báo đang bị chặn trong trình duyệt.');
    return false;
  }
  if (typeof window.Notification.requestPermission !== 'function') {
    showPermissionToast(showToast, 'Không thể xin quyền thông báo trên trình duyệt này.');
    return false;
  }
  try {
    const result = await window.Notification.requestPermission();
    if (result === 'granted') {
      return true;
    }
    showPermissionToast(
      showToast,
      result === 'denied'
        ? 'Quyền thông báo đã bị từ chối.'
        : 'Chưa cấp quyền thông báo trình duyệt.'
    );
    return false;
  } catch {
    showPermissionToast(showToast, 'Không thể xin quyền thông báo trình duyệt.');
    return false;
  }
}

export function rememberBrowserNotificationId(browserNotificationIds, id) {
  if (!browserNotificationIds?.add || !id) {
    return;
  }
  browserNotificationIds.add(id);
  if (browserNotificationIds.size <= 100) {
    return;
  }
  const oldest = browserNotificationIds.values().next().value;
  if (oldest !== undefined) {
    browserNotificationIds.delete(oldest);
  }
}

function notificationAlreadyHandled(browserNotificationIds, id: string) {
  return Boolean(browserNotificationIds?.has?.(id));
}

function nonnegativeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function reportNotificationFailure(dependencies: AnyRecord, error: unknown) {
  dependencies.onNotificationError?.(error);
}

function postFromNotificationPayload(payload: AnyRecord = {}) {
  if (payload.comment && typeof payload.comment === 'object') {
    return payload.comment;
  }
  if (payload.thread && typeof payload.thread === 'object') {
    return payload.thread;
  }
  return {};
}

function notificationPostThreadId(payload: AnyRecord, post: AnyRecord) {
  return String(payload.threadId || post.threadId || post.id || '').trim();
}

export function postMentionsUsername(post: AnyRecord = {}, username: unknown = '') {
  const safeUsername = String(username || '').normalize('NFKC').toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(safeUsername)) {
    return false;
  }
  const escapedUsername = safeUsername.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const text = (Array.isArray(post.bodyLines) ? post.bodyLines : [])
    .map((line) => String(line?.text || ''))
    .join(' ')
    .normalize('NFKC');
  return new RegExp(
    `(^|[^a-z0-9._-])@${escapedUsername}(?![a-z0-9._-])`,
    'i'
  ).test(text);
}

export function notifyTaggedPost(payload: AnyRecord = {}, dependencies: AnyRecord = {}) {
  const preferences = localNotificationPreferences();
  const post = postFromNotificationPayload(payload);
  const threadId = notificationPostThreadId(payload, post);
  const globalNumber = Number(post.globalNumber);
  if (
    !preferences.browserMentions ||
    !threadId ||
    !Number.isSafeInteger(globalNumber) ||
    globalNumber <= 0 ||
    !postMentionsUsername(post, dependencies.accountUsername) ||
    dependencies.isOwnPost?.(post) ||
    dependencies.isViewingThread?.(threadId) ||
    !browserNotificationsSupported() ||
    browserNotificationPermission() !== 'granted'
  ) {
    return false;
  }

  const postId = String(post.id || globalNumber);
  const notificationId = `mention:${postId}`;
  if (notificationAlreadyHandled(dependencies.browserNotificationIds, notificationId)) {
    return true;
  }
  rememberBrowserNotificationId(dependencies.browserNotificationIds, notificationId);

  const boardSlug = String(post.boardSlug || '').trim();
  const boardLabel = boardSlug ? `/${boardSlug}/` : '36chan';
  try {
    const notification = new window.Notification(`Bạn được nhắc đến trên ${boardLabel}`, {
      body: notificationPreview(post.bodyLines || [], 'Có người nhắc đến bạn trong một bài viết.').slice(0, 140),
      tag: `mention-${postId}`,
      data: { threadId, globalNumber, kind: 'mention' }
    });
    notification.onclick = () => {
      window.focus();
      window.location.hash = `#thread/${encodeURIComponent(threadId)}?p=${encodeURIComponent(globalNumber)}`;
      notification.close?.();
    };
    return true;
  } catch (error) {
    reportNotificationFailure(dependencies, error);
    return false;
  }
}

export function notifySubscribedBoardThread(payload: AnyRecord = {}, dependencies: AnyRecord = {}) {
  const preferences = localNotificationPreferences();
  const thread = payload.thread && typeof payload.thread === 'object' ? payload.thread : {};
  const threadId = String(thread.id || '').trim();
  const boardSlug = String(thread.boardSlug || '').trim();
  if (
    !preferences.browserBoardSubscriptions ||
    !threadId ||
    !boardSlug ||
    !dependencies.isBoardSubscribed?.(boardSlug) ||
    dependencies.isOwnPost?.(thread) ||
    dependencies.isViewingBoard?.(boardSlug) ||
    dependencies.suppressBrowserNotification ||
    !browserNotificationsSupported() ||
    browserNotificationPermission() !== 'granted'
  ) {
    return false;
  }

  const notificationId = `board:${threadId}`;
  if (notificationAlreadyHandled(dependencies.browserNotificationIds, notificationId)) {
    return true;
  }
  rememberBrowserNotificationId(dependencies.browserNotificationIds, notificationId);

  try {
    const notification = new window.Notification(`/${boardSlug}/ · Chủ đề mới`, {
      body: String(thread.subject || '').trim() ||
        notificationPreview(thread.bodyLines || [], 'Có chủ đề mới trong bảng đang theo dõi.').slice(0, 140),
      tag: `subscribed-board-${boardSlug}`,
      data: { threadId, boardSlug, kind: 'board' }
    });
    notification.onclick = () => {
      window.focus();
      window.location.hash = `#thread/${encodeURIComponent(threadId)}`;
      notification.close?.();
    };
    return true;
  } catch (error) {
    reportNotificationFailure(dependencies, error);
    return false;
  }
}

export function notifyWatchedThreadPost(payload: AnyRecord = {}, dependencies: AnyRecord = {}) {
  const comment = payload.comment && typeof payload.comment === 'object' ? payload.comment : {};
  const threadId = String(payload.threadId || comment.threadId || '').trim();
  const globalNumber = Number(comment.globalNumber);
  if (!threadId || !Number.isSafeInteger(globalNumber) || globalNumber <= 0) {
    return;
  }
  if (typeof dependencies.readWatchedThreads !== 'function') {
    return;
  }
  const watchedThreads = dependencies.readWatchedThreads();
  const watched = watchedThreads?.[threadId];
  if (!watched || typeof watched !== 'object') {
    return;
  }

  const knownMaxNumber = Math.max(
    nonnegativeNumber(watched.lastSeen),
    nonnegativeNumber(watched.maxNumber)
  );
  if (globalNumber <= knownMaxNumber) {
    return;
  }
  const notificationId = `thread:${threadId}:${String(comment.id || globalNumber)}`;
  if (notificationAlreadyHandled(dependencies.browserNotificationIds, notificationId)) {
    return;
  }
  rememberBrowserNotificationId(dependencies.browserNotificationIds, notificationId);

  watchedThreads[threadId] = {
    ...watched,
    maxNumber: globalNumber,
    replyCount: nonnegativeNumber(watched.replyCount) + 1,
    updatedAt: comment.createdAt || new Date().toISOString()
  };
  dependencies.writeWatchedThreads?.(watchedThreads);

  const preferences = localNotificationPreferences();
  if (
    !preferences.browserWatchedThreads ||
    dependencies.suppressBrowserNotification ||
    dependencies.isOwnPost?.(comment) ||
    dependencies.isViewingThread?.(threadId) ||
    !browserNotificationsSupported() ||
    browserNotificationPermission() !== 'granted'
  ) {
    return;
  }

  const boardLabel = watched.boardPath || (watched.boardSlug ? `/${watched.boardSlug}/` : '36chan');
  const title = `${boardLabel} No.${watched.globalNumber || '?'}`;
  const body = notificationPreview(
    comment.bodyLines || [],
    'Có bài mới trong chủ đề đang theo dõi.'
  ).slice(0, 140);
  try {
    const notification = new window.Notification(title, {
      body,
      tag: `watched-thread-${threadId}`,
      data: { threadId, globalNumber, kind: 'thread' }
    });
    notification.onclick = () => {
      window.focus();
      window.location.hash = `#thread/${encodeURIComponent(threadId)}?p=${encodeURIComponent(globalNumber)}`;
      notification.close?.();
    };
  } catch (error) {
    reportNotificationFailure(dependencies, error);
  }
}

export function notifyDirectMessage(payload: AnyRecord = {}, dependencies: AnyRecord = {}) {
  const conversationId = String(payload.conversationId || '').trim();
  const createdAt = String(payload.createdAt || '').trim();
  const rawMessageId = String(payload.messageId || '').trim();
  const messageId = rawMessageId || (conversationId && createdAt ? `${conversationId}:${createdAt}` : '');
  if (!conversationId || !messageId) {
    return;
  }

  const notificationId = `dm:${messageId}`;
  if (notificationAlreadyHandled(dependencies.browserNotificationIds, notificationId)) {
    return;
  }
  rememberBrowserNotificationId(dependencies.browserNotificationIds, notificationId);

  const preferences = localNotificationPreferences();
  const senderUsername = String(payload.senderUsername || 'ai đó');
  if (preferences.directMessages !== false && typeof dependencies.showToast === 'function') {
    dependencies.showToast(`Tin nhắn mới từ @${senderUsername}`, {
      durationMs: 5000,
      tone: 'neutral'
    });
  }

  if (
    !preferences.browserDirectMessages ||
    !browserNotificationsSupported() ||
    browserNotificationPermission() !== 'granted'
  ) {
    return;
  }
  try {
    const notification = new window.Notification(`Tin nhắn từ @${senderUsername}`, {
      body: 'Bạn có tin nhắn riêng mới (nội dung đã mã hóa).',
      tag: `dm-${conversationId}`,
      data: { conversationId, messageId, kind: 'message' }
    });
    notification.onclick = () => {
      window.focus();
      window.location.hash = `#messages/${encodeURIComponent(conversationId)}`;
      notification.close?.();
    };
  } catch (error) {
    reportNotificationFailure(dependencies, error);
  }
}
