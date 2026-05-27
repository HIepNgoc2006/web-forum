import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createForumService } from '../src/core/forum-service.js';
import { createMemoryStore } from '../src/core/forum-store.js';
import { publicConfig } from '../src/core/config.js';
import { createAiClient } from '../src/core/ai.js';
import { createPosterHash, signJwt, verifyJwt } from '../src/core/security.js';
import { parsePostText, sanitizeText } from '../src/core/text-format.js';

const safeAi = {
  async moderate() {
    return { status: 'Safe', labels: [] };
  },
  async summarize() {
    return ['Y chinh 1', 'Y chinh 2', 'Y chinh 3'];
  },
  async suggest() {
    return ['Dong y co dieu kien', 'Can them bang chung'];
  }
};

const flaggedAi = {
  async moderate() {
    return { status: 'Flagged', labels: ['Toxic'] };
  },
  async summarize() {
    return [];
  },
  async suggest() {
    return [];
  }
};

function createEvents() {
  const events = [];
  return {
    events,
    publish(event, payload) {
      events.push({ event, payload });
    }
  };
}

test('sanitizeText escapes HTML while preserving plain text', () => {
  const result = sanitizeText('<img src=x onerror=alert(1)> hello');

  assert.equal(result.includes('<img'), false);
  assert.equal(result, '&lt;img src=x onerror=alert(1)&gt; hello');
});

test('publicConfig exposes grouped fixed boards for the home portal', () => {
  const config = publicConfig();
  const confession = config.boards.find((board) => board.slug === 'confession');

  assert.ok(config.boardGroups.length >= 4);
  assert.equal(confession.name, 'Thú nhận');
  assert.equal(confession.category, 'Trường học');
  assert.equal(confession.path, '/confession/');
});

test('parsePostText marks greentext lines and post references', () => {
  const result = parsePostText('normal\n> campus lore\nreply to >>12');

  assert.equal(result[0].type, 'text');
  assert.equal(result[1].type, 'greentext');
  assert.deepEqual(result[2].refs, [12]);
});

test('AI summary and suggestions require Google AI Studio key', async () => {
  const originalKey = process.env.GOOGLE_AI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  try {
    const ai = createAiClient();

    await assert.rejects(() => ai.summarize([{ body: 'sdfsdf' }]), /GOOGLE_AI_API_KEY/);
    await assert.rejects(() => ai.suggest([{ body: 'sdfsdf' }]), /GOOGLE_AI_API_KEY/);
  } finally {
    if (originalKey === undefined) {
      delete process.env.GOOGLE_AI_API_KEY;
    } else {
      process.env.GOOGLE_AI_API_KEY = originalKey;
    }
  }
});

test('AI summary sends a system prompt to Google AI Studio', async () => {
  const originalKey = process.env.GOOGLE_AI_API_KEY;
  const originalFetch = global.fetch;
  let capturedBody;
  process.env.GOOGLE_AI_API_KEY = 'test-key';
  global.fetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [{ text: '- Ý chính 1\n- Ý chính 2\n- Ý chính 3' }]
              }
            }
          ]
        };
      }
    };
  };

  try {
    const ai = createAiClient();
    const result = await ai.summarize([{ body: 'Bài viết công khai' }]);

    assert.deepEqual(result, ['Ý chính 1', 'Ý chính 2', 'Ý chính 3']);
    assert.equal(capturedBody.systemInstruction.parts[0].text.includes('36chan'), true);
    assert.equal(capturedBody.systemInstruction.parts[0].text.includes('3-5 gạch đầu dòng'), true);
    assert.equal(capturedBody.contents[0].parts[0].text.includes('Bài viết công khai'), true);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.GOOGLE_AI_API_KEY;
    } else {
      process.env.GOOGLE_AI_API_KEY = originalKey;
    }
  }
});

test('createPosterHash is stable per poster in a thread/day but changes by poster token', () => {
  const first = createPosterHash({
    ip: '203.0.113.7',
    threadId: 'thread-a',
    salt: '2026-05-22',
    posterToken: 'browser-a'
  });
  const second = createPosterHash({
    ip: '203.0.113.7',
    threadId: 'thread-a',
    salt: '2026-05-22',
    posterToken: 'browser-a'
  });
  const otherPoster = createPosterHash({
    ip: '203.0.113.7',
    threadId: 'thread-a',
    salt: '2026-05-22',
    posterToken: 'browser-b'
  });

  assert.equal(first, second);
  assert.notEqual(first, otherPoster);
});

test('safe thread is public, gets global number, and emits realtime event', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const result = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Xin tips qua mon',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  const threads = await service.listThreads('hoc-tap');

  assert.equal(result.thread.isPending, false);
  assert.equal(result.thread.globalNumber, 1);
  assert.equal(threads.length, 1);
  assert.equal(realtime.events[0].event, 'thread:created');
});

test('flagged thread is quarantined until admin approval', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore(),
    ai: flaggedAi,
    realtime,
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'tam-su',
    body: 'noi dung can kiem duyet',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });
  const publicThreads = await service.listThreads('tam-su');
  const pending = await service.listPending();

  assert.equal(created.thread.isPending, true);
  assert.equal(publicThreads.length, 0);
  assert.equal(pending.length, 1);

  const approved = await service.approvePending(created.thread.id);
  const visibleThreads = await service.listThreads('tam-su');

  assert.equal(approved.isPending, false);
  assert.equal(visibleThreads.length, 1);
  assert.equal(realtime.events.at(-1).event, 'thread:created');
});

test('safe comments bump thread and remain hidden when flagged', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: (() => {
      const dates = [
        new Date('2026-05-22T08:00:00.000Z'),
        new Date('2026-05-22T08:03:00.000Z')
      ];
      return () => dates.shift() ?? new Date('2026-05-22T08:03:00.000Z');
    })()
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread dau',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  const comment = await service.createComment({
    threadId: created.thread.id,
    body: 'Binh luan moi',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7',
    posterToken: 'browser-b'
  });
  const detail = await service.getThread(created.thread.id);

  assert.equal(comment.comment.globalNumber, 2);
  assert.notEqual(created.thread.posterHash, comment.comment.posterHash);
  assert.equal(detail.comments.length, 1);
  assert.equal(detail.thread.bumpedAt, '2026-05-22T08:03:00.000Z');
  assert.equal(realtime.events.at(-1).event, 'thread:bumped');
});

test('latest posts returns public threads and comments newest first', async () => {
  const store = createMemoryStore();
  const realtime = createEvents();
  const dates = [
    new Date('2026-05-22T08:00:00.000Z'),
    new Date('2026-05-22T08:03:00.000Z'),
    new Date('2026-05-22T08:05:00.000Z')
  ];
  const service = createForumService({
    store,
    ai: safeAi,
    realtime,
    now: () => dates.shift() ?? new Date('2026-05-22T08:05:00.000Z')
  });
  const flaggedService = createForumService({
    store,
    ai: flaggedAi,
    realtime,
    now: () => new Date('2026-05-22T08:06:00.000Z')
  });

  const thread = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread cong khai',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  await service.createComment({
    threadId: thread.thread.id,
    body: 'Binh luan cong khai',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8'
  });
  await flaggedService.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread dang cho duyet',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });

  const latest = await service.listLatestPosts(10);

  assert.equal(latest.length, 2);
  assert.deepEqual(
    latest.map((post) => [post.type, post.globalNumber]),
    [
      ['comment', 2],
      ['thread', 1]
    ]
  );
  assert.equal(latest[0].threadId, thread.thread.id);
  assert.equal(latest[0].bodyLines[0].text, 'Binh luan cong khai');
});

test('jwt verification rejects tampered tokens', () => {
  const token = signJwt({ role: 'admin' }, 'secret', { expiresInSeconds: 60 });
  const verified = verifyJwt(token, 'secret');

  assert.equal(verified.role, 'admin');
  assert.throws(() => verifyJwt(`${token.slice(0, -1)}x`, 'secret'), /Invalid token/);
});
