import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_THUMBNAIL_BYTES,
  publicConfig,
  readPositiveInteger
} from '../core/config.ts';
import type { KlipyClient } from '../core/klipy.ts';
import {
  createRateLimiter,
  getClientIp,
  isTrustProxyEnabled,
  securityConfigStatus,
  signJwt,
  verifyJwt
} from '../core/security.ts';

type AnyRecord = Record<string, any>;
type RouteParams = Record<string, string>;
type HttpRequest = http.IncomingMessage;
type HttpResponse = http.ServerResponse;
type RateLimitFailureMode = 'closed' | 'open';

type CreateHttpServerOptions = {
  service: any;
  realtime: any;
  jwtSecret?: string;
  adminUsername?: string;
  adminPassword?: string;
  staticRoot?: string;
  uploadRoot?: string;
  rateLimitStore?: any;
  rateLimitFailureMode?: RateLimitFailureMode;
  rateLimitLogger?: (error: any) => void;
  gifClient?: KlipyClient;
  forceConnectionClose?: boolean;
};

declare global {
  interface Error {
    statusCode?: number;
    setupRequired?: boolean;
    requires2FA?: boolean;
  }
}

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.apng', 'image/apng'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
  ['.ico', 'image/x-icon'],
  ['.jxl', 'image/jxl'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml']
]);
const SAFE_INLINE_UPLOAD_MIME_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm']
]);
const MAX_MEDIA_PER_POST = 4;
const INITIAL_HOME_SNAPSHOT_MARKER = '<script id="initialHomeSnapshot" type="application/json">null</script>';
const PRIVILEGED_ACCOUNT_ROLES = new Set(['owner', 'admin', 'moderator', 'viewer']);
const STORE_METRIC_NAMES = {
  threads: 'threads',
  comments: 'comments',
  users: 'users',
  reports: 'reports',
  appeals: 'appeals',
  sanctions: 'sanctions',
  moderationActions: 'moderation_actions'
};

function normalizeAdminRole(role = '') {
  const value = String(role || '').toLowerCase();
  return value === 'admin' ? 'owner' : value;
}

function adminPermissionsForRole(role = '') {
  const normalized = normalizeAdminRole(role);
  if (normalized === 'owner') {
    return new Set(['admin:view', 'admin:moderate', 'admin:manage_boards', 'admin:manage_settings', 'admin:manage_users']);
  }
  if (normalized === 'moderator') {
    return new Set(['admin:view', 'admin:moderate']);
  }
  if (normalized === 'viewer') {
    return new Set(['admin:view']);
  }
  return new Set();
}

function adminPermissionForRequest(method, routePath, parts = []) {
  if (routePath === '/api/admin/users' || match(parts, ['api', 'admin', 'users', ':id'])) {
    return 'admin:manage_users';
  }
  if (routePath === '/api/admin/stickers' || match(parts, ['api', 'admin', 'stickers', ':key'])) {
    return 'admin:manage_settings';
  }
  if (
    method === 'PUT' &&
    (routePath === '/api/admin/moderation-settings' || routePath === '/api/admin/site-content')
  ) {
    return 'admin:manage_settings';
  }
  if (routePath === '/api/admin/boards' && method !== 'GET') {
    return 'admin:manage_boards';
  }
  if (match(parts, ['api', 'admin', 'boards', ':boardSlug']) && method !== 'GET') {
    return 'admin:manage_boards';
  }
  if (method !== 'GET' && routePath !== '/api/admin/health' && routePath !== '/api/admin/analytics') {
    return 'admin:moderate';
  }
  return 'admin:view';
}

function hasAdminPermission(role, permission) {
  return adminPermissionsForRole(role).has(permission);
}

// Baseline browser defenses applied to every HTTP response from this server.
// CSP is intentionally moderate: the Vite shell uses inline bootstrap scripts
// and hCaptcha needs third-party script/frame/connect hosts.
const BASE_SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  // microphone=(self): [Nói] uses Web Speech API, which requires mic on this origin.
  // camera/geolocation/payment stay disabled.
  'permissions-policy': 'camera=(), microphone=(self), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' https://js.hcaptcha.com https://*.hcaptcha.com",
    // hCaptcha widgets + click-to-load media embeds (YouTube / Vimeo only).
    "frame-src https://newassets.hcaptcha.com https://*.hcaptcha.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
    "connect-src 'self' ws: wss: https://*.hcaptcha.com",
    "worker-src 'self' blob:"
  ].join('; ')
};

function withSecurityHeaders(headers: Record<string, string | number> = {}): Record<string, string | number> {
  return { ...BASE_SECURITY_HEADERS, ...headers };
}

function isPathInsideRoot(rootDir: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function cacheControlForStatic(extension: string): string {
  if (['.js', '.css', '.woff', '.woff2', '.ttf', '.map'].includes(extension)) {
    return 'public, max-age=31536000, immutable';
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg'].includes(extension)) {
    return 'public, max-age=86400';
  }
  if (extension === '.html') {
    return 'no-cache';
  }
  return 'public, max-age=300';
}

function weakEtagFromStat(stat: { size: number; mtimeMs: number }): string {
  return `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
}

function ifNoneMatchMatches(headerValue: string | string[] | undefined, etag: string): boolean {
  if (!headerValue) {
    return false;
  }
  const raw = Array.isArray(headerValue) ? headerValue.join(',') : String(headerValue);
  return raw
    .split(',')
    .map((part) => part.trim())
    .some((part) => part === '*' || part === etag || part === `W/${etag}` || part === etag.replace(/^W\//, ''));
}

type TtlCacheEntry = { expiresAt: number; value: unknown };

function createTtlCache(ttlMs: number) {
  const entries = new Map<string, TtlCacheEntry>();
  return {
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: unknown) {
      if (ttlMs <= 0) {
        return;
      }
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      // Bound memory: drop oldest entries if the map grows large.
      if (entries.size > 64) {
        const firstKey = entries.keys().next().value;
        if (firstKey !== undefined) {
          entries.delete(firstKey);
        }
      }
    }
  };
}

function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    // Keep comparison time roughly stable for equal-length secrets only; unequal lengths are rejects.
    crypto.timingSafeEqual(a.length ? a : Buffer.from([0]), a.length ? a : Buffer.from([0]));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function extractMetricsToken(request: HttpRequest): string {
  const headerAuth = String(request.headers.authorization || '');
  if (headerAuth.startsWith('Bearer ')) {
    return headerAuth.slice(7).trim();
  }
  const dedicated = request.headers['x-metrics-token'];
  if (dedicated) {
    return String(Array.isArray(dedicated) ? dedicated[0] : dedicated).trim();
  }
  return '';
}

/**
 * Metrics expose capacity/process counters. Production always requires an
 * explicit token because a public reverse proxy makes downstream connections
 * appear loopback even when the original client was remote.
 */
function authorizeMetrics(request: HttpRequest): void {
  const expected = String(process.env.METRICS_TOKEN || '').trim();
  if (expected) {
    const provided = extractMetricsToken(request);
    if (!provided || !timingSafeEqualString(provided, expected)) {
      const error = new Error('Unauthorized');
      error.statusCode = 401;
      throw error;
    }
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    const error = new Error('Metrics yêu cầu METRICS_TOKEN trong production');
    error.statusCode = 401;
    throw error;
  }
}

function resolveCorsOrigin(request: HttpRequest): string | null {
  const allowlist = String(process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const origin = String(request.headers.origin || '').trim();
  if (!origin) {
    return null;
  }
  if (allowlist.length > 0) {
    return allowlist.includes(origin) ? origin : null;
  }
  try {
    const originHost = new URL(origin).host;
    const requestHost = String(request.headers.host || '');
    if (requestHost && originHost === requestHost) {
      return origin;
    }
  } catch {
    // ignore invalid origin
  }
  // Keep cross-origin SSE workable in local/dev when no allowlist is configured.
  if (process.env.NODE_ENV !== 'production') {
    return origin;
  }
  return null;
}

async function sendFileResponse(
  request: HttpRequest,
  response: HttpResponse,
  filePath: string,
  headers: Record<string, string | number>,
  stat?: { size: number; mtimeMs: number }
): Promise<void> {
  const responseHeaders = { ...headers };
  if (stat) {
    const etag = weakEtagFromStat(stat);
    responseHeaders.etag = etag;
    if (ifNoneMatchMatches(request.headers['if-none-match'], etag)) {
      response.writeHead(304, withSecurityHeaders({
        etag,
        'cache-control': responseHeaders['cache-control'] ?? 'public, max-age=300'
      }));
      response.end();
      return;
    }
  }

  response.writeHead(200, withSecurityHeaders(responseHeaders));
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  try {
    await pipeline(createReadStream(filePath), response);
  } catch (error: any) {
    // Client disconnect mid-stream is not a server error.
    if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE' || error?.code === 'ECONNRESET') {
      return;
    }
    if (!response.writableEnded) {
      response.destroy(error instanceof Error ? error : undefined);
    }
  }
}

function sendJson(response: HttpResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, withSecurityHeaders({ 'content-type': 'application/json; charset=utf-8' }));
  response.end(JSON.stringify(payload));
}

function sendText(response: HttpResponse, statusCode: number, text: string, contentType: string) {
  response.writeHead(statusCode, withSecurityHeaders({ 'content-type': contentType }));
  response.end(text);
}

function ok(response: HttpResponse, data: unknown, statusCode = 200) {
  sendJson(response, statusCode, { data });
}

function fail(response: HttpResponse, error: Error) {
  const statusCode = error.statusCode ?? 500;
  sendJson(response, statusCode, {
    error: {
      message: statusCode === 500 ? 'Lỗi máy chủ nội bộ' : error.message,
      setupRequired: error.setupRequired,
      requires2FA: error.requires2FA
    }
  });
}
function sanitizedRequestLogUrl(requestUrl) {
  try {
    const url = new URL(String(requestUrl || '/'), 'http://localhost');
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:token|secret|password|authorization|api[_-]?key|code)/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}

function logRequestFailure(request, routePath, error) {
  const statusCode = error.statusCode ?? 500;
  const details = {
    method: request.method,
    url: sanitizedRequestLogUrl(request.url),
    routePath,
    statusCode,
    message: error.message
  };
  if (statusCode >= 500) {
    console.error('API ERROR:', details, error);
    return;
  }
  console.warn('API REQUEST FAILED:', details);
}


function metricNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function appendGauge(lines, name, help, value) {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} gauge`);
  lines.push(`${name} ${metricNumber(value)}`);
}

