import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createForumService } from '../src/core/forum-service.ts';
import { createMemoryStore } from '../src/core/forum-store.ts';
import { createHttpServer } from '../src/server/http-app.ts';

process.env.NODE_ENV = 'test';

async function readJson(response: Response): Promise<any> {
  return response.json();
}

async function withStickerServer(callback: (baseUrl: string) => Promise<void>) {
  const service = createForumService({
    store: createMemoryStore(),
    ai: {
      async moderate() {
        return { status: 'Safe', labels: [] };
      }
    },
    realtime: { publish() {} },
    now: () => new Date('2026-07-17T08:00:00.000Z')
  });
  const server = createHttpServer({
    service,
    realtime: { publish() {} },
    jwtSecret: 'sticker-test-secret',
    adminUsername: 'admin',
    adminPassword: 'pass',
    forceConnectionClose: true
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('custom sticker HTTP API is public-read and owner-managed', async () => {
  await withStickerServer(async (baseUrl) => {
    const initial = await fetch(`${baseUrl}/api/stickers`);
    assert.equal(initial.status, 200);
    assert.deepEqual((await readJson(initial)).data, []);

    const unauthenticated = await fetch(`${baseUrl}/api/admin/stickers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://imgur.com/NoAuth1' })
    });
    assert.equal(unauthenticated.status, 401);

    const ownerLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' })
    });
    const ownerToken = (await readJson(ownerLogin)).data.token;
    const ownerHeaders = {
      authorization: `Bearer ${ownerToken}`,
      'content-type': 'application/json'
    };

    const createdResponse = await fetch(`${baseUrl}/api/admin/stickers`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ label: 'Owner sticker', url: 'https://imgur.com/Own123' })
    });
    const created = (await readJson(createdResponse)).data;
    assert.equal(createdResponse.status, 201);
    assert.equal(created.url, 'https://i.imgur.com/Own123.png');

    const publicAfterCreate = await fetch(`${baseUrl}/api/stickers`);
    assert.deepEqual((await readJson(publicAfterCreate)).data, [created]);

    const moderatorResponse = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ username: 'sticker_mod', password: 'moderator-pass', role: 'moderator' })
    });
    assert.equal(moderatorResponse.status, 201);
    const moderatorLogin = await fetch(`${baseUrl}/api/account/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'sticker_mod', password: 'moderator-pass', captchaToken: 'dev-pass' })
    });
    const moderatorToken = (await readJson(moderatorLogin)).data.token;
    const moderatorCreate = await fetch(`${baseUrl}/api/admin/stickers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${moderatorToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ url: 'https://imgur.com/Mod123' })
    });
    assert.equal(moderatorCreate.status, 403);

    const hiddenResponse = await fetch(`${baseUrl}/api/admin/stickers/${encodeURIComponent(created.key)}`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ active: false })
    });
    const hidden = (await readJson(hiddenResponse)).data;
    assert.equal(hiddenResponse.status, 200);
    assert.equal(hidden.active, false);

    const publicAfterHide = await fetch(`${baseUrl}/api/stickers`);
    assert.deepEqual((await readJson(publicAfterHide)).data, [hidden]);
  });
});
