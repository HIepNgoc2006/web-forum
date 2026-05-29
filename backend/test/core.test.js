import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createForumService } from '../src/core/forum-service.js';
import { createMemoryStore } from '../src/core/forum-store.js';
import { publicConfig } from '../src/core/config.js';
import { createAiClient, redactSensitiveText } from '../src/core/ai.js';
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

async function loadConfigWithEnv(env) {
  const keys = ['MAX_ACTIVE_THREADS_PER_BOARD', 'THREAD_BUMP_LIMIT', 'THREAD_REPLY_LIMIT'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) {
    if (Object.hasOwn(env, key)) {
      process.env[key] = env[key];
    } else {
      delete process.env[key];
    }
  }

  try {
    return await import(`../src/core/config.js?test=${Date.now()}-${Math.random()}`);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
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
  assert.equal(typeof config.lifecycle.maxActiveThreadsPerBoard, 'number');
  assert.equal(typeof config.lifecycle.bumpLimit, 'number');
  assert.equal(typeof config.lifecycle.replyLimit, 'number');
  assert.ok(config.lifecycle.maxActiveThreadsPerBoard >= 1);
  assert.ok(config.lifecycle.bumpLimit >= 1);
  assert.ok(config.lifecycle.replyLimit >= config.lifecycle.bumpLimit);
});

test('thread lifecycle config falls back to defaults for invalid env values', async () => {
  const { THREAD_LIFECYCLE, publicConfig: loadedPublicConfig } = await loadConfigWithEnv({
    MAX_ACTIVE_THREADS_PER_BOARD: '0',
    THREAD_BUMP_LIMIT: 'abc',
    THREAD_REPLY_LIMIT: '10.5'
  });

  assert.deepEqual(THREAD_LIFECYCLE, {
    maxActiveThreadsPerBoard: 150,
    bumpLimit: 300,
    replyLimit: 500
  });
  assert.equal(loadedPublicConfig().lifecycle, THREAD_LIFECYCLE);
});

test('thread lifecycle config raises reply limit to at least bump limit', async () => {
  const { THREAD_LIFECYCLE } = await loadConfigWithEnv({
    MAX_ACTIVE_THREADS_PER_BOARD: '25',
    THREAD_BUMP_LIMIT: '600',
    THREAD_REPLY_LIMIT: '400'
  });

  assert.equal(THREAD_LIFECYCLE.maxActiveThreadsPerBoard, 25);
  assert.equal(THREAD_LIFECYCLE.bumpLimit, 600);
  assert.equal(THREAD_LIFECYCLE.replyLimit, 600);
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

test('forum service does not send IP, captcha, poster token, or admin token to AI moderation', async () => {
  let capturedText = '';
  const ai = {
    async moderate(text) {
      capturedText = text;
      return { status: 'Safe', labels: [] };
    },
    async summarize() {
      return [];
    },
    async suggest() {
      return [];
    }
  };
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Chi gui noi dung bai viet',
    captchaToken: 'captcha-secret-token',
    ip: '203.0.113.77',
    posterToken: 'poster-secret-token',
    adminToken: 'admin-secret-token'
  });

  assert.equal(capturedText, 'Chi gui noi dung bai viet');
  assert.equal(capturedText.includes('203.0.113.77'), false);
  assert.equal(capturedText.includes('captcha-secret-token'), false);
  assert.equal(capturedText.includes('poster-secret-token'), false);
  assert.equal(capturedText.includes('admin-secret-token'), false);
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

test('thread image metadata is sanitized and returned with public thread data', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Anh metadata',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7',
    image: {
      name: 'ten\u0000anh.png',
      type: 'IMAGE/PNG',
      dataUrl: 'data:image/png;base64,AAAA',
      sizeBytes: '2048',
      width: '640.4',
      height: 999999
    }
  });
  const listed = await service.listThreads('hoc-tap');

  assert.deepEqual(created.thread.image, {
    name: 'tenanh.png',
    type: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
    sizeBytes: 2048,
    width: 640,
    height: 20000
  });
  assert.deepEqual(listed[0].image, created.thread.image);
});

