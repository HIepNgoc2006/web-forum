import { createClient } from 'redis';

const REDIS_INCREMENT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { count, ttl }
`;

function normalizeDriver(value = 'memory') {
  const driver = String(value || 'memory').trim().toLowerCase();
  if (['memory', 'map', 'local', 'none'].includes(driver)) {
    return 'memory';
  }
  if (driver === 'redis') {
    return 'redis';
  }
  throw new Error('RATE_LIMIT_STORE must be either memory or redis.');
}

export function normalizeRateLimitFailureMode(value = 'closed') {
  const mode = String(value || 'closed').trim().toLowerCase();
  if (mode === 'open') {
    return 'open';
  }
  return 'closed';
}

export function createRedisRateLimitStore({
  client,
  prefix = '36chan:rate-limit:'
} = {}) {
  if (!client || typeof client.eval !== 'function') {
    throw new Error('Redis rate limit store requires a connected Redis client.');
  }

  const keyPrefix = String(prefix || '36chan:rate-limit:');

  return {
    async increment(key, { windowMs, now = Date.now() } = {}) {
      const safeWindowMs = Math.max(1, Math.trunc(Number(windowMs) || 0));
      const result = await client.eval(REDIS_INCREMENT_SCRIPT, {
        keys: [`${keyPrefix}${String(key)}`],
        arguments: [String(safeWindowMs)]
      });
      const [rawCount, rawTtl] = Array.isArray(result) ? result : [result, safeWindowMs];
      const count = Math.max(0, Number(rawCount) || 0);
      const ttl = Number(rawTtl);
      const safeTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : safeWindowMs;
      return { count, resetAt: now + safeTtl };
    }
  };
}

export async function createRateLimitStoreFromEnv({
  env = process.env,
  logger = () => {}
} = {}) {
  const driver = normalizeDriver(env.RATE_LIMIT_STORE ?? env.RATE_LIMIT_DRIVER ?? 'memory');
  const failureMode = normalizeRateLimitFailureMode(env.RATE_LIMIT_FAILURE_MODE ?? env.RATE_LIMIT_REDIS_FAILURE_MODE);

  if (driver === 'memory') {
    return { driver, store: undefined, failureMode, close: async () => {} };
  }

  const url = env.RATE_LIMIT_REDIS_URL ?? env.REDIS_URL;
  if (!url) {
    throw new Error('RATE_LIMIT_STORE=redis requires RATE_LIMIT_REDIS_URL or REDIS_URL.');
  }

  const client = createClient({ url });
  client.on('error', (error) => {
    logger({
      level: 'warn',
      event: 'rate_limit.redis.error',
      message: error?.message ?? String(error)
    });
  });
  await client.connect();

  return {
    driver,
    failureMode,
    store: createRedisRateLimitStore({
      client,
      prefix: env.RATE_LIMIT_REDIS_PREFIX ?? '36chan:rate-limit:'
    }),
    async close() {
      if (client.isOpen) {
        await client.quit();
      }
    }
  };
}
