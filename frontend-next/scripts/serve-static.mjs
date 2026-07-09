#!/usr/bin/env node
/**
 * Dependency-free static file server for the frontend-next static export.
 * Serves the Next.js `out/` directory after `npm run build`.
 * POC-only — not production hosting.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_PORT = 3001;
const DEFAULT_ROOT = 'out';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function contentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function resolveRootDir(arg) {
  const candidate = path.resolve(packageRoot, arg || DEFAULT_ROOT);
  return candidate;
}

function isInsideRoot(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendFile(res, filePath) {
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, { 'Content-Type': contentType(filePath) });
  stream.on('error', () => {
    if (!res.headersSent) {
      send(res, 500, 'Internal Server Error', { 'Content-Type': 'text/plain; charset=utf-8' });
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

function main() {
  const rootArg = process.argv[2] || DEFAULT_ROOT;
  const rootDir = resolveRootDir(rootArg);
  const port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    console.error(`Invalid PORT: ${process.env.PORT}`);
    process.exit(1);
  }

  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    console.error(
      'Static export not found. Run npm --prefix frontend-next run build first.',
    );
    console.error(`Expected directory: ${rootDir}`);
    process.exit(1);
  }

  const indexPath = path.join(rootDir, 'index.html');
  const hasIndex = fs.existsSync(indexPath) && fs.statSync(indexPath).isFile();

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0')) {
        send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }

      // Normalize request path and map / to index.html.
      // Strip leading slashes so path.join never treats the segment as absolute
      // (on Windows, join('C:\\out', '/index.html') would drop the root).
      let relativePath = pathname.replace(/^[/\\]+/, '');
      if (relativePath === '' || relativePath === '.') {
        relativePath = 'index.html';
      }

      const requested = path.normalize(path.join(rootDir, relativePath));
      if (!isInsideRoot(rootDir, requested)) {
        send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }

      if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
        sendFile(res, requested);
        return;
      }

      // Directory: try index.html inside it
      if (fs.existsSync(requested) && fs.statSync(requested).isDirectory()) {
        const dirIndex = path.join(requested, 'index.html');
        if (isInsideRoot(rootDir, dirIndex) && fs.existsSync(dirIndex) && fs.statSync(dirIndex).isFile()) {
          sendFile(res, dirIndex);
          return;
        }
      }

      // SPA fallback for missing paths (static export catch-all shell)
      if (hasIndex && isInsideRoot(rootDir, indexPath)) {
        sendFile(res, indexPath);
        return;
      }

      send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
    } catch {
      send(res, 500, 'Internal Server Error', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
  });

  server.listen(port, () => {
    console.log('frontend-next static export preview (POC only)');
    console.log(`Serving: ${rootDir}`);
    console.log(`URL:     http://localhost:${port}/`);
    console.log('Production still uses the Vite frontend. Backend static serving is unchanged.');
  });
}

// Allow import without auto-start (tests); run when executed directly.
const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main();
}
