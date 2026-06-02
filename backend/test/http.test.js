import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { createForumService } from '../src/core/forum-service.js';
import { createMemoryStore } from '../src/core/forum-store.js';
import { createLocalImageStorage } from '../src/core/image-storage.js';
import { BOARDS } from '../src/core/config.js';
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
  },
  async rewrite(text) {
    return `Da sua: ${text}`;
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

async function withServer(
  callback,
  {
    ai = safeAi,
    now = () => new Date('2026-05-22T08:00:00.000Z'),
    imageStorage,
    uploadRoot = path.resolve('data/uploads-test')
  } = {}
) {
  const realtime = { publish() {} };
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime,
    now,
    imageStorage
  });
  const server = createHttpServer({
    service,
    realtime,
    jwtSecret: 'secret',
    adminUsername: 'admin',
    adminPassword: 'pass',
    uploadRoot
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

test('http api supports v1 alias, paged search, backlinks and self delete password', async () => {
  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/v1/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Alpha can tim kiem',
        captchaToken: 'dev-pass',
        deletePassword: 'owner-pass',
        options: 'noko'
      })
    });
    const firstBody = await first.json();
    assert.equal(first.status, 201);

    await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Beta khac',
        captchaToken: 'dev-pass',
        deletePassword: 'owner-pass'
      })
    });

    const searched = await fetch(`${baseUrl}/api/v1/boards/hoc-tap/threads?page=1&pageSize=1&q=alpha`);
    const searchedBody = await searched.json();
    assert.equal(searched.status, 200);
    assert.equal(searchedBody.data.items.length, 1);
    assert.equal(searchedBody.data.total, 1);
    assert.equal(searchedBody.data.items[0].globalNumber, firstBody.data.thread.globalNumber);
    assert.equal(searchedBody.data.items[0].deletePasswordHash, undefined);

    const comment = await fetch(`${baseUrl}/api/threads/${firstBody.data.thread.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: `>>${firstBody.data.thread.globalNumber}\nBacklink test`,
        captchaToken: 'dev-pass',
        deletePassword: 'comment-pass',
        options: 'sage'
      })
    });
    const commentBody = await comment.json();
    assert.equal(comment.status, 201);

    const detail = await fetch(`${baseUrl}/api/threads/${firstBody.data.thread.id}?commentsPage=1&commentsPageSize=1`);
    const detailBody = await detail.json();
    assert.equal(detail.status, 200);
    assert.equal(detailBody.data.commentPage.total, 1);
    assert.deepEqual(detailBody.data.thread.backlinks, [commentBody.data.comment.globalNumber]);

    const wrongDelete = await fetch(`${baseUrl}/api/posts/${commentBody.data.comment.globalNumber}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' })
    });
    assert.equal(wrongDelete.status, 403);

    const deleted = await fetch(`${baseUrl}/api/posts/${commentBody.data.comment.globalNumber}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'comment-pass' })
    });
    assert.equal(deleted.status, 200);

    const afterDelete = await fetch(`${baseUrl}/api/threads/${firstBody.data.thread.id}?commentsPage=1&commentsPageSize=1`);
    const afterDeleteBody = await afterDelete.json();
    assert.equal(afterDeleteBody.data.commentPage.total, 0);
  });
});

test('http api supports anonymous thread poll voting once per fingerprint', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Chon lich hoc nhom',
        pollOptions: ['Toi nay', 'Cuoi tuan'],
        captchaToken: 'dev-pass'
      })
    });
    const createdBody = await created.json();

    const vote = await fetch(`${baseUrl}/api/threads/${createdBody.data.thread.id}/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionId: '1', posterToken: 'reader-a' })
    });
    const voteBody = await vote.json();
    const duplicate = await fetch(`${baseUrl}/api/threads/${createdBody.data.thread.id}/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionId: '2', posterToken: 'reader-a' })
    });

    assert.equal(vote.status, 200);
    assert.equal(voteBody.data.totalVotes, 1);
    assert.equal(voteBody.data.options[0].votes, 1);
    assert.equal(JSON.stringify(voteBody.data).includes('fingerprint'), false);
    assert.equal(duplicate.status, 409);
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
    assert.equal(statsBody.data.publicBoardCount, BOARDS.length);
    assert.equal(statsBody.data.totalBoardCount, BOARDS.length);
    assert.equal(statsBody.data.postCountLast24h, 1);
    assert.equal(statsBody.data.postCountLastHour, 1);
    assert.equal(statsBody.data.fileCount, 0);
    assert.equal(statsBody.data.fileMegabytes, 0);
  });
});

test('http api exposes health without leaking secrets', async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/health`);
    const healthBody = await health.json();
    const serialized = JSON.stringify(healthBody.data);

    assert.equal(health.status, 200);
    assert.equal(healthBody.data.status, 'ok');
    assert.equal(healthBody.data.store.type, 'json');
    assert.equal(typeof healthBody.data.ai.configured, 'boolean');
    assert.equal(healthBody.data.security.adminConfigured, true);
    assert.equal(healthBody.data.security.hcaptchaConfigured, false);
    assert.ok(healthBody.data.security.warnings.includes('jwt_secret_default_or_missing'));
    assert.ok(healthBody.data.security.warnings.includes('hcaptcha_not_configured'));
    assert.equal(serialized.includes('GOOGLE_AI_API_KEY'), false);
    assert.equal(serialized.includes('test-key'), false);
    assert.equal(serialized.includes('"pass"'), false);
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
    assert.equal(JSON.stringify(createdBody.data).includes('authorFingerprint'), false);
    const listed = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`);
    const listedBody = await listed.json();

    assert.equal(created.status, 201);
    assert.equal(createdBody.data.thread.image.sizeBytes, 4096);
    assert.equal(createdBody.data.thread.image.width, 320);
    assert.equal(createdBody.data.thread.image.height, 240);
    assert.deepEqual(listedBody.data[0].image, createdBody.data.thread.image);
  });
});

test('http api stores uploaded images on local disk and serves them from /uploads', async () => {
  const uploadRoot = await fs.mkdtemp(path.resolve('data/uploads-test-'));
  try {
    await withServer(
      async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: 'Anh local disk',
            captchaToken: 'dev-pass',
            image: {
              name: 'anh.png',
              type: 'image/png',
              dataUrl: 'data:image/png;base64,AAAA',
              sizeBytes: 3,
              width: 1,
              height: 1,
              thumbnail: {
                name: 'anh-thumb.jpg',
                type: 'image/jpeg',
                dataUrl: 'data:image/jpeg;base64,AAA=',
                sizeBytes: 2,
                width: 1,
                height: 1
              }
            }
          })
        });
        const createdBody = await created.json();
        const image = createdBody.data.thread.image;

        assert.equal(created.status, 201);
        assert.equal(image.storage, 'local');
        assert.equal(image.dataUrl, undefined);
        assert.equal(image.url.startsWith('/uploads/'), true);
        assert.equal(image.thumbnail.dataUrl, undefined);
        assert.equal(image.thumbnail.url.startsWith('/uploads/'), true);
        assert.equal(image.thumbnail.storageKey.includes('.thumb.'), true);
        assert.equal((await fs.readFile(path.join(uploadRoot, image.storageKey))).length, 3);
        assert.equal((await fs.readFile(path.join(uploadRoot, image.thumbnail.storageKey))).length, 2);

        const imageResponse = await fetch(`${baseUrl}${image.url}`);
        assert.equal(imageResponse.status, 200);
        assert.equal(imageResponse.headers.get('content-type'), 'image/png');
        assert.equal((await imageResponse.arrayBuffer()).byteLength, 3);

        const thumbnailResponse = await fetch(`${baseUrl}${image.thumbnail.url}`);
        assert.equal(thumbnailResponse.status, 200);
        assert.equal(thumbnailResponse.headers.get('content-type'), 'image/jpeg');
        assert.equal((await thumbnailResponse.arrayBuffer()).byteLength, 2);
      },
      {
        uploadRoot,
        imageStorage: createLocalImageStorage({ root: uploadRoot })
      }
    );
  } finally {
    await fs.rm(uploadRoot, { recursive: true, force: true });
  }
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

test('http api exposes latest public posts as JSON Feed and RSS', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/an-uong/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Feed test & XML',
        captchaToken: 'dev-pass'
      })
    });
    assert.equal(created.status, 201);

    const json = await fetch(`${baseUrl}/feeds/latest.json?limit=1`);
    const jsonBody = await json.json();
    assert.equal(json.status, 200);
    assert.equal(json.headers.get('content-type')?.includes('application/json'), true);
    assert.equal(jsonBody.version, 'https://jsonfeed.org/version/1.1');
    assert.equal(jsonBody.items.length, 1);
    assert.equal(jsonBody.items[0].title.includes('/an-uong/'), true);

    const rss = await fetch(`${baseUrl}/feeds/latest.rss?limit=1`);
    const rssBody = await rss.text();
    assert.equal(rss.status, 200);
    assert.equal(rss.headers.get('content-type')?.includes('application/rss+xml'), true);
    assert.equal(rssBody.includes('<rss version="2.0">'), true);
    assert.equal(rssBody.includes('Feed test &amp; XML'), true);
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

test('http api exposes campus pulse keywords for homepage discovery', async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/api/boards/deadline-week/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Deadline đồ án và deadline lab',
        captchaToken: 'dev-pass'
      })
    });

    const pulse = await fetch(`${baseUrl}/api/pulse?limit=3`);
    const pulseBody = await pulse.json();

    assert.equal(pulse.status, 200);
    assert.equal(pulseBody.data[0].keyword, 'deadline');
    assert.equal(pulseBody.data[0].count, 1);
    assert.equal('posterHash' in pulseBody.data[0], false);
  });
});

test('http api rewrites a draft without creating a public post', async () => {
  await withServer(async (baseUrl) => {
    const rewrite = await fetch(`${baseUrl}/api/ai/rewrite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Ban A lua dao, sdt 0901234567',
        posterToken: 'reader'
      })
    });
    const rewriteBody = await rewrite.json();
    const stats = await fetch(`${baseUrl}/api/stats`);
    const statsBody = await stats.json();

    assert.equal(rewrite.status, 200);
    assert.equal(rewriteBody.data.text, 'Da sua: Ban A lua dao, sdt 0901234567');
    assert.equal(statsBody.data.totalPosts, 0);
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

