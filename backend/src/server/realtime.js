const DEFAULT_MAX_CLIENTS = 1000;
const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_WARN_PCT = 75;
const DEFAULT_CRITICAL_PCT = 90;

function positiveIntEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function createRealtimeHub(options = {}) {
  const clients = new Map();
  const maxClients = options.maxClients ?? positiveIntEnv('SSE_MAX_CLIENTS', DEFAULT_MAX_CLIENTS);
  const heartbeatMs = options.heartbeatMs ?? positiveIntEnv('SSE_HEARTBEAT_MS', DEFAULT_HEARTBEAT_MS);
  const warnPct = options.warnPct ?? DEFAULT_WARN_PCT;
  const criticalPct = options.criticalPct ?? DEFAULT_CRITICAL_PCT;
  const startInterval = options.setIntervalFn ?? setInterval;
  const stopInterval = options.clearIntervalFn ?? clearInterval;

  const metricsState = {
    totalConnections: 0,
    rejected: 0,
    dropped: 0,
    heartbeats: 0,
    backpressureEvents: 0
  };

  let heartbeatTimer = null;

  function clientMeta(request) {
    const url = new URL(request.url, 'http://localhost');
    return {
      boardSlug: String(url.searchParams.get('boardSlug') || '').slice(0, 80),
      threadId: String(url.searchParams.get('threadId') || '').slice(0, 120)
    };
  }

  function dropClient(client) {
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
  function safeWrite(client, line) {
    try {
      const flushed = client.write(line);
      if (flushed === false) {
        metricsState.backpressureEvents += 1;
      }
      return true;
    } catch {
      dropClient(client);
      return false;
    }
  }

  function ensureHeartbeat() {
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

  function maybeStopHeartbeat() {
    if (heartbeatTimer && clients.size === 0) {
      stopInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function boardCounts() {
    const counts = {};
    for (const meta of clients.values()) {
      if (meta.boardSlug) {
        counts[meta.boardSlug] = (counts[meta.boardSlug] || 0) + 1;
      }
    }
    return counts;
  }

  return {
    handle(request, response) {
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

    publish(event, payload) {
      const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of [...clients.keys()]) {
        safeWrite(client, line);
      }
    },

    count(filter = {}) {
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

    snapshot() {
      return {
        total: clients.size,
        boards: boardCounts()
      };
    },

    // Production metrics + alert thresholds for /api/health and dashboards.
    metrics() {
      const clientsCount = clients.size;
      const capacityUsedPct = maxClients > 0 ? Math.round((clientsCount / maxClients) * 100) : 0;
      let capacityStatus = 'ok';
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
        totalConnections: metricsState.totalConnections,
        rejected: metricsState.rejected,
        dropped: metricsState.dropped,
        heartbeats: metricsState.heartbeats,
        backpressureEvents: metricsState.backpressureEvents,
        thresholds: { warnPct, criticalPct }
      };
    },

    // Stop the heartbeat timer (used on shutdown and in tests).
    close() {
      if (heartbeatTimer) {
        stopInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  };
}
