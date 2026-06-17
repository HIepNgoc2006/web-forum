import crypto from 'node:crypto';
import https from 'node:https';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(input, secret) {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

// Resolve a hashing secret. Falls back to JWT_SECRET, then (only outside
// production) to a clearly-labeled dev literal. In production a missing
// dedicated secret with no JWT_SECRET is a hard error rather than a
// predictable, source-visible default.
function secretOrDevFallback(primary, devFallback, name) {
  const secret = primary || process.env.JWT_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing ${name}: set ${name} or JWT_SECRET in production.`);
  }
  return devFallback;
}

export function createPosterHash({ ip, threadId, salt, posterToken = '' }) {
  const token = String(posterToken).slice(0, 128);
  const digest = crypto
    .createHash('sha256')
    .update(`${ip}:${token}:${salt}:${threadId}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `ID:${digest}`;
}

export function createPosterProofHash({ threadId, posterToken = '' }) {
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

export function createModerationFingerprint({ ip, posterToken = '' }) {
  const secret = secretOrDevFallback(
    process.env.MODERATION_FINGERPRINT_SECRET,
    '36chan-dev-fingerprint-secret',
    'MODERATION_FINGERPRINT_SECRET'
  );
  const token = String(posterToken).slice(0, 128);
  return crypto.createHmac('sha256', secret).update(`${ip}:${token}`).digest('hex');
}

export function signJwt(payload, secret, { expiresInSeconds = 60 * 60 * 8 } = {}) {
  if (!secret) {
    throw new Error('JWT secret is required');
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  return `${unsigned}.${sign(unsigned, secret)}`;
}

export function verifyJwt(token, secret) {
  if (!token || !secret) {
    throw new Error('Invalid token');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const expected = sign(unsigned, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid token');
  }

  let header;
  let payload;
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

function isDefaultSecret(value) {
  return !value || /^change-me/i.test(String(value)) || /^secret$/i.test(String(value));
}

export function securityConfigStatus({
  jwtSecret,
  adminUsername,
  adminPassword,
  hcaptchaSecret = process.env.HCAPTCHA_SECRET,
  moderationFingerprintSecret = process.env.MODERATION_FINGERPRINT_SECRET,
  posterProofSecret = process.env.POSTER_PROOF_SECRET
} = {}) {
  const warnings = [];
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
export function assertProductionSecrets(config = {}) {
  const { nodeEnv = process.env.NODE_ENV, ...statusConfig } = config;
  const status = securityConfigStatus(statusConfig);
  if (nodeEnv !== 'production') {
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

export function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
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
 *    limit. To rate-limit across instances, pass a shared `store` that
 *    implements a synchronous Map-like interface (`get`/`set`/`delete` and
 *    iteration of `[key, { count, resetAt }]` entries) backed by e.g. Redis.
 *    Auth brute-force protection assumes such a shared counter at scale.
 *
 * @param {object} [options]
 * @param {number} [options.limit] max requests per window
 * @param {number} [options.windowMs] window length in ms
 * @param {Map} [options.store] optional shared, Map-like backend
 * @param {number} [options.sweepIntervalMs] eviction interval (0 disables)
 */
export function createRateLimiter({ limit = 40, windowMs = 60_000, store, sweepIntervalMs = windowMs } = {}) {
  const buckets = store ?? new Map();

  function sweep(now = Date.now()) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }

  let timer = null;
  if (sweepIntervalMs > 0 && typeof setInterval === 'function') {
    timer = setInterval(() => sweep(), sweepIntervalMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  return {
    check(key) {
      const now = Date.now();
      const current = buckets.get(key);
      if (!current || current.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, remaining: limit - 1 };
      }
      current.count += 1;
      // Re-set so non-by-reference backends (e.g. a Redis adapter) persist the
      // mutated bucket; harmless for the default Map.
      buckets.set(key, current);
      const remaining = Math.max(0, limit - current.count);
      return {
        ok: current.count <= limit,
        remaining,
        retryAfter: Math.ceil((current.resetAt - now) / 1000)
      };
    },
    sweep,
    size() {
      return typeof buckets.size === 'number' ? buckets.size : undefined;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}

export async function verifyHcaptcha(token, remoteIp) {
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
            resolve(Boolean(JSON.parse(data).success));
          } catch {
            resolve(false);
          }
        });
      }
    );
    request.on('error', () => resolve(false));
    request.write(body);
    request.end();
  });
}
