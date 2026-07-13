import type { AnyRecord } from './types';
import { api as defaultApi } from './api';
import { homeBoardKey, SUPPORTED_THEMES, themeKey } from './constants';
import {
  clearAccountToken,
  localDisplayPreferences,
  localNotificationPreferences,
  subscribedBoardSlugs,
  writeAccountToken,
  writeLocalDisplayPreferences,
  writeLocalNotificationPreferences,
  writeSubscribedBoardSlugs
} from './storage';
import { syncWatchedControls } from './watchlist';
import { escapeHtml } from './format';

type ApiCall = (input: string, options?: AnyRecord) => Promise<AnyRecord>;

type AccountPreferencesDependencies = {
  state: AnyRecord;
  els: AnyRecord;
  api?: ApiCall;
  updateAccountNav?: () => void;
  renderAccountPrivateData?: () => void;
  applyNotificationPreferences: (preferences: AnyRecord) => AnyRecord;
};

type AccountPreferences = {
  applyTheme: (theme?: string) => string;
  applyDisplayPreferences: (preferences?: AnyRecord) => AnyRecord;
  accountSettingsFromLocal: () => AnyRecord;
  syncAccountBoardSubscriptionOptions: (settings?: AnyRecord) => void;
  applyAccountSyncedSettings: (account?: AnyRecord | null) => void;
  persistAccountSettings: (options?: AnyRecord) => Promise<any> | null;
  setAccountSession: ({ token, account }?: AnyRecord) => void;
  updateAccountDisplayOptions: () => void;
  isCapcodeEligible: () => boolean;
  updateCapcodeOptions: () => void;
  syncAccountHomeBoardOptions: () => void;
  setHomeSyncCallbacks: (callbacks: { syncBoardSubscriptionButtons?: () => void; renderSubscribedBoards?: () => void }) => void;
};

