import { createClient } from 'redis';

type AnyRecord = Record<string, any>;
type RealtimeStateLogger = (entry: Record<string, unknown>) => void;
type RealtimeStateDriver = 'memory' | 'redis';
type RealtimeStateFailureMode = 'open' | 'closed';

export type RealtimeConnectionMetadata = {
  connectionId: string;
  socketId: string;
  serverId: string;
  userId?: string;
  username?: string;
  role?: string;
  connectedAt: string;
  transport: string;
  origin: string;
  userAgent: string;
  addressHash: string;
};

export type RealtimeFanoutEnvelope = {
  originId: string;
  event: string;
  payload: unknown;
  publishedAt: string;
};

export type RealtimeUserRateLimit = {
  allowed: boolean;
  count: number;
  limit: number;
  resetAt: number;
  retryAfterMs: number;
};

export type RealtimeStateHealth = {
  driver: RealtimeStateDriver;
  configured: boolean;
  ready: boolean;
  failureMode: RealtimeStateFailureMode;
  presenceTtlSeconds: number;
  unreadTtlSeconds: number;
};

export type RealtimeState = {
  driver: RealtimeStateDriver;
  trackConnection(metadata: RealtimeConnectionMetadata): Promise<void>;
  refreshConnection(metadata: RealtimeConnectionMetadata): Promise<void>;
  removeConnection(connectionId: string, userId?: string): Promise<void>;
  getPresence(userIds: string[]): Promise<Record<string, boolean>>;
  consumeUserRateLimit(
    userId: string,
    action: string,
    options: { limit: number; windowMs: number }
  ): Promise<RealtimeUserRateLimit>;
  getUnreadCount(userId: string): Promise<number | null>;
  setUnreadCount(userId: string, count: number): Promise<void>;
  invalidateUnreadCount(userId: string): Promise<void>;
  publishFanout(envelope: RealtimeFanoutEnvelope): Promise<void>;
  subscribeFanout(
    handler: (envelope: RealtimeFanoutEnvelope) => void
  ): Promise<() => Promise<void>>;
  health(): RealtimeStateHealth;
  close(): Promise<void>;
};

type MemoryRealtimeStateOptions = {
  now?: () => number;
  presenceTtlSeconds?: number;
  unreadTtlSeconds?: number;
};

type RedisRealtimeStateOptions = {
  client: AnyRecord;
  subscriber: AnyRecord;
  prefix?: string;
  presenceTtlSeconds?: number;
  unreadTtlSeconds?: number;
  failureMode?: RealtimeStateFailureMode;
  closeClients?: boolean;
  now?: () => number;
};

type RealtimeStateFromEnvOptions = {
  env?: NodeJS.ProcessEnv;
  logger?: RealtimeStateLogger;
};

