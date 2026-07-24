import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { io as createSocketClient, type Socket } from 'socket.io-client';

import '../src/core/env-init.ts';
import {
  createRealtimeHub,
  type RealtimeAuthentication,
  type RealtimeAuthenticator,
  type RealtimeHub,
  type RealtimeIdentity
} from '../src/server/realtime.ts';
import {
  createRealtimeStateFromEnv,
  type RealtimeConnectionMetadata,
  type RealtimeFanoutEnvelope,
  type RealtimeState
} from '../src/server/realtime-state.ts';

type EventPayload = Record<string, any>;

const redisUrl = process.env.REALTIME_REDIS_URL
  || process.env.UPSTASH_REDIS_URL
  || process.env.REDIS_URL
  || '';
const redisHost = (() => {
  try {
    return new URL(redisUrl).hostname;
  } catch {
    return '';
  }
})();

function safeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  if (redisUrl) {
    message = message.replaceAll(redisUrl, '[redis-url]');
  }
  if (redisHost) {
    message = message.replaceAll(redisHost, '[redis-host]');
  }
  return message.replace(/rediss?:\/\/\S+/gi, '[redis-url]');
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function eventually(
  check: () => Promise<boolean>,
  label: string,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(75);
  }
  throw new Error(`${label} timed out`);
}

function nextEvent(socket: Socket, event: string): Promise<EventPayload> {
  return withTimeout(new Promise<EventPayload>((resolve) => {
    socket.once(event, (payload) => resolve(payload as EventPayload));
  }), `Socket.IO event ${event}`);
}

async function connectSocket(
  endpoint: string,
  auth: Record<string, string>,
  {
    addTrailingSlash = true,
    transports = ['websocket']
  }: {
    addTrailingSlash?: boolean;
    transports?: Array<'polling' | 'websocket'>;
  } = {}
): Promise<Socket> {
  const socket = createSocketClient(endpoint, {
    path: '/socket.io',
    addTrailingSlash,
    transports,
    auth,
    autoConnect: false,
    reconnection: false,
    timeout: 8_000
  });
  const connected = withTimeout(new Promise<void>((resolve, reject) => {
    socket.once('connected', () => resolve());
    socket.once('connect_error', (error) => reject(error));
  }), 'Socket.IO connection');
  socket.connect();
  await connected;
  return socket;
}

function listen(server: http.Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  return withTimeout(once(server, 'listening').then(() => {
    return (server.address() as AddressInfo).port;
  }), 'HTTP server listen');
}

