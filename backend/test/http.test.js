import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs/promises';
import https from 'node:https';
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
  async summarizeReports() {
    return 'Tom tat bao cao AI';
  },
  async suggest() {
    return ['Goi y 1', 'Goi y 2'];
  },
  async rewrite(text) {
    return `Da sua: ${text}`;
  },
  async translate(text, targetLang = 'vi') {
    return `Da dich [${targetLang}]: ${text}`;
  },
  async transcribe() {
    return 'Loi thoai da go bang';
  },
  async caption(_media, mode = 'describe') {
    return `Mo ta [${mode}]`;
  },
  async speak() {
    return { data: Buffer.from('audio').toString('base64'), mimeType: 'audio/mpeg' };
  }
};

const flaggedAi = {
  async moderate() {
    return { status: 'Flagged', labels: ['Spam'] };
  },
  async summarize() {
    return [];
  },
  async summarizeReports() {
    return '';
  },
  async suggest() {
    return [];
  }
};

async function withServer(
  callback,
  {
    ai = safeAi,
    store = createMemoryStore(),
    now = () => new Date('2026-05-22T08:00:00.000Z'),
    imageStorage,
    uploadRoot = path.resolve('data/uploads-test'),
    staticRoot,
    jwtSecret = 'secret',
    realtime = { publish() {} },
    rateLimitStore,
    rateLimitFailureMode,
    rateLimitLogger,
    forceConnectionClose
  } = {}
) {
  const service = createForumService({
    store,
    ai,
    realtime,
    now,
    imageStorage
  });
  const server = createHttpServer({
    service,
    realtime,
    jwtSecret,
    adminUsername: 'admin',
    adminPassword: 'pass',
    staticRoot,
    uploadRoot,
    rateLimitStore,
    rateLimitFailureMode,
    rateLimitLogger,
    forceConnectionClose
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

function createCountingRateLimitStore({ fail = false } = {}) {
  const counts = new Map();
  const calls = [];
  return {
    calls,
    async increment(key, { windowMs, now }) {
      calls.push(key);
      if (fail) {
        throw new Error('shared limiter unavailable');
      }
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { count, resetAt: now + windowMs };
    }
  };
}

async function withEnv(overrides, callback) {
  const original = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withFakeHcaptcha(responses, callback) {
  const queue = [...responses];
  const calls = [];
  const originalRequest = https.request;

  https.request = (options, onResponse) => {
    const request = new EventEmitter();
    let body = '';
    request.write = (chunk) => {
      body += chunk;
    };
    request.setTimeout = () => request;
    request.destroy = () => {};
    request.end = () => {
      calls.push({ options, body });
      const response = new EventEmitter();
      const payload = queue.length > 0 ? queue.shift() : { success: false };
      process.nextTick(() => {
        onResponse(response);
        response.emit('data', JSON.stringify(payload));
        response.emit('end');
      });
    };
    return request;
  };

  try {
    return await callback(calls);
  } finally {
    https.request = originalRequest;
  }
}

test('http server can force non-SSE responses to close the connection', async () => {
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/config`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(response.headers.get('connection'), 'close');
      assert.equal(typeof body.data.maxImageBytes, 'number');
    },
    { forceConnectionClose: true }
  );
});

test('http api creates public thread and protects admin pending queue', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Xin tips qua mon\n#dice 1d6',
        captchaToken: 'dev-pass'
      })
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201);
    assert.equal(createdBody.data.thread.diceRolls.length, 1);
    assert.equal(createdBody.data.thread.diceRolls[0].expression, '1d6');
    assert.equal(createdBody.data.thread.diceRolls[0].rolls.length, 1);
    assert.equal(createdBody.data.thread.diceRolls[0].rolls[0] >= 1, true);
    assert.equal(createdBody.data.thread.diceRolls[0].rolls[0] <= 6, true);

    const listed = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`);
    const listedBody = await listed.json();
    assert.equal(listedBody.data.length, 1);
    assert.equal(listedBody.data[0].displayName, 'Anonymous');
    assert.deepEqual(listedBody.data[0].diceRolls, createdBody.data.thread.diceRolls);

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

test('http hCaptcha enabled rejects missing captcha token for thread and comment creation', async () => {
  await withEnv({ HCAPTCHA_SECRET: 'hcaptcha-test-secret', NODE_ENV: 'test' }, async () => {
    await withFakeHcaptcha([{ success: true }], async (captchaCalls) => {
      await withServer(async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: 'Thread hop le de kiem captcha thieu',
            captchaToken: 'valid-hcaptcha-token'
          })
        });
        const createdBody = await created.json();
        assert.equal(created.status, 201);

        const missingThreadCaptcha = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: 'Khong co captcha' })
        });
        const missingThreadBody = await missingThreadCaptcha.json();

        const missingCommentCaptcha = await fetch(`${baseUrl}/api/threads/${createdBody.data.thread.id}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: 'Binh luan khong co captcha' })
        });
        const missingCommentBody = await missingCommentCaptcha.json();

        assert.equal(missingThreadCaptcha.status, 403);
        assert.equal(missingThreadBody.error.message, 'Xác minh hCaptcha thất bại');
        assert.equal(missingCommentCaptcha.status, 403);
        assert.equal(missingCommentBody.error.message, 'Xác minh hCaptcha thất bại');
        assert.equal(captchaCalls.length, 1);
      });
    });
  });
});

test('http hCaptcha enabled normalizes invalid captcha failures without real network calls', async () => {
  await withEnv({ HCAPTCHA_SECRET: 'hcaptcha-test-secret', NODE_ENV: 'test' }, async () => {
    await withFakeHcaptcha(
      [
        { success: false, 'error-codes': ['invalid-input-response'] },
        { success: true },
        { success: false, 'error-codes': ['invalid-or-already-seen-response'] }
      ],
      async (captchaCalls) => {
        await withServer(async (baseUrl) => {
          const invalidThread = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              body: 'Captcha sai tren thread',
              captchaToken: 'invalid-thread-token'
            })
          });
          const invalidThreadBody = await invalidThread.json();

          const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              body: 'Thread hop le de kiem comment',
              captchaToken: 'valid-comment-setup-token'
            })
          });
          const createdBody = await created.json();

          const invalidComment = await fetch(`${baseUrl}/api/threads/${createdBody.data.thread.id}/comments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              body: 'Captcha sai tren comment',
              captchaToken: 'invalid-comment-token'
            })
          });
          const invalidCommentBody = await invalidComment.json();

          assert.equal(invalidThread.status, 403);
          assert.equal(invalidThreadBody.error.message, 'Xác minh hCaptcha thất bại');
          assert.equal(created.status, 201);
          assert.equal(invalidComment.status, 403);
          assert.equal(invalidCommentBody.error.message, 'Xác minh hCaptcha thất bại');
          assert.equal(captchaCalls.length, 3);
          assert.equal(captchaCalls.every((call) => call.options.hostname === 'api.hcaptcha.com'), true);
          assert.equal(captchaCalls[0].body.includes('response=invalid-thread-token'), true);
          assert.equal(captchaCalls[2].body.includes('response=invalid-comment-token'), true);
        });
      }
    );
  });
});

