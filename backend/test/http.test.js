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

const flaggedAi = {
  async moderate() {
    return { status: 'Flagged', labels: ['Spam'] };
  },
  async summarize() {
    return [];
  },
  async suggest() {
    return [];
  }
};

async function withServer(callback, { ai = safeAi, now = () => new Date('2026-05-22T08:00:00.000Z') } = {}) {
  const realtime = { publish() {} };
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime,
    now
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

test('http rate limits thread creation separately from comments', async () => {
  await withServer(async (baseUrl) => {
    let firstThreadId = '';
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: `Thread ${index}`,
          captchaToken: 'dev-pass'
        })
      });
      const body = await response.json();
      assert.equal(response.status, 201);
      firstThreadId ||= body.data.thread.id;
    }

    const limited = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Thread bi gioi han',
        captchaToken: 'dev-pass'
      })
    });
    assert.equal(limited.status, 429);

    const comment = await fetch(`${baseUrl}/api/threads/${firstThreadId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Comment van dung bucket rieng',
        captchaToken: 'dev-pass'
      })
    });
    assert.equal(comment.status, 201);
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

test('http api stores image metadata from thread creation payloads', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Co anh metadata',
        captchaToken: 'dev-pass',
        image: {
          name: 'anh.png',
          type: 'image/png',
          dataUrl: 'data:image/png;base64,AAAA',
          sizeBytes: 4096,
          width: 320,
          height: 240
        }
      })
    });
    const createdBody = await created.json();
    const listed = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`);
    const listedBody = await listed.json();

    assert.equal(created.status, 201);
    assert.equal(createdBody.data.thread.image.sizeBytes, 4096);
    assert.equal(createdBody.data.thread.image.width, 320);
    assert.equal(createdBody.data.thread.image.height, 240);
    assert.deepEqual(listedBody.data[0].image, createdBody.data.thread.image);
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

test('http api exposes hot boards for homepage discovery', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Board dang nong',
        captchaToken: 'dev-pass'
      })
    });
    const createdBody = await created.json();
    await fetch(`${baseUrl}/api/threads/${createdBody.data.thread.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Them mot phan hoi',
        captchaToken: 'dev-pass'
      })
    });

    const hot = await fetch(`${baseUrl}/api/boards/hot?limit=3`);
    const hotBody = await hot.json();

    assert.equal(hot.status, 200);
    assert.equal(hotBody.data[0].boardSlug, 'hoc-tap');
    assert.equal(hotBody.data[0].postCountLast24h, 2);
    assert.equal(hotBody.data[0].threadCountLast24h, 1);
    assert.equal(hotBody.data[0].replyCountLast24h, 1);
  });
});

test('http admin moderation actions include approve reasons and require JWT', async () => {
  const dates = [new Date('2026-05-22T08:00:00.000Z'), new Date('2026-05-22T08:01:00.000Z')];
  await withServer(
    async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Can admin xem lai',
          captchaToken: 'dev-pass',
          posterToken: 'browser-secret'
        })
      });
      const createdBody = await created.json();

      const unauthorized = await fetch(`${baseUrl}/api/admin/moderation-actions`);
      assert.equal(unauthorized.status, 401);

      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass' })
      });
      const loginBody = await login.json();
      await fetch(`${baseUrl}/api/admin/pending/${createdBody.data.thread.id}/approve`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${loginBody.data.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ reason: 'Da sua noi dung hop le' })
      });

      const actions = await fetch(`${baseUrl}/api/admin/moderation-actions`, {
        headers: { authorization: `Bearer ${loginBody.data.token}` }
      });
      const actionsBody = await actions.json();
      const serialized = JSON.stringify(actionsBody.data);

      assert.equal(actions.status, 200);
      assert.equal(actionsBody.data[0].action, 'admin:approve');
      assert.equal(actionsBody.data[0].reason, 'Da sua noi dung hop le');
      assert.equal(actionsBody.data[0].actor, 'admin');
      assert.equal(actionsBody.data[1].action, 'ai:moderate');
      assert.equal(serialized.includes('dev-pass'), false);
      assert.equal(serialized.includes('browser-secret'), false);
    },
    {
      ai: flaggedAi,
      now: () => dates.shift() ?? new Date('2026-05-22T08:01:00.000Z')
    }
  );
});

test('http api stores user reports and exposes them to admin only', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/tam-su/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Bai can report',
        captchaToken: 'dev-pass'
      })
    });
    const createdBody = await created.json();
    const report = await fetch(`${baseUrl}/api/posts/${createdBody.data.thread.globalNumber}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'Co thong tin rieng tu',
        posterToken: 'reporter-secret'
      })
    });
    assert.equal(report.status, 201);

    const unauthorized = await fetch(`${baseUrl}/api/admin/reports`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' })
    });
    const loginBody = await login.json();
    const reports = await fetch(`${baseUrl}/api/admin/reports`, {
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    const reportsBody = await reports.json();
    const serialized = JSON.stringify(reportsBody.data);

    assert.equal(reports.status, 200);
    assert.equal(reportsBody.data[0].reason, 'Co thong tin rieng tu');
    assert.equal(reportsBody.data[0].globalNumber, createdBody.data.thread.globalNumber);
    assert.equal(serialized.includes('reporter-secret'), false);
  });
});

test('http api exposes board archive and admin manual archive', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Can archive',
        captchaToken: 'dev-pass'
      })
    });
    const createdBody = await created.json();

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' })
    });
    const loginBody = await login.json();

    const unauthorizedArchive = await fetch(`${baseUrl}/api/admin/threads/${createdBody.data.thread.id}/archive`, {
      method: 'POST'
    });
    assert.equal(unauthorizedArchive.status, 401);

    const archivePost = await fetch(`${baseUrl}/api/admin/threads/${createdBody.data.thread.id}/archive`, {
      method: 'POST',
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    assert.equal(archivePost.status, 200);

    const active = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`);
    const activeBody = await active.json();
    const archive = await fetch(`${baseUrl}/api/boards/hoc-tap/archive`);
    const archiveBody = await archive.json();

    assert.equal(active.status, 200);
    assert.equal(archive.status, 200);
    assert.equal(activeBody.data.length, 0);
    assert.equal(archiveBody.data.length, 1);
    assert.equal(archiveBody.data[0].id, createdBody.data.thread.id);
    assert.equal(archiveBody.data[0].archivedReason, 'manual');
  });
});
