import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import { createForumService } from '../src/core/forum-service.js';
import { createMemoryStore } from '../src/core/forum-store.js';
import { createHttpServer } from '../src/server/http-app.js';

const safeAi = {
  async moderate() {
    return { status: 'Safe', labels: [] };
  },
  async summarize() {
    return ['Tom tat 1', 'Tom tat 2', 'Tom tat 3'];
  },
  async suggest() {
    return ['Goi y 1', 'Goi y 2'];
  }
};

async function withServer(callback) {
  const realtime = { publish() {} };
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });
  const server = createHttpServer({
    service,
    realtime,
    jwtSecret: 'secret',
    adminUsername: 'admin',
    adminPassword: 'pass'
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('http api creates public thread and protects admin pending queue', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Xin tips qua mon',
        captchaToken: 'dev-pass'
      })
    });
    assert.equal(created.status, 201);

    const listed = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`);
    const listedBody = await listed.json();
    assert.equal(listedBody.data.length, 1);

    const unauthorized = await fetch(`${baseUrl}/api/admin/pending`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' })
    });
    const loginBody = await login.json();
    assert.equal(login.status, 200);
    assert.equal(typeof loginBody.data.token, 'string');
  });
});

test('http api exposes homepage stats aggregated from public content', async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/api/boards/confession/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Confession dau tien',
        captchaToken: 'dev-pass'
      })
    });

    const stats = await fetch(`${baseUrl}/api/stats`);
    const statsBody = await stats.json();

    assert.equal(stats.status, 200);
    assert.equal(statsBody.data.totalThreads, 1);
    assert.equal(statsBody.data.totalPosts, 1);
    assert.equal(statsBody.data.activeBoards, 1);
    assert.equal(statsBody.data.publicBoardCount, 12);
    assert.equal(statsBody.data.totalBoardCount, 12);
    assert.equal(statsBody.data.postCountLast24h, 1);
    assert.equal(statsBody.data.postCountLastHour, 1);
    assert.equal(statsBody.data.fileCount, 0);
    assert.equal(statsBody.data.fileMegabytes, 0);
  });
});

test('http api exposes latest public posts for homepage', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/an-uong/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Quan com moi',
        captchaToken: 'dev-pass'
      })
    });
    const createdBody = await created.json();
    await fetch(`${baseUrl}/api/threads/${createdBody.data.thread.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Da an thu',
        captchaToken: 'dev-pass'
      })
    });

    const latest = await fetch(`${baseUrl}/api/posts/latest?limit=2`);
    const latestBody = await latest.json();

    assert.equal(latest.status, 200);
    assert.equal(latestBody.data.length, 2);
    assert.equal(latestBody.data[0].type, 'comment');
    assert.equal(latestBody.data[0].globalNumber, 2);
    assert.equal(latestBody.data[0].threadId, createdBody.data.thread.id);
    assert.equal(latestBody.data[1].type, 'thread');
    assert.equal(latestBody.data[1].boardSlug, 'an-uong');
  });
});