export function createAccountPreferencesController({
  state,
  els,
  api = defaultApi,
  updateAccountNav = () => {},
  renderAccountPrivateData = () => {},
  applyNotificationPreferences
}: AccountPreferencesDependencies): AccountPreferences {
  const apiCall = api || defaultApi;
  let homeSyncCallbacks = {
    syncBoardSubscriptionButtons: () => {},
    renderSubscribedBoards: () => {}
  };

  function applyTheme(theme = state.theme) {
    const safeTheme = SUPPORTED_THEMES.includes(theme) ? theme : 'yotsuba-b';
    state.theme = safeTheme;
    document.body.classList.remove(...SUPPORTED_THEMES.map((item) => `theme-${item}`));
    document.body.classList.add(`theme-${safeTheme}`);
    localStorage.setItem(themeKey, safeTheme);
    document.querySelectorAll('[data-theme-select]').forEach((select) => {
      select.value = safeTheme;
    });
    return safeTheme;
  }

  function applyDisplayPreferences(preferences = localDisplayPreferences()) {
    const safe = writeLocalDisplayPreferences(preferences);
    document.body.classList.toggle('display-compact', safe.compactThreads);
    document.body.classList.toggle('display-hide-thumbnails', safe.hideThumbnails);
    if (els?.accountCompactThreads) {
      els.accountCompactThreads.checked = safe.compactThreads;
    }
    if (els?.accountHideThumbnails) {
      els.accountHideThumbnails.checked = safe.hideThumbnails;
    }
    if (els?.accountWatchedUnreadOnly) {
      els.accountWatchedUnreadOnly.checked = safe.watchedUnreadOnly;
    }
    if (els?.accountWatchedSort) {
      els.accountWatchedSort.value = safe.watchedSort;
    }
    syncWatchedControls({ unreadOnly: safe.watchedUnreadOnly });
    return safe;
  }

  function accountSettingsFromLocal() {
    const notifications = localNotificationPreferences();
    return {
      theme: state.theme,
      homeBoard: localStorage.getItem(homeBoardKey) || state.account?.settings?.homeBoard || state.boardSlug || 'confession',
      syncDrafts: state.account?.settings?.syncDrafts !== false,
      emailNotifications: notifications.email,
      displayPreferences: localDisplayPreferences(),
      notificationPreferences: notifications,
      boardSubscriptions: [...subscribedBoardSlugs()]
    };
  }

  function syncAccountBoardSubscriptionOptions(settings = state.account?.settings || accountSettingsFromLocal()) {
    if (!els.accountBoardSubscriptions) {
      return;
    }
    const selected = new Set(
      Array.isArray(settings.boardSubscriptions) ? settings.boardSubscriptions.map(String) : [...subscribedBoardSlugs()]
    );
    els.accountBoardSubscriptions.innerHTML = state.boards
      .map(
        (board) => `
        <label>
          <input type="checkbox" value="${escapeHtml(board.slug)}" data-account-board-subscription ${
            selected.has(board.slug) ? 'checked' : ''
          } />
          ${escapeHtml(board.path)} ${escapeHtml(board.name)}
        </label>
      `
      )
      .join('');
  }

  function applyAccountSyncedSettings(account = state.account) {
    const settings = account?.settings;
    if (!settings) {
      applyDisplayPreferences();
      applyNotificationPreferences({});
      syncAccountBoardSubscriptionOptions();
      return;
    }
    applyTheme(settings.theme);
    localStorage.setItem(homeBoardKey, settings.homeBoard || 'confession');
    applyDisplayPreferences(settings.displayPreferences);
    applyNotificationPreferences(settings.notificationPreferences || { email: settings.emailNotifications });
    writeSubscribedBoardSlugs(Array.isArray(settings.boardSubscriptions) ? settings.boardSubscriptions : []);
    homeSyncCallbacks.syncBoardSubscriptionButtons();
    syncAccountBoardSubscriptionOptions(settings);
    writeLocalNotificationPreferences(settings.notificationPreferences || {});
    if ((window.location.hash || '#home').startsWith('#home')) {
      homeSyncCallbacks.renderSubscribedBoards();
    }
  }

  async function persistAccountSettings({ silent = false }: AnyRecord = {}) {
    if (!state.accountToken || !state.account) {
      return null;
    }
    try {
      const account = await apiCall('/api/account/settings', {
        auth: 'account',
        method: 'PUT',
        body: JSON.stringify({ settings: accountSettingsFromLocal() })
      });
      state.account = account;
      updateAccountNav();
      return account;
    } catch (error) {
      if (!silent) {
        throw error;
      }
      if (/\u0111\u0103ng nh\u1eadp|Phi\u00ean/.test(String(error.message || ''))) {
        setAccountSession({});
      }
      return null;
    }
  }

  function setAccountSession({ token = '', account = null }: AnyRecord = {}) {
    state.accountToken = token;
    state.account = account;
    state.accountPostNumbers = new Set();
    state.accountPrivateData = token ? state.accountPrivateData : null;
    window.clearTimeout(state.accountPrivateSaveTimer);
    if (token) {
      writeAccountToken(token);
    } else {
      clearAccountToken();
    }
    if (account) {
      applyAccountSyncedSettings(account);
    }
    updateAccountNav();
    renderAccountPrivateData();
  }

  function updateAccountDisplayOptions() {
    const loggedIn = Boolean(state.accountToken && state.account?.username);
    els.accountDisplayOptions.forEach((element) => element.classList.toggle('hidden', !loggedIn));
    if (!loggedIn) {
      els.useAccountNameInputs.forEach((input) => {
        input.checked = false;
      });
    }
  }

  function isCapcodeEligible() {
    return Boolean(state.accountToken) && ['admin', 'moderator'].includes(state.account?.role);
  }

  function updateCapcodeOptions() {
    const eligible = isCapcodeEligible();
    els.capcodeOptions.forEach((element) => element.classList.toggle('hidden', !eligible));
    if (!eligible) {
      els.capcodeInputs.forEach((input) => {
        input.checked = false;
      });
    }
  }

  function syncAccountHomeBoardOptions() {
    if (!els.accountHomeBoard) {
      return;
    }
    els.accountHomeBoard.innerHTML = state.boards
      .map((board) => `<option value="${escapeHtml(board.slug)}">${escapeHtml(board.path)} ${escapeHtml(board.name)}</option>`)
      .join('');
  }

  return {
    applyTheme,
    applyDisplayPreferences,
    accountSettingsFromLocal,
    syncAccountBoardSubscriptionOptions,
    applyAccountSyncedSettings,
    persistAccountSettings,
    setAccountSession,
    updateAccountDisplayOptions,
    isCapcodeEligible,
    updateCapcodeOptions,
    syncAccountHomeBoardOptions,
    setHomeSyncCallbacks: (callbacks: { syncBoardSubscriptionButtons?: () => void; renderSubscribedBoards?: () => void }) => {
      homeSyncCallbacks = {
        syncBoardSubscriptionButtons: callbacks.syncBoardSubscriptionButtons || homeSyncCallbacks.syncBoardSubscriptionButtons,
        renderSubscribedBoards: callbacks.renderSubscribedBoards || homeSyncCallbacks.renderSubscribedBoards
      };
    }
  };
}
