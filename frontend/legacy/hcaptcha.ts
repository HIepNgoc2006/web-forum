import { state } from './state';

function loadHcaptchaScript() {
  if (!state.hcaptchaSiteKey) {
    return Promise.resolve();
  }
  if (window.hcaptcha?.render) {
    return Promise.resolve();
  }
  if (state.hcaptchaReady) {
    return state.hcaptchaReady;
  }
  state.hcaptchaReady = new Promise<void>((resolve, reject) => {
    const onloadName = '__chan36HcaptchaOnLoad';
    let settled = false;
    const cleanup = (callback) => {
      if (window[onloadName] === callback) {
        delete window[onloadName];
      }
    };
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup(finish);
      if (window.hcaptcha?.render) {
        resolve();
      } else {
        reject(new Error('Không tải được hCaptcha'));
      }
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup(finish);
      reject(error);
    };
    window[onloadName] = finish;

    const existing = document.querySelector('script[data-hcaptcha-script]');
    if (existing) {
      if (window.hcaptcha?.render) {
        finish();
      } else {
        existing.addEventListener('load', () => window.setTimeout(finish, 0), { once: true });
        existing.addEventListener('error', fail, { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = `https://js.hcaptcha.com/1/api.js?render=explicit&onload=${onloadName}`;
    script.async = true;
    script.defer = true;
    script.dataset.hcaptchaScript = 'true';
    script.addEventListener('load', () => window.setTimeout(finish, 0), { once: true });
    script.addEventListener('error', fail, { once: true });
    document.head.appendChild(script);
  });
  return state.hcaptchaReady;
}

export function resetHcaptcha(input) {
  if (!state.hcaptchaSiteKey || !window.hcaptcha?.reset || !input?.id) {
    return;
  }
  const host = document.querySelector(`[data-hcaptcha-target="${input.id}"]`);
  const widgetId = host?.dataset.hcaptchaWidgetId;
  if (widgetId !== undefined) {
    window.hcaptcha.reset(Number(widgetId));
    input.value = '';
  }
}

export async function setupHcaptcha(onError = (_message) => {}) {
  if (!state.hcaptchaSiteKey) {
    return;
  }
  document.querySelectorAll('[data-hcaptcha-target]').forEach((host) => {
    const input = document.getElementById(host.dataset.hcaptchaTarget);
    if (input) {
      input.value = '';
      input.classList.add('captcha-token-hidden');
    }
    host.classList.remove('hidden');
  });

  await loadHcaptchaScript();
  if (!window.hcaptcha?.render) {
    throw new Error('Không tải được hCaptcha');
  }

  document.querySelectorAll('[data-hcaptcha-target]').forEach((host) => {
    if (host.dataset.hcaptchaWidgetId !== undefined) {
      return;
    }
    const input = document.getElementById(host.dataset.hcaptchaTarget);
    if (!input) {
      return;
    }
    const widgetId = window.hcaptcha.render(host, {
      sitekey: state.hcaptchaSiteKey,
      callback(token) {
        input.value = token;
      },
      'expired-callback'() {
        input.value = '';
      },
      'error-callback'() {
        input.value = '';
        onError('hCaptcha gặp lỗi, vui lòng thử lại.');
      }
    });
    host.dataset.hcaptchaWidgetId = String(widgetId);
  });
}
