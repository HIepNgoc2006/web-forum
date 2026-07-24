import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { createForumService } from '../src/core/forum-service.ts';
import { createMemoryStore } from '../src/core/forum-store.ts';
import { createHttpServer } from '../src/server/http-app.ts';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type CapturedAnswer = {
  question: string;
  context: string;
  history: ChatMessage[];
};

type JsonResponse = {
  data?: {
    answer?: string;
    context?: {
      scope?: string;
      label?: string;
    };
    sources?: Array<{
      kind?: string;
      label?: string;
      href?: string;
      threadId?: string;
      globalNumber?: number;
    }>;
    followUps?: string[];
  };
  error?: {
    message?: string;
  };
};

function createCapturingAi() {
  const answers: CapturedAnswer[] = [];
  return {
    answers,
    async moderate(text: string) {
      return text.includes('PENDING_ONLY')
        ? { status: 'Flagged' as const, labels: ['Spam'] }
        : { status: 'Safe' as const, labels: [] };
    },
    async answer(question: string, context: string, history: ChatMessage[] = []) {
      answers.push({ question, context, history });
      return 'Câu trả lời có căn cứ.';
    }
  };
}

async function readJson(response: Response): Promise<JsonResponse> {
  return response.json() as Promise<JsonResponse>;
}

async function withChatServer(
  callback: (
    baseUrl: string,
    fixtures: {
      ai: ReturnType<typeof createCapturingAi>;
      service: ReturnType<typeof createForumService>;
      store: ReturnType<typeof createMemoryStore>;
    }
  ) => Promise<void>
) {
  const ai = createCapturingAi();
  const store = createMemoryStore();
  const realtime = { publish() {}, count: () => 0 };
  const service = createForumService({
    store,
    ai,
    realtime,
    now: () => new Date('2026-07-16T08:00:00.000Z')
  } as Parameters<typeof createForumService>[0]);
  const server = createHttpServer({
    service,
    realtime,
    jwtSecret: 'test-jwt-secret',
    adminUsername: 'admin',
    adminPassword: 'pass'
  } as Parameters<typeof createHttpServer>[0]);

  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${port}`, { ai, service, store });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('POST /api/ai/chat grounds a thread answer in redacted public context', async () => {
  await withChatServer(async (baseUrl, { ai, service }) => {
    const created = await service.createThread({
      boardSlug: 'hoc-tap',
      subject: 'Lịch học tuần này',
      body: 'THREAD_PUBLIC_MARKER liên hệ student@example.com hoặc 0901234567',
      captchaToken: 'thread-captcha-secret',
      ip: '203.0.113.20',
      posterToken: 'thread-poster-secret'
    } as Parameters<typeof service.createThread>[0]);
    await service.createComment({
      threadId: created.thread.id,
      body: 'THREAD_REPLY_MARKER: lịch được chuyển sang thứ sáu.',
      captchaToken: 'comment-captcha-secret',
      ip: '203.0.113.21',
      posterToken: 'comment-poster-secret'
    } as Parameters<typeof service.createComment>[0]);

    const history: ChatMessage[] = [
      { role: 'user', content: 'Trước đó chúng ta đang nói về lịch học.' },
      { role: 'assistant', content: 'Đúng, mình sẽ bám vào nội dung công khai.' }
    ];
    const response = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.88'
      },
      body: JSON.stringify({
        question: 'Thread này thống nhất lịch học vào ngày nào?',
        scope: 'thread',
        threadId: created.thread.id,
        history,
        posterToken: 'route-poster-secret'
      })
    });
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body.data ?? {}).sort(), ['answer', 'context', 'followUps', 'sources']);
    assert.equal(body.data?.answer, 'Câu trả lời có căn cứ.');
    assert.equal(body.data?.context?.scope, 'thread');
    assert.equal(typeof body.data?.context?.label, 'string');
    assert.notEqual(body.data?.context?.label, '');
    assert.ok(Array.isArray(body.data?.sources));
    assert.ok((body.data?.sources?.length ?? 0) >= 2);
    assert.ok(Array.isArray(body.data?.followUps));
    assert.ok((body.data?.followUps?.length ?? 0) >= 1);
    assert.ok(
      body.data?.sources?.every(
        (source) => typeof source.href === 'string' && source.href.startsWith('#thread/')
      )
    );
    assert.ok(body.data?.sources?.some((source) => String(source.href).includes('?p=')));

    assert.equal(ai.answers.length, 1);
    const captured = ai.answers[0];
    assert.equal(captured.question, 'Thread này thống nhất lịch học vào ngày nào?');
    assert.deepEqual(captured.history, history);
    assert.match(captured.context, /THREAD_PUBLIC_MARKER/);
    assert.match(captured.context, /THREAD_REPLY_MARKER/);
    assert.match(captured.context, /#thread\//);
    assert.match(captured.context, /chi tiết:/);
    assert.equal(captured.context.includes('student@example.com'), false);
    assert.equal(captured.context.includes('0901234567'), false);
    assert.match(captured.context, /\[email da an\]/);
    assert.match(captured.context, /\[so dien thoai da an\]/);

    const providerPayload = JSON.stringify(captured);
    for (const secret of [
      '198.51.100.88',
      '203.0.113.20',
      '203.0.113.21',
      'route-poster-secret',
      'thread-poster-secret',
      'comment-poster-secret',
      'thread-captcha-secret',
      'comment-captcha-secret'
    ]) {
      assert.equal(providerPayload.includes(secret), false, `${secret} leaked to the AI provider`);
    }
  });
});

test('POST /api/ai/chat site context excludes hidden, pending, deleted, and private data', async () => {
  await withChatServer(async (baseUrl, { ai, service, store }) => {
    const visible = await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'VISIBLE_SITE_MARKER nội dung được phép dùng để trả lời.',
      captchaToken: 'dev-pass',
      ip: '203.0.113.30',
      posterToken: 'visible-poster-secret'
    } as Parameters<typeof service.createThread>[0]);
    await service.createThread({
      boardSlug: 'tam-su',
      body: 'HIDDEN_BOARD_MARKER không được gửi cho AI.',
      captchaToken: 'dev-pass',
      ip: '203.0.113.31'
    } as Parameters<typeof service.createThread>[0]);
    await service.updateBoard('tam-su', { isHidden: true }, { actor: 'admin' });
    await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'PENDING_ONLY PENDING_MARKER không được gửi cho AI.',
      captchaToken: 'dev-pass',
      ip: '203.0.113.32'
    } as Parameters<typeof service.createThread>[0]);
    const deleted = await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'DELETED_MARKER không được gửi cho AI.',
      captchaToken: 'dev-pass',
      ip: '203.0.113.33'
    } as Parameters<typeof service.createThread>[0]);

    const state = await store.read();
    const visibleRecord = state.threads.find((thread) => thread.id === visible.thread.id);
    const deletedRecord = state.threads.find((thread) => thread.id === deleted.thread.id);
    assert.ok(visibleRecord);
    assert.ok(deletedRecord);
    deletedRecord.isDeleted = true;
    deletedRecord.deletedAt = '2026-07-16T08:01:00.000Z';
    Object.assign(visibleRecord, {
      ip: '198.51.100.77',
      posterToken: 'stored-poster-secret',
      captchaToken: 'stored-captcha-secret',
      adminToken: 'stored-admin-secret'
    });
    await store.write(state);

    const response = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.99'
      },
      body: JSON.stringify({
        question: 'Trang đang có nội dung công khai nào?',
        scope: 'site',
        posterToken: 'site-route-poster-secret'
      })
    });
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.data?.context?.scope, 'site');
    assert.equal(ai.answers.length, 1);
    assert.match(ai.answers[0].context, /VISIBLE_SITE_MARKER/);

    const providerPayload = JSON.stringify(ai.answers[0]);
    for (const excluded of [
      'HIDDEN_BOARD_MARKER',
      'PENDING_MARKER',
      'DELETED_MARKER',
      '198.51.100.77',
      '198.51.100.99',
      '203.0.113.30',
      'stored-poster-secret',
      'stored-captcha-secret',
      'stored-admin-secret',
      'visible-poster-secret',
      'site-route-poster-secret'
    ]) {
      assert.equal(providerPayload.includes(excluded), false, `${excluded} leaked to the AI provider`);
    }
  });
});

test('POST /api/ai/chat includes quote links, attachments, post links, and similar threads', async () => {
  await withChatServer(async (baseUrl, { ai, service, store }) => {
    const primary = await service.createThread({
      boardSlug: 'hoc-tap',
      subject: 'Ôn thi cuối kỳ toán rời rạc',
      body: 'PRIMARY_THREAD_MARKER chia sẻ đề cương ôn thi cuối kỳ toán rời rạc cho sinh viên. https://example.com/de-cuong',
      captchaToken: 'dev-pass',
      ip: '203.0.113.40',
      posterToken: 'primary-poster'
    } as Parameters<typeof service.createThread>[0]);
    const similar = await service.createThread({
      boardSlug: 'hoc-tap',
      subject: 'Đề cương toán rời rạc cuối kỳ',
      body: 'SIMILAR_THREAD_MARKER cũng bàn đề cương ôn thi cuối kỳ toán rời rạc cho sinh viên.',
      captchaToken: 'dev-pass',
      ip: '203.0.113.41',
      posterToken: 'similar-poster'
    } as Parameters<typeof service.createThread>[0]);
    const quoted = await service.createComment({
      threadId: primary.thread.id,
      body: 'QUOTE_TARGET_MARKER đây là mốc lịch ôn tập.',
      captchaToken: 'dev-pass',
      ip: '203.0.113.42',
      posterToken: 'quote-poster'
    } as Parameters<typeof service.createComment>[0]);
    await service.createComment({
      threadId: primary.thread.id,
      body: `REPLY_WITH_QUOTE >>${quoted.comment.globalNumber} mình đồng ý với mốc này.`,
      captchaToken: 'dev-pass',
      ip: '203.0.113.43',
      posterToken: 'reply-poster'
    } as Parameters<typeof service.createComment>[0]);

    const state = await store.read();
    const primaryRecord = state.threads.find((thread) => thread.id === primary.thread.id);
    assert.ok(primaryRecord);
    primaryRecord.images = [
      {
        name: 'de-cuong.png',
        type: 'image/png',
        storage: 'local',
        storageKey: 'test/de-cuong.png',
        url: '/uploads/test/de-cuong.png'
      }
    ];
    primaryRecord.image = primaryRecord.images[0];
    primaryRecord.links = [
      {
        url: 'https://example.com/de-cuong',
        domain: 'example.com',
        kind: 'og',
        title: 'Đề cương mẫu'
      }
    ];
    await store.write(state);

    const response = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'Tìm chủ đề tương tự và tóm tắt trích dẫn cùng file đính kèm.',
        scope: 'thread',
        threadId: primary.thread.id,
        posterToken: 'chat-poster'
      })
    });
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(ai.answers.length, 1);
    const context = ai.answers[0].context;
    assert.match(context, new RegExp(`#thread/${primary.thread.id}`));
    assert.match(context, /de-cuong\.png/);
    assert.match(context, /đính kèm:/);
    assert.match(context, /trích dẫn >>/);
    assert.match(context, /example\.com/);
    assert.match(context, /Chủ đề công khai tương tự/);
    assert.match(context, new RegExp(`#thread/${similar.thread.id}`));
    assert.match(context, /QUOTE_TARGET_MARKER|REPLY_WITH_QUOTE/);

    assert.ok(body.data?.sources?.some((source) => source.kind === 'similar'));
    assert.ok(
      body.data?.sources?.some(
        (source) => source.href === `#thread/${encodeURIComponent(similar.thread.id)}`
      )
    );
    assert.ok(
      body.data?.sources?.some(
        (source) =>
          source.href ===
          `#thread/${encodeURIComponent(primary.thread.id)}?p=${encodeURIComponent(String(primary.thread.globalNumber))}`
      )
    );
  });
});