test('http admin queue supports filters, detail, notes, bulk actions, and history tabs', async () => {
  await withServer(
    async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Pending hoc tap',
          captchaToken: 'dev-pass'
        })
      });
      const firstBody = await first.json();
      const second = await fetch(`${baseUrl}/api/boards/tam-su/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Pending tam su',
          captchaToken: 'dev-pass'
        })
      });
      const secondBody = await second.json();
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass' })
      });
      const loginBody = await login.json();
      const adminHeaders = {
        authorization: `Bearer ${loginBody.data.token}`,
        'content-type': 'application/json'
      };

      const filtered = await fetch(`${baseUrl}/api/admin/pending?boardSlug=hoc-tap&label=Spam`, {
        headers: { authorization: adminHeaders.authorization }
      });
      const filteredBody = await filtered.json();
      assert.equal(filtered.status, 200);
      assert.equal(filteredBody.data.length, 1);
      assert.equal(filteredBody.data[0].id, firstBody.data.thread.id);

      const detail = await fetch(`${baseUrl}/api/admin/posts/${firstBody.data.thread.globalNumber}`, {
        headers: { authorization: adminHeaders.authorization }
      });
      const detailBody = await detail.json();
      assert.equal(detail.status, 200);
      assert.equal(detailBody.data.post.body, 'Pending hoc tap');
      assert.equal(detailBody.data.actions[0].action, 'ai:moderate');

      const note = await fetch(`${baseUrl}/api/admin/posts/${firstBody.data.thread.globalNumber}/notes`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ note: 'Can xem nguon bao cao' })
      });
      const noteBody = await note.json();
      assert.equal(note.status, 201);
      assert.equal(noteBody.data.action, 'admin:note');
      assert.equal(noteBody.data.reason, 'Can xem nguon bao cao');

      const deletedBulk = await fetch(`${baseUrl}/api/admin/pending/bulk`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ action: 'delete', ids: [firstBody.data.thread.id], reason: 'Spam ro rang' })
      });
      const approvedBulk = await fetch(`${baseUrl}/api/admin/pending/bulk`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ action: 'approve', ids: [secondBody.data.thread.id], reason: 'Hop le' })
      });
      assert.equal(deletedBulk.status, 200);
      assert.equal(approvedBulk.status, 200);

      const deleted = await fetch(`${baseUrl}/api/admin/deleted?boardSlug=hoc-tap`, {
        headers: { authorization: adminHeaders.authorization }
      });
      const deletedBody = await deleted.json();
      assert.equal(deleted.status, 200);
      assert.equal(deletedBody.data.length, 1);
      assert.equal(deletedBody.data[0].deleteReason, 'Spam ro rang');

      const approved = await fetch(`${baseUrl}/api/admin/approved?boardSlug=tam-su`, {
        headers: { authorization: adminHeaders.authorization }
      });
      const approvedBody = await approved.json();
      assert.equal(approved.status, 200);
      assert.equal(approvedBody.data.length, 1);
      assert.equal(approvedBody.data[0].action, 'admin:approve');
      assert.equal(approvedBody.data[0].reason, 'Hop le');
    },
    {
      ai: flaggedAi,
      now: () => new Date('2026-05-22T08:00:00.000Z')
    }
  );
});

test('http admin sanctions temporarily block matching hashed posting fingerprint', async () => {
  await withServer(async (baseUrl) => {
    const posterToken = 'same-browser-token';
    const clientIp = '198.51.100.44';
    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': clientIp
      },
      body: JSON.stringify({
        body: 'Can cooldown user nay',
        captchaToken: 'dev-pass',
        posterToken
      })
    });
    const createdBody = await created.json();
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' })
    });
    const loginBody = await login.json();
    const adminHeaders = {
      authorization: `Bearer ${loginBody.data.token}`,
      'content-type': 'application/json'
    };

    const sanction = await fetch(`${baseUrl}/api/admin/posts/${createdBody.data.thread.globalNumber}/sanctions`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        kind: 'cooldown',
        durationMinutes: 30,
        reason: 'Spam lien tuc'
      })
    });
    const sanctionBody = await sanction.json();
    assert.equal(sanction.status, 201);
    assert.equal(sanctionBody.data.kind, 'cooldown');
    assert.equal(typeof sanctionBody.data.fingerprintPreview, 'string');
    assert.equal(JSON.stringify(sanctionBody.data).includes(clientIp), false);
    assert.equal(JSON.stringify(sanctionBody.data).includes(posterToken), false);

    const blocked = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': clientIp
      },
      body: JSON.stringify({
        body: 'Dang lai khi dang bi cooldown',
        captchaToken: 'dev-pass',
        posterToken
      })
    });
    assert.equal(blocked.status, 403);

    const sanctions = await fetch(`${baseUrl}/api/admin/sanctions?status=active`, {
      headers: { authorization: adminHeaders.authorization }
    });
    const sanctionsBody = await sanctions.json();
    assert.equal(sanctions.status, 200);
    assert.equal(sanctionsBody.data.length, 1);
    assert.equal(JSON.stringify(sanctionsBody.data).includes(clientIp), false);
    assert.equal(JSON.stringify(sanctionsBody.data).includes(posterToken), false);

    const revoked = await fetch(`${baseUrl}/api/admin/sanctions/${sanctionBody.data.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
      body: JSON.stringify({ reason: 'Da canh cao xong' })
    });
    assert.equal(revoked.status, 200);

    const allowed = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': clientIp
      },
      body: JSON.stringify({
        body: 'Duoc dang lai',
        captchaToken: 'dev-pass',
        posterToken
      })
    });
    assert.equal(allowed.status, 201);
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
