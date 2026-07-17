import { bindAccountTwoFactorEvents } from './account-events';
import type { AnyRecord } from './types';

export function bindAccountFormEvents({
  els,
  state,
  api,
  showToast,
  setFormError,
  setButtonLoading,
  resetHcaptcha,
  finishAccountLogin,
  setAccountSession,
  fillAccountSettings,
  updateAccountNav,
  applyAccountSyncedSettings,
  applyTheme,
  applyDisplayPreferences,
  applyNotificationPreferences,
  resolveBrowserWatchedThreadPreference,
  writeLocalDisplayPreferences,
  writeLocalNotificationPreferences,
  writeSubscribedBoardSlugs,
  syncBoardSubscriptionButtons,
  homeBoardKey,
  render2FAState
}: AnyRecord) {
  async function logoutAccount({ message = 'Đã đăng xuất tài khoản.' }: AnyRecord = {}) {
    let revokeConfirmed = true;
    if (state.accountToken) {
      try {
        await api('/api/account/logout', {
          auth: 'account',
          method: 'POST'
        });
      } catch (error) {
        revokeConfirmed = false;
        console.warn('Không thể thu hồi phiên tài khoản trên máy chủ:', error);
      }
    }
    setAccountSession();
    if (message || !revokeConfirmed) {
      showToast(
        revokeConfirmed
          ? message
          : 'Đã xóa phiên trên trình duyệt, nhưng máy chủ chưa xác nhận thu hồi phiên.'
      );
    }
    if (['#account', '#login', '#register', '#forgot'].some((prefix) => (window.location.hash || '').startsWith(prefix))) {
      window.location.hash = '#home';
    }
  }

  async function submitAccountRegister(event) {
    event.preventDefault();
    setFormError(els.registerError);
    if (els.registerPassword.value !== els.registerPasswordConfirmation.value) {
      setFormError(els.registerError, 'Mật khẩu xác nhận không khớp.');
      els.registerPasswordConfirmation.focus();
      return;
    }
    const captchaToken = (els.registerCaptcha?.value || '').trim();
    if (state.hcaptchaSiteKey && !captchaToken) {
      setFormError(els.registerError, 'Vui lòng hoàn tất xác minh hCaptcha trước khi đăng ký.');
      return;
    }
    const button = event.submitter;
    const restoreButton = setButtonLoading(button, 'Đang đăng ký...');
    try {
      const result = await api('/api/account/register', {
        auth: 'none',
        method: 'POST',
        body: JSON.stringify({
          username: els.registerUsername.value,
          email: els.registerEmail.value,
          password: els.registerPassword.value,
          captchaToken
        })
      });
      els.registerPassword.value = '';
      els.registerPasswordConfirmation.value = '';
      resetHcaptcha(els.registerCaptcha);
      await finishAccountLogin(result);
      showToast('Đã đăng ký và đăng nhập tài khoản.');
      if (els.registerVerificationStatus) {
        els.registerVerificationStatus.textContent = result.verificationEmailSent
          ? 'Bạn có thể dùng tài khoản ngay. Mã xác nhận email đã được gửi và có hiệu lực 15 phút.'
          : 'Bạn có thể dùng tài khoản ngay. Chưa gửi được email xác nhận; hãy thử gửi lại trong cài đặt tài khoản.';
      }
      // Reveal the one-time recovery code before sending the user to settings.
      if (result.recoveryCode) {
        els.registerRecoveryCode.textContent = result.recoveryCode;
        els.registerForm.classList.add('hidden');
        els.registerRecoveryNotice.classList.remove('hidden');
      } else {
        window.location.hash = '#account';
      }
    } catch (error) {
      resetHcaptcha(els.registerCaptcha);
      setFormError(els.registerError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Đã sao chép vào clipboard.');
    } catch {
      showToast('Không thể sao chép tự động, vui lòng copy thủ công.');
    }
  }

  async function submitForgotPassword(event) {
    event.preventDefault();
    setFormError(els.forgotError);
    const captchaToken = (els.forgotCaptcha?.value || '').trim();
    if (state.hcaptchaSiteKey && !captchaToken) {
      setFormError(els.forgotError, 'Vui lòng hoàn tất xác minh hCaptcha trước khi đặt lại mật khẩu.');
      return;
    }
    const button = event.submitter;
    const restoreButton = setButtonLoading(button, 'Đang đặt lại...');
    try {
      const result = await api('/api/account/forgot-password', {
        auth: 'none',
        method: 'POST',
        body: JSON.stringify({
          username: els.forgotUsername.value,
          recoveryCode: els.forgotRecoveryCode.value,
          newPassword: els.forgotNewPassword.value,
          captchaToken
        })
      });
      els.forgotNewPassword.value = '';
      els.forgotRecoveryCode.value = '';
      resetHcaptcha(els.forgotCaptcha);
      els.forgotNewRecoveryCode.textContent = result.recoveryCode || '';
      els.forgotPasswordForm.classList.add('hidden');
      els.forgotSuccess.classList.remove('hidden');
      showToast('Đã đặt lại mật khẩu. Vui lòng đăng nhập lại.');
    } catch (error) {
      resetHcaptcha(els.forgotCaptcha);
      setFormError(els.forgotError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitForgotEmailRequest(event) {
    event.preventDefault();
    setFormError(els.forgotEmailRequestError);
    const identifier = (els.forgotEmailIdentifier.value || '').trim();
    const captchaToken = (els.forgotEmailRequestCaptcha?.value || '').trim();
    if (!identifier) {
      setFormError(els.forgotEmailRequestError, 'Vui lòng nhập tên tài khoản hoặc email.');
      return;
    }
    if (state.hcaptchaSiteKey && !captchaToken) {
      setFormError(els.forgotEmailRequestError, 'Vui lòng hoàn tất xác minh hCaptcha.');
      return;
    }
    const restoreButton = setButtonLoading(event.submitter, 'Đang gửi...');
    try {
      await api('/api/account/password-reset/email/request', {
        auth: 'none',
        method: 'POST',
        body: JSON.stringify({ identifier, captchaToken })
      });
      resetHcaptcha(els.forgotEmailRequestCaptcha);
      els.forgotEmailConfirmIdentifier.value = identifier;
      els.forgotEmailRequestForm.classList.add('hidden');
      els.forgotEmailConfirmForm.classList.remove('hidden');
      els.forgotEmailCode.value = '';
      els.forgotEmailCode.focus();
      showToast('Nếu tài khoản có email đã xác nhận, mã OTP đã được gửi.');
    } catch (error) {
      resetHcaptcha(els.forgotEmailRequestCaptcha);
      setFormError(els.forgotEmailRequestError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitForgotEmailConfirm(event) {
    event.preventDefault();
    setFormError(els.forgotEmailConfirmError);
    const restoreButton = setButtonLoading(event.submitter, 'Đang đặt lại...');
    try {
      const result = await api('/api/account/password-reset/email/confirm', {
        auth: 'none',
        method: 'POST',
        body: JSON.stringify({
          identifier: els.forgotEmailConfirmIdentifier.value,
          code: els.forgotEmailCode.value,
          newPassword: els.forgotEmailNewPassword.value
        })
      });
      els.forgotEmailNewPassword.value = '';
      els.forgotEmailCode.value = '';
      els.forgotEmailConfirmForm.classList.add('hidden');
      els.forgotPasswordForm.classList.add('hidden');
      els.forgotNewRecoveryCode.textContent = result.recoveryCode || '';
      els.forgotSuccess.classList.remove('hidden');
      showToast('Đã đặt lại mật khẩu bằng email. Vui lòng đăng nhập lại.');
    } catch (error) {
      setFormError(els.forgotEmailConfirmError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitRecoveryCodeRegen(event) {
    event.preventDefault();
    setFormError(els.recoveryCodeError);
    const button = event.submitter;
    const restoreButton = setButtonLoading(button, 'Đang tạo...');
    try {
      const result = await api('/api/account/recovery-code', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({ password: els.recoveryCodePassword.value })
      });
      els.recoveryCodePassword.value = '';
      els.recoveryCodeResultValue.textContent = result.recoveryCode || '';
      els.recoveryCodeResult.classList.remove('hidden');
      if (result.token) {
        setAccountSession({ token: result.token, account: result.account || state.account });
      } else if (state.account) {
        state.account.hasRecoveryCode = true;
      }
      showToast('Đã tạo mã khôi phục mới. Mã cũ đã hết hiệu lực.');
    } catch (error) {
      setFormError(els.recoveryCodeError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitRecoveryEmailRequest(event) {
    event.preventDefault();
    setFormError(els.recoveryEmailRequestError);
    const captchaToken = (els.recoveryEmailRequestCaptcha?.value || '').trim();
    if (state.hcaptchaSiteKey && !captchaToken) {
      setFormError(els.recoveryEmailRequestError, 'Vui lòng hoàn tất xác minh hCaptcha.');
      return;
    }
    const restoreButton = setButtonLoading(event.submitter, 'Đang gửi...');
    try {
      await api('/api/account/recovery-code/email/request', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({ identifier: state.account?.username, captchaToken })
      });
      resetHcaptcha(els.recoveryEmailRequestCaptcha);
      els.recoveryEmailRequestForm.classList.add('hidden');
      els.recoveryEmailConfirmForm.classList.remove('hidden');
      els.recoveryEmailCode.value = '';
      els.recoveryEmailCode.focus();
      showToast('Mã OTP tạo lại mã khôi phục đã được gửi.');
    } catch (error) {
      resetHcaptcha(els.recoveryEmailRequestCaptcha);
      setFormError(els.recoveryEmailRequestError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitRecoveryEmailConfirm(event) {
    event.preventDefault();
    setFormError(els.recoveryEmailConfirmError);
    const restoreButton = setButtonLoading(event.submitter, 'Đang tạo...');
    try {
      const result = await api('/api/account/recovery-code/email/confirm', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({
          identifier: state.account?.username,
          code: els.recoveryEmailCode.value
        })
      });
      els.recoveryEmailCode.value = '';
      els.recoveryEmailConfirmForm.classList.add('hidden');
      els.recoveryEmailRequestForm.classList.remove('hidden');
      els.recoveryCodeResultValue.textContent = result.recoveryCode || '';
      els.recoveryCodeResult.classList.remove('hidden');
      showToast('Đã tạo mã khôi phục mới bằng email.');
    } catch (error) {
      setFormError(els.recoveryEmailConfirmError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitAccountEmailVerify(event) {
    event.preventDefault();
    setFormError(els.accountEmailVerifyError);
    const restoreButton = setButtonLoading(event.submitter, 'Đang xác nhận...');
    try {
      const account = await api('/api/account/email/verify', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({ code: els.accountEmailVerifyCode.value })
      });
      els.accountEmailVerifyCode.value = '';
      state.account = account;
      fillAccountSettings(account);
      updateAccountNav();
      showToast('Đã xác nhận email tài khoản.');
    } catch (error) {
      setFormError(els.accountEmailVerifyError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function resendAccountEmailVerification(event) {
    setFormError(els.accountEmailVerifyError);
    const restoreButton = setButtonLoading(event.currentTarget, 'Đang gửi...');
    try {
      const result = await api('/api/account/email/resend', {
        auth: 'account',
        method: 'POST'
      });
      state.account = result.account;
      fillAccountSettings(result.account);
      showToast(result.emailSent ? 'Đã gửi mã OTP mới.' : 'Chưa gửi được email. Vui lòng thử lại sau.');
    } catch (error) {
      setFormError(els.accountEmailVerifyError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitAccountEmailChange(event) {
    event.preventDefault();
    setFormError(els.accountEmailChangeError);
    const restoreButton = setButtonLoading(event.submitter, 'Đang gửi...');
    try {
      const result = await api('/api/account/email/change', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({
          newEmail: els.accountEmailNewEmail.value,
          password: els.accountEmailChangePassword.value
        })
      });
      els.accountEmailChangePassword.value = '';
      state.account = result.account;
      fillAccountSettings(result.account);
      showToast(result.emailSent ? 'Đã gửi mã OTP tới email mới.' : 'Chưa gửi được email. Vui lòng thử lại sau.');
    } catch (error) {
      setFormError(els.accountEmailChangeError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitAccountEmailChangeConfirm(event) {
    event.preventDefault();
    setFormError(els.accountEmailChangeConfirmError);
    const restoreButton = setButtonLoading(event.submitter, 'Đang xác nhận...');
    try {
      const account = await api('/api/account/email/change/confirm', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({ code: els.accountEmailChangeCode.value })
      });
      els.accountEmailChangeCode.value = '';
      els.accountEmailNewEmail.value = '';
      state.account = account;
      fillAccountSettings(account);
      updateAccountNav();
      showToast('Đã đổi và xác nhận email mới.');
    } catch (error) {
      setFormError(els.accountEmailChangeConfirmError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitAccountLogin(event) {
    event.preventDefault();
    setFormError(els.accountLoginError);
    const captchaToken = (els.accountLoginCaptcha?.value || '').trim();
    if (state.hcaptchaSiteKey && !captchaToken) {
      setFormError(els.accountLoginError, 'Vui lòng hoàn tất xác minh hCaptcha trước khi đăng nhập.');
      return;
    }
    const button = event.submitter;
    const restoreButton = setButtonLoading(button, 'Đang đăng nhập...');
    try {
      const result = await api('/api/account/login', {
        auth: 'none',
        method: 'POST',
        body: JSON.stringify({
          username: els.accountUsername.value,
          password: els.accountPassword.value,
          captchaToken
        })
      });
      els.accountPassword.value = '';
      resetHcaptcha(els.accountLoginCaptcha);
      if (result.requires2FA) {
        state.temp2FAToken = result.tempToken;
        els.account2FAVerifyForm.classList.remove('hidden');
        els.login2FACode.value = '';
        els.login2FACode.focus();
        showToast('Vui lòng nhập mã 2FA để hoàn tất đăng nhập.');
        return;
      }
      await finishAccountLogin(result);
      showToast('Đã đăng nhập tài khoản.');
      window.location.hash = '#account';
    } catch (error) {
      resetHcaptcha(els.accountLoginCaptcha);
      setFormError(els.accountLoginError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitAccount2FAVerify(event) {
    event.preventDefault();
    setFormError(els.account2FAVerifyError);
    try {
      const code = (els.login2FACode.value || '').trim();
      if (!code) {
        throw new Error('Vui lòng nhập mã 2FA.');
      }
      const result = await api('/api/auth/2fa/verify', {
        auth: 'none',
        method: 'POST',
        body: JSON.stringify({ tempToken: state.temp2FAToken, code })
      });
      els.account2FAVerifyForm.classList.add('hidden');
      state.temp2FAToken = null;
      await finishAccountLogin(result);
      showToast('Xác thực 2FA thành công. Đã đăng nhập.');
      window.location.hash = '#account';
    } catch (error) {
      setFormError(els.account2FAVerifyError, error.message);
    }
  }

  async function submitBackupCodeLogin() {
    setFormError(els.account2FAVerifyError);
    try {
      const code = (els.loginBackupCode.value || '').trim();
      if (!code) {
        throw new Error('Vui lòng nhập mã dự phòng.');
      }
      const result = await api('/api/auth/2fa/backup-login', {
        auth: 'none',
        method: 'POST',
        body: JSON.stringify({ tempToken: state.temp2FAToken, code })
      });
      els.account2FAVerifyForm.classList.add('hidden');
      state.temp2FAToken = null;
      await finishAccountLogin(result);
      showToast('Đăng nhập bằng mã dự phòng thành công.');
      window.location.hash = '#account';
    } catch (error) {
      setFormError(els.account2FAVerifyError, error.message);
    }
  }

  async function submitAccountSettings(event) {
    event.preventDefault();
    setFormError(els.accountSettingsError);
    const button = event.submitter;
    const restoreButton = setButtonLoading(button, 'Đang lưu...');
    const displayPreferences = writeLocalDisplayPreferences({
      compactThreads: els.accountCompactThreads.checked,
      hideThumbnails: els.accountHideThumbnails.checked,
      watchedUnreadOnly: els.accountWatchedUnreadOnly.checked,
      watchedSort: els.accountWatchedSort.value,
      commentComposerMode: els.accountCommentComposerMode.value
    });
    const browserWatchedThreads = await resolveBrowserWatchedThreadPreference(els.accountBrowserNotifyWatchedThreads.checked, showToast);
    const notificationPreferences = writeLocalNotificationPreferences({
      email: els.accountEmailNotifications.checked,
      watchedThreads: els.accountNotifyWatchedThreads.checked,
      boardSubscriptions: els.accountNotifyBoardSubscriptions.checked,
      browserWatchedThreads
    });
    const boardSubscriptions = [...els.accountBoardSubscriptions.querySelectorAll('[data-account-board-subscription]:checked')].map(
      (input) => input.value
    );
    applyTheme(els.accountTheme.value);
    localStorage.setItem(homeBoardKey, els.accountHomeBoard.value);
    applyDisplayPreferences(displayPreferences);
    applyNotificationPreferences(notificationPreferences);
    writeSubscribedBoardSlugs(boardSubscriptions);
    syncBoardSubscriptionButtons();
    try {
      if (!state.accountToken || !state.account) {
        fillAccountSettings();
        showToast('Đã lưu settings trên trình duyệt này.');
        return;
      }
      const account = await api('/api/account/settings', {
        auth: 'account',
        method: 'PUT',
        body: JSON.stringify({
          settings: {
            theme: els.accountTheme.value,
            homeBoard: els.accountHomeBoard.value,
            syncDrafts: els.accountSyncDrafts.checked,
            emailNotifications: notificationPreferences.email,
            displayPreferences,
            notificationPreferences,
            boardSubscriptions
          }
        })
      });
      state.account = account;
      applyAccountSyncedSettings(account);
      fillAccountSettings(account);
      updateAccountNav();
      showToast('Đã lưu settings tài khoản.');
    } catch (error) {
      setFormError(els.accountSettingsError, error.message);
      if (/đăng nhập|Phiên/.test(error.message)) {
        setAccountSession();
        fillAccountSettings();
      }
    } finally {
      restoreButton();
    }
  }

  els.registerForm.addEventListener('submit', submitAccountRegister);
  els.registerRecoveryContinue?.addEventListener('click', () => {
    window.location.hash = '#account';
  });
  els.registerRecoveryCopy?.addEventListener('click', () => copyToClipboard(els.registerRecoveryCode.textContent || ''));
  els.accountLoginForm.addEventListener('submit', submitAccountLogin);
  els.forgotPasswordForm?.addEventListener('submit', submitForgotPassword);
  els.forgotEmailRequestForm?.addEventListener('submit', submitForgotEmailRequest);
  els.forgotEmailConfirmForm?.addEventListener('submit', submitForgotEmailConfirm);
  els.forgotEmailStartOver?.addEventListener('click', () => {
    els.forgotEmailConfirmForm.classList.add('hidden');
    els.forgotEmailRequestForm.classList.remove('hidden');
    setFormError(els.forgotEmailRequestError);
    setFormError(els.forgotEmailConfirmError);
  });
  els.forgotRecoveryCopy?.addEventListener('click', () => copyToClipboard(els.forgotNewRecoveryCode.textContent || ''));
  els.recoveryCodeForm?.addEventListener('submit', submitRecoveryCodeRegen);
  els.recoveryEmailRequestForm?.addEventListener('submit', submitRecoveryEmailRequest);
  els.recoveryEmailConfirmForm?.addEventListener('submit', submitRecoveryEmailConfirm);
  els.recoveryCodeCopy?.addEventListener('click', () => copyToClipboard(els.recoveryCodeResultValue.textContent || ''));
  els.accountEmailVerifyForm?.addEventListener('submit', submitAccountEmailVerify);
  els.accountEmailResend?.addEventListener('click', resendAccountEmailVerification);
  els.accountEmailChangeForm?.addEventListener('submit', submitAccountEmailChange);
  els.accountEmailChangeConfirmForm?.addEventListener('submit', submitAccountEmailChangeConfirm);
  els.account2FAVerifyForm?.addEventListener('submit', submitAccount2FAVerify);
  els.accountSettingsForm.addEventListener('submit', submitAccountSettings);
  els.accountLogoutButton.addEventListener('click', () => logoutAccount());
  els.accountSettingsLogout.addEventListener('click', () => logoutAccount());
  bindAccountTwoFactorEvents({ els, state, api, showToast, render2FAState, setAccountSession });
  els.useBackupCodeLink?.addEventListener('click', () => {
    els.backupCodeInputSection.classList.remove('hidden');
    els.loginBackupCode.focus();
  });
  els.submitBackupCodeButton?.addEventListener('click', submitBackupCodeLogin);
  els.useTotpLink?.addEventListener('click', () => {
    els.backupCodeInputSection.classList.add('hidden');
    els.loginBackupCode.value = '';
    els.login2FACode.focus();
  });
}
