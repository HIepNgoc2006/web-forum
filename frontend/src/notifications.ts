import { els } from './dom';
import { plainPreview } from './format';
import {
  localNotificationPreferences,
  writeLocalNotificationPreferences
} from './storage';

import type { AnyRecord } from './types';

export function applyNotificationPreferences(preferences = localNotificationPreferences()) {
  const safe = writeLocalNotificationPreferences(preferences);
  if (els?.accountEmailNotifications) {
    els.accountEmailNotifications.checked = safe.email;
  }
  if (els?.accountNotifyWatchedThreads) {
    els.accountNotifyWatchedThreads.checked = safe.watchedThreads;
  }
  if (els?.accountNotifyBoardSubscriptions) {
    els.accountNotifyBoardSubscriptions.checked = safe.boardSubscriptions;
  }
  if (els?.accountNotifyDirectMessages) {
    els.accountNotifyDirectMessages.checked = safe.directMessages !== false;
  }
  if (els?.accountBrowserNotifyDirectMessages) {
    els.accountBrowserNotifyDirectMessages.checked = Boolean(safe.browserDirectMessages);
  }
  syncBrowserNotificationControls(safe);
  return safe;
}

export function browserNotificationsSupported() {
  return typeof window !== 'undefined' && typeof window.Notification !== 'undefined';
}

export function browserNotificationPermission() {
  if (!browserNotificationsSupported()) {
    return 'unsupported';
  }
  return window.Notification.permission || 'default';
}

export function syncBrowserNotificationControls(preferences = localNotificationPreferences()) {
  if (!els?.accountBrowserNotifyWatchedThreads) {
    return;
  }
  const supported = browserNotificationsSupported();
  const permission = browserNotificationPermission();
  els.accountBrowserNotifyWatchedThreads.checked = Boolean(preferences.browserWatchedThreads);
  els.accountBrowserNotifyWatchedThreads.disabled = !supported;
  if (els.accountBrowserNotifyDirectMessages) {
    els.accountBrowserNotifyDirectMessages.checked = Boolean(preferences.browserDirectMessages);
    els.accountBrowserNotifyDirectMessages.disabled = !supported;
  }
  if (!els.accountBrowserNotificationsStatus) {
    return;
  }
  if (!supported) {
    els.accountBrowserNotificationsStatus.textContent = 'Trình duyệt này không hỗ trợ browser notifications.';
  } else if (permission === 'denied') {
    els.accountBrowserNotificationsStatus.textContent = 'Trình duyệt đang chặn browser notifications cho trang này.';
  } else if (permission === 'granted' && (preferences.browserWatchedThreads || preferences.browserDirectMessages)) {
    els.accountBrowserNotificationsStatus.textContent = 'Browser notifications đang bật (thread / tin nhắn riêng).';
  } else if (permission === 'granted') {
    els.accountBrowserNotificationsStatus.textContent = 'Đã cấp quyền browser notification; tùy chọn đang tắt.';
  } else if (preferences.browserWatchedThreads || preferences.browserDirectMessages) {
    els.accountBrowserNotificationsStatus.textContent = 'Cần cấp quyền browser notification khi lưu settings.';
  } else {
    els.accountBrowserNotificationsStatus.textContent = 'Tắt browser notifications cho thread / tin nhắn riêng.';
  }
}

export async function resolveBrowserWatchedThreadPreference(requested, showToast) {
  if (!requested) {
    return false;
  }
  if (!browserNotificationsSupported()) {
    showToast('Trình duyệt này không hỗ trợ browser notifications.');
    return false;
  }
  const permission = browserNotificationPermission();
  if (permission === 'granted') {
    return true;
  }
  if (permission === 'denied') {
    showToast('Browser notifications đang bị chặn trong trình duyệt.');
    return false;
  }
  if (typeof window.Notification.requestPermission !== 'function') {
    showToast('Không thể xin quyền browser notification trên trình duyệt này.');
    return false;
  }
  try {
    const result = await window.Notification.requestPermission();
    if (result === 'granted') {
      return true;
    }
    showToast(result === 'denied' ? 'Browser notifications đã bị từ chối.' : 'Chưa cấp quyền browser notification.');
    return false;
  } catch {
    showToast('Không thể xin quyền browser notification.');
    return false;
  }
}

export function rememberBrowserNotificationId(browserNotificationIds, id) {
  browserNotificationIds.add(id);
  if (browserNotificationIds.size <= 100) {
    return;
  }
  const oldest = browserNotificationIds.values().next().value;
  if (oldest) {
    browserNotificationIds.delete(oldest);
  }
}

export function notifyWatchedThreadPost(payload: AnyRecord = {}, dependencies: AnyRecord = {}) {
  const preferences = localNotificationPreferences();
  if (!preferences.browserWatchedThreads || !browserNotificationsSupported() || browserNotificationPermission() !== 'granted') {
    return;
  }
  const comment = payload.comment && typeof payload.comment === 'object' ? payload.comment : {};
  const threadId = String(payload.threadId || comment.threadId || '');
  if (!threadId) {
    return;
  }
  const watchedThreads = dependencies.readWatchedThreads();
  const watched = watchedThreads[threadId];
  if (!watched) {
    return;
  }
  const globalNumber = Number(comment.globalNumber || 0);
  if (Number.isFinite(globalNumber) && globalNumber <= Number(watched.lastSeen || 0)) {
    return;
  }
  const notificationId = `${threadId}:${comment.id || comment.globalNumber || comment.createdAt || Date.now()}`;
  if (dependencies.browserNotificationIds.has(notificationId)) {
    return;
  }
  rememberBrowserNotificationId(dependencies.browserNotificationIds, notificationId);

  watchedThreads[threadId] = {
    ...watched,
    maxNumber: Math.max(Number(watched.maxNumber || 0), globalNumber || 0),
    replyCount: Math.max(Number(watched.replyCount || 0), Number(watched.replyCount || 0) + 1),
    updatedAt: comment.createdAt || new Date().toISOString()
  };
  dependencies.writeWatchedThreads(watchedThreads);

  const boardLabel = watched.boardPath || (watched.boardSlug ? `/${watched.boardSlug}/` : '36chan');
  const title = `${boardLabel} No.${watched.globalNumber || '?'}`;
  const body = plainPreview(comment.bodyLines || [], 'Có bài mới trong thread đang theo dõi.').slice(0, 140);
  const notification = new window.Notification(title, {
    body,
    tag: `watched-thread-${threadId}`,
    data: { threadId, globalNumber }
  });
  notification.onclick = () => {
    window.focus();
    window.location.hash = `#thread/${encodeURIComponent(threadId)}${globalNumber ? `?p=${encodeURIComponent(globalNumber)}` : ''}`;
    notification.close?.();
  };
}

export function notifyDirectMessage(payload: AnyRecord = {}, dependencies: AnyRecord = {}) {
  const preferences = localNotificationPreferences();
  const senderUsername = String(payload.senderUsername || 'ai đó');
  const conversationId = String(payload.conversationId || '');
  const messageId = String(payload.messageId || `${conversationId}:${payload.createdAt || Date.now()}`);

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
  if (dependencies.browserNotificationIds?.has?.(messageId)) {
    return;
  }
  if (dependencies.browserNotificationIds) {
    rememberBrowserNotificationId(dependencies.browserNotificationIds, messageId);
  }
  const notification = new window.Notification(`Tin nhắn từ @${senderUsername}`, {
    body: 'Bạn có tin nhắn riêng mới (nội dung đã mã hóa).',
    tag: `dm-${conversationId || messageId}`,
    data: { conversationId, messageId }
  });
  notification.onclick = () => {
    window.focus();
    window.location.hash = conversationId
      ? `#messages/${encodeURIComponent(conversationId)}`
      : '#messages';
    notification.close?.();
  };
}
