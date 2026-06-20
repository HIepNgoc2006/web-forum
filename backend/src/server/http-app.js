import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import {
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_THUMBNAIL_BYTES,
  publicConfig,
  readPositiveInteger
} from '../core/config.js';
import { createRateLimiter, getClientIp, securityConfigStatus, signJwt, verifyJwt } from '../core/security.js';

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
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
      message: statusCode === 500 ? 'Lỗi máy chủ nội bộ' : error.message,
      setupRequired: error.setupRequired,
      requires2FA: error.requires2FA
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

function imageUploadJsonLimit() {
  return (
    readPositiveInteger(process.env.MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES) +
    readPositiveInteger(process.env.MAX_THUMBNAIL_BYTES, DEFAULT_MAX_THUMBNAIL_BYTES) +
    80_000
  );
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

async function requireAdmin(request, jwtSecret, service) {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  let payload;
  try {
    payload = verifyJwt(token, jwtSecret);
  } catch {
    const error = new Error('Không có quyền truy cập');
    error.statusCode = 401;
    throw error;
  }
  if (payload.role !== 'admin') {
    const error = new Error('Không có quyền truy cập');
    error.statusCode = 401;
    throw error;
  }
  if (payload.isTwoFactorVerified) {
    return payload;
  }
  if (service && payload.sub) {
    const user = await service.getAccount(payload.sub);
    if (user.twoFactorEnabled) {
      const error = new Error('Yêu cầu xác thực 2FA để tiếp tục');
      error.statusCode = 401;
      error.requires2FA = true;
      throw error;
    }
    if (process.env.NODE_ENV === 'test') {
      return payload;
    }
    const error = new Error('Yêu cầu cài đặt 2FA cho tài khoản quản trị');
    error.statusCode = 403;
    error.setupRequired = true;
    throw error;
  }
  const error = new Error('Yêu cầu xác thực 2FA để tiếp tục');
  error.statusCode = 401;
  error.requires2FA = true;
  throw error;
}

function requireAccount(request, jwtSecret, service, { allowAdmin2FASetup = false } = {}) {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const payload = verifyJwt(token, jwtSecret);
    if (!['user', 'admin'].includes(payload.role) || !payload.sub) {
      throw new Error('Không có quyền truy cập');
    }
    if (service?.isSessionRevoked?.(token)) {
      throw new Error('Phiên đăng nhập đã bị thu hồi');
    }
    if (payload.isTwoFactorVerified === false && !(allowAdmin2FASetup && payload.role === 'admin')) {
      const error = new Error('Yêu cầu xác thực 2FA');
      error.statusCode = 401;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.statusCode) throw error;
    const err = new Error('Vui lòng đăng nhập tài khoản');
    err.statusCode = 401;
    throw err;
  }
}

function getOptionalAccount(request, jwtSecret, service) {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return undefined;
  try {
    const payload = verifyJwt(token, jwtSecret);
    if (service?.isSessionRevoked?.(token)) return undefined;
    if (payload.role === 'user' && payload.sub) return payload.sub;
  } catch {}
  return undefined;
}

// Resolves a verified capcode role for a post. The role is read from live
// account state (not the token claim) so a revoked/demoted account cannot keep
// stamping posts, and only the privileged roles are ever returned. Returns null
// unless the poster explicitly requested a capcode AND is authorized.
async function getOptionalCapcode(request, jwtSecret, service, requested) {
  if (!requested) return null;
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    const payload = verifyJwt(token, jwtSecret);
    if (service?.isSessionRevoked?.(token)) return null;
    if (!payload.sub) return null;
    const account = await service.getAccount(payload.sub);
    if (account && (account.role === 'admin' || account.role === 'moderator')) {
      return account.role;
    }
  } catch {}
  return null;
}

