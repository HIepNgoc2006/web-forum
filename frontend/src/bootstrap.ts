import { setupHcaptcha } from './hcaptcha';
import type { AnyRecord } from './types';

export async function bootstrapApp(dependencies: AnyRecord): Promise<void> {
  const {
    bindEvents,
    syncDeletePasswordInputs,
    applyTheme,
    applyDisplayPreferences,
    applyNotificationPreferences,
    api,
    state,
    syncAdminModerationSettings,
    refreshPublicBoards,
    syncAccountHomeBoardOptions,
    loadAccountSession,
    syncAdminBoardFilter,
    route,
    showToast,
    ...rest
  } = dependencies;

  bindEvents({
    ...rest,
    state
  });
  syncDeletePasswordInputs();
  applyTheme(localStorage.getItem('theme') || state.theme);
  applyDisplayPreferences();
  applyNotificationPreferences();

  const config = await api('/api/config');
  state.boards = config.boards;
  state.boardGroups = config.boardGroups || [];
  state.lifecycle = config.lifecycle || state.lifecycle;
  state.aiConfigured = Boolean(config.ai?.configured);
  state.moderationConfidenceThreshold = Number(config.ai?.moderationConfidenceThreshold || 0);
  syncAdminModerationSettings({ moderationConfidenceThreshold: state.moderationConfidenceThreshold });
  state.hcaptchaSiteKey = config.hcaptchaSiteKey || '';
  await refreshPublicBoards({ fallbackBoards: config.boards });
  setupHcaptcha(showToast).catch((error) => showToast(error.message));
  syncAccountHomeBoardOptions();
  await loadAccountSession();
  syncAdminBoardFilter();
  route();
}
