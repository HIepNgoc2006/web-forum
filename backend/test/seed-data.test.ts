import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseSeedArgs } from '../scripts/seed-data.ts';
import {
  importSeedData,
  planSeedImport,
  restoreSeedRollback,
  sanitizeSeedState,
  validateSeed
} from '../src/core/seed-data.ts';

const tempRoots = [];

async function tempDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '36chan-seed-data-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tempRoots.length) {
    await fs.rm(tempRoots.pop(), { recursive: true, force: true });
  }
});

function seedFixture(overrides = {}) {
  return {
    version: 1,
    exportedAt: '2026-06-22T00:00:00.000Z',
    boards: [{ slug: 'demo-stage', name: 'Demo Stage', category: 'QA', description: 'Demo board' }],
    threads: [
      {
        id: 'thread-1',
        boardSlug: 'demo-stage',
        body: 'Seed thread',
        globalNumber: 10,
        createdAt: '2026-06-20T10:00:00.000Z',
        bumpedAt: '2026-06-20T10:05:00.000Z'
      }
    ],
    comments: [
      {
        id: 'comment-1',
        threadId: 'thread-1',
        boardSlug: 'demo-stage',
        body: 'Seed comment',
        globalNumber: 11,
        createdAt: '2026-06-20T10:05:00.000Z'
      }
    ],
    nextGlobalNumber: 12,
    ...overrides
  };
}

describe('seed data export sanitization', () => {
  it('exports only sanitized board, thread, and comment seed records', () => {
    const seed = sanitizeSeedState({
      nextGlobalNumber: 20,
      boards: [{ slug: 'demo-stage', name: 'Demo Stage', hidden: false }],
      users: [{ id: 'user-1', passwordHash: 'secret' }],
      reports: [{ id: 'report-1' }],
      sanctions: [{ id: 'sanction-1' }],
      moderationActions: [{ id: 'action-1' }],
      aiUsage: { private: 1 },
      threads: [
        {
          id: 'thread-1',
          boardSlug: 'demo-stage',
          body: 'Public body',
          globalNumber: 1,
          authorFingerprint: 'fingerprint',
          posterToken: 'poster-token',
          accountId: 'account-1',
          deletePasswordHash: 'delete-hash',
          image: {
            name: 'demo.png',
            type: 'image/png',
            storage: 'local',
            storageKey: 'demo.png',
            dataUrl: 'data:image/png;base64,secret',
            thumbnail: {
              storage: 'local',
              storageKey: 'demo.thumb.jpg',
              dataUrl: 'data:image/jpeg;base64,secret'
            }
          },
          isPending: false,
          isDeleted: false,
          createdAt: '2026-06-20T10:00:00.000Z'
        },
        {
          id: 'thread-private',
          boardSlug: 'demo-stage',
          body: 'Pending body',
          isPending: true,
          createdAt: '2026-06-20T11:00:00.000Z'
        }
      ],
      comments: [
        {
          id: 'comment-1',
          threadId: 'thread-1',
          boardSlug: 'demo-stage',
          body: 'Public comment',
          globalNumber: 2,
          authorFingerprint: 'fingerprint',
          captchaToken: 'captcha',
          isPending: false,
          isDeleted: false,
          createdAt: '2026-06-20T10:05:00.000Z'
        }
      ]
    });

    assert.equal(Object.hasOwn(seed, 'users'), false);
    assert.equal(Object.hasOwn(seed, 'reports'), false);
    assert.equal(Object.hasOwn(seed, 'sanctions'), false);
    assert.equal(seed.threads.length, 1);
    assert.equal(seed.comments.length, 1);
    assert.equal(Object.hasOwn(seed.threads[0], 'authorFingerprint'), false);
    assert.equal(Object.hasOwn(seed.threads[0], 'posterToken'), false);
    assert.equal(Object.hasOwn(seed.threads[0], 'accountId'), false);
    const image = seed.threads[0].image as Record<string, any>;
    assert.equal(Object.hasOwn(image, 'dataUrl'), false);
    assert.equal(Object.hasOwn(image.thumbnail, 'dataUrl'), false);
    assert.equal(Object.hasOwn(seed.comments[0], 'captchaToken'), false);
  });
});

describe('seed data validation and merge planning', () => {
  it('rejects malformed seed files before import', () => {
    const validation = validateSeed({
      version: 1,
      boards: [{ slug: 'demo-stage', name: 'Demo Stage' }],
      threads: [{ id: 'thread-1', boardSlug: 'missing', body: 'Body', createdAt: '2026-06-20T10:00:00.000Z' }],
      comments: []
    });

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join('\n'), /references missing board missing/);
  });

  it('skips duplicate boards and posts by default', () => {
    const current = {
      version: 1,
      nextGlobalNumber: 12,
      boards: [{ slug: 'demo-stage', name: 'Existing Demo' }],
      threads: [{ id: 'thread-1', boardSlug: 'demo-stage', body: 'Existing', globalNumber: 10, createdAt: '2026-06-19T10:00:00.000Z' }],
      comments: []
    };

    const { nextState, summary } = planSeedImport(current, seedFixture());

    assert.equal(summary.boards.skipped, 1);
    assert.equal(summary.threads.skipped, 1);
    assert.equal(summary.comments.skipped, 1);
    assert.equal(nextState.threads[0].body, 'Existing');
    assert.equal(nextState.comments.length, 0);
  });

  it('replaces duplicates only when requested', () => {
    const current = {
      version: 1,
      nextGlobalNumber: 12,
      boards: [{ slug: 'demo-stage', name: 'Existing Demo' }],
      threads: [{ id: 'thread-1', boardSlug: 'demo-stage', body: 'Existing', globalNumber: 10, createdAt: '2026-06-19T10:00:00.000Z' }],
      comments: [{ id: 'old-comment', threadId: 'thread-1', boardSlug: 'demo-stage', body: 'Old comment', globalNumber: 9, createdAt: '2026-06-19T10:05:00.000Z' }]
    };

    const { nextState, summary } = planSeedImport(current, seedFixture(), { mode: 'replace' });

    assert.equal(summary.boards.replaced, 1);
    assert.equal(summary.threads.replaced, 1);
    assert.equal(summary.comments.added, 1);
    assert.equal(nextState.boards.find((board) => board.slug === 'demo-stage').name, 'Demo Stage');
    assert.equal(nextState.threads.find((thread) => thread.id === 'thread-1').body, 'Seed thread');
    assert.equal(nextState.comments.some((comment) => comment.id === 'old-comment'), false);
    assert.equal(nextState.comments.find((comment) => comment.id === 'comment-1').body, 'Seed comment');
  });
});

