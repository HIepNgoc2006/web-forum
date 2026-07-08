import type { AnyRecord } from './types';

export function createAutoUpdateController(dependencies: AnyRecord) {
  const {
    state,
    loadThread,
    showToast = () => {},
    isThreadRoute = () => (window.location.hash || '').startsWith('#thread/')
  } = dependencies;

  function syncAutoUpdateControls() {
    document.querySelectorAll('[data-auto-update]').forEach((checkbox) => {
      (checkbox as HTMLInputElement).checked = Boolean(state.autoUpdate);
    });
    document.querySelectorAll('.auto-countdown').forEach((counter) => {
      counter.textContent = state.autoUpdate ? String(state.autoCountdown) : '';
    });
  }

  function stopAutoUpdateTimer() {
    if (state.autoTimer) {
      window.clearInterval(state.autoTimer);
      state.autoTimer = null;
    }
  }

  function audioWorkInProgress() {
    return (
      state.audioTranscribing.size > 0 ||
      Object.values(state.audioRecorders as AnyRecord).some((item) => item?.recorder?.state === 'recording')
    );
  }

  function postponeAutoUpdateForAudio() {
    state.autoCountdown = 7;
    syncAutoUpdateControls();
  }

  function resetAutoUpdateTimer() {
    stopAutoUpdateTimer();
    state.autoCountdown = 7;
    syncAutoUpdateControls();
    if (!state.autoUpdate || !isThreadRoute()) {
      return;
    }
    state.autoTimer = window.setInterval(() => {
      if (!isThreadRoute()) {
        stopAutoUpdateTimer();
        return;
      }
      if (audioWorkInProgress()) {
        postponeAutoUpdateForAudio();
        return;
      }
      state.autoCountdown -= 1;
      if (state.autoCountdown <= 0) {
        state.autoCountdown = 7;
        syncAutoUpdateControls();
        loadThread().catch((error) => {
          showToast(error.message);
        });
        return;
      }
      syncAutoUpdateControls();
    }, 1000);
  }

  function setAutoUpdate(enabled) {
    state.autoUpdate = enabled;
    resetAutoUpdateTimer();
  }

  return {
    syncAutoUpdateControls,
    stopAutoUpdateTimer,
    audioWorkInProgress,
    postponeAutoUpdateForAudio,
    resetAutoUpdateTimer,
    setAutoUpdate
  };
}
