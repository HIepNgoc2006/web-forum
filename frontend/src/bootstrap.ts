import { setupHcaptcha } from './hcaptcha';
import { homeBoardKey } from './constants';
import { preloadBoardThreads, resolveStartupBoardSlug } from './board-preload';
import { screenNameFromHash } from './router';
import type { AnyRecord } from './types';

const APP_READY_CLASS = 'app-ready';
const APP_READY_FAILSAFE_MS = 15000;

export function markAppReady(): void {
  const root = document.documentElement;
  root.classList.add(APP_READY_CLASS);
  if (root.dataset.initialScreen) {
    delete root.dataset.initialScreen;
  }
  document.getElementById('appBootLoader')?.setAttribute('hidden', '');
}

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
    setScreen,
    showToast,
    writeBoardThreadsCache
  } = dependencies;

  // Failsafe: never leave the UI permanently hidden if bootstrap hangs.
  const failsafe = window.setTimeout(markAppReady, APP_READY_FAILSAFE_MS);

  try {
    // Prepare the correct screen shell while content stays hidden until ready.
    if (typeof setScreen === 'function') {
      setScreen(screenNameFromHash(window.location.hash));
    }

    bindEvents(dependencies);
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
    const maxImageBytes = Number(config.maxImageBytes);
    if (Number.isFinite(maxImageBytes) && maxImageBytes > 0) {
      state.maxImageBytes = maxImageBytes;
    }
    await refreshPublicBoards({ fallbackBoards: config.boards });
    setupHcaptcha(showToast).catch((error) => showToast(error.message));
    syncAccountHomeBoardOptions();

    const hash = window.location.hash || '#home';
    const startupSlug = resolveStartupBoardSlug({
      hash,
      homeBoard: localStorage.getItem(homeBoardKey) || state.account?.settings?.homeBoard || '',
      fallbackSlug: state.boardSlug || 'confession'
    });
    const primaryBoard = (state.boards || []).filter((board: AnyRecord) => board.slug === startupSlug);
    const remainingBoards = (state.boards || []).filter((board: AnyRecord) => board.slug !== startupSlug);
    const preloadOptions = {
      api,
      writeBoardThreadsCache,
      pageSize: state.boardPageSize,
      sort: state.boardSort,
      filter: state.boardFilter
    };

    // Warm the board the user is about to see before routing, and warm the rest
    // so later board navigations skip the loading flash. Home needs every board.
    const primaryPreload = preloadBoardThreads({
      ...preloadOptions,
      boards: primaryBoard.length ? primaryBoard : (state.boards || []).slice(0, 1)
    });
    const remainingPreload = preloadBoardThreads({
      ...preloadOptions,
      boards: remainingBoards
    });
    const needsAllBoards = hash === '#home' || hash.startsWith('#home') || hash === '';

    await Promise.all([
      loadAccountSession(),
      needsAllBoards ? Promise.all([primaryPreload, remainingPreload]) : primaryPreload
    ]);
    syncAdminBoardFilter();
    // Wait for the first route's data so users never see empty section shells.
    await route();
    if (!needsAllBoards) {
      void remainingPreload;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (typeof showToast === 'function') {
      showToast(message);
    }
  } finally {
    window.clearTimeout(failsafe);
    markAppReady();
  }
}
