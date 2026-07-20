import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createForumService } from '../src/core/forum-service.ts';
import { createMemoryStore } from '../src/core/forum-store.ts';
import { decryptDmBody } from '../src/core/dm-crypto.ts';
import { createHttpServer } from '../src/server/http-app.ts';

type ServiceError = {
  message?: string;
  statusCode?: number;
};

function isServiceError(error: unknown, statusCode: number) {
  return typeof error === 'object' && error !== null && (error as ServiceError).statusCode === statusCode;
}

function createTestService(overrides: Record<string, unknown> = {}) {
  return createForumService({
    store: createMemoryStore(),
    ai: { moderate: async () => ({ status: 'Safe', labels: [] }) },
    now: () => new Date('2026-07-20T12:00:00Z'),
    dmEncryptionSecret: 'test-dm-secret-key',
    ...overrides
  });
}

async function registerPair(service: ReturnType<typeof createTestService>) {
  const alice = await service.registerAccount({
    username: 'alice_dm',
    password: 'securepass12',
    captchaToken: 'dev-pass'
  });
  const bob = await service.registerAccount({
    username: 'bob_dm',
    password: 'securepass12',
    captchaToken: 'dev-pass'
  });
  return { alice, bob };
}

describe('DM encryption helpers', () => {
  it('round-trips ciphertext with AES-256-GCM', async () => {
    const { encryptDmBody, decryptDmBody: decrypt } = await import('../src/core/dm-crypto.ts');
    const payload = encryptDmBody('xin chào 36chan', 'unit-secret');
    assert.notEqual(payload.ciphertext, 'xin chào 36chan');
    assert.equal(decrypt(payload, 'unit-secret'), 'xin chào 36chan');
  });
});