test('http dev-pass captcha bypass works in test mode and is rejected in production', async () => {
  await withEnv({ HCAPTCHA_SECRET: undefined, NODE_ENV: 'test' }, async () => {
    await withServer(async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Dev pass duoc dung trong test',
          captchaToken: 'dev-pass'
        })
      });
      const createdBody = await created.json();
      assert.equal(created.status, 201);

      await withEnv({ HCAPTCHA_SECRET: undefined, NODE_ENV: 'production' }, async () => {
        const productionThread = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: 'Dev pass bi chan trong production',
            captchaToken: 'dev-pass'
          })
        });
        const productionThreadBody = await productionThread.json();

        const productionComment = await fetch(`${baseUrl}/api/threads/${createdBody.data.thread.id}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: 'Comment dev pass bi chan trong production',
            captchaToken: 'dev-pass'
          })
        });
        const productionCommentBody = await productionComment.json();

        assert.equal(productionThread.status, 403);
        assert.equal(productionThreadBody.error.message, 'Xác minh hCaptcha thất bại');
        assert.equal(productionComment.status, 403);
        assert.equal(productionCommentBody.error.message, 'Xác minh hCaptcha thất bại');
      });
    });
  });
});

test('http admin roles gate privileged user and moderation permissions', async () => {
  await withServer(
    async (baseUrl) => {
      const ownerLogin = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass' })
      });
      const ownerLoginBody = await ownerLogin.json();
      const ownerHeaders = {
        authorization: `Bearer ${ownerLoginBody.data.token}`,
        'content-type': 'application/json'
      };

      const moderator = await fetch(`${baseUrl}/api/admin/users`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ username: 'queue_mod', password: 'moderator-pass', role: 'moderator' })
      });
      const moderatorBody = await moderator.json();
      const viewer = await fetch(`${baseUrl}/api/admin/users`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ username: 'queue_view', password: 'viewer-pass-1', role: 'viewer' })
      });
      const viewerBody = await viewer.json();
      const users = await fetch(`${baseUrl}/api/admin/users`, {
        headers: { authorization: ownerHeaders.authorization }
      });
      const usersBody = await users.json();
      const serializedUsers = JSON.stringify(usersBody.data);

      assert.equal(moderator.status, 201);
      assert.equal(moderatorBody.data.role, 'moderator');
      assert.equal(viewer.status, 201);
      assert.equal(viewerBody.data.role, 'viewer');
      assert.equal(users.status, 200);
      assert.equal(usersBody.data.some((user) => user.username === 'queue_mod'), true);
      assert.equal(serializedUsers.includes('passwordHash'), false);
      assert.equal(serializedUsers.includes('privateData'), false);
      assert.equal(serializedUsers.includes('passkeys'), false);

      const pendingPost = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Pending role test', captchaToken: 'dev-pass' })
      });
      const pendingPostBody = await pendingPost.json();

      const moderatorLogin = await fetch(`${baseUrl}/api/account/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'queue_mod', password: 'moderator-pass', captchaToken: 'dev-pass' })
      });
      const moderatorLoginBody = await moderatorLogin.json();
      const moderatorHeaders = {
        authorization: `Bearer ${moderatorLoginBody.data.token}`,
        'content-type': 'application/json'
      };
      const viewerLogin = await fetch(`${baseUrl}/api/account/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'queue_view', password: 'viewer-pass-1', captchaToken: 'dev-pass' })
      });
      const viewerLoginBody = await viewerLogin.json();
      const viewerHeaders = {
        authorization: `Bearer ${viewerLoginBody.data.token}`,
        'content-type': 'application/json'
      };

      const moderatorPending = await fetch(`${baseUrl}/api/admin/pending`, {
        headers: { authorization: moderatorHeaders.authorization }
      });
      const moderatorUsers = await fetch(`${baseUrl}/api/admin/users`, {
        headers: { authorization: moderatorHeaders.authorization }
      });
      const moderatorBoardCreate = await fetch(`${baseUrl}/api/admin/boards`, {
        method: 'POST',
        headers: moderatorHeaders,
        body: JSON.stringify({
          slug: 'mod-board',
          name: 'Mod Board',
          category: 'Test',
          description: 'Moderator should not create boards'
        })
      });
      const viewerPending = await fetch(`${baseUrl}/api/admin/pending`, {
        headers: { authorization: viewerHeaders.authorization }
      });
      const viewerApprove = await fetch(`${baseUrl}/api/admin/pending/${pendingPostBody.data.thread.id}/approve`, {
        method: 'POST',
        headers: viewerHeaders,
        body: JSON.stringify({ reason: 'Viewer cannot approve' })
      });

      assert.equal(moderatorPending.status, 200);
      assert.equal(moderatorUsers.status, 403);
      assert.equal(moderatorBoardCreate.status, 403);
      assert.equal(viewerPending.status, 200);
      assert.equal(viewerApprove.status, 403);
    },
    { ai: flaggedAi }
  );
});

test('http admin role demotion and disable affect existing tokens', async () => {
  await withServer(
    async (baseUrl) => {
      const ownerLogin = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass' })
      });
      const ownerLoginBody = await ownerLogin.json();
      const ownerHeaders = {
        authorization: `Bearer ${ownerLoginBody.data.token}`,
        'content-type': 'application/json'
      };
      const created = await fetch(`${baseUrl}/api/admin/users`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ username: 'demote_mod', password: 'moderator-pass', role: 'moderator' })
      });
      const createdBody = await created.json();

      const moderatorLogin = await fetch(`${baseUrl}/api/account/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'demote_mod', password: 'moderator-pass', captchaToken: 'dev-pass' })
      });
      const moderatorLoginBody = await moderatorLogin.json();
      const moderatorHeaders = {
        authorization: `Bearer ${moderatorLoginBody.data.token}`,
        'content-type': 'application/json'
      };

      const beforeDemotion = await fetch(`${baseUrl}/api/admin/board-digest`, {
        method: 'POST',
        headers: moderatorHeaders
      });
      const demoted = await fetch(`${baseUrl}/api/admin/users/${createdBody.data.id}`, {
        method: 'PUT',
        headers: ownerHeaders,
        body: JSON.stringify({ role: 'viewer' })
      });
      const afterDemotionWrite = await fetch(`${baseUrl}/api/admin/board-digest`, {
        method: 'POST',
        headers: moderatorHeaders
      });
      const afterDemotionRead = await fetch(`${baseUrl}/api/admin/pending`, {
        headers: { authorization: moderatorHeaders.authorization }
      });
      const disabled = await fetch(`${baseUrl}/api/admin/users/${createdBody.data.id}`, {
        method: 'DELETE',
        headers: ownerHeaders
      });
      const afterDisableRead = await fetch(`${baseUrl}/api/admin/pending`, {
        headers: { authorization: moderatorHeaders.authorization }
      });
      const disabledLogin = await fetch(`${baseUrl}/api/account/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'demote_mod', password: 'moderator-pass', captchaToken: 'dev-pass' })
      });

      assert.equal(created.status, 201);
      assert.equal(beforeDemotion.status, 200);
      assert.equal(demoted.status, 200);
      assert.equal(afterDemotionWrite.status, 403);
      assert.equal(afterDemotionRead.status, 200);
      assert.equal(disabled.status, 200);
      assert.equal(afterDisableRead.status, 403);
      assert.equal(disabledLogin.status, 403);
    },
    { ai: flaggedAi }
  );
});

test('http static serving treats missing assets as 404 without 500 logging', async () => {
  const staticRoot = path.resolve('backend/test/tmp-static');
  const originalError = console.error;
  const originalWarn = console.warn;
  const logs = [];
  const warnings = [];
  console.error = (...args) => {
    logs.push(args);
  };
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    await fs.rm(staticRoot, { recursive: true, force: true });
    await fs.mkdir(staticRoot, { recursive: true });
    await fs.writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><title>36chan</title>');

    await withServer(
      async (baseUrl) => {
        const favicon = await fetch(`${baseUrl}/favicon.ico`);
        const gitConfig = await fetch(`${baseUrl}/.git/config`);
        const malformedStatic = await fetch(`${baseUrl}/%E0%A4%A`);
        const malformedUpload = await fetch(`${baseUrl}/uploads/%E0%A4%A`);
        const appRoute = await fetch(`${baseUrl}/admin/moderation`);
        const appRouteBody = await appRoute.text();

        assert.equal(favicon.status, 404);
        assert.equal(gitConfig.status, 404);
        assert.equal(malformedStatic.status, 404);
        assert.equal(malformedUpload.status, 404);
        assert.equal(appRoute.status, 200);
        assert.equal(appRouteBody.includes('<title>36chan</title>'), true);
      },
      { staticRoot }
    );

    assert.equal(logs.length, 0);
    assert.equal(warnings.length, 4);
    assert.equal(
      warnings.every((args) => String(args[0]).includes('API REQUEST FAILED:') && args[1]?.statusCode === 404),
      true
    );
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    await fs.rm(staticRoot, { recursive: true, force: true });
  }
});

test('http capcode is granted to admins but denied to regular and anonymous posters', async () => {
  await withServer(async (baseUrl) => {
    // Anonymous poster requesting a capcode gets none.
    const anon = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Anon doi capcode', captchaToken: 'dev-pass', capcode: true })
    });
    const anonBody = await anon.json();
    assert.equal(anon.status, 201);
    assert.equal(anonBody.data.thread.capcode, null);

    // Regular account requesting a capcode still gets none.
    const registered = await fetch(`${baseUrl}/api/account/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'sinhvien_cap', password: 'long-enough-pass', captchaToken: 'dev-pass' })
    });
    const registeredBody = await registered.json();
    const userThread = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${registeredBody.data.token}`
      },
      body: JSON.stringify({ body: 'User doi capcode', captchaToken: 'dev-pass', capcode: true })
    });
    const userThreadBody = await userThread.json();
    assert.equal(userThread.status, 201);
    assert.equal(userThreadBody.data.thread.capcode, null);

    // Verified admin gets the capcode stamped.
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' })
    });
    const loginBody = await login.json();
    const adminThread = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.data.token}`
      },
      body: JSON.stringify({ body: 'Thong bao chinh thuc', captchaToken: 'dev-pass', capcode: true })
    });
    const adminThreadBody = await adminThread.json();
    assert.equal(adminThread.status, 201);
    assert.equal(adminThreadBody.data.thread.capcode, 'admin');
  });
});

