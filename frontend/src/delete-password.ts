import { deletePasswordKey } from './constants';
import { defaultDeletePassword, normalizeDeletePassword } from './storage';
import type { AnyRecord } from './types';

export function createDeletePasswordController({ deletePasswordInputs, formValue }: AnyRecord) {
  function syncDeletePasswordInputs(value = defaultDeletePassword()) {
    const password = String(value ?? '');
    deletePasswordInputs.forEach((input) => {
      if (input.value !== password) {
        input.value = password;
      }
    });
  }

  function updateDeletePassword(value) {
    const password = normalizeDeletePassword(value);
    if (password) {
      localStorage.setItem(deletePasswordKey, password);
    } else {
      localStorage.removeItem(deletePasswordKey);
    }
    syncDeletePasswordInputs(password);
    return password;
  }

  function deletePasswordValue(form) {
    const typedPassword = normalizeDeletePassword(formValue(form, 'deletePassword'));
    const password = typedPassword || defaultDeletePassword();
    localStorage.setItem(deletePasswordKey, password);
    syncDeletePasswordInputs(password);
    return password;
  }

  function bindDeletePasswordInputs() {
    deletePasswordInputs.forEach((input) => {
      input.addEventListener('input', () => updateDeletePassword(input.value));
    });
  }

  return {
    syncDeletePasswordInputs,
    deletePasswordValue,
    bindDeletePasswordInputs
  };
}