const USER_RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { count, ttl }
`;

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function failureMode(value: unknown): RealtimeStateFailureMode {
  return String(value || '').trim().toLowerCase() === 'open' ? 'open' : 'closed';
}

function enabled(value: unknown): boolean {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function safeCount(value: unknown): number {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function rateLimitResult(
  count: number,
  ttlMs: number,
  limit: number,
  now: number
): RealtimeUserRateLimit {
  const safeLimit = Math.max(1, Math.trunc(limit));
  const safeTtl = Math.max(1, Math.trunc(ttlMs));
  return {
    allowed: count <= safeLimit,
    count,
    limit: safeLimit,
    resetAt: now + safeTtl,
    retryAfterMs: count <= safeLimit ? 0 : safeTtl
  };
}

function normalizePrefix(value: unknown): string {
  const prefix = String(value || '36chan:realtime:').trim() || '36chan:realtime:';
  return prefix.endsWith(':') ? prefix : `${prefix}:`;
}

function validFanoutEnvelope(value: unknown): value is RealtimeFanoutEnvelope {
  const envelope = value && typeof value === 'object' ? value as AnyRecord : {};
  return Boolean(
    typeof envelope.originId === 'string' &&
    envelope.originId &&
    typeof envelope.event === 'string' &&
    envelope.event &&
    typeof envelope.publishedAt === 'string'
  );
}

export function createMemoryRealtimeState({
  now = Date.now,
  presenceTtlSeconds = 45,
  unreadTtlSeconds = 60
}: MemoryRealtimeStateOptions = {}): RealtimeState {
  const presenceTtlMs = positiveInteger(presenceTtlSeconds, 45) * 1000;
  const unreadTtlMs = positiveInteger(unreadTtlSeconds, 60) * 1000;
  const connections = new Map<string, { metadata: RealtimeConnectionMetadata; expiresAt: number }>();
  const unreadCounts = new Map<string, { count: number; expiresAt: number }>();
  const rateLimits = new Map<string, { count: number; resetAt: number }>();
  const fanoutHandlers = new Set<(envelope: RealtimeFanoutEnvelope) => void>();

  function cleanConnections(): void {
    const current = now();
    for (const [connectionId, entry] of connections) {
      if (entry.expiresAt <= current) {
        connections.delete(connectionId);
      }
    }
  }

  async function trackConnection(metadata: RealtimeConnectionMetadata): Promise<void> {
    connections.set(metadata.connectionId, {
      metadata: { ...metadata },
      expiresAt: now() + presenceTtlMs
    });
  }

  return {
    driver: 'memory',
    trackConnection,
    refreshConnection: trackConnection,

    async removeConnection(connectionId): Promise<void> {
      connections.delete(connectionId);
    },

    async getPresence(userIds): Promise<Record<string, boolean>> {
      cleanConnections();
      const online = new Set(
        [...connections.values()]
          .map((entry) => entry.metadata.userId)
          .filter(Boolean)
      );
      return Object.fromEntries(
        [...new Set(userIds.map(String).filter(Boolean))].map((userId) => [userId, online.has(userId)])
      );
    },

    async consumeUserRateLimit(userId, action, { limit, windowMs }): Promise<RealtimeUserRateLimit> {
      const current = now();
      const safeWindowMs = positiveInteger(windowMs, 60_000);
      const key = `${userId}:${action}`;
      const existing = rateLimits.get(key);
      const entry = !existing || existing.resetAt <= current
        ? { count: 0, resetAt: current + safeWindowMs }
        : existing;
      entry.count += 1;
      rateLimits.set(key, entry);
      return rateLimitResult(entry.count, entry.resetAt - current, limit, current);
    },

    async getUnreadCount(userId): Promise<number | null> {
      const entry = unreadCounts.get(userId);
      if (!entry || entry.expiresAt <= now()) {
        unreadCounts.delete(userId);
        return null;
      }
      return entry.count;
    },

    async setUnreadCount(userId, count): Promise<void> {
      unreadCounts.set(userId, {
        count: safeCount(count),
        expiresAt: now() + unreadTtlMs
      });
    },

    async invalidateUnreadCount(userId): Promise<void> {
      unreadCounts.delete(userId);
    },

    async publishFanout(envelope): Promise<void> {
      for (const handler of fanoutHandlers) {
        handler(envelope);
      }
    },

    async subscribeFanout(handler): Promise<() => Promise<void>> {
      fanoutHandlers.add(handler);
      return async () => {
        fanoutHandlers.delete(handler);
      };
    },

    health(): RealtimeStateHealth {
      return {
        driver: 'memory',
        configured: false,
        ready: true,
        failureMode: 'open',
        presenceTtlSeconds: presenceTtlMs / 1000,
        unreadTtlSeconds: unreadTtlMs / 1000
      };
    },

    async close(): Promise<void> {
      connections.clear();
      unreadCounts.clear();
      rateLimits.clear();
      fanoutHandlers.clear();
    }
  };
}

export function createRedisRealtimeState({
  client,
  subscriber,
  prefix = '36chan:realtime:',
  presenceTtlSeconds = 45,
  unreadTtlSeconds = 60,
  failureMode: configuredFailureMode = 'closed',
  closeClients = false,
  now = Date.now
}: RedisRealtimeStateOptions): RealtimeState {
  if (!client || !subscriber) {
    throw new Error('Redis realtime state requires command and subscriber clients.');
  }
  const keyPrefix = normalizePrefix(prefix);
  const presenceTtl = positiveInteger(presenceTtlSeconds, 45);
  const unreadTtl = positiveInteger(unreadTtlSeconds, 60);
  const mode = failureMode(configuredFailureMode);
  const fanoutChannel = `${keyPrefix}fanout`;
  const fanoutHandlers = new Set<(envelope: RealtimeFanoutEnvelope) => void>();
  let subscribed = false;

  function connectionKey(connectionId: string): string {
    return `${keyPrefix}connection:${connectionId}`;
  }

  function presenceKey(userId: string): string {
    return `${keyPrefix}presence:${userId}`;
  }

  function unreadKey(userId: string): string {
    return `${keyPrefix}unread:${userId}`;
  }

  async function trackConnection(metadata: RealtimeConnectionMetadata): Promise<void> {
    const expiresAt = now() + presenceTtl * 1000;
    const tasks: Promise<unknown>[] = [
      client.set(connectionKey(metadata.connectionId), JSON.stringify(metadata), { EX: presenceTtl })
    ];
    if (metadata.userId) {
      tasks.push(
        client.zAdd(presenceKey(metadata.userId), [{ score: expiresAt, value: metadata.connectionId }]),
        client.expire(presenceKey(metadata.userId), presenceTtl * 2)
      );
    }
    await Promise.all(tasks);
  }

  return {
    driver: 'redis',
    trackConnection,
    refreshConnection: trackConnection,

    async removeConnection(connectionId, userId): Promise<void> {
      const tasks: Promise<unknown>[] = [client.del(connectionKey(connectionId))];
      if (userId) {
        tasks.push(client.zRem(presenceKey(userId), connectionId));
      }
      await Promise.all(tasks);
    },

    async getPresence(userIds): Promise<Record<string, boolean>> {
      const result: Record<string, boolean> = {};
      await Promise.all([...new Set(userIds.map(String).filter(Boolean))].map(async (userId) => {
        const key = presenceKey(userId);
        await client.zRemRangeByScore(key, 0, now());
        result[userId] = Number(await client.zCard(key)) > 0;
      }));
      return result;
    },

    async consumeUserRateLimit(userId, action, { limit, windowMs }): Promise<RealtimeUserRateLimit> {
      const current = now();
      const safeWindowMs = positiveInteger(windowMs, 60_000);
      try {
        const raw = await client.eval(USER_RATE_LIMIT_SCRIPT, {
          keys: [`${keyPrefix}rate:user:${userId}:${action}`],
          arguments: [String(safeWindowMs)]
        });
        const [rawCount, rawTtl] = Array.isArray(raw) ? raw : [raw, safeWindowMs];
        const ttl = Number(rawTtl);
        return rateLimitResult(
          safeCount(rawCount),
          Number.isFinite(ttl) && ttl > 0 ? ttl : safeWindowMs,
          limit,
          current
        );
      } catch (error) {
        if (mode === 'open') {
          return rateLimitResult(1, safeWindowMs, limit, current);
        }
        throw error;
      }
    },

    async getUnreadCount(userId): Promise<number | null> {
      const value = await client.get(unreadKey(userId));
      if (value === null || value === undefined) {
        return null;
      }
      const count = Number(value);
      return Number.isFinite(count) ? safeCount(count) : null;
    },

    async setUnreadCount(userId, count): Promise<void> {
      await client.set(unreadKey(userId), String(safeCount(count)), { EX: unreadTtl });
    },

    async invalidateUnreadCount(userId): Promise<void> {
      await client.del(unreadKey(userId));
    },

    async publishFanout(envelope): Promise<void> {
      await client.publish(fanoutChannel, JSON.stringify(envelope));
    },

    async subscribeFanout(handler): Promise<() => Promise<void>> {
      fanoutHandlers.add(handler);
      if (!subscribed) {
        await subscriber.subscribe(fanoutChannel, (message: string) => {
          try {
            const envelope: unknown = JSON.parse(message);
            if (!validFanoutEnvelope(envelope)) {
              return;
            }
            for (const listener of fanoutHandlers) {
              listener(envelope);
            }
          } catch {
            // Ignore malformed messages from a shared Redis database.
          }
        });
        subscribed = true;
      }
      return async () => {
        fanoutHandlers.delete(handler);
      };
    },

    health(): RealtimeStateHealth {
      return {
        driver: 'redis',
        configured: true,
        ready: client.isReady !== false && subscriber.isReady !== false,
        failureMode: mode,
        presenceTtlSeconds: presenceTtl,
        unreadTtlSeconds: unreadTtl
      };
    },

    async close(): Promise<void> {
      fanoutHandlers.clear();
      if (!closeClients) {
        return;
      }
      if (subscriber.isOpen) {
        await subscriber.quit();
      }
      if (client.isOpen) {
        await client.quit();
      }
    }
  };
}

export async function createRealtimeStateFromEnv({
  env = process.env,
  logger = () => {}
}: RealtimeStateFromEnvOptions = {}): Promise<RealtimeState> {
  const presenceTtlSeconds = positiveInteger(env.REALTIME_PRESENCE_TTL_SECONDS, 45);
  const unreadTtlSeconds = positiveInteger(env.REALTIME_UNREAD_TTL_SECONDS, 60);
  const required = enabled(env.REALTIME_REDIS_REQUIRED);
  const mode = failureMode(env.REALTIME_REDIS_FAILURE_MODE);
  const url = env.REALTIME_REDIS_URL || env.UPSTASH_REDIS_URL || env.REDIS_URL || '';

  if (!url) {
    if (required) {
      const restHint = env.UPSTASH_REDIS_REST_URL
        ? ' The Upstash REST URL cannot provide Pub/Sub; use the TLS rediss:// endpoint.'
        : '';
      throw new Error(`REALTIME_REDIS_REQUIRED=1 requires REALTIME_REDIS_URL, UPSTASH_REDIS_URL, or REDIS_URL.${restHint}`);
    }
    return createMemoryRealtimeState({ presenceTtlSeconds, unreadTtlSeconds });
  }

  const connectTimeout = positiveInteger(env.REALTIME_REDIS_CONNECT_TIMEOUT_MS, 5_000);
  const client = createClient({
    url,
    socket: { connectTimeout }
  });
  const subscriber = client.duplicate();
  for (const [kind, redisClient] of [['command', client], ['subscriber', subscriber]] as const) {
    redisClient.on('error', (error) => {
      logger({
        level: 'warn',
        event: 'realtime.redis.error',
        client: kind,
        message: error?.message ?? String(error)
      });
    });
  }

  try {
    await client.connect();
    await subscriber.connect();
  } catch (error) {
    if (subscriber.isOpen) {
      await subscriber.quit().catch(() => {});
    }
    if (client.isOpen) {
      await client.quit().catch(() => {});
    }
    if (required) {
      throw error;
    }
    logger({
      level: 'warn',
      event: 'realtime.redis.fallback',
      message: error instanceof Error ? error.message : String(error)
    });
    return createMemoryRealtimeState({ presenceTtlSeconds, unreadTtlSeconds });
  }

  return createRedisRealtimeState({
    client,
    subscriber,
    prefix: env.REALTIME_REDIS_PREFIX,
    presenceTtlSeconds,
    unreadTtlSeconds,
    failureMode: mode,
    closeClients: true
  });
}