test('http admin boards support dynamic create update and public filtering', async () => {
  await withServer(async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' })
    });
    const loginBody = await login.json();
    const headers = {
      authorization: `Bearer ${loginBody.data.token}`,
      'content-type': 'application/json'
    };

    const created = await fetch(`${baseUrl}/api/admin/boards`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'lab-news',
        name: 'Tin lab',
        category: 'Truong hoc',
        description: 'Thong bao phong lab',
        isHidden: true,
        retentionPolicy: {
          maxActiveThreadsPerBoard: 25,
          bumpLimit: 50,
          replyLimit: 75,
          publicArchive: false
        }
      })
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201);
    assert.equal(createdBody.data.board.slug, 'lab-news');
    assert.equal(createdBody.data.board.isHidden, true);
    assert.equal(createdBody.data.board.retentionPolicy.maxActiveThreadsPerBoard, 25);
    assert.equal(createdBody.data.board.retentionPolicy.bumpLimit, 50);
    assert.equal(createdBody.data.board.retentionPolicy.replyLimit, 75);
    assert.equal(createdBody.data.board.retentionPolicy.publicArchive, false);

    const publicBoardsBefore = await fetch(`${baseUrl}/api/boards`);
    const publicBoardsBeforeBody = await publicBoardsBefore.json();
    assert.equal(publicBoardsBeforeBody.data.some((board) => board.slug === 'lab-news'), false);

    const adminBoards = await fetch(`${baseUrl}/api/admin/boards`, {
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    const adminBoardsBody = await adminBoards.json();
    assert.equal(adminBoards.status, 200);
    assert.equal(adminBoardsBody.data.some((board) => board.slug === 'lab-news' && board.isHidden), true);
    assert.equal(
      adminBoardsBody.data.find((board) => board.slug === 'lab-news')?.retentionPolicy.publicArchive,
      false
    );

    const shown = await fetch(`${baseUrl}/api/admin/boards/lab-news`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        isHidden: false,
        retentionPolicy: {
          maxActiveThreadsPerBoard: 30,
          publicArchive: true
        }
      })
    });
    const shownBody = await shown.json();
    assert.equal(shown.status, 200);
    assert.equal(shownBody.data.board.retentionPolicy.maxActiveThreadsPerBoard, 30);
    assert.equal(shownBody.data.board.retentionPolicy.publicArchive, true);

    const publicBoardsAfter = await fetch(`${baseUrl}/api/boards`);
    const publicBoardsAfterBody = await publicBoardsAfter.json();
    assert.equal(publicBoardsAfterBody.data.some((board) => board.slug === 'lab-news'), true);

    const archived = await fetch(`${baseUrl}/api/admin/boards/lab-news`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ isArchived: true })
    });
    assert.equal(archived.status, 200);

    const publicBoardsArchived = await fetch(`${baseUrl}/api/boards`);
    const publicBoardsArchivedBody = await publicBoardsArchived.json();
    assert.equal(publicBoardsArchivedBody.data.some((board) => board.slug === 'lab-news'), false);

    const deletedEmpty = await fetch(`${baseUrl}/api/admin/boards/lab-news`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    assert.equal(deletedEmpty.status, 200);

    const adminBoardsAfterDelete = await fetch(`${baseUrl}/api/admin/boards`, {
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    const adminBoardsAfterDeleteBody = await adminBoardsAfterDelete.json();
    assert.equal(adminBoardsAfterDeleteBody.data.some((board) => board.slug === 'lab-news'), false);

    await fetch(`${baseUrl}/api/admin/boards`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'busy-board',
        name: 'Board co bai',
        category: 'Truong hoc',
        description: 'Board dung de test xoa khi co noi dung'
      })
    });
    const busyThread = await fetch(`${baseUrl}/api/boards/busy-board/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Thread cong khai tren board khong duoc hard delete',
        captchaToken: 'dev-pass'
      })
    });
    assert.equal(busyThread.status, 201);

    const blockedDelete = await fetch(`${baseUrl}/api/admin/boards/busy-board`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    assert.equal(blockedDelete.status, 409);

    const invalid = await fetch(`${baseUrl}/api/admin/boards`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: '../bad',
        name: 'Bad',
        category: 'Bad',
        description: 'Bad'
      })
    });
    assert.equal(invalid.status, 400);
  });
});

test('http admin board management APIs require admin JWT', async () => {
  await withServer(async (baseUrl) => {
    const unauthorizedList = await fetch(`${baseUrl}/api/admin/boards`);
    const unauthorizedCreate = await fetch(`${baseUrl}/api/admin/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'no-token-board',
        name: 'No token',
        category: 'Test',
        description: 'Should require admin auth'
      })
    });
    const unauthorizedUpdate = await fetch(`${baseUrl}/api/admin/boards/hoc-tap`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isHidden: true })
    });
    const unauthorizedDelete = await fetch(`${baseUrl}/api/admin/boards/hoc-tap`, {
      method: 'DELETE'
    });

    assert.equal(unauthorizedList.status, 401);
    assert.equal(unauthorizedCreate.status, 401);
    assert.equal(unauthorizedUpdate.status, 401);
    assert.equal(unauthorizedDelete.status, 401);
  });
});

test('http hidden boards hide existing threads from public APIs', async () => {
  await withServer(async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' })
    });
    const loginBody = await login.json();
    const headers = {
      authorization: `Bearer ${loginBody.data.token}`,
      'content-type': 'application/json'
    };

    const createdBoard = await fetch(`${baseUrl}/api/admin/boards`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'hidden-posts',
        name: 'Hidden posts',
        category: 'Test',
        description: 'Board used to verify hidden public access'
      })
    });
    assert.equal(createdBoard.status, 201);

    const createdThread = await fetch(`${baseUrl}/api/boards/hidden-posts/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Hidden board public access regression',
        captchaToken: 'dev-pass'
      })
    });
    const createdThreadBody = await createdThread.json();
    assert.equal(createdThread.status, 201);

    const visibleThread = await fetch(`${baseUrl}/api/threads/${createdThreadBody.data.thread.id}`);
    assert.equal(visibleThread.status, 200);

    const hiddenBoard = await fetch(`${baseUrl}/api/admin/boards/hidden-posts`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ isHidden: true })
    });
    assert.equal(hiddenBoard.status, 200);

    const publicBoards = await fetch(`${baseUrl}/api/boards`);
    const publicBoardsBody = await publicBoards.json();
    const adminBoards = await fetch(`${baseUrl}/api/admin/boards`, {
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    const adminBoardsBody = await adminBoards.json();
    const hiddenBoardAdmin = adminBoardsBody.data.find((board) => board.slug === 'hidden-posts');

    const hiddenList = await fetch(`${baseUrl}/api/boards/hidden-posts/threads`);
    const hiddenCreate = await fetch(`${baseUrl}/api/boards/hidden-posts/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Cannot post to hidden board',
        captchaToken: 'dev-pass'
      })
    });
    const hiddenThread = await fetch(`${baseUrl}/api/threads/${createdThreadBody.data.thread.id}`);
    const hiddenComment = await fetch(`${baseUrl}/api/threads/${createdThreadBody.data.thread.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Cannot comment on hidden board thread',
        captchaToken: 'dev-pass'
      })
    });
    const hiddenLookup = await fetch(`${baseUrl}/api/posts/${createdThreadBody.data.thread.globalNumber}`);
    const hiddenReport = await fetch(`${baseUrl}/api/posts/${createdThreadBody.data.thread.globalNumber}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Hidden board report should not attach publicly' })
    });
    const latest = await fetch(`${baseUrl}/api/posts/latest`);
    const latestBody = await latest.json();
    const stats = await fetch(`${baseUrl}/api/stats`);
    const statsBody = await stats.json();
    const hotBoards = await fetch(`${baseUrl}/api/boards/hot`);
    const hotBoardsBody = await hotBoards.json();

    assert.equal(publicBoardsBody.data.some((board) => board.slug === 'hidden-posts'), false);
    assert.equal(adminBoards.status, 200);
    assert.equal(hiddenBoardAdmin?.isHidden, true);
    assert.equal(hiddenList.status, 404);
    assert.equal(hiddenCreate.status, 404);
    assert.equal(hiddenThread.status, 404);
    assert.equal(hiddenComment.status, 404);
    assert.equal(hiddenLookup.status, 404);
    assert.equal(hiddenReport.status, 404);
    assert.equal(latestBody.data.some((post) => post.threadId === createdThreadBody.data.thread.id), false);
    assert.equal(statsBody.data.totalThreads, 0);
    assert.equal(hotBoardsBody.data.some((board) => board.boardSlug === 'hidden-posts'), false);
  });
});

test('http board deletion refuses boards with comments or reports', async () => {
  const store = createMemoryStore({
    boards: [
      ...BOARDS,
      {
        slug: 'comment-only-board',
        path: '/comment-only-board/',
        name: 'Comment only board',
        category: 'Test',
        description: 'Has comment state only'
      },
      {
        slug: 'report-only-board',
        path: '/report-only-board/',
        name: 'Report only board',
        category: 'Test',
        description: 'Has report state only'
      }
    ],
    comments: [{ id: 'comment-only-1', boardSlug: 'comment-only-board' }],
    reports: [{ id: 'report-only-1', boardSlug: 'report-only-board' }]
  });

  await withServer(
    async (baseUrl) => {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass' })
      });
      const loginBody = await login.json();
      const headers = { authorization: `Bearer ${loginBody.data.token}` };

      const commentBoardDelete = await fetch(`${baseUrl}/api/admin/boards/comment-only-board`, {
        method: 'DELETE',
        headers
      });
      const reportBoardDelete = await fetch(`${baseUrl}/api/admin/boards/report-only-board`, {
        method: 'DELETE',
        headers
      });

      assert.equal(commentBoardDelete.status, 409);
      assert.equal(reportBoardDelete.status, 409);
    },
    { store }
  );
});