function accountToken(account, jwtSecret, isTwoFactorVerified = null) {
  if (!jwtSecret) {
    const error = new Error('Chưa cấu hình JWT_SECRET cho tài khoản');
    error.statusCode = 503;
    throw error;
  }
  let verified = isTwoFactorVerified;
  if (verified === null) {
    verified = account.role === 'admin' || account.role === 'moderator'
      ? Boolean(account.twoFactorEnabled)
      : !account.twoFactorEnabled;
  }
  return signJwt({
    role: account.role || 'user',
    sub: account.id,
    username: account.username,
    isTwoFactorVerified: verified
  }, jwtSecret, {
    expiresInSeconds: 60 * 60 * 24 * 14
  });
}

function requireAccountJwt(jwtSecret) {
  if (!jwtSecret) {
    const error = new Error('Chưa cấu hình JWT_SECRET cho tài khoản');
    error.statusCode = 503;
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
  if (method === 'POST' && parts[1] === 'ai') {
    return { limiter: limiters.ai, key: `${ip}:ai:${parts[2] ?? 'generic'}` };
  }
  if (method === 'GET' && parts[1] === 'search') {
    return { limiter: limiters.search, key: `${ip}:search:${pathname}` };
  }
  if (parts[1] === 'account') {
    return { limiter: limiters.account, key: `${ip}:account:${method}:${pathname}` };
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
  } catch (error) {
    console.error('HTTP 500 ERROR:', error);
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
    account: createRateLimiter({ limit: 20, windowMs: 60_000 }),
    admin: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    search: createRateLimiter({ limit: 10, windowMs: 60_000 }),
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
        const security = securityConfigStatus({
          jwtSecret,
          adminUsername,
          adminPassword
        });
        const health = await service.getHealth();
        const payload = {
          ...health,
          captcha: {
            provider: 'hcaptcha',
            configured: security.hcaptchaConfigured
          },
          security
        };
        ok(response, payload, health.status === 'ok' ? 200 : 503);
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
            tone: body.tone,
            ip,
            posterToken: body.posterToken
          })
        });
        return;
      }

      if (request.method === 'POST' && routePath === '/api/ai/translate') {
        const body = await readJson(request, 40_000);
        ok(response, await service.translateDraft({
          text: body.text ?? body.body,
          targetLang: body.targetLang,
          ip,
          posterToken: body.posterToken
        }));
        return;
      }

      if (request.method === 'POST' && routePath === '/api/ai/transcribe') {
        const body = await readJson(request, 18_000_000);
        ok(response, await service.transcribeAudio({
          audio: { data: body.data, mimeType: body.mimeType, filename: body.filename },
          ip,
          posterToken: body.posterToken
        }));
        return;
      }

      if (request.method === 'POST' && routePath === '/api/ai/caption') {
        const body = await readJson(request, 12_000_000);
        ok(response, await service.captionImage({
          image: { data: body.data, mimeType: body.mimeType },
          mode: body.mode,
          ip,
          posterToken: body.posterToken
        }));
        return;
      }

      if (request.method === 'POST' && routePath === '/api/ai/speak') {
        const body = await readJson(request, 40_000);
        ok(response, await service.speakText({
          text: body.text ?? body.body,
          voice: body.voice,
          languageCode: body.languageCode,
          ip,
          posterToken: body.posterToken
        }));
        return;
      }

      if (request.method === 'POST' && routePath === '/api/account/register') {
        requireAccountJwt(jwtSecret);
        const body = await readJson(request, 20_000);
        const { account, recoveryCode } = await service.registerAccount({
          username: body.username,
          password: body.password,
          captchaToken: body.captchaToken,
          ip
        });
        ok(response, { account, recoveryCode, token: accountToken(account, jwtSecret) }, 201);
        return;
      }

      if (request.method === 'POST' && routePath === '/api/account/forgot-password') {
        requireAccountJwt(jwtSecret);
        const body = await readJson(request, 20_000);
        // Intentionally does NOT issue a session token: the user must log in
        // afterwards, which re-applies 2FA if the account has it enabled.
        const { recoveryCode } = await service.resetAccountPasswordWithRecoveryCode({
          username: body.username,
          recoveryCode: body.recoveryCode,
          newPassword: body.newPassword,
          captchaToken: body.captchaToken,
          ip
        });
        ok(response, { ok: true, recoveryCode });
        return;
      }

      if (request.method === 'POST' && routePath === '/api/account/login') {
        requireAccountJwt(jwtSecret);
        const body = await readJson(request, 20_000);
        const account = await service.loginAccount({
          username: body.username,
          password: body.password,
          captchaToken: body.captchaToken,
          ip
        });
        if (account.twoFactorEnabled) {
          ok(response, {
            requires2FA: true,
            tempToken: signJwt(
              { role: account.role || 'user', sub: account.id, username: account.username, isTwoFactorVerified: false },
              jwtSecret,
              { expiresInSeconds: 300 }
            )
          });
        } else {
          ok(response, { account, token: accountToken(account, jwtSecret) });
        }
        return;
      }

      if (request.method === 'POST' && routePath === '/api/auth/2fa/verify') {
        requireAccountJwt(jwtSecret);
        const body = await readJson(request, 20_000);
        let payload;
        try {
          payload = verifyJwt(body.tempToken, jwtSecret);
        } catch {
          const error = new Error('Yêu cầu xác thực đã hết hạn hoặc không hợp lệ');
          error.statusCode = 400;
          throw error;
        }
        const result = await service.verify2FALogin(payload.sub, body.code);
        ok(response, { ok: true, token: accountToken(result.account, jwtSecret, true), account: result.account });
        return;
      }

      if (request.method === 'POST' && routePath === '/api/auth/2fa/backup-login') {
        requireAccountJwt(jwtSecret);
        const body = await readJson(request, 20_000);
        let payload;
        try {
          payload = verifyJwt(body.tempToken, jwtSecret);
        } catch {
          const error = new Error('Yêu cầu xác thực đã hết hạn hoặc không hợp lệ');
          error.statusCode = 400;
          throw error;
        }
        const result = await service.verifyBackupCodeLogin(payload.sub, body.code);
        ok(response, { ok: true, token: accountToken(result.account, jwtSecret, true), account: result.account });
        return;
      }

      if (request.method === 'POST' && routePath === '/api/account/logout') {
        const header = request.headers.authorization ?? '';
        const rawToken = header.startsWith('Bearer ') ? header.slice(7) : '';
        if (rawToken) {
          await service.logoutAccount(rawToken);
        }
        ok(response, { ok: true });
        return;
      }

      if (request.method === 'POST' && routePath === '/api/auth/webauthn/login-options') {
        const body = await readJson(request, 20_000);
        const hostHeader = request.headers.host || 'localhost';
        const rpID = hostHeader.split(':')[0];
        ok(response, await service.generateWebAuthnLoginOptions(body.username, rpID));
        return;
      }

      if (request.method === 'POST' && routePath === '/api/auth/webauthn/login-verify') {
        requireAccountJwt(jwtSecret);
        const body = await readJson(request, 20_000);
        const hostHeader = request.headers.host || 'localhost';
        const rpID = hostHeader.split(':')[0];
        const origin = request.headers.origin || request.headers.referer || 'http://localhost:3000';
        const cleanOrigin = new URL(origin).origin;
        const { account } = await service.verifyWebAuthnLoginResponse({
          username: body.username,
          body: body.assertionResponse,
          origin: cleanOrigin,
          rpID
        });
        // A passkey requires user verification (biometric/PIN), so it is a
        // strong second factor on its own: issue a fully-verified token so an
        // admin can sign in with a passkey alone (no separate TOTP step).
        ok(response, { account, token: accountToken(account, jwtSecret, true) });
        return;
      }

      if (routePath.startsWith('/api/account')) {
        // Like 2FA setup, passkey management must be reachable by an admin who
        // has only password-authenticated (isTwoFactorVerified === false), so a
        // fresh admin can enroll a passkey before any TOTP is configured.
        const allowAdmin2FASetup =
          ['/api/account/2fa/setup', '/api/account/2fa/verify'].includes(routePath) ||
          routePath === '/api/account/passkeys' ||
          routePath.startsWith('/api/account/passkeys/');
        const accountSession = requireAccount(request, jwtSecret, service, { allowAdmin2FASetup });

        if (request.method === 'GET' && routePath === '/api/account/posts') {
          const accountSession = requireAccount(request, jwtSecret, service);
          ok(response, await service.listAccountPosts(accountSession.sub));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/account/me') {
          ok(response, await service.getAccount(accountSession.sub));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/account/passkeys') {
          ok(response, await service.listPasskeys(accountSession.sub));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/passkeys/register-options') {
          const hostHeader = request.headers.host || 'localhost';
          const rpID = hostHeader.split(':')[0];
          ok(response, await service.generateWebAuthnRegisterOptions(accountSession.sub, rpID));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/passkeys/register-verify') {
          const body = await readJson(request, 20_000);
          const hostHeader = request.headers.host || 'localhost';
          const rpID = hostHeader.split(':')[0];
          const origin = request.headers.origin || request.headers.referer || 'http://localhost:3000';
          const cleanOrigin = new URL(origin).origin;
          ok(response, await service.verifyWebAuthnRegisterResponse(accountSession.sub, { body, origin: cleanOrigin, rpID }));
          return;
        }

        const accountParams = match(parts, ['api', 'account', 'passkeys', ':id']);
        if (accountParams && request.method === 'DELETE') {
          ok(response, await service.deletePasskey(accountSession.sub, accountParams.id));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/account/private-data') {
          ok(response, await service.getAccountPrivateData(accountSession.sub));
          return;
        }

        if (request.method === 'PUT' && routePath === '/api/account/private-data') {
          const body = await readJson(request, 500_000);
          ok(response, await service.updateAccountPrivateData(accountSession.sub, body.privateData ?? body));
          return;
        }

        if (request.method === 'DELETE' && routePath === '/api/account/private-data') {
          ok(response, await service.clearAccountPrivateData(accountSession.sub, url.searchParams.get('section') || ''));
          return;
        }

        if (request.method === 'PUT' && routePath === '/api/account/settings') {
          const body = await readJson(request, 20_000);
          ok(response, await service.updateAccountSettings(accountSession.sub, body.settings ?? body));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/2fa/setup') {
          ok(response, await service.generate2FASetup(accountSession.sub));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/2fa/verify') {
          const body = await readJson(request, 20_000);
          ok(response, await service.verify2FASetup(accountSession.sub, body.code));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/2fa/disable') {
          const body = await readJson(request, 20_000);
          ok(response, await service.disable2FA(accountSession.sub, body.password));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/recovery-code') {
          const body = await readJson(request, 20_000);
          const { recoveryCode } = await service.regenerateRecoveryCode(accountSession.sub, body.password);
          ok(response, { ok: true, recoveryCode });
          return;
        }
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
        const body = await readJson(request, imageUploadJsonLimit());
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
            posterToken: body.posterToken,
            displayName: body.displayName,
            capcode: await getOptionalCapcode(request, jwtSecret, service, body.capcode),
            accountId: getOptionalAccount(request, jwtSecret, service)
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
            commentsSort: url.searchParams.get('commentsSort') || '',
            focusGlobalNumber: url.searchParams.get('focusGlobalNumber') || ''
          })
        );
        return;
      }

      params = match(parts, ['api', 'threads', ':threadId', 'comments']);
      if (params && request.method === 'POST') {
        const body = await readJson(request, imageUploadJsonLimit());
        ok(
          response,
          await service.createComment({
            threadId: params.threadId,
            body: body.body,
            image: body.image,
            options: body.options,
            deletePassword: body.deletePassword,
            captchaToken: body.captchaToken,
            ip,
            posterToken: body.posterToken,
            displayName: body.displayName,
            capcode: await getOptionalCapcode(request, jwtSecret, service, body.capcode),
            accountId: getOptionalAccount(request, jwtSecret, service)
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

      params = match(parts, ['api', 'posts', ':globalNumber', 'vote']);
      if (params && request.method === 'POST') {
        const account = requireAccount(request, jwtSecret, service);
        const body = await readJson(request, 20_000);
        ok(
          response,
          await service.votePost({
            globalNumber: params.globalNumber,
            direction: body.direction,
            accountId: account.sub
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
        const adminAccount = await service.getOrCreateAdminAccount(adminUsername, adminPassword);
        if (adminAccount.twoFactorEnabled) {
          ok(response, {
            requires2FA: true,
            tempToken: signJwt(
              { role: 'admin', username: adminUsername, sub: adminAccount.id, isTwoFactorVerified: false },
              jwtSecret,
              { expiresInSeconds: 300 }
            )
          });
        } else {
          ok(response, { token: accountToken(adminAccount, jwtSecret, false) });
        }
        return;
      }

      if (routePath.startsWith('/api/admin')) {
        const admin = await requireAdmin(request, jwtSecret, service);
        const filters = adminFiltersFromSearch(url.searchParams);

        if (request.method === 'GET' && routePath === '/api/admin/analytics') {
          ok(response, await service.getAnalytics());
          return;
        }

        if (request.method === 'GET' && routePath === '/api/admin/health') {
          const health = await service.getAdminHealth();
          const security = securityConfigStatus({
            jwtSecret,
            adminUsername,
            adminPassword
          });
          ok(response, {
            ...health,
            captcha: {
              provider: 'hcaptcha',
              configured: security.hcaptchaConfigured
            },
            security: {
              adminConfigured: security.adminConfigured,
              warnings: security.warnings
            }
          });
          return;
        }

        if (request.method === 'POST' && routePath === '/api/admin/board-digest') {
          ok(response, await service.generateBoardDigest({ ip, actor: admin.username ?? 'admin' }));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/admin/pending') {
          ok(response, await service.listPending(filters));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/admin/boards') {
          ok(response, await service.listAdminBoards());
          return;
        }

        if (request.method === 'POST' && routePath === '/api/admin/boards') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.createBoard(
              {
                slug: body.slug,
                name: body.name,
                category: body.category,
                description: body.description,
                isHidden: body.isHidden,
                isArchived: body.isArchived
              },
              { actor: admin.username ?? 'admin' }
            ),
            201
          );
          return;
        }

        params = match(parts, ['api', 'admin', 'boards', ':boardSlug']);
        if (params && request.method === 'PUT') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.updateBoard(
              params.boardSlug,
              {
                name: body.name,
                category: body.category,
                description: body.description,
                isHidden: body.isHidden,
                isArchived: body.isArchived
              },
              { actor: admin.username ?? 'admin' }
            )
          );
          return;
        }
        if (params && request.method === 'DELETE') {
          ok(response, await service.deleteBoard(params.boardSlug, { actor: admin.username ?? 'admin' }));
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
        if (params && request.method === 'DELETE') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.adminDeletePost(params.globalNumber, {
              reason: body.reason,
              fileOnly: Boolean(body.fileOnly),
              actor: admin.username ?? 'admin'
            })
          );
          return;
        }

        params = match(parts, ['api', 'admin', 'posts', ':globalNumber', 'reports', 'summary']);
        if (params && request.method === 'POST') {
          const summary = await service.summarizePostReports(params.globalNumber, {
            ip,
            actor: admin.username ?? 'admin'
          });
          ok(response, {
            summary,
            label: 'Nội dung do AI tổng hợp'
          });
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

        params = match(parts, ['api', 'admin', 'threads', ':threadId', 'sticky']);
        if (params && (request.method === 'POST' || request.method === 'DELETE')) {
          ok(
            response,
            await service.setThreadSticky(params.threadId, request.method === 'POST', { actor: admin.username ?? 'admin' })
          );
          return;
        }

        params = match(parts, ['api', 'admin', 'threads', ':threadId', 'lock']);
        if (params && (request.method === 'POST' || request.method === 'DELETE')) {
          ok(
            response,
            await service.setThreadLocked(params.threadId, request.method === 'POST', { actor: admin.username ?? 'admin' })
          );
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
      console.error('API ERROR:', error);
      fail(response, error);
    }
  });
}
