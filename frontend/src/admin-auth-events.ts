import type { AnyRecord } from './types';

export function bindAdminAuthEvents({
  els,
  state,
  api,
  showToast,
  setFormError,
  loadAdmin
}: AnyRecord) {
  els.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          username: els.adminUsername.value,
          password: els.adminPassword.value
        })
      });
      els.adminPassword.value = '';
      if (result.requires2FA) {
        state.adminTemp2FAToken = result.tempToken;
        els.loginForm.classList.add('hidden');
        els.admin2FAVerifyForm?.classList.remove('hidden');
        els.admin2FACode.value = '';
        els.admin2FACode.focus();
        showToast('Vui lòng nhập mã 2FA để hoàn tất đăng nhập quản trị.');
        return;
      }
      state.token = result.token;
      localStorage.setItem('adminToken', state.token);
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.admin2FAVerifyForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError(els.admin2FAVerifyError);
    try {
      const code = (els.admin2FACode.value || '').trim();
      if (!code) {
        throw new Error('Vui lòng nhập mã 2FA.');
      }
      const result = await api('/api/auth/2fa/verify', {
        auth: 'none',
        method: 'POST',
        body: JSON.stringify({ tempToken: state.adminTemp2FAToken, code })
      });
      state.adminTemp2FAToken = null;
      state.token = result.token;
      localStorage.setItem('adminToken', state.token);
      els.admin2FAVerifyForm.classList.add('hidden');
      showToast('Xác thực 2FA thành công.');
      await loadAdmin();
    } catch (error) {
      setFormError(els.admin2FAVerifyError, error.message);
    }
  });

  els.admin2FACancelButton?.addEventListener('click', () => {
    state.adminTemp2FAToken = null;
    els.admin2FAVerifyForm?.classList.add('hidden');
    els.loginForm.classList.remove('hidden');
  });

  els.adminStart2FAButton?.addEventListener('click', async () => {
    try {
      const data = await api('/api/account/2fa/setup', { auth: 'admin', method: 'POST' });
      els.admin2FAQRImage.src = data.qrCodeUrl;
      els.admin2FABackupCodes.value = data.backupCodes.join('\n');
      els.admin2FASetupStart.classList.add('hidden');
      els.admin2FASetupQR.classList.remove('hidden');
      els.admin2FASetupCode.value = '';
      els.admin2FASetupCode.focus();
    } catch (error) {
      showToast(`Lỗi thiết lập 2FA: ${error.message}`);
    }
  });

  els.adminVerify2FASetupButton?.addEventListener('click', async () => {
    const code = (els.admin2FASetupCode.value || '').trim();
    if (!code) {
      showToast('Vui lòng nhập mã 2FA để xác nhận.');
      return;
    }
    try {
      await api('/api/account/2fa/verify', {
        auth: 'admin',
        method: 'POST',
        body: JSON.stringify({ code })
      });
      showToast('Kích hoạt 2FA thành công! Vui lòng đăng nhập lại với mã 2FA.');
      state.token = '';
      localStorage.removeItem('adminToken');
      els.admin2FASetupPanel?.classList.add('hidden');
      loadAdmin();
    } catch (error) {
      showToast(`Kích hoạt 2FA thất bại: ${error.message}`);
    }
  });

  els.logoutButton.addEventListener('click', () => {
    state.token = '';
    localStorage.removeItem('adminToken');
    loadAdmin();
  });
}
