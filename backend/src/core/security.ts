import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';

type PosterHashOptions = {
  ip: string;
  threadId: string;
  salt: string;
  posterToken?: unknown;
};

type PosterProofHashOptions = {
  threadId: string;
  posterToken?: unknown;
};

type ModerationFingerprintOptions = {
  ip: string;
  posterToken?: unknown;
};

export type JwtPayload = Record<string, any>;

type JwtOptions = {
  expiresInSeconds?: number;
};

export type SecurityConfigInput = {
  jwtSecret?: string;
  adminUsername?: string;
  adminPassword?: string;
  hcaptchaSecret?: string;
  moderationFingerprintSecret?: string;
  posterProofSecret?: string;
};

export type SecurityConfigStatus = {
  adminConfigured: boolean;
  hcaptchaConfigured: boolean;
  warnings: string[];
};

type ProductionSecretConfig = SecurityConfigInput & {
  nodeEnv?: string;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitIncrementOptions = {
  windowMs: number;
  now: number;
};

type RateLimitStore = {
  increment?: (key: string, options: RateLimitIncrementOptions) => RateLimitBucket | Promise<RateLimitBucket>;
  get?: (key: string) => RateLimitBucket | undefined;
  set?: (key: string, bucket: RateLimitBucket) => unknown;
  delete?: (key: string) => unknown;
  size?: number;
  [Symbol.iterator]?: () => IterableIterator<[string, RateLimitBucket]>;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfter?: number;
  degraded?: boolean;
};

export type RateLimiter = {
  check: (key: string) => RateLimitResult | Promise<RateLimitResult>;
  sweep: (now?: number) => void;
  size: () => number | undefined;
  stop: () => void;
};

type RateLimiterOptions = {
  limit?: number;
  windowMs?: number;
  store?: RateLimitStore;
  failureMode?: 'closed' | 'open';
  onStoreError?: (error: unknown) => void;
  sweepIntervalMs?: number;
};

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(input: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

// Resolve a hashing secret. Falls back to JWT_SECRET, then (only outside
// production) to a clearly-labeled dev literal. In production a missing
// dedicated secret with no JWT_SECRET is a hard error rather than a
// predictable, source-visible default.
function secretOrDevFallback(primary: string | undefined, devFallback: string, name: string): string {
  const secret = primary || process.env.JWT_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing ${name}: set ${name} or JWT_SECRET in production.`);
  }
  return devFallback;
}

export function createPosterHash({ ip, threadId, salt, posterToken = '' }: PosterHashOptions): string {
  const token = String(posterToken).slice(0, 128);
  const digest = crypto
    .createHash('sha256')
    .update(`${ip}:${token}:${salt}:${threadId}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `ID:${digest}`;
}

export function createPosterProofHash({ threadId, posterToken = '' }: PosterProofHashOptions): string | null {
  const token = String(posterToken).slice(0, 128);
  if (!token) {
    return null;
  }
  const secret = secretOrDevFallback(
    process.env.POSTER_PROOF_SECRET,
    '36chan-dev-poster-proof-secret',
    'POSTER_PROOF_SECRET'
  );
  return crypto.createHmac('sha256', secret).update(`${threadId}:${token}`).digest('hex');
}

// Classic imageboard tripcode. Takes the substring after the first `#` in a
// display name. A leading second `#` (i.e. `name##secret`) selects a *secure*
// tripcode salted with a server secret, so it cannot be reproduced off-site or
// forged without the secret. Otherwise it is an *insecure* tripcode: a pure
// function of the password (forgeable by design, matching 4chan semantics).
// Returns null when there is no usable secret.
export function createTripcode(secret: unknown = ''): string | null {
  const password = String(secret ?? '').slice(0, 256);
  if (!password) {
    return null;
  }
  if (password.startsWith('#')) {
    const securePart = password.slice(1);
    if (!securePart) {
      return null;
    }
    const tripSecret = secretOrDevFallback(
      process.env.TRIPCODE_SECRET,
      '36chan-dev-tripcode-secret',
      'TRIPCODE_SECRET'
    );
    const digest = crypto
      .createHmac('sha256', tripSecret)
      .update(securePart)
      .digest('base64')
      .replace(/[+/=]/g, '')
      .slice(0, 11);
    return `!!${digest}`;
  }
  const digest = crypto
    .createHash('sha256')
    .update(password)
    .digest('base64')
    .replace(/[+/=]/g, '')
    .slice(0, 10);
  return `!${digest}`;
}

export function createModerationFingerprint({ ip, posterToken = '' }: ModerationFingerprintOptions): string {
  const secret = secretOrDevFallback(
    process.env.MODERATION_FINGERPRINT_SECRET,
    '36chan-dev-fingerprint-secret',
    'MODERATION_FINGERPRINT_SECRET'
  );
  const token = String(posterToken).slice(0, 128);
  return crypto.createHmac('sha256', secret).update(`${ip}:${token}`).digest('hex');
}

export function signJwt(
  payload: JwtPayload,
  secret: string | undefined,
  { expiresInSeconds = 60 * 60 * 8 }: JwtOptions = {}
): string {
  if (!secret) {
    throw new Error('JWT secret is required');
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  return `${unsigned}.${sign(unsigned, secret)}`;
}

export function verifyJwt(token: string | undefined, secret: string | undefined): JwtPayload {
  if (!token || !secret) {
    throw new Error('Invalid token');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  // Reject non-base64url characters early so Buffer.from length tricks cannot
  // bypass the constant-time compare below.
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) {
    throw new Error('Invalid token');
  }
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const expected = sign(unsigned, secret);
  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid token');
  }

  let header: JwtPayload;
  let payload: JwtPayload;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid token');
  }

  if (header.alg !== 'HS256') {
    throw new Error('Invalid token');
  }

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
}

function isDefaultSecret(value: string | undefined): boolean {
  return !value || /^change-me/i.test(String(value)) || /^secret$/i.test(String(value));
}

export function securityConfigStatus({
  jwtSecret,
  adminUsername,
  adminPassword,
  hcaptchaSecret = process.env.HCAPTCHA_SECRET,
  moderationFingerprintSecret = process.env.MODERATION_FINGERPRINT_SECRET,
  posterProofSecret = process.env.POSTER_PROOF_SECRET
}: SecurityConfigInput = {}): SecurityConfigStatus {
  const warnings: string[] = [];
  const adminConfigured = Boolean(jwtSecret && adminUsername && adminPassword);
  const hcaptchaConfigured = Boolean(hcaptchaSecret);

  if (!adminConfigured) {
    warnings.push('admin_auth_not_configured');
  }
  if (isDefaultSecret(jwtSecret)) {
    warnings.push('jwt_secret_default_or_missing');
  } else if (String(jwtSecret).length < 32) {
    warnings.push('jwt_secret_short');
  }
  if (!adminUsername || /^admin$/i.test(String(adminUsername))) {
    warnings.push('admin_username_default_or_missing');
  }
  if (!adminPassword || /^change-me$/i.test(String(adminPassword)) || String(adminPassword).length < 12) {
    warnings.push('admin_password_weak_or_missing');
  }
  if (!moderationFingerprintSecret) {
    warnings.push('moderation_fingerprint_secret_falls_back_to_jwt');
  }
  if (!posterProofSecret) {
    warnings.push('poster_proof_secret_falls_back_to_jwt');
  }
  if (!hcaptchaConfigured) {
    warnings.push('hcaptcha_not_configured');
  }

  return {
    adminConfigured,
    hcaptchaConfigured,
    warnings
  };
}

// Warnings that must block startup in production. Each corresponds to a
// predictable/default/forgeable secret that would silently weaken security.
const PRODUCTION_FATAL_WARNINGS = new Set([
  'admin_auth_not_configured',
  'admin_username_default_or_missing',
  'admin_password_weak_or_missing',
  'jwt_secret_default_or_missing',
  'jwt_secret_short',
  'moderation_fingerprint_secret_falls_back_to_jwt',
  'poster_proof_secret_falls_back_to_jwt',
  'hcaptcha_not_configured'
]);

// Computes the security config status and, in production, throws when any
// disqualifying secret is missing/default. Returns the status (with all
// warnings) in non-production so callers can log them without failing.
// Never includes secret values in its output or error message.
export function assertProductionSecrets(config: ProductionSecretConfig = {}): SecurityConfigStatus {
  const { nodeEnv = process.env.NODE_ENV, ...statusConfig } = config;
  const status = securityConfigStatus(statusConfig);
  if (process.env.ALLOW_INSECURE_SECRETS === '1' || process.env.BYPASS_PRODUCTION_SECRETS_CHECK === '1' || nodeEnv !== 'production') {
    return status;
  }
  const fatal = status.warnings.filter((warning) => PRODUCTION_FATAL_WARNINGS.has(warning));
  if (fatal.length > 0) {
    throw new Error(
      `Refusing to start in production with insecure secret configuration: ${fatal.join(', ')}. ` +
        'Set a strong non-default JWT_SECRET (>=32 chars), MODERATION_FINGERPRINT_SECRET, ' +
        'POSTER_PROOF_SECRET, and HCAPTCHA_SECRET.'
    );
  }
  return status;
}

/**
 * Whether to honor client-controlled proxy headers (`X-Forwarded-For`,
 * `X-Forwarded-Proto`). Defaults to **off in production** so rate limits and
 * moderation fingerprints cannot be spoofed by a raw client. Operators behind
 * a trusted reverse proxy must set `TRUST_PROXY=1` (or true/yes/on).
 * Outside production the default remains on so local/dev/tests keep working.
 */
export function isTrustProxyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TRUST_PROXY;
  if (raw !== undefined && String(raw).trim() !== '') {
    return /^(1|true|yes|on)$/i.test(String(raw).trim());
  }
  return env.NODE_ENV !== 'production';
}

