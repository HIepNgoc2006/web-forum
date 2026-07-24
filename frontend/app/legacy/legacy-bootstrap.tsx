'use client';

import { useEffect, useState } from 'react';

import { legacyHashForPath } from '@/lib/routes';
import { StartupScreen } from './startup-screen';

declare global {
  interface Window {
    __36chanNextBootstrap?: Promise<void>;
  }
}

export function LegacyBootstrap() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const root = document.getElementById('nextLegacyRoot');
    if (!root) {
      setError('Không tìm thấy giao diện để khởi động. Vui lòng tải lại trang.');
      return;
    }

    root.hidden = true;
    root.dataset.bootstrapState = 'loading';
    root.setAttribute('aria-busy', 'true');

    const legacyHash = legacyHashForPath(
      window.location.pathname,
      window.location.search,
    );
    if (!window.location.hash && legacyHash && legacyHash !== '#home') {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}${legacyHash}`,
      );
    }

    window.__36chanNextBootstrap ??= (async () => {
      const [appModule] = await Promise.all([
        import('@/legacy/app'),
        import('@/legacy/chatbot'),
      ]);
      await appModule.appReady;
    })();

    void window.__36chanNextBootstrap.then(
      () => {
        if (!active) return;
        root.dataset.bootstrapState = 'ready';
        root.setAttribute('aria-busy', 'false');
        root.hidden = false;
        setReady(true);
      },
      (cause: unknown) => {
        console.error('36chan client bootstrap failed', cause);
        if (!active) return;
        root.dataset.bootstrapState = 'error';
        root.setAttribute('aria-busy', 'false');
        setError('Không thể khởi động giao diện. Vui lòng tải lại trang.');
      },
    );

    return () => {
      active = false;
    };
  }, []);

  if (ready) return null;

  return (
    <StartupScreen
      error={error}
      onRetry={error ? () => window.location.reload() : undefined}
    />
  );
}
