import { ADMIN_LOAD_TIMEOUT_MS, ADMIN_SETTINGS_REFRESH_MS } from './constants';
import type { AnyRecord } from './types';

export function createAdminModerationSettingsController({
  els,
  state,
  api,
  showToast,
  setButtonLoading
}: AnyRecord) {
  let adminModerationSettingsLoadedAt = 0;
  let adminModerationSettingsRequest = null;

  function syncAdminModerationSettings(settings: AnyRecord = {}) {
    const threshold = Number(settings.moderationConfidenceThreshold ?? state.moderationConfidenceThreshold ?? 0);
    state.moderationConfidenceThreshold = Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0;
    if (els.adminQueueThresholdInput) {
      els.adminQueueThresholdInput.value = String(Math.round(state.moderationConfidenceThreshold * 100));
    }
  }

  async function loadAdminModerationSettings({ force = false, signal }: AnyRecord = {}) {
    if (!force && Date.now() - adminModerationSettingsLoadedAt < ADMIN_SETTINGS_REFRESH_MS) {
      return null;
    }
    if (adminModerationSettingsRequest) {
      return adminModerationSettingsRequest;
    }
    adminModerationSettingsRequest = api('/api/admin/moderation-settings', {
      signal,
      timeoutMs: ADMIN_LOAD_TIMEOUT_MS,
      timeoutMessage: 'Thiết lập kiểm duyệt phản hồi quá lâu, vui lòng thử lại.'
    })
      .then((settings) => {
        syncAdminModerationSettings(settings);
        adminModerationSettingsLoadedAt = Date.now();
        return settings;
      })
      .finally(() => {
        adminModerationSettingsRequest = null;
      });
    return adminModerationSettingsRequest;
  }

  function loadAdminModerationSettingsInBackground() {
    loadAdminModerationSettings().catch((error) => {
      if (error?.name === 'AbortError') {
        return;
      }
      console.warn('Không tải được thiết lập kiểm duyệt:', error);
    });
  }

  async function saveAdminModerationSettings() {
    const button = els.adminSaveModerationSettings;
    const restore = button ? setButtonLoading(button, 'Đang lưu...') : () => {};
    try {
      const settings = await api('/api/admin/moderation-settings', {
        method: 'PUT',
        timeoutMs: ADMIN_LOAD_TIMEOUT_MS,
        timeoutMessage: 'Lưu thiết lập kiểm duyệt phản hồi quá lâu, vui lòng thử lại.',
        body: JSON.stringify({
          moderationConfidenceThreshold: els.adminQueueThresholdInput?.value || 0
        })
      });
      syncAdminModerationSettings(settings);
      adminModerationSettingsLoadedAt = Date.now();
      showToast('Đã lưu ngưỡng kiểm duyệt.');
    } catch (error) {
      showToast(error.message);
    } finally {
      restore();
    }
  }

  function resetAdminModerationSettingsCache() {
    adminModerationSettingsLoadedAt = 0;
  }

  return {
    loadAdminModerationSettingsInBackground,
    resetAdminModerationSettingsCache,
    saveAdminModerationSettings,
    syncAdminModerationSettings
  };
}