test('http admin analytics returns aggregate metrics without poster identifiers', async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Noi dung analytics co email secret@example.com',
        captchaToken: 'dev-pass',
        posterToken: 'poster-secret-token'
      })
    });

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' })
    });
    const loginBody = await login.json();
    const analytics = await fetch(`${baseUrl}/api/admin/analytics`, {
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    const analyticsBody = await analytics.json();
    const serialized = JSON.stringify(analyticsBody.data);

    assert.equal(analytics.status, 200);
    assert.equal(analyticsBody.data.boardActivity['hoc-tap'].activeThreads, 1);
    assert.equal(serialized.includes('poster-secret-token'), false);
    assert.equal(serialized.includes('authorFingerprint'), false);
    assert.equal(serialized.includes('posterHash'), false);
    assert.equal(serialized.includes('127.0.0.1'), false);
    assert.equal(serialized.includes('secret@example.com'), false);
  });
});

test('http account api registers, logs in and saves private settings', async () => {
  await withServer(async (baseUrl) => {
    const registered = await fetch(`${baseUrl}/api/account/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'SinhVien_36', password: 'long-enough-pass', captchaToken: 'dev-pass' })
    });
    const registeredBody = await registered.json();
    assert.equal(registered.status, 201);
    assert.equal(registeredBody.data.account.username, 'sinhvien_36');
    assert.equal(typeof registeredBody.data.token, 'string');
    assert.equal(registeredBody.data.account.passwordHash, undefined);

    const duplicate = await fetch(`${baseUrl}/api/account/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'sinhvien_36', password: 'long-enough-pass', captchaToken: 'dev-pass' })
    });
    assert.equal(duplicate.status, 409);

    const login = await fetch(`${baseUrl}/api/account/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'sinhvien_36', password: 'long-enough-pass', captchaToken: 'dev-pass' })
    });
    const loginBody = await login.json();
    assert.equal(login.status, 200);
    assert.equal(loginBody.data.account.username, 'sinhvien_36');

    const settings = await fetch(`${baseUrl}/api/account/settings`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${loginBody.data.token}`
      },
      body: JSON.stringify({
        settings: {
          theme: 'burichan',
          homeBoard: 'hoc-tap',
          syncDrafts: false,
          emailNotifications: true,
          displayPreferences: {
            compactThreads: true,
            hideThumbnails: false
          },
          notificationPreferences: {
            email: true,
            watchedThreads: false,
            boardSubscriptions: true,
            browserWatchedThreads: true
          },
          boardSubscriptions: ['confession', 'an-uong', 'not-a-board']
        }
      })
    });
    const settingsBody = await settings.json();
    assert.equal(settings.status, 200);
    assert.equal(settingsBody.data.settings.theme, 'burichan');
    assert.equal(settingsBody.data.settings.homeBoard, 'hoc-tap');
    assert.equal(settingsBody.data.settings.syncDrafts, false);
    assert.equal(settingsBody.data.settings.emailNotifications, true);
    assert.deepEqual(settingsBody.data.settings.displayPreferences, {
      compactThreads: true,
      hideThumbnails: false
    });
    assert.deepEqual(settingsBody.data.settings.notificationPreferences, {
      email: true,
      watchedThreads: false,
      boardSubscriptions: true,
      browserWatchedThreads: true
    });
    assert.deepEqual(settingsBody.data.settings.boardSubscriptions, ['confession', 'an-uong']);

    const me = await fetch(`${baseUrl}/api/account/me`, {
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    const meBody = await me.json();
    assert.equal(me.status, 200);
    assert.equal(meBody.data.settings.theme, 'burichan');
    assert.deepEqual(meBody.data.settings.boardSubscriptions, ['confession', 'an-uong']);

    const logout = await fetch(`${baseUrl}/api/account/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    const logoutBody = await logout.json();
    assert.equal(logout.status, 200);
    assert.equal(logoutBody.data.ok, true);

    const revokedMe = await fetch(`${baseUrl}/api/account/me`, {
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    assert.equal(revokedMe.status, 401);
  });
});

test('http account api syncs and clears private watchlist drafts and saved searches', async () => {
  await withServer(async (baseUrl) => {
    const registered = await fetch(`${baseUrl}/api/account/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'sync_user', password: 'long-enough-pass', captchaToken: 'dev-pass' })
    });
    const registeredBody = await registered.json();
    const token = registeredBody.data.token;

    const saved = await fetch(`${baseUrl}/api/account/private-data`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        watchlist: {
          'thread-1': {
            threadId: 'thread-1',
            boardSlug: 'hoc-tap',
            boardPath: '/hoc-tap/',
            globalNumber: 7,
            preview: 'Theo doi thread',
            lastSeen: 9
          }
        },
        drafts: [
          {
            key: 'draft:comment:thread-1',
            kind: 'comment',
            id: 'thread-1',
            threadId: 'thread-1',
            body: 'Noi dung draft rieng tu'
          }
        ],
        savedSearches: [
          {
            boardSlug: 'hoc-tap',
            query: 'lich thi',
            label: 'lich thi'
          }
        ]
      })
    });
    const savedBody = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(savedBody.data.watchlist[0].threadId, 'thread-1');
    assert.equal(savedBody.data.drafts[0].body, 'Noi dung draft rieng tu');
    assert.equal(savedBody.data.savedSearches[0].query, 'lich thi');

    const fetched = await fetch(`${baseUrl}/api/account/private-data`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const fetchedBody = await fetched.json();
    assert.deepEqual(fetchedBody.data, savedBody.data);

    const clearedDrafts = await fetch(`${baseUrl}/api/account/private-data?section=drafts`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    });
    const clearedDraftsBody = await clearedDrafts.json();
    assert.equal(clearedDrafts.status, 200);
    assert.equal(clearedDraftsBody.data.watchlist.length, 1);
    assert.equal(clearedDraftsBody.data.drafts.length, 0);
    assert.equal(clearedDraftsBody.data.savedSearches.length, 1);

    const clearedAll = await fetch(`${baseUrl}/api/account/private-data`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    });
    const clearedAllBody = await clearedAll.json();
    assert.deepEqual(clearedAllBody.data, { watchlist: [], drafts: [], savedSearches: [] });
  });
});