function appendCounter(lines, name, help, value) {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} counter`);
  lines.push(`${name} ${metricNumber(value)}`);
}

function healthMetricsText(health: AnyRecord = {}) {
  const lines = [];
  const realtime = health.realtime ?? {};
  const thresholds = realtime.thresholds ?? {};
  const capacityAlertLevel = realtime.capacityStatus === 'critical' ? 2 : realtime.capacityStatus === 'warning' ? 1 : 0;

  appendGauge(lines, 'chan36_health_ready', 'Deployment readiness from the public health check.', health.status === 'ok' ? 1 : 0);
  appendGauge(lines, 'chan36_store_ready', 'Store dependency readiness.', health.store?.ready === false ? 0 : 1);
  appendGauge(lines, 'chan36_image_storage_ready', 'Image storage dependency readiness.', health.imageStorage?.ready === false ? 0 : 1);

  appendGauge(lines, 'chan36_sse_clients', 'Currently connected SSE clients.', realtime.clients);
  appendGauge(lines, 'chan36_sse_max_clients', 'Configured maximum concurrent SSE clients.', realtime.maxClients);
  appendGauge(lines, 'chan36_sse_capacity_used_percent', 'SSE connection capacity currently used, in percent.', realtime.capacityUsedPct);
  appendGauge(lines, 'chan36_sse_capacity_alert_level', 'SSE capacity alert level: 0 ok, 1 warning, 2 critical.', capacityAlertLevel);
  appendGauge(lines, 'chan36_sse_capacity_warn_percent', 'SSE capacity warning threshold, in percent.', thresholds.warnPct);
  appendGauge(lines, 'chan36_sse_capacity_critical_percent', 'SSE capacity critical threshold, in percent.', thresholds.criticalPct);
  appendGauge(lines, 'chan36_sse_heartbeat_interval_ms', 'Configured SSE heartbeat interval in milliseconds.', realtime.heartbeatMs);
  appendGauge(lines, 'chan36_sse_max_backpressure_events', 'Consecutive SSE backpressure events allowed before dropping a client.', realtime.maxBackpressureEvents);

  appendCounter(lines, 'chan36_sse_connections_total', 'Total accepted SSE connections since process start.', realtime.totalConnections);
  appendCounter(lines, 'chan36_sse_rejected_connections_total', 'Total rejected SSE connections since process start.', realtime.rejected);
  appendCounter(lines, 'chan36_sse_dropped_connections_total', 'Total dropped SSE connections since process start.', realtime.dropped);
  appendCounter(lines, 'chan36_sse_heartbeats_total', 'Total SSE heartbeat ticks since process start.', realtime.heartbeats);
  appendCounter(lines, 'chan36_sse_backpressure_events_total', 'Total SSE writes that reported backpressure since process start.', realtime.backpressureEvents);
  appendCounter(lines, 'chan36_sse_backpressure_drops_total', 'Total SSE clients dropped after repeated backpressure since process start.', realtime.backpressureDrops);
  appendGauge(lines, 'chan36_socketio_clients', 'Currently connected Socket.IO clients.', realtime.socketClients);
  appendCounter(lines, 'chan36_socketio_connections_total', 'Total accepted Socket.IO connections since process start.', realtime.socketConnections);
  appendCounter(lines, 'chan36_socketio_disconnects_total', 'Total Socket.IO disconnects since process start.', realtime.socketDisconnects);
  appendCounter(lines, 'chan36_socketio_auth_failures_total', 'Total rejected Socket.IO authentication attempts.', realtime.socketAuthFailures);
  appendGauge(
    lines,
    'chan36_realtime_state_ready',
    'Shared realtime state readiness (Redis in multi-instance deployments).',
    realtime.state?.ready === false ? 0 : 1
  );

  for (const [key, metricName] of Object.entries(STORE_METRIC_NAMES)) {
    if (Number.isFinite(Number(health.store?.[key]))) {
      appendGauge(lines, `chan36_store_${metricName}`, `Store ${metricName} count from the health snapshot.`, health.store[key]);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function readJson(request: HttpRequest, maxBytes = 1_600_000): Promise<AnyRecord> {
  // Prefer Content-Length short-circuit so oversized posts fail before buffering.
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    const error = new Error('Dữ liệu gửi lên quá lớn');
    error.statusCode = 413;
    throw error;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      const error = new Error('Dữ liệu gửi lên quá lớn');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }

  if (total === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch {
    const error = new Error('Nội dung JSON không hợp lệ');
    error.statusCode = 400;
    throw error;
  }
}

function imageUploadJsonLimit() {
  const maxImageBytes = readPositiveInteger(process.env.MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES);
  const maxThumbnailBytes = readPositiveInteger(process.env.MAX_THUMBNAIL_BYTES, DEFAULT_MAX_THUMBNAIL_BYTES);
  // Media is posted as base64 data URLs (~4/3 of decoded size) plus prefix/JSON overhead.
  const encodedImageBudget = Math.ceil(maxImageBytes * 4 / 3) + 128;
  return (encodedImageBudget + maxThumbnailBytes) * MAX_MEDIA_PER_POST + 80_000;
}

function match(parts: string[], pattern: string[]): RouteParams | null {
  if (parts.length !== pattern.length) {
    return null;
  }

  const params: RouteParams = {};
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

async function requireAdmin(
  request: HttpRequest,
  jwtSecret: string,
  service: any,
  { permission = 'admin:view' }: { permission?: string } = {}
) {
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
  if (!PRIVILEGED_ACCOUNT_ROLES.has(String(payload.role || '').toLowerCase())) {
    const error = new Error('Không có quyền truy cập');
    error.statusCode = 401;
    throw error;
  }
  if (!service || !payload.sub) {
    const error = new Error('Không có quyền truy cập');
    error.statusCode = 401;
    throw error;
  }
  if (service.isSessionRevoked?.(token)) {
    const error = new Error('Phiên đăng nhập đã bị thu hồi');
    error.statusCode = 401;
    throw error;
  }
  const user = await service.getAccount(payload.sub);
  if (!isAccountAuthEpochCurrent(payload, user)) {
    const error = new Error('Phiên đăng nhập đã hết hiệu lực');
    error.statusCode = 401;
    throw error;
  }
  const role = normalizeAdminRole(user.role);
  if (user.disabled || !hasAdminPermission(role, permission)) {
    const error = new Error('Không có quyền truy cập');
    error.statusCode = 403;
    throw error;
  }
  if (user.twoFactorEnabled && !payload.isTwoFactorVerified) {
    const error = new Error('Yêu cầu xác thực 2FA để tiếp tục');
    error.statusCode = 401;
    error.requires2FA = true;
    throw error;
  }
  if (!user.twoFactorEnabled && !payload.isTwoFactorVerified && process.env.NODE_ENV !== 'test') {
    const error = new Error('Yêu cầu cài đặt 2FA cho tài khoản quản trị');
    error.statusCode = 403;
    error.setupRequired = true;
    throw error;
  }
  return {
    ...payload,
    sub: user.id,
    username: user.username,
    role,
    permissions: [...adminPermissionsForRole(role)]
  };
}

function isAccountAuthEpochCurrent(payload, account) {
  const tokenEpoch = Number(payload?.authEpoch ?? 0);
  const accountEpoch = Number(account?.authEpoch ?? 0);
  return Number.isSafeInteger(tokenEpoch)
    && Number.isSafeInteger(accountEpoch)
    && tokenEpoch >= 0
    && tokenEpoch === accountEpoch;
}

async function requireAccount(
  request: HttpRequest,
  jwtSecret: string,
  service: any,
  { allowAdmin2FASetup = false }: { allowAdmin2FASetup?: boolean } = {}
): Promise<any> {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const payload = verifyJwt(token, jwtSecret);
    const tokenRole = normalizeAdminRole(payload.role);
    if (!(payload.role === 'user' || PRIVILEGED_ACCOUNT_ROLES.has(String(payload.role || '').toLowerCase())) || !payload.sub) {
      throw new Error('Không có quyền truy cập');
    }
    if (service?.isSessionRevoked?.(token)) {
      throw new Error('Phiên đăng nhập đã bị thu hồi');
    }
    const account = await service.getAccount(payload.sub);
    if (account.disabled || !isAccountAuthEpochCurrent(payload, account)) {
      throw new Error('Phiên đăng nhập đã hết hiệu lực');
    }
    const role = normalizeAdminRole(account.role);
    let canBootstrapMfa = false;
    if (
      payload.isTwoFactorVerified === false &&
      allowAdmin2FASetup &&
      PRIVILEGED_ACCOUNT_ROLES.has(role)
    ) {
      const mfaState = await service.getAccountMfaState(account.id);
      canBootstrapMfa = !mfaState.totpEnabled && mfaState.passkeyCount === 0;
    }
    if (payload.isTwoFactorVerified === false && !canBootstrapMfa) {
      const error = new Error('Yêu cầu xác thực 2FA');
      error.statusCode = 401;
      throw error;
    }
    if (PRIVILEGED_ACCOUNT_ROLES.has(tokenRole) && !PRIVILEGED_ACCOUNT_ROLES.has(role)) {
      throw new Error('Phiên đăng nhập đã hết hiệu lực');
    }
    return { ...payload, role, authEpoch: account.authEpoch };
  } catch (error) {
    if (error.statusCode) throw error;
    const err = new Error('Vui lòng đăng nhập tài khoản');
    err.statusCode = 401;
    throw err;
  }
}

export async function authenticateRealtimeSession({
  accountToken = '',
  adminToken = '',
  jwtSecret,
  service
}: {
  accountToken?: string;
  adminToken?: string;
  jwtSecret?: string;
  service: any;
}) {
  const secret = String(jwtSecret || '');
  requireAccountJwt(secret);
  const candidates = [
    { kind: 'account', token: String(accountToken || '') },
    { kind: 'admin', token: String(adminToken || '') }
  ].filter((candidate, index, list) => (
    candidate.token &&
    list.findIndex((item) => item.token === candidate.token) === index
  ));
  const identities: Array<{
    userId: string;
    username: string;
    role: string;
    permissions: string[];
  }> = [];
  let account;
  let moderator;
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const request = {
        headers: { authorization: 'Bearer ' + candidate.token }
      } as HttpRequest;
      const session = await requireAccount(request, secret, service);
      const role = normalizeAdminRole(session.role);
      const identity = {
        userId: String(session.sub),
        username: String(session.username || ''),
        role,
        permissions: [...adminPermissionsForRole(role)].map(String)
      };
      identities.push(identity);
      if (candidate.kind === 'account' || !account) {
        account = identity;
      }
      if (PRIVILEGED_ACCOUNT_ROLES.has(role)) {
        moderator = identity;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (candidates.length > 0 && identities.length === 0) {
    throw lastError instanceof Error ? lastError : new Error('Phiên realtime không hợp lệ');
  }
  return {
    account,
    moderator,
    identities: identities.filter((identity, index, list) => (
      list.findIndex((item) => item.userId === identity.userId) === index
    ))
  };
}

async function getOptionalAccount(request: HttpRequest, jwtSecret: string, service: any) {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return undefined;
  try {
    const payload = verifyJwt(token, jwtSecret);
    if (service?.isSessionRevoked?.(token)) return undefined;
    const role = String(payload.role || '').toLowerCase();
    if (!(role === 'user' || PRIVILEGED_ACCOUNT_ROLES.has(role)) || !payload.sub) return undefined;
    const account = await service.getAccount(payload.sub);
    if (!account.disabled && isAccountAuthEpochCurrent(payload, account)) return payload.sub;
  } catch {}
  return undefined;
}

// Resolves a verified capcode role for a post. The role is read from live
// account state (not the token claim) so a revoked/demoted account cannot keep
// stamping posts, and only the privileged roles are ever returned. Returns null
// unless the poster explicitly requested a capcode AND is authorized.
async function getOptionalCapcode(request: HttpRequest, jwtSecret: string, service: any, requested: unknown) {
  if (!requested) return null;
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    const payload = verifyJwt(token, jwtSecret);
    if (service?.isSessionRevoked?.(token)) return null;
    if (!payload.sub) return null;
    if (payload.isTwoFactorVerified !== true) return null;
    const account = await service.getAccount(payload.sub);
    if (account?.disabled || !isAccountAuthEpochCurrent(payload, account)) return null;
    const role = normalizeAdminRole(account?.role);
    if (role === 'owner') {
      return 'admin';
    }
    if (role === 'moderator') {
      return 'moderator';
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
  const privileged = PRIVILEGED_ACCOUNT_ROLES.has(String(account.role || '').toLowerCase());
  let verified = isTwoFactorVerified;
  if (verified === null) {
    verified = privileged ? Boolean(account.twoFactorEnabled) : !account.twoFactorEnabled;
  }
  // Privileged sessions are short-lived (8h). Regular accounts keep a week so
  // users are not logged out constantly; full cookie-based sessions are a later ADR.
  const expiresInSeconds = privileged
    ? readPositiveInteger(process.env.PRIVILEGED_JWT_TTL_SECONDS, 60 * 60 * 8)
    : readPositiveInteger(process.env.ACCOUNT_JWT_TTL_SECONDS, 60 * 60 * 24 * 7);
  return signJwt({
    role: account.role || 'user',
    sub: account.id,
    username: account.username,
    authEpoch: Number(account.authEpoch ?? 0),
    isTwoFactorVerified: verified
  }, jwtSecret, {
    expiresInSeconds
  });
}

function requireAccountJwt(jwtSecret) {
  if (!jwtSecret) {
    const error = new Error('Chưa cấu hình JWT_SECRET cho tài khoản');
    error.statusCode = 503;
    throw error;
  }
}

function optionalIntegerQuery(searchParams: URLSearchParams, name: string): number | undefined {
  const value = searchParams.get(name);
  if (value === null || value.trim() === '') {
    return undefined;
  }
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

function requireGifClient(gifClient?: KlipyClient): KlipyClient {
  if (!gifClient?.configured) {
    const error = new Error('Chưa cấu hình KLIPY_API_KEY cho dịch vụ GIF.');
    error.statusCode = 503;
    throw error;
  }
  return gifClient;
}

function rateLimitForRequest({ method, pathname, searchParams, parts, ip, limiters }) {
  if (parts[0] !== 'api') {
    return null;
  }

  if (parts[1] === 'media' && parts[2] === 'gifs') {
    return { limiter: limiters.gif, key: `${ip}:gif` };
  }

  if (method === 'GET') {
    if (parts[1] === 'search') {
      return { limiter: limiters.search, key: `${ip}:search:${pathname}` };
    }
    if (parts[1] === 'boards' && parts[3] === 'threads' && (searchParams.has('q') || searchParams.has('search'))) {
      return { limiter: limiters.search, key: `${ip}:search:board:${parts[2]}` };
    }
    return null;
  }

  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
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
  if (parts[1] === 'account' || parts[1] === 'dm') {
    return { limiter: limiters.account, key: `${ip}:account:${method}:${pathname}` };
  }
  if (parts[1] === 'admin') {
    return { limiter: limiters.admin, key: `${ip}:admin:${method}:${pathname}` };
  }

  return { limiter: limiters.generic, key: `${ip}:generic:${method}:${pathname}` };
}

async function enforceRateLimit(rate) {
  if (!rate) {
    return;
  }

  const result = await rate.limiter.check(rate.key);
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
    action: searchParams.get('action') || '',
    category: searchParams.get('category') || '',
    priority: searchParams.get('priority') || '',
    sort: searchParams.get('sort') || '',
    confidence: searchParams.get('confidence') || ''
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

function postPreview(post: AnyRecord = {}) {
  return (post.bodyLines || [])
    .map((line) => line.text)
    .join(' ')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
    .trim()
    .slice(0, 300);
}

function firstForwardedHeader(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] ?? '' : value ?? '')
    .split(',')[0]
    .trim();
}

function validHost(value: string): string {
  if (!value || /[\\/@?#\s]/.test(value)) return '';
  try {
    const parsed = new URL(`http://${value}`);
    return parsed.username || parsed.password || parsed.pathname !== '/' ? '' : parsed.host;
  } catch {
    return '';
  }
}

function parsedHttpOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function originError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export function resolvePublicOrigin(
  request: HttpRequest,
  env: NodeJS.ProcessEnv = process.env
): string {
  const configuredValue = String(env.APP_BASE_URL || '').trim();
  if (configuredValue) {
    const configured = parsedHttpOrigin(configuredValue);
    if (!configured) throw originError('APP_BASE_URL phải là origin HTTP(S) hợp lệ', 500);
    return configured;
  }

  let protocol = (request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http';
  let host = validHost(firstForwardedHeader(request.headers.host)) || 'localhost';
  if (isTrustProxyEnabled(env)) {
    const forwardedHost = validHost(firstForwardedHeader(request.headers['x-forwarded-host']));
    const forwardedProtocol = firstForwardedHeader(request.headers['x-forwarded-proto']).toLowerCase();
    if (forwardedHost) host = forwardedHost;
    if (forwardedProtocol === 'http' || forwardedProtocol === 'https') protocol = forwardedProtocol;
  }
  const origin = parsedHttpOrigin(`${protocol}://${host}`);
  if (!origin) throw originError('Origin công khai không hợp lệ', 400);
  return origin;
}

export function resolveWebAuthnContext(
  request: HttpRequest,
  env: NodeJS.ProcessEnv = process.env
): { origin: string; rpID: string } {
  const origin = resolvePublicOrigin(request, env);
  return { origin, rpID: new URL(origin).hostname };
}

function requestOrigin(request: HttpRequest): string {
  const expected = resolvePublicOrigin(request);
  const supplied = String(request.headers.origin || request.headers.referer || '').trim();
  if (!supplied) return expected;
  const actual = parsedHttpOrigin(supplied);
  if (!actual || actual !== expected) throw originError('Origin đăng nhập không hợp lệ', 400);
  return expected;
}

function absoluteUrl(request: HttpRequest, pathName: string) {
  return `${resolvePublicOrigin(request)}${pathName}`;
}

function feedLimit(value, fallback = 20, max = 50) {
  return Math.max(1, Math.min(Number(value) || fallback, max));
}

function postFeedTitle(post: AnyRecord = {}, prefix = '') {
  const subject = String(post.subject || '').trim();
  return `${prefix}${subject || `No.${post.globalNumber}`} /${post.boardSlug}/`;
}

function postFeedItem(request: HttpRequest, post: AnyRecord) {
  const threadId = post.threadId || post.id;
  const url = absoluteUrl(request, `/#thread/${encodeURIComponent(threadId)}?p=${encodeURIComponent(post.globalNumber)}`);
  return {
    id: String(post.globalNumber),
    url,
    title: postFeedTitle(post),
    content_text: postPreview(post),
    date_published: post.createdAt
  };
}

function jsonFeed({ request, title, feedPath, items }: AnyRecord) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title,
    home_page_url: absoluteUrl(request, '/'),
    feed_url: absoluteUrl(request, feedPath),
    items
  };
}