test('invalid image metadata falls back to safe values', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Fallback metadata',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7',
    image: {
      name: 'fallback.jpg',
      type: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,AAAA',
      sizeBytes: 'not-a-number',
      width: -1,
      height: 0
    }
  });

  assert.equal(created.thread.image.sizeBytes, 3);
  assert.equal(Object.hasOwn(created.thread.image, 'width'), false);
  assert.equal(Object.hasOwn(created.thread.image, 'height'), false);
});

test('image filenames strip HTML-sensitive characters before storage', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Anh co ten nguy hiem',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7',
    image: {
      name: '<img src=x onerror=alert(1)>.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA'
    }
  });

  assert.equal(created.thread.image.name, 'img src=x onerror=alert(1).png');
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

test('moderation actions log AI decisions and admin reasons without private request data', async () => {
  const dates = [new Date('2026-05-22T08:00:00.000Z'), new Date('2026-05-22T08:01:00.000Z')];
  const service = createForumService({
    store: createMemoryStore(),
    ai: flaggedAi,
    realtime: createEvents(),
    now: () => dates.shift() ?? new Date('2026-05-22T08:01:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'tam-su',
    body: 'noi dung can xu ly',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9',
    posterToken: 'browser-secret-token'
  });
  await service.approvePending(created.thread.id, {
    reason: 'Hop le sau khi xem lai',
    actor: 'admin'
  });

  const actions = await service.listModerationActions(10);
  const serialized = JSON.stringify(actions);

  assert.equal(actions.length, 2);
  assert.equal(actions[0].action, 'admin:approve');
  assert.equal(actions[0].reason, 'Hop le sau khi xem lai');
  assert.equal(actions[0].actor, 'admin');
  assert.equal(actions[1].action, 'ai:moderate');
  assert.equal(actions[1].moderationLabels[0], 'Toxic');
  assert.equal(serialized.includes('203.0.113.9'), false);
  assert.equal(serialized.includes('dev-pass'), false);
  assert.equal(serialized.includes('browser-secret-token'), false);
});

test('deleting pending content stores admin reason in moderation log', async () => {
  const dates = [new Date('2026-05-22T08:00:00.000Z'), new Date('2026-05-22T08:01:00.000Z')];
  const service = createForumService({
    store: createMemoryStore(),
    ai: flaggedAi,
    realtime: createEvents(),
    now: () => dates.shift() ?? new Date('2026-05-22T08:01:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'tam-su',
    body: 'spam can xoa',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });
  await service.deletePending(created.thread.id, {
    reason: '<script>alert(1)</script>',
    actor: 'admin'
  });

  const actions = await service.listModerationActions(10);

  assert.equal(actions[0].action, 'admin:delete');
  assert.equal(actions[0].reason, '<script>alert(1)</script>');
  assert.equal(actions[0].postType, 'thread');
});

test('user reports store a reporter hash without raw IP or poster token', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });
  const created = await service.createThread({
    boardSlug: 'tam-su',
    body: 'Bai co the can bao cao',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });

  await service.reportPost({
    globalNumber: created.thread.globalNumber,
    reason: 'Co thong tin ca nhan',
    ip: '198.51.100.5',
    posterToken: 'reporter-secret'
  });
  const reports = await service.listReports(10);
  const serialized = JSON.stringify(reports);

  assert.equal(reports.length, 1);
  assert.equal(reports[0].postType, 'thread');
  assert.equal(reports[0].globalNumber, created.thread.globalNumber);
  assert.equal(reports[0].reason, 'Co thong tin ca nhan');
  assert.equal(typeof reports[0].reporterHash, 'string');
  assert.equal(serialized.includes('198.51.100.5'), false);
  assert.equal(serialized.includes('reporter-secret'), false);
});

