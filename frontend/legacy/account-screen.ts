import { normalizeCommentComposerMode, normalizeFontSize, normalizeWatchedSort } from './storage';
import { accountEmailNotificationState } from './account-settings-availability';
import { type AnyRecord } from './types';

export function createAccountScreenController({
  state,
  els,
  accountSettingsFromLocal,
  syncAccountBoardSubscriptionOptions,
  syncAccountHiddenBoardOptions,
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
  syncAccountHiddenBoardOptions?: (settings?: AnyRecord) => void;
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
      browserWatchedThreads: els.accountBrowserNotifyWatchedThreads.checked,
      browserBoardSubscriptions: Boolean(els.accountBrowserNotifyBoardSubscriptions?.checked),
      browserMentions: Boolean(els.accountBrowserNotifyMentions?.checked),
      browserDirectMessages: Boolean(els.accountBrowserNotifyDirectMessages?.checked)
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

    const loggedIn = Boolean(state.accountToken && account);
    els.accountStatus.textContent = loggedIn
      ? `Đang đăng nhập @${account.username}. Tên tài khoản không thay thế tên Ẩn danh trên bài viết công khai.`
      : 'Chưa đăng nhập. Cài đặt bên dưới chỉ lưu trên trình duyệt này.';

    els.accountSettingsForm.classList.remove('hidden');
    els.accountLoggedOut.classList.toggle('hidden', loggedIn);
    els.accountSettingsLogout.classList.toggle('hidden', !loggedIn);
    els.accountTheme.value = settings.theme || state.theme || 'yotsuba-b';
    if (els.accountFontSize) {
      els.accountFontSize.value = normalizeFontSize(displayPreferences.fontSize);
    }
    els.accountHomeBoard.value = settings.homeBoard || state.boardSlug || 'confession';
    els.accountSyncDrafts.checked = settings.syncDrafts !== false;
    els.accountCompactThreads.checked = Boolean(displayPreferences.compactThreads);
    els.accountHideThumbnails.checked = Boolean(displayPreferences.hideThumbnails);
    els.accountWatchedUnreadOnly.checked = Boolean(displayPreferences.watchedUnreadOnly);
    els.accountWatchedSort.value = normalizeWatchedSort(displayPreferences.watchedSort);
    els.accountCommentComposerMode.value = normalizeCommentComposerMode(displayPreferences.commentComposerMode);
    const emailNotification = accountEmailNotificationState({
      loggedIn,
      emailVerified: Boolean(account?.emailVerified),
      requested: Boolean(notificationPreferences.email ?? settings.emailNotifications),
      email: account?.email || '',
    });
    els.accountEmailNotifications.checked = emailNotification.checked;
    els.accountEmailNotifications.disabled = emailNotification.disabled;
    if (els.accountEmailNotifyMentions) {
      els.accountEmailNotifyMentions.checked = Boolean(notificationPreferences.emailMentions);
      els.accountEmailNotifyMentions.disabled = emailNotification.disabled;
    }
    if (els.accountEmailNotifyDirectMessages) {
      els.accountEmailNotifyDirectMessages.checked = Boolean(notificationPreferences.emailDirectMessages);
      els.accountEmailNotifyDirectMessages.disabled = emailNotification.disabled;
    }
    if (els.accountEmailNotificationStatus) {
      els.accountEmailNotificationStatus.textContent = emailNotification.statusText;
    }
    els.accountNotifyWatchedThreads.checked = notificationPreferences.watchedThreads !== false;
    els.accountNotifyBoardSubscriptions.checked = Boolean(notificationPreferences.boardSubscriptions);
    if (els.accountNotifyDirectMessages) {
      els.accountNotifyDirectMessages.checked = notificationPreferences.directMessages !== false;
    }
    if (els.accountBrowserNotifyDirectMessages) {
      els.accountBrowserNotifyDirectMessages.checked = Boolean(notificationPreferences.browserDirectMessages);
    }
    if (els.accountBrowserNotifyBoardSubscriptions) {
      els.accountBrowserNotifyBoardSubscriptions.checked = Boolean(notificationPreferences.browserBoardSubscriptions);
    }
    if (els.accountBrowserNotifyMentions) {
      els.accountBrowserNotifyMentions.checked = Boolean(notificationPreferences.browserMentions);
    }
    syncBrowserNotificationControls(notificationPreferences);
    syncAccountBoardSubscriptionOptions(settings);
    syncAccountHiddenBoardOptions?.(settings);
    renderAccountPrivateData();
    mountAccountPreferencesSummaryIslandFromControls(settings);

    const current2FAState = render2FAState;
    if (current2FAState) {
      current2FAState();
    }
    renderPasskeys();
    renderAccountEmailPanel(account);
    renderAccountRecoveryPanel();
  }

  function renderAccountEmailPanel(account = state.account) {
    if (!els.accountEmailPanel) {
      return;
    }
    const loggedIn = Boolean(state.accountToken && account);
    els.accountEmailPanel.classList.toggle('hidden', !loggedIn);
    if (!loggedIn) {
      return;
    }
    const verified = Boolean(account.emailVerified);
    const pendingEmail = account.pendingEmail || '';
    els.accountEmailStatus.textContent = verified
      ? `Đã xác nhận: ${account.email}`
      : account.email
        ? `Chưa xác nhận: ${account.email}. Mã OTP có hiệu lực 15 phút.`
        : 'Tài khoản chưa có email. Thêm email để dùng khôi phục và thông báo.';
    els.accountEmailVerifyForm.classList.toggle('hidden', verified || !account.email);
    els.accountEmailChangeConfirmForm.classList.toggle('hidden', !pendingEmail);
    if (pendingEmail) {
      els.accountEmailNewEmail.value = pendingEmail;
    }
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
          fontSizeLabel: selectedOptionLabel(els.accountFontSize, 'Vừa (mặc định)'),
          homeBoardLabel: selectedOptionLabel(
            els.accountHomeBoard,
            settings.homeBoard || state.boardSlug || 'confession'
          ),
          syncDrafts: Boolean(els.accountSyncDrafts?.checked),
          compactThreads: Boolean(els.accountCompactThreads?.checked),
          hideThumbnails: Boolean(els.accountHideThumbnails?.checked),
          watchedUnreadOnly: Boolean(els.accountWatchedUnreadOnly?.checked),
          watchedSortLabel: selectedOptionLabel(els.accountWatchedSort, 'Chưa đọc trước'),
          commentComposerModeLabel: selectedOptionLabel(els.accountCommentComposerMode, 'Cửa sổ nổi'),
          emailNotifications: Boolean(els.accountEmailNotifications?.checked),
          emailNotifyMentions: Boolean(els.accountEmailNotifyMentions?.checked),
          emailNotifyDirectMessages: Boolean(els.accountEmailNotifyDirectMessages?.checked),
          notifyWatchedThreads: Boolean(els.accountNotifyWatchedThreads?.checked),
          notifyBoardSubscriptions: Boolean(els.accountNotifyBoardSubscriptions?.checked),
          browserNotifyWatchedThreads: Boolean(els.accountBrowserNotifyWatchedThreads?.checked),
          browserNotifyBoardSubscriptions: Boolean(els.accountBrowserNotifyBoardSubscriptions?.checked),
          browserNotifyMentions: Boolean(els.accountBrowserNotifyMentions?.checked),
          browserNotifyDirectMessages: Boolean(els.accountBrowserNotifyDirectMessages?.checked)
        });
      })
      .catch(() => {
        // Optional island: account form remains fully usable without React.
      });
  }

  function render2FASection() {
    if (
      !els.accountTwoFactorPanel ||
      !els.account2FADisabledSection ||
      !els.account2FASetupSection ||
      !els.account2FAEnabledSection
    ) {
      return;
    }
    const loggedIn = Boolean(state.accountToken && state.account);
    const enabled = Boolean(state.account?.twoFactorEnabled);
    els.accountTwoFactorPanel.classList.toggle('hidden', !loggedIn);
    els.account2FADisabledSection.classList.toggle('hidden', !loggedIn || enabled);
    els.account2FASetupSection.classList.add('hidden');
    els.account2FAEnabledSection.classList.toggle('hidden', !loggedIn || !enabled);
    if (els.verify2FACode) {
      els.verify2FACode.value = '';
    }
    if (els.qrcodeImage) {
      els.qrcodeImage.removeAttribute('src');
    }
    if (els.manualSecretCode) {
      els.manualSecretCode.textContent = '';
    }
    if (els.backupCodesDisplay) {
      els.backupCodesDisplay.value = '';
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
    if (els.dmNavLink) {
      els.dmNavLink.classList.toggle('hidden', !loggedIn);
    }

    updateAccountDisplayOptions();
    updateCapcodeOptions();
  }

  return {
    fillAccountSettings,
    renderAccountEmailPanel,
    render2FASection,
    updateAccountNavState,
    syncNotificationSummary
  };
}