test('http ai rewrite does not receive account private data', async () => {
  const rewriteInputs = [];
  const ai = {
    async moderate() {
      return { status: 'Safe', labels: [] };
    },
    async summarize() {
      return [];
    },
    async suggest() {
      return [];
    },
    async rewrite(text) {
      rewriteInputs.push(text);
      return `Da sua: ${text}`;
    }
  };

  await withServer(
    async (baseUrl) => {
      const registered = await fetch(`${baseUrl}/api/account/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'ai_private_user', password: 'long-enough-pass', captchaToken: 'dev-pass' })
      });
      const registeredBody = await registered.json();

      await fetch(`${baseUrl}/api/account/private-data`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${registeredBody.data.token}`
        },
        body: JSON.stringify({
          watchlist: [{ threadId: 'secret-thread', preview: 'khong gui AI' }],
          drafts: [{ key: 'draft:thread:hoc-tap', body: 'draft server secret' }],
          savedSearches: [{ boardSlug: 'hoc-tap', query: 'secret search' }]
        })
      });

      const rewritten = await fetch(`${baseUrl}/api/ai/rewrite`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${registeredBody.data.token}`
        },
        body: JSON.stringify({
          body: 'Chi rewrite noi dung nay',
          posterToken: 'poster-token'
        })
      });
      const rewrittenBody = await rewritten.json();
      assert.equal(rewritten.status, 200);
      assert.equal(rewrittenBody.data.text, 'Da sua: Chi rewrite noi dung nay');
      assert.deepEqual(rewriteInputs, ['Chi rewrite noi dung nay']);
    },
    { ai }
  );
});

test('http exposes translate, transcribe, caption and speak AI routes', async () => {
  await withServer(async (baseUrl) => {
    const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const translate = await fetch(`${baseUrl}/api/ai/translate`, json({ text: 'Xin chào', targetLang: 'en' }));
    assert.equal(translate.status, 200);
    assert.deepEqual(await translate.json(), { data: { text: 'Da dich [en]: Xin chào', targetLang: 'en' } });

    const transcribe = await fetch(
      `${baseUrl}/api/ai/transcribe`,
      json({ data: Buffer.from('a').toString('base64'), mimeType: 'audio/mpeg' })
    );
    assert.equal(transcribe.status, 200);
    assert.equal((await transcribe.json()).data.text, 'Loi thoai da go bang');

    const caption = await fetch(
      `${baseUrl}/api/ai/caption`,
      json({ data: Buffer.from('a').toString('base64'), mimeType: 'image/png', mode: 'ocr' })
    );
    assert.equal(caption.status, 200);
    assert.deepEqual(await caption.json(), { data: { text: 'Mo ta [ocr]', mode: 'ocr' } });

    const speak = await fetch(`${baseUrl}/api/ai/speak`, json({ text: 'Xin chào' }));
    assert.equal(speak.status, 200);
    const speakBody = await speak.json();
    assert.equal(speakBody.data.mimeType, 'audio/mpeg');
    assert.equal(Buffer.from(speakBody.data.audio, 'base64').toString(), 'audio');
  });
});

test('http account identity is not exposed on public posts', async () => {
  await withServer(async (baseUrl) => {
    const registered = await fetch(`${baseUrl}/api/account/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'private_user', password: 'long-enough-pass', captchaToken: 'dev-pass' })
    });
    const registeredBody = await registered.json();

    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${registeredBody.data.token}`
      },
      body: JSON.stringify({
        body: 'Dang bai khi da dang nhap account',
        captchaToken: 'dev-pass'
      })
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201);
    assert.equal(createdBody.data.thread.displayName, 'Anonymous');
    assert.equal(createdBody.data.thread.username, undefined);
    assert.equal(createdBody.data.thread.accountId, undefined);
    assert.equal(JSON.stringify(createdBody.data.thread).includes('private_user'), false);

    const comment = await fetch(`${baseUrl}/api/threads/${createdBody.data.thread.id}/comments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${registeredBody.data.token}`
      },
      body: JSON.stringify({
        body: 'Tra loi khi da dang nhap account',
        captchaToken: 'dev-pass'
      })
    });
    const commentBody = await comment.json();
    assert.equal(comment.status, 201);
    assert.equal(commentBody.data.comment.accountId, undefined);

    const myPosts = await fetch(`${baseUrl}/api/account/posts`, {
      headers: { authorization: `Bearer ${registeredBody.data.token}` }
    });
    const myPostsBody = await myPosts.json();
    assert.equal(myPosts.status, 200);
    assert.equal(myPostsBody.data.length, 2);
    assert.equal(myPostsBody.data[0].type, 'comment'); // Newest first
    assert.equal(myPostsBody.data[0].post.bodyLines[0].text, 'Tra loi khi da dang nhap account');
    assert.equal(myPostsBody.data[1].type, 'thread');
    assert.equal(myPostsBody.data[1].post.bodyLines[0].text, 'Dang bai khi da dang nhap account');

    const publicPosts = await fetch(`${baseUrl}/api/threads/${createdBody.data.thread.id}`);
    const publicBody = await publicPosts.json();
    assert.equal(publicBody.data.thread.accountId, undefined);
    assert.equal(publicBody.data.comments[0].accountId, undefined);

    const logout = await fetch(`${baseUrl}/api/account/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${registeredBody.data.token}` }
    });
    assert.equal(logout.status, 200);

    const postedWithRevokedToken = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${registeredBody.data.token}`
      },
      body: JSON.stringify({
        body: 'Dang bai bang token da logout',
        captchaToken: 'dev-pass'
      })
    });
    assert.equal(postedWithRevokedToken.status, 201);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const loggedInAgain = await fetch(`${baseUrl}/api/account/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'private_user', password: 'long-enough-pass', captchaToken: 'dev-pass' })
    });
    const loggedInAgainBody = await loggedInAgain.json();
    assert.equal(loggedInAgain.status, 200);
    const myPostsAfterLogout = await fetch(`${baseUrl}/api/account/posts`, {
      headers: { authorization: `Bearer ${loggedInAgainBody.data.token}` }
    });
    const myPostsAfterLogoutBody = await myPostsAfterLogout.json();
    assert.equal(myPostsAfterLogout.status, 200);
    assert.equal(myPostsAfterLogoutBody.data.length, 2);
    assert.equal(
      myPostsAfterLogoutBody.data.some((item) => item.post.bodyLines[0].text === 'Dang bai bang token da logout'),
      false
    );
  });
});

test('http posting rejects reserved display names', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Thu dung ten hien thi reserved',
        displayName: 'Admin',
        captchaToken: 'dev-pass'
      })
    });
    const createdBody = await created.json();

    assert.equal(created.status, 400);
    assert.match(createdBody.error.message, /Tên hiển thị này không dùng được/);
  });
});

test('http account registration requires JWT configuration before mutating users', async () => {
  await withServer(
    async (baseUrl) => {
      const registered = await fetch(`${baseUrl}/api/account/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'no_jwt_user', password: 'long-enough-pass' })
      });
      const registeredBody = await registered.json();
      assert.equal(registered.status, 503);
      assert.match(registeredBody.error.message, /JWT_SECRET/);

      const health = await fetch(`${baseUrl}/api/health`);
      const healthBody = await health.json();
      assert.equal(healthBody.data.store.users, 0);
    },
    { jwtSecret: '' }
  );
});

