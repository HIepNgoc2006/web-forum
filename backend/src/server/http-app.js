import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { publicConfig } from '../core/config.js';
import { createRateLimiter, getClientIp, securityConfigStatus, signJwt, verifyJwt } from '../core/security.js';

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

function sendText(response, statusCode, text, contentType) {
  response.writeHead(statusCode, { 'content-type': contentType });
  response.end(text);
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

function rateLimitForRequest({ method, pathname, parts, ip, limiters }) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || parts[0] !== 'api') {
    return null;
  }

  if (method === 'POST' && parts[1] === 'boards' && parts[3] === 'threads') {
    return { limiter: limiters.thread, key: `${ip}:thread:${parts[2]}` };
  }
  if (method === 'POST' && parts[1] === 'threads' && parts[3] === 'comments') {
    return { limiter: limiters.comment, key: `${ip}:comment:${parts[2]}` };
  }
  if (method === 'POST' && parts[1] === 'boards' && parts[3] === 'summary') {
    return { limiter: limiters.ai, key: `${ip}:ai:board:${parts[2]}` };
  }
  if (method === 'POST' && parts[1] === 'threads' && ['summary', 'suggestions'].includes(parts[3])) {
    return { limiter: limiters.ai, key: `${ip}:ai:thread:${parts[2]}:${parts[3]}` };
  }
  if (method === 'POST' && parts[1] === 'ai' && parts[2] === 'rewrite') {
    return { limiter: limiters.ai, key: `${ip}:ai:rewrite` };
  }
  if (parts[1] === 'admin') {
    return { limiter: limiters.admin, key: `${ip}:admin:${method}:${pathname}` };
  }

  return { limiter: limiters.generic, key: `${ip}:generic:${method}:${pathname}` };
}

function enforceRateLimit(rate) {
  if (!rate) {
    return;
  }

  const result = rate.limiter.check(rate.key);
  if (!result.ok) {
    const error = new Error(`Quá nhiều yêu cầu. Thử lại sau ${result.retryAfter}s`);
    error.statusCode = 429;
    throw error;
  }
}

function adminFiltersFromSearch(searchParams) {
  return {
    boardSlug: searchParams.get('boardSlug') || '',
    label: searchParams.get('label') || '',
    since: searchParams.get('since') || '',
    status: searchParams.get('status') || '',
    action: searchParams.get('action') || ''
  };
}

function escapeXml(value = '') {
  return String(value).replace(/[<>&'"]/g, (character) => {
    const entities = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      "'": '&apos;',
      '"': '&quot;'
    };
    return entities[character];
  });
}

function postPreview(post = {}) {
  return (post.bodyLines || [])
    .map((line) => line.text)
    .join(' ')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
    .trim()
    .slice(0, 300);
}

function absoluteUrl(request, pathName) {
  const protocol = request.headers['x-forwarded-proto'] || 'http';
  const host = request.headers.host || 'localhost';
  return `${protocol}://${host}${pathName}`;
}

function jsonFeed(request, posts = []) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: '36chan - Bài mới nhất',
    home_page_url: absoluteUrl(request, '/'),
    feed_url: absoluteUrl(request, '/feeds/latest.json'),
    items: posts.map((post) => {
      const threadId = post.threadId || post.id;
      const url = absoluteUrl(request, `/#thread/${encodeURIComponent(threadId)}?p=${encodeURIComponent(post.globalNumber)}`);
      return {
        id: String(post.globalNumber),
        url,
        title: `No.${post.globalNumber} /${post.boardSlug}/`,
        content_text: postPreview(post),
        date_published: post.createdAt
      };
    })
  };
}

