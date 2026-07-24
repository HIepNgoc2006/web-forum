import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { legacyHeadHtml, legacyShellHtml } from '@/generated/legacy-shell';
import {
  legacyBodyClassScript,
  legacyInitialRouteScript,
} from '@/lib/legacy-head';
import '@/legacy/styles.css';

const LEGACY_INITIAL_ROUTE_SCRIPT = legacyInitialRouteScript(legacyHeadHtml);
const LEGACY_BODY_CLASS_SCRIPT = legacyBodyClassScript(legacyShellHtml);

export const metadata: Metadata = {
  title: '36chan',
  description:
    'Diễn đàn ảnh sinh viên ẩn danh theo thời gian thực, có kiểm duyệt an toàn.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '36chan',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' }
    ],
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#121214',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') || undefined;
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script
          id="legacy-initial-route-script"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LEGACY_INITIAL_ROUTE_SCRIPT }}
        />
        <script
          id="legacy-initial-body-class-script"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LEGACY_BODY_CLASS_SCRIPT }}
        />
        <script
          id="pwa-register-script"
          nonce={nonce}
          suppressHydrationWarning
          src="/pwa-register.js"
          defer
        />
        {children}
      </body>
    </html>
  );
}