async function closeServer(server: http.Server | undefined): Promise<void> {
  if (!server?.listening) {
    return;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

const alice: RealtimeIdentity = {
  userId: 'live-alice',
  username: 'live-alice',
  role: 'user',
  permissions: []
};
const bob: RealtimeIdentity = {
  userId: 'live-bob',
  username: 'live-bob',
  role: 'user',
  permissions: []
};
const moderator: RealtimeIdentity = {
  userId: 'live-moderator',
  username: 'live-moderator',
  role: 'admin',
  permissions: ['moderate']
};

const authenticate: RealtimeAuthenticator = async ({
  accountToken,
  adminToken
}): Promise<RealtimeAuthentication> => {
  const account = accountToken === 'alice-token'
    ? alice
    : accountToken === 'bob-token'
      ? bob
      : undefined;
  const privileged = adminToken === 'moderator-token' ? moderator : undefined;
  if ((accountToken && !account) || (adminToken && !privileged)) {
    throw new Error('invalid live-smoke token');
  }
  return {
    ...(account ? { account } : {}),
    ...(privileged ? { moderator: privileged } : {}),
    identities: [account, privileged].filter(Boolean) as RealtimeIdentity[]
  };
};

async function main(): Promise<void> {
  assert.ok(redisUrl, 'backend/.env does not configure a realtime Redis URL');
  assert.equal(new URL(redisUrl).protocol, 'rediss:', 'realtime Redis URL is not TLS rediss://');

  const runId = crypto.randomBytes(8).toString('hex');
  const prefix = `36chan:live-smoke:${runId}:`;
  const liveEnv: NodeJS.ProcessEnv = {
    ...process.env,
    REALTIME_REDIS_URL: redisUrl,
    REALTIME_REDIS_REQUIRED: 'true',
    REALTIME_REDIS_FAILURE_MODE: 'closed',
    REALTIME_REDIS_PREFIX: prefix,
    REALTIME_PRESENCE_TTL_SECONDS: '6',
    REALTIME_UNREAD_TTL_SECONDS: '2'
  };
  const warnings: string[] = [];
  const logger = (entry: Record<string, unknown>) => {
    if (entry.level === 'warn') {
      warnings.push(String(entry.event || 'realtime.warning'));
    }
  };

  let stateA: RealtimeState | undefined;
  let stateB: RealtimeState | undefined;
  let hubA: RealtimeHub | undefined;
  let hubB: RealtimeHub | undefined;
  let serverA: http.Server | undefined;
  let serverB: http.Server | undefined;
  const sockets: Socket[] = [];

  try {
    stateA = await createRealtimeStateFromEnv({ env: liveEnv, logger });
    stateB = await createRealtimeStateFromEnv({ env: liveEnv, logger });
    assert.equal(stateA.driver, 'redis');
    assert.equal(stateB.driver, 'redis');
    assert.equal(stateA.health().ready, true);
    assert.equal(stateB.health().ready, true);

    const metadata: RealtimeConnectionMetadata = {
      connectionId: `manual:${runId}`,
      socketId: `manual-${runId}`,
      serverId: 'manual-a',
      userId: 'live-ttl-user',
      username: 'live-ttl-user',
      role: 'user',
      connectedAt: new Date().toISOString(),
      transport: 'smoke',
      origin: '',
      userAgent: '36chan-live-smoke',
      addressHash: crypto.createHash('sha256').update(runId).digest('hex')
    };
    await stateA.trackConnection(metadata);
    assert.deepEqual(await stateB.getPresence(['live-ttl-user']), {
      'live-ttl-user': true
    });

    const firstLimit = await stateA.consumeUserRateLimit('live-rate-user', 'send', {
      limit: 1,
      windowMs: 2_000
    });
    const secondLimit = await stateB.consumeUserRateLimit('live-rate-user', 'send', {
      limit: 1,
      windowMs: 2_000
    });
    assert.equal(firstLimit.allowed, true);
    assert.equal(firstLimit.count, 1);
    assert.equal(secondLimit.allowed, false);
    assert.equal(secondLimit.count, 2);
    assert.ok(secondLimit.retryAfterMs > 0);

    await stateA.setUnreadCount('live-unread-user', 7);
    assert.equal(await stateB.getUnreadCount('live-unread-user'), 7);
    await stateB.invalidateUnreadCount('live-unread-user');
    assert.equal(await stateA.getUnreadCount('live-unread-user'), null);
    await stateA.setUnreadCount('live-unread-expiry', 3);
    await delay(2_200);
    assert.equal(await stateB.getUnreadCount('live-unread-expiry'), null);

    const expectedEnvelope: RealtimeFanoutEnvelope = {
      originId: 'state-a',
      event: 'live:state-fanout',
      payload: { runId },
      publishedAt: new Date().toISOString()
    };
    const fanoutReceived = new Promise<RealtimeFanoutEnvelope>((resolve) => {
      void stateB?.subscribeFanout((envelope) => {
        if (envelope.event === expectedEnvelope.event) {
          resolve(envelope);
        }
      }).then(async (unsubscribe) => {
        await stateA?.publishFanout(expectedEnvelope);
        await withTimeout(
          new Promise<void>((done) => setTimeout(done, 500)),
          'fan-out settle'
        );
        await unsubscribe();
      });
    });
    const receivedEnvelope = await withTimeout(fanoutReceived, 'Redis Pub/Sub fan-out');
    assert.deepEqual(receivedEnvelope.payload, { runId });

    await delay(4_100);
    assert.deepEqual(await stateB.getPresence(['live-ttl-user']), {
      'live-ttl-user': false
    });

    let currentHubA: RealtimeHub;
    let currentHubB: RealtimeHub;
    const participants = [alice.userId, bob.userId];
    const serviceFor = (getHub: () => RealtimeHub) => ({
      async sendDmMessage(userId: string, conversationId: string, body: EventPayload) {
        const messageId = `message-${runId}`;
        getHub().publish('dm:message', {
          participantIds: participants,
          conversationId,
          messageId,
          senderId: userId,
          body: String(body.body || '')
        });
        return { message: { id: messageId } };
      },
      async signalDmTyping(userId: string, conversationId: string) {
        getHub().publish('dm:typing', {
          participantIds: participants,
          conversationId,
          userId,
          typing: true
        });
        return { ok: true };
      },
      async markDmConversationRead(userId: string, conversationId: string) {
        getHub().publish('dm:read', {
          participantIds: participants,
          conversationId,
          readerId: userId,
          readAt: new Date().toISOString()
        });
        return { id: conversationId, unreadCount: 0 };
      }
    });

    hubA = createRealtimeHub({
      state: stateA,
      serverId: `socket-a-${runId}`,
      heartbeatMs: 0,
      logger
    });
    hubB = createRealtimeHub({
      state: stateB,
      serverId: `socket-b-${runId}`,
      heartbeatMs: 0,
      logger
    });
    currentHubA = hubA;
    currentHubB = hubB;
    serverA = http.createServer((_request, response) => {
      response.statusCode = 404;
      response.end('not found');
    });
    serverB = http.createServer((_request, response) => {
      response.statusCode = 404;
      response.end('not found');
    });
    await hubA.attach(serverA, {
      authenticate,
      service: serviceFor(() => currentHubA)
    });
    await hubB.attach(serverB, {
      authenticate,
      service: serviceFor(() => currentHubB)
    });
    const [portA, portB] = await Promise.all([listen(serverA), listen(serverB)]);

    const aliceSocket = await connectSocket(
      `http://127.0.0.1:${portA}`,
      { accountToken: 'alice-token' },
      { addTrailingSlash: false, transports: ['polling', 'websocket'] }
    );
    sockets.push(aliceSocket);
    const bobSocket = await connectSocket(
      `http://127.0.0.1:${portB}`,
      { accountToken: 'bob-token' }
    );
    sockets.push(bobSocket);
    const moderatorSocket = await connectSocket(
      `http://127.0.0.1:${portB}`,
      { adminToken: 'moderator-token' }
    );
    sockets.push(moderatorSocket);
    const anonymousSocket = await connectSocket(
      `http://127.0.0.1:${portA}`,
      {}
    );
    sockets.push(anonymousSocket);

    await eventually(async () => {
      const presence = await stateA?.getPresence([bob.userId]);
      return presence?.[bob.userId] === true;
    }, 'cross-server Socket.IO presence');

    const presenceAck = await aliceSocket.timeout(8_000).emitWithAck('presence:query', {
      userIds: [bob.userId, 'live-missing-user']
    }) as EventPayload;
    assert.equal(presenceAck.ok, true);
    assert.deepEqual(presenceAck.data.presence, {
      [bob.userId]: true,
      'live-missing-user': false
    });

    let anonymousPrivateEvents = 0;
    let ordinaryModerationEvents = 0;
    for (const event of [
      'dm:message',
      'dm:typing',
      'dm:read',
      'notification:delivery',
      'moderation:event'
    ]) {
      anonymousSocket.on(event, () => {
        anonymousPrivateEvents += 1;
      });
    }
    bobSocket.on('moderation:event', () => {
      ordinaryModerationEvents += 1;
    });

    const incomingMessage = nextEvent(bobSocket, 'dm:message');
    const sendAck = await aliceSocket.timeout(8_000).emitWithAck('dm:send', {
      conversationId: 'live-conversation',
      body: 'live socket message'
    }) as EventPayload;
    assert.equal(sendAck.ok, true);
    assert.equal((await incomingMessage).senderId, alice.userId);

    const incomingTyping = nextEvent(bobSocket, 'dm:typing');
    const typingAck = await aliceSocket.timeout(8_000).emitWithAck('dm:typing', {
      conversationId: 'live-conversation'
    }) as EventPayload;
    assert.equal(typingAck.ok, true);
    assert.equal((await incomingTyping).userId, alice.userId);

    const incomingRead = nextEvent(aliceSocket, 'dm:read');
    const readAck = await bobSocket.timeout(8_000).emitWithAck('dm:read', {
      conversationId: 'live-conversation'
    }) as EventPayload;
    assert.equal(readAck.ok, true);
    assert.equal((await incomingRead).readerId, bob.userId);

    const incomingNotification = nextEvent(bobSocket, 'notification:delivery');
    hubA.publish('notification:delivery', {
      participantIds: [bob.userId],
      notificationId: `notification-${runId}`
    });
    assert.equal(
      (await incomingNotification).notificationId,
      `notification-${runId}`
    );

    const incomingModeration = nextEvent(moderatorSocket, 'moderation:event');
    hubA.publish('moderation:event', {
      action: 'live-smoke',
      targetId: runId
    });
    assert.equal((await incomingModeration).action, 'live-smoke');

    await delay(250);
    assert.equal(anonymousPrivateEvents, 0);
    assert.equal(ordinaryModerationEvents, 0);
    assert.equal(hubA.metrics().state.driver, 'redis');
    assert.equal(hubB.metrics().state.driver, 'redis');
    assert.ok(hubA.metrics().socketConnections >= 2);
    assert.ok(hubB.metrics().socketConnections >= 2);

    console.log(JSON.stringify({
      ok: true,
      redis: {
        tls: true,
        drivers: [stateA.driver, stateB.driver],
        ready: stateA.health().ready && stateB.health().ready,
        presenceTtl: true,
        atomicUserRateLimit: true,
        unreadCacheAndTtl: true,
        pubSubFanout: true
      },
      socketIo: {
        servers: 2,
        noTrailingSlashPollingAndUpgrade: true,
        authenticatedPrivateRooms: true,
        liveMessages: true,
        typingIndicators: true,
        readReceipts: true,
        notificationDelivery: true,
        moderationRoom: true,
        crossServerPresence: true,
        multiServerFanout: true,
        anonymousPrivateLeak: false
      },
      warnings
    }, null, 2));
  } finally {
    for (const socket of sockets) {
      socket.removeAllListeners();
      socket.close();
    }
    await delay(150);
    if (hubA) {
      await hubA.close().catch(() => {});
      stateA = undefined;
    }
    if (hubB) {
      await hubB.close().catch(() => {});
      stateB = undefined;
    }
    if (stateA) {
      await stateA.close().catch(() => {});
    }
    if (stateB) {
      await stateB.close().catch(() => {});
    }
    await closeServer(serverA).catch(() => {});
    await closeServer(serverB).catch(() => {});
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: safeErrorMessage(error)
  }));
  process.exitCode = 1;
});

