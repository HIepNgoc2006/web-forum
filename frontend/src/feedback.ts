import { els } from './dom';
import type { AnyRecord } from './types';

type ToastOptions = {
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
};

export function showToast(message: string, options: ToastOptions = {}) {
  const { actionLabel = '', onAction, durationMs = 3400 } = options;
  window.clearTimeout((showToast as AnyRecord).timer);
  if (!els.toast) {
    return;
  }

  els.toast.replaceChildren();
  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = String(message || '');
  els.toast.append(text);

  if (actionLabel && typeof onAction === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action link-button';
    button.textContent = actionLabel;
    button.addEventListener('click', () => {
      els.toast.classList.add('hidden');
      window.clearTimeout((showToast as AnyRecord).timer);
      onAction();
    });
    els.toast.append(button);
  }

  els.toast.classList.remove('hidden');
  (showToast as AnyRecord).timer = window.setTimeout(() => els.toast.classList.add('hidden'), durationMs);
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
