import type { AnyRecord } from './types';

/**
 * Thread live updates are driven by SSE (`realtime.ts`), not a checkbox poller.
 * This module only exposes helpers that keep voice/audio capture from being
 * interrupted by a background thread refresh.
 */
export function createAutoUpdateController(dependencies: AnyRecord) {
  const { state } = dependencies;

  function audioWorkInProgress() {
    return (
      state.audioTranscribing.size > 0 ||
      Object.values(state.audioRecorders as AnyRecord).some(
        (item) => item?.recognition || item?.recorder?.state === 'recording'
      )
    );
  }

  // Compatibility no-ops: callers still exist around AI audio + screen changes.
  function syncAutoUpdateControls() {}
  function stopAutoUpdateTimer() {
    if (state.autoTimer) {
      window.clearInterval(state.autoTimer);
      state.autoTimer = null;
    }
  }
  function postponeAutoUpdateForAudio() {}
  function resetAutoUpdateTimer() {
    stopAutoUpdateTimer();
  }

  return {
    syncAutoUpdateControls,
    stopAutoUpdateTimer,
    audioWorkInProgress,
    postponeAutoUpdateForAudio,
    resetAutoUpdateTimer
  };
}
