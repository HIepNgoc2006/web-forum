import type { AnyRecord } from './types';

export function createAdminLoadController(dependencies: AnyRecord) {
  const {
    state,
    els,
    api,
    showToast,
    setScreen,
    updateAccountNav,
    renderAdminPasskeys,
    renderAdminTabs,
    renderAdminLoading,
    renderAdminItems,
    renderAdminAnalytics,
    renderAdminHealth,
    renderAdminError,
    resetAdminModerationSettingsCache,
    loadAdminModerationSettingsInBackground,
    adminEndpoint,
    adminLoadTimeoutMs,
    isAbortError,
    isAdminSessionError
  } = dependencies;

  let adminLoadRequestId = 0;
  let adminLoadController: AbortController | null = null;

  async function loadAdmin() {
    const requestId = ++adminLoadRequestId;
    const requestedTab = state.adminTab;
    if (adminLoadController) {
      adminLoadController.abort();
    }
    adminLoadController = window.AbortController ? new AbortController() : null;
    const adminLoadSignal = adminLoadController?.signal;
    setScreen('admin');
    const loggedIn = Boolean(state.token);
    updateAccountNav();
    els.loginForm.classList.toggle('hidden', loggedIn);
    els.admin2FAVerifyForm?.classList.add('hidden');
    els.admin2FASetupPanel?.classList.add('hidden');
    els.logoutButton.classList.toggle('hidden', !loggedIn);
    els.adminTools.classList.toggle('hidden', !loggedIn);
    els.adminPasskeysPanel?.classList.add('hidden');
    if (!loggedIn) {
      resetAdminModerationSettingsCache();
      adminLoadController = null;
      els.pendingList.innerHTML = '';
      els.reportList.innerHTML = '';
      els.moderationActions.innerHTML = '';
      els.reportSection.classList.add('hidden');
      els.moderationSection.classList.add('hidden');
      return;
    }
    renderAdminPasskeys();
    renderAdminTabs();
    els.pendingList.innerHTML = renderAdminLoading();
    loadAdminModerationSettingsInBackground();
    try {
      const endpoint = adminEndpoint();
      const data = await api(endpoint, {
        signal: adminLoadSignal,
        timeoutMs: adminLoadTimeoutMs,
        timeoutMessage: 'Dữ liệu quản trị phản hồi quá lâu, vui lòng thử lại.'
      });
      if (requestId !== adminLoadRequestId || requestedTab !== state.adminTab) {
        return;
      }
      if (requestedTab === 'analytics') {
        renderAdminAnalytics(data);
      } else if (requestedTab === 'health') {
        renderAdminHealth(data);
      } else {
        renderAdminItems(data);
      }
    } catch (error: any) {
      if (isAbortError(error)) {
        return;
      }
      if (error.setupRequired) {
        els.loginForm.classList.add('hidden');
        els.adminTools.classList.add('hidden');
        els.admin2FASetupPanel?.classList.remove('hidden');
        els.admin2FASetupStart?.classList.remove('hidden');
        els.admin2FASetupQR?.classList.add('hidden');
        showToast(error.message);
        return;
      }
      if (requestId !== adminLoadRequestId || requestedTab !== state.adminTab) {
        return;
      }
      if (!isAdminSessionError(error)) {
        renderAdminTabs();
        els.pendingList.innerHTML = renderAdminError(error);
        showToast('Không tải được dữ liệu quản trị. Vui lòng thử cập nhật lại.');
        return;
      }
      state.token = '';
      localStorage.removeItem('adminToken');
      showToast(error.message);
      loadAdmin();
    } finally {
      if (requestId === adminLoadRequestId) {
        adminLoadController = null;
      }
    }
  }

  return {
    loadAdmin
  };
}