function rssFeed(request, posts = []) {
  const items = posts
    .map((post) => {
      const threadId = post.threadId || post.id;
      const url = absoluteUrl(request, `/#thread/${encodeURIComponent(threadId)}?p=${encodeURIComponent(post.globalNumber)}`);
      return `
        <item>
          <title>${escapeXml(`No.${post.globalNumber} /${post.boardSlug}/`)}</title>
          <link>${escapeXml(url)}</link>
          <guid isPermaLink="true">${escapeXml(url)}</guid>
          <pubDate>${new Date(post.createdAt).toUTCString()}</pubDate>
          <description>${escapeXml(postPreview(post))}</description>
        </item>
      `;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>36chan - Bài mới nhất</title>
    <link>${escapeXml(absoluteUrl(request, '/'))}</link>
    <description>Bài công khai mới nhất trên 36chan</description>
    ${items}
  </channel>
</rss>`;
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
    if (!url.pathname.startsWith('/api') && !url.pathname.startsWith('/events') && !url.pathname.startsWith('/uploads')) {
      const indexPath = path.join(staticRoot, 'index.html');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(await fs.readFile(indexPath));
      return true;
    }
    return false;
  }
}

async function serveUploadedFile(request, response, uploadRoot) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const url = new URL(request.url, 'http://localhost');
  if (!url.pathname.startsWith('/uploads/')) {
    return false;
  }

  const requestedName = decodeURIComponent(url.pathname.slice('/uploads/'.length));
  const fileName = path.basename(requestedName);
  if (!fileName || fileName !== requestedName) {
    return false;
  }

  const safeRoot = path.resolve(uploadRoot);
  const candidate = path.resolve(safeRoot, fileName);
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
      'content-type': MIME_TYPES.get(extension) ?? 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'public, max-age=31536000, immutable'
    });
    if (request.method === 'HEAD') {
      response.end();
    } else {
      response.end(await fs.readFile(candidate));
    }
    return true;
  } catch {
    return false;
  }
}

export function createHttpServer({
  service,
  realtime,
  jwtSecret,
  adminUsername,
  adminPassword,
  staticRoot = path.resolve('public'),
  uploadRoot = path.resolve('data/uploads')
}) {
  const limiters = {
    thread: createRateLimiter({ limit: 5, windowMs: 60_000 }),
    comment: createRateLimiter({ limit: 20, windowMs: 60_000 }),
    ai: createRateLimiter({ limit: 8, windowMs: 60_000 }),
    admin: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    generic: createRateLimiter({ limit: 60, windowMs: 60_000 })
  };

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const routePath = url.pathname.startsWith('/api/v1/') ? url.pathname.replace('/api/v1', '/api') : url.pathname;
    const parts = routePath.split('/').filter(Boolean);
    const ip = getClientIp(request);

    try {
      if (request.method === 'GET' && url.pathname === '/events' && realtime.handle) {
        realtime.handle(request, response);
        return;
      }

      if (await serveUploadedFile(request, response, uploadRoot)) {
        return;
      }

      enforceRateLimit(rateLimitForRequest({ method: request.method, pathname: routePath, parts, ip, limiters }));

      if (request.method === 'GET' && routePath === '/api/config') {
        ok(response, publicConfig());
        return;
      }

      if (request.method === 'GET' && routePath === '/api/boards') {
        ok(response, await service.listBoards());
        return;
      }

      if (request.method === 'GET' && routePath === '/api/stats') {
        ok(response, await service.getStats());
        return;
      }

      if (request.method === 'GET' && routePath === '/api/health') {
        ok(response, {
          ...(await service.getHealth()),
          security: securityConfigStatus({
            jwtSecret,
            adminUsername,
            adminPassword
          })
        });
        return;
      }

      if (request.method === 'GET' && routePath === '/api/posts/latest') {
        ok(response, await service.listLatestPosts(url.searchParams.get('limit') ?? 10));
        return;
      }

      if (request.method === 'GET' && routePath === '/feeds/latest.json') {
        sendJson(response, 200, jsonFeed(request, await service.listLatestPosts(url.searchParams.get('limit') ?? 20)));
        return;
      }

      if (request.method === 'GET' && routePath === '/feeds/latest.rss') {
        sendText(
          response,
          200,
          rssFeed(request, await service.listLatestPosts(url.searchParams.get('limit') ?? 20)),
          'application/rss+xml; charset=utf-8'
        );
        return;
      }

      if (request.method === 'GET' && routePath === '/api/boards/hot') {
        ok(response, await service.listHotBoards(url.searchParams.get('limit') ?? 8));
        return;
      }

      if (request.method === 'GET' && routePath === '/api/pulse') {
        ok(response, await service.listCampusPulse(url.searchParams.get('limit') ?? 12));
        return;
      }

      if (request.method === 'POST' && routePath === '/api/ai/rewrite') {
        const body = await readJson(request, 20_000);
        ok(response, {
          text: await service.rewriteDraft({
            body: body.body,
            ip,
            posterToken: body.posterToken
          })
        });
        return;
      }

      let params = match(parts, ['api', 'boards', ':boardSlug', 'threads']);
      if (params && request.method === 'GET') {
        const paged =
          url.searchParams.has('page') ||
          url.searchParams.has('pageSize') ||
          url.searchParams.has('q') ||
          url.searchParams.has('search');
        ok(
          response,
          await service.listThreads(params.boardSlug, {
            paged,
            page: url.searchParams.get('page'),
            pageSize: url.searchParams.get('pageSize'),
            q: url.searchParams.get('q') || url.searchParams.get('search') || ''
          })
        );
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
            pollOptions: body.pollOptions,
            options: body.options,
            deletePassword: body.deletePassword,
            captchaToken: body.captchaToken,
            ip,
            posterToken: body.posterToken
          }),
          201
        );
        return;
      }

      params = match(parts, ['api', 'boards', ':boardSlug', 'archive']);
      if (params && request.method === 'GET') {
        ok(response, await service.listArchivedThreads(params.boardSlug));
        return;
      }

      params = match(parts, ['api', 'boards', ':boardSlug', 'summary']);
      if (params && request.method === 'POST') {
        const body = await readJson(request, 20_000);
        ok(response, { bullets: await service.summarizeBoard(params.boardSlug, { ip, posterToken: body.posterToken }) });
        return;
      }

      params = match(parts, ['api', 'threads', ':threadId']);
      if (params && request.method === 'GET') {
        const paged =
          url.searchParams.has('commentsPage') ||
          url.searchParams.has('commentsPageSize') ||
          url.searchParams.has('page') ||
          url.searchParams.has('pageSize');
        ok(
          response,
          await service.getThread(params.threadId, {
            paged,
            commentsPage: url.searchParams.get('commentsPage') || url.searchParams.get('page'),
            commentsPageSize: url.searchParams.get('commentsPageSize') || url.searchParams.get('pageSize'),
            focusGlobalNumber: url.searchParams.get('focusGlobalNumber') || ''
          })
        );
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
            options: body.options,
            deletePassword: body.deletePassword,
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
        const body = await readJson(request, 20_000);
        ok(
          response,
          {
            bullets: await service.summarizeThread(params.threadId, {
              ip,
              posterToken: body.posterToken,
              sinceGlobalNumber: body.sinceGlobalNumber
            })
          }
        );
        return;
      }

      params = match(parts, ['api', 'threads', ':threadId', 'suggestions']);
      if (params && request.method === 'POST') {
        const body = await readJson(request, 20_000);
        ok(response, { suggestions: await service.suggestComments(params.threadId, { ip, posterToken: body.posterToken }) });
        return;
      }

      params = match(parts, ['api', 'threads', ':threadId', 'poll']);
      if (params && request.method === 'POST') {
        const body = await readJson(request, 20_000);
        ok(
          response,
          await service.votePoll(params.threadId, {
            optionId: body.optionId,
            ip,
            posterToken: body.posterToken
          })
        );
        return;
      }

      params = match(parts, ['api', 'posts', ':globalNumber']);
      if (params && request.method === 'GET') {
        ok(response, await service.lookupPost(params.globalNumber));
        return;
      }
      if (params && request.method === 'DELETE') {
        const body = await readJson(request, 20_000);
        ok(
          response,
          await service.deletePost({
            globalNumber: params.globalNumber,
            password: body.password,
            fileOnly: Boolean(body.fileOnly)
          })
        );
        return;
      }
      if (params && request.method === 'POST') {
        const body = await readJson(request, 20_000);
        ok(
          response,
          await service.reportPost({
            globalNumber: params.globalNumber,
            reason: body.reason,
            ip,
            posterToken: body.posterToken
          }),
          201
        );
        return;
      }

      if (request.method === 'POST' && routePath === '/api/admin/login') {
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

      if (routePath.startsWith('/api/admin')) {
        const admin = requireAdmin(request, jwtSecret);
        const filters = adminFiltersFromSearch(url.searchParams);

        if (request.method === 'GET' && routePath === '/api/admin/pending') {
          ok(response, await service.listPending(filters));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/admin/moderation-actions') {
          ok(response, await service.listModerationActions(url.searchParams.get('limit') ?? 50, filters));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/admin/reports') {
          ok(response, await service.listReports(url.searchParams.get('limit') ?? 50, filters));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/admin/deleted') {
          ok(response, await service.listDeleted(url.searchParams.get('limit') ?? 50, filters));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/admin/approved') {
          ok(response, await service.listApprovedHistory(url.searchParams.get('limit') ?? 50, filters));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/admin/sanctions') {
          ok(
            response,
            await service.listSanctions(url.searchParams.get('limit') ?? 50, {
              ...filters,
              kind: url.searchParams.get('kind') || '',
              status: url.searchParams.get('status') || ''
            })
          );
          return;
        }

        params = match(parts, ['api', 'admin', 'posts', ':globalNumber']);
        if (params && request.method === 'GET') {
          ok(response, await service.getAdminPostDetail(params.globalNumber));
          return;
        }

        params = match(parts, ['api', 'admin', 'posts', ':globalNumber', 'sanctions']);
        if (params && request.method === 'POST') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.createSanctionForPost(params.globalNumber, {
              kind: body.kind,
              durationMinutes: body.durationMinutes,
              reason: body.reason,
              actor: admin.username ?? 'admin'
            }),
            201
          );
          return;
        }

        params = match(parts, ['api', 'admin', 'posts', ':globalNumber', 'notes']);
        if (params && request.method === 'POST') {
          const body = await readJson(request, 20_000);
          ok(response, await service.addModeratorNote(params.globalNumber, { note: body.note, actor: admin.username ?? 'admin' }), 201);
          return;
        }

        params = match(parts, ['api', 'admin', 'sanctions', ':id']);
        if (params && request.method === 'DELETE') {
          const body = await readJson(request, 20_000);
          ok(response, await service.revokeSanction(params.id, { reason: body.reason, actor: admin.username ?? 'admin' }));
          return;
        }

        params = match(parts, ['api', 'admin', 'threads', ':threadId', 'archive']);
        if (params && request.method === 'POST') {
          ok(response, await service.archiveThread(params.threadId, 'manual'));
          return;
        }

        params = match(parts, ['api', 'admin', 'pending', 'bulk']);
        if (params && request.method === 'POST') {
          const body = await readJson(request, 40_000);
          const ids = Array.isArray(body.ids) ? body.ids.slice(0, 50) : [];
          const action = body.action === 'approve' ? 'approve' : body.action === 'delete' ? 'delete' : '';
          if (!action || ids.length === 0) {
            const error = new Error('Yêu cầu bulk moderation không hợp lệ');
            error.statusCode = 400;
            throw error;
          }
          const results = [];
          for (const id of ids) {
            results.push(
              action === 'approve'
                ? await service.approvePending(id, { reason: body.reason, actor: admin.username ?? 'admin' })
                : await service.deletePending(id, { reason: body.reason, actor: admin.username ?? 'admin' })
            );
          }
          ok(response, { action, count: results.length, results });
          return;
        }

        params = match(parts, ['api', 'admin', 'pending', ':id', 'approve']);
        if (params && request.method === 'POST') {
          const body = await readJson(request, 20_000);
          ok(response, await service.approvePending(params.id, { reason: body.reason, actor: admin.username ?? 'admin' }));
          return;
        }

        params = match(parts, ['api', 'admin', 'pending', ':id']);
        if (params && request.method === 'DELETE') {
          const body = await readJson(request, 20_000);
          ok(response, await service.deletePending(params.id, { reason: body.reason, actor: admin.username ?? 'admin' }));
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
