import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createForumService } from '../src/core/forum-service.ts';
import { createMemoryStore } from '../src/core/forum-store.ts';
import { decryptDmBody } from '../src/core/dm-crypto.ts';
import { assertDmBodyMediaTokens, dmPreviewFromBody } from '../src/core/dm.ts';
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

function createCapturingEmailClient() {
  const messages: Array<{ to: string; subject: string; text: string; html?: string }> = [];
  return {
    type: 'test',
    configured: true,
    messages,
    async send(message) {
      messages.push(message);
      return { id: `email-${messages.length}` };
    }
  };
}

function latestEmailCode(emailClient: ReturnType<typeof createCapturingEmailClient>) {
  const message = emailClient.messages.at(-1);
  assert.ok(message);
  const match = message.subject.match(/(\d{6})$/);
  assert.ok(match);
  return match[1];
}

async function registerVerifiedDmAccount(
  service: ReturnType<typeof createTestService>,
  emailClient: ReturnType<typeof createCapturingEmailClient>,
  username: string
) {
  const result = await service.registerAccount({
    username,
    email: `${username}@example.com`,
    password: 'securepass12',
    captchaToken: 'dev-pass'
  });
  await service.verifyAccountEmail(result.account.id, latestEmailCode(emailClient));
  return result.account;
}

describe('DM encryption helpers', () => {
  it('round-trips ciphertext with AES-256-GCM', async () => {
    const { encryptDmBody, decryptDmBody: decrypt } = await import('../src/core/dm-crypto.ts');
    const payload = encryptDmBody('xin chào 36chan', 'unit-secret');
    assert.notEqual(payload.ciphertext, 'xin chào 36chan');
    assert.equal(decrypt(payload, 'unit-secret'), 'xin chào 36chan');
  });
});

describe('DM media preview and token validation', () => {
  it('summarizes sticker-only and gif-only bodies for list previews', () => {
    assert.equal(dmPreviewFromBody('[sticker:pepe-vang-vau-01]'), 'Sticker');
    assert.equal(dmPreviewFromBody('[sticker:a] [sticker:b]'), '2 sticker');
    assert.equal(dmPreviewFromBody('[gif:klipy:hello-world]'), 'GIF');
    assert.equal(dmPreviewFromBody('[gif:klipy:a] [gif:klipy:b]'), '2 GIF');
    assert.equal(dmPreviewFromBody('hi [sticker:pepe-1]'), 'hi [Sticker]');
    assert.equal(dmPreviewFromBody('xem [gif:klipy:cat] nha'), 'xem [GIF] nha');
  });

  it('rejects malformed GIF tokens and allows sticker tokens', () => {
    assert.doesNotThrow(() => assertDmBodyMediaTokens('[sticker:custom-abc12345] hello'));
    assert.doesNotThrow(() => assertDmBodyMediaTokens('[gif:klipy:valid-slug_01]'));
    assert.throws(
      () => assertDmBodyMediaTokens('[gif:klipy:bad slug with spaces]'),
      (error) => isServiceError(error, 400)
    );
  });
});

