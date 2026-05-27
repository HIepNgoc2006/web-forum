import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { publicConfig } from '../core/config.js';
import { createRateLimiter, getClientIp, signJwt, verifyJwt } from '../core/security.js';

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml']
]);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function ok(response, data, statusCode = 200) {
  sendJson(response, statusCode, { data });
}

function fail(response, error) {
  const statusCode = error.statusCode ?? 500;
  sendJson(response, statusCode, {
    error: {
      message: statusCode === 500 ? 'Lỗi máy chủ nội bộ' : error.message
    }
  });
}

async function readJson(request, maxBytes = 1_600_000) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error('Dữ liệu gửi lên quá lớn');
      error.statusCode = 413;
      throw error;
    }
  }

  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error('Nội dung JSON không hợp lệ');
    error.statusCode = 400;
    throw error;
  }
}

function match(parts, pattern) {
  if (parts.length !== pattern.length) {
    return null;
  }

  const params = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index];
    const actual = parts[index];
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = actual;
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function requireAdmin(request, jwtSecret) {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const payload = verifyJwt(token, jwtSecret);
    if (payload.role !== 'admin') {
      throw new Error('Không có quyền truy cập');
    }
    return payload;
  } catch {
    const error = new Error('Không có quyền truy cập');
    error.statusCode = 401;
    throw error;
  }
}

async function serveStatic(request, response, staticRoot) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const url = new URL(request.url, 'http://localhost');
  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const candidate = path.normalize(path.join(staticRoot, requestedPath));
  const safeRoot = path.normalize(staticRoot);
  if (!candidate.startsWith(safeRoot)) {
    return false;
  }

  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) {
      return false;
    }
    const extension = path.extname(candidate).toLowerCase();
    response.writeHead(200, {
      'content-type': MIME_TYPES.get(extension) ?? 'application/octet-stream'
    });
    if (request.method === 'HEAD') {
      response.end();
    } else {
      response.end(await fs.readFile(candidate));
    }
    return true;
  } catch {
    if (!url.pathname.startsWith('/api') && !url.pathname.startsWith('/events')) {
      const indexPath = path.join(staticRoot, 'index.html');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(await fs.readFile(indexPath));
      return true;
    }
    return false;
  }
}

export function createHttpServer({
  service,
  realtime,
  jwtSecret,
  adminUsername,
  adminPassword,
  staticRoot = path.resolve('public')
}) {
  const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const ip = getClientIp(request);

    try {
      if (request.method === 'GET' && url.pathname === '/events' && realtime.handle) {
        realtime.handle(request, response);
        return;
      }

      if (parts[0] === 'api' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        const rate = limiter.check(`${ip}:${request.method}:${url.pathname}`);
        if (!rate.ok) {
          const error = new Error(`Quá nhiều yêu cầu. Thử lại sau ${rate.retryAfter}s`);
          error.statusCode = 429;
          throw error;
        }
      }

      if (request.method === 'GET' && url.pathname === '/api/config') {
        ok(response, publicConfig());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/boards') {
        ok(response, await service.listBoards());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/stats') {
        ok(response, await service.getStats());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/posts/latest') {
        ok(response, await service.listLatestPosts(url.searchParams.get('limit') ?? 10));
        return;
      }

      let params = match(parts, ['api', 'boards', ':boardSlug', 'threads']);
      if (params && request.method === 'GET') {
        ok(response, await service.listThreads(params.boardSlug));
        return;
      }
      if (params && request.method === 'POST') {
        const body = await readJson(request);
        ok(
          response,
          await service.createThread({
            boardSlug: params.boardSlug,
            body: body.body,
            image: body.image,
            captchaToken: body.captchaToken,
            ip,
            posterToken: body.posterToken
          }),
          201
        );
        return;
      }

      params = match(parts, ['api', 'boards', ':boardSlug', 'summary']);
      if (params && request.method === 'POST') {
        ok(response, { bullets: await service.summarizeBoard(params.boardSlug) });
        return;
      }

      params = match(parts, ['api', 'threads', ':threadId']);
      if (params && request.method === 'GET') {
        ok(response, await service.getThread(params.threadId));
        return;
      }

      params = match(parts, ['api', 'threads', ':threadId', 'comments']);
      if (params && request.method === 'POST') {
        const body = await readJson(request);
        ok(
          response,
          await service.createComment({
            threadId: params.threadId,
            body: body.body,
            captchaToken: body.captchaToken,
            ip,
            posterToken: body.posterToken
          }),
          201
        );
        return;
      }

      params = match(parts, ['api', 'threads', ':threadId', 'summary']);
      if (params && request.method === 'POST') {
        ok(response, { bullets: await service.summarizeThread(params.threadId) });
        return;
      }

      params = match(parts, ['api', 'threads', ':threadId', 'suggestions']);
      if (params && request.method === 'POST') {
        ok(response, { suggestions: await service.suggestComments(params.threadId) });
        return;
      }

      params = match(parts, ['api', 'posts', ':globalNumber']);
      if (params && request.method === 'GET') {
        ok(response, await service.lookupPost(params.globalNumber));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/admin/login') {
        if (!jwtSecret || !adminUsername || !adminPassword) {
          const error = new Error('Chưa cấu hình tài khoản quản trị viên');
          error.statusCode = 503;
          throw error;
        }
        const body = await readJson(request, 20_000);
        if (body.username !== adminUsername || body.password !== adminPassword) {
          const error = new Error('Thông tin đăng nhập quản trị viên không hợp lệ');
          error.statusCode = 401;
          throw error;
        }
        ok(response, { token: signJwt({ role: 'admin', username: adminUsername }, jwtSecret) });
        return;
      }

      if (url.pathname.startsWith('/api/admin')) {
        requireAdmin(request, jwtSecret);

        if (request.method === 'GET' && url.pathname === '/api/admin/pending') {
          ok(response, await service.listPending());
          return;
        }

        params = match(parts, ['api', 'admin', 'pending', ':id', 'approve']);
        if (params && request.method === 'POST') {
          ok(response, await service.approvePending(params.id));
          return;
        }

        params = match(parts, ['api', 'admin', 'pending', ':id']);
        if (params && request.method === 'DELETE') {
          ok(response, await service.deletePending(params.id));
          return;
        }
      }

      if (await serveStatic(request, response, staticRoot)) {
        return;
      }

      const error = new Error('Không tìm thấy');
      error.statusCode = 404;
      throw error;
    } catch (error) {
      fail(response, error);
    }
  });
}
