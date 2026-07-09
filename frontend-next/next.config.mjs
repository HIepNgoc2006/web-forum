import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static SPA export for the POC — no Node server required for hosting.
  // Production still serves the Vite frontend from frontend/dist.
  output: 'export',
  // Keep build artifacts out of the way of the Vite frontend dist.
  distDir: '.next',
  // Pin tracing root so parent lockfiles outside this package are ignored.
  outputFileTracingRoot: packageRoot,
  // next/image optimization requires a server; disabled for static export.
  images: {
    unoptimized: true,
  },
  // Do not set basePath/assetPrefix — this POC is standalone, not production.
  // trailingSlash can help static hosts; leave default for minimal surface.
};

export default nextConfig;
