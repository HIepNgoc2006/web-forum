import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

import { escapeHtml } from './format';
import type { AnyRecord } from './types';

export function bindAccountPasskeyEvents({
  els,
  state,
  api,
  showToast,
  setFormError,
  setButtonLoading,
  finishAccountLogin
}: AnyRecord) {
  async function renderPasskeys() {
    if (!els.accountPasskeysPanel || !els.accountPasskeysList) {
      return;
    }
    const loggedIn = Boolean(state.accountToken && state.account);
    els.accountPasskeysPanel.classList.toggle('hidden', !loggedIn);
    if (!loggedIn) {
      els.accountPasskeysList.innerHTML = '';
      return;
    }
    try {
      const passkeys = await api('/api/account/passkeys', { auth: 'account' });
      if (!passkeys.length) {
        els.accountPasskeysList.innerHTML = '<p class="latest-empty">Chưa đăng ký thiết bị xác thực nào.</p>';
        return;
      }
      els.accountPasskeysList.innerHTML = passkeys
        .map((passkey) => {
          const deviceType = passkey.credentialDeviceType === 'singleDevice' ? 'Thiết bị đơn (Vân tay/Khuôn mặt)' : 'Đa thiết bị (iCloud/Google Keychain)';
          const date = new Date(passkey.createdAt).toLocaleString('vi-VN');
          return `
            <div class="watch-item">
              <div class="watch-thread-link">
                <span class="watch-board">Passkey</span>
                <span class="watch-preview" style="display:inline-block; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(passkey.id)}">ID: ${escapeHtml(passkey.id)}</span>
                <span class="watch-stats">${escapeHtml(deviceType)} · Tạo lúc: ${escapeHtml(date)}</span>
              </div>
              <button class="link-button watch-remove" data-delete-passkey="${escapeHtml(passkey.id)}" type="button">[Xóa]</button>
            </div>
          `;
        })
        .join('');
    } catch (error) {
      els.accountPasskeysList.innerHTML = `<p class="form-error">Lỗi khi tải Passkeys: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function addPasskey() {
    try {
      const options = await api('/api/account/passkeys/register-options', {
        auth: 'account',
        method: 'POST'
      });

      const attestationResponse = await startRegistration(options);

      await api('/api/account/passkeys/register-verify', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify(attestationResponse)
      });

      showToast('Đăng ký thiết bị xác thực (Passkey) thành công!');
      await renderPasskeys();
    } catch (error) {
      showToast(`Lỗi đăng ký Passkey: ${error.message}`);
    }
  }

  async function loginWithPasskey() {
    const username = (els.accountUsername.value || '').trim();
    if (!username) {
      setFormError(els.accountLoginError, 'Vui lòng nhập tên tài khoản trước.');
      return;
    }
    setFormError(els.accountLoginError);
    const restoreButton = setButtonLoading(els.loginPasskeyButton, 'Đang xác thực...');
    try {
      const options = await api('/api/auth/webauthn/login-options', {
        method: 'POST',
        body: JSON.stringify({ username })
      });

      const assertionResponse = await startAuthentication(options);

      const result = await api('/api/auth/webauthn/login-verify', {
        method: 'POST',
        body: JSON.stringify({ username, assertionResponse })
      });

      await finishAccountLogin(result);
      showToast(`Chào mừng trở lại, @${result.account.username}!`);
      window.location.hash = '#home';
    } catch (error) {
      setFormError(els.accountLoginError, `Đăng nhập Passkey thất bại: ${error.message}`);
    } finally {
      restoreButton();
    }
  }

  function handleAccountPasskeyClick(event: AnyRecord) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return false;
    }

    const addPasskeyBtn = target.closest('#addPasskeyButton');
    if (addPasskeyBtn) {
      return addPasskey();
    }

    const loginPasskeyBtn = target.closest('#loginPasskeyButton');
    if (loginPasskeyBtn) {
      return loginWithPasskey();
    }

    const deletePasskeyBtn = target.closest('[data-delete-passkey]');
    if (deletePasskeyBtn) {
      const credentialId = deletePasskeyBtn.dataset.deletePasskey;
      const ok = window.confirm('Bạn chắc chắn muốn xóa thiết bị xác thực này?');
      if (!ok) {
        return true;
      }
      return (async () => {
        try {
          await api(`/api/account/passkeys/${encodeURIComponent(credentialId)}`, {
            auth: 'account',
            method: 'DELETE'
          });
          showToast('Đã xóa Passkey.');
          await renderPasskeys();
        } catch (error) {
          showToast(`Lỗi khi xóa Passkey: ${error.message}`);
        }
      })();
    }

    return false;
  }
  return {
    renderPasskeys,
    handleAccountPasskeyClick
  };
}

export function bindAccountTwoFactorEvents({
  els,
  state,
  api,
  showToast,
  render2FAState
}: AnyRecord) {
  async function start2FASetup() {
    try {
      const data = await api('/api/account/2fa/setup', {
        auth: 'account',
        method: 'POST'
      });
      els.qrcodeImage.src = data.qrCodeUrl;
      els.backupCodesDisplay.value = data.backupCodes.join('\n');
      els.account2FADisabledSection.classList.add('hidden');
      els.account2FASetupSection.classList.remove('hidden');
      els.verify2FACode.focus();
    } catch (error) {
      showToast(`Lỗi thiết lập 2FA: ${error.message}`);
    }
  }

  async function verify2FASetup() {
    const code = (els.verify2FACode.value || '').trim();
    if (!code) {
      showToast('Vui lòng nhập mã 2FA để xác nhận.');
      return;
    }
    try {
      const result = await api('/api/account/2fa/verify', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({ code })
      });
      state.account = result.account || { ...state.account, twoFactorEnabled: true };
      showToast('Kích hoạt bảo mật 2 lớp (2FA) thành công!');
      render2FAState();
    } catch (error) {
      showToast(`Kích hoạt 2FA thất bại: ${error.message}`);
    }
  }

  async function disable2FA() {
    const password = els.disable2FAPassword.value;
    if (!password) {
      showToast('Vui lòng nhập mật khẩu để tắt 2FA.');
      return;
    }
    if (!window.confirm('Bạn chắc chắn muốn TẮT bảo mật 2 lớp (2FA)?')) {
      return;
    }
    try {
      const result = await api('/api/account/2fa/disable', {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify({ password })
      });
      state.account = result.account || { ...state.account, twoFactorEnabled: false };
      showToast('Đã tắt bảo mật 2 lớp (2FA).');
      render2FAState();
    } catch (error) {
      showToast(`Tắt 2FA thất bại: ${error.message}`);
    }
  }

  els.enable2FAButton?.addEventListener('click', start2FASetup);
  els.verify2FASetupButton?.addEventListener('click', verify2FASetup);
  els.cancel2FASetupButton?.addEventListener('click', render2FAState);
  els.disable2FAButton?.addEventListener('click', disable2FA);
}