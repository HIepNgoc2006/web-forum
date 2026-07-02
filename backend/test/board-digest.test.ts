import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';

import { createForumService } from '../src/core/forum-service.ts';
import { createMemoryStore } from '../src/core/forum-store.ts';
import { createHttpServer } from '../src/server/http-app.ts';

function createTestRealtime() {
  return {
    publish() {},
    count: () => 0
  };
}

function hasStatusCode(error: unknown, statusCode: number): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode?: number }).statusCode === statusCode;
}

function capturingAi() {
  const captured = [];
  return {
    captured,
    async moderate(text) {
      return text.includes('flagme') ? { status: 'Flagged', labels: ['Spam'] } : { status: 'Safe', labels: [] };
    },
    async summarize(items) {
      captured.push(items);
      return ['Tom tat 1', 'Tom tat 2'];
    },
    async suggest() {
      return [];
    },
    async rewrite(text) {
      return text;
    },
    async summarizeReports() {
      return '';
    }
  };
}

test('admin board digest only sends public, redacted content to AI', async () => {
  const ai = capturingAi();
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime: createTestRealtime(),
    now: () => new Date('2026-06-17T08:00:00.000Z')
  });

  // Public thread carrying PII in the body plus secrets in request metadata.
  await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Cong khai: lien he test@example.com hoac 0901234567',
    captchaToken: 'captcha-secret-token',
    ip: '203.0.113.99',
    posterToken: 'poster-secret-token',
    adminToken: 'admin-secret-token'
  } as unknown as Parameters<typeof service.createThread>[0]);

  // Pending (flagged) thread must be excluded.
  await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'flagme noi dung khong duoc tong hop',
    captchaToken: 'dev-pass',
    ip: '203.0.113.1'
  } as Parameters<typeof service.createThread>[0]);

  // Content on a board that is later hidden must be excluded.
  await service.createThread({
    boardSlug: 'tam-su',
    body: 'NOIDUNGBIAN khong duoc gui cho AI',
    captchaToken: 'dev-pass',
    ip: '203.0.113.2'
  } as Parameters<typeof service.createThread>[0]);
  await service.updateBoard('tam-su', { isHidden: true }, { actor: 'admin' });

  const digest = await service.generateBoardDigest({
    ip: '198.51.100.7',
    actor: 'admin'
  } as Parameters<typeof service.generateBoardDigest>[0]);

  assert.equal(digest.label, 'Nội dung do AI tổng hợp');
  assert.equal(digest.threadCount, 1);
  assert.deepEqual(digest.bullets, ['Tom tat 1', 'Tom tat 2']);

  assert.equal(ai.captured.length, 1);
  const sent = JSON.stringify(ai.captured[0]);

  // PII redaction applied.
  assert.ok(sent.includes('[email da an]'));
  assert.ok(sent.includes('[so dien thoai da an]'));
  assert.equal(sent.includes('test@example.com'), false);
  assert.equal(sent.includes('0901234567'), false);

  // Pending and hidden-board content excluded.
  assert.equal(sent.includes('flagme'), false);
  assert.equal(sent.includes('NOIDUNGBIAN'), false);

  // No IPs or tokens of any kind are sent to AI.
  for (const secret of [
    '203.0.113.99',
    '203.0.113.1',
    '203.0.113.2',
    '198.51.100.7',
    'captcha-secret-token',
    'poster-secret-token',
    'admin-secret-token'
  ]) {
    assert.equal(sent.includes(secret), false);
  }
});

test('admin board digest returns a defer message and skips AI when no public content', async () => {
  const ai = capturingAi();
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime: createTestRealtime(),
    now: () => new Date('2026-06-17T08:00:00.000Z')
  });

  const digest = await service.generateBoardDigest({
    ip: '198.51.100.7',
    actor: 'admin'
  } as Parameters<typeof service.generateBoardDigest>[0]);
  assert.equal(digest.threadCount, 0);
  assert.equal(ai.captured.length, 0);
  assert.equal(digest.label, 'Nội dung do AI tổng hợp');
});

test('admin board digest enforces a daily admin budget', async () => {
  const previous = process.env.ADMIN_DIGEST_DAILY_LIMIT;
  process.env.ADMIN_DIGEST_DAILY_LIMIT = '1';
  try {
    const ai = capturingAi();
    const service = createForumService({
      store: createMemoryStore(),
      ai,
      realtime: createTestRealtime(),
      now: () => new Date('2026-06-17T08:00:00.000Z')
    });

    await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'noi dung mot',
      captchaToken: 'dev-pass',
      ip: '203.0.113.5'
    } as Parameters<typeof service.createThread>[0]);
    await service.generateBoardDigest({
      ip: '198.51.100.7',
      actor: 'admin'
    } as Parameters<typeof service.generateBoardDigest>[0]);

    // New content changes the fingerprint, forcing a second budget consumption.
    await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'noi dung hai',
      captchaToken: 'dev-pass',
      ip: '203.0.113.6'
    } as Parameters<typeof service.createThread>[0]);
    await assert.rejects(
      () => service.generateBoardDigest({
        ip: '198.51.100.7',
        actor: 'admin'
      } as Parameters<typeof service.generateBoardDigest>[0]),
      (error) => hasStatusCode(error, 429)
    );
  } finally {
    if (previous === undefined) {
      delete process.env.ADMIN_DIGEST_DAILY_LIMIT;
    } else {
      process.env.ADMIN_DIGEST_DAILY_LIMIT = previous;
    }
  }
});

async function withDigestServer(callback) {
  const ai = capturingAi();
  const realtime = createTestRealtime();
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime,
    now: () => new Date('2026-06-17T08:00:00.000Z')
  });
  const server = createHttpServer({
    service,
    realtime,
    jwtSecret: 'secret',
    adminUsername: 'admin',
    adminPassword: 'pass',
    uploadRoot: path.resolve('data/uploads-test')
  } as Parameters<typeof createHttpServer>[0]);
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

test('http admin board digest is admin-only and labelled AI-generated', async () => {
  await withDigestServer(async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/admin/board-digest`, { method: 'POST' });
    assert.equal(unauthorized.status, 401);

    await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'noi dung cong khai cho digest', captchaToken: 'dev-pass' })
    });

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' })
    });
    const loginBody = await login.json() as { data: { token: string } };

    const response = await fetch(`${baseUrl}/api/admin/board-digest`, {
      method: 'POST',
      headers: { authorization: `Bearer ${loginBody.data.token}` }
    });
    const body = await response.json() as {
      data: {
        label: string;
        bullets: unknown[];
        threadCount: number;
      };
    };
    assert.equal(response.status, 200);
    assert.equal(body.data.label, 'Nội dung do AI tổng hợp');
    assert.ok(Array.isArray(body.data.bullets));
    assert.equal(body.data.threadCount, 1);
  });
});
