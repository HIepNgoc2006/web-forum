import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: '36chan Next.js POC',
  description:
    'Isolated Next.js proof of concept for 36chan-web. Production UI remains the Vite frontend.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          lineHeight: 1.5,
          color: '#1a1a1a',
          background: '#f6f6f6',
        }}
      >
        {children}
      </body>
    </html>
  );
}