test('archived threads are hidden from board list and visible in archive list', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore({
      version: 1,
      nextGlobalNumber: 2,
      threads: [
        {
          id: 'thread-archived',
          boardSlug: 'hoc-tap',
          body: 'Tai lieu cu',
          image: null,
          globalNumber: 1,
          posterHash: 'ID:ARCHIVE1',
          isPending: false,
          isDeleted: false,
          isArchived: true,
          archivedAt: '2026-05-22T09:00:00.000Z',
          archivedReason: 'manual',
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T08:00:00.000Z',
          bumpedAt: '2026-05-22T08:00:00.000Z'
        }
      ],
      comments: []
    }),
    ai: safeAi,
    realtime,
    now: () => new Date('2026-05-22T10:00:00.000Z')
  });

  const active = await service.listThreads('hoc-tap');
  const archive = await service.listArchivedThreads('hoc-tap');

  assert.equal(active.length, 0);
  assert.equal(archive.length, 1);
  assert.equal(archive[0].id, 'thread-archived');
  assert.equal(archive[0].isArchived, true);
  assert.equal(archive[0].archivedAt, '2026-05-22T09:00:00.000Z');
  assert.equal(archive[0].archivedReason, 'manual');
});

test('manual archive hides a thread from active board list', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread se archive',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  const archived = await service.archiveThread(created.thread.id, 'manual');
  const active = await service.listThreads('hoc-tap');
  const archive = await service.listArchivedThreads('hoc-tap');

  assert.equal(archived.isArchived, true);
  assert.equal(archived.archivedReason, 'manual');
  assert.equal(active.length, 0);
  assert.equal(archive.length, 1);
  assert.equal(archive[0].id, created.thread.id);
  assert.equal(realtime.events.at(-1).event, 'thread:archived');
});

test('archived threads reject new comments', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread da dong',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  await service.archiveThread(created.thread.id, 'manual');

  await assert.rejects(
    () =>
      service.createComment({
        threadId: created.thread.id,
        body: 'Binh luan muon',
        captchaToken: 'dev-pass',
        ip: '203.0.113.8'
      }),
    /Không tìm thấy chủ đề/
  );
});

test('board active thread cap archives oldest bumped thread', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: (() => {
      const dates = [
        new Date('2026-05-22T08:00:00.000Z'),
        new Date('2026-05-22T08:01:00.000Z')
      ];
      return () => dates.shift() ?? new Date('2026-05-22T08:02:00.000Z');
    })(),
    lifecycle: { maxActiveThreadsPerBoard: 1, bumpLimit: 300, replyLimit: 500 }
  });

  const first = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread cu',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  const second = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread moi',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8'
  });

  const active = await service.listThreads('hoc-tap');
  const archive = await service.listArchivedThreads('hoc-tap');

  assert.deepEqual(active.map((thread) => thread.id), [second.thread.id]);
  assert.deepEqual(archive.map((thread) => thread.id), [first.thread.id]);
  assert.equal(archive[0].archivedReason, 'board-limit');
  assert.equal(realtime.events.some((item) => item.event === 'thread:archived'), true);
});

test('bump limit allows replies but stops bumping after threshold', async () => {
  const realtime = createEvents();
  const dates = [
    new Date('2026-05-22T08:00:00.000Z'),
    new Date('2026-05-22T08:01:00.000Z'),
    new Date('2026-05-22T08:02:00.000Z')
  ];
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: () => dates.shift() ?? new Date('2026-05-22T08:03:00.000Z'),
    lifecycle: { maxActiveThreadsPerBoard: 150, bumpLimit: 1, replyLimit: 3 }
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread bump limit',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  await service.createComment({
    threadId: created.thread.id,
    body: 'Bump lan dau',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8'
  });
  await service.createComment({
    threadId: created.thread.id,
    body: 'Khong bump nua',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });

  const detail = await service.getThread(created.thread.id);
  assert.equal(detail.comments.length, 2);
  assert.equal(detail.thread.bumpedAt, '2026-05-22T08:01:00.000Z');
});

