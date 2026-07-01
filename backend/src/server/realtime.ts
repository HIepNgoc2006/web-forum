const DEFAULT_MAX_CLIENTS = 1000;
const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_WARN_PCT = 75;
const DEFAULT_CRITICAL_PCT = 90;
const DEFAULT_MAX_BACKPRESSURE_EVENTS = 3;

type RealtimeCapacityStatus = 'ok' | 'warning' | 'critical';
type RealtimeInterval = ReturnType<typeof setInterval> | { unref?: () => void };

interface RealtimeClient {
  writeHead(code: number, headers: Record<string, string | number>): unknown;
  write(line: string): boolean | void;
  end(data?: string): unknown;
}

interface RealtimeRequest {
  url: string;
  on(event: 'close', handler: () => void): unknown;
}

interface ClientMeta {
  boardSlug: string;
  threadId: string;
  backpressureEvents: number;
}

interface RealtimeMetricsState {
  totalConnections: number;
  rejected: number;
  dropped: number;
  heartbeats: number;
  backpressureEvents: number;
  backpressureDrops: number;
}

export interface RealtimeHubOptions {
  maxClients?: number;
  heartbeatMs?: number;
  warnPct?: number;
  criticalPct?: number;
  maxBackpressureEvents?: number;
  setIntervalFn?: (callback: () => void, ms: number) => RealtimeInterval;
  clearIntervalFn?: (timer: RealtimeInterval) => void;
}

export interface RealtimeConnectionFilter {
  boardSlug?: string;
  threadId?: string;
}

export interface RealtimeSnapshot {
  total: number;
  boards: Record<string, number>;
}

export interface RealtimeMetrics {
  clients: number;
  boards: Record<string, number>;
  maxClients: number;
  capacityUsedPct: number;
  capacityStatus: RealtimeCapacityStatus;
  heartbeatMs: number;
  maxBackpressureEvents: number;
  totalConnections: number;
  rejected: number;
  dropped: number;
  heartbeats: number;
  backpressureEvents: number;
  backpressureDrops: number;
  thresholds: {
    warnPct: number;
    criticalPct: number;
  };
}

