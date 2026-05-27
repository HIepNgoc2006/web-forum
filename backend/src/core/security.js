import crypto from 'node:crypto';
import https from 'node:https';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(input, secret) {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
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

  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
  if (header.alg !== 'HS256') {
    throw new Error('Invalid token');
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
}

export function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return request.socket.remoteAddress ?? '127.0.0.1';
}

export function createRateLimiter({ limit = 40, windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return {
    check(key) {
      const now = Date.now();
      const current = buckets.get(key);
      if (!current || current.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, remaining: limit - 1 };
      }
      current.count += 1;
      const remaining = Math.max(0, limit - current.count);
      return {
        ok: current.count <= limit,
        remaining,
        retryAfter: Math.ceil((current.resetAt - now) / 1000)
      };
    }
  };
}

export async function verifyHcaptcha(token, remoteIp) {
  if (!token) {
    return false;
  }

  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) {
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
