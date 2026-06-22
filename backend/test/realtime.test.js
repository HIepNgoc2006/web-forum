import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRealtimeHub } from '../src/server/realtime.js';

function createResponse({ writeImpl } = {}) {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    ended: false,
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers ?? {};
    },
    write(line) {
      if (writeImpl) {
        return writeImpl(line);
      }
      this.chunks.push(line);
      return true;
    },
    end(data) {
      if (data) {
        this.chunks.push(data);
      }
      this.ended = true;
    }
  };
}

function createRequest(query = '') {
  const closeHandlers = [];
  return {
    url: `/events${query}`,
    on(event, handler) {
      if (event === 'close') {
        closeHandlers.push(handler);
      }
    },
    fireClose() {
      for (const handler of closeHandlers) {
        handler();
      }
    }
  };
}

test('SSE hub caps concurrent connections and rejects over-cap with 503', () => {
  const hub = createRealtimeHub({ maxClients: 2, heartbeatMs: 0 });

  const a = createResponse();
  const b = createResponse();
  const c = createResponse();
  hub.handle(createRequest('?boardSlug=x'), a);
  hub.handle(createRequest('?boardSlug=x'), b);
  hub.handle(createRequest('?boardSlug=y'), c);

  assert.equal(hub.count(), 2);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(c.statusCode, 503);
  assert.ok(c.headers['retry-after']);

  const metrics = hub.metrics();
  assert.equal(metrics.clients, 2);
  assert.equal(metrics.maxClients, 2);
  assert.equal(metrics.rejected, 1);
  assert.equal(metrics.totalConnections, 2);
});

test('SSE metrics report capacity warning and critical thresholds', () => {
  const hub = createRealtimeHub({ maxClients: 10, heartbeatMs: 0, warnPct: 70, criticalPct: 90 });
  for (let i = 0; i < 7; i++) {
    hub.handle(createRequest(), createResponse());
  }
  assert.equal(hub.metrics().capacityStatus, 'warning');
  for (let i = 0; i < 2; i++) {
    hub.handle(createRequest(), createResponse());
  }
  assert.equal(hub.metrics().capacityUsedPct, 90);
  assert.equal(hub.metrics().capacityStatus, 'critical');
});

test('SSE metrics read alert thresholds from env and keep warning before critical', () => {
  const originalWarn = process.env.SSE_WARN_PCT;
  const originalCritical = process.env.SSE_CRITICAL_PCT;
  process.env.SSE_WARN_PCT = '95';
  process.env.SSE_CRITICAL_PCT = '80';

  try {
    const hub = createRealtimeHub({ maxClients: 10, heartbeatMs: 0 });
    for (let i = 0; i < 8; i++) {
      hub.handle(createRequest(), createResponse());
    }
    assert.deepEqual(hub.metrics().thresholds, { warnPct: 80, criticalPct: 95 });
    assert.equal(hub.metrics().capacityStatus, 'warning');
    for (let i = 0; i < 2; i++) {
      hub.handle(createRequest(), createResponse());
    }
    assert.equal(hub.metrics().capacityStatus, 'critical');
  } finally {
    if (originalWarn === undefined) {
      delete process.env.SSE_WARN_PCT;
    } else {
      process.env.SSE_WARN_PCT = originalWarn;
    }
    if (originalCritical === undefined) {
      delete process.env.SSE_CRITICAL_PCT;
    } else {
      process.env.SSE_CRITICAL_PCT = originalCritical;
    }
  }
});

test('SSE hub drops a client when a write throws and keeps others', () => {
  const hub = createRealtimeHub({ maxClients: 10, heartbeatMs: 0 });
  const healthy = createResponse();
  const broken = createResponse({
    writeImpl() {
      throw new Error('socket closed');
    }
  });
  // connected event is written on handle; broken throws there too, so register
  // healthy first then broken, then publish to exercise drop on broadcast.
  hub.handle(createRequest(), healthy);
  // broken throws during the initial connected write; it should be dropped.
  hub.handle(createRequest(), broken);
  assert.equal(hub.count(), 1);
  assert.equal(broken.statusCode, 200);

  hub.publish('thread:created', { id: 't1' });
  assert.equal(hub.count(), 1);
  assert.ok(hub.metrics().dropped >= 1);
  assert.ok(healthy.chunks.some((line) => line.includes('thread:created')));
});

test('SSE hub counts backpressure when client write buffer is full', () => {
  const hub = createRealtimeHub({ maxClients: 10, heartbeatMs: 0 });
  const slow = createResponse({ writeImpl: () => false });
  hub.handle(createRequest(), slow);
  hub.publish('thread:created', { id: 't1' });
  // initial connected write + publish both report backpressure
  assert.ok(hub.metrics().backpressureEvents >= 1);
  assert.equal(hub.count(), 1);
});

test('SSE hub drops clients after repeated backpressure', () => {
  const hub = createRealtimeHub({ maxClients: 10, heartbeatMs: 0, maxBackpressureEvents: 2 });
  const slow = createResponse({ writeImpl: () => false });

  hub.handle(createRequest(), slow);
  assert.equal(hub.count(), 1);
  hub.publish('thread:created', { id: 't1' });

  assert.equal(hub.count(), 0);
  assert.equal(slow.ended, true);
  assert.equal(hub.metrics().backpressureDrops, 1);
  assert.equal(hub.metrics().dropped, 1);
});

test('SSE heartbeat pings connected clients and is controllable', () => {
  let captured = null;
  const hub = createRealtimeHub({
    maxClients: 10,
    heartbeatMs: 1000,
    setIntervalFn: (fn) => {
      captured = fn;
      return { unref() {} };
    },
    clearIntervalFn: () => {}
  });
  const client = createResponse();
  hub.handle(createRequest(), client);
  assert.equal(typeof captured, 'function');

  captured();
  assert.equal(hub.metrics().heartbeats, 1);
  assert.ok(client.chunks.some((line) => line.startsWith(': ping')));
  hub.close();
});

test('SSE hub removes client on request close', () => {
  const hub = createRealtimeHub({ maxClients: 10, heartbeatMs: 0 });
  const request = createRequest('?boardSlug=hoc-tap');
  hub.handle(request, createResponse());
  assert.equal(hub.count(), 1);
  assert.deepEqual(hub.boardCounts(), { 'hoc-tap': 1 });
  request.fireClose();
  assert.equal(hub.count(), 0);
});
