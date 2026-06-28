import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import mongoose from 'mongoose';

import { createForumService } from '../src/core/forum-service.js';
import { createMemoryStore } from '../src/core/forum-store.js';
import { createS3ImageStorage } from '../src/core/image-storage.js';
import { migrateInlineImages } from '../src/core/image-migration.js';
import { appendMongoPostCreate, createMongoModels } from '../src/core/mongo-store.js';
import { publicBoardConfig, publicConfig } from '../src/core/config.js';
import { createAiClient, redactSensitiveText } from '../src/core/ai.js';
import {
  createRateLimitStoreFromEnv,
  createRedisRateLimitStore,
  normalizeRateLimitFailureMode
} from '../src/core/rate-limit-store.js';
import {
  assertProductionSecrets,
  createModerationFingerprint,
  createPosterHash,
  createPosterProofHash,
  createRateLimiter,
  createTripcode,
  securityConfigStatus,
  signJwt,
  verifyHcaptcha,
  verifyJwt
} from '../src/core/security.js';
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
  },
  async rewrite(text, tone = 'neutral') {
    return `Da sua [${tone}]: ${text}`;
  },
  async summarizeReports(reasons) {
    return `AI tong hop: ${reasons.join(', ')}`;
  },
  async translate(text, targetLang = 'vi') {
    return `Da dich [${targetLang}]: ${text}`;
  },
  async transcribe(media) {
    return `Da go bang: ${media.mimeType ?? 'audio'}`;
  },
  async caption(media, mode = 'describe') {
    return `Da mo ta [${mode}]: ${media.mimeType ?? 'image'}`;
  },
  async speak(text) {
    return { data: Buffer.from(`audio:${text}`).toString('base64'), mimeType: 'audio/mpeg' };
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
  const keys = ['MAX_ACTIVE_THREADS_PER_BOARD', 'THREAD_BUMP_LIMIT', 'THREAD_REPLY_LIMIT', 'AI_MODERATION_QUEUE_CONFIDENCE_THRESHOLD'];
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
  const deadlineWeek = config.boards.find((board) => board.slug === 'deadline-week');

  assert.ok(config.boardGroups.length >= 4);
  assert.equal(confession.name, 'Thú nhận');
  assert.equal(confession.category, 'Trường học');
  assert.equal(confession.path, '/confession/');
  assert.ok(confession.rules.length >= 2);
  assert.equal(confession.rules[0], confession.description);
  assert.equal(confession.banner.text.includes(confession.name.toLowerCase()), true);
  assert.equal(Object.hasOwn(confession.banner, 'imageUrl'), false);
  assert.equal(confession.retentionPolicy.publicArchive, true);
  assert.equal(typeof confession.retentionPolicy.maxActiveThreadsPerBoard, 'number');
  assert.equal(deadlineWeek.temporary, true);
  assert.equal(deadlineWeek.category, 'Sự kiện tạm thời');
  assert.equal(config.boardGroups.some((group) => group.name === 'Sự kiện tạm thời'), true);
  assert.equal(typeof config.lifecycle.maxActiveThreadsPerBoard, 'number');
  assert.equal(typeof config.lifecycle.bumpLimit, 'number');
  assert.equal(typeof config.lifecycle.replyLimit, 'number');
  assert.ok(config.lifecycle.maxActiveThreadsPerBoard >= 1);
  assert.ok(config.lifecycle.bumpLimit >= 1);
  assert.ok(config.lifecycle.replyLimit >= config.lifecycle.bumpLimit);
  assert.equal(config.ai.provider, 'google-ai-studio');
  assert.equal(typeof config.ai.configured, 'boolean');
  assert.equal(typeof config.ai.model, 'string');
});

test('publicBoardConfig sanitizes board presentation and falls back safely', () => {
  const board = publicBoardConfig({
    slug: 'test',
    path: '/test/',
    name: 'Test <img>',
    category: 'Debug',
    description: 'Default <script>alert(1)</script> board',
    rules: ['Allow text only <b>please</b>', '<img src=x onerror=alert(1)>'],
    banner: {
      text: 'Banner <marquee>text</marquee>',
      imageUrl: 'javascript:alert(1)',
      altText: 'Alt <b>text</b>'
    }
  });

  assert.equal(board.name, 'Test');
  assert.equal(board.description, 'Default alert(1) board');
  assert.deepEqual(board.rules, ['Allow text only please']);
  assert.equal(board.banner.text, 'Banner text');
  assert.equal(Object.hasOwn(board.banner, 'imageUrl'), false);

  const fallbackBoard = publicBoardConfig({
    slug: 'fallback',
    path: '/fallback/',
    name: 'Fallback',
    category: 'Debug',
    description: 'Use this as rule text.'
  });

  assert.equal(fallbackBoard.rules[0], 'Use this as rule text.');
  assert.equal(fallbackBoard.banner.text.includes('fallback'), true);
});

test('mongo store declares production persistence models without opening a connection', async () => {
  const connection = mongoose.createConnection();
  try {
    const models = createMongoModels(connection);

    assert.deepEqual(
      Object.keys(models).sort(),
      [
        'AiSummaryCache',
        'AiUsage',
        'Appeal',
        'Board',
        'Comment',
        'ModerationAction',
        'Report',
        'Sanction',
        'StateMeta',
        'Thread',
        'User'
      ].sort()
    );
    assert.equal(models.Board.schema.path('slug').options.required, true);
    assert.equal(models.Thread.collection.name, 'threads');
    assert.equal(models.Comment.collection.name, 'comments');
    assert.equal(models.User.collection.name, 'users');
    assert.equal(models.ModerationAction.collection.name, 'moderationActions');
    assert.equal(models.Report.collection.name, 'reports');
    assert.equal(models.Appeal.collection.name, 'appeals');
    assert.equal(models.User.schema.indexes().some(([fields]) => fields.username === 1), true);
  } finally {
    await connection.destroy();
  }
});

test('mongo append post create uses targeted inserts and updates', async () => {
  const calls = [];
  const model = (name) => ({
    collection: {
      async insertOne(document) {
        calls.push({ model: name, method: 'insertOne', id: document.id });
      },
      async insertMany(documents, options) {
        calls.push({ model: name, method: 'insertMany', ids: documents.map((document) => document.id), options });
      }
    },
    async bulkWrite(operations, options) {
      calls.push({ model: name, method: 'bulkWrite', operations, options });
    }
  });
  const stateMetaCalls = [];
  const models = {
    Thread: model('Thread'),
    Comment: model('Comment'),
    ModerationAction: model('ModerationAction'),
    StateMeta: {
      async updateOne(filter, update, options) {
        stateMetaCalls.push({ filter, update, options });
      }
    }
  };
  const createdThread = { id: 'thread-new', boardSlug: 'hoc-tap', body: 'Chu de', globalNumber: 1 };
  const archivedThread = {
    id: 'thread-old',
    boardSlug: 'hoc-tap',
    body: 'Cu',
    globalNumber: 2,
    isArchived: true,
    archivedAt: '2026-06-22T00:00:00.000Z'
  };
  const moderationAction = { id: 'mod-1', postId: 'thread-new', action: 'ai:moderate' };

  await appendMongoPostCreate(models, {
    state: {
      nextGlobalNumber: 3,
      threads: [createdThread, archivedThread],
      moderationActions: [moderationAction],
      adminSettings: { moderationConfidenceThreshold: 0.7 }
    },
    thread: createdThread,
    updatedThreads: [createdThread, archivedThread],
    moderationActions: [moderationAction]
  });

  assert.deepEqual(calls[0], { model: 'Thread', method: 'insertOne', id: 'thread-new' });
  assert.deepEqual(calls[1], { model: 'ModerationAction', method: 'insertOne', id: 'mod-1' });
  assert.equal(calls[2].model, 'Thread');
  assert.equal(calls[2].method, 'bulkWrite');
  assert.deepEqual(calls[2].operations, [
    {
      updateOne: {
        filter: { id: 'thread-old' },
        update: { $set: archivedThread }
      }
    }
  ]);
  assert.deepEqual(calls[2].options, { ordered: true });
  assert.deepEqual(stateMetaCalls, [
    {
      filter: { _id: 'global' },
      update: {
        $set: {
          version: 1,
          nextGlobalNumber: 3,
          adminSettings: { moderationConfidenceThreshold: 0.7 }
        }
      },
      options: { upsert: true }
    }
  ]);
});

test('forum service uses targeted post create store hook when available', async () => {
  const memory = createMemoryStore();
  const appendCalls = [];
  const store = {
    async read() {
      return memory.read();
    },
    async write() {
      throw new Error('full write should not be used for post creates');
    },
    async appendPostCreate(delta) {
      appendCalls.push(delta);
      await memory.write(delta.state);
    }
  };
  const service = createForumService({
    store,
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-06-22T00:00:00.000Z')
  });

  const thread = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Chu de dung targeted append',
    captchaToken: 'dev-pass',
    ip: '203.0.113.10'
  });
  const comment = await service.createComment({
    threadId: thread.thread.id,
    body: 'Tra loi dung targeted append',
    captchaToken: 'dev-pass',
    ip: '203.0.113.11'
  });

  assert.equal(appendCalls.length, 2);
  assert.equal(appendCalls[0].thread.id, thread.thread.id);
  assert.equal(appendCalls[0].comment, undefined);
  assert.equal(appendCalls[0].moderationActions.length, 1);
  assert.equal(appendCalls[1].comment.id, comment.comment.id);
  assert.equal(appendCalls[1].thread, undefined);
  assert.deepEqual(appendCalls[1].updatedThreads.map((item) => item.id), [thread.thread.id]);
});

test('forum service health reports unavailable store without leaking connection details', async () => {
  const store = {
    type: 'mongo',
    async read() {
      throw new Error('mongodb://user:secret@example.test/36chan');
    },
    async health() {
      throw new Error('MONGODB_URI=mongodb://user:secret@example.test/36chan');
    }
  };
  const service = createForumService({
    store,
    ai: safeAi,
    now: () => new Date('2026-06-04T00:00:00.000Z')
  });

  const health = await service.getHealth();
  const serialized = JSON.stringify(health);

  assert.equal(health.status, 'degraded');
  assert.equal(health.store.type, 'mongo');
  assert.equal(health.store.configured, true);
  assert.equal(health.store.ready, false);
  assert.equal(health.store.error, 'unavailable');
  assert.equal(health.imageStorage.ready, true);
  assert.equal(serialized.includes('mongodb://'), false);
  assert.equal(serialized.includes('MONGODB_URI'), false);
  assert.equal(serialized.includes('secret'), false);
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

test('moderation confidence threshold config defaults safely and clamps values', async () => {
  const { readModerationConfidenceThreshold } = await loadConfigWithEnv({});

  assert.equal(readModerationConfidenceThreshold('invalid'), 0);
  assert.equal(readModerationConfidenceThreshold('80'), 0.8);
  assert.equal(readModerationConfidenceThreshold('200'), 1);
});

test('parsePostText marks greentext lines and post references', () => {
  const result = parsePostText('normal\n> campus lore\nreply to >>12');

  assert.equal(result[0].type, 'text');
  assert.equal(result[1].type, 'greentext');
  assert.deepEqual(result[2].refs, [12]);
});

test('AI summary, suggestions and safe rewrite require Google AI Studio key', async () => {
  const originalKey = process.env.GOOGLE_AI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  try {
    const ai = createAiClient();

    await assert.rejects(() => ai.summarize([{ body: 'sdfsdf' }]), /GOOGLE_AI_API_KEY/);
    await assert.rejects(() => ai.suggest([{ body: 'sdfsdf' }]), /GOOGLE_AI_API_KEY/);
    await assert.rejects(() => ai.rewrite('Email a@example.com'), /GOOGLE_AI_API_KEY/);
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

test('AI local moderation flags unverified accusations as Fake News', async () => {
  const originalKey = process.env.GOOGLE_AI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  try {
    const ai = createAiClient();
    const result = await ai.moderate('Tin đồn chưa kiểm chứng: bạn A lừa đảo tiền câu lạc bộ');

    assert.equal(result.status, 'Flagged');
    assert.equal(result.labels.includes('Fake News'), true);
  } finally {
    if (originalKey === undefined) {
      delete process.env.GOOGLE_AI_API_KEY;
    } else {
      process.env.GOOGLE_AI_API_KEY = originalKey;
    }
  }
});

test('AI moderation prompt supports PII Risk and redacts private data before Google AI', async () => {
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
                parts: [{ text: '{"status":"Flagged","labels":["PII Risk"]}' }]
              }
            }
          ]
        };
      }
    };
  };

  try {
    const ai = createAiClient();
    const result = await ai.moderate('Email bạn ấy là a@example.com, số 0912345678, MSSV B2012345');
    const prompt = capturedBody.contents[0].parts[0].text;

    assert.deepEqual(result, { status: 'Flagged', labels: ['PII Risk'] });
    assert.equal(capturedBody.systemInstruction.parts[0].text.includes('PII Risk'), true);
    assert.equal(prompt.includes('a@example.com'), false);
    assert.equal(prompt.includes('0912345678'), false);
    assert.equal(prompt.includes('B2012345'), false);
    assert.equal(prompt.includes('[email da an]'), true);
    assert.equal(prompt.includes('[so dien thoai da an]'), true);
    assert.equal(prompt.includes('[ma sinh vien da an]'), true);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.GOOGLE_AI_API_KEY;
    } else {
      process.env.GOOGLE_AI_API_KEY = originalKey;
    }
  }
});

test('AI suggestions use draft-only prompt and redact private data', async () => {
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
                parts: [{ text: '- Mình nghĩ nên hỏi thêm nguồn.\n- Đừng chia sẻ thông tin cá nhân.' }]
              }
            }
          ]
        };
      }
    };
  };

  try {
    const ai = createAiClient();
    const result = await ai.suggest([{ body: 'Liên hệ qua 0987654321 để biết thêm' }]);
    const prompt = capturedBody.contents[0].parts[0].text;

    assert.deepEqual(result, ['Mình nghĩ nên hỏi thêm nguồn.', 'Đừng chia sẻ thông tin cá nhân.']);
    assert.equal(capturedBody.systemInstruction.parts[0].text.includes('bản nháp'), true);
    assert.equal(capturedBody.systemInstruction.parts[0].text.includes('2-3 câu'), true);
    assert.equal(prompt.includes('0987654321'), false);
    assert.equal(prompt.includes('[so dien thoai da an]'), true);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.GOOGLE_AI_API_KEY;
    } else {
      process.env.GOOGLE_AI_API_KEY = originalKey;
    }
  }
});

test('AI safe rewrite returns a draft and redacts private data in the prompt', async () => {
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
                parts: [{ text: 'Mình muốn nhắc mọi người kiểm chứng thông tin trước khi chia sẻ.' }]
              }
            }
          ]
        };
      }
    };
  };

  try {
    const ai = createAiClient();
    const result = await ai.rewrite('Bạn A lừa đảo, liên hệ 0901234567 để biết thêm');
    const prompt = capturedBody.contents[0].parts[0].text;

    assert.equal(result, 'Mình muốn nhắc mọi người kiểm chứng thông tin trước khi chia sẻ.');
    assert.equal(capturedBody.systemInstruction.parts[0].text.includes('Chỉ trả về một bản nháp'), true);
    assert.equal(prompt.includes('0901234567'), false);
    assert.equal(prompt.includes('[so dien thoai da an]'), true);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.GOOGLE_AI_API_KEY;
    } else {
      process.env.GOOGLE_AI_API_KEY = originalKey;
    }
  }
});

