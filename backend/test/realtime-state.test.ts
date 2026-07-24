import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createMemoryRealtimeState,
  createRedisRealtimeState
} from '../src/server/realtime-state.ts';

test('memory realtime state expires presence and unread caches by TTL', async () => {
  let current = 1_000;
  const state = createMemoryRealtimeState({
    now: () => current,
    presenceTtlSeconds: 2,
    unreadTtlSeconds: 3
  });

  await state.trackConnection({
    connectionId: 'server:socket',
    socketId: 'socket',
    serverId: 'server',
    userId: 'user-1',
    username: 'alice',
    role: 'user',
    connectedAt: new Date(current).toISOString(),
    transport: 'websocket',
    origin: 'https://forum.example',
    userAgent: 'test',
    addressHash: 'hash'
  });
  await state.setUnreadCount('user-1', 4);

  assert.deepEqual(await state.getPresence(['user-1', 'user-2']), {
    'user-1': true,
    'user-2': false
  });
  assert.equal(await state.getUnreadCount('user-1'), 4);

  current += 2_001;
  assert.deepEqual(await state.getPresence(['user-1']), { 'user-1': false });
  assert.equal(await state.getUnreadCount('user-1'), 4);

  current += 1_000;
  assert.equal(await state.getUnreadCount('user-1'), null);
  await state.close();
});

test('memory realtime state enforces per-user windows and fans out events', async () => {
  let current = 10_000;
  const state = createMemoryRealtimeState({ now: () => current });
  const first = await state.consumeUserRateLimit('user-1', 'dm:send', {
    limit: 2,
    windowMs: 1_000
  });
  const second = await state.consumeUserRateLimit('user-1', 'dm:send', {
    limit: 2,
    windowMs: 1_000
  });
  const third = await state.consumeUserRateLimit('user-1', 'dm:send', {
    limit: 2,
    windowMs: 1_000
  });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfterMs, 1_000);

  current += 1_001;
  assert.equal((await state.consumeUserRateLimit('user-1', 'dm:send', {
    limit: 2,
    windowMs: 1_000
  })).allowed, true);

  const received: string[] = [];
  const unsubscribe = await state.subscribeFanout((envelope) => received.push(envelope.event));
  await state.publishFanout({
    originId: 'server-a',
    event: 'thread:created',
    payload: { threadId: 't1' },
    publishedAt: new Date(current).toISOString()
  });
  assert.deepEqual(received, ['thread:created']);
  await unsubscribe();
  await state.close();
});

test('redis realtime state uses TTL keys, sorted presence, atomic limits, and Pub/Sub', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let subscribed: ((message: string) => void) | null = null;
  const client = {
    isReady: true,
    isOpen: false,
    async set(...args: unknown[]) { calls.push({ method: 'set', args }); },
    async zAdd(...args: unknown[]) { calls.push({ method: 'zAdd', args }); },
    async expire(...args: unknown[]) { calls.push({ method: 'expire', args }); },
    async del(...args: unknown[]) { calls.push({ method: 'del', args }); },
    async zRem(...args: unknown[]) { calls.push({ method: 'zRem', args }); },
    async zRemRangeByScore(...args: unknown[]) { calls.push({ method: 'zRemRangeByScore', args }); },
    async zCard(...args: unknown[]) { calls.push({ method: 'zCard', args }); return 1; },
    async eval(...args: unknown[]) { calls.push({ method: 'eval', args }); return [3, 4_000]; },
    async get(...args: unknown[]) { calls.push({ method: 'get', args }); return '7'; },
    async publish(...args: unknown[]) { calls.push({ method: 'publish', args }); return 1; }
  };
  const subscriber = {
    isReady: true,
    isOpen: false,
    async subscribe(_channel: string, handler: (message: string) => void) {
      subscribed = handler;
    }
  };
  const state = createRedisRealtimeState({
    client,
    subscriber,
    prefix: 'test:',
    presenceTtlSeconds: 30,
    unreadTtlSeconds: 45,
    now: () => 5_000
  });

  await state.trackConnection({
    connectionId: 'server:socket',
    socketId: 'socket',
    serverId: 'server',
    userId: 'user-1',
    connectedAt: new Date(5_000).toISOString(),
    transport: 'websocket',
    origin: '',
    userAgent: 'test',
    addressHash: 'hash'
  });
  assert.ok(calls.some((call) => call.method === 'set' && String(call.args[0]).includes('connection:')));
  assert.ok(calls.some((call) => call.method === 'zAdd' && String(call.args[0]).includes('presence:user-1')));

  const limited = await state.consumeUserRateLimit('user-1', 'dm:send', {
    limit: 2,
    windowMs: 10_000
  });
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterMs, 4_000);
  assert.equal(await state.getUnreadCount('user-1'), 7);
  await state.setUnreadCount('user-1', 9);
  assert.ok(calls.some((call) => (
    call.method === 'set' &&
    (call.args[2] as { EX?: number } | undefined)?.EX === 45
  )));

  const received: string[] = [];
  await state.subscribeFanout((envelope) => received.push(envelope.event));
  assert.ok(subscribed);
  subscribed!(JSON.stringify({
    originId: 'server-b',
    event: 'dm:message',
    payload: { participantIds: ['user-1'] },
    publishedAt: new Date(5_000).toISOString()
  }));
  assert.deepEqual(received, ['dm:message']);
  await state.publishFanout({
    originId: 'server-a',
    event: 'thread:created',
    payload: {},
    publishedAt: new Date(5_000).toISOString()
  });
  assert.ok(calls.some((call) => call.method === 'publish' && call.args[0] === 'test:fanout'));
});
