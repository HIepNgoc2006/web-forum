import { setupHcaptcha } from './hcaptcha';
import { homeBoardKey } from './constants';
import { preloadBoardThreads, resolveStartupBoardSlug, startupBoardPreloadMode } from './board-preload';
import { applyHomeSnapshotState, readEmbeddedHomeSnapshot } from './home-snapshot';
import { screenNameFromHash } from './router';
import type { AnyRecord } from './types';

function applyPublicConfigState(state: AnyRecord, config: AnyRecord, boards = config.boards): void {
  state.boards = Array.isArray(boards) ? boards : [];
  state.boardGroups = Array.isArray(config.boardGroups) ? config.boardGroups : [];
  state.lifecycle = config.lifecycle || state.lifecycle;
  state.aiConfigured = Boolean(config.ai?.configured);
  state.moderationConfidenceThreshold = Number(config.ai?.moderationConfidenceThreshold || 0);
  state.hcaptchaSiteKey = config.hcaptchaSiteKey || '';
  const maxImageBytes = Number(config.maxImageBytes);
  if (Number.isFinite(maxImageBytes) && maxImageBytes > 0) {
    state.maxImageBytes = maxImageBytes;
  }
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

  try {
    const hash = window.location.hash || '#home';
    const startupScreen = screenNameFromHash(hash);
    // Paint the correct hash-routed shell before async startup work begins.
    if (typeof setScreen === 'function') {
      setScreen(startupScreen);
    }

    bindEvents(dependencies);
    syncDeletePasswordInputs();
    applyTheme(localStorage.getItem('theme') || state.theme);
    applyDisplayPreferences();
    applyNotificationPreferences();

    const embeddedHomeSnapshot = readEmbeddedHomeSnapshot();

    async function completeHomeStartup(snapshot: AnyRecord) {
      applyHomeSnapshotState(state, snapshot);
      state.initialHomeSnapshot = snapshot;
      syncAdminModerationSettings({ moderationConfidenceThreshold: state.moderationConfidenceThreshold });
      syncAccountHomeBoardOptions();
      syncAdminBoardFilter();

      setupHcaptcha(showToast).catch((error) => showToast(error.message));

      // Keep later board navigation warm without blocking the first home paint.
      void preloadBoardThreads({
        api,
        writeBoardThreadsCache,
        boards: state.boards || [],
        pageSize: state.boardPageSize,
        sort: state.boardSort,
        filter: state.boardFilter
      });

      // Apply account preferences before rendering so hidden boards and personal
      // content are correct when the loading gate reveals the page.
      await loadAccountSession();
      await route({ propagateErrors: true });
    }

    if (startupScreen === 'home') {
      if (embeddedHomeSnapshot) {
        await completeHomeStartup(embeddedHomeSnapshot);
        return;
      }
      let fetchedHomeSnapshot = null;
      try {
        fetchedHomeSnapshot = await api('/api/home');
      } catch {
        // Older or temporarily unavailable backends fall through to the compatible startup path.
      }
      if (fetchedHomeSnapshot) {
        await completeHomeStartup(fetchedHomeSnapshot);
        return;
      }
    }

    const config = await api('/api/config');
    applyPublicConfigState(state, config);
    const boards = await refreshPublicBoards({ fallbackBoards: config.boards });
    applyPublicConfigState(state, config, boards);
    syncAdminModerationSettings({ moderationConfidenceThreshold: state.moderationConfidenceThreshold });
    setupHcaptcha(showToast).catch((error) => showToast(error.message));
    syncAccountHomeBoardOptions();

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

    const preloadMode = startupScreen === 'home' ? 'none' : startupBoardPreloadMode(hash);
    let boardPreload: Promise<unknown> = Promise.resolve();
    if (preloadMode === 'all') {
      boardPreload = Promise.all([
        preloadBoardThreads({
          ...preloadOptions,
          boards: primaryBoard.length ? primaryBoard : (state.boards || []).slice(0, 1)
        }),
        preloadBoardThreads({
          ...preloadOptions,
          boards: remainingBoards
        })
      ]);
    } else if (preloadMode === 'primary') {
      boardPreload = preloadBoardThreads({
        ...preloadOptions,
        boards: primaryBoard.length ? primaryBoard : (state.boards || []).slice(0, 1)
      });
    }

    await Promise.all([
      loadAccountSession(),
      boardPreload
    ]);
    syncAdminBoardFilter();
    // Finish the first route once its startup data is available.
    await route({ propagateErrors: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (typeof showToast === 'function') {
      showToast(message);
    }
    throw error;
  }
}