export function getClientIp(request: IncomingMessage, env: NodeJS.ProcessEnv = process.env): string {
  if (isTrustProxyEnabled(env)) {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const first = String(forwarded).split(',')[0].trim();
      if (first) {
        return first;
      }
    }
  }
  return request.socket.remoteAddress ?? '127.0.0.1';
}

/**
 * Fixed-window rate limiter.
 *
 * By default it keeps counters in a per-process Map. Two notes for operators:
 *
 * 1. **Eviction**: expired buckets are swept opportunistically on each `check`
 *    and on an `unref`'d interval, so the map stays bounded even when most keys
 *    (e.g. one-off client IPs) never recur. The interval never keeps the
 *    process alive; call `stop()` for deterministic cleanup in tests/shutdown.
 * 2. **Multi-instance**: a per-process Map is NOT shared across instances. With
 *    N processes behind a load balancer an attacker effectively gets N× the
 *    limit. To rate-limit across instances, pass a shared `store` with an
 *    atomic async `increment(key, { windowMs, now })` method, or a Map-like
 *    backend for tests/local composition. Auth brute-force protection assumes
 *    such a shared counter at scale.
 *
 * @param {object} [options]
 * @param {number} [options.limit] max requests per window
 * @param {number} [options.windowMs] window length in ms
 * @param {Map|object} [options.store] optional shared backend
 * @param {'closed'|'open'} [options.failureMode] behavior when shared store fails
 * @param {Function} [options.onStoreError] optional shared-store error callback
 * @param {number} [options.sweepIntervalMs] eviction interval (0 disables)
 */