test('http health exposes deployment readiness without secrets', async () => {
  const envKeys = [
    'AI_PROVIDER',
    'GOOGLE_AI_API_KEY',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_BASE_URL',
    'OPENAI_COMPATIBLE_MODEL',
    'HCAPTCHA_SECRET'
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.AI_PROVIDER = 'openai-compatible';
  delete process.env.GOOGLE_AI_API_KEY;
  process.env.OPENAI_COMPATIBLE_API_KEY = 'openai-secret-key';
  process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://ai-secret.example.test/v1';
  process.env.OPENAI_COMPATIBLE_MODEL = 'gpt-health-test';
  process.env.HCAPTCHA_SECRET = 'hcaptcha-secret-value';

  try {
    await withServer(async (baseUrl) => {
      const health = await fetch(`${baseUrl}/api/health`);
      const body = await health.json();
      const payload = body.data;
      const serialized = JSON.stringify(payload);

      assert.equal(health.status, 200);
      assert.equal(payload.status, 'ok');
      assert.equal(payload.store.type, 'json');
      assert.equal(payload.store.configured, true);
      assert.equal(payload.store.ready, true);
      assert.equal(payload.ai.provider, 'openai-compatible');
      assert.equal(payload.ai.configured, true);
      assert.equal(payload.ai.model, 'gpt-health-test');
      assert.equal(payload.imageStorage.type, 'inline-json');
      assert.equal(payload.imageStorage.configured, true);
      assert.equal(payload.captcha.provider, 'hcaptcha');
      assert.equal(payload.captcha.configured, true);
      assert.equal(payload.security.hcaptchaConfigured, true);
      assert.equal(serialized.includes('openai-secret-key'), false);
      assert.equal(serialized.includes('hcaptcha-secret-value'), false);
      assert.equal(serialized.includes('ai-secret.example.test'), false);
      assert.equal(serialized.includes('OPENAI_COMPATIBLE_BASE_URL'), false);
      assert.equal(serialized.includes('HCAPTCHA_SECRET'), false);
      assert.equal(serialized.includes('Authorization'), false);
      assert.equal(serialized.includes('Bearer'), false);
    });
  } finally {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('http metrics exposes scrapeable realtime counters and alert thresholds', async () => {
  const realtime = {
    publish() {},
    metrics() {
      return {
        clients: 90,
        boards: { 'hoc-tap': 50 },
        maxClients: 100,
        capacityUsedPct: 90,
        capacityStatus: 'critical',
        heartbeatMs: 25000,
        maxBackpressureEvents: 3,
        totalConnections: 120,
        rejected: 3,
        dropped: 2,
        heartbeats: 9,
        backpressureEvents: 4,
        backpressureDrops: 1,
        thresholds: { warnPct: 75, criticalPct: 90 }
      };
    },
    count() {
      return 90;
    },
    boardCounts() {
      return { 'hoc-tap': 50 };
    }
  };

  await withServer(
    async (baseUrl) => {
      const metrics = await fetch(`${baseUrl}/metrics`);
      const body = await metrics.text();

      assert.equal(metrics.status, 200);
      assert.match(metrics.headers.get('content-type'), /text\/plain/);
      assert.match(body, /chan36_health_ready 1/);
      assert.match(body, /chan36_sse_clients 90/);
      assert.match(body, /chan36_sse_capacity_alert_level 2/);
      assert.match(body, /chan36_sse_capacity_warn_percent 75/);
      assert.match(body, /chan36_sse_capacity_critical_percent 90/);
      assert.match(body, /chan36_sse_max_backpressure_events 3/);
      assert.match(body, /chan36_sse_rejected_connections_total 3/);
      assert.match(body, /chan36_sse_backpressure_events_total 4/);
      assert.match(body, /chan36_sse_backpressure_drops_total 1/);
      assert.equal(body.includes('secret'), false);

      const alias = await fetch(`${baseUrl}/api/metrics`);
      assert.equal(alias.status, 200);
      assert.match(await alias.text(), /chan36_sse_connections_total 120/);
    },
    { realtime }
  );
});

test('http api supports v1 alias, paged search, backlinks and self delete password', async () => {
  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/v1/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Alpha can tim kiem',
        displayName: '  OP <Hai>  ',
        captchaToken: 'dev-pass',
        deletePassword: 'owner-pass',
        options: 'noko'
      })
    });
    const firstBody = await first.json();
    assert.equal(first.status, 201);
    assert.equal(firstBody.data.thread.displayName, 'OP Hai');

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
        displayName: 'Ban reply',
        captchaToken: 'dev-pass',
        deletePassword: 'comment-pass',
        options: 'sage'
      })
    });
    const commentBody = await comment.json();
    assert.equal(comment.status, 201);
    assert.equal(commentBody.data.comment.displayName, 'Ban reply');

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
test('http rate limits board thread search queries', async () => {
  const rateLimitStore = createCountingRateLimitStore();

  await withServer(
    async (baseUrl) => {
      const unsearched = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`);
      assert.equal(unsearched.status, 200);
      for (let index = 0; index < 10; index += 1) {
        const response = await fetch(`${baseUrl}/api/boards/hoc-tap/threads?q=alpha`);
        assert.equal(response.status, 200);
      }
      const limited = await fetch(`${baseUrl}/api/boards/hoc-tap/threads?search=alpha`);
      assert.equal(limited.status, 429);
    },
    { rateLimitStore }
  );

  assert.equal(rateLimitStore.calls.length, 11);
  assert.equal(rateLimitStore.calls.every((key) => key.includes(':search:board:hoc-tap')), true);
});


test('http rate limits can share counters across server instances', async () => {
  const rateLimitStore = createCountingRateLimitStore();

  await withServer(
    async (baseUrl) => {
      for (let index = 0; index < 3; index += 1) {
        const response = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: `Shared limiter A ${index}`,
            captchaToken: 'dev-pass'
          })
        });
        assert.equal(response.status, 201);
      }
    },
    { rateLimitStore }
  );

  await withServer(
    async (baseUrl) => {
      for (let index = 0; index < 2; index += 1) {
        const response = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: `Shared limiter B ${index}`,
            captchaToken: 'dev-pass'
          })
        });
        assert.equal(response.status, 201);
      }

      const limited = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Shared limiter should block',
          captchaToken: 'dev-pass'
        })
      });
      assert.equal(limited.status, 429);
    },
    { rateLimitStore }
  );

  assert.equal(rateLimitStore.calls.every((key) => key.includes(':thread:hoc-tap')), true);
});

test('http shared rate limiter failure mode can fail closed or open', async () => {
  const closedStore = createCountingRateLimitStore({ fail: true });
  const closedErrors = [];
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Fail closed',
          captchaToken: 'dev-pass'
        })
      });
      assert.equal(response.status, 429);
    },
    {
      rateLimitStore: closedStore,
      rateLimitFailureMode: 'closed',
      rateLimitLogger(error) {
        closedErrors.push(error.message);
      }
    }
  );

  const openStore = createCountingRateLimitStore({ fail: true });
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Fail open',
          captchaToken: 'dev-pass'
        })
      });
      assert.equal(response.status, 201);
    },
    {
      rateLimitStore: openStore,
      rateLimitFailureMode: 'open',
      rateLimitLogger() {}
    }
  );

  assert.deepEqual(closedErrors, ['shared limiter unavailable']);
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
    assert.equal(healthBody.data.store.configured, true);
    assert.equal(healthBody.data.store.ready, true);
    assert.equal(typeof healthBody.data.ai.configured, 'boolean');
    assert.equal(healthBody.data.security.adminConfigured, true);
    assert.equal(healthBody.data.security.hcaptchaConfigured, false);
    assert.ok(healthBody.data.security.warnings.includes('jwt_secret_default_or_missing'));
    assert.ok(healthBody.data.security.warnings.includes('hcaptcha_not_configured'));
    assert.equal(serialized.includes('GOOGLE_AI_API_KEY'), false);
    assert.equal(serialized.includes('MONGODB_URI'), false);
    assert.equal(serialized.includes('data/uploads-test'), false);
    assert.equal(serialized.includes('test-key'), false);
    assert.equal(serialized.includes('"pass"'), false);
  });
});

test('http api returns 503 when health is degraded', async () => {
  const unavailableStore = {
    type: 'mongo',
    async read() {
      throw new Error('mongodb://user:secret@example.test/36chan');
    },
    async health() {
      return {
        type: 'mongo',
        configured: true,
        ready: false,
        error: 'unavailable'
      };
    }
  };

  await withServer(
    async (baseUrl) => {
      const health = await fetch(`${baseUrl}/api/health`);
      const healthBody = await health.json();
      const serialized = JSON.stringify(healthBody.data);

      assert.equal(health.status, 503);
      assert.equal(healthBody.data.status, 'degraded');
      assert.equal(healthBody.data.store.type, 'mongo');
      assert.equal(healthBody.data.store.ready, false);
      assert.equal(healthBody.data.store.error, 'unavailable');
      assert.equal(serialized.includes('mongodb://'), false);
      assert.equal(serialized.includes('user:secret@example.test'), false);
    },
    { store: unavailableStore }
  );
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

test('http api thread upload limit uses defaults when env values are invalid', async () => {
  const originalMaxImageBytes = process.env.MAX_IMAGE_BYTES;
  const originalMaxThumbnailBytes = process.env.MAX_THUMBNAIL_BYTES;
  process.env.MAX_IMAGE_BYTES = 'not-a-number';
  process.env.MAX_THUMBNAIL_BYTES = 'not-a-number';

  try {
    await withServer(async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'A'.repeat(1_700_001),
          captchaToken: 'dev-pass'
        })
      });
      const createdBody = await created.json();

      assert.equal(created.status, 413);
      assert.equal(createdBody.error.message, 'Dữ liệu gửi lên quá lớn');
    });
  } finally {
    if (originalMaxImageBytes === undefined) {
      delete process.env.MAX_IMAGE_BYTES;
    } else {
      process.env.MAX_IMAGE_BYTES = originalMaxImageBytes;
    }
    if (originalMaxThumbnailBytes === undefined) {
      delete process.env.MAX_THUMBNAIL_BYTES;
    } else {
      process.env.MAX_THUMBNAIL_BYTES = originalMaxThumbnailBytes;
    }
  }
});

test('http api stores uploaded images on local disk and serves them from /uploads', async () => {
  const dataRoot = path.resolve('data');
  await fs.mkdir(dataRoot, { recursive: true });
  const uploadRoot = await fs.mkdtemp(path.join(dataRoot, 'uploads-test-'));
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
              name: 'anh.avif',
              type: 'image/avif',
              dataUrl: 'data:image/avif;base64,AAAA',
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
        assert.equal(image.storageKey.endsWith('.avif'), true);
        assert.equal((await fs.readFile(path.join(uploadRoot, image.storageKey))).length, 3);
        assert.equal((await fs.readFile(path.join(uploadRoot, image.thumbnail.storageKey))).length, 2);

        const imageResponse = await fetch(`${baseUrl}${image.url}`);
        assert.equal(imageResponse.status, 200);
        assert.equal(imageResponse.headers.get('content-type'), 'image/avif');
        assert.equal((await imageResponse.arrayBuffer()).byteLength, 3);

        const thumbnailResponse = await fetch(`${baseUrl}${image.thumbnail.url}`);
        assert.equal(thumbnailResponse.status, 200);
        assert.equal(thumbnailResponse.headers.get('content-type'), 'image/jpeg');
        assert.equal((await thumbnailResponse.arrayBuffer()).byteLength, 2);

        const health = await fetch(`${baseUrl}/api/health`);
        const healthBody = await health.json();
        const serializedHealth = JSON.stringify(healthBody.data);
        assert.equal(health.status, 200);
        assert.equal(healthBody.data.imageStorage.type, 'local-disk');
        assert.equal(serializedHealth.includes(uploadRoot), false);
        assert.equal(serializedHealth.includes('uploads-test'), false);
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

test('http api stores uploaded video media on local disk and serves it from /uploads', async () => {
  const dataRoot = path.resolve('data');
  await fs.mkdir(dataRoot, { recursive: true });
  const uploadRoot = await fs.mkdtemp(path.join(dataRoot, 'uploads-test-'));
  try {
    await withServer(
      async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: 'Video local disk',
            captchaToken: 'dev-pass',
            images: [
              {
                name: 'clip.webm',
                type: 'video/webm',
                dataUrl: 'data:video/webm;base64,AAAA',
                sizeBytes: 3,
                thumbnail: {
                  name: 'clip-poster.jpg',
                  type: 'image/jpeg',
                  dataUrl: 'data:image/jpeg;base64,AAA=',
                  sizeBytes: 2,
                  width: 1,
                  height: 1
                }
              }
            ]
          })
        });
        const createdBody = await created.json();
        const video = createdBody.data.thread.images[0];

        assert.equal(created.status, 201);
        assert.equal(createdBody.data.thread.image.storageKey, video.storageKey);
        assert.equal(video.storage, 'local');
        assert.equal(video.dataUrl, undefined);
        assert.equal(video.url.endsWith('.webm'), true);
        assert.equal(video.thumbnail.url.endsWith('.thumb.jpg'), true);
        assert.equal((await fs.readFile(path.join(uploadRoot, video.storageKey))).length, 3);

        const videoResponse = await fetch(`${baseUrl}${video.url}`);
        assert.equal(videoResponse.status, 200);
        assert.equal(videoResponse.headers.get('content-type'), 'video/webm');
        assert.equal((await videoResponse.arrayBuffer()).byteLength, 3);
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
    const forwardedJson = await fetch(`${baseUrl}/feeds/latest.json?limit=1`, {
      headers: { 'x-forwarded-proto': 'https, http' }
    });
    const forwardedJsonBody = await forwardedJson.json();
    assert.equal(json.status, 200);
    assert.equal(json.headers.get('content-type')?.includes('application/json'), true);
    assert.equal(jsonBody.version, 'https://jsonfeed.org/version/1.1');
    assert.equal(jsonBody.items.length, 1);
    assert.equal(jsonBody.items[0].title.includes('/an-uong/'), true);
    assert.equal(forwardedJson.status, 200);
    assert.equal(forwardedJsonBody.feed_url.startsWith('https://'), true);
    assert.equal(forwardedJsonBody.items[0].url.startsWith('https://'), true);

    const rss = await fetch(`${baseUrl}/feeds/latest.rss?limit=1`);
    const rssBody = await rss.text();
    assert.equal(rss.status, 200);
    assert.equal(rss.headers.get('content-type')?.includes('application/rss+xml'), true);
    assert.equal(rssBody.includes('<rss version="2.0">'), true);
    assert.equal(rssBody.includes('Feed test &amp; XML'), true);
  });
});

test('http api and feeds expose recommended threads', async () => {
  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Chu de co nhieu tuong tac',
        captchaToken: 'dev-pass'
      })
    });
    const firstBody = await first.json();
    await fetch(`${baseUrl}/api/threads/${firstBody.data.thread.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Them mot goc nhin',
        captchaToken: 'dev-pass'
      })
    });
    await fetch(`${baseUrl}/api/boards/an-uong/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Chu de moi',
        captchaToken: 'dev-pass'
      })
    });

    const api = await fetch(`${baseUrl}/api/threads/recommended?limit=1`);
    const apiBody = await api.json();
    assert.equal(api.status, 200);
    assert.equal(apiBody.data.length, 1);
    assert.equal(typeof apiBody.data[0].recommendation.score, 'number');
    assert.equal(Array.isArray(apiBody.data[0].recommendation.reasons), true);
    assert.equal(Array.isArray(apiBody.data[0].recommendation.sources), true);
    assert.equal(typeof apiBody.data[0].recommendation.features.openReportCount, 'number');

    const json = await fetch(`${baseUrl}/feeds/recommended.json?limit=1`);
    const jsonBody = await json.json();
    assert.equal(json.status, 200);
    assert.equal(jsonBody.title, '36chan - Chủ đề đề xuất');
    assert.equal(jsonBody.items.length, 1);

    const rss = await fetch(`${baseUrl}/feeds/recommended.rss?limit=1`);
    const rssBody = await rss.text();
    assert.equal(rss.status, 200);
    assert.equal(rss.headers.get('content-type')?.includes('application/rss+xml'), true);
    assert.equal(rssBody.includes('<rss version="2.0">'), true);
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

    const jsonFeed = await fetch(`${baseUrl}/feeds/hot-boards.json?limit=3`);
    const jsonFeedBody = await jsonFeed.json();
    assert.equal(jsonFeed.status, 200);
    assert.equal(jsonFeedBody.title, '36chan - Bảng đang nóng');
    assert.equal(jsonFeedBody.items[0].id, 'hoc-tap');
    assert.equal(jsonFeedBody.items[0].content_text.includes('2 bài trong 24h'), true);

    const rssFeed = await fetch(`${baseUrl}/feeds/hot-boards.rss?limit=3`);
    const rssFeedBody = await rssFeed.text();
    assert.equal(rssFeed.status, 200);
    assert.equal(rssFeed.headers.get('content-type')?.includes('application/rss+xml'), true);
    assert.equal(rssFeedBody.includes('<title>36chan - Bảng đang nóng</title>'), true);
    assert.equal(rssFeedBody.includes('/hoc-tap/ Học tập'), true);
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
        category: 'PII',
        reason: 'Co thong tin rieng tu',
        posterToken: 'reporter-secret'
      })
    });
    assert.equal(report.status, 201);
    const reportBody = await report.json();
    assert.equal(reportBody.data.category, 'PII');

    const second = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Bai spam can report',
        captchaToken: 'dev-pass'
      })
    });
    const secondBody = await second.json();
    const fallbackReport = await fetch(`${baseUrl}/api/posts/${secondBody.data.thread.globalNumber}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'Unknown',
        reason: 'Khac',
        posterToken: 'reporter-secret-2'
      })
    });
    assert.equal(fallbackReport.status, 201);
    const fallbackReportBody = await fallbackReport.json();
    assert.equal(fallbackReportBody.data.category, 'Other');

    const unauthorized = await fetch(`${baseUrl}/api/admin/reports`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' })
    });
    const loginBody = await login.json();
    const reports = await fetch(`${baseUrl}/api/admin/reports?category=PII`, {
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    const reportsBody = await reports.json();
    const serialized = JSON.stringify(reportsBody.data);

    assert.equal(reports.status, 200);
    assert.equal(reportsBody.data.length, 1);
    assert.equal(reportsBody.data[0].category, 'PII');
    assert.equal(reportsBody.data[0].reason, 'Co thong tin rieng tu');
    assert.equal(reportsBody.data[0].globalNumber, createdBody.data.thread.globalNumber);
    assert.equal(serialized.includes('reporter-secret'), false);

    const summary = await fetch(`${baseUrl}/api/admin/posts/${createdBody.data.thread.globalNumber}/reports/summary`, {
      method: 'POST',
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    const summaryBody = await summary.json();

    assert.equal(summary.status, 200);
    assert.equal(summaryBody.data.label, 'Nội dung do AI tổng hợp');
    assert.equal(summaryBody.data.summary, 'Tom tat bao cao AI');
  });
});

