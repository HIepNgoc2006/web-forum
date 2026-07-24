import type { AnyRecord } from './types';
import { API_BASE_URL } from './constants';
import { withUrlBase } from './format';
import { state } from './state';

export async function api(path, options: AnyRecord = {}) {
  const {
    auth = 'admin',
    timeoutMs,
    timeoutMessage = 'AI phản hồi quá lâu, vui lòng thử lại.',
    signal,
    ...fetchOptions
  } = options;
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  if (auth === 'account' && state.accountToken) {
    headers.authorization = `Bearer ${state.accountToken}`;
  } else if (auth === 'admin' && state.token) {
    headers.authorization = `Bearer ${state.token}`;
  }

  let timeoutId = null;
  let timedOut = false;
  let abortListener = null;
  if ((timeoutMs || signal) && window.AbortController) {
    const controller = new AbortController();
    fetchOptions.signal = controller.signal;
    if (signal?.aborted) {
      controller.abort(signal.reason);
    } else if (signal) {
      abortListener = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abortListener, { once: true });
    }
    if (timeoutMs) {
      timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }
  } else if (signal) {
    fetchOptions.signal = signal;
  }

  let response;
  try {
    response = await fetch(withUrlBase(path, API_BASE_URL), { ...fetchOptions, headers });
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(timeoutMessage, { cause: error });
      timeoutError.timedOut = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Yêu cầu thất bại');
    error.statusCode = response.status;
    error.setupRequired = payload.error?.setupRequired;
    error.requires2FA = payload.error?.requires2FA;
    throw error;
  }
  return payload.data;
}
