import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const backendOrigin = new URL(
  process.env.BACKEND_ORIGIN || 'http://127.0.0.1:3000',
).origin;
const legacyUiRewrites = [
  { source: '/', destination: '/legacy' },
  { source: '/home', destination: '/legacy' },
  { source: '/board/:slug', destination: '/legacy' },
  { source: '/thread/:id', destination: '/legacy' },
  { source: '/catalog/:slug', destination: '/legacy' },
  { source: '/archive/:slug', destination: '/legacy' },
  { source: '/policy', destination: '/legacy' },
  { source: '/policy/:section', destination: '/legacy' },
  { source: '/register', destination: '/legacy' },
  { source: '/login', destination: '/legacy' },
  { source: '/forgot', destination: '/legacy' },
  { source: '/account', destination: '/legacy' },
  { source: '/messages', destination: '/legacy' },
  { source: '/messages/:conversationId', destination: '/legacy' },
  { source: '/admin', destination: '/legacy' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.VERCEL === '1' ? undefined : 'standalone',
  distDir: '.next',
  outputFileTracingRoot: packageRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: legacyUiRewrites,
      afterFiles: [
        { source: '/api/:path*', destination: `${backendOrigin}/api/:path*` },
        { source: '/socket.io/:path*', destination: `${backendOrigin}/socket.io/:path*` },
        { source: '/events', destination: `${backendOrigin}/events` },
        { source: '/uploads/:path*', destination: `${backendOrigin}/uploads/:path*` },
        { source: '/feeds/:path*', destination: `${backendOrigin}/feeds/:path*` },
      ],
    };
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), geolocation=(), payment=(), usb=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