test('http api supports anonymous appeal submission and admin resolution', async () => {
  const dates = [
    new Date('2026-05-22T08:00:00.000Z'),
    new Date('2026-05-22T08:01:00.000Z'),
    new Date('2026-05-22T08:02:00.000Z')
  ];
  await withServer(
    async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/boards/tam-su/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Bai bi giu de test khang nghi',
          captchaToken: 'dev-pass',
          posterToken: 'poster-secret'
        })
      });
      const createdBody = await created.json();

      assert.equal(created.status, 201);
      assert.equal(createdBody.data.status, 'pending');
      assert.equal(typeof createdBody.data.appealToken, 'string');

      const appeal = await fetch(`${baseUrl}/api/appeals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.44' },
        body: JSON.stringify({
          token: createdBody.data.appealToken,
          reason: 'Xin xem lai vi khong phai spam',
          posterToken: 'appeal-poster-secret'
        })
      });
      const appealBody = await appeal.json();
      const serializedAppeal = JSON.stringify(appealBody.data);

      assert.equal(appeal.status, 201);
      assert.equal(appealBody.data.status, 'open');
      assert.equal(appealBody.data.globalNumber, createdBody.data.thread.globalNumber);
      assert.equal(serializedAppeal.includes(createdBody.data.appealToken), false);
      assert.equal(serializedAppeal.includes('198.51.100.44'), false);
      assert.equal(serializedAppeal.includes('appeal-poster-secret'), false);

      const duplicate = await fetch(`${baseUrl}/api/appeals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: createdBody.data.appealToken,
          reason: 'Gui lai'
        })
      });
      assert.equal(duplicate.status, 409);

      const unauthorized = await fetch(`${baseUrl}/api/admin/appeals`);
      assert.equal(unauthorized.status, 401);

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

      const appeals = await fetch(`${baseUrl}/api/admin/appeals`, {
        headers: { authorization: adminHeaders.authorization }
      });
      const appealsBody = await appeals.json();
      assert.equal(appeals.status, 200);
      assert.equal(appealsBody.data.length, 1);
      assert.equal(appealsBody.data[0].reason, 'Xin xem lai vi khong phai spam');

      const resolved = await fetch(`${baseUrl}/api/admin/appeals/${appealBody.data.id}/resolve`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'rejected', reason: 'Quyet dinh giu nguyen' })
      });
      const resolvedBody = await resolved.json();
      assert.equal(resolved.status, 200);
      assert.equal(resolvedBody.data.status, 'rejected');
      assert.equal(resolvedBody.data.history.at(-1).action, 'rejected');

      const actions = await fetch(`${baseUrl}/api/admin/moderation-actions`, {
        headers: { authorization: adminHeaders.authorization }
      });
      const actionsBody = await actions.json();
      assert.equal(actions.status, 200);
      assert.equal(actionsBody.data[0].action, 'admin:appeal-reject');
      assert.equal(actionsBody.data[0].reason, 'Quyet dinh giu nguyen');
    },
    {
      ai: flaggedAi,
      now: () => dates.shift() ?? new Date('2026-05-22T08:02:00.000Z')
    }
  );
});

