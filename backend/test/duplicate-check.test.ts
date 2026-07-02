import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { createForumService } from '../src/core/forum-service.js';
import { createMemoryStore } from '../src/core/forum-store.ts';
import { createHttpServer } from '../src/server/http-app.ts';

function createTestRealtime() {
  return {
    publish() {},
    count: () => 0
  };
}

function withGoogleKey(fn) {
  return async (...args) => {
    const originalKey = process.env.GOOGLE_AI_API_KEY;
    process.env.GOOGLE_AI_API_KEY = 'test-key';
    try {
      return await fn(...args);
    } finally {
      if (originalKey === undefined) {
        delete process.env.GOOGLE_AI_API_KEY;
      } else {
        process.env.GOOGLE_AI_API_KEY = originalKey;
      }
    }
  };
}

function duplicateAi() {
  const checks = [];
  return {
    checks,
    async moderate() {
      return { status: 'Safe', labels: [] };
    },
    async checkDuplicateThread(newBody, existingThreads) {
      checks.push({ newBody, existingThreads });
      return {
        isDuplicate: newBody.includes('duplicate-me'),
        matchedThreadId: existingThreads[0]?.id ?? null,
        reason: 'Nội dung trùng với chủ đề trước đó'
      };
    }
  };
}

function flaggedAi() {
  return {
    async moderate() {
      return { status: 'Flagged', labels: ['Spam'] };
    },
    async checkDuplicateThread() {
      return { isDuplicate: false, matchedThreadId: null, reason: null };
    }
  };
}

async function withServer(callback, { ai = duplicateAi(), store = createMemoryStore() } = {}) {
  const realtime = createTestRealtime();
  const service = createForumService({
    store,
    ai,
    realtime,
    now: () => new Date('2026-06-20T10:00:00.000Z')
  });
  const server = createHttpServer({
    service,
    realtime,
    jwtSecret: 'secret',
    adminUsername: 'admin',
    adminPassword: 'pass'
  } as Parameters<typeof createHttpServer>[0]);
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${port}`, { ai, service });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test(
  'duplicate check sends only active public board threads to AI',
  withGoogleKey(async () => {
    const ai = duplicateAi();
    const store = createMemoryStore();
    const service = createForumService({
      store,
      ai,
      realtime: createTestRealtime(),
      now: () => new Date('2026-06-20T10:00:00.000Z')
    });
    const publicThread = await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'Thread cong khai goc',
      captchaToken: 'dev-pass',
      ip: '203.0.113.1',
      posterToken: 'one'
    } as Parameters<typeof service.createThread>[0]);
    const archivedThread = await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'Thread da luu tru',
      captchaToken: 'dev-pass',
      ip: '203.0.113.2',
      posterToken: 'two'
    } as Parameters<typeof service.createThread>[0]);
    await service.archiveThread(archivedThread.thread.id, { actor: 'admin' } as unknown as string);
    const pendingService = createForumService({
      store,
      ai: flaggedAi(),
      realtime: createTestRealtime(),
      now: () => new Date('2026-06-20T10:00:00.000Z')
    });
    await pendingService.createThread({
      boardSlug: 'hoc-tap',
      body: 'Thread cho duyet',
      captchaToken: 'dev-pass',
      ip: '203.0.113.3',
      posterToken: 'three'
    } as Parameters<typeof pendingService.createThread>[0]);

    const result = await service.checkDuplicateThread({
      boardSlug: 'hoc-tap',
      body: 'duplicate-me noi dung moi',
      ip: '203.0.113.4',
      posterToken: 'four'
    } as Parameters<typeof service.checkDuplicateThread>[0]);

    assert.equal(result.isDuplicate, true);
    assert.equal(result.matchedThreadId, publicThread.thread.id);
    assert.equal(ai.checks.length, 1);
    assert.deepEqual(ai.checks[0].existingThreads, [
      {
        id: publicThread.thread.id,
        globalNumber: publicThread.thread.globalNumber,
        body: 'Thread cong khai goc'
      }
    ]);
  })
);

test('duplicate check is a no-op when AI is not configured', async () => {
  const originalKey = process.env.GOOGLE_AI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  try {
    const ai = duplicateAi();
    const service = createForumService({
      store: createMemoryStore(),
      ai,
      realtime: createTestRealtime(),
      now: () => new Date('2026-06-20T10:00:00.000Z')
    });
    await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'Thread cong khai',
      captchaToken: 'dev-pass',
      ip: '203.0.113.1'
    } as Parameters<typeof service.createThread>[0]);

    const result = await service.checkDuplicateThread({
      boardSlug: 'hoc-tap',
      body: 'duplicate-me',
      ip: '203.0.113.2'
    } as Parameters<typeof service.checkDuplicateThread>[0]);

    assert.deepEqual(result, { isDuplicate: false, matchedThreadId: null, reason: null });
    assert.equal(ai.checks.length, 0);
  } finally {
    if (originalKey === undefined) {
      delete process.env.GOOGLE_AI_API_KEY;
    } else {
      process.env.GOOGLE_AI_API_KEY = originalKey;
    }
  }
});

test(
  'http duplicate check route returns advisory duplicate result',
  withGoogleKey(async () => {
    const ai = duplicateAi();
    await withServer(
      async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: 'Thread cu ve canteen',
            captchaToken: 'dev-pass',
            posterToken: 'one'
          })
        });
        assert.equal(created.status, 201);

        const checked = await fetch(`${baseUrl}/api/boards/hoc-tap/threads/check-duplicate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: 'duplicate-me canteen',
            posterToken: 'two'
          })
        });
        const payload = await checked.json() as {
          data: {
            isDuplicate: boolean;
            reason: string | null;
          };
        };

        assert.equal(checked.status, 200);
        assert.equal(payload.data.isDuplicate, true);
        assert.equal(payload.data.reason, 'Nội dung trùng với chủ đề trước đó');
        assert.equal(ai.checks.length, 1);
      },
      { ai }
    );
  })
);
