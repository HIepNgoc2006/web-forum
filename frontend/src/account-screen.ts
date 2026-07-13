import { normalizeWatchedSort } from './storage';
import { type AnyRecord } from './types';

export function createAccountScreenController({
  state,
  els,
  accountSettingsFromLocal,
  syncAccountBoardSubscriptionOptions,
  updateCapcodeOptions,
  updateAccountDisplayOptions,
  localDisplayPreferences,
  localNotificationPreferences,
  syncBrowserNotificationControls,
  renderPasskeys,
  renderAccountPrivateData,
  renderAccountRecoveryPanel,
  adminUsernameFromToken,
  render2FAState
}: {
  state: AnyRecord;
  els: AnyRecord;
  accountSettingsFromLocal: () => AnyRecord;
  syncAccountBoardSubscriptionOptions: (settings?: AnyRecord) => void;
  updateCapcodeOptions: () => void;
  updateAccountDisplayOptions: () => void;
  localDisplayPreferences: () => AnyRecord;
  localNotificationPreferences: () => AnyRecord;
  syncBrowserNotificationControls: (preferences: AnyRecord) => void;
  renderPasskeys: () => void;
  renderAccountPrivateData: () => void;
  renderAccountRecoveryPanel: () => void;
  adminUsernameFromToken: () => string;
  render2FAState?: () => void;
}): AnyRecord {
  function syncNotificationSummary() {
    if (!els.accountBrowserNotifyWatchedThreads || !els.accountNotifyWatchedThreads || !els.accountNotifyBoardSubscriptions) {
      return;
    }
    const preferences = {
      watchedThreads: els.accountNotifyWatchedThreads.checked,
      boardSubscriptions: els.accountNotifyBoardSubscriptions.checked,
      browserWatchedThreads: els.accountBrowserNotifyWatchedThreads.checked
    };
    syncBrowserNotificationControls(preferences);
  }

  function fillAccountSettings(account = state.account) {
    const settings = account?.settings || accountSettingsFromLocal();
    const displayPreferences = settings.displayPreferences || localDisplayPreferences();
    const notificationPreferences = settings.notificationPreferences || {
      ...localNotificationPreferences(),
      email: Boolean(settings.emailNotifications)
    };

    if (!els.accountStatus || !els.accountSettingsForm) {
      return;
    }

    els.accountStatus.textContent = account
      ? `Đang đăng nhập @${account.username}. Tài khoản không thay thế Anonymous trên bài công khai.`
      : 'Chưa đăng nhập. Cài đặt bên dưới chỉ lưu trên trình duyệt này.';

    els.accountSettingsForm.classList.remove('hidden');
    els.accountLoggedOut.classList.toggle('hidden', Boolean(account));
    els.accountSettingsLogout.classList.toggle('hidden', !account);
    els.accountTheme.value = settings.theme || state.theme || 'yotsuba-b';
    els.accountHomeBoard.value = settings.homeBoard || state.boardSlug || 'confession';
    els.accountSyncDrafts.checked = settings.syncDrafts !== false;
    els.accountCompactThreads.checked = Boolean(displayPreferences.compactThreads);
    els.accountHideThumbnails.checked = Boolean(displayPreferences.hideThumbnails);
    els.accountWatchedUnreadOnly.checked = Boolean(displayPreferences.watchedUnreadOnly);
    els.accountWatchedSort.value = normalizeWatchedSort(displayPreferences.watchedSort);
    els.accountEmailNotifications.checked = Boolean(notificationPreferences.email ?? settings.emailNotifications);
    els.accountNotifyWatchedThreads.checked = notificationPreferences.watchedThreads !== false;
    els.accountNotifyBoardSubscriptions.checked = Boolean(notificationPreferences.boardSubscriptions);
    syncBrowserNotificationControls(notificationPreferences);
    syncAccountBoardSubscriptionOptions(settings);
    renderAccountPrivateData();
    mountAccountPreferencesSummaryIslandFromControls(settings);

    const current2FAState = render2FAState;
    if (current2FAState) {
      current2FAState();
    }
    renderPasskeys();
    renderAccountRecoveryPanel();
  }

  function selectedOptionLabel(selectEl: HTMLSelectElement | null | undefined, fallback: string): string {
    if (!selectEl) {
      return fallback;
    }
    const option = selectEl.selectedOptions?.[0] || selectEl.options?.[selectEl.selectedIndex];
    return option?.textContent?.trim() || selectEl.value || fallback;
  }

  /** Lazy-load account React summary only when the account settings screen is filled. */
  function mountAccountPreferencesSummaryIslandFromControls(settings: AnyRecord = {}) {
    if (!document.getElementById('reactAccountPreferencesSummary')) {
      return;
    }
    void import('./react/mount-account-preferences')
      .then(({ mountAccountPreferencesSummaryIsland }) => {
        mountAccountPreferencesSummaryIsland({
          themeLabel: selectedOptionLabel(els.accountTheme, settings.theme || state.theme || 'Yotsuba B'),
          homeBoardLabel: selectedOptionLabel(
            els.accountHomeBoard,
            settings.homeBoard || state.boardSlug || 'confession'
          ),
          syncDrafts: Boolean(els.accountSyncDrafts?.checked),
          compactThreads: Boolean(els.accountCompactThreads?.checked),
          hideThumbnails: Boolean(els.accountHideThumbnails?.checked),
          watchedUnreadOnly: Boolean(els.accountWatchedUnreadOnly?.checked),
          watchedSortLabel: selectedOptionLabel(els.accountWatchedSort, 'Chưa đọc trước'),
          emailNotifications: Boolean(els.accountEmailNotifications?.checked),
          notifyWatchedThreads: Boolean(els.accountNotifyWatchedThreads?.checked),
          notifyBoardSubscriptions: Boolean(els.accountNotifyBoardSubscriptions?.checked),
          browserNotifyWatchedThreads: Boolean(els.accountBrowserNotifyWatchedThreads?.checked)
        });
      })
      .catch(() => {
        // Optional island: account form remains fully usable without React.
      });
  }

  function render2FASection() {
    if (!els.account2FADisabledSection || !els.account2FASetupSection || !els.account2FAEnabledSection) {
      return;
    }
    const loggedIn = Boolean(state.accountToken && state.account);
    const enabled = Boolean(state.account?.twoFactorEnabled);
    els.account2FADisabledSection.classList.toggle('hidden', !loggedIn || enabled);
    els.account2FASetupSection.classList.add('hidden');
    els.account2FAEnabledSection.classList.toggle('hidden', !loggedIn || !enabled);
    if (els.verify2FACode) {
      els.verify2FACode.value = '';
    }
    if (els.disable2FAPassword) {
      els.disable2FAPassword.value = '';
    }
  }

  function updateAccountNavState() {
    const loggedIn = Boolean(state.accountToken && state.account);
    const adminUsername = loggedIn ? '' : adminUsernameFromToken();
    const adminOnly = Boolean(adminUsername);
    els.accountLoginLink.classList.toggle('hidden', loggedIn || adminOnly);
    els.accountRegisterLink.classList.toggle('hidden', loggedIn || adminOnly);
    // Always show settings: anonymous users need a path to unhide posts/threads (local storage).
    els.accountSettingsLink.classList.remove('hidden');
    if (els.accountLogoutButton) {
      els.accountLogoutButton.classList.toggle('hidden', !loggedIn);
    }
    if (loggedIn) {
      els.accountSettingsLink.textContent = `@${state.account.username}`;
      els.accountSettingsLink.setAttribute('href', '#account');
    } else if (adminOnly) {
      els.accountSettingsLink.textContent = `@${adminUsername}`;
      els.accountSettingsLink.setAttribute('href', '#admin');
    } else {
      els.accountSettingsLink.textContent = 'Cài đặt';
      els.accountSettingsLink.setAttribute('href', '#account');
    }

    updateAccountDisplayOptions();
    updateCapcodeOptions();
  }

  return {
    fillAccountSettings,
    render2FASection,
    updateAccountNavState,
    syncNotificationSummary
  };
}