describe('Direct messages (account only)', () => {
  it('opens a conversation and sends an encrypted message between accounts', async () => {
    const published: Array<{ event: string; payload: any }> = [];
    const store = createMemoryStore();
    const service = createTestService({
      store,
      realtime: {
        publish(event: string, payload: unknown) {
          published.push({ event, payload });
        }
      }
    });
    const { alice, bob } = await registerPair(service);

    const conversation = await service.openDmConversation(alice.account.id, { username: 'bob_dm' });
    assert.ok(conversation.id);
    assert.equal(conversation.peer.username, 'bob_dm');

    const sent = await service.sendDmMessage(alice.account.id, conversation.id, {
      body: 'tin nhắn bí mật'
    });
    assert.equal(sent.message.body, 'tin nhắn bí mật');
    assert.equal(sent.conversation.unreadCount, 0);

    const state = await store.read();
    const raw = state.dmMessages.find((item: any) => item.id === sent.message.id);
    assert.ok(raw);
    assert.notEqual(raw.ciphertext, 'tin nhắn bí mật');
    assert.equal(
      decryptDmBody(
        { ciphertext: raw.ciphertext, iv: raw.iv, authTag: raw.authTag },
        'test-dm-secret-key'
      ),
      'tin nhắn bí mật'
    );

    const bobList = await service.listDmConversations(bob.account.id);
    assert.equal(bobList.length, 1);
    assert.equal(bobList[0].unreadCount, 1);
    assert.equal(bobList[0].lastMessagePreview, 'tin nhắn bí mật');

    const bobUnread = await service.getDmUnreadCount(bob.account.id);
    assert.equal(bobUnread.unreadCount, 1);

    const bobMessages = await service.listDmMessages(bob.account.id, conversation.id);
    assert.equal(bobMessages.messages.length, 1);
    assert.equal(bobMessages.messages[0].body, 'tin nhắn bí mật');

    await service.markDmConversationRead(bob.account.id, conversation.id);
    const afterRead = await service.getDmUnreadCount(bob.account.id);
    assert.equal(afterRead.unreadCount, 0);

    assert.equal(published.some((item) => item.event === 'dm:message'), true);
    const event = published.find((item) => item.event === 'dm:message');
    assert.ok(event);
    assert.equal(event.payload.body, undefined);
    assert.deepEqual(event.payload.participantIds.sort(), [alice.account.id, bob.account.id].sort());
  });

  it('rejects DM for missing account id (anonymous)', async () => {
    const service = createTestService();
    await assert.rejects(
      () => service.listDmConversations(''),
      (error) => isServiceError(error, 401)
    );
  });

  it('rejects messaging yourself', async () => {
    const service = createTestService();
    const { account } = await service.registerAccount({
      username: 'solo_dm',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    await assert.rejects(
      () => service.openDmConversation(account.id, { username: 'solo_dm' }),
      (error) => isServiceError(error, 400)
    );
  });

  it('opens a conversation when peer is typed with a leading @', async () => {
    const service = createTestService();
    const alice = await service.registerAccount({
      username: 'at_alice',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    await service.registerAccount({
      username: 'example',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    const conversation = await service.openDmConversation(alice.account.id, {
      username: '@example'
    });
    assert.ok(conversation.id);
    assert.equal(conversation.peer.username, 'example');
  });

  it('blocks non-participants from reading a conversation', async () => {
    const service = createTestService();
    const alice = await service.registerAccount({
      username: 'alice2',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    const bob = await service.registerAccount({
      username: 'bob2',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    const eve = await service.registerAccount({
      username: 'eve2',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    const conversation = await service.openDmConversation(alice.account.id, { username: 'bob2' });
    await service.sendDmMessage(alice.account.id, conversation.id, { body: 'private' });
    await assert.rejects(
      () => service.listDmMessages(eve.account.id, conversation.id),
      (error) => isServiceError(error, 404)
    );
  });

  it('allows privileged account roles (moderator/owner) to DM like normal accounts', async () => {
    const service = createTestService();
    const user = await service.registerAccount({
      username: 'user_dm_role',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    const owner = await service.getOrCreateAdminAccount('owner_dm_role', 'securepass12');
    const conversation = await service.openDmConversation(user.account.id, {
      username: owner.username
    });
    const sent = await service.sendDmMessage(user.account.id, conversation.id, {
      body: 'hello owner'
    });
    assert.equal(sent.message.body, 'hello owner');
    const ownerInbox = await service.listDmConversations(owner.id);
    assert.equal(ownerInbox.length, 1);
    assert.equal(ownerInbox[0].unreadCount, 1);
  });
});

describe('DM HTTP routes require account auth', () => {
  it('returns 401 without account token and succeeds with one', async () => {
    const store = createMemoryStore();
    const service = createForumService({
      store,
      ai: { moderate: async () => ({ status: 'Safe', labels: [] }) },
      now: () => new Date('2026-07-20T12:00:00Z'),
      dmEncryptionSecret: 'http-dm-secret',
      realtime: { publish() {} }
    });
    await service.registerAccount({
      username: 'http_alice',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    await service.registerAccount({
      username: 'http_bob',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    const server = createHttpServer({
      service,
      realtime: { publish() {} },
      jwtSecret: 'secret-for-dm-http-tests',
      adminUsername: 'admin',
      adminPassword: 'pass'
    } as Parameters<typeof createHttpServer>[0]);
    server.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const anonymous = await fetch(`${baseUrl}/api/dm/conversations`);
      assert.equal(anonymous.status, 401);

      // Sign a proper account token via login path.
      const loginResponse = await fetch(`${baseUrl}/api/account/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'http_alice',
          password: 'securepass12',
          captchaToken: 'dev-pass'
        })
      });
      assert.equal(loginResponse.status, 200);
      const loginBody = await loginResponse.json();
      assert.ok(loginBody.data?.token);

      const list = await fetch(`${baseUrl}/api/dm/conversations`, {
        headers: { authorization: `Bearer ${loginBody.data.token}` }
      });
      assert.equal(list.status, 200);
      const listBody = await list.json();
      assert.ok(Array.isArray(listBody.data?.conversations));

      const open = await fetch(`${baseUrl}/api/dm/conversations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${loginBody.data.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ username: 'http_bob' })
      });
      assert.equal(open.status, 200);
      const openBody = await open.json();
      assert.ok(openBody.data?.conversation?.id);

      const send = await fetch(
        `${baseUrl}/api/dm/conversations/${openBody.data.conversation.id}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${loginBody.data.token}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ body: 'hello over http' })
        }
      );
      assert.equal(send.status, 200);
      const sendBody = await send.json();
      assert.equal(sendBody.data.message.body, 'hello over http');
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
