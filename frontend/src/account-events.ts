import type { AnyRecord } from './types';

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
