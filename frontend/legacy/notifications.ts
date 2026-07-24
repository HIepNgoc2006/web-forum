import { els } from './dom';
import {
  browserNotificationPermission,
  browserNotificationStatusText,
  browserNotificationsSupported
} from './notification-runtime';
import {
  localNotificationPreferences,
  writeLocalNotificationPreferences
} from './storage';

export {
  browserNotificationPermission,
  browserNotificationsSupported,
  notifyDirectMessage,
  notifySubscribedBoardThread,
  notifyTaggedPost,
  notifyWatchedThreadPost,
  postMentionsUsername,
  rememberBrowserNotificationId,
  resolveBrowserWatchedThreadPreference
} from './notification-runtime';

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
  if (els?.accountEmailNotifyMentions) {
    els.accountEmailNotifyMentions.checked = safe.emailMentions;
  }
  if (els?.accountEmailNotifyDirectMessages) {
    els.accountEmailNotifyDirectMessages.checked = safe.emailDirectMessages;
  }
  if (els?.accountNotifyDirectMessages) {
    els.accountNotifyDirectMessages.checked = safe.directMessages !== false;
  }
  if (els?.accountBrowserNotifyDirectMessages) {
    els.accountBrowserNotifyDirectMessages.checked = Boolean(safe.browserDirectMessages);
  }
  if (els?.accountBrowserNotifyBoardSubscriptions) {
    els.accountBrowserNotifyBoardSubscriptions.checked = Boolean(safe.browserBoardSubscriptions);
  }
  if (els?.accountBrowserNotifyMentions) {
    els.accountBrowserNotifyMentions.checked = Boolean(safe.browserMentions);
  }
  syncBrowserNotificationControls(safe);
  return safe;
}

export function syncBrowserNotificationControls(preferences = localNotificationPreferences()) {
  if (
    !els?.accountBrowserNotifyWatchedThreads &&
    !els?.accountBrowserNotifyBoardSubscriptions &&
    !els?.accountBrowserNotifyMentions &&
    !els?.accountBrowserNotifyDirectMessages
  ) {
    return;
  }
  const supported = browserNotificationsSupported();
  const permission = browserNotificationPermission();
  if (els.accountBrowserNotifyWatchedThreads) {
    els.accountBrowserNotifyWatchedThreads.checked = Boolean(preferences.browserWatchedThreads);
    els.accountBrowserNotifyWatchedThreads.disabled = !supported;
  }
  if (els.accountBrowserNotifyDirectMessages) {
    els.accountBrowserNotifyDirectMessages.checked = Boolean(preferences.browserDirectMessages);
    els.accountBrowserNotifyDirectMessages.disabled = !supported;
  }
  if (els.accountBrowserNotifyBoardSubscriptions) {
    els.accountBrowserNotifyBoardSubscriptions.checked = Boolean(preferences.browserBoardSubscriptions);
    els.accountBrowserNotifyBoardSubscriptions.disabled = !supported;
  }
  if (els.accountBrowserNotifyMentions) {
    els.accountBrowserNotifyMentions.checked = Boolean(preferences.browserMentions);
    els.accountBrowserNotifyMentions.disabled = !supported;
  }
  if (els.accountBrowserNotificationsStatus) {
    els.accountBrowserNotificationsStatus.textContent = browserNotificationStatusText(
      preferences,
      supported,
      permission
    );
  }
}
