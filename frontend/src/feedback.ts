import { els } from './dom';
import type { AnyRecord } from './types';

export function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  window.clearTimeout((showToast as AnyRecord).timer);
  (showToast as AnyRecord).timer = window.setTimeout(() => els.toast.classList.add('hidden'), 3400);
}

export function setButtonLoading(button, label = 'Đang gửi...') {
  if (!button) {
    return () => {};
  }
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = label;
  return () => {
    button.disabled = false;
    button.textContent = previousText;
  };
}

export function setFormError(element, message = '') {
  if (!element) {
    return;
  }
  element.textContent = message;
  element.classList.toggle('hidden', !message);
}