test('reply limit rejects extra comments', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z'),
    lifecycle: { maxActiveThreadsPerBoard: 150, bumpLimit: 300, replyLimit: 1 }
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread reply limit',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  await service.createComment({
    threadId: created.thread.id,
    body: 'Reply hop le',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8'
  });

  await assert.rejects(
    () =>
      service.createComment({
        threadId: created.thread.id,
        body: 'Reply bi chan',
        captchaToken: 'dev-pass',
        ip: '203.0.113.9'
      }),
    /Chủ đề đã đạt giới hạn phản hồi/
  );
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

test('hot boards count active public posts from the last 24 hours', async () => {
  const service = createForumService({
    store: createMemoryStore({
      version: 1,
      nextGlobalNumber: 8,
      threads: [
        {
          id: 'thread-hot',
          boardSlug: 'hoc-tap',
          body: 'Dang nong',
          image: null,
          globalNumber: 1,
          posterHash: 'ID:HOT',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T07:00:00.000Z',
          bumpedAt: '2026-05-22T08:00:00.000Z'
        },
        {
          id: 'thread-food',
          boardSlug: 'an-uong',
          body: 'Quan moi',
          image: null,
          globalNumber: 2,
          posterHash: 'ID:FOOD',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T06:00:00.000Z',
          bumpedAt: '2026-05-22T06:00:00.000Z'
        },
        {
          id: 'thread-old',
          boardSlug: 'random',
          body: 'Cu',
          image: null,
          globalNumber: 3,
          posterHash: 'ID:OLD',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-20T06:00:00.000Z',
          bumpedAt: '2026-05-20T06:00:00.000Z'
        },
        {
          id: 'thread-archived-hot',
          boardSlug: 'tam-su',
          body: 'Archived',
          image: null,
          globalNumber: 4,
          posterHash: 'ID:ARCHIVED',
          isPending: false,
          isDeleted: false,
          isArchived: true,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T07:00:00.000Z',
          bumpedAt: '2026-05-22T07:00:00.000Z'
        }
      ],
      comments: [
        {
          id: 'comment-hot-1',
          threadId: 'thread-hot',
          boardSlug: 'hoc-tap',
          body: 'Reply 1',
          globalNumber: 5,
          posterHash: 'ID:R1',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T08:00:00.000Z'
        },
        {
          id: 'comment-hot-2',
          threadId: 'thread-hot',
          boardSlug: 'hoc-tap',
          body: 'Reply 2',
          globalNumber: 6,
          posterHash: 'ID:R2',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T08:30:00.000Z'
        },
        {
          id: 'comment-pending',
          threadId: 'thread-food',
          boardSlug: 'an-uong',
          body: 'Pending',
          globalNumber: 7,
          posterHash: 'ID:PENDING',
          isPending: true,
          isDeleted: false,
          moderationStatus: 'Flagged',
          moderationLabels: ['Spam'],
          createdAt: '2026-05-22T08:45:00.000Z'
        }
      ]
    }),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T09:00:00.000Z')
  });

  const hotBoards = await service.listHotBoards(5);

  assert.deepEqual(hotBoards, [
    {
      boardSlug: 'hoc-tap',
      postCountLast24h: 3,
      threadCountLast24h: 1,
      replyCountLast24h: 2,
      latestActivityAt: '2026-05-22T08:30:00.000Z'
    },
    {
      boardSlug: 'an-uong',
      postCountLast24h: 1,
      threadCountLast24h: 1,
      replyCountLast24h: 0,
      latestActivityAt: '2026-05-22T06:00:00.000Z'
    }
  ]);
});

test('jwt verification rejects tampered tokens', () => {
  const token = signJwt({ role: 'admin' }, 'secret', { expiresInSeconds: 60 });
  const verified = verifyJwt(token, 'secret');

  assert.equal(verified.role, 'admin');
  assert.throws(() => verifyJwt(`${token.slice(0, -1)}x`, 'secret'), /Invalid token/);
});