export function createRateLimiter({
  limit = 40,
  windowMs = 60_000,
  store,
  failureMode = 'closed',
  onStoreError,
  sweepIntervalMs = windowMs
}: RateLimiterOptions = {}): RateLimiter {
  const buckets: RateLimitStore = store ?? new Map<string, RateLimitBucket>();
  const hasAtomicIncrement = typeof buckets.increment === 'function';
  const canSweep = !hasAtomicIncrement && typeof buckets[Symbol.iterator] === 'function' && typeof buckets.delete === 'function';

  function sweep(now = Date.now()): void {
    if (!canSweep) {
      return;
    }
    for (const [key, bucket] of buckets as Iterable<[string, RateLimitBucket]>) {
      if (bucket.resetAt <= now) {
        buckets.delete!(key);
      }
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  if (canSweep && sweepIntervalMs > 0 && typeof setInterval === 'function') {
    timer = setInterval(() => sweep(), sweepIntervalMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  function resultFromBucket(bucket: RateLimitBucket | undefined, now: number): RateLimitResult {
    const count = Number(bucket?.count) || 0;
    const resetAt = Number(bucket?.resetAt) || now + windowMs;
    const remaining = Math.max(0, limit - count);
    return {
      ok: count <= limit,
      remaining,
      retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000))
    };
  }

  function resultFromStoreError(error: unknown): RateLimitResult {
    if (typeof onStoreError === 'function') {
      onStoreError(error);
    }
    if (failureMode === 'open') {
      return { ok: true, remaining: Math.max(0, limit - 1), degraded: true };
    }
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil(windowMs / 1000)),
      degraded: true
    };
  }

  return {
    check(key: string) {
      const now = Date.now();
      if (hasAtomicIncrement) {
        return Promise.resolve(buckets.increment!(key, { windowMs, now }))
          .then((bucket) => resultFromBucket(bucket, now))
          .catch((error) => resultFromStoreError(error));
      }

      const mapBuckets = buckets as Required<Pick<RateLimitStore, 'get' | 'set'>>;
      const current = mapBuckets.get(key);
      if (!current || current.resetAt <= now) {
        mapBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, remaining: limit - 1 };
      }
      current.count += 1;
      // Re-set so non-by-reference backends (e.g. a Redis adapter) persist the
      // mutated bucket; harmless for the default Map.
      mapBuckets.set(key, current);
      const remaining = Math.max(0, limit - current.count);
      return {
        ok: current.count <= limit,
        remaining,
        retryAfter: Math.ceil((current.resetAt - now) / 1000)
      };
    },
    sweep,
    size() {
      return !hasAtomicIncrement && typeof buckets.size === 'number' ? buckets.size : undefined;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}

export async function verifyHcaptcha(token: string | undefined, remoteIp?: string): Promise<boolean> {
  if (!token) {
    return false;
  }

  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    return token === 'dev-pass' || token.length > 8;
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: remoteIp ?? ''
  }).toString();

  return new Promise((resolve) => {
    const request = https.request(
      {
        hostname: 'api.hcaptcha.com',
        path: '/siteverify',
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body)
        }
      },
      (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.success) {
              // hCaptcha returns `error-codes` explaining the failure, e.g.
              // `invalid-input-secret`, `sitekey-secret-mismatch`,
              // `invalid-or-already-seen-response`. Surface them so a misconfig
              // (wrong/unpaired keys, unregistered hostname) is diagnosable
              // instead of an opaque "Xác minh hCaptcha thất bại".
              console.warn('hcaptcha.verify.failed', JSON.stringify(parsed['error-codes'] ?? []));
            }
            resolve(Boolean(parsed.success));
          } catch {
            console.warn('hcaptcha.verify.parse-error');
            resolve(false);
          }
        });
      }
    );
    request.on('error', () => resolve(false));
    // Bound the call so a hung hCaptcha connection cannot block the
    // post/login request indefinitely. On timeout, fail closed (treat as
    // unverified) and tear down the socket.
    request.setTimeout(10_000, () => {
      console.warn('hcaptcha.verify.timeout');
      request.destroy();
      resolve(false);
    });
    request.write(body);
    request.end();
  });
}
