import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { io as createSocketClient } from 'socket.io-client';

import { createRealtimeHub } from '../src/server/realtime.ts';
import { createMemoryRealtimeState } from '../src/server/realtime-state.ts';

type TestResponse = {
  statusCode: number;
  headers: Record<string, string | number>;
  chunks: string[];
  ended: boolean;
  writeHead(code: number, headers?: Record<string, string | number>): void;
  write(line: string): boolean | void;
  end(data?: string): void;
};

type TestRequest = {
  url: string;
  on(event: 'close', handler: () => void): void;
  fireClose(): void;
};

type CreateResponseOptions = {
  writeImpl?: (line: string) => boolean | void;
};

function createResponse({ writeImpl }: CreateResponseOptions = {}): TestResponse {
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

function createRequest(query = ''): TestRequest {
  const closeHandlers: Array<() => void> = [];
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

test('SSE hub caps concurrent connections per source and releases slots on close', () => {
  const hub = createRealtimeHub({
    maxClients: 10,
    maxConnectionsPerAddress: 1,
    heartbeatMs: 0
  });
  const firstRequest = createRequest();
  const first = createResponse();
  const rejected = createResponse();
  hub.handle(firstRequest, first);
  hub.handle(createRequest(), rejected);
  assert.equal(first.statusCode, 200);
  assert.equal(rejected.statusCode, 429);

  firstRequest.fireClose();
  const replacement = createResponse();
  hub.handle(createRequest(), replacement);
  assert.equal(replacement.statusCode, 200);
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
  let captured: (() => void) | null = null;
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
  assert.ok(captured);

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

test('SSE publish sends events only to matching board and thread subscriptions', () => {
  const hub = createRealtimeHub({ maxClients: 10, heartbeatMs: 0 });
  const all = createResponse();
  const boardA = createResponse();
  const boardB = createResponse();
  const threadA = createResponse();
  const threadB = createResponse();
  hub.handle(createRequest(), all);
  hub.handle(createRequest('?boardSlug=hoc-tap'), boardA);
  hub.handle(createRequest('?boardSlug=an-uong'), boardB);
  hub.handle(createRequest('?threadId=thread-a'), threadA);
  hub.handle(createRequest('?threadId=thread-b'), threadB);
  for (const client of [all, boardA, boardB, threadA, threadB]) {
    client.chunks.length = 0;
  }

  hub.publish('thread:updated', {
    thread: { id: 'thread-a', boardSlug: 'hoc-tap' }
  });

  assert.equal(all.chunks.some((line) => line.includes('thread:updated')), true);
  assert.equal(boardA.chunks.some((line) => line.includes('thread:updated')), true);
  assert.equal(threadA.chunks.some((line) => line.includes('thread:updated')), true);
  assert.equal(boardB.chunks.length, 0);
  assert.equal(threadB.chunks.length, 0);

  hub.publish('system:event', { ok: true });
  assert.equal(all.chunks.some((line) => line.includes('system:event')), true);
  assert.equal(boardA.chunks.some((line) => line.includes('system:event')), false);
  assert.equal(threadA.chunks.some((line) => line.includes('system:event')), false);
});

test('Socket.IO authenticates rooms, delivers private events, and accepts bidirectional DM signals', async () => {
  const state = createMemoryRealtimeState({ presenceTtlSeconds: 30 });
  const hub = createRealtimeHub({
    state,
    serverId: 'server-a',
    heartbeatMs: 0,
    maxClients: 10
  });
  const serviceCalls: Array<{ action: string; userId: string; conversationId: string }> = [];
  const service = {
    async sendDmMessage(userId: string, conversationId: string) {
      serviceCalls.push({ action: 'send', userId, conversationId });
      return { message: { id: 'm1' } };
    },
    async signalDmTyping(userId: string, conversationId: string) {
      if (conversationId === 'internal-failure') {
        throw new Error('redis://private-host:6379');
      }
      serviceCalls.push({ action: 'typing', userId, conversationId });
      return { ok: true };
    },
    async markDmConversationRead(userId: string, conversationId: string) {
      serviceCalls.push({ action: 'read', userId, conversationId });
      return { id: conversationId, unreadCount: 0 };
    }
  };
  const server = http.createServer((_request, response) => response.end('not found'));
  await hub.attach(server, {
    service,
    async authenticate({ accountToken }) {
      if (accountToken === 'alice') {
        const identity = { userId: 'u1', username: 'alice', role: 'user', permissions: [] };
        return { account: identity, identities: [identity] };
      }
      if (accountToken === 'bob') {
        const identity = { userId: 'u2', username: 'bob', role: 'user', permissions: [] };
        return { account: identity, identities: [identity] };
      }
      throw new Error('invalid token');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const endpoint = 'http://127.0.0.1:' + port;
  const alice = createSocketClient(endpoint, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { accountToken: 'alice' }
  });
  const bob = createSocketClient(endpoint, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { accountToken: 'bob' }
  });
  const anonymous = createSocketClient(endpoint, {
    path: '/socket.io',
    addTrailingSlash: false,
    transports: ['websocket']
  });

  const waitForConnection = (socket: ReturnType<typeof createSocketClient>) =>
    new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
  try {
    await Promise.all([
      waitForConnection(alice),
      waitForConnection(bob),
      waitForConnection(anonymous)
    ]);
    let anonymousDmEvents = 0;
    anonymous.on('dm:message', () => {
      anonymousDmEvents += 1;
    });
    const aliceMessage = new Promise<any>((resolve) => alice.once('dm:message', resolve));
    const bobMessage = new Promise<any>((resolve) => bob.once('dm:message', resolve));
    hub.publish('dm:message', {
      conversationId: 'c1',
      messageId: 'm1',
      participantIds: ['u1', 'u2']
    });
    assert.equal((await aliceMessage).messageId, 'm1');
    assert.equal((await bobMessage).messageId, 'm1');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(anonymousDmEvents, 0);

    const typingAck = await alice.timeout(1_000).emitWithAck('dm:typing', {
      conversationId: 'c1'
    });
    assert.equal(typingAck.ok, true);
    assert.deepEqual(serviceCalls.at(-1), {
      action: 'typing',
      userId: 'u1',
      conversationId: 'c1'
    });

    const failedAck = await alice.timeout(1_000).emitWithAck('dm:typing', {
      conversationId: 'internal-failure'
    });
    assert.equal(failedAck.statusCode, 500);
    assert.equal(failedAck.error, 'Realtime request failed.');

    const presenceAck = await alice.timeout(1_000).emitWithAck('presence:query', {
      userIds: ['u1', 'missing']
    });
    assert.deepEqual(presenceAck.data.presence, { u1: true, missing: false });
    assert.equal(hub.metrics().socketClients, 3);
  } finally {
    alice.close();
    bob.close();
    anonymous.close();
    await hub.close();
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
  }
});

test('Socket.IO reauthentication leaves rooms for revoked secondary identities', async () => {
  let refresh: (() => void) | undefined;
  let secondaryRevoked = false;
  const hub = createRealtimeHub({
    heartbeatMs: 0,
    maxClients: 10,
    setIntervalFn(callback) {
      refresh = callback;
      return { unref() {} };
    },
    clearIntervalFn() {}
  });
  const primary = { userId: 'u-primary', username: 'primary', role: 'user', permissions: [] };
  const secondary = { userId: 'u-secondary', username: 'secondary', role: 'user', permissions: [] };
  const server = http.createServer((_request, response) => response.end('not found'));
  await hub.attach(server, {
    service: {},
    async authenticate() {
      return {
        account: primary,
        identities: secondaryRevoked ? [primary] : [primary, secondary]
      };
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const socket = createSocketClient('http://127.0.0.1:' + port, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { accountToken: 'combined' }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    let secondaryEvents = 0;
    socket.on('dm:message', () => {
      secondaryEvents += 1;
    });
    secondaryRevoked = true;
    refresh?.();
    await new Promise((resolve) => setTimeout(resolve, 30));
    hub.publish('dm:message', {
      participantIds: ['u-secondary'],
      messageId: 'revoked-message'
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(secondaryEvents, 0);
  } finally {
    socket.close();
    await hub.close();
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
  }
});
