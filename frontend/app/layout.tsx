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
  icons: {
    icon: '/favicon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') || undefined;
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script
          id="legacy-initial-route-script"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: LEGACY_INITIAL_ROUTE_SCRIPT }}
        />
        <script
          id="legacy-initial-body-class-script"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: LEGACY_BODY_CLASS_SCRIPT }}
        />
        {children}
      </body>
    </html>
  );
}