test('POST /api/ai/chat validates question length, scope, identifiers, and JSON body size', async () => {
  await withChatServer(async (baseUrl, { ai }) => {
    const cases = [
      {
        name: 'empty question',
        payload: { question: '   ', scope: 'site' },
        status: 400
      },
      {
        name: 'question over 1000 characters',
        payload: { question: 'x'.repeat(1001), scope: 'site' },
        status: 400
      },
      {
        name: 'missing board slug',
        payload: { question: 'Bảng này có gì?', scope: 'board' },
        status: 400
      },
      {
        name: 'missing thread id',
        payload: { question: 'Thread này có gì?', scope: 'thread' },
        status: 400
      },
      {
        name: 'invalid scope',
        payload: { question: 'Có gì?', scope: 'admin' },
        status: 400
      }
    ];

    for (const entry of cases) {
      const response = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry.payload)
      });
      const body = await readJson(response);
      assert.equal(response.status, entry.status, entry.name);
      assert.equal(typeof body.error?.message, 'string', entry.name);
    }

    const oversizedBody = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'x'.repeat(21_000), scope: 'site' })
    });
    assert.equal(oversizedBody.status, 413);
    assert.equal((await readJson(oversizedBody)).error?.message, 'Dữ liệu gửi lên quá lớn');
    assert.equal(ai.answers.length, 0);
  });
});