test('http api restores deleted public post when anonymous appeal is accepted', async () => {
  const dates = [
    new Date('2026-05-22T09:00:00.000Z'),
    new Date('2026-05-22T09:01:00.000Z'),
    new Date('2026-05-22T09:02:00.000Z'),
    new Date('2026-05-22T09:03:00.000Z')
  ];
  await withServer(
    async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/boards/tam-su/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Bai public de test khoi phuc khang nghi',
          captchaToken: 'dev-pass',
          posterToken: 'poster-restore-secret'
        })
      });
      const createdBody = await created.json();
      assert.equal(created.status, 201);
      assert.equal(createdBody.data.status, 'published');
      assert.equal(typeof createdBody.data.appealToken, 'string');

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

      const deleted = await fetch(`${baseUrl}/api/admin/posts/${createdBody.data.thread.globalNumber}`, {
        method: 'DELETE',
        headers: adminHeaders,
        body: JSON.stringify({ reason: 'Xoa de cho khang nghi' })
      });
      assert.equal(deleted.status, 200);

      const hiddenThreads = await fetch(`${baseUrl}/api/boards/tam-su/threads`);
      const hiddenThreadsBody = await hiddenThreads.json();
      assert.equal(hiddenThreads.status, 200);
      assert.equal(
        hiddenThreadsBody.data.some((thread) => thread.globalNumber === createdBody.data.thread.globalNumber),
        false
      );

      const appeal = await fetch(`${baseUrl}/api/appeals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: createdBody.data.appealToken,
          reason: 'Xin khoi phuc bai da xoa'
        })
      });
      const appealBody = await appeal.json();
      assert.equal(appeal.status, 201);
      assert.equal(appealBody.data.status, 'open');

      const resolved = await fetch(`${baseUrl}/api/admin/appeals/${appealBody.data.id}/resolve`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'accepted', reason: 'Dong y khoi phuc' })
      });
      const resolvedBody = await resolved.json();
      assert.equal(resolved.status, 200);
      assert.equal(resolvedBody.data.status, 'accepted');

      const restoredThreads = await fetch(`${baseUrl}/api/boards/tam-su/threads`);
      const restoredThreadsBody = await restoredThreads.json();
      assert.equal(restoredThreads.status, 200);
      assert.equal(
        restoredThreadsBody.data.some((thread) => thread.globalNumber === createdBody.data.thread.globalNumber),
        true
      );

      const actions = await fetch(`${baseUrl}/api/admin/moderation-actions`, {
        headers: { authorization: adminHeaders.authorization }
      });
      const actionsBody = await actions.json();
      const restoreAction = actionsBody.data.find((action) => action.action === 'admin:appeal-restore');
      const acceptAction = actionsBody.data.find((action) => action.action === 'admin:appeal-accept');
      assert.equal(actions.status, 200);
      assert.equal(restoreAction?.globalNumber, createdBody.data.thread.globalNumber);
      assert.equal(restoreAction?.reason, 'Dong y khoi phuc');
      assert.equal(acceptAction?.globalNumber, createdBody.data.thread.globalNumber);
      assert.equal(acceptAction?.reason, 'Dong y khoi phuc');
    },
    {
      ai: safeAi,
      now: () => dates.shift() ?? new Date('2026-05-22T09:03:00.000Z')
    }
  );
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

test('http admin queue exposes and filters AI moderation confidence', async () => {
  const results = [
    { status: 'Flagged', labels: ['Spam'], confidence: 0.42 },
    { status: 'Flagged', labels: ['Toxic'], confidence: 0.91 }
  ];
  await withServer(
    async (baseUrl) => {
      const low = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Low confidence pending',
          captchaToken: 'dev-pass'
        })
      });
      const lowBody = await low.json();
      const high = await fetch(`${baseUrl}/api/boards/tam-su/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'High confidence pending',
          captchaToken: 'dev-pass'
        })
      });
      const highBody = await high.json();
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass' })
      });
      const loginBody = await login.json();
      const headers = { authorization: `Bearer ${loginBody.data.token}` };

      const pending = await fetch(`${baseUrl}/api/admin/pending?confidence=80&sort=confidence-desc`, { headers });
      const pendingBody = await pending.json();
      const actions = await fetch(`${baseUrl}/api/admin/moderation-actions?confidence=80`, { headers });
      const actionsBody = await actions.json();

      assert.equal(lowBody.data.thread.moderationConfidence, 0.42);
      assert.equal(highBody.data.thread.moderationConfidence, 0.91);
      assert.equal(pending.status, 200);
      assert.deepEqual(pendingBody.data.map((post) => post.id), [highBody.data.thread.id]);
      assert.equal(pendingBody.data[0].moderationConfidence, 0.91);
      assert.equal(actions.status, 200);
      assert.equal(actionsBody.data.length, 1);
      assert.equal(actionsBody.data[0].moderationConfidence, 0.91);
    },
    {
      ai: {
        async moderate() {
          return results.shift() ?? { status: 'Safe', labels: [] };
        }
      }
    }
  );
});

test('http admin moderation settings update confidence queue threshold', async () => {
  await withServer(
    async (baseUrl) => {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass' })
      });
      const loginBody = await login.json();
      const headers = {
        authorization: `Bearer ${loginBody.data.token}`,
        'content-type': 'application/json'
      };

      const update = await fetch(`${baseUrl}/api/admin/moderation-settings`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ moderationConfidenceThreshold: 80 })
      });
      const updateBody = await update.json();
      const settings = await fetch(`${baseUrl}/api/admin/moderation-settings`, {
        headers: { authorization: headers.authorization }
      });
      const settingsBody = await settings.json();
      const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Low confidence should bypass queue',
          captchaToken: 'dev-pass'
        })
      });
      const createdBody = await created.json();

      assert.equal(update.status, 200);
      assert.equal(updateBody.data.moderationConfidenceThreshold, 0.8);
      assert.equal(settings.status, 200);
      assert.equal(settingsBody.data.moderationConfidenceThreshold, 0.8);
      assert.equal(createdBody.data.status, 'published');
      assert.equal(createdBody.data.thread.moderationConfidence, 0.4);
    },
    {
      ai: {
        async moderate() {
          return { status: 'Flagged', labels: ['Spam'], confidence: 0.4 };
        }
      }
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

test('http admin can sticky and unsticky active public threads only', async () => {
  const dates = [
    new Date('2026-05-22T08:00:00.000Z'),
    new Date('2026-05-22T08:01:00.000Z'),
    new Date('2026-05-22T08:02:00.000Z')
  ];
  await withServer(
    async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Noi quy can ghim',
          captchaToken: 'dev-pass'
        })
      });
      const firstBody = await first.json();
      await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Thread thuong moi hon',
          captchaToken: 'dev-pass'
        })
      });

      const unauthorized = await fetch(`${baseUrl}/api/admin/threads/${firstBody.data.thread.id}/sticky`, {
        method: 'POST'
      });
      assert.equal(unauthorized.status, 401);

      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass' })
      });
      const loginBody = await login.json();
      const adminHeaders = { authorization: `Bearer ${loginBody.data.token}` };
      const stickied = await fetch(`${baseUrl}/api/admin/threads/${firstBody.data.thread.id}/sticky`, {
        method: 'POST',
        headers: adminHeaders
      });
      const stickiedBody = await stickied.json();
      const listed = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`);
      const listedBody = await listed.json();
      const unstuck = await fetch(`${baseUrl}/api/admin/threads/${firstBody.data.thread.id}/sticky`, {
        method: 'DELETE',
        headers: adminHeaders
      });
      const unstuckBody = await unstuck.json();
      const missing = await fetch(`${baseUrl}/api/admin/threads/missing-thread/sticky`, {
        method: 'POST',
        headers: adminHeaders
      });

      assert.equal(stickied.status, 200);
      assert.equal(stickiedBody.data.isSticky, true);
      assert.equal(stickiedBody.data.stickiedBy, undefined);
      assert.equal(listedBody.data[0].id, firstBody.data.thread.id);
      assert.equal(listedBody.data[0].isSticky, true);
      assert.equal(unstuck.status, 200);
      assert.equal(unstuckBody.data.isSticky, false);
      assert.equal(missing.status, 404);
    },
    {
      now: () => dates.shift() ?? new Date('2026-05-22T08:02:00.000Z')
    }
  );
});

test('http api exposes board archive and admin manual archive', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Can archive <xml> & feed',
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

    const archiveJsonFeed = await fetch(`${baseUrl}/feeds/boards/hoc-tap/archive.json?limit=3`);
    const archiveJsonFeedBody = await archiveJsonFeed.json();
    assert.equal(archiveJsonFeed.status, 200);
    assert.equal(archiveJsonFeedBody.title, '36chan - Lưu trữ /hoc-tap/');
    assert.equal(archiveJsonFeedBody.items.length, 1);
    assert.equal(archiveJsonFeedBody.items[0].content_text, 'Can archive <xml> & feed');
    assert.equal('posterHash' in archiveJsonFeedBody.items[0], false);

    const archiveRssFeed = await fetch(`${baseUrl}/feeds/boards/hoc-tap/archive.rss?limit=3`);
    const archiveRssFeedBody = await archiveRssFeed.text();
    assert.equal(archiveRssFeed.status, 200);
    assert.equal(archiveRssFeed.headers.get('content-type')?.includes('application/rss+xml'), true);
    assert.equal(archiveRssFeedBody.includes('Can archive &lt;xml&gt; &amp; feed'), true);

    const adminHeaders = {
      authorization: `Bearer ${loginBody.data.token}`,
      'content-type': 'application/json'
    };
    const privateBoard = await fetch(`${baseUrl}/api/admin/boards`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        slug: 'private-archive',
        name: 'Private archive',
        category: 'Test',
        description: 'Archive is not public',
        retentionPolicy: {
          maxActiveThreadsPerBoard: 150,
          bumpLimit: 300,
          replyLimit: 500,
          publicArchive: false
        }
      })
    });
    assert.equal(privateBoard.status, 201);
    const privateThread = await fetch(`${baseUrl}/api/boards/private-archive/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Public board with private archive',
        captchaToken: 'dev-pass'
      })
    });
    const privateThreadBody = await privateThread.json();
    assert.equal(privateThread.status, 201);

    const archivePrivateThread = await fetch(`${baseUrl}/api/admin/threads/${privateThreadBody.data.thread.id}/archive`, {
      method: 'POST',
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    assert.equal(archivePrivateThread.status, 200);

    const privateArchive = await fetch(`${baseUrl}/api/boards/private-archive/archive`);
    assert.equal(privateArchive.status, 404);
    const privateArchiveJsonFeed = await fetch(`${baseUrl}/feeds/boards/private-archive/archive.json`);
    const privateArchiveRssFeed = await fetch(`${baseUrl}/feeds/boards/private-archive/archive.rss`);
    assert.equal(privateArchiveJsonFeed.status, 404);
    assert.equal(privateArchiveRssFeed.status, 404);
  });
});