function rssFeed({ request, title, description, items }) {
  const renderedItems = items
    .map((item) => {
      return `
        <item>
          <title>${escapeXml(item.title)}</title>
          <link>${escapeXml(item.url)}</link>
          <guid isPermaLink="true">${escapeXml(item.url)}</guid>
          <pubDate>${new Date(item.date_published).toUTCString()}</pubDate>
          <description>${escapeXml(item.content_text)}</description>
        </item>
      `;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(absoluteUrl(request, '/'))}</link>
    <description>${escapeXml(description)}</description>
    ${renderedItems}
  </channel>
</rss>`;
}

function latestPostJsonFeed(request: HttpRequest, posts: AnyRecord[] = []) {
  return jsonFeed({
    request,
    title: '36chan - Bài mới nhất',
    feedPath: '/feeds/latest.json',
    items: posts.map((post) => postFeedItem(request, post))
  });
}

function latestPostRssFeed(request: HttpRequest, posts: AnyRecord[] = []) {
  return rssFeed({
    request,
    title: '36chan - Bài mới nhất',
    description: 'Bài công khai mới nhất trên 36chan',
    items: posts.map((post) => postFeedItem(request, post))
  });
}

function recommendedThreadJsonFeed(request: HttpRequest, threads: AnyRecord[] = []) {
  return jsonFeed({
    request,
    title: '36chan - Chủ đề đề xuất',
    feedPath: '/feeds/recommended.json',
    items: threads.map((thread) => postFeedItem(request, thread))
  });
}

function recommendedThreadRssFeed(request: HttpRequest, threads: AnyRecord[] = []) {
  return rssFeed({
    request,
    title: '36chan - Chủ đề đề xuất',
    description: 'Chủ đề công khai được xếp hạng theo hoạt động gần đây và tín hiệu tương tác',
    items: threads.map((thread) => postFeedItem(request, thread))
  });
}

function hotBoardFeedItem(request: HttpRequest, board: AnyRecord = {}) {
  const url = absoluteUrl(request, `/#board/${encodeURIComponent(board.boardSlug)}`);
  const postCount = Number(board.postCountLast24h || 0);
  const threadCount = Number(board.threadCountLast24h || 0);
  const replyCount = Number(board.replyCountLast24h || 0);
  return {
    id: board.boardSlug,
    url,
    title: `/${board.boardSlug}/ ${board.boardName || board.boardSlug}`,
    content_text: `${postCount} bài trong 24h (${threadCount} chủ đề, ${replyCount} phản hồi). ${board.boardDescription || ''}`.trim(),
    date_published: board.latestActivityAt || new Date(0).toISOString()
  };
}

function withHotBoardDetails(hotBoards: AnyRecord[] = [], boards: AnyRecord[] = []) {
  const boardBySlug = new Map(boards.map((board) => [board.slug, board]));
  return hotBoards.map((hotBoard) => {
    const board = boardBySlug.get(hotBoard.boardSlug) ?? {};
    return {
      ...hotBoard,
      boardName: board.name,
      boardCategory: board.category,
      boardDescription: board.description
    };
  });
}

function hotBoardsJsonFeed(request: HttpRequest, boards: AnyRecord[] = []) {
  return jsonFeed({
    request,
    title: '36chan - Bảng đang nóng',
    feedPath: '/feeds/hot-boards.json',
    items: boards.map((board) => hotBoardFeedItem(request, board))
  });
}

function hotBoardsRssFeed(request: HttpRequest, boards: AnyRecord[] = []) {
  return rssFeed({
    request,
    title: '36chan - Bảng đang nóng',
    description: 'Bảng công khai có hoạt động nhiều nhất trong 24 giờ qua',
    items: boards.map((board) => hotBoardFeedItem(request, board))
  });
}

function boardThreadJsonFeed(request: HttpRequest, boardSlug: string, threads: AnyRecord[] = []) {
  return jsonFeed({
    request,
    title: `36chan - /${boardSlug}/`,
    feedPath: `/feeds/boards/${encodeURIComponent(boardSlug)}/threads.json`,
    items: threads.map((thread) => postFeedItem(request, thread))
  });
}

function boardThreadRssFeed(request: HttpRequest, boardSlug: string, threads: AnyRecord[] = []) {
  return rssFeed({
    request,
    title: `36chan - /${boardSlug}/`,
    description: `Chủ đề công khai đang hoạt động trên /${boardSlug}/`,
    items: threads.map((thread) => postFeedItem(request, thread))
  });
}

function threadFeedPosts(detail: AnyRecord = {}) {
  return [detail.thread, ...(detail.comments || [])]
    .filter(Boolean)
    .sort((left, right) => {
      const createdCompare = String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
      if (createdCompare !== 0) {
        return createdCompare;
      }
      return Number(right.globalNumber || 0) - Number(left.globalNumber || 0);
    });
}

function threadFeedTitle(detail: AnyRecord = {}) {
  const thread = detail.thread || {};
  return `36chan - ${postFeedTitle(thread, 'Thread ')}`;
}

function threadPostJsonFeed(request: HttpRequest, detail: AnyRecord = {}, limit = 20) {
  const threadId = detail.thread?.id || '';
  return jsonFeed({
    request,
    title: threadFeedTitle(detail),
    feedPath: `/feeds/threads/${encodeURIComponent(threadId)}/posts.json`,
    items: threadFeedPosts(detail).slice(0, limit).map((post) => postFeedItem(request, post))
  });
}

function threadPostRssFeed(request: HttpRequest, detail: AnyRecord = {}, limit = 20) {
  return rssFeed({
    request,
    title: threadFeedTitle(detail),
    description: `Bài công khai trong ${postFeedTitle(detail.thread || {}, 'thread ')}`,
    items: threadFeedPosts(detail).slice(0, limit).map((post) => postFeedItem(request, post))
  });
}

function archivedThreadFeedItem(request: HttpRequest, thread: AnyRecord = {}) {
  const url = absoluteUrl(request, `/#thread/${encodeURIComponent(thread.id)}?p=${encodeURIComponent(thread.globalNumber)}`);
  return {
    id: String(thread.globalNumber),
    url,
    title: postFeedTitle(thread, 'Lưu trữ '),
    content_text: postPreview(thread),
    date_published: thread.archivedAt || thread.createdAt
  };
}

function archiveJsonFeed(request, boardSlug, threads = []) {
  return jsonFeed({
    request,
    title: `36chan - Lưu trữ /${boardSlug}/`,
    feedPath: `/feeds/boards/${encodeURIComponent(boardSlug)}/archive.json`,
    items: threads.map((thread) => archivedThreadFeedItem(request, thread))
  });
}

function archiveRssFeed(request, boardSlug, threads = []) {
  return rssFeed({
    request,
    title: `36chan - Lưu trữ /${boardSlug}/`,
    description: `Chủ đề công khai đã lưu trữ từ /${boardSlug}/`,
    items: threads.map((thread) => archivedThreadFeedItem(request, thread))
  });
}

function safeDecodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029'
  })[character] || character);
}

async function sendIndexResponse(
  request: HttpRequest,
  response: HttpResponse,
  indexPath: string,
  initialHomeSnapshot?: () => Promise<unknown>
) {
  const source = await fs.readFile(indexPath, 'utf8');
  let html = source;
  if (source.includes(INITIAL_HOME_SNAPSHOT_MARKER) && typeof initialHomeSnapshot === 'function') {
    try {
      const snapshot = await initialHomeSnapshot();
      html = source.replace(
        INITIAL_HOME_SNAPSHOT_MARKER,
        `<script id="initialHomeSnapshot" type="application/json">${inlineJson(snapshot)}</script>`
      );
    } catch {
      // The browser falls back to GET /api/home when startup snapshot generation fails.
    }
  }
  const body = Buffer.from(html);
  response.writeHead(
    200,
    withSecurityHeaders({
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-cache'
    })
  );
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  response.end(body);
}


async function serveStatic(request, response, staticRoot, initialHomeSnapshot?: () => Promise<unknown>) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const url = new URL(request.url, 'http://localhost');
  const decodedPath = safeDecodePath(url.pathname);
  if (!decodedPath) {
    return false;
  }
  const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const safeRoot = path.resolve(staticRoot);
  const candidate = path.resolve(safeRoot, `.${requestedPath}`);
  if (!isPathInsideRoot(safeRoot, candidate)) {
    return false;
  }

  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) {
      return false;
    }
    const extension = path.extname(candidate).toLowerCase();
    if (extension === '.html' && path.basename(candidate).toLowerCase() === 'index.html') {
      await sendIndexResponse(request, response, candidate, initialHomeSnapshot);
      return true;
    }
    await sendFileResponse(
      request,
      response,
      candidate,
      {
        'content-type': MIME_TYPES.get(extension) ?? 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': cacheControlForStatic(extension),
        'last-modified': stat.mtime.toUTCString()
      },
      stat
    );
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      if (shouldServeSpaFallback(url.pathname)) {
        const indexPath = path.join(staticRoot, 'index.html');
        if (!isPathInsideRoot(safeRoot, indexPath)) {
          return false;
        }
        await sendIndexResponse(request, response, indexPath, initialHomeSnapshot);
        return true;
      }
      return false;
    }
    throw error;
  }
}

