import { defaultDeletePassword } from './storage';

/** Auto-managed delete password for anonymous posts (localStorage). No form field. */
export function createDeletePasswordController() {
  function deletePasswordValue() {
    return defaultDeletePassword();
  }

  function syncDeletePasswordInputs() {
    // Password is no longer shown in the composer; keep localStorage value warm.
    defaultDeletePassword();
  }

  function bindDeletePasswordInputs() {
    // No composer inputs remain.
  }

  return {
    syncDeletePasswordInputs,
    deletePasswordValue,
    bindDeletePasswordInputs
  };
}