describe('Direct messages (account only)', () => {
  it('emails opted-in verified recipients without exposing encrypted DM content', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({
      emailClient,
      appBaseUrl: 'https://example.com'
    });
    const alice = await registerVerifiedDmAccount(service, emailClient, 'alice.mail');
    const bob = await registerVerifiedDmAccount(service, emailClient, 'bob.mail');
    await service.updateAccountSettings(bob.id, {
      notificationPreferences: {
        email: true,
        emailDirectMessages: true
      }
    });
    const conversation = await service.openDmConversation(alice.id, {
      username: bob.username
    });
    emailClient.messages.length = 0;

    const sent = await service.sendDmMessage(alice.id, conversation.id, {
      body: 'noi dung DM tuyet doi khong duoc gui qua email'
    });
    await service.flushEmailQueue();
    assert.ok(sent.message.id);
    assert.strictEqual(emailClient.messages.length, 1);
    assert.strictEqual(emailClient.messages[0].to, 'bob.mail@example.com');
    assert.match(emailClient.messages[0].subject, /Tin nhắn mới từ @alice\.mail/);
    assert.match(emailClient.messages[0].text, /#messages\//);
    assert.doesNotMatch(
      JSON.stringify(emailClient.messages[0]),
      /noi dung DM tuyet doi khong duoc gui qua email/
    );

    emailClient.messages.length = 0;
    await service.setDmConversationMuted(bob.id, conversation.id, { muted: true });
    await service.sendDmMessage(alice.id, conversation.id, { body: 'muted message' });
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);

    await service.setDmConversationMuted(bob.id, conversation.id, { muted: false });
    await service.updateAccountSettings(bob.id, {
      notificationPreferences: {
        email: true,
        emailDirectMessages: false
      }
    });
    await service.sendDmMessage(alice.id, conversation.id, { body: 'channel disabled' });
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);

    await service.updateAccountSettings(bob.id, {
      notificationPreferences: {
        email: false,
        emailDirectMessages: true
      }
    });
    await service.sendDmMessage(alice.id, conversation.id, { body: 'master disabled' });
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);

    const originalSend = emailClient.send;
    await service.updateAccountSettings(bob.id, {
      notificationPreferences: {
        email: true,
        emailDirectMessages: true
      }
    });
    emailClient.send = async () => {
      throw new Error('temporary provider outage');
    };
    const duringOutage = await service.sendDmMessage(alice.id, conversation.id, {
      body: 'message remains successful during email outage'
    });
    await service.flushEmailQueue();
    assert.ok(duringOutage.message.id);

    emailClient.send = originalSend;
    await service.sendDmMessage(alice.id, conversation.id, {
      body: 'email queue recovers'
    });
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 1);
  });

  it('does not email an unverified DM recipient even when the channel is requested', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({ emailClient });
    const alice = await registerVerifiedDmAccount(service, emailClient, 'alice.verified');
    const bob = await service.registerAccount({
      username: 'bob.unverified',
      email: 'bob.unverified@example.com',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    const settings = await service.updateAccountSettings(bob.account.id, {
      notificationPreferences: {
        email: true,
        emailDirectMessages: true
      }
    });
    assert.strictEqual(settings.settings.notificationPreferences.email, false);
    const conversation = await service.openDmConversation(alice.id, {
      username: bob.account.username
    });
    emailClient.messages.length = 0;

    await service.sendDmMessage(alice.id, conversation.id, {
      body: 'unverified recipient'
    });
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);
  });

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

  it('encrypts sticker and gif token bodies and previews them as media labels', async () => {
    const store = createMemoryStore();
    const service = createTestService({ store });
    const { alice, bob } = await registerPair(service);
    const conversation = await service.openDmConversation(alice.account.id, { username: 'bob_dm' });
    const body = '[sticker:pepe-vang-vau-01] [gif:klipy:hello-cat]';
    const sent = await service.sendDmMessage(alice.account.id, conversation.id, { body });
    assert.equal(sent.message.body, body);
    assert.equal(sent.conversation.lastMessagePreview, 'Sticker · GIF');

    const state = await store.read();
    const raw = state.dmMessages.find((item: any) => item.id === sent.message.id);
    assert.ok(raw);
    assert.notEqual(raw.ciphertext, body);
    assert.equal(
      decryptDmBody(
        { ciphertext: raw.ciphertext, iv: raw.iv, authTag: raw.authTag },
        'test-dm-secret-key'
      ),
      body
    );

    const bobList = await service.listDmConversations(bob.account.id);
    assert.equal(bobList[0].lastMessagePreview, 'Sticker · GIF');
  });

  it('creates a group, invites, renames, sets roles, and kicks members', async () => {
    const service = createTestService();
    const owner = await service.registerAccount({
      username: 'group_owner',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    const alice = await service.registerAccount({
      username: 'group_alice',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    const bob = await service.registerAccount({
      username: 'group_bob',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    const carol = await service.registerAccount({
      username: 'group_carol',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });

    const group = await service.createDmGroup(owner.account.id, {
      title: 'Campus crew',
      usernames: ['group_alice', 'group_bob']
    });
    assert.equal(group.kind, 'group');
    assert.equal(group.title, 'Campus crew');
    assert.equal(group.participantCount, 3);
    assert.equal(group.myRole, 'owner');

    const sent = await service.sendDmMessage(alice.account.id, group.id, {
      body: 'hello group'
    });
    assert.equal(sent.message.body, 'hello group');
    assert.equal(sent.message.senderUsername, 'group_alice');

    const invited = await service.inviteDmGroupMembers(owner.account.id, group.id, {
      usernames: ['group_carol']
    });
    assert.equal(invited.participantCount, 4);

    const renamed = await service.updateDmGroup(owner.account.id, group.id, {
      title: 'Campus crew 2'
    });
    assert.equal(renamed.title, 'Campus crew 2');

    const promoted = await service.setDmGroupMemberRole(owner.account.id, group.id, {
      username: 'group_alice',
      role: 'admin'
    });
    const aliceRow = promoted.participants.find((item: any) => item.username === 'group_alice');
    assert.equal(aliceRow.memberRole, 'admin');

    const kicked = await service.kickDmGroupMember(owner.account.id, group.id, {
      username: 'group_bob'
    });
    assert.equal(kicked.participantCount, 3);
    assert.equal(
      kicked.participants.some((item: any) => item.username === 'group_bob'),
      false
    );

    await service.leaveDmConversation(carol.account.id, group.id);
    const afterLeave = await service.listDmConversations(carol.account.id);
    assert.equal(afterLeave.some((item: any) => item.id === group.id), false);

    await assert.rejects(
      () => service.kickDmGroupMember(alice.account.id, group.id, { username: 'group_owner' }),
      (error) => isServiceError(error, 403)
    );
  });

  it('edits and soft-deletes messages and hides conversations', async () => {
    const published: Array<{ event: string; payload: any }> = [];
    const service = createTestService({
      realtime: {
        publish(event: string, payload: unknown) {
          published.push({ event, payload });
        }
      }
    });
    const { alice, bob } = await registerPair(service);
    const conversation = await service.openDmConversation(alice.account.id, { username: 'bob_dm' });
    const sent = await service.sendDmMessage(alice.account.id, conversation.id, {
      body: 'original text'
    });
    const edited = await service.editDmMessage(alice.account.id, conversation.id, sent.message.id, {
      body: 'edited text'
    });
    assert.equal(edited.message.body, 'edited text');
    assert.ok(edited.message.editedAt);
    assert.equal(
      published.some((item) => item.event === 'dm:message-updated'),
      true
    );

    await assert.rejects(
      () => service.editDmMessage(bob.account.id, conversation.id, sent.message.id, { body: 'nope' }),
      (error) => isServiceError(error, 403)
    );

    const deleted = await service.deleteDmMessage(alice.account.id, conversation.id, sent.message.id);
    assert.equal(deleted.message.deleted, true);
    assert.equal(deleted.message.body, '');
    assert.equal(
      published.some((item) => item.event === 'dm:message-deleted'),
      true
    );

    await service.sendDmMessage(alice.account.id, conversation.id, { body: 'still here' });
    const hidden = await service.deleteDmConversation(bob.account.id, conversation.id, {
      hard: false
    });
    assert.equal(hidden.deleted, true);
    assert.equal(hidden.hard, false);
    const bobList = await service.listDmConversations(bob.account.id);
    assert.equal(bobList.some((item: any) => item.id === conversation.id), false);
    const aliceList = await service.listDmConversations(alice.account.id);
    assert.equal(aliceList.some((item: any) => item.id === conversation.id), true);

    // Reopen unhides for bob.
    await service.openDmConversation(bob.account.id, { username: 'alice_dm' });
    const bobListAfter = await service.listDmConversations(bob.account.id);
    assert.equal(bobListAfter.some((item: any) => item.id === conversation.id), true);
  });

  it('rejects direct open for self and group leave on direct chats', async () => {
    const service = createTestService();
    const { alice, bob } = await registerPair(service);
    const direct = await service.openDmConversation(alice.account.id, { username: 'bob_dm' });
    assert.equal(direct.kind || 'direct', 'direct');
    await assert.rejects(
      () => service.leaveDmConversation(alice.account.id, direct.id),
      (error) => isServiceError(error, 400)
    );
    void bob;
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

  it('supports mute, block, reply-to, reactions, search, typing, and pagination', async () => {
    const published: Array<{ event: string; payload: any }> = [];
    let clockMs = Date.parse('2026-07-20T12:00:00Z');
    const service = createTestService({
      now: () => {
        clockMs += 1000;
        return new Date(clockMs);
      },
      realtime: {
        publish(event: string, payload: unknown) {
          published.push({ event, payload });
        }
      }
    });
    const { alice, bob } = await registerPair(service);
    const conversation = await service.openDmConversation(alice.account.id, {
      username: 'bob_dm'
    });

    const muted = await service.setDmConversationMuted(alice.account.id, conversation.id, {
      muted: true
    });
    assert.equal(muted.muted, true);
    const unmuted = await service.setDmConversationMuted(alice.account.id, conversation.id, {
      muted: false
    });
    assert.equal(unmuted.muted, false);

    const blocked = await service.setDmUserBlocked(bob.account.id, {
      userId: alice.account.id,
      blocked: true
    });
    assert.equal(blocked.blocked, true);
    await assert.rejects(
      () => service.sendDmMessage(alice.account.id, conversation.id, { body: 'blocked?' }),
      (error) => isServiceError(error, 403)
    );
    await service.setDmUserBlocked(bob.account.id, {
      userId: alice.account.id,
      blocked: false
    });

    const parent = await service.sendDmMessage(alice.account.id, conversation.id, {
      body: 'parent with https://example.com/path'
    });
    assert.ok(Array.isArray(parent.message.links));
    assert.equal(parent.message.links[0]?.domain, 'example.com');

    const reply = await service.sendDmMessage(bob.account.id, conversation.id, {
      body: 'reply body',
      replyToId: parent.message.id
    });
    assert.equal(reply.message.replyToId, parent.message.id);
    assert.equal(reply.message.replyTo?.id, parent.message.id);

    const reacted = await service.reactDmMessage(
      bob.account.id,
      conversation.id,
      parent.message.id,
      { reaction: 'like' }
    );
    assert.equal(reacted.message.reactions.like, 1);
    assert.equal(reacted.message.myReaction, 'like');
    const toggled = await service.reactDmMessage(
      bob.account.id,
      conversation.id,
      parent.message.id,
      { reaction: 'like' }
    );
    assert.equal(toggled.message.reactions.like, 0);
    assert.equal(toggled.message.myReaction, null);

    await service.signalDmTyping(alice.account.id, conversation.id);
    assert.equal(
      published.some((item) => item.event === 'dm:typing'),
      true
    );

    const search = await service.searchDmMessages(alice.account.id, { q: 'parent' });
    assert.ok(search.results.some((hit: any) => hit.message?.id === parent.message.id));

    // Seed enough messages for pagination (limit 5 => hasMore after later pages).
    for (let index = 0; index < 8; index += 1) {
      await service.sendDmMessage(alice.account.id, conversation.id, {
        body: `page-seed-${index}`
      });
    }
    const page = await service.listDmMessages(alice.account.id, conversation.id, {
      limit: 5
    });
    assert.equal(page.messages.length, 5);
    assert.equal(page.hasMore, true);
    const older = await service.listDmMessages(alice.account.id, conversation.id, {
      limit: 5,
      before: page.messages[0].createdAt
    });
    assert.ok(older.messages.length >= 1);
    assert.ok(
      older.messages.every((item: any) => item.createdAt < page.messages[0].createdAt)
    );
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
      const loginBody = (await loginResponse.json()) as { data?: { token?: string } };
      assert.ok(loginBody.data?.token);
      const accountToken = String(loginBody.data?.token);

      const list = await fetch(`${baseUrl}/api/dm/conversations`, {
        headers: { authorization: `Bearer ${accountToken}` }
      });
      assert.equal(list.status, 200);
      const listBody = (await list.json()) as { data?: { conversations?: unknown } };
      assert.ok(Array.isArray(listBody.data?.conversations));

      const open = await fetch(`${baseUrl}/api/dm/conversations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accountToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ username: 'http_bob' })
      });
      assert.equal(open.status, 200);
      const openBody = (await open.json()) as {
        data?: { conversation?: { id?: string } };
      };
      assert.ok(openBody.data?.conversation?.id);
      const conversationId = String(openBody.data?.conversation?.id);

      const send = await fetch(
        `${baseUrl}/api/dm/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accountToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ body: 'hello over http' })
        }
      );
      assert.equal(send.status, 200);
      const sendBody = (await send.json()) as {
        data?: { message?: { body?: string } };
      };
      assert.equal(sendBody.data?.message?.body, 'hello over http');
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});

describe('DM realtime state integration', () => {
  it('keeps unread cache authoritative, emits read receipts, and applies per-user limits', async () => {
    const unread = new Map<string, number>();
    const rateActions: string[] = [];
    const events: Array<{ event: string; payload: any }> = [];
    let blockSend = false;
    const realtimeState = {
      async consumeUserRateLimit(_userId: string, action: string) {
        rateActions.push(action);
        return {
          allowed: !(blockSend && action === 'dm:send'),
          retryAfterMs: 2_000
        };
      },
      async getUnreadCount(userId: string) {
        return unread.get(userId) ?? null;
      },
      async setUnreadCount(userId: string, count: number) {
        unread.set(userId, count);
      },
      async invalidateUnreadCount(userId: string) {
        unread.delete(userId);
      },
      health: () => ({ failureMode: 'closed' as const })
    };
    const service = createTestService({
      realtimeState,
      realtime: {
        publish(event: string, payload: any) {
          events.push({ event, payload });
        },
        count: () => 0
      }
    });
    const { alice, bob } = await registerPair(service);
    const conversation = await service.openDmConversation(alice.account.id, {
      username: bob.account.username
    });

    await service.sendDmMessage(alice.account.id, conversation.id, { body: 'hello cache' });
    assert.equal(unread.get(alice.account.id), 0);
    assert.equal(unread.get(bob.account.id), 1);
    assert.deepEqual(await service.getDmUnreadCount(bob.account.id), { unreadCount: 1 });

    await service.markDmConversationRead(bob.account.id, conversation.id);
    assert.equal(unread.get(bob.account.id), 0);
    const receipt = events.find((item) => item.event === 'dm:read');
    assert.ok(receipt);
    assert.equal(receipt.payload.readerId, bob.account.id);
    assert.deepEqual(new Set(receipt.payload.participantIds), new Set([
      alice.account.id,
      bob.account.id
    ]));

    await service.signalDmTyping(alice.account.id, conversation.id);
    assert.ok(rateActions.includes('dm:send'));
    assert.ok(rateActions.includes('dm:read'));
    assert.ok(rateActions.includes('dm:typing'));

    blockSend = true;
    await assert.rejects(
      () => service.sendDmMessage(alice.account.id, conversation.id, { body: 'too fast' }),
      (error: unknown) => isServiceError(error, 429)
    );
  });
});