function shouldServeSpaFallback(pathname) {
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/events') ||
    pathname.startsWith('/socket.io') ||
    pathname.startsWith('/uploads')
  ) {
    return false;
  }
  const segments = pathname.split('/').filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.'))) {
    return false;
  }
  const basename = segments.at(-1) ?? '';
  return !path.extname(basename);
}

async function serveUploadedFile(request, response, uploadRoot) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const url = new URL(request.url, 'http://localhost');
  if (!url.pathname.startsWith('/uploads/')) {
    return false;
  }

  const requestedName = safeDecodePath(url.pathname.slice('/uploads/'.length));
  if (!requestedName) {
    return false;
  }
  const fileName = path.basename(requestedName);
  // Reject nested paths, traversal, and empty names (basename alone is the ACL).
  if (!fileName || fileName !== requestedName || fileName === '.' || fileName === '..') {
    return false;
  }

  const safeRoot = path.resolve(uploadRoot);
  const candidate = path.resolve(safeRoot, fileName);
  if (!isPathInsideRoot(safeRoot, candidate)) {
    return false;
  }

  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) {
      return false;
    }
    const extension = path.extname(candidate).toLowerCase();
    const inlineMime = SAFE_INLINE_UPLOAD_MIME_TYPES.get(extension);
    // Upload serving has a deliberately narrower MIME map than static assets.
    // Unknown or legacy active formats are downloaded as inert bytes even if a
    // file was placed in the upload directory outside the normal validator.
    const extraHeaders: Record<string, string | number> = {
      'content-type': inlineMime ?? 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'public, max-age=31536000, immutable',
      'last-modified': stat.mtime.toUTCString(),
      'cross-origin-resource-policy': 'same-site'
    };
    if (!inlineMime) {
      extraHeaders['content-security-policy'] = "default-src 'none'; sandbox";
      extraHeaders['content-disposition'] = 'attachment';
    }
    await sendFileResponse(request, response, candidate, extraHeaders, stat);
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
  uploadRoot = path.resolve('data/uploads'),
  rateLimitStore,
  rateLimitFailureMode = 'closed',
  rateLimitLogger = (error) => console.error('RATE LIMIT STORE ERROR:', error),
  gifClient,
  forceConnectionClose = false
}: CreateHttpServerOptions) {
  const sharedLimiterOptions = {
    store: rateLimitStore,
    failureMode: rateLimitFailureMode,
    onStoreError: rateLimitLogger
  };
  const limiters = {
    thread: createRateLimiter({ ...sharedLimiterOptions, limit: 5, windowMs: 60_000 }),
    comment: createRateLimiter({ ...sharedLimiterOptions, limit: 20, windowMs: 60_000 }),
    ai: createRateLimiter({ ...sharedLimiterOptions, limit: 8, windowMs: 60_000 }),
    account: createRateLimiter({ ...sharedLimiterOptions, limit: 20, windowMs: 60_000 }),
    admin: createRateLimiter({ ...sharedLimiterOptions, limit: 30, windowMs: 60_000 }),
    search: createRateLimiter({ ...sharedLimiterOptions, limit: 10, windowMs: 60_000 }),
    gif: createRateLimiter({ ...sharedLimiterOptions, limit: 30, windowMs: 60_000 }),
    realtime: createRateLimiter({ ...sharedLimiterOptions, limit: 60, windowMs: 60_000 }),
    generic: createRateLimiter({ ...sharedLimiterOptions, limit: 60, windowMs: 60_000 })
  };
  // Short in-process TTL for hot public GETs to cut whole-state re-reads under bursty traffic.
  const publicReadCacheMs = readPositiveInteger(process.env.PUBLIC_READ_CACHE_MS, 2_000);
  const publicReadCache = createTtlCache(publicReadCacheMs);

  async function cachedPublicRead(key: string, loader: () => Promise<unknown>) {
    const hit = publicReadCache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const value = await loader();
    publicReadCache.set(key, value);
    return value;
  }

  function readHomeSnapshot() {
    return cachedPublicRead('home', async () => ({
      config: publicConfig(),
      ...(await service.getHomeSnapshot())
    }));
  }

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const routePath = url.pathname.startsWith('/api/v1/') ? url.pathname.replace('/api/v1', '/api') : url.pathname;
    const parts = routePath.split('/').filter(Boolean);
    const ip = getClientIp(request);
    const isEventStream = request.method === 'GET' && url.pathname === '/events';
    if (forceConnectionClose && !isEventStream) {
      response.shouldKeepAlive = false;
      response.setHeader('connection', 'close');
    }

    try {
      if (isEventStream && realtime.handle) {
        await enforceRateLimit({ limiter: limiters.realtime, key: ip + ':realtime-connect' });
        realtime.handle(request, response);
        return;
      }

      if (await serveUploadedFile(request, response, uploadRoot)) {
        return;
      }

      await enforceRateLimit(
        rateLimitForRequest({ method: request.method, pathname: routePath, searchParams: url.searchParams, parts, ip, limiters })
      );

      if (request.method === 'GET' && routePath === '/api/home') {
        ok(response, await readHomeSnapshot());
        return;
      }

      if (request.method === 'GET' && routePath === '/api/config') {
        // Static/env-derived payload — safe to cache briefly under burst traffic.
        ok(response, await cachedPublicRead('config', async () => publicConfig()));
        return;
      }

      if (request.method === 'GET' && routePath === '/api/media/gifs/trending') {
        const client = requireGifClient(gifClient);
        ok(response, await client.trending({
          page: optionalIntegerQuery(url.searchParams, 'page'),
          perPage: optionalIntegerQuery(url.searchParams, 'perPage')
        }));
        return;
      }

      if (request.method === 'GET' && routePath === '/api/media/gifs/search') {
        const client = requireGifClient(gifClient);
        ok(response, await client.search({
          query: url.searchParams.get('q') ?? '',
          page: optionalIntegerQuery(url.searchParams, 'page'),
          perPage: optionalIntegerQuery(url.searchParams, 'perPage')
        }));
        return;
      }

      if (request.method === 'GET' && routePath === '/api/media/gifs/items') {
        const client = requireGifClient(gifClient);
        ok(response, await client.items((url.searchParams.get('slugs') ?? '').split(',')));
        return;
      }

      const gifShareParams = match(parts, ['api', 'media', 'gifs', ':slug', 'share']);
      if (request.method === 'POST' && gifShareParams) {
        const client = requireGifClient(gifClient);
        const body = await readJson(request, 4_000);
        ok(response, await client.share({
          slug: gifShareParams.slug,
          query: body.query
        }));
        return;
      }

      if (request.method === 'GET' && routePath === '/api/boards') {
        // Not cached: board visibility/admin edits must be visible immediately.
        ok(response, await service.listBoards());
        return;
      }

      if (request.method === 'GET' && routePath === '/api/site-content') {
        // Not cached: owner edits to /policy/ copy should be visible immediately.
        ok(response, await service.getSiteContent());
        return;
      }

      if (request.method === 'GET' && routePath === '/api/stickers') {
        // Includes inactive entries so historical custom sticker tokens keep rendering.
        ok(response, await service.getCustomStickers());
        return;
      }

      if (request.method === 'GET' && routePath === '/api/stats') {
        // Aggregate counts may lag by PUBLIC_READ_CACHE_MS under load (default 2s).
        ok(response, await cachedPublicRead('stats', () => service.getStats()));
        return;
      }

      if (request.method === 'GET' && routePath === '/api/health') {
        const health = await service.getHealth();
        response.setHeader('cache-control', 'no-store');
        const payload = {
          status: health.status,
          ready: health.status === 'ok'
        };
        ok(response, payload, health.status === 'ok' ? 200 : 503);
        return;
      }

      if (request.method === 'GET' && (routePath === '/metrics' || routePath === '/api/metrics')) {
        authorizeMetrics(request);
        sendText(
          response,
          200,
          healthMetricsText(await service.getHealth()),
          'text/plain; version=0.0.4; charset=utf-8'
        );
        return;
      }

      if (request.method === 'GET' && routePath === '/api/posts/latest') {
        ok(response, await service.listLatestPosts(url.searchParams.get('limit') ?? 10));
        return;
      }

      if (request.method === 'GET' && routePath === '/feeds/latest.json') {
        sendJson(response, 200, latestPostJsonFeed(request, await service.listLatestPosts(url.searchParams.get('limit') ?? 20)));
        return;
      }

      if (request.method === 'GET' && routePath === '/feeds/latest.rss') {
        sendText(
          response,
          200,
          latestPostRssFeed(request, await service.listLatestPosts(url.searchParams.get('limit') ?? 20)),
          'application/rss+xml; charset=utf-8'
        );
        return;
      }

      if (request.method === 'GET' && routePath === '/api/threads/recommended') {
        ok(
          response,
          await service.listRecommendedThreads(url.searchParams.get('limit') ?? 10, {
            maxAgeHours: url.searchParams.get('maxAgeHours')
          })
        );
        return;
      }

      if (request.method === 'GET' && routePath === '/feeds/recommended.json') {
        sendJson(
          response,
          200,
          recommendedThreadJsonFeed(
            request,
            await service.listRecommendedThreads(url.searchParams.get('limit') ?? 20, {
              maxAgeHours: url.searchParams.get('maxAgeHours')
            })
          )
        );
        return;
      }

      if (request.method === 'GET' && routePath === '/feeds/recommended.rss') {
        sendText(
          response,
          200,
          recommendedThreadRssFeed(
            request,
            await service.listRecommendedThreads(url.searchParams.get('limit') ?? 20, {
              maxAgeHours: url.searchParams.get('maxAgeHours')
            })
          ),
          'application/rss+xml; charset=utf-8'
        );
        return;
      }

      if (request.method === 'GET' && routePath === '/feeds/hot-boards.json') {
        const hotBoards = await service.listHotBoards(url.searchParams.get('limit') ?? 8);
        sendJson(response, 200, hotBoardsJsonFeed(request, withHotBoardDetails(hotBoards, await service.listBoards())));
        return;
      }

      if (request.method === 'GET' && routePath === '/feeds/hot-boards.rss') {
        const hotBoards = await service.listHotBoards(url.searchParams.get('limit') ?? 8);
        sendText(
          response,
          200,
          hotBoardsRssFeed(request, withHotBoardDetails(hotBoards, await service.listBoards())),
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

      if (request.method === 'POST' && routePath === '/api/link-preview') {
        const body = await readJson(request, 20_000);
        ok(response, await service.getLinkPreview({ url: body.url }));
        return;
      }

      if (request.method === 'POST' && routePath === '/api/ai/chat') {
        const body = await readJson(request, 20_000);
        ok(
          response,
          await service.answerChat({
            question: body.question,
            scope: body.scope,
            page: body.page,
            boardSlug: body.boardSlug,
            threadId: body.threadId,
            history: body.history,
            ip,
            posterToken: body.posterToken
          })
        );
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
        const { account, recoveryCode, verificationEmailSent } = await service.registerAccount({
          username: body.username,
          password: body.password,
          email: body.email,
          captchaToken: body.captchaToken,
          ip
        });
        ok(response, {
          account,
          recoveryCode,
          verificationEmailSent,
          token: accountToken(account, jwtSecret)
        }, 201);
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

      if (request.method === 'POST' && routePath === '/api/account/password-reset/email/request') {
        requireAccountJwt(jwtSecret);
        const body = await readJson(request, 20_000);
        ok(response, await service.requestAccountPasswordResetEmail({
          identifier: body.identifier,
          captchaToken: body.captchaToken,
          ip
        }));
        return;
      }

      if (request.method === 'POST' && routePath === '/api/account/password-reset/email/confirm') {
        requireAccountJwt(jwtSecret);
        const body = await readJson(request, 20_000);
        const { recoveryCode } = await service.resetAccountPasswordWithEmailCode({
          identifier: body.identifier,
          code: body.code,
          newPassword: body.newPassword
        });
        ok(response, { ok: true, recoveryCode });
        return;
      }

      if (request.method === 'POST' && routePath === '/api/account/recovery-code/email/request') {
        requireAccountJwt(jwtSecret);
        const body = await readJson(request, 20_000);
        ok(response, await service.requestRecoveryCodeResetEmail({
          identifier: body.identifier,
          captchaToken: body.captchaToken,
          ip
        }));
        return;
      }

      if (request.method === 'POST' && routePath === '/api/account/recovery-code/email/confirm') {
        requireAccountJwt(jwtSecret);
        const body = await readJson(request, 20_000);
        const { recoveryCode } = await service.resetRecoveryCodeWithEmailCode({
          identifier: body.identifier,
          code: body.code
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
          const challenge = await service.begin2FALogin(account.id);
          ok(response, {
            requires2FA: true,
            tempToken: signJwt(
              {
                role: challenge.account.role || 'user',
                sub: challenge.account.id,
                username: challenge.account.username,
                authEpoch: Number(challenge.account.authEpoch ?? 0),
                twoFactorChallengeId: challenge.challengeId,
                isTwoFactorVerified: false
              },
              jwtSecret,
              { expiresInSeconds: 300 }
            )
          });
        } else {
          ok(response, { account, token: accountToken(account, jwtSecret) });
        }
        return;
      }

      if (
        request.method === 'POST' &&
        (routePath === '/api/auth/2fa/verify' || routePath === '/api/auth/2fa/totp-login')
      ) {
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
        const pendingAccount = await service.getAccount(payload.sub);
        if (
          payload.isTwoFactorVerified !== false
          || pendingAccount.disabled
          || !isAccountAuthEpochCurrent(payload, pendingAccount)
          || service.isSessionRevoked?.(body.tempToken)
          || typeof payload.twoFactorChallengeId !== 'string'
        ) {
          const error = new Error('Yêu cầu xác thực đã hết hạn hoặc không hợp lệ');
          error.statusCode = 400;
          throw error;
        }
        const result = await service.verify2FALogin(
          payload.sub,
          body.code,
          payload.twoFactorChallengeId
        );
        service.revokeSession?.(body.tempToken);
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
        const pendingAccount = await service.getAccount(payload.sub);
        if (
          payload.isTwoFactorVerified !== false
          || pendingAccount.disabled
          || !isAccountAuthEpochCurrent(payload, pendingAccount)
          || service.isSessionRevoked?.(body.tempToken)
          || typeof payload.twoFactorChallengeId !== 'string'
        ) {
          const error = new Error('Yêu cầu xác thực đã hết hạn hoặc không hợp lệ');
          error.statusCode = 400;
          throw error;
        }
        const result = await service.verifyBackupCodeLogin(
          payload.sub,
          body.code,
          payload.twoFactorChallengeId
        );
        service.revokeSession?.(body.tempToken);
        ok(response, { ok: true, token: accountToken(result.account, jwtSecret, true), account: result.account });
        return;
      }

      if (request.method === 'POST' && routePath === '/api/account/logout') {
        const header = request.headers.authorization ?? '';
        const rawToken = header.startsWith('Bearer ') ? header.slice(7) : '';
        if (rawToken) {
          const accountSession = await requireAccount(request, jwtSecret, service, { allowAdmin2FASetup: true });
          await service.logoutAccount(accountSession.sub, rawToken);
        }
        ok(response, { ok: true });
        return;
      }

      if (request.method === 'POST' && routePath === '/api/auth/webauthn/login-options') {
        const body = await readJson(request, 20_000);
        const { rpID } = resolveWebAuthnContext(request);
        ok(response, await service.generateWebAuthnLoginOptions(body.username, rpID));
        return;
      }

      if (request.method === 'POST' && routePath === '/api/auth/webauthn/login-verify') {
        requireAccountJwt(jwtSecret);
        const body = await readJson(request, 20_000);
        const origin = requestOrigin(request);
        const rpID = new URL(origin).hostname;
        const { account } = await service.verifyWebAuthnLoginResponse({
          username: body.username,
          body: body.assertionResponse,
          origin,
          rpID
        });
        // A passkey requires user verification (biometric/PIN), so it is a
        // strong second factor on its own: issue a fully-verified token so an
        // admin can sign in with a passkey alone (no separate TOTP step).
        ok(response, { account, token: accountToken(account, jwtSecret, true) });
        return;
      }

      if (routePath.startsWith('/api/account')) {
        // A password-only privileged session may bootstrap exactly one MFA
        // family while the account has no TOTP or passkey. Existing factors
        // require a verified step-up before any management route is reachable.
        const allowAdmin2FASetup =
          request.method === 'POST' && [
            '/api/account/2fa/setup',
            '/api/account/2fa/verify',
            '/api/account/passkeys/register-options',
            '/api/account/passkeys/register-verify'
          ].includes(routePath);
        const accountSession = await requireAccount(request, jwtSecret, service, { allowAdmin2FASetup });

        if (request.method === 'GET' && routePath === '/api/account/posts') {
          const accountSession = await requireAccount(request, jwtSecret, service);
          ok(response, await service.listAccountPosts(accountSession.sub));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/account/me') {
          ok(response, await service.getAccount(accountSession.sub));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/email/verify') {
          const body = await readJson(request, 20_000);
          ok(response, await service.verifyAccountEmail(accountSession.sub, body.code));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/email/resend') {
          ok(response, await service.resendAccountEmailVerification(accountSession.sub));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/email/change') {
          const body = await readJson(request, 20_000);
          ok(response, await service.requestAccountEmailChange(accountSession.sub, {
            newEmail: body.newEmail,
            password: body.password
          }));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/email/change/confirm') {
          const body = await readJson(request, 20_000);
          ok(response, await service.confirmAccountEmailChange(accountSession.sub, body.code));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/account/passkeys') {
          ok(response, await service.listPasskeys(accountSession.sub));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/passkeys/register-options') {
          const { rpID } = resolveWebAuthnContext(request);
          ok(response, await service.generateWebAuthnRegisterOptions(accountSession.sub, rpID, {
            verifiedStepUp: accountSession.isTwoFactorVerified === true
          }));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/passkeys/register-verify') {
          const body = await readJson(request, 20_000);
          const origin = requestOrigin(request);
          const rpID = new URL(origin).hostname;
          const result = await service.verifyWebAuthnRegisterResponse(accountSession.sub, {
            body,
            origin,
            rpID,
            verifiedStepUp: accountSession.isTwoFactorVerified === true
          });
          ok(response, { ...result, token: accountToken(result.account, jwtSecret, true) });
          return;
        }

        const accountParams = match(parts, ['api', 'account', 'passkeys', ':id']);
        if (accountParams && request.method === 'DELETE') {
          const result = await service.deletePasskey(accountSession.sub, accountParams.id);
          ok(response, {
            ...result,
            token: accountToken(result.account, jwtSecret, accountSession.isTwoFactorVerified !== false)
          });
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
          ok(response, await service.generate2FASetup(accountSession.sub, {
            verifiedStepUp: accountSession.isTwoFactorVerified === true
          }));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/2fa/verify') {
          const body = await readJson(request, 20_000);
          const result = await service.verify2FASetup(accountSession.sub, body.code, {
            verifiedStepUp: accountSession.isTwoFactorVerified === true
          });
          ok(response, { ...result, token: accountToken(result.account, jwtSecret, true) });
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/2fa/disable') {
          const body = await readJson(request, 20_000);
          const result = await service.disable2FA(accountSession.sub, body.password);
          ok(response, { ...result, token: accountToken(result.account, jwtSecret) });
          return;
        }

        if (request.method === 'POST' && routePath === '/api/account/recovery-code') {
          const body = await readJson(request, 20_000);
          const { recoveryCode, account } = await service.regenerateRecoveryCode(accountSession.sub, body.password);
          ok(response, {
            ok: true,
            recoveryCode,
            account,
            token: accountToken(account, jwtSecret, accountSession.isTwoFactorVerified !== false)
          });
          return;
        }
      }

      // Direct messages — account session required (not available to anonymous posters).
      if (routePath.startsWith('/api/dm')) {
        requireAccountJwt(jwtSecret);
        const accountSession = await requireAccount(request, jwtSecret, service);

        if (request.method === 'GET' && routePath === '/api/dm/conversations') {
          ok(response, { conversations: await service.listDmConversations(accountSession.sub) });
          return;
        }

        if (request.method === 'POST' && routePath === '/api/dm/conversations') {
          const body = await readJson(request, 20_000);
          ok(response, {
            conversation: await service.openDmConversation(accountSession.sub, {
              username: body.username
            })
          });
          return;
        }

        if (request.method === 'POST' && routePath === '/api/dm/groups') {
          const body = await readJson(request, 20_000);
          ok(response, {
            conversation: await service.createDmGroup(accountSession.sub, {
              title: body.title,
              usernames: body.usernames
            })
          });
          return;
        }

        if (request.method === 'GET' && routePath === '/api/dm/unread-count') {
          ok(response, await service.getDmUnreadCount(accountSession.sub));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/dm/search') {
          ok(
            response,
            await service.searchDmMessages(accountSession.sub, {
              q: url.searchParams.get('q') || '',
              limit: url.searchParams.get('limit')
            })
          );
          return;
        }

        if (request.method === 'GET' && routePath === '/api/dm/blocked') {
          ok(response, await service.listDmBlockedUsers(accountSession.sub));
          return;
        }

        if (request.method === 'POST' && routePath === '/api/dm/block') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.setDmUserBlocked(accountSession.sub, {
              userId: body.userId,
              username: body.username,
              blocked: body.blocked !== false
            })
          );
          return;
        }

        if (request.method === 'POST' && routePath === '/api/dm/unblock') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.setDmUserBlocked(accountSession.sub, {
              userId: body.userId,
              username: body.username,
              blocked: false
            })
          );
          return;
        }

        if (request.method === 'POST' && routePath === '/api/dm/link-preview') {
          const body = await readJson(request, 20_000);
          ok(response, await service.getDmLinkPreview(accountSession.sub, { url: body.url }));
          return;
        }

        const dmMessagesParams = match(parts, ['api', 'dm', 'conversations', ':id', 'messages']);
        if (dmMessagesParams && request.method === 'GET') {
          ok(
            response,
            await service.listDmMessages(accountSession.sub, dmMessagesParams.id, {
              limit: url.searchParams.get('limit'),
              before: url.searchParams.get('before')
            })
          );
          return;
        }
        if (dmMessagesParams && request.method === 'POST') {
          const body = await readJson(request, imageUploadJsonLimit());
          ok(
            response,
            await service.sendDmMessage(accountSession.sub, dmMessagesParams.id, {
              body: body.body,
              image: body.image,
              images: body.images,
              replyToId: body.replyToId
            })
          );
          return;
        }

        const dmReadParams = match(parts, ['api', 'dm', 'conversations', ':id', 'read']);
        if (dmReadParams && request.method === 'POST') {
          ok(response, {
            conversation: await service.markDmConversationRead(accountSession.sub, dmReadParams.id)
          });
          return;
        }

        const dmInviteParams = match(parts, ['api', 'dm', 'conversations', ':id', 'invite']);
        if (dmInviteParams && request.method === 'POST') {
          const body = await readJson(request, 20_000);
          ok(response, {
            conversation: await service.inviteDmGroupMembers(accountSession.sub, dmInviteParams.id, {
              usernames: body.usernames
            })
          });
          return;
        }

        const dmLeaveParams = match(parts, ['api', 'dm', 'conversations', ':id', 'leave']);
        if (dmLeaveParams && request.method === 'POST') {
          ok(response, await service.leaveDmConversation(accountSession.sub, dmLeaveParams.id));
          return;
        }

        const dmKickParams = match(parts, ['api', 'dm', 'conversations', ':id', 'kick']);
        if (dmKickParams && request.method === 'POST') {
          const body = await readJson(request, 20_000);
          ok(response, {
            conversation: await service.kickDmGroupMember(accountSession.sub, dmKickParams.id, {
              userId: body.userId,
              username: body.username
            })
          });
          return;
        }

        const dmRolesParams = match(parts, ['api', 'dm', 'conversations', ':id', 'roles']);
        if (dmRolesParams && request.method === 'POST') {
          const body = await readJson(request, 20_000);
          ok(response, {
            conversation: await service.setDmGroupMemberRole(accountSession.sub, dmRolesParams.id, {
              userId: body.userId,
              username: body.username,
              role: body.role
            })
          });
          return;
        }

        const dmMessageItemParams = match(parts, [
          'api',
          'dm',
          'conversations',
          ':id',
          'messages',
          ':messageId'
        ]);
        if (dmMessageItemParams && request.method === 'PATCH') {
          const body = await readJson(request, 40_000);
          ok(
            response,
            await service.editDmMessage(
              accountSession.sub,
              dmMessageItemParams.id,
              dmMessageItemParams.messageId,
              { body: body.body }
            )
          );
          return;
        }
        if (dmMessageItemParams && request.method === 'DELETE') {
          ok(
            response,
            await service.deleteDmMessage(
              accountSession.sub,
              dmMessageItemParams.id,
              dmMessageItemParams.messageId
            )
          );
          return;
        }

        const dmReactParams = match(parts, [
          'api',
          'dm',
          'conversations',
          ':id',
          'messages',
          ':messageId',
          'reactions'
        ]);
        if (dmReactParams && request.method === 'POST') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.reactDmMessage(
              accountSession.sub,
              dmReactParams.id,
              dmReactParams.messageId,
              { reaction: body.reaction }
            )
          );
          return;
        }

        const dmTypingParams = match(parts, ['api', 'dm', 'conversations', ':id', 'typing']);
        if (dmTypingParams && request.method === 'POST') {
          ok(response, await service.signalDmTyping(accountSession.sub, dmTypingParams.id));
          return;
        }

        const dmMuteParams = match(parts, ['api', 'dm', 'conversations', ':id', 'mute']);
        if (dmMuteParams && request.method === 'POST') {
          const body = await readJson(request, 20_000);
          ok(response, {
            conversation: await service.setDmConversationMuted(
              accountSession.sub,
              dmMuteParams.id,
              { muted: body.muted !== false }
            )
          });
          return;
        }
        if (dmMuteParams && request.method === 'DELETE') {
          ok(response, {
            conversation: await service.setDmConversationMuted(
              accountSession.sub,
              dmMuteParams.id,
              { muted: false }
            )
          });
          return;
        }

        const dmConversationParams = match(parts, ['api', 'dm', 'conversations', ':id']);
        if (dmConversationParams && request.method === 'PATCH') {
          const body = await readJson(request, 20_000);
          ok(response, {
            conversation: await service.updateDmGroup(accountSession.sub, dmConversationParams.id, {
              title: body.title
            })
          });
          return;
        }
        if (dmConversationParams && request.method === 'DELETE') {
          const hard = url.searchParams.get('hard') === '1' || url.searchParams.get('hard') === 'true';
          ok(
            response,
            await service.deleteDmConversation(accountSession.sub, dmConversationParams.id, {
              hard
            })
          );
          return;
        }
      }

      let params = match(parts, ['api', 'boards', ':boardSlug', 'threads']);
      if (params && request.method === 'GET') {
        const paged =
          url.searchParams.has('page') ||
          url.searchParams.has('pageSize') ||
          url.searchParams.has('q') ||
          url.searchParams.has('search') ||
          url.searchParams.has('sort') ||
          url.searchParams.has('filter');
        ok(
          response,
          await service.listThreads(params.boardSlug, {
            paged,
            page: url.searchParams.get('page'),
            pageSize: url.searchParams.get('pageSize'),
            q: url.searchParams.get('q') || url.searchParams.get('search') || '',
            sort: url.searchParams.get('sort') || '',
            filter: url.searchParams.get('filter') || ''
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
            subject: body.subject,
            body: body.body,
            image: body.image,
            images: body.images,
            pollOptions: body.pollOptions,
            options: body.options,
            deletePassword: body.deletePassword,
            captchaToken: body.captchaToken,
            ip,
            posterToken: body.posterToken,
            displayName: body.displayName,
            capcode: await getOptionalCapcode(request, jwtSecret, service, body.capcode),
            accountId: await getOptionalAccount(request, jwtSecret, service)
          }),
          201
        );
        return;
      }

      params = match(parts, ['api', 'boards', ':boardSlug', 'threads', 'check-duplicate']);
      if (params && request.method === 'POST') {
        const body = await readJson(request, 20_000);
        ok(
          response,
          await service.checkDuplicateThread({
            boardSlug: params.boardSlug,
            body: body.body,
            ip,
            posterToken: body.posterToken
          })
        );
        return;
      }

      params = match(parts, ['api', 'boards', ':boardSlug', 'archive']);
      if (params && request.method === 'GET') {
        ok(response, await service.listArchivedThreads(params.boardSlug));
        return;
      }

      params = match(parts, ['feeds', 'boards', ':boardSlug', 'threads.json']);
      if (params && request.method === 'GET') {
        const threads = (await service.listThreads(params.boardSlug)).slice(
          0,
          feedLimit(url.searchParams.get('limit'))
        );
        sendJson(response, 200, boardThreadJsonFeed(request, params.boardSlug, threads));
        return;
      }

      params = match(parts, ['feeds', 'boards', ':boardSlug', 'threads.rss']);
      if (params && request.method === 'GET') {
        const threads = (await service.listThreads(params.boardSlug)).slice(
          0,
          feedLimit(url.searchParams.get('limit'))
        );
        sendText(
          response,
          200,
          boardThreadRssFeed(request, params.boardSlug, threads),
          'application/rss+xml; charset=utf-8'
        );
        return;
      }

      params = match(parts, ['feeds', 'boards', ':boardSlug', 'archive.json']);
      if (params && request.method === 'GET') {
        const threads = (await service.listArchivedThreads(params.boardSlug)).slice(
          0,
          feedLimit(url.searchParams.get('limit'))
        );
        sendJson(response, 200, archiveJsonFeed(request, params.boardSlug, threads));
        return;
      }

      params = match(parts, ['feeds', 'boards', ':boardSlug', 'archive.rss']);
      if (params && request.method === 'GET') {
        const threads = (await service.listArchivedThreads(params.boardSlug)).slice(
          0,
          feedLimit(url.searchParams.get('limit'))
        );
        sendText(
          response,
          200,
          archiveRssFeed(request, params.boardSlug, threads),
          'application/rss+xml; charset=utf-8'
        );
        return;
      }

      params = match(parts, ['feeds', 'threads', ':threadId', 'posts.json']);
      if (params && request.method === 'GET') {
        const detail = await service.getThread(params.threadId);
        sendJson(response, 200, threadPostJsonFeed(request, detail, feedLimit(url.searchParams.get('limit'))));
        return;
      }

      params = match(parts, ['feeds', 'threads', ':threadId', 'posts.rss']);
      if (params && request.method === 'GET') {
        const detail = await service.getThread(params.threadId);
        sendText(
          response,
          200,
          threadPostRssFeed(request, detail, feedLimit(url.searchParams.get('limit'))),
          'application/rss+xml; charset=utf-8'
        );
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
          url.searchParams.has('pageSize') ||
          url.searchParams.has('commentsSearch') ||
          url.searchParams.has('q');
        ok(
          response,
          await service.getThread(params.threadId, {
            paged,
            commentsPage: url.searchParams.get('commentsPage') || url.searchParams.get('page'),
            commentsPageSize: url.searchParams.get('commentsPageSize') || url.searchParams.get('pageSize'),
            commentsSort: url.searchParams.get('commentsSort') || '',
            commentsSearch: url.searchParams.get('commentsSearch') || url.searchParams.get('q') || '',
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
            images: body.images,
            options: body.options,
            deletePassword: body.deletePassword,
            captchaToken: body.captchaToken,
            ip,
            posterToken: body.posterToken,
            displayName: body.displayName,
            capcode: await getOptionalCapcode(request, jwtSecret, service, body.capcode),
            accountId: await getOptionalAccount(request, jwtSecret, service)
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

      params = match(parts, ['api', 'posts', ':globalNumber', 'reactions']);
      if (params && request.method === 'POST') {
        const account = await requireAccount(request, jwtSecret, service);
        const body = await readJson(request, 20_000);
        ok(
          response,
          await service.reactPost({
            globalNumber: params.globalNumber,
            reaction: body.reaction,
            accountId: account.sub
          })
        );
        return;
      }

      params = match(parts, ['api', 'posts', ':globalNumber', 'vote']);
      if (params && request.method === 'POST') {
        const account = await requireAccount(request, jwtSecret, service);
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
      if (params && request.method === 'PUT') {
        const body = await readJson(request, imageUploadJsonLimit());
        const hasAccountToken = String(request.headers.authorization ?? '').startsWith('Bearer ');
        if (!hasAccountToken) {
          ok(
            response,
            await service.editPostWithPassword(params.globalNumber, {
              password: body.password,
              body: body.body
            })
          );
          return;
        }
        const account = await requireAccount(request, jwtSecret, service);
        ok(
          response,
          await service.editAccountPost(params.globalNumber, {
            accountId: account.sub,
            body: body.body,
            image: body.image,
            images: body.images,
            replaceImages: Object.hasOwn(body, 'image') || Object.hasOwn(body, 'images')
          })
        );
        return;
      }
      if (params && request.method === 'DELETE') {
        const account = await requireAccount(request, jwtSecret, service);
        const body = await readJson(request, 20_000);
        ok(
          response,
          await service.deletePost({
            globalNumber: params.globalNumber,
            accountId: account.sub,
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
            category: body.category,
            ip,
            posterToken: body.posterToken
          }),
          201
        );
        return;
      }

      if (request.method === 'POST' && routePath === '/api/appeals') {
        const body = await readJson(request, 20_000);
        ok(
          response,
          await service.submitAppeal({
            token: body.token,
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
          const challenge = await service.begin2FALogin(adminAccount.id);
          ok(response, {
            requires2FA: true,
            tempToken: signJwt(
              {
                role: challenge.account.role || 'owner',
                username: adminUsername,
                sub: challenge.account.id,
                authEpoch: Number(challenge.account.authEpoch ?? 0),
                twoFactorChallengeId: challenge.challengeId,
                isTwoFactorVerified: false
              },
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
        const admin = await requireAdmin(request, jwtSecret, service, {
          permission: adminPermissionForRequest(request.method, routePath, parts)
        });
        const filters = adminFiltersFromSearch(url.searchParams);

        if (request.method === 'GET' && routePath === '/api/admin/users') {
          ok(response, await service.listPrivilegedUsers());
          return;
        }

        if (request.method === 'POST' && routePath === '/api/admin/users') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.createPrivilegedUser(
              {
                username: body.username,
                password: body.password,
                role: body.role,
                disabled: body.disabled
              },
              { actor: admin.username ?? 'admin' }
            ),
            201
          );
          return;
        }

        params = match(parts, ['api', 'admin', 'users', ':id']);
        if (params && request.method === 'PUT') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.updatePrivilegedUser(
              params.id,
              {
                role: body.role,
                disabled: body.disabled,
                password: body.password
              },
              { actor: admin.username ?? 'admin', actorId: admin.sub }
            )
          );
          return;
        }
        if (params && request.method === 'DELETE') {
          ok(
            response,
            await service.disablePrivilegedUser(params.id, { actor: admin.username ?? 'admin', actorId: admin.sub })
          );
          return;
        }

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
          ok(response, await service.listPending(filters, url.searchParams.get('limit') ?? 100));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/admin/moderation-settings') {
          ok(response, await service.getModerationSettings());
          return;
        }

        if (request.method === 'PUT' && routePath === '/api/admin/moderation-settings') {
          const body = await readJson(request, 20_000);
          ok(response, await service.updateModerationSettings(body, { actor: admin.username ?? 'admin' }));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/admin/site-content') {
          ok(response, await service.getSiteContent());
          return;
        }

        if (request.method === 'PUT' && routePath === '/api/admin/site-content') {
          const body = await readJson(request, 50_000);
          ok(response, await service.updateSiteContent(body, { actor: admin.username ?? 'admin' }));
          return;
        }

        if (request.method === 'GET' && routePath === '/api/admin/stickers') {
          ok(response, await service.getCustomStickers());
          return;
        }

        if (request.method === 'POST' && routePath === '/api/admin/stickers') {
          const body = await readJson(request, 5_000);
          ok(
            response,
            await service.addCustomSticker(
              { label: body.label, url: body.url },
              { actor: admin.username ?? 'admin' }
            ),
            201
          );
          return;
        }

        params = match(parts, ['api', 'admin', 'stickers', ':key']);
        if (params && request.method === 'PATCH') {
          const body = await readJson(request, 2_000);
          ok(
            response,
            await service.setCustomStickerActive(params.key, body.active, {
              actor: admin.username ?? 'admin'
            })
          );
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
                rules: body.rules,
                banner: body.banner,
                isHidden: body.isHidden,
                isArchived: body.isArchived,
                temporary: body.temporary,
                eventEndsAt: body.eventEndsAt,
                retentionPolicy: body.retentionPolicy
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
                rules: body.rules,
                banner: body.banner,
                isHidden: body.isHidden,
                isArchived: body.isArchived,
                temporary: body.temporary,
                eventEndsAt: body.eventEndsAt,
                retentionPolicy: body.retentionPolicy
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

        if (request.method === 'GET' && routePath === '/api/admin/appeals') {
          ok(response, await service.listAppeals(url.searchParams.get('limit') ?? 50, filters));
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
        if (params && request.method === 'PUT') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.adminEditPost(params.globalNumber, {
              body: body.body,
              reason: body.reason,
              actor: admin.username ?? 'admin'
            })
          );
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

        params = match(parts, ['api', 'admin', 'posts', ':globalNumber', 'restore']);
        if (params && request.method === 'POST') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.adminRestorePost(params.globalNumber, {
              reason: body.reason,
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

        params = match(parts, ['api', 'admin', 'appeals', ':id', 'resolve']);
        if (params && request.method === 'POST') {
          const body = await readJson(request, 20_000);
          ok(
            response,
            await service.resolveAppeal(params.id, {
              status: body.status,
              reason: body.reason,
              actor: admin.username ?? 'admin'
            })
          );
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

      if (await serveStatic(request, response, staticRoot, readHomeSnapshot)) {
        return;
      }

      const error = new Error('Không tìm thấy');
      error.statusCode = 404;
      throw error;
    } catch (error) {
      logRequestFailure(request, routePath, error);
      fail(response, error);
    }
  });
}