describe('seed data import safety', () => {
  it('dry-runs without writing state or rollback files', async () => {
    let writes = 0;
    const store = {
      async read() {
        return { version: 1, nextGlobalNumber: 1, boards: [], threads: [], comments: [] };
      },
      async write() {
        writes += 1;
      }
    };

    const result = await importSeedData({ store, seed: seedFixture(), dryRun: true });

    assert.equal(result.dryRun, true);
    assert.equal(result.summary.threads.added, 1);
    assert.equal(writes, 0);
    assert.equal(result.rollbackPath, null);
  });

  it('writes a rollback snapshot before applying an import', async () => {
    const root = await tempDir();
    const rollbackPath = path.join(root, 'rollback.json');
    const writes = [];
    const store = {
      async read() {
        return { version: 1, nextGlobalNumber: 1, boards: [], threads: [], comments: [] };
      },
      async write(state) {
        writes.push(state);
      }
    };

    const result = await importSeedData({ store, seed: seedFixture(), dryRun: false, rollbackPath });
    const rollback = JSON.parse(await fs.readFile(rollbackPath, 'utf8'));

    assert.equal(result.rollbackPath, rollbackPath);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].threads.length, 1);
    assert.equal(rollback.threads.length, 0);
  });

  it('restores the previous state when a write import fails', async () => {
    const root = await tempDir();
    const rollbackPath = path.join(root, 'rollback.json');
    const current = { version: 1, nextGlobalNumber: 1, boards: [], threads: [], comments: [] };
    const writes = [];
    const store = {
      async read() {
        return current;
      },
      async write(state) {
        writes.push(state);
        if (writes.length === 1) {
          throw new Error('write failed');
        }
      }
    };

    await assert.rejects(() => importSeedData({ store, seed: seedFixture(), dryRun: false, rollbackPath }), /write failed/);

    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], current);
    await fs.access(rollbackPath);
  });

  it('restores a full rollback snapshot only when write is explicit', async () => {
    const root = await tempDir();
    const rollbackPath = path.join(root, 'before-restore.json');
    const restored = {
      version: 1,
      nextGlobalNumber: 25,
      boards: [{ slug: 'demo-stage', name: 'Restored Demo' }],
      users: [{ id: 'user-1', username: 'owner', passwordHash: 'secret' }],
      threads: [
        {
          id: 'thread-1',
          boardSlug: 'demo-stage',
          body: 'Restored',
          globalNumber: 20,
          createdAt: '2026-06-20T10:00:00.000Z'
        }
      ],
      comments: [],
      reports: [{ id: 'report-1', createdAt: '2026-06-20T11:00:00.000Z' }],
      sanctions: [],
      moderationActions: []
    };
    const writes = [];
    const store = {
      async read() {
        return { version: 1, nextGlobalNumber: 1, boards: [], users: [], threads: [], comments: [] };
      },
      async write(state) {
        writes.push(state);
      }
    };

    const dryRun = await restoreSeedRollback({ store, rollbackState: restored, dryRun: true });
    const written = await restoreSeedRollback({ store, rollbackState: restored, dryRun: false, rollbackPath });

    assert.equal(dryRun.counts.users, 1);
    assert.equal(dryRun.counts.reports, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].users[0].passwordHash, 'secret');
    assert.equal(writes[0].reports[0].id, 'report-1');
    assert.equal(written.rollbackPath, rollbackPath);
    await fs.access(rollbackPath);
  });
});

describe('seed data CLI arguments', () => {
  it('defaults imports to dry-run and enables write/replace explicitly', () => {
    const dryRunArgs = parseSeedArgs(['node', 'seed-data.ts', 'import', '--in', 'seed.json'], {});
    const writeArgs = parseSeedArgs(['node', 'seed-data.ts', 'import', '--in', 'seed.json', '--write', '--replace'], {});
    const restoreArgs = parseSeedArgs(['node', 'seed-data.ts', 'restore', '--in', 'rollback.json'], {});

    assert.equal(dryRunArgs.dryRun, true);
    assert.equal(path.basename(path.dirname(dryRunArgs.forumPath)), 'data');
    assert.equal(path.basename(path.dirname(path.dirname(dryRunArgs.forumPath))), 'backend');
    assert.equal(writeArgs.dryRun, false);
    assert.equal(writeArgs.mode, 'replace');
    assert.equal(restoreArgs.dryRun, true);
  });

  it('rejects conflicting import modes', () => {
    assert.throws(
      () => parseSeedArgs(['node', 'seed-data.ts', 'import', '--in', 'seed.json', '--dry-run', '--write'], {}),
      /either --dry-run or --write/i
    );
  });
});