export interface RealtimeHub {
  handle(request: RealtimeRequest, response: RealtimeClient): void;
  publish(event: string, payload: unknown): void;
  count(filter?: RealtimeConnectionFilter): number;
  boardCounts(): Record<string, number>;
  snapshot(): RealtimeSnapshot;
  metrics(): RealtimeMetrics;
  close(): void;
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function percentEnv(name: string, fallback: number): number {
  const value = positiveIntEnv(name, fallback);
  return Math.max(1, Math.min(value, 100));
}

export function createRealtimeHub(options: RealtimeHubOptions = {}): RealtimeHub {
  const clients = new Map<RealtimeClient, ClientMeta>();
  const maxClients = options.maxClients ?? positiveIntEnv('SSE_MAX_CLIENTS', DEFAULT_MAX_CLIENTS);
  const heartbeatMs = options.heartbeatMs ?? positiveIntEnv('SSE_HEARTBEAT_MS', DEFAULT_HEARTBEAT_MS);
  const configuredWarnPct = options.warnPct ?? percentEnv('SSE_WARN_PCT', DEFAULT_WARN_PCT);
  const configuredCriticalPct = options.criticalPct ?? percentEnv('SSE_CRITICAL_PCT', DEFAULT_CRITICAL_PCT);
  const warnPct = Math.min(configuredWarnPct, configuredCriticalPct);
  const criticalPct = Math.max(configuredWarnPct, configuredCriticalPct);
  const maxBackpressureEvents = options.maxBackpressureEvents ??
    positiveIntEnv('SSE_MAX_BACKPRESSURE_EVENTS', DEFAULT_MAX_BACKPRESSURE_EVENTS);
  const startInterval: (callback: () => void, ms: number) => RealtimeInterval =
    options.setIntervalFn ?? ((callback, ms) => setInterval(callback, ms));
  const stopInterval: (timer: RealtimeInterval) => void =
    options.clearIntervalFn ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));

  const metricsState: RealtimeMetricsState = {
    totalConnections: 0,
    rejected: 0,
    dropped: 0,
    heartbeats: 0,
    backpressureEvents: 0,
    backpressureDrops: 0
  };

  let heartbeatTimer: RealtimeInterval | null = null;

  function clientMeta(request: RealtimeRequest): ClientMeta {
    const url = new URL(request.url, 'http://localhost');
    return {
      boardSlug: String(url.searchParams.get('boardSlug') || '').slice(0, 80),
      threadId: String(url.searchParams.get('threadId') || '').slice(0, 120),
      backpressureEvents: 0
    };
  }

  function dropClient(client: RealtimeClient): void {
    if (!clients.has(client)) {
      return;
    }
    clients.delete(client);
    metricsState.dropped += 1;
    try {
      client.end();
    } catch {
      // client already closed
    }
  }

  // Returns true if the write succeeded, false if it failed (client dropped).
  function safeWrite(client: RealtimeClient, line: string): boolean {
    try {
      const flushed = client.write(line);
      const meta = clients.get(client);
      if (flushed === false) {
        metricsState.backpressureEvents += 1;
        if (meta) {
          meta.backpressureEvents += 1;
          if (meta.backpressureEvents >= maxBackpressureEvents) {
            metricsState.backpressureDrops += 1;
            dropClient(client);
            return false;
          }
        }
      } else if (meta) {
        meta.backpressureEvents = 0;
      }
      return true;
    } catch {
      dropClient(client);
      return false;
    }
  }

  function ensureHeartbeat(): void {
    if (heartbeatTimer || heartbeatMs <= 0) {
      return;
    }
    heartbeatTimer = startInterval(() => {
      metricsState.heartbeats += 1;
      for (const client of [...clients.keys()]) {
        safeWrite(client, `: ping ${Date.now()}\n\n`);
      }
    }, heartbeatMs);
    if (typeof heartbeatTimer?.unref === 'function') {
      heartbeatTimer.unref();
    }
  }

  function maybeStopHeartbeat(): void {
    if (heartbeatTimer && clients.size === 0) {
      stopInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function boardCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const meta of clients.values()) {
      if (meta.boardSlug) {
        counts[meta.boardSlug] = (counts[meta.boardSlug] || 0) + 1;
      }
    }
    return counts;
  }

  return {
    handle(request: RealtimeRequest, response: RealtimeClient): void {
      if (clients.size >= maxClients) {
        metricsState.rejected += 1;
        response.writeHead(503, {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': Math.ceil(heartbeatMs / 1000) || 5
        });
        response.end(JSON.stringify({ ok: false, error: 'Realtime đã đạt giới hạn kết nối. Thử lại sau.' }));
        return;
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': '*'
      });
      clients.set(response, clientMeta(request));
      metricsState.totalConnections += 1;
      ensureHeartbeat();
      // Register before the first write so a client that throws on write is
      // dropped through the normal path instead of escaping handle().
      safeWrite(response, 'event: connected\ndata: {"ok":true}\n\n');

      request.on('close', () => {
        clients.delete(response);
        maybeStopHeartbeat();
      });
    },

    publish(event: string, payload: unknown): void {
      const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of [...clients.keys()]) {
        safeWrite(client, line);
      }
    },

    count(filter: RealtimeConnectionFilter = {}): number {
      if (!filter.boardSlug && !filter.threadId) {
        return clients.size;
      }
      return [...clients.values()].filter((meta) => {
        if (filter.boardSlug && meta.boardSlug !== filter.boardSlug) {
          return false;
        }
        if (filter.threadId && meta.threadId !== filter.threadId) {
          return false;
        }
        return true;
      }).length;
    },

    boardCounts,

    snapshot(): RealtimeSnapshot {
      return {
        total: clients.size,
        boards: boardCounts()
      };
    },

    // Production metrics + alert thresholds for /api/health and dashboards.
    metrics(): RealtimeMetrics {
      const clientsCount = clients.size;
      const capacityUsedPct = maxClients > 0 ? Math.round((clientsCount / maxClients) * 100) : 0;
      let capacityStatus: RealtimeCapacityStatus = 'ok';
      if (capacityUsedPct >= criticalPct) {
        capacityStatus = 'critical';
      } else if (capacityUsedPct >= warnPct) {
        capacityStatus = 'warning';
      }
      return {
        clients: clientsCount,
        boards: boardCounts(),
        maxClients,
        capacityUsedPct,
        capacityStatus,
        heartbeatMs,
        maxBackpressureEvents,
        totalConnections: metricsState.totalConnections,
        rejected: metricsState.rejected,
        dropped: metricsState.dropped,
        heartbeats: metricsState.heartbeats,
        backpressureEvents: metricsState.backpressureEvents,
        backpressureDrops: metricsState.backpressureDrops,
        thresholds: { warnPct, criticalPct }
      };
    },

    // Stop the heartbeat timer (used on shutdown and in tests).
    close(): void {
      if (heartbeatTimer) {
        stopInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  };
}