test('redactSensitiveText masks email phone and student id patterns', () => {
  const result = redactSensitiveText('mail me@example.com, sdt 0901234567, ma sinh vien B2212345');

  assert.equal(result.includes('me@example.com'), false);
  assert.equal(result.includes('0901234567'), false);
  assert.equal(result.includes('B2212345'), false);
  assert.equal(result.includes('[email da an]'), true);
  assert.equal(result.includes('[so dien thoai da an]'), true);
  assert.equal(result.includes('[ma sinh vien da an]'), true);
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

test('uploaded image OCR moderation flags PII without sending raw OCR secrets', async () => {
  const moderateCalls = [];
  let captionRequest = null;
  const ai = {
    async moderate(text) {
      moderateCalls.push(text);
      return { status: 'Safe', labels: [] };
    },
    async caption(media, mode) {
      captionRequest = { media, mode };
      return 'Email me@example.com, sdt 0901234567';
    }
  };
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime: createEvents(),
    now: () => new Date('2026-06-10T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Bai viet co anh dinh kem',
    image: {
      name: 'secret.png',
      type: 'image/png',
      dataUrl: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`,
      spoiler: true
    },
    captchaToken: 'captcha-secret-token',
    ip: '203.0.113.77',
    posterToken: 'poster-secret-token'
  });

  assert.equal(created.status, 'pending');
  assert.equal(created.thread.isPending, true);
  assert.deepEqual(created.thread.moderationLabels, ['PII Risk']);
  assert.deepEqual(Object.keys(captionRequest.media).sort(), ['data', 'mimeType']);
  assert.equal(captionRequest.mode, 'ocr');
  assert.equal(captionRequest.media.mimeType, 'image/png');
  assert.equal(moderateCalls[0], 'Bai viet co anh dinh kem');
  assert.equal(moderateCalls[1].includes('me@example.com'), false);
  assert.equal(moderateCalls[1].includes('0901234567'), false);
  assert.equal(moderateCalls[1].includes('[email da an]'), true);
  assert.equal(moderateCalls[1].includes('[so dien thoai da an]'), true);
  assert.equal(JSON.stringify({ moderateCalls, captionRequest }).includes('203.0.113.77'), false);
  assert.equal(JSON.stringify({ moderateCalls, captionRequest }).includes('captcha-secret-token'), false);
  assert.equal(JSON.stringify({ moderateCalls, captionRequest }).includes('poster-secret-token'), false);
});

test('uploaded image safety labels can hold comments for moderation', async () => {
  const ai = {
    async moderate() {
      return { status: 'Safe', labels: [] };
    },
    async moderateImage() {
      return { status: 'Flagged', labels: ['Graphic Content'] };
    },
    async caption() {
      return '';
    }
  };
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime: createEvents(),
    now: () => new Date('2026-06-10T08:00:00.000Z')
  });
  const thread = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread an toan',
    captchaToken: 'dev-pass',
    ip: '203.0.113.10'
  });

  const reply = await service.createComment({
    threadId: thread.thread.id,
    body: 'Tra loi co anh',
    image: {
      type: 'image/jpeg',
      dataUrl: `data:image/jpeg;base64,${Buffer.from('unsafe-image').toString('base64')}`
    },
    captchaToken: 'dev-pass',
    ip: '203.0.113.11'
  });

  assert.equal(reply.status, 'pending');
  assert.equal(reply.comment.isPending, true);
  assert.deepEqual(reply.comment.moderationLabels, ['Graphic Content']);
});

test('upload moderation attempts any image MIME type accepted by uploads', async () => {
  const imageModerationRequests = [];
  const ocrRequests = [];
  const ai = {
    async moderate() {
      return { status: 'Safe', labels: [] };
    },
    async moderateImage(media) {
      imageModerationRequests.push(media);
      return { status: 'Safe', labels: [] };
    },
    async caption(media, mode) {
      ocrRequests.push({ media, mode });
      return '';
    }
  };
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime: createEvents(),
    now: () => new Date('2026-06-10T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Anh AVIF',
    image: {
      type: 'image/avif',
      dataUrl: `data:image/avif;base64,${Buffer.from('avif-image').toString('base64')}`
    },
    captchaToken: 'dev-pass',
    ip: '203.0.113.12'
  });

  assert.equal(created.status, 'published');
  assert.equal(imageModerationRequests.length, 1);
  assert.equal(imageModerationRequests[0].mimeType, 'image/avif');
  assert.equal(ocrRequests.length, 1);
  assert.equal(ocrRequests[0].media.mimeType, 'image/avif');
  assert.equal(ocrRequests[0].mode, 'ocr');
});

test('createAiClient fallback rejects new media features without a key', async () => {
  const keys = [
    'AI_PROVIDER',
    'GOOGLE_AI_API_KEY',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_BASE_URL',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL'
  ];
  const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    delete process.env[key];
  }
  try {
    const ai = createAiClient();
    await assert.rejects(() => ai.translate('xin chao', 'en'), /AI/);
    await assert.rejects(() => ai.transcribe({ data: 'AAAA', mimeType: 'audio/mpeg' }), /AI/);
    await assert.rejects(() => ai.caption({ data: 'AAAA', mimeType: 'image/avif' }), /AI/);
    await assert.rejects(() => ai.moderateImage({ data: 'AAAA', mimeType: 'image/avif' }), /AI/);
    await assert.rejects(() => ai.speak('xin chao'), /AI/);
  } finally {
    for (const key of keys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('upload moderation degrades safely when image AI is not configured', async () => {
  const keys = [
    'AI_PROVIDER',
    'GOOGLE_AI_API_KEY',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_BASE_URL',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL'
  ];
  const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    delete process.env[key];
  }

  try {
    const service = createForumService({
      store: createMemoryStore(),
      ai: createAiClient(),
      realtime: createEvents(),
      now: () => new Date('2026-06-10T08:00:00.000Z')
    });

    const created = await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'Noi dung an toan',
      image: {
        type: 'image/png',
        dataUrl: `data:image/png;base64,${Buffer.from('image').toString('base64')}`
      },
      captchaToken: 'dev-pass',
      ip: '203.0.113.12'
    });

    assert.equal(created.status, 'published');
    assert.equal(created.thread.isPending, false);
    assert.deepEqual(created.thread.moderationLabels, []);
  } finally {
    for (const key of keys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('forum service translateDraft returns translation and enforces target language allowlist', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    now: () => new Date('2026-06-04T00:00:00.000Z')
  });

  const result = await service.translateDraft({ text: 'Xin chào', targetLang: 'en', ip: '203.0.113.5' });
  assert.equal(result.targetLang, 'en');
  assert.equal(result.text, 'Da dich [en]: Xin chào');

  const fallback = await service.translateDraft({ text: 'Xin chào', targetLang: 'klingon', ip: '203.0.113.5' });
  assert.equal(fallback.targetLang, 'vi');
});

test('forum service transcribeAudio and captionImage return AI text', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    now: () => new Date('2026-06-04T00:00:00.000Z')
  });

  const transcript = await service.transcribeAudio({
    audio: { data: Buffer.from('hello').toString('base64'), mimeType: 'audio/mpeg' },
    ip: '203.0.113.5'
  });
  assert.match(transcript.text, /Da go bang/);

  const caption = await service.captionImage({
    image: { data: Buffer.from('img').toString('base64'), mimeType: 'image/png' },
    mode: 'ocr',
    ip: '203.0.113.5'
  });
  assert.equal(caption.mode, 'ocr');
  assert.match(caption.text, /Da mo ta \[ocr\]/);
});

test('forum service speakText returns base64 audio and rejects empty or oversized text', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    now: () => new Date('2026-06-04T00:00:00.000Z')
  });

  const result = await service.speakText({ text: 'Xin chào 36chan', ip: '203.0.113.5' });
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(Buffer.from(result.audio, 'base64').toString(), 'audio:Xin chào 36chan');

  await assert.rejects(() => service.speakText({ text: '   ', ip: '203.0.113.5' }), /bắt buộc/);
  await assert.rejects(
    () => service.speakText({ text: 'a'.repeat(2001), ip: '203.0.113.5' }),
    (error) => error.statusCode === 413
  );
});

test('forum service rejects oversized AI media payloads', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    now: () => new Date('2026-06-04T00:00:00.000Z')
  });

  const huge = 'A'.repeat(20 * 1024 * 1024);
  await assert.rejects(
    () => service.transcribeAudio({ audio: { data: huge, mimeType: 'audio/mpeg' }, ip: '203.0.113.5' }),
    (error) => error.statusCode === 413
  );
  await assert.rejects(
    () => service.captionImage({ image: { data: '', mimeType: 'image/png' }, ip: '203.0.113.5' }),
    (error) => error.statusCode === 400
  );
});

test('forum service enforces a daily budget on AI translate requests', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    now: () => new Date('2026-06-04T00:00:00.000Z')
  });

  for (let i = 0; i < 40; i += 1) {
    await service.translateDraft({ text: 'Xin chào', targetLang: 'en', ip: '203.0.113.9', posterToken: 'p' });
  }
  await assert.rejects(
    () => service.translateDraft({ text: 'Xin chào', targetLang: 'en', ip: '203.0.113.9', posterToken: 'p' }),
    (error) => error.statusCode === 429
  );
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

test('createTripcode: insecure trips are deterministic, secure trips differ and are salted', () => {
  assert.equal(createTripcode(''), null);
  assert.equal(createTripcode('#'), null);

  const insecure = createTripcode('hunter2');
  assert.equal(insecure, createTripcode('hunter2'));
  assert.match(insecure, /^![A-Za-z0-9]{10}$/);
  assert.notEqual(insecure, createTripcode('other-pass'));

  const secure = createTripcode('#hunter2');
  assert.match(secure, /^!![A-Za-z0-9]{11}$/);
  assert.notEqual(secure, insecure);
});

test('safe thread is public, gets global number, and emits realtime event', async () => {
  const realtime = createEvents();
  const logs = [];
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: () => new Date('2026-05-22T08:00:00.000Z'),
    logger: (entry) => logs.push(entry)
  });

  const result = await service.createThread({
    boardSlug: 'hoc-tap',
    subject: '  <Lich thi giua ky>  ',
    body: 'Xin tips qua mon',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  const threads = await service.listThreads('hoc-tap');
  const searched = await service.listThreads('hoc-tap', { paged: true, q: 'lich thi' });

  assert.equal(result.thread.isPending, false);
  assert.equal(result.thread.globalNumber, 1);
  assert.equal(result.thread.subject, '&lt;Lich thi giua ky&gt;');
  assert.equal(threads.length, 1);
  assert.equal(threads[0].subject, '&lt;Lich thi giua ky&gt;');
  assert.equal(searched.total, 1);
  assert.equal(searched.items[0].globalNumber, result.thread.globalNumber);
  assert.equal(realtime.events[0].event, 'thread:created');
  assert.equal(logs[0].event, 'post.create');
  assert.equal(logs[0].postType, 'thread');
  assert.equal(logs[0].moderationStatus, 'Safe');
});

test('posts store immutable dice rolls from imageboard roll commands', async () => {
  const randomValues = [3, 4, 2, 12];
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z'),
    randomInt: () => randomValues.shift() ?? 1
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Gieo thu #dice 2d6+1\nThem [dice]1d4[/dice]',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  const comment = await service.createComment({
    threadId: created.thread.id,
    body: 'Reply roll /roll 1d20 - 2',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8'
  });
  const detail = await service.getThread(created.thread.id);
  const listed = await service.listThreads('hoc-tap');

  assert.deepEqual(created.thread.diceRolls, [
    {
      id: '1',
      expression: '2d6+1',
      dice: 2,
      sides: 6,
      modifier: 1,
      rolls: [3, 4],
      total: 8
    },
    {
      id: '2',
      expression: '1d4',
      dice: 1,
      sides: 4,
      modifier: 0,
      rolls: [2],
      total: 2
    }
  ]);
  assert.equal(comment.comment.diceRolls[0].expression, '1d20-2');
  assert.deepEqual(comment.comment.diceRolls[0].rolls, [12]);
  assert.equal(comment.comment.diceRolls[0].total, 10);
  assert.deepEqual(detail.thread.diceRolls, created.thread.diceRolls);
  assert.deepEqual(detail.comments[0].diceRolls, comment.comment.diceRolls);
  assert.deepEqual(listed[0].diceRolls, created.thread.diceRolls);
});

test('display name is optional per post and separated from anonymous identity', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread co ten hien thi',
    displayName: '  Sinh vien <script>  ',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7',
    posterToken: 'browser-a'
  });
  const anonymousReply = await service.createComment({
    threadId: created.thread.id,
    body: 'Binh luan an danh mac dinh',
    displayName: '',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8',
    posterToken: 'browser-b'
  });
  const detail = await service.getThread(created.thread.id);
  const longNameReply = await service.createComment({
    threadId: created.thread.id,
    body: 'Binh luan co ten dai',
    displayName: 'A'.repeat(45),
    captchaToken: 'dev-pass',
    ip: '203.0.113.9',
    posterToken: 'browser-c'
  });

  assert.equal(created.thread.displayName, 'Sinh vien script');
  assert.equal(anonymousReply.comment.displayName, 'Anonymous');
  assert.equal(longNameReply.comment.displayName, 'A'.repeat(40));
  assert.equal(detail.thread.displayName, 'Sinh vien script');
  assert.equal(detail.comments[0].displayName, 'Anonymous');
  assert.equal('accountId' in detail.thread, false);
  assert.equal('username' in detail.thread, false);
  assert.equal(Boolean(detail.thread.posterHash), true);
  assert.equal(Boolean(detail.comments[0].posterHash), true);
  await assert.rejects(
    () =>
      service.createThread({
        boardSlug: 'hoc-tap',
        body: 'Thu dung ten reserved',
        displayName: 'Moderator',
        captchaToken: 'dev-pass',
        ip: '203.0.113.10',
        posterToken: 'browser-d'
      }),
    /Tên hiển thị này không dùng được/
  );
});

test('tripcode is parsed from display name, name part is sanitized, and image spoiler is preserved', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread co tripcode va anh spoiler',
    displayName: 'Sinh vien#bi-mat',
    image: { type: 'image/png', dataUrl: 'data:image/png;base64,aGVsbG8=', spoiler: true },
    captchaToken: 'dev-pass',
    ip: '203.0.113.7',
    posterToken: 'browser-a'
  });
  const reply = await service.createComment({
    threadId: created.thread.id,
    body: 'Reply khong tripcode',
    displayName: 'Anonymous',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8',
    posterToken: 'browser-b'
  });
  const detail = await service.getThread(created.thread.id);

  assert.equal(created.thread.displayName, 'Sinh vien');
  assert.equal(created.thread.tripcode, createTripcode('bi-mat'));
  assert.match(created.thread.tripcode, /^![A-Za-z0-9]{10}$/);
  assert.equal(created.thread.image.spoiler, true);
  assert.equal(detail.thread.tripcode, created.thread.tripcode);
  assert.equal(detail.thread.image.spoiler, true);
  assert.equal(reply.comment.tripcode, null);

  // Reserved-name rule still applies to the name part before the '#'.
  await assert.rejects(
    () =>
      service.createThread({
        boardSlug: 'hoc-tap',
        body: 'Reserved name voi tripcode',
        displayName: 'Moderator#secret',
        captchaToken: 'dev-pass',
        ip: '203.0.113.9',
        posterToken: 'browser-c'
      }),
    /Tên hiển thị này không dùng được/
  );
});

test('capcode is stamped only for authorized roles and ignores forged values', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const adminThread = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thong bao tu quan tri',
    capcode: 'admin',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7',
    posterToken: 'staff-a'
  });
  const modReply = await service.createComment({
    threadId: adminThread.thread.id,
    body: 'Dieu hanh vien ghi chu',
    capcode: 'moderator',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8',
    posterToken: 'staff-b'
  });
  const forgedThread = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Co gang gia mao capcode',
    capcode: 'owner',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9',
    posterToken: 'troll-a'
  });
  const anonReply = await service.createComment({
    threadId: adminThread.thread.id,
    body: 'Reply binh thuong',
    captchaToken: 'dev-pass',
    ip: '203.0.113.10',
    posterToken: 'anon-a'
  });

  assert.equal(adminThread.thread.capcode, 'admin');
  assert.equal(modReply.comment.capcode, 'moderator');
  assert.equal(forgedThread.thread.capcode, null);
  assert.equal(anonReply.comment.capcode, null);

  const detail = await service.getThread(adminThread.thread.id);
  assert.equal(detail.thread.capcode, 'admin');
  assert.equal(detail.comments.find((comment) => comment.capcode === 'moderator')?.capcode, 'moderator');
});

test('anonymous poll allows one vote per hashed fingerprint without exposing voters', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });
  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Chon lich hoc nhom',
    pollOptions: ['Toi nay', 'Cuoi tuan'],
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  const poll = await service.votePoll(created.thread.id, {
    optionId: '1',
    ip: '203.0.113.8',
    posterToken: 'reader-a'
  });
  const detail = await service.getThread(created.thread.id);

  assert.equal(poll.totalVotes, 1);
  assert.equal(detail.thread.poll.options[0].votes, 1);
  assert.equal(JSON.stringify(detail.thread).includes('pollVotes'), false);
  assert.equal(realtime.events.at(-1).event, 'thread:updated');
  await assert.rejects(
    () =>
      service.votePoll(created.thread.id, {
        optionId: '2',
        ip: '203.0.113.8',
        posterToken: 'reader-a'
      }),
    /đã vote/
  );
});

test('votePost toggles upvote/downvote on a comment without leaking voters', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });
  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread de vote',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  const reply = await service.createComment({
    threadId: created.thread.id,
    body: 'Binh luan de vote',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8',
    posterToken: 'author'
  });
  const target = reply.comment.globalNumber;

  const up = await service.votePost({
    globalNumber: target,
    direction: 'up',
    accountId: 'reader-a'
  });
  assert.deepEqual(up.votes, { up: 1, down: 0, score: 1 });
  assert.equal(up.myVote, 'up');
  assert.equal(realtime.events.at(-1).event, 'comment:updated');

  const detail = await service.getThread(created.thread.id);
  assert.equal(detail.comments[0].votes.score, 1);
  assert.equal(JSON.stringify(detail.comments[0]).includes('voters'), false);

  // Same account, same direction -> toggle off.
  const off = await service.votePost({
    globalNumber: target,
    direction: 'up',
    accountId: 'reader-a'
  });
  assert.deepEqual(off.votes, { up: 0, down: 0, score: 0 });
  assert.equal(off.myVote, null);

  // Switch an account from up to down keeps a single vote.
  await service.votePost({ globalNumber: target, direction: 'up', accountId: 'reader-a' });
  const down = await service.votePost({
    globalNumber: target,
    direction: 'down',
    accountId: 'reader-a'
  });
  assert.deepEqual(down.votes, { up: 0, down: 1, score: -1 });
  assert.equal(down.myVote, 'down');

  await assert.rejects(
    () => service.votePost({ globalNumber: target, direction: 'sideways', accountId: 'reader-a' }),
    /vote không hợp lệ/
  );

  // Anonymous (no account) cannot vote.
  await assert.rejects(
    () => service.votePost({ globalNumber: target, direction: 'up' }),
    /đăng nhập tài khoản để vote/
  );
});

test('reactPost toggles anonymous and account reactions without leaking voters', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });
  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread de react',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7',
    posterToken: 'author'
  });
  const target = created.thread.globalNumber;

  const liked = await service.reactPost({ globalNumber: target, reaction: 'like', posterToken: 'reader-a', ip: '203.0.113.8' });
  assert.equal(liked.reactions.like, 1);
  assert.equal(liked.myReaction, 'like');
  assert.equal(realtime.events.at(-1).event, 'thread:updated');

  const switched = await service.reactPost({ globalNumber: target, reaction: 'thanks', posterToken: 'reader-a', ip: '203.0.113.8' });
  assert.equal(switched.reactions.like, 0);
  assert.equal(switched.reactions.thanks, 1);
  assert.equal(switched.myReaction, 'thanks');

  const account = await service.reactPost({ globalNumber: target, reaction: 'thanks', accountId: 'reader-account' });
  assert.equal(account.reactions.thanks, 2);

  const off = await service.reactPost({ globalNumber: target, reaction: 'thanks', posterToken: 'reader-a', ip: '203.0.113.8' });
  assert.equal(off.reactions.thanks, 1);
  assert.equal(off.myReaction, null);

  const detail = await service.getThread(created.thread.id);
  assert.equal(detail.thread.reactions.thanks, 1);
  assert.equal(JSON.stringify(detail.thread).includes('reactionVoters'), false);

  await assert.rejects(
    () => service.reactPost({ globalNumber: target, reaction: 'invalid', posterToken: 'reader-a' }),
    /Reaction không hợp lệ/
  );
});


test('board thread list includes latest reply previews and omitted media counts', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread can xem preview',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  const first = await service.createComment({
    threadId: created.thread.id,
    body: 'Reply preview 1',
    image: { name: 'omitted.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA', sizeBytes: 3 },
    captchaToken: 'dev-pass',
    ip: '203.0.113.8'
  });
  const second = await service.createComment({ threadId: created.thread.id, body: 'Reply preview 2', captchaToken: 'dev-pass', ip: '203.0.113.9' });
  const third = await service.createComment({ threadId: created.thread.id, body: 'Reply preview 3', captchaToken: 'dev-pass', ip: '203.0.113.10' });
  const fourth = await service.createComment({ threadId: created.thread.id, body: 'Reply preview 4', captchaToken: 'dev-pass', ip: '203.0.113.11' });

  const [listed] = await service.listThreads('hoc-tap');

  assert.equal(listed.replyCount, 4);
  assert.equal(listed.omittedReplyCount, 1);
  assert.equal(listed.omittedImageCount, 1);
  assert.deepEqual(
    listed.previewComments.map((comment) => comment.globalNumber),
    [second.comment.globalNumber, third.comment.globalNumber, fourth.comment.globalNumber]
  );
  assert.equal(listed.previewComments.some((comment) => comment.globalNumber === first.comment.globalNumber), false);
  assert.equal(listed.previewComments[0].bodyLines[0].text, 'Reply preview 2');
  assert.equal(listed.previewComments[0].deletePasswordHash, undefined);
});

test('board thread list supports server-side sort and filter modes before pagination', async () => {
  const dates = [
    new Date('2026-05-22T08:00:00.000Z'),
    new Date('2026-05-22T08:01:00.000Z'),
    new Date('2026-05-22T08:02:00.000Z'),
    new Date('2026-05-22T08:03:00.000Z'),
    new Date('2026-05-22T08:04:00.000Z'),
    new Date('2026-05-22T08:05:00.000Z'),
    new Date('2026-05-22T08:06:00.000Z'),
    new Date('2026-05-22T08:07:00.000Z')
  ];
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => dates.shift() ?? new Date('2026-05-22T08:07:00.000Z')
  });

  const first = await service.createThread({ boardSlug: 'hoc-tap', body: 'Thread dau', captchaToken: 'dev-pass', ip: '203.0.113.7' });
  const second = await service.createThread({ boardSlug: 'hoc-tap', body: 'Thread hai', captchaToken: 'dev-pass', ip: '203.0.113.8' });
  const third = await service.createThread({ boardSlug: 'hoc-tap', body: 'Thread ba', captchaToken: 'dev-pass', ip: '203.0.113.9' });
  await service.createComment({ threadId: first.thread.id, body: 'Reply mot', captchaToken: 'dev-pass', ip: '203.0.113.10' });
  await service.createComment({ threadId: first.thread.id, body: 'Reply hai', captchaToken: 'dev-pass', ip: '203.0.113.11' });
  const image = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread co anh',
    image: { name: 'filter.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA', sizeBytes: 3 },
    captchaToken: 'dev-pass',
    ip: '203.0.113.12'
  });
  const video = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread co video',
    image: { name: 'filter.webm', type: 'video/webm', dataUrl: 'data:video/webm;base64,AAAA', sizeBytes: 3 },
    captchaToken: 'dev-pass',
    ip: '203.0.113.13'
  });
  const poll = await service.createThread({ boardSlug: 'hoc-tap', body: 'Thread co poll', pollOptions: ['Co', 'Khong'], captchaToken: 'dev-pass', ip: '203.0.113.14' });

  const created = await service.listThreads('hoc-tap', { sort: 'created' });
  const replies = await service.listThreads('hoc-tap', { sort: 'replies' });
  const pagedReplies = await service.listThreads('hoc-tap', { paged: true, page: 1, pageSize: 1, sort: 'replies' });
  const media = await service.listThreads('hoc-tap', { filter: 'media' });
  const videos = await service.listThreads('hoc-tap', { filter: 'video' });
  const polls = await service.listThreads('hoc-tap', { filter: 'poll' });
  const unanswered = await service.listThreads('hoc-tap', { filter: 'unanswered' });

  assert.deepEqual(created.slice(0, 3).map((thread) => thread.id), [poll.thread.id, video.thread.id, image.thread.id]);
  assert.equal(replies[0].id, first.thread.id);
  assert.deepEqual(pagedReplies.items.map((thread) => thread.id), [first.thread.id]);
  assert.equal(pagedReplies.total, 6);
  assert.deepEqual(new Set(media.map((thread) => thread.id)), new Set([image.thread.id, video.thread.id]));
  assert.deepEqual(videos.map((thread) => thread.id), [video.thread.id]);
  assert.deepEqual(polls.map((thread) => thread.id), [poll.thread.id]);
  assert.equal(unanswered.some((thread) => thread.id === first.thread.id), false);
  assert.equal(unanswered.some((thread) => thread.id === second.thread.id), true);
});

test('getThread sorts comments by best/top/new/controversial/old', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });
  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread sap xep binh luan',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  const makeComment = async (body, token) => {
    const reply = await service.createComment({
      threadId: created.thread.id,
      body,
      captchaToken: 'dev-pass',
      ip: '203.0.113.8',
      posterToken: token
    });
    return reply.comment.globalNumber;
  };

  // Creation order (ascending global numbers): a, b, c.
  const a = await makeComment('binh luan a', 'author-a');
  const b = await makeComment('binh luan b', 'author-b');
  const c = await makeComment('binh luan c', 'author-c');

  const upvote = (target, account) =>
    service.votePost({ globalNumber: target, direction: 'up', accountId: account });
  const downvote = (target, account) =>
    service.votePost({ globalNumber: target, direction: 'down', accountId: account });

  // a: score 1, b: score 3, c: balanced 1/1 (controversial).
  await upvote(a, 'r1');
  await upvote(b, 'r1');
  await upvote(b, 'r2');
  await upvote(b, 'r3');
  await upvote(c, 'r1');
  await downvote(c, 'r2');

  const order = (comments) => comments.map((comment) => comment.globalNumber);

  const top = await service.getThread(created.thread.id, { commentsSort: 'top' });
  assert.deepEqual(order(top.comments), [b, a, c]);

  const newest = await service.getThread(created.thread.id, { commentsSort: 'new' });
  assert.deepEqual(order(newest.comments), [c, b, a]);

  const old = await service.getThread(created.thread.id, { commentsSort: 'old' });
  assert.deepEqual(order(old.comments), [a, b, c]);

  // Unknown / missing sort falls back to chronological (old).
  const fallback = await service.getThread(created.thread.id, { commentsSort: 'bogus' });
  assert.deepEqual(order(fallback.comments), [a, b, c]);
  assert.equal(fallback.commentsSort, 'old');

  // Controversial ranks the balanced 1/1 comment first.
  const controversial = await service.getThread(created.thread.id, { commentsSort: 'controversial' });
  assert.equal(controversial.comments[0].globalNumber, c);
});

test('getThread filters comments by search term before pagination', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });
  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread tim kiem binh luan',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  const matching = await service.createComment({
    threadId: created.thread.id,
    body: 'Noi dung co kim chi',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8'
  });
  const other = await service.createComment({
    threadId: created.thread.id,
    body: 'Noi dung pho bo',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });

  const result = await service.getThread(created.thread.id, {
    paged: true,
    commentsPage: 1,
    commentsPageSize: 1,
    commentsSearch: 'kim'
  });

  assert.equal(result.commentPage.total, 1);
  assert.equal(result.commentPage.search, 'kim');
  assert.equal(result.comments[0].globalNumber, matching.comment.globalNumber);
  assert.equal(result.comments.some((comment) => comment.globalNumber === other.comment.globalNumber), false);
  assert.equal(result.commentPage.currentMaxGlobalNumber, other.comment.globalNumber);
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
      height: 999999,
      thumbnail: {
        name: 'thumb\u0000.jpg',
        type: 'IMAGE/JPEG',
        dataUrl: 'data:image/jpeg;base64,AAA=',
        sizeBytes: '2',
        width: '160.8',
        height: '90.2'
      }
    }
  });
  const listed = await service.listThreads('hoc-tap');

  assert.deepEqual(created.thread.image, {
    name: 'tenanh.png',
    type: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
    spoiler: false,
    sizeBytes: 2048,
    width: 640,
    height: 20000,
    thumbnail: {
      name: 'thumb.jpg',
      type: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,AAA=',
      sizeBytes: 2,
      width: 161,
      height: 90
    }
  });
  assert.deepEqual(listed[0].image, created.thread.image);
  assert.deepEqual(created.thread.images, [created.thread.image]);
  assert.deepEqual(listed[0].images, [created.thread.image]);
});

test('comment image metadata is sanitized and returned with public comment data', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread co anh tra loi',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  const reply = await service.createComment({
    threadId: created.thread.id,
    body: 'Binh luan kem anh',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8',
    posterToken: 'author',
    image: {
      name: 'reply\u0000.png',
      type: 'IMAGE/PNG',
      dataUrl: 'data:image/png;base64,AAAA',
      sizeBytes: '4096',
      width: '320.4',
      height: 240,
      thumbnail: {
        name: 'rthumb\u0000.jpg',
        type: 'IMAGE/JPEG',
        dataUrl: 'data:image/jpeg;base64,AAA=',
        sizeBytes: '2',
        width: '80.8',
        height: '60.2'
      }
    }
  });

  assert.deepEqual(reply.comment.image, {
    name: 'reply.png',
    type: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
    spoiler: false,
    sizeBytes: 4096,
    width: 320,
    height: 240,
    thumbnail: {
      name: 'rthumb.jpg',
      type: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,AAA=',
      sizeBytes: 2,
      width: 81,
      height: 60
    }
  });

  const detail = await service.getThread(created.thread.id);
  assert.deepEqual(detail.comments[0].image, reply.comment.image);
  assert.deepEqual(reply.comment.images, [reply.comment.image]);
  assert.deepEqual(detail.comments[0].images, [reply.comment.image]);
});

test('thread supports multiple media attachments while keeping image compatibility alias', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Gallery post',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7',
    images: [
      {
        name: 'one.png',
        type: 'image/png',
        dataUrl: 'data:image/png;base64,AAAA',
        sizeBytes: 3
      },
      {
        name: 'clip.webm',
        type: 'video/webm',
        dataUrl: 'data:video/webm;base64,BBBB',
        sizeBytes: 3,
        thumbnail: {
          name: 'clip-poster.jpg',
          type: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,AAA=',
          sizeBytes: 2
        }
      }
    ]
  });
  const detail = await service.getThread(created.thread.id);

  assert.equal(created.thread.images.length, 2);
  assert.deepEqual(created.thread.image, created.thread.images[0]);
  assert.equal(created.thread.images[1].type, 'video/webm');
  assert.equal(created.thread.images[1].thumbnail.type, 'image/jpeg');
  assert.deepEqual(detail.thread.images, created.thread.images);
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

test('image size limits use defaults when env values are invalid', async () => {
  const originalMaxImageBytes = process.env.MAX_IMAGE_BYTES;
  const originalMaxThumbnailBytes = process.env.MAX_THUMBNAIL_BYTES;
  process.env.MAX_IMAGE_BYTES = 'not-a-number';
  process.env.MAX_THUMBNAIL_BYTES = 'not-a-number';

  try {
    const service = createForumService({
      store: createMemoryStore(),
      ai: safeAi,
      realtime: createEvents(),
      now: () => new Date('2026-05-22T08:00:00.000Z')
    });

    await assert.rejects(
      () =>
        service.createThread({
          boardSlug: 'hoc-tap',
          body: 'Anh qua lon',
          captchaToken: 'dev-pass',
          ip: '203.0.113.7',
          image: {
            name: 'large.jpg',
            type: 'image/jpeg',
            dataUrl: `data:image/jpeg;base64,${'A'.repeat(1_500_001)}`
          }
        }),
      (error) => {
        assert.equal(error.statusCode, 413);
        assert.equal(error.message, 'Ảnh quá lớn');
        return true;
      }
    );

    await assert.rejects(
      () =>
        service.createThread({
          boardSlug: 'hoc-tap',
          body: 'Thumbnail qua lon',
          captchaToken: 'dev-pass',
          ip: '203.0.113.7',
          image: {
            name: 'image.jpg',
            type: 'image/jpeg',
            dataUrl: 'data:image/jpeg;base64,AAAA',
            thumbnail: {
              name: 'thumb.jpg',
              type: 'image/jpeg',
              dataUrl: `data:image/jpeg;base64,${'A'.repeat(120_001)}`
            }
          }
        }),
      (error) => {
        assert.equal(error.statusCode, 413);
        assert.equal(error.message, 'Thumbnail ảnh quá lớn');
        return true;
      }
    );
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

test('s3 image storage uploads image bytes with signed S3-compatible PUT request', async () => {
  const requests = [];
  const storage = createS3ImageStorage({
    endpoint: 'https://storage.example.test',
    region: 'auto',
    bucket: '36chan',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    publicBaseUrl: 'https://cdn.example.test/36chan',
    keyPrefix: 'posts',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200 };
    },
    now: () => new Date('2026-05-31T00:00:00.000Z'),
    randomUUID: () => '00000000-0000-4000-8000-000000000000'
  });

  const saved = await storage.save({
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
  });
  const health = await storage.health();
  const thumbnailRequest = requests[0];
  const request = requests[1];
  const healthRequest = requests[2];

  assert.equal(requests.length, 3);
  assert.equal(request.url.toString(), 'https://storage.example.test/36chan/posts/2026/05/00000000-0000-4000-8000-000000000000.png');
  assert.equal(request.options.method, 'PUT');
  assert.equal(request.options.headers['content-type'], 'image/png');
  assert.equal(request.options.headers['x-amz-date'], '20260531T000000Z');
  assert.equal(request.options.headers.authorization.includes('Credential=access-key/20260531/auto/s3/aws4_request'), true);
  assert.equal(
    request.options.headers.authorization.includes('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date'),
    true
  );
  assert.equal(request.options.body.length, 3);
  assert.equal(saved.storage, 's3');
  assert.equal(saved.storageKey, 'posts/2026/05/00000000-0000-4000-8000-000000000000.png');
  assert.equal(saved.url, 'https://cdn.example.test/36chan/posts/2026/05/00000000-0000-4000-8000-000000000000.png');
  assert.equal(Object.hasOwn(saved, 'dataUrl'), false);
  assert.equal(
    thumbnailRequest.url.toString(),
    'https://storage.example.test/36chan/posts/2026/05/00000000-0000-4000-8000-000000000000.thumb.jpg'
  );
  assert.equal(thumbnailRequest.options.method, 'PUT');
  assert.equal(thumbnailRequest.options.headers['content-type'], 'image/jpeg');
  assert.equal(thumbnailRequest.options.body.length, 2);
  assert.equal(saved.thumbnail.storage, 's3');
  assert.equal(saved.thumbnail.storageKey, 'posts/2026/05/00000000-0000-4000-8000-000000000000.thumb.jpg');
  assert.equal(
    saved.thumbnail.url,
    'https://cdn.example.test/36chan/posts/2026/05/00000000-0000-4000-8000-000000000000.thumb.jpg'
  );
  assert.equal(Object.hasOwn(saved.thumbnail, 'dataUrl'), false);
  assert.equal(healthRequest.options.method, 'HEAD');
  assert.equal(health.type, 's3-compatible');
  assert.equal(health.configured, true);
  assert.equal(health.ready, true);
});

test('migrateInlineImages moves inline image data to local upload files', async () => {
  const dataRoot = path.resolve('data');
  await fs.mkdir(dataRoot, { recursive: true });
  const testRoot = await fs.mkdtemp(path.join(dataRoot, 'image-migration-test-'));
  const forumPath = path.join(testRoot, 'forum.json');
  const uploadRoot = path.join(testRoot, 'uploads');

  try {
    await fs.writeFile(
      forumPath,
      JSON.stringify(
        {
          version: 1,
          nextGlobalNumber: 2,
          threads: [
            {
              id: 'thread-with-image',
              image: {
                name: 'anh.png',
                type: 'image/png',
                dataUrl: 'data:image/png;base64,AAAA',
                sizeBytes: 3
              }
            }
          ],
          comments: [
            {
              id: 'comment-with-local-image',
              image: {
                name: 'da-migrate.png',
                type: 'image/png',
                storage: 'local',
                storageKey: 'old.png',
                url: '/uploads/old.png'
              }
            }
          ]
        },
        null,
        2
      )
    );

    const result = await migrateInlineImages({
      forumPath,
      uploadRoot,
      now: new Date('2026-05-28T00:00:00.000Z')
    });
    const migrated = JSON.parse(await fs.readFile(forumPath, 'utf8'));
    const image = migrated.threads[0].image;
    const backupNames = (await fs.readdir(testRoot)).filter((name) => name.startsWith('forum.json.backup-'));

    assert.equal(result.scanned, 2);
    assert.equal(result.migrated, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.bytesWritten, 3);
    assert.equal(backupNames.length, 1);
    assert.equal(image.storage, 'local');
    assert.equal(image.url.startsWith('/uploads/'), true);
    assert.equal(Object.hasOwn(image, 'dataUrl'), false);
    assert.deepEqual(migrated.threads[0].images, [image]);
    assert.equal((await fs.readFile(path.join(uploadRoot, image.storageKey))).length, 3);
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
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

test('admin can delete a live post without the delete password', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'tam-su',
    body: 'Bai dang hoat dong',
    captchaToken: 'dev-pass',
    deletePassword: 'owner-pass',
    ip: '203.0.113.9'
  });
  assert.equal(created.thread.isPending, false);

  const result = await service.adminDeletePost(created.thread.globalNumber, {
    reason: 'vi pham noi quy',
    actor: 'pengu1'
  });
  assert.equal(result.ok, true);

  const board = await service.listThreads('tam-su');
  assert.equal(board.find((thread) => thread.globalNumber === created.thread.globalNumber), undefined);

  const actions = await service.listModerationActions(10);
  const deleteAction = actions.find((action) => action.action === 'admin:delete');
  assert.ok(deleteAction);
  assert.equal(deleteAction.actor, 'pengu1');
  assert.equal(deleteAction.reason, 'vi pham noi quy');
});

test('admin delete rejects an unknown post number', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  await assert.rejects(
    () => service.adminDeletePost(999999, { actor: 'pengu1' }),
    (error) => error.statusCode === 404
  );
});

test('admin can restore a deleted live post', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: (() => {
      const dates = [
        new Date('2026-05-22T08:00:00.000Z'),
        new Date('2026-05-22T08:01:00.000Z'),
        new Date('2026-05-22T08:02:00.000Z')
      ];
      return () => dates.shift() ?? new Date('2026-05-22T08:02:00.000Z');
    })()
  });

  const created = await service.createThread({
    boardSlug: 'tam-su',
    body: 'Bai co the khoi phuc',
    captchaToken: 'dev-pass',
    deletePassword: 'owner-pass',
    ip: '203.0.113.9'
  });

  await service.adminDeletePost(created.thread.globalNumber, {
    reason: 'xoa nham',
    actor: 'modfixture'
  });
  const restore = await service.adminRestorePost(created.thread.globalNumber, {
    reason: 'khoi phuc sau khi xem lai',
    actor: 'modfixture'
  });
  const board = await service.listThreads('tam-su');
  const restored = board.find((thread) => thread.globalNumber === created.thread.globalNumber);
  const actions = await service.listModerationActions(10);
  const restoreAction = actions.find((action) => action.action === 'admin:restore');

  assert.equal(restore.ok, true);
  assert.equal(restored.body, 'Bai co the khoi phuc');
  assert.ok(restoreAction);
  assert.equal(restoreAction.actor, 'modfixture');
  assert.equal(restoreAction.reason, 'khoi phuc sau khi xem lai');
});

test('admin can edit a live post without the delete password', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'tam-su',
    body: 'Noi dung ban dau',
    captchaToken: 'dev-pass',
    deletePassword: 'owner-pass',
    ip: '203.0.113.9'
  });

  const result = await service.adminEditPost(created.thread.globalNumber, {
    body: 'Noi dung da sua',
    reason: 'sua theo noi quy',
    actor: 'modfixture'
  });

  const board = await service.listThreads('tam-su');
  const edited = board.find((thread) => thread.globalNumber === created.thread.globalNumber);
  const detail = await service.getAdminPostDetail(created.thread.globalNumber);
  const actions = await service.listModerationActions(10);
  const editAction = actions.find((action) => action.action === 'admin:edit');

  assert.equal(result.ok, true);
  assert.equal(edited.body, 'Noi dung da sua');
  assert.equal('editHistory' in edited, false);
  assert.equal(detail.editHistory.length, 1);
  assert.equal(detail.editHistory[0].previousBody, 'Noi dung ban dau');
  assert.equal(detail.editHistory[0].newBody, 'Noi dung da sua');
  assert.equal(detail.editHistory[0].actor, 'modfixture');
  assert.equal(detail.editHistory[0].reason, 'sua theo noi quy');
  assert.ok(editAction);
  assert.equal(editAction.actor, 'modfixture');
  assert.equal(editAction.reason, 'sua theo noi quy');
});

test('anonymous poster can edit a live post with the delete password', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: (() => {
      const dates = [new Date('2026-05-22T08:00:00.000Z'), new Date('2026-05-22T08:05:00.000Z')];
      return () => dates.shift() ?? new Date('2026-05-22T08:05:00.000Z');
    })()
  });

  const created = await service.createThread({
    boardSlug: 'tam-su',
    body: 'Noi dung tu nguoi dang',
    captchaToken: 'dev-pass',
    deletePassword: 'owner-pass',
    ip: '203.0.113.9'
  });

  await assert.rejects(
    () =>
      service.editPostWithPassword(created.thread.globalNumber, {
        password: 'wrong-pass',
        body: 'Khong duoc sua'
      }),
    /Mật khẩu xóa không đúng/
  );
  const result = await service.editPostWithPassword(created.thread.globalNumber, {
    password: 'owner-pass',
    body: 'Noi dung nguoi dang da sua'
  });
  const board = await service.listThreads('tam-su');
  const edited = board.find((thread) => thread.globalNumber === created.thread.globalNumber);
  const detail = await service.getAdminPostDetail(created.thread.globalNumber);
  const actions = await service.listModerationActions(10);
  const editAction = actions.find((action) => action.action === 'user:edit');

  assert.equal(result.status, 'published');
  assert.equal(result.post.body, 'Noi dung nguoi dang da sua');
  assert.equal(edited.body, 'Noi dung nguoi dang da sua');
  assert.equal(typeof edited.editedAt, 'string');
  assert.equal('editHistory' in edited, false);
  assert.equal('editedBy' in edited, false);
  assert.equal(detail.editHistory.length, 1);
  assert.equal(detail.editHistory[0].actor, 'anonymous');
  assert.equal(detail.editHistory[0].previousBody, 'Noi dung tu nguoi dang');
  assert.equal(detail.editHistory[0].newBody, 'Noi dung nguoi dang da sua');
  assert.ok(editAction);
  assert.equal(editAction.actor, 'anonymous');
  assert.equal(realtime.events.at(-1).event, 'thread:updated');
});

test('published posts can use creation-time appeal token after admin deletion', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: (() => {
      const dates = [
        new Date('2026-05-22T08:00:00.000Z'),
        new Date('2026-05-22T08:01:00.000Z'),
        new Date('2026-05-22T08:02:00.000Z')
      ];
      return () => dates.shift() ?? new Date('2026-05-22T08:02:00.000Z');
    })()
  });

  const created = await service.createThread({
    boardSlug: 'tam-su',
    body: 'Bai ban dau duoc cong khai',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });
  assert.equal(created.status, 'published');
  assert.equal(typeof created.appealToken, 'string');

  await assert.rejects(
    () => service.submitAppeal({ token: created.appealToken, reason: 'Chua bi xoa' }),
    (error) => error.statusCode === 409
  );

  await service.adminDeletePost(created.thread.globalNumber, {
    reason: 'xoa de test khang nghi',
    actor: 'pengu1'
  });
  const appeal = await service.submitAppeal({
    token: created.appealToken,
    reason: 'Xin khoi phuc bai da xoa',
    ip: '198.51.100.7'
  });

  assert.equal(appeal.status, 'open');
  assert.equal(appeal.globalNumber, created.thread.globalNumber);
  assert.equal(appeal.reason, 'Xin khoi phuc bai da xoa');
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

test('pending moderation issues anonymous appeal tokens without storing raw token or identity', async () => {
  const store = createMemoryStore();
  const service = createForumService({
    store,
    ai: flaggedAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'tam-su',
    body: 'Bai bi AI giu lai',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9',
    posterToken: 'poster-appeal-secret'
  });
  assert.equal(created.status, 'pending');
  assert.equal(typeof created.appealToken, 'string');
  assert.ok(created.appealToken.length >= 20);

  const stateAfterCreate = await store.read();
  const serializedCreateState = JSON.stringify(stateAfterCreate);
  assert.equal(stateAfterCreate.appeals.length, 1);
  assert.equal(stateAfterCreate.appeals[0].status, 'issued');
  assert.equal(serializedCreateState.includes(created.appealToken), false);
  assert.equal(serializedCreateState.includes('203.0.113.9'), false);
  assert.equal(serializedCreateState.includes('poster-appeal-secret'), false);

  const submitted = await service.submitAppeal({
    token: created.appealToken,
    reason: 'Xin xem lai vi noi dung khong phai spam',
    ip: '198.51.100.7',
    posterToken: 'appeal-submit-secret'
  });
  const serializedAppeal = JSON.stringify(submitted);

  assert.equal(submitted.status, 'open');
  assert.equal(submitted.globalNumber, created.thread.globalNumber);
  assert.equal(submitted.reason, 'Xin xem lai vi noi dung khong phai spam');
  assert.equal(serializedAppeal.includes(created.appealToken), false);
  assert.equal(serializedAppeal.includes('198.51.100.7'), false);
  assert.equal(serializedAppeal.includes('appeal-submit-secret'), false);
});

test('admin resolves anonymous appeals with audit history', async () => {
  const realtime = createEvents();
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: (() => {
      const dates = [
        new Date('2026-05-22T08:00:00.000Z'),
        new Date('2026-05-22T08:01:00.000Z'),
        new Date('2026-05-22T08:02:00.000Z'),
        new Date('2026-05-22T08:03:00.000Z')
      ];
      return () => dates.shift() ?? new Date('2026-05-22T08:03:00.000Z');
    })()
  });

  const created = await service.createThread({
    boardSlug: 'tam-su',
    body: 'Bai cho khang nghi',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });
  await service.adminDeletePost(created.thread.globalNumber, {
    reason: 'Xoa de test khang nghi',
    actor: 'pengu1'
  });
  const submitted = await service.submitAppeal({
    token: created.appealToken,
    reason: 'Can xem lai quyet dinh',
    ip: '198.51.100.7'
  });

  const resolved = await service.resolveAppeal(submitted.id, {
    status: 'accepted',
    reason: 'Dong y xem lai',
    actor: 'pengu1'
  });
  const appeals = await service.listAppeals(10);
  const actions = await service.listModerationActions(10);
  const activeThreads = await service.listThreads('tam-su');
  const restoreAction = actions.find((action) => action.action === 'admin:appeal-restore');
  const acceptAction = actions.find((action) => action.action === 'admin:appeal-accept');

  assert.equal(resolved.status, 'accepted');
  assert.equal(resolved.resolvedBy, 'pengu1');
  assert.equal(resolved.history.at(-1).action, 'accepted');
  assert.equal(appeals.length, 1);
  assert.equal(appeals[0].status, 'accepted');
  assert.equal(activeThreads.some((thread) => thread.id === created.thread.id), true);
  assert.equal(restoreAction?.reason, 'Dong y xem lai');
  assert.equal(restoreAction?.globalNumber, created.thread.globalNumber);
  assert.equal(acceptAction?.reason, 'Dong y xem lai');
  assert.equal(acceptAction?.globalNumber, created.thread.globalNumber);
  assert.equal(realtime.events.some((event) => event.event === 'thread:created' && event.payload.thread.id === created.thread.id), true);
});

test('admin pending queue prioritizes report count PII risk and recency without private data', async () => {
  const store = createMemoryStore({
    version: 1,
    nextGlobalNumber: 4,
    threads: [
      {
        id: 'pending-spam',
        boardSlug: 'tam-su',
        body: 'Spam pending',
        image: null,
        images: [],
        globalNumber: 1,
        posterHash: 'ID:SPAM001',
        isPending: true,
        isDeleted: false,
        moderationStatus: 'Flagged',
        moderationLabels: ['Spam'],
        moderationConfidence: 0.91,
        createdAt: '2026-05-22T07:45:00.000Z',
        updatedAt: '2026-05-22T07:45:00.000Z'
      },
      {
        id: 'pending-pii',
        boardSlug: 'tam-su',
        body: 'PII pending',
        image: null,
        images: [],
        globalNumber: 2,
        posterHash: 'ID:PII0001',
        isPending: true,
        isDeleted: false,
        moderationStatus: 'Flagged',
        moderationLabels: ['PII Risk'],
        moderationConfidence: 0.55,
        createdAt: '2026-05-20T08:00:00.000Z',
        updatedAt: '2026-05-20T08:00:00.000Z',
        posterToken: 'never-return-this'
      },
      {
        id: 'pending-old',
        boardSlug: 'tam-su',
        body: 'Old pending',
        image: null,
        images: [],
        globalNumber: 3,
        posterHash: 'ID:OLD0001',
        isPending: true,
        isDeleted: false,
        moderationStatus: 'Flagged',
        moderationLabels: ['Spam'],
        createdAt: '2026-05-19T08:00:00.000Z',
        updatedAt: '2026-05-19T08:00:00.000Z'
      }
    ],
    reports: [
      {
        id: 'report-1',
        postType: 'thread',
        postId: 'pending-spam',
        threadId: 'pending-spam',
        boardSlug: 'tam-su',
        globalNumber: 1,
        category: 'Spam',
        reason: 'spam',
        reporterHash: 'ID:REPORT1',
        status: 'open',
        createdAt: '2026-05-22T07:50:00.000Z'
      },
      {
        id: 'report-2',
        postType: 'thread',
        postId: 'pending-spam',
        threadId: 'pending-spam',
        boardSlug: 'tam-su',
        globalNumber: 1,
        category: 'Spam',
        reason: 'spam again',
        reporterHash: 'ID:REPORT2',
        status: 'open',
        createdAt: '2026-05-22T07:55:00.000Z'
      }
    ]
  });
  const service = createForumService({
    store,
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const pending = await service.listPending();
  const highPriority = await service.listPending({ priority: 'high' });
  const newest = await service.listPending({ sort: 'newest' });
  const confident = await service.listPending({ confidence: '80', sort: 'confidence-desc' });
  const confidenceAscending = await service.listPending({ sort: 'confidence-asc' });
  const serialized = JSON.stringify(pending);

  assert.deepEqual(pending.map((post) => post.globalNumber), [1, 2, 3]);
  assert.equal(pending[0].moderationPriority.reportCount, 2);
  assert.equal(pending[0].moderationPriority.level, 'high');
  assert.equal(pending[1].moderationPriority.hasPiiRisk, true);
  assert.deepEqual(highPriority.map((post) => post.globalNumber), [1, 2]);
  assert.deepEqual(newest.map((post) => post.globalNumber), [1, 2, 3]);
  assert.deepEqual(confident.map((post) => post.globalNumber), [1]);
  assert.deepEqual(confidenceAscending.map((post) => post.globalNumber), [2, 1, 3]);
  assert.equal(pending[0].moderationConfidence, 0.91);
  assert.equal(serialized.includes('never-return-this'), false);
});

test('AI moderation confidence persists to posts and moderation actions', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: {
      async moderate() {
        return { status: 'Flagged', labels: ['Spam'], confidence: 0.84 };
      }
    },
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'spam co do tin cay',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });
  const pending = await service.listPending({ confidence: '80' });
  const actions = await service.listModerationActions(10, { confidence: '80' });

  assert.equal(created.status, 'pending');
  assert.equal(created.thread.moderationConfidence, 0.84);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].moderationConfidence, 0.84);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].moderationConfidence, 0.84);
});

test('AI moderation confidence threshold only bypasses low-confidence flagged results', async () => {
  const lowConfidenceService = createForumService({
    store: createMemoryStore(),
    ai: {
      async moderate() {
        return { status: 'Flagged', labels: ['Spam'], confidence: 0.4 };
      }
    },
    realtime: createEvents(),
    moderationConfidenceThreshold: 0.8,
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const lowConfidence = await lowConfidenceService.createThread({
    boardSlug: 'hoc-tap',
    body: 'flagged low confidence',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });

  const fallbackService = createForumService({
    store: createMemoryStore(),
    ai: flaggedAi,
    realtime: createEvents(),
    moderationConfidenceThreshold: 0.8,
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const fallback = await fallbackService.createThread({
    boardSlug: 'hoc-tap',
    body: 'flagged no confidence',
    captchaToken: 'dev-pass',
    ip: '203.0.113.10'
  });

  assert.equal(lowConfidence.status, 'published');
  assert.equal(lowConfidence.thread.moderationStatus, 'Flagged');
  assert.equal(lowConfidence.thread.moderationConfidence, 0.4);
  assert.equal(fallback.status, 'pending');
  assert.equal(fallback.thread.moderationConfidence, undefined);
});

test('admin moderation settings update the queue confidence threshold', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: {
      async moderate() {
        return { status: 'Flagged', labels: ['Spam'], confidence: 0.4 };
      }
    },
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const settings = await service.updateModerationSettings({ moderationConfidenceThreshold: 80 }, { actor: 'admin' });
  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'low confidence after admin threshold',
    captchaToken: 'dev-pass',
    ip: '203.0.113.11'
  });
  const persistedSettings = await service.getModerationSettings();

  assert.equal(settings.moderationConfidenceThreshold, 0.8);
  assert.equal(persistedSettings.moderationConfidenceThreshold, 0.8);
  assert.equal(created.status, 'published');
});

test('admin reports include priority metadata and support priority filtering', async () => {
  const store = createMemoryStore({
    version: 1,
    nextGlobalNumber: 3,
    threads: [
      {
        id: 'thread-pii',
        boardSlug: 'tam-su',
        body: 'Public PII report target',
        image: null,
        images: [],
        globalNumber: 1,
        posterHash: 'ID:PIIPOST',
        isPending: false,
        isDeleted: false,
        moderationStatus: 'Safe',
        moderationLabels: ['PII Risk'],
        createdAt: '2026-05-22T07:00:00.000Z',
        updatedAt: '2026-05-22T07:00:00.000Z'
      },
      {
        id: 'thread-spam',
        boardSlug: 'tam-su',
        body: 'Public spam report target',
        image: null,
        images: [],
        globalNumber: 2,
        posterHash: 'ID:SPAMPOST',
        isPending: false,
        isDeleted: false,
        moderationStatus: 'Safe',
        moderationLabels: [],
        createdAt: '2026-05-22T07:00:00.000Z',
        updatedAt: '2026-05-22T07:00:00.000Z'
      }
    ],
    reports: [
      {
        id: 'report-pii',
        postType: 'thread',
        postId: 'thread-pii',
        threadId: 'thread-pii',
        boardSlug: 'tam-su',
        globalNumber: 1,
        category: 'PII',
        reason: 'phone number',
        reporterHash: 'ID:REPORT1',
        status: 'open',
        createdAt: '2026-05-22T07:10:00.000Z'
      },
      {
        id: 'report-spam',
        postType: 'thread',
        postId: 'thread-spam',
        threadId: 'thread-spam',
        boardSlug: 'tam-su',
        globalNumber: 2,
        category: 'Spam',
        reason: 'spam',
        reporterHash: 'ID:REPORT2',
        status: 'open',
        createdAt: '2026-05-22T07:55:00.000Z'
      }
    ]
  });
  const service = createForumService({
    store,
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const reports = await service.listReports(10);
  const highPriority = await service.listReports(10, { priority: 'high' });
  const newest = await service.listReports(10, { sort: 'newest' });

  assert.deepEqual(reports.map((report) => report.globalNumber), [1, 2]);
  assert.equal(reports[0].moderationPriority.hasPiiRisk, true);
  assert.equal(reports[0].moderationPriority.level, 'high');
  assert.deepEqual(highPriority.map((report) => report.globalNumber), [1]);
  assert.deepEqual(newest.map((report) => report.globalNumber), [2, 1]);
});

test('admin reports use targeted moderation report reads when available', async () => {
  let hookArgs = null;
  const store = {
    async readReportsModerationState(args) {
      hookArgs = args;
      return {
        version: 1,
        nextGlobalNumber: 2,
        boards: [],
        users: [],
        threads: [
          {
            id: 'thread-pii',
            boardSlug: 'tam-su',
            body: 'Public PII report target',
            image: null,
            images: [],
            globalNumber: 1,
            posterHash: 'ID:PIIPOST',
            isPending: false,
            isDeleted: false,
            moderationStatus: 'Safe',
            moderationLabels: ['PII Risk'],
            createdAt: '2026-05-22T07:00:00.000Z',
            updatedAt: '2026-05-22T07:00:00.000Z'
          }
        ],
        comments: [],
        moderationActions: [],
        reports: [
          {
            id: 'report-pii',
            postType: 'thread',
            postId: 'thread-pii',
            threadId: 'thread-pii',
            boardSlug: 'tam-su',
            globalNumber: 1,
            category: 'PII',
            reason: 'phone number',
            reporterHash: 'ID:REPORT1',
            status: 'open',
            createdAt: '2026-05-22T07:10:00.000Z'
          }
        ],
        appeals: [],
        sanctions: [],
        adminSettings: {},
        aiUsage: {},
        aiSummaryCache: {},
        reportCounts: new Map([[1, 3]])
      };
    },
    async read() {
      throw new Error('full read should not be used');
    },
    async write() {
      throw new Error('write should not be used');
    }
  };
  const service = createForumService({
    store,
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const reports = await service.listReports(25, { boardSlug: 'tam-su', priority: 'high' });

  assert.equal(hookArgs.limit, 25);
  assert.equal(hookArgs.filters.boardSlug, 'tam-su');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].moderationPriority.reportCount, 3);
  assert.equal(reports[0].moderationPriority.level, 'high');
});


test('account and board reads use targeted store hooks when available', async () => {
  const calls = [];
  const targetedUser = {
    id: 'user-targeted',
    username: 'owner-targeted',
    passwordHash: 'hash',
    role: 'owner',
    settings: { theme: 'burichan', homeBoard: 'hoc-tap' },
    privateData: { watchlist: [{ threadId: 'thread-1' }], drafts: [], savedSearches: [], contentFilters: [], replyTemplates: [], posterNotes: [] },
    twoFactorEnabled: true,
    twoFactorSecret: 'JBSWY3DPEHPK3PXP',
    createdAt: '2026-05-22T08:00:00.000Z',
    updatedAt: '2026-05-22T08:00:00.000Z'
  };
  const store = {
    async readBoards() {
      calls.push('readBoards');
      return [{ slug: 'hoc-tap', name: 'Học tập', path: '/hoc-tap/', category: 'study' }];
    },
    async readUser(userId) {
      calls.push(['readUser', userId]);
      return userId === targetedUser.id ? targetedUser : null;
    },
    async readPrivilegedUsers() {
      calls.push('readPrivilegedUsers');
      return [targetedUser, { ...targetedUser, id: 'viewer-targeted', username: 'viewer-targeted', role: 'viewer' }];
    },
    async upsertAdminAccount(args) {
      calls.push(['upsertAdminAccount', args.username, args.role]);
      return { ...targetedUser, username: args.username, passwordHash: args.passwordHash, role: args.role };
    },
    async read() {
      throw new Error('full read should not be used');
    },
    async write() {
      throw new Error('write should not be used');
    }
  };
  const service = createForumService({
    store,
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const boards = await service.listBoards();
  const adminBoards = await service.listAdminBoards();
  const account = await service.getAccount(targetedUser.id);
  const privateData = await service.getAccountPrivateData(targetedUser.id);
  const admin = await service.getOrCreateAdminAccount('RootAdmin', 'new-admin-password');
  const privileged = await service.listPrivilegedUsers();

  assert.deepEqual(boards.map((board) => board.slug), ['hoc-tap']);
  assert.equal(adminBoards[0].slug, 'hoc-tap');
  assert.equal(account.username, targetedUser.username);
  assert.equal(privateData.watchlist[0].threadId, 'thread-1');
  assert.equal(admin.username, 'rootadmin');
  assert.deepEqual(privileged.map((user) => user.username), ['owner-targeted', 'viewer-targeted']);
  assert.deepEqual(calls.filter((call) => call === 'readBoards').length, 2);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'upsertAdminAccount'), true);
});

test('admin moderation lists use targeted store hooks when available', async () => {
  const calls = [];
  const baseThread = {
    id: 'thread-targeted',
    boardSlug: 'tam-su',
    body: 'Targeted moderation thread',
    image: null,
    images: [],
    globalNumber: 10,
    posterHash: 'ID:TARGET',
    isPending: false,
    isDeleted: false,
    moderationStatus: 'Safe',
    moderationLabels: [],
    createdAt: '2026-05-22T07:00:00.000Z',
    bumpedAt: '2026-05-22T07:00:00.000Z'
  };
  const store = {
    async readModerationActions(args) {
      calls.push(['actions', args.limit, args.filters.boardSlug]);
      return [{ id: 'action-1', action: 'admin:approve', actor: 'admin', postType: 'thread', postId: baseThread.id, threadId: baseThread.id, boardSlug: 'tam-su', globalNumber: 10, createdAt: '2026-05-22T07:20:00.000Z' }];
    },
    async readPendingModerationState() {
      calls.push(['pending']);
      return { version: 1, nextGlobalNumber: 11, boards: [], users: [], threads: [{ ...baseThread, isPending: true, moderationLabels: ['PII Risk'] }], comments: [], moderationActions: [], reports: [], appeals: [], sanctions: [], adminSettings: {}, aiUsage: {}, aiSummaryCache: {} };
    },
    async readDeletedModerationState(args) {
      calls.push(['deleted', args.limit, args.filters.boardSlug]);
      return { version: 1, nextGlobalNumber: 11, boards: [], users: [], threads: [{ ...baseThread, isDeleted: true, deletedAt: '2026-05-22T07:30:00.000Z' }], comments: [], moderationActions: [], reports: [], appeals: [], sanctions: [], adminSettings: {}, aiUsage: {}, aiSummaryCache: {} };
    },
    async readAppealsModerationState(args) {
      calls.push(['appeals', args.limit, args.filters.boardSlug]);
      return { version: 1, nextGlobalNumber: 11, boards: [], users: [], threads: [baseThread], comments: [], moderationActions: [], reports: [], appeals: [{ id: 'appeal-1', globalNumber: 10, boardSlug: 'tam-su', status: 'open', reason: 'Xin xem lai', submittedAt: '2026-05-22T07:40:00.000Z' }], sanctions: [], adminSettings: {}, aiUsage: {}, aiSummaryCache: {} };
    },
    async readSanctions(args) {
      calls.push(['sanctions', args.limit, args.filters.boardSlug]);
      return [{ id: 'sanction-1', kind: 'cooldown', boardSlug: 'tam-su', sourceGlobalNumber: 10, reason: 'Spam', actor: 'admin', createdAt: '2026-05-22T07:50:00.000Z', expiresAt: '2026-05-22T08:50:00.000Z' }];
    },
    async read() {
      throw new Error('full read should not be used');
    },
    async write() {
      throw new Error('write should not be used');
    }
  };
  const service = createForumService({
    store,
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const actions = await service.listModerationActions(5, { boardSlug: 'tam-su' });
  const pending = await service.listPending({ boardSlug: 'tam-su' }, 5);
  const deleted = await service.listDeleted(5, { boardSlug: 'tam-su' });
  const appeals = await service.listAppeals(5, { boardSlug: 'tam-su' });
  const sanctions = await service.listSanctions(5, { boardSlug: 'tam-su', status: 'active' });

  assert.deepEqual(actions.map((action) => action.globalNumber), [10]);
  assert.deepEqual(pending.map((post) => post.globalNumber), [10]);
  assert.deepEqual(deleted.map((post) => post.globalNumber), [10]);
  assert.deepEqual(appeals.map((appeal) => appeal.globalNumber), [10]);
  assert.deepEqual(sanctions.map((sanction) => sanction.id), ['sanction-1']);
  assert.deepEqual(calls.map((call) => call[0]), ['actions', 'pending', 'deleted', 'appeals', 'sanctions']);
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

test('expired event boards auto archive active threads and reject new posts', async () => {
  const realtime = createEvents();
  const dates = [
    new Date('2026-07-20T08:00:00.000Z'),
    new Date('2026-08-01T08:00:00.000Z'),
    new Date('2026-08-01T08:01:00.000Z'),
    new Date('2026-08-01T08:02:00.000Z')
  ];
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime,
    now: () => dates.shift() ?? new Date('2026-08-01T08:02:00.000Z')
  });
  const created = await service.createThread({
    boardSlug: 'thi-cuoi-ky',
    body: 'Thread truoc khi het su kien',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  const active = await service.listThreads('thi-cuoi-ky');
  const archive = await service.listArchivedThreads('thi-cuoi-ky');

  assert.equal(active.length, 0);
  assert.equal(archive.length, 1);
  assert.equal(archive[0].id, created.thread.id);
  assert.equal(archive[0].archivedReason, 'event-ended');
  assert.equal(realtime.events.some((item) => item.event === 'thread:archived'), true);
  await assert.rejects(
    () =>
      service.createThread({
        boardSlug: 'thi-cuoi-ky',
        body: 'Thread sau khi het su kien',
        captchaToken: 'dev-pass',
        ip: '203.0.113.8'
      }),
    /Bảng sự kiện đã kết thúc/
  );
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

test('board retention policy overrides active thread cap', async () => {
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
    lifecycle: { maxActiveThreadsPerBoard: 150, bumpLimit: 300, replyLimit: 500 }
  });
  await service.updateBoard('hoc-tap', {
    retentionPolicy: {
      maxActiveThreadsPerBoard: 1,
      bumpLimit: 300,
      replyLimit: 500,
      publicArchive: true
    }
  }, { actor: 'admin' });

  const first = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread bi policy archive',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  const second = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread con lai',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8'
  });

  const active = await service.listThreads('hoc-tap');
  const archive = await service.listArchivedThreads('hoc-tap');

  assert.deepEqual(active.map((thread) => thread.id), [second.thread.id]);
  assert.deepEqual(archive.map((thread) => thread.id), [first.thread.id]);
  assert.equal(archive[0].archivedReason, 'board-limit');
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

test('flagged spam or toxic comments raise thread slow mode for repeat posters', async () => {
  const moderationResults = [
    { status: 'Safe', labels: [] },
    { status: 'Flagged', labels: ['Spam'] },
    { status: 'Safe', labels: [] }
  ];
  const service = createForumService({
    store: createMemoryStore(),
    ai: {
      async moderate() {
        return moderationResults.shift() ?? { status: 'Safe', labels: [] };
      },
      async summarize() {
        return [];
      },
      async suggest() {
        return [];
      }
    },
    realtime: createEvents(),
    now: (() => {
      const dates = [
        new Date('2026-05-22T08:00:00.000Z'),
        new Date('2026-05-22T08:01:00.000Z'),
        new Date('2026-05-22T08:01:10.000Z')
      ];
      return () => dates.shift() ?? new Date('2026-05-22T08:01:10.000Z');
    })()
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread can slow mode',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  await service.createComment({
    threadId: created.thread.id,
    body: 'Spam bi flag',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8',
    posterToken: 'reader-a'
  });
  const detail = await service.getThread(created.thread.id);

  assert.equal(detail.thread.slowModeSeconds, 30);
  assert.ok(detail.thread.slowModeUntil);
  await assert.rejects(
    () =>
      service.createComment({
        threadId: created.thread.id,
        body: 'Gui lai qua nhanh',
        captchaToken: 'dev-pass',
        ip: '203.0.113.8',
        posterToken: 'reader-a'
      }),
    /chế độ chậm/
  );
});

test('sticky threads sort above normal threads and only active public threads can be sticky', async () => {
  const dates = [
    new Date('2026-05-22T08:00:00.000Z'),
    new Date('2026-05-22T08:01:00.000Z'),
    new Date('2026-05-22T08:02:00.000Z'),
    new Date('2026-05-22T08:03:00.000Z'),
    new Date('2026-05-22T08:04:00.000Z')
  ];
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => dates.shift() ?? new Date('2026-05-22T08:04:00.000Z')
  });

  const oldest = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Noi quy lop',
    captchaToken: 'dev-pass',
    deletePassword: 'owner-pass',
    ip: '203.0.113.7'
  });
  const middle = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Hoi lich hoc',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8'
  });
  const newest = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread moi nhat',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });

  const sticky = await service.setThreadSticky(oldest.thread.id, true, { actor: 'admin' });
  const listed = await service.listThreads('hoc-tap');
  await service.deletePost({ globalNumber: oldest.thread.globalNumber, password: 'owner-pass' });
  const afterDelete = await service.listThreads('hoc-tap');

  assert.equal(sticky.isSticky, true);
  assert.equal(sticky.stickiedAt, '2026-05-22T08:03:00.000Z');
  assert.equal(sticky.stickiedBy, undefined);
  assert.deepEqual(
    listed.map((thread) => thread.globalNumber),
    [oldest.thread.globalNumber, newest.thread.globalNumber, middle.thread.globalNumber]
  );
  assert.equal(afterDelete.some((thread) => thread.id === oldest.thread.id), false);
  await assert.rejects(() => service.setThreadSticky('missing-thread', true, { actor: 'admin' }), /Không tìm thấy chủ đề công khai/);
});

test('pending threads cannot be stickied onto the public board list', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: flaggedAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const pending = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread can duyet',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  const listed = await service.listThreads('hoc-tap');

  assert.equal(pending.thread.isPending, true);
  assert.equal(listed.length, 0);
  await assert.rejects(() => service.setThreadSticky(pending.thread.id, true, { actor: 'admin' }), /Không tìm thấy chủ đề công khai/);
});

test('OP proof follows local poster token without exposing the proof hash', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: (() => {
      const dates = [
        new Date('2026-05-22T08:00:00.000Z'),
        new Date('2026-05-22T08:02:00.000Z'),
        new Date('2026-05-22T08:04:00.000Z')
      ];
      return () => dates.shift() ?? new Date('2026-05-22T08:04:00.000Z');
    })()
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'OP doi mang van can badge',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7',
    posterToken: 'op-browser-token'
  });
  const opReply = await service.createComment({
    threadId: created.thread.id,
    body: 'OP quay lai bang token local',
    captchaToken: 'dev-pass',
    ip: '198.51.100.9',
    posterToken: 'op-browser-token'
  });
  await service.createComment({
    threadId: created.thread.id,
    body: 'Nguoi khac tra loi',
    captchaToken: 'dev-pass',
    ip: '198.51.100.9',
    posterToken: 'other-browser-token'
  });
  const detail = await service.getThread(created.thread.id);

  assert.notEqual(created.thread.posterHash, opReply.comment.posterHash);
  assert.equal(opReply.comment.isOp, true);
  assert.equal(detail.comments[0].isOp, true);
  assert.equal(detail.comments[1].isOp, false);
  assert.equal('opProofHash' in detail.thread, false);
  assert.equal('opProofHash' in detail.comments[0], false);
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

test('recommended threads rank active public candidates with transparent scoring', async () => {
  const service = createForumService({
    store: createMemoryStore({
      version: 1,
      nextGlobalNumber: 10,
      threads: [
        {
          id: 'thread-active',
          boardSlug: 'hoc-tap',
          body: 'Nhieu nguoi dang thao luan',
          image: null,
          globalNumber: 1,
          posterHash: 'ID:ACTIVE',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          votes: { up: 2, down: 0 },
          createdAt: '2026-05-22T06:00:00.000Z',
          bumpedAt: '2026-05-22T08:40:00.000Z'
        },
        {
          id: 'thread-fresh',
          boardSlug: 'hoc-tap',
          body: 'Moi dang',
          image: null,
          globalNumber: 2,
          posterHash: 'ID:FRESH',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T08:55:00.000Z',
          bumpedAt: '2026-05-22T08:55:00.000Z'
        },
        {
          id: 'thread-risky',
          boardSlug: 'hoc-tap',
          body: 'Moi dang nhung bi bao cao',
          image: null,
          globalNumber: 9,
          posterHash: 'ID:RISKY',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          votes: { up: 10, down: 0 },
          createdAt: '2026-05-22T08:58:00.000Z',
          bumpedAt: '2026-05-22T08:58:00.000Z'
        },
        {
          id: 'thread-pending',
          boardSlug: 'hoc-tap',
          body: 'Dang cho duyet',
          image: null,
          globalNumber: 3,
          posterHash: 'ID:PENDING',
          isPending: true,
          isDeleted: false,
          moderationStatus: 'Flagged',
          moderationLabels: ['Spam'],
          createdAt: '2026-05-22T08:58:00.000Z',
          bumpedAt: '2026-05-22T08:58:00.000Z'
        },
        {
          id: 'thread-archived',
          boardSlug: 'hoc-tap',
          body: 'Da luu tru',
          image: null,
          globalNumber: 4,
          posterHash: 'ID:ARCHIVED',
          isPending: false,
          isDeleted: false,
          isArchived: true,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T08:50:00.000Z',
          bumpedAt: '2026-05-22T08:50:00.000Z'
        },
        {
          id: 'thread-stale',
          boardSlug: 'hoc-tap',
          body: 'Qua cu',
          image: null,
          globalNumber: 5,
          posterHash: 'ID:STALE',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-20T08:00:00.000Z',
          bumpedAt: '2026-05-20T08:00:00.000Z'
        }
      ],
      comments: [
        {
          id: 'comment-active-1',
          threadId: 'thread-active',
          boardSlug: 'hoc-tap',
          body: 'Tra loi 1',
          globalNumber: 6,
          posterHash: 'ID:C1',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T08:30:00.000Z'
        },
        {
          id: 'comment-active-2',
          threadId: 'thread-active',
          boardSlug: 'hoc-tap',
          body: 'Tra loi 2',
          globalNumber: 7,
          posterHash: 'ID:C2',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T08:40:00.000Z'
        },
        {
          id: 'comment-pending',
          threadId: 'thread-active',
          boardSlug: 'hoc-tap',
          body: 'Pending',
          globalNumber: 8,
          posterHash: 'ID:C3',
          isPending: true,
          isDeleted: false,
          moderationStatus: 'Flagged',
          moderationLabels: ['Spam'],
          createdAt: '2026-05-22T08:45:00.000Z'
        }
      ],
      reports: [
        {
          id: 'report-risky-1',
          postType: 'thread',
          postId: 'thread-risky',
          threadId: 'thread-risky',
          boardSlug: 'hoc-tap',
          globalNumber: 9,
          category: 'Spam',
          reason: 'Spam',
          status: 'open',
          createdAt: '2026-05-22T08:59:00.000Z'
        },
        {
          id: 'report-risky-2',
          postType: 'thread',
          postId: 'thread-risky',
          threadId: 'thread-risky',
          boardSlug: 'hoc-tap',
          globalNumber: 9,
          category: 'Spam',
          reason: 'Spam',
          status: 'open',
          createdAt: '2026-05-22T08:59:10.000Z'
        },
        {
          id: 'report-risky-3',
          postType: 'thread',
          postId: 'thread-risky',
          threadId: 'thread-risky',
          boardSlug: 'hoc-tap',
          globalNumber: 9,
          category: 'Spam',
          reason: 'Spam',
          status: 'open',
          createdAt: '2026-05-22T08:59:20.000Z'
        },
        {
          id: 'report-risky-4',
          postType: 'thread',
          postId: 'thread-risky',
          threadId: 'thread-risky',
          boardSlug: 'hoc-tap',
          globalNumber: 9,
          category: 'Spam',
          reason: 'Spam',
          status: 'open',
          createdAt: '2026-05-22T08:59:30.000Z'
        }
      ]
    }),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T09:00:00.000Z')
  });

  const recommended = await service.listRecommendedThreads(10, { maxAgeHours: 24 });

  assert.deepEqual(recommended.map((thread) => thread.id), ['thread-active', 'thread-fresh', 'thread-risky']);
  assert.ok(recommended[0].recommendation.score > recommended[1].recommendation.score);
  assert.ok(recommended[1].recommendation.score > recommended[2].recommendation.score);
  assert.deepEqual(recommended[0].recommendation.reasons, [
    'recent-activity',
    'active-discussion',
    'positive-votes'
  ]);
  assert.deepEqual(recommended[0].recommendation.sources, ['engagement', 'recent-activity']);
  assert.equal(recommended[0].recommendation.features.replyCount, 2);
  assert.equal(recommended[0].recommendation.features.recentReplyCount, 2);
  assert.equal(recommended[2].recommendation.features.openReportCount, 4);
  assert.ok(recommended[2].recommendation.reasons.includes('safety-penalty'));
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

test('campus pulse counts public keywords from the last 24 hours without user data', async () => {
  const service = createForumService({
    store: createMemoryStore({
      threads: [
        {
          id: 'thread-deadline',
          boardSlug: 'hoc-tap',
          body: 'Deadline đồ án nhóm đang căng',
          image: null,
          globalNumber: 1,
          posterHash: 'ID:PULSE1',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T08:00:00.000Z',
          bumpedAt: '2026-05-22T08:00:00.000Z'
        },
        {
          id: 'thread-clb',
          boardSlug: 'tuyen-clb',
          body: 'Tuyển CLB truyền thông hỏi deadline vòng đơn',
          image: null,
          globalNumber: 2,
          posterHash: 'ID:PULSE2',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T08:10:00.000Z',
          bumpedAt: '2026-05-22T08:10:00.000Z'
        },
        {
          id: 'thread-old-pulse',
          boardSlug: 'hoc-tap',
          body: 'deadline cu',
          image: null,
          globalNumber: 3,
          posterHash: 'ID:OLDPULSE',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-20T08:00:00.000Z',
          bumpedAt: '2026-05-20T08:00:00.000Z'
        }
      ],
      comments: [
        {
          id: 'comment-deadline',
          threadId: 'thread-deadline',
          boardSlug: 'hoc-tap',
          body: 'Deadline lab cần cứu',
          globalNumber: 4,
          posterHash: 'ID:PULSE3',
          isPending: false,
          isDeleted: false,
          moderationStatus: 'Safe',
          moderationLabels: [],
          createdAt: '2026-05-22T08:30:00.000Z'
        },
        {
          id: 'comment-pending-pulse',
          threadId: 'thread-deadline',
          boardSlug: 'hoc-tap',
          body: 'deadline pending',
          globalNumber: 5,
          posterHash: 'ID:PENDINGPULSE',
          isPending: true,
          isDeleted: false,
          moderationStatus: 'Flagged',
          moderationLabels: ['Spam'],
          createdAt: '2026-05-22T08:40:00.000Z'
        }
      ]
    }),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T09:00:00.000Z')
  });

  const pulse = await service.listCampusPulse(5);
  const deadline = pulse.find((item) => item.keyword === 'deadline');

  assert.equal(deadline.count, 3);
  assert.equal(deadline.boardCount, 2);
  assert.equal(JSON.stringify(pulse).includes('PULSE'), false);
});

test('thread summaries are cached until public thread content changes', async () => {
  let summarizeCalls = 0;
  const ai = {
    async moderate() {
      return { status: 'Safe', labels: [] };
    },
    async summarize() {
      summarizeCalls += 1;
      return [`Tom tat lan ${summarizeCalls}`];
    },
    async suggest() {
      return [];
    }
  };
  const dates = [
    new Date('2026-05-22T08:00:00.000Z'),
    new Date('2026-05-22T08:01:00.000Z'),
    new Date('2026-05-22T08:02:00.000Z'),
    new Date('2026-05-22T08:03:00.000Z')
  ];
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime: createEvents(),
    now: () => dates.shift() ?? new Date('2026-05-22T08:03:00.000Z')
  });
  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Can tom tat',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  const first = await service.summarizeThread(created.thread.id, { ip: '203.0.113.8', posterToken: 'reader' });
  const second = await service.summarizeThread(created.thread.id, { ip: '203.0.113.8', posterToken: 'reader' });
  await service.createComment({
    threadId: created.thread.id,
    body: 'Noi dung moi',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });
  const third = await service.summarizeThread(created.thread.id, { ip: '203.0.113.8', posterToken: 'reader' });

  assert.deepEqual(first, ['Tom tat lan 1']);
  assert.deepEqual(second, ['Tom tat lan 1']);
  assert.deepEqual(third, ['Tom tat lan 2']);
  assert.equal(summarizeCalls, 2);
});

test('thread summary can target only comments newer than last seen post number', async () => {
  const summarizedBodies = [];
  const ai = {
    async moderate() {
      return { status: 'Safe', labels: [] };
    },
    async summarize(items) {
      summarizedBodies.push(items.map((item) => item.body));
      return ['Tom tat phan moi'];
    },
    async suggest() {
      return [];
    }
  };
  const dates = [
    new Date('2026-05-22T08:00:00.000Z'),
    new Date('2026-05-22T08:01:00.000Z'),
    new Date('2026-05-22T08:02:00.000Z'),
    new Date('2026-05-22T08:03:00.000Z')
  ];
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime: createEvents(),
    now: () => dates.shift() ?? new Date('2026-05-22T08:03:00.000Z')
  });
  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'OP khong nen vao tom tat moi',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  const firstComment = await service.createComment({
    threadId: created.thread.id,
    body: 'Binh luan da doc',
    captchaToken: 'dev-pass',
    ip: '203.0.113.8'
  });
  const secondComment = await service.createComment({
    threadId: created.thread.id,
    body: 'Binh luan moi can tom tat',
    captchaToken: 'dev-pass',
    ip: '203.0.113.9'
  });

  const summary = await service.summarizeThread(created.thread.id, {
    ip: '203.0.113.10',
    posterToken: 'reader',
    sinceGlobalNumber: firstComment.comment.globalNumber
  });
  const emptySummary = await service.summarizeThread(created.thread.id, {
    ip: '203.0.113.10',
    posterToken: 'reader',
    sinceGlobalNumber: secondComment.comment.globalNumber
  });

  assert.deepEqual(summary, ['Tom tat phan moi']);
  assert.deepEqual(summarizedBodies, [['Binh luan moi can tom tat']]);
  assert.deepEqual(emptySummary, ['Chưa có bình luận mới từ lần đọc trước.']);
});

test('AI suggestion budget is limited per reader identity per day', async () => {
  const ai = {
    async moderate() {
      return { status: 'Safe', labels: [] };
    },
    async summarize() {
      return [];
    },
    async suggest() {
      return ['Goi y'];
    }
  };
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });
  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Can goi y',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  for (let index = 0; index < 30; index += 1) {
    await service.suggestComments(created.thread.id, { ip: '203.0.113.8', posterToken: 'reader' });
  }

  await assert.rejects(
    () => service.suggestComments(created.thread.id, { ip: '203.0.113.8', posterToken: 'reader' }),
    /giới hạn dùng AI/
  );
  await assert.doesNotReject(() =>
    service.suggestComments(created.thread.id, { ip: '203.0.113.9', posterToken: 'other-reader' })
  );
});

test('safe rewrite draft uses AI budget and does not store the rewritten draft as a post', async () => {
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
      return `An toan: ${text}`;
    }
  };
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const rewritten = await service.rewriteDraft({
    body: 'Ban A lua dao, sdt 0901234567',
    ip: '203.0.113.8',
    posterToken: 'reader'
  });
  const stats = await service.getStats();

  assert.equal(rewritten, 'An toan: Ban A lua dao, sdt 0901234567');
  assert.equal(stats.totalPosts, 0);
});

test('jwt verification rejects tampered tokens', () => {
  const token = signJwt({ role: 'admin' }, 'secret', { expiresInSeconds: 60 });
  const verified = verifyJwt(token, 'secret');

  assert.equal(verified.role, 'admin');
  assert.throws(() => verifyJwt(`${token.slice(0, -1)}x`, 'secret'), /Invalid token/);
});

test('jwt verification normalizes malformed token errors', () => {
  assert.throws(() => verifyJwt('not-json.not-json.signature', 'secret'), /Invalid token/);
});

test('security config status reports readiness without exposing values', () => {
  const status = securityConfigStatus({
    jwtSecret: 'short',
    adminUsername: 'admin',
    adminPassword: 'pass',
    hcaptchaSecret: '',
    moderationFingerprintSecret: '',
    posterProofSecret: ''
  });

  assert.equal(status.adminConfigured, true);
  assert.equal(status.hcaptchaConfigured, false);
  assert.ok(status.warnings.includes('jwt_secret_short'));
  assert.ok(status.warnings.includes('admin_username_default_or_missing'));
  assert.ok(status.warnings.includes('admin_password_weak_or_missing'));
  assert.ok(status.warnings.includes('hcaptcha_not_configured'));
  assert.equal(Object.hasOwn(status, 'jwtSecret'), false);
  assert.equal(Object.hasOwn(status, 'adminPassword'), false);
});

test('assertProductionSecrets throws in production with insecure config and never leaks values', () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    HCAPTCHA_SECRET: process.env.HCAPTCHA_SECRET,
    MODERATION_FINGERPRINT_SECRET: process.env.MODERATION_FINGERPRINT_SECRET,
    POSTER_PROOF_SECRET: process.env.POSTER_PROOF_SECRET
  };
  process.env.NODE_ENV = 'production';
  delete process.env.HCAPTCHA_SECRET;
  delete process.env.MODERATION_FINGERPRINT_SECRET;
  delete process.env.POSTER_PROOF_SECRET;

  try {
    assert.throws(
      () =>
        assertProductionSecrets({
          jwtSecret: 'change-me-please',
          adminUsername: 'root',
          adminPassword: 'a-strong-admin-password'
        }),
      (error) => {
        assert.ok(/insecure secret configuration/.test(error.message));
        assert.ok(!error.message.includes('change-me-please'));
        return true;
      }
    );

    // A fully-configured production setup passes.
    const ok = assertProductionSecrets({
      jwtSecret: 'a'.repeat(40),
      adminUsername: 'root',
      adminPassword: 'a-strong-admin-password',
      hcaptchaSecret: 'hc-secret',
      moderationFingerprintSecret: 'mod-secret',
      posterProofSecret: 'proof-secret'
    });
    assert.ok(Array.isArray(ok.warnings));
  } finally {
    for (const key of Object.keys(originalEnv)) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('assertProductionSecrets only warns (never throws) outside production', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const status = assertProductionSecrets({ jwtSecret: '', adminUsername: 'admin', adminPassword: 'pass' });
    assert.ok(status.warnings.length > 0);
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }
});

test('hashing secrets refuse the dev literal fallback in production', () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    MODERATION_FINGERPRINT_SECRET: process.env.MODERATION_FINGERPRINT_SECRET,
    POSTER_PROOF_SECRET: process.env.POSTER_PROOF_SECRET
  };
  process.env.NODE_ENV = 'production';
  delete process.env.JWT_SECRET;
  delete process.env.MODERATION_FINGERPRINT_SECRET;
  delete process.env.POSTER_PROOF_SECRET;

  try {
    assert.throws(() => createModerationFingerprint({ ip: '203.0.113.7', posterToken: 'abc' }), /MODERATION_FINGERPRINT_SECRET/);
    assert.throws(() => createPosterProofHash({ threadId: 't1', posterToken: 'abc' }), /POSTER_PROOF_SECRET/);

    // With a dedicated secret present, hashing works.
    process.env.MODERATION_FINGERPRINT_SECRET = 'mod-secret';
    process.env.POSTER_PROOF_SECRET = 'proof-secret';
    assert.equal(typeof createModerationFingerprint({ ip: '203.0.113.7', posterToken: 'abc' }), 'string');
    assert.equal(typeof createPosterProofHash({ threadId: 't1', posterToken: 'abc' }), 'string');
  } finally {
    for (const key of Object.keys(originalEnv)) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('hCaptcha dev fallback is disabled in production without a secret', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.HCAPTCHA_SECRET;
  process.env.NODE_ENV = 'production';
  delete process.env.HCAPTCHA_SECRET;

  try {
    assert.equal(await verifyHcaptcha('dev-pass', '127.0.0.1'), false);
    assert.equal(await verifyHcaptcha('long-development-token', '127.0.0.1'), false);
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalSecret === undefined) {
      delete process.env.HCAPTCHA_SECRET;
    } else {
      process.env.HCAPTCHA_SECRET = originalSecret;
    }
  }
});

test('AI safe rewrite draft supports different tones', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const neutral = await service.rewriteDraft({ body: 'original text', tone: 'neutral' });
  const aggressive = await service.rewriteDraft({ body: 'original text', tone: 'less-aggressive' });
  const privacy = await service.rewriteDraft({ body: 'original text', tone: 'privacy-safer' });

  assert.equal(neutral, 'Da sua [neutral]: original text');
  assert.equal(aggressive, 'Da sua [less-aggressive]: original text');
  assert.equal(privacy, 'Da sua [privacy-safer]: original text');
});

test('AI report assistant summarizes post reports', async () => {
  const store = createMemoryStore();
  const service = createForumService({
    store,
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const created = await service.createThread({
    boardSlug: 'hoc-tap',
    body: 'Thread to be reported',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  await service.reportPost({
    globalNumber: created.thread.globalNumber,
    reason: 'spam link',
    ip: '203.0.113.8'
  });
  await service.reportPost({
    globalNumber: created.thread.globalNumber,
    reason: 'toxic behavior',
    ip: '203.0.113.9'
  });

  const summary = await service.summarizePostReports(created.thread.globalNumber, {
    ip: '127.0.0.1',
    actor: 'admin'
  });

  assert.equal(summary, 'AI tong hop: spam link, toxic behavior');
});

test('getAnalytics calculates board-level counts, AI usage, and moderation health correctly', async () => {
  const store = createMemoryStore();
  const service = createForumService({
    store,
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  let analytics = await service.getAnalytics();
  assert.equal(typeof analytics.boardActivity, 'object');
  assert.equal(analytics.boardActivity['hoc-tap'].activeThreads, 0);
  assert.equal(analytics.aiUsage.byKind.moderation, 0);
  assert.equal(analytics.aiUsage.total, 0);
  assert.equal(analytics.moderationQueue.pendingCount, 0);
  assert.equal(analytics.moderationQueue.oldestPendingAgeMinutes, 0);
  assert.equal(analytics.moderationQueue.averageResolutionTimeMinutes, 0);

  const flaggedService = createForumService({
    store,
    ai: flaggedAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  await flaggedService.createThread({
    boardSlug: 'hoc-tap',
    body: 'Flagged spam body',
    captchaToken: 'dev-pass',
    ip: '203.0.113.11'
  });

  await service.rewriteDraft({
    body: 'Test rewrite body',
    ip: '203.0.113.12',
    posterToken: 'reader-xyz'
  });

  analytics = await service.getAnalytics();
  assert.equal(analytics.aiUsage.total, 1);
  assert.deepEqual(Object.keys(analytics.aiUsage.byKind).sort(), ['moderation', 'rewrite', 'suggestion', 'summary']);
  assert.equal(analytics.aiUsage.byKind.rewrite, 1);
  assert.equal(analytics.boardActivity['hoc-tap'].pendingThreads, 1);
  assert.equal(analytics.moderationQueue.pendingCount, 1);
  assert.equal(analytics.moderationQueue.pendingThreads, 1);
  assert.equal(analytics.moderationQueue.oldestPendingAgeMinutes, 0);
});

test('AI OpenAI-compatible client uses correct configuration and request format', async () => {
  const originalFetch = global.fetch;
  const envKeys = [
    'AI_PROVIDER',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_BASE_URL',
    'OPENAI_COMPATIBLE_MODEL'
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.AI_PROVIDER = 'openai-compatible';
  process.env.OPENAI_COMPATIBLE_API_KEY = 'openai-test-key';
  process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai-test.com/v1';
  process.env.OPENAI_COMPATIBLE_MODEL = 'gpt-4-test';

  const capturedRequests = [];

  global.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: '{"status":"Safe","labels":[],"confidence":0.72}'
              }
            }
          ]
        };
      }
    };
  };

  try {
    const ai = createAiClient();
    const result = await ai.moderate('nội dung an toàn');

    assert.deepEqual(result, { status: 'Safe', labels: [], confidence: 0.72 });
    assert.equal(capturedRequests[0].url, 'https://api.openai-test.com/v1/chat/completions');
    assert.equal(capturedRequests[0].options.headers.authorization, 'Bearer openai-test-key');
    assert.equal(capturedRequests[0].options.headers['content-type'], 'application/json');

    const body = JSON.parse(capturedRequests[0].options.body);
    assert.equal(body.model, 'gpt-4-test');
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[1].role, 'user');
    assert.equal(body.messages[1].content.includes('nội dung an toàn'), true);

    await ai.rewrite('email test@example.com', 'privacy-safer');
    const rewriteBody = JSON.parse(capturedRequests[1].options.body);
    assert.equal(rewriteBody.messages[0].content.includes('AN TOÀN RIÊNG TƯ'), true);
    assert.equal(rewriteBody.messages[1].content.includes('test@example.com'), false);

    await ai.summarizeReports(['lộ email report@example.com và số 0912345678']);
    const reportBody = JSON.parse(capturedRequests[2].options.body);
    assert.equal(reportBody.messages[0].content.includes('Tổng hợp danh sách lý do báo cáo'), true);
    assert.equal(reportBody.messages[1].content.includes('report@example.com'), false);
    assert.equal(reportBody.messages[1].content.includes('0912345678'), false);

    await ai.moderateImage({ data: 'AAAA', mimeType: 'image/avif' });
    const imageModerationBody = JSON.parse(capturedRequests[3].options.body);
    assert.equal(imageModerationBody.messages[0].content.includes('kiểm duyệt ảnh'), true);
    assert.equal(imageModerationBody.messages[1].content[1].image_url.url, 'data:image/avif;base64,AAAA');
  } finally {
    global.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('AI Google TTS uses interactions audio response and returns WAV audio', async () => {
  const originalFetch = global.fetch;
  const envKeys = ['AI_PROVIDER', 'GOOGLE_AI_API_KEY', 'GOOGLE_TTS_MODEL'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.AI_PROVIDER = 'google-ai-studio';
  process.env.GOOGLE_AI_API_KEY = 'google-test-key';
  process.env.GOOGLE_TTS_MODEL = 'gemini-3.1-flash-tts-preview';

  const capturedRequests = [];
  const rawPcm = Buffer.from([0, 1, 2, 3]).toString('base64');

  global.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          interaction: {
            outputAudio: {
              data: rawPcm,
              mimeType: 'audio/pcm;rate=24000'
            }
          }
        };
      }
    };
  };

  try {
    const ai = createAiClient();
    const result = await ai.speak('Xin chào test@example.com', { voice: 'Kore' });

    assert.equal(
      capturedRequests[0].url,
      'https://generativelanguage.googleapis.com/v1beta/interactions'
    );
    assert.equal(capturedRequests[0].options.headers['content-type'], 'application/json');
    assert.equal(capturedRequests[0].options.headers['x-goog-api-key'], 'google-test-key');

    const body = JSON.parse(capturedRequests[0].options.body);
    assert.equal(body.model, 'gemini-3.1-flash-tts-preview');
    assert.deepEqual(body.response_format, { type: 'audio' });
    assert.deepEqual(body.generation_config.speech_config, [{ voice: 'Kore' }]);
    assert.equal(body.input.includes('Read the transcript below exactly as written in Vietnamese.'), true);
    assert.equal(body.input.includes('Do not translate, romanize, summarize, or add any words.'), true);
    assert.equal(body.input.includes('test@example.com'), false);

    const wav = Buffer.from(result.data, 'base64');
    assert.equal(result.mimeType, 'audio/wav');
    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  } finally {
    global.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('AI Google TTS honors explicit language hints for post audio', async () => {
  const originalFetch = global.fetch;
  const envKeys = ['AI_PROVIDER', 'GOOGLE_AI_API_KEY', 'GOOGLE_TTS_MODEL'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.AI_PROVIDER = 'google-ai-studio';
  process.env.GOOGLE_AI_API_KEY = 'google-test-key';
  process.env.GOOGLE_TTS_MODEL = 'gemini-3.1-flash-tts-preview';

  let capturedBody;
  global.fetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          output_audio: {
            data: Buffer.from([0, 1]).toString('base64'),
            mime_type: 'audio/pcm;rate=24000'
          }
        };
      }
    };
  };

  try {
    const ai = createAiClient();
    const result = await ai.speak('This comment should be read as English.', { languageCode: 'en-US' });

    assert.equal(result.mimeType, 'audio/wav');
    assert.equal(capturedBody.input.includes('exactly as written in English.'), true);
    assert.equal(capturedBody.input.includes('This comment should be read as English.'), true);
  } finally {
    global.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('AI Google TTS retries when response has no audio block', async () => {
  const originalFetch = global.fetch;
  const envKeys = ['AI_PROVIDER', 'GOOGLE_AI_API_KEY', 'GOOGLE_TTS_MODEL'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.AI_PROVIDER = 'google-ai-studio';
  process.env.GOOGLE_AI_API_KEY = 'google-test-key';
  process.env.GOOGLE_TTS_MODEL = 'gemini-3.1-flash-tts-preview';

  let attempts = 0;
  const rawPcm = Buffer.from([4, 5, 6, 7]).toString('base64');
  global.fetch = async () => {
    attempts += 1;
    return {
      ok: true,
      async json() {
        return attempts === 1
          ? { output_text: 'Xin lỗi, tôi không tạo được audio.' }
          : {
              output_audio: {
                data: rawPcm,
                mime_type: 'audio/pcm;rate=24000'
              }
            };
      }
    };
  };

  try {
    const ai = createAiClient();
    const result = await ai.speak('Xin chào');
    assert.equal(attempts, 2);
    assert.equal(result.mimeType, 'audio/wav');
    assert.equal(Buffer.from(result.data, 'base64').subarray(0, 4).toString('ascii'), 'RIFF');
  } finally {
    global.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('AI Google TTS exposes provider rate limit as 429', async () => {
  const originalFetch = global.fetch;
  const envKeys = ['AI_PROVIDER', 'GOOGLE_AI_API_KEY', 'GOOGLE_TTS_MODEL'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.AI_PROVIDER = 'google-ai-studio';
  process.env.GOOGLE_AI_API_KEY = 'google-test-key';
  process.env.GOOGLE_TTS_MODEL = 'gemini-3.1-flash-tts-preview';

  global.fetch = async () => ({
    ok: false,
    status: 429
  });

  try {
    const ai = createAiClient();
    await assert.rejects(
      () => ai.speak('Xin chào'),
      (error) => error.statusCode === 429 && /giới hạn/.test(error.message)
    );
  } finally {
    global.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('AI Google TTS exposes missing audio as bad gateway', async () => {
  const originalFetch = global.fetch;
  const envKeys = ['AI_PROVIDER', 'GOOGLE_AI_API_KEY', 'GOOGLE_TTS_MODEL'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.AI_PROVIDER = 'google-ai-studio';
  process.env.GOOGLE_AI_API_KEY = 'google-test-key';
  process.env.GOOGLE_TTS_MODEL = 'gemini-3.1-flash-tts-preview';

  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return {
      ok: true,
      async json() {
        return { output_text: 'Xin lỗi, tôi không tạo được audio.' };
      }
    };
  };

  try {
    const ai = createAiClient();
    await assert.rejects(
      () => ai.speak('Xin chào'),
      (error) => error.statusCode === 502 && /chưa trả về audio/.test(error.message)
    );
    assert.equal(attempts, 2);
  } finally {
    global.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('AI TTS times out when provider does not respond', async () => {
  const originalFetch = global.fetch;
  const envKeys = ['AI_PROVIDER', 'GOOGLE_AI_API_KEY', 'AI_FETCH_TIMEOUT_MS'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.AI_PROVIDER = 'google-ai-studio';
  process.env.GOOGLE_AI_API_KEY = 'google-test-key';
  process.env.AI_FETCH_TIMEOUT_MS = '5';

  global.fetch = async (_url, options) => {
    await new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };

  try {
    const ai = createAiClient();
    await assert.rejects(() => ai.speak('Xin chào'), /quá thời gian chờ/);
  } finally {
    global.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('AI transcription times out when provider does not respond', async () => {
  const originalFetch = global.fetch;
  const envKeys = ['AI_PROVIDER', 'GOOGLE_AI_API_KEY', 'AI_FETCH_TIMEOUT_MS'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.AI_PROVIDER = 'google-ai-studio';
  process.env.GOOGLE_AI_API_KEY = 'google-test-key';
  process.env.AI_FETCH_TIMEOUT_MS = '5';

  global.fetch = async (_url, options) => {
    await new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };

  try {
    const ai = createAiClient();
    await assert.rejects(
      () => ai.transcribe({ data: 'AAAA', mimeType: 'audio/mpeg', filename: 'clip.mp3' }),
      /quá thời gian chờ/
    );
  } finally {
    global.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('AI Google client can route only speech-to-text through Groq Whisper', async () => {
  const originalFetch = global.fetch;
  const envKeys = [
    'AI_PROVIDER',
    'GOOGLE_AI_API_KEY',
    'TRANSCRIBE_PROVIDER',
    'TRANSCRIBE_BASE_URL',
    'GROQ_API_KEY',
    'TRANSCRIBE_MODEL'
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.AI_PROVIDER = 'google-ai-studio';
  process.env.GOOGLE_AI_API_KEY = 'google-test-key';
  process.env.TRANSCRIBE_PROVIDER = 'openai-compatible';
  process.env.TRANSCRIBE_BASE_URL = 'https://api.groq.com/openai/v1';
  process.env.GROQ_API_KEY = 'groq-test-key';
  process.env.TRANSCRIBE_MODEL = 'whisper-large-v3';

  const capturedRequests = [];

  global.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    return {
      ok: true,
      async json() {
        return { text: 'Lời nói đã chép lại' };
      }
    };
  };

  try {
    const ai = createAiClient();
    const text = await ai.transcribe({
      data: 'data:audio/webm;codecs=opus;base64,AAAA',
      mimeType: 'audio/webm;codecs=opus',
      filename: 'recording.webm'
    });

    assert.equal(text, 'Lời nói đã chép lại');
    assert.equal(capturedRequests[0].url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(capturedRequests[0].options.headers.authorization, 'Bearer groq-test-key');
    assert.equal(capturedRequests[0].options.body.get('model'), 'whisper-large-v3');
    assert.equal(capturedRequests[0].options.body.get('file').type, 'audio/webm');
  } finally {
    global.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test('publicConfig reports OpenAI-compatible auto-detect when AI_PROVIDER is unset', () => {
  const envKeys = [
    'AI_PROVIDER',
    'GOOGLE_AI_API_KEY',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_BASE_URL',
    'OPENAI_COMPATIBLE_MODEL'
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  delete process.env.AI_PROVIDER;
  delete process.env.GOOGLE_AI_API_KEY;
  process.env.OPENAI_COMPATIBLE_API_KEY = 'openai-test-key';
  process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai-test.com/v1';
  process.env.OPENAI_COMPATIBLE_MODEL = 'gpt-4-test';

  try {
    const config = publicConfig();
    assert.equal(config.ai.provider, 'openai-compatible');
    assert.equal(config.ai.configured, true);
    assert.equal(config.ai.model, 'gpt-4-test');
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

test('rate limiter evicts expired buckets so the map stays bounded', () => {
  const windowMs = 1000;
  const limiter = createRateLimiter({ limit: 5, windowMs, sweepIntervalMs: 0 });
  try {
    for (let i = 0; i < 50; i += 1) {
      limiter.check(`ip-${i}`);
    }
    assert.equal(limiter.size(), 50);

    // After the window passes, a sweep removes every expired entry.
    limiter.sweep(Date.now() + windowMs + 1);
    assert.equal(limiter.size(), 0);
  } finally {
    limiter.stop();
  }
});

test('rate limiter enforces the limit and accepts a shared Map-like backend', () => {
  const shared = new Map();
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, store: shared, sweepIntervalMs: 0 });
  try {
    assert.equal(limiter.check('k').ok, true); // 1
    assert.equal(limiter.check('k').ok, true); // 2
    assert.equal(limiter.check('k').ok, false); // 3 over limit
    // State lives in the injected backend, not a private Map.
    assert.equal(shared.has('k'), true);
    assert.equal(shared.get('k').count, 3);
  } finally {
    limiter.stop();
  }
});

test('rate limiter accepts an atomic async shared backend', async () => {
  const counts = new Map();
  const store = {
    async increment(key, { windowMs, now }) {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { count, resetAt: now + windowMs };
    }
  };
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, store, sweepIntervalMs: 0 });

  assert.equal((await limiter.check('ip:thread:hoc-tap')).ok, true);
  assert.equal((await limiter.check('ip:thread:hoc-tap')).ok, true);
  const blocked = await limiter.check('ip:thread:hoc-tap');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfter, 60);
  assert.equal(limiter.size(), undefined);
});

test('rate limiter fail-open and fail-closed modes handle shared store errors', async () => {
  const errors = [];
  const store = {
    async increment() {
      throw new Error('redis unavailable');
    }
  };

  const openLimiter = createRateLimiter({
    limit: 2,
    windowMs: 60_000,
    store,
    failureMode: 'open',
    onStoreError(error) {
      errors.push(error.message);
    }
  });
  const closedLimiter = createRateLimiter({ limit: 2, windowMs: 60_000, store, failureMode: 'closed' });

  assert.deepEqual(await openLimiter.check('k'), { ok: true, remaining: 1, degraded: true });
  const closed = await closedLimiter.check('k');
  assert.equal(closed.ok, false);
  assert.equal(closed.retryAfter, 60);
  assert.equal(closed.degraded, true);
  assert.deepEqual(errors, ['redis unavailable']);
});

test('redis rate limit store increments with prefix and derives reset time from TTL', async () => {
  const calls = [];
  const store = createRedisRateLimitStore({
    prefix: 'test:rl:',
    client: {
      async eval(script, options) {
        calls.push({ script, options });
        return [3, 1250];
      }
    }
  });

  const bucket = await store.increment('127.0.0.1:admin:POST:/api/admin/login', {
    windowMs: 60_000,
    now: 1000
  });

  assert.equal(bucket.count, 3);
  assert.equal(bucket.resetAt, 2250);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.keys, ['test:rl:127.0.0.1:admin:POST:/api/admin/login']);
  assert.deepEqual(calls[0].options.arguments, ['60000']);
  assert.match(calls[0].script, /PEXPIRE/);
});

test('rate limit failure mode defaults closed and only accepts explicit open', () => {
  assert.equal(normalizeRateLimitFailureMode(), 'closed');
  assert.equal(normalizeRateLimitFailureMode('open'), 'open');
  assert.equal(normalizeRateLimitFailureMode('OPEN'), 'open');
  assert.equal(normalizeRateLimitFailureMode('fail-open'), 'closed');
});

test('rate limit store env factory keeps memory default and validates redis url', async () => {
  const memory = await createRateLimitStoreFromEnv({
    env: {
      RATE_LIMIT_STORE: 'memory',
      RATE_LIMIT_FAILURE_MODE: 'open'
    }
  });
  assert.equal(memory.driver, 'memory');
  assert.equal(memory.store, undefined);
  assert.equal(memory.failureMode, 'open');
  await memory.close();

  await assert.rejects(
    () => createRateLimitStoreFromEnv({ env: { RATE_LIMIT_STORE: 'redis' } }),
    /RATE_LIMIT_STORE=redis requires/
  );
});

test('login runs password verification even for unknown usernames (timing equalization)', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  await service.registerAccount({
    username: 'timing_user',
    password: 'correct-horse-battery',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  const timeLogin = async (username) => {
    const samples = [];
    for (let i = 0; i < 4; i += 1) {
      const start = process.hrtime.bigint();
      await service.loginAccount({ username, password: 'definitely-wrong', captchaToken: 'dev-pass' }).catch(() => {});
      samples.push(Number(process.hrtime.bigint() - start));
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)]; // median ns
  };

  const existingWrong = await timeLogin('timing_user');
  const missingUser = await timeLogin('does_not_exist_at_all');

  // If the missing-user path skipped PBKDF2 it would be orders of magnitude
  // faster. Require it to stay within a generous fraction of the existing-user
  // path so the timing cannot be used to enumerate usernames.
  assert.ok(
    missingUser >= existingWrong * 0.5,
    `missing-user login (${missingUser}ns) too fast vs existing-user (${existingWrong}ns)`
  );
});

test('login requires a valid captcha token', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  await service.registerAccount({
    username: 'login_captcha_user',
    password: 'correct-horse-battery',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  // Correct credentials but no captcha token are rejected before auth runs.
  await assert.rejects(
    () => service.loginAccount({ username: 'login_captcha_user', password: 'correct-horse-battery' }),
    (error) => error.statusCode === 403
  );

  const account = await service.loginAccount({
    username: 'login_captcha_user',
    password: 'correct-horse-battery',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  assert.equal(account.username, 'login_captcha_user');
});

test('register requires a valid captcha token', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  await assert.rejects(
    () => service.registerAccount({ username: 'no_captcha', password: 'long-enough-pass' }),
    (error) => error.statusCode === 403
  );

  const { account } = await service.registerAccount({
    username: 'with_captcha',
    password: 'long-enough-pass',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });
  assert.equal(account.username, 'with_captcha');
});

test('register enforces the password policy', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const register = (username, password) =>
    service.registerAccount({ username, password, captchaToken: 'dev-pass', ip: '203.0.113.7' });

  // Too short (below the 10-character minimum).
  await assert.rejects(() => register('shortpw', 'abc12'), (error) => error.statusCode === 400);
  // Common/blocklisted password.
  await assert.rejects(() => register('commonpw', 'password123'), (error) => error.statusCode === 400);
  // Password equal to the username.
  await assert.rejects(() => register('sameaspw12', 'sameaspw12'), (error) => error.statusCode === 400);
  // Trivial sequence and single-character repeat.
  await assert.rejects(() => register('seqpw', '0123456789'), (error) => error.statusCode === 400);
  await assert.rejects(() => register('reppw', 'aaaaaaaaaa'), (error) => error.statusCode === 400);

  // A reasonable strong password is accepted.
  const { account } = await register('strong_user', 'a-strong-passphrase-2026');
  assert.equal(account.username, 'strong_user');
});

test('account locks after repeated failed logins and unlocks after the window', async () => {
  let clock = new Date('2026-05-22T08:00:00.000Z').getTime();
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date(clock)
  });

  await service.registerAccount({
    username: 'lock_target',
    password: 'correct-horse-battery',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  // Five consecutive wrong passwords trip the lockout.
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(
      () => service.loginAccount({ username: 'lock_target', password: 'wrong', captchaToken: 'dev-pass' }),
      (error) => error.statusCode === 401
    );
  }

  // Locked: even the correct password is rejected with 429.
  await assert.rejects(
    () => service.loginAccount({ username: 'lock_target', password: 'correct-horse-battery', captchaToken: 'dev-pass' }),
    (error) => error.statusCode === 429
  );

  // After the lockout window passes, the correct password works again.
  clock += 15 * 60 * 1000 + 1000;
  const account = await service.loginAccount({ username: 'lock_target', password: 'correct-horse-battery', captchaToken: 'dev-pass' });
  assert.equal(account.username, 'lock_target');
});

test('a successful login resets the failed-attempt counter', async () => {
  const service = createForumService({
    store: createMemoryStore(),
    ai: safeAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  await service.registerAccount({
    username: 'reset_target',
    password: 'correct-horse-battery',
    captchaToken: 'dev-pass',
    ip: '203.0.113.7'
  });

  // Four failures (below the threshold of five), then a success.
  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(
      () => service.loginAccount({ username: 'reset_target', password: 'wrong', captchaToken: 'dev-pass' }),
      (error) => error.statusCode === 401
    );
  }
  await service.loginAccount({ username: 'reset_target', password: 'correct-horse-battery', captchaToken: 'dev-pass' });

  // Counter reset: four more failures still do not lock (would need five fresh).
  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(
      () => service.loginAccount({ username: 'reset_target', password: 'wrong', captchaToken: 'dev-pass' }),
      (error) => error.statusCode === 401
    );
  }
  const account = await service.loginAccount({ username: 'reset_target', password: 'correct-horse-battery', captchaToken: 'dev-pass' });
  assert.equal(account.username, 'reset_target');
});

test('concurrent thread creation never loses a post to interleaved writes', async () => {
  // Moderation yields the event loop, the window where two read-modify-write
  // mutations used to interleave and the later write clobbered the earlier one.
  const slowAi = {
    async moderate() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { status: 'Safe', labels: [] };
    }
  };
  const service = createForumService({
    store: createMemoryStore(),
    ai: slowAi,
    realtime: createEvents(),
    now: () => new Date('2026-05-22T08:00:00.000Z')
  });

  const count = 10;
  const results = await Promise.all(
    Array.from({ length: count }, (_unused, i) =>
      service.createThread({
        boardSlug: 'hoc-tap',
        body: `Thread dong thoi ${i}`,
        captchaToken: 'dev-pass',
        ip: '203.0.113.20',
        posterToken: `browser-${i}`
      })
    )
  );

  const threads = await service.listThreads('hoc-tap');
  assert.equal(threads.length, count, 'every concurrent thread must persist');

  const globalNumbers = results.map((result) => result.thread.globalNumber).sort((a, b) => a - b);
  assert.deepEqual(globalNumbers, Array.from({ length: count }, (_unused, i) => i + 1));
});
