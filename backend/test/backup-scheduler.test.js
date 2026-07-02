import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseBackupArgs } from '../scripts/backup-scheduler.js';
import { createBackupScheduler, runBackupJob } from '../src/core/backup-scheduler.ts';

const tempRoots = [];

async function tempDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '36chan-backup-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tempRoots.length) {
    await fs.rm(tempRoots.pop(), { recursive: true, force: true });
  }
});

function memoryStore(state = {}) {
  return {
    async read() {
      return {
        version: 1,
        nextGlobalNumber: 3,
        boards: [{ slug: 'demo', name: 'Demo' }],
        users: [{ id: 'user-1' }],
        threads: [{ id: 'thread-1', boardSlug: 'demo', body: 'Hello', globalNumber: 1, createdAt: '2026-06-20T10:00:00.000Z' }],
        comments: [{ id: 'comment-1', threadId: 'thread-1', boardSlug: 'demo', body: 'Reply', globalNumber: 2, createdAt: '2026-06-20T10:01:00.000Z' }],
        reports: [],
        sanctions: [],
        moderationActions: [],
        ...state
      };
    }
  };
}

describe('backup job', () => {
  it('dry-runs without writing backup files and records metadata', async () => {
    const root = await tempDir();
    const writes = [];
    const result = await runBackupJob({
      store: memoryStore(),
      imageStorage: {
        type: 's3-compatible',
        async listKeys() {
          return ['uploads/a.png', 'uploads/b.png'];
        }
      },
      destination: root,
      storeDriver: 'mongo',
      imageStorageDriver: 's3',
      mongoDbName: 'staging',
      s3: { bucket: 'uploads', endpoint: 'https://s3.example.com', keyPrefix: 'uploads' },
      dryRun: true,
      operator: 'ci',
      now: () => new Date('2026-06-22T10:00:00.000Z'),
      writeJsonImpl(filePath, value) {
        writes.push({ filePath, value });
      }
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.counts.threads, 1);
    assert.equal(result.counts.comments, 1);
    assert.equal(result.counts.uploads, 2);
    assert.equal(result.source.store.driver, 'mongo');
    assert.equal(result.source.uploads.driver, 's3');
    assert.equal(result.system.operator, 'ci');
    assert.equal(writes.length, 0);
  });

  it('writes state, upload manifest, and backup metadata for local uploads', async () => {
    const root = await tempDir();
    const uploadRoot = path.join(root, 'uploads');
    const destination = path.join(root, 'backups');
    await fs.mkdir(uploadRoot);
    await fs.writeFile(path.join(uploadRoot, 'keep.png'), 'image');

    const result = await runBackupJob({
      store: memoryStore(),
      imageStorage: {
        type: 'local-disk',
        async listKeys() {
          return ['keep.png'];
        }
      },
      destination,
      storeDriver: 'json',
      imageStorageDriver: 'local',
      forumPath: path.join(root, 'forum.json'),
      uploadRoot,
      dryRun: false,
      operator: 'backup-test',
      now: () => new Date('2026-06-22T11:00:00.000Z')
    });

    const state = JSON.parse(await fs.readFile(result.destination.statePath, 'utf8'));
    const uploads = JSON.parse(await fs.readFile(result.destination.uploadsPath, 'utf8'));
    const metadata = JSON.parse(await fs.readFile(result.destination.metadataPath, 'utf8'));

    assert.equal(state.threads.length, 1);
    assert.equal(uploads.uploads[0].storageKey, 'keep.png');
    assert.equal(uploads.uploads[0].sizeBytes, 5);
    assert.equal(metadata.system.operator, 'backup-test');
    assert.equal(metadata.counts.uploads, 1);
  });

  it('records write and metadata failures without throwing', async () => {
    const result = await runBackupJob({
      store: memoryStore(),
      imageStorage: {
        type: 's3-compatible',
        async listKeys() {
          return [];
        }
      },
      destination: 'backups',
      storeDriver: 'mongo',
      imageStorageDriver: 's3',
      dryRun: false,
      writeJsonImpl() {
        throw new Error('disk unavailable');
      }
    });

    assert.equal(result.failures.length, 2);
    assert.deepEqual(result.failures.map((failure) => failure.stage), ['write', 'metadata']);
  });
});

describe('backup scheduler', () => {
  it('is disabled unless explicitly enabled', () => {
    const events = [];
    const scheduler = createBackupScheduler({
      enabled: false,
      runJob: async () => ({ ok: true }),
      logger: (entry) => events.push(entry)
    });

    assert.equal(scheduler.start(), false);
    assert.equal(events[0].event, 'backup_scheduler_disabled');
  });

  it('prevents overlapping backup jobs', async () => {
    let release;
    let calls = 0;
    const scheduler = createBackupScheduler({
      enabled: true,
      runJob: async () => {
        calls += 1;
        await new Promise((resolve) => {
          release = resolve;
        });
        return { ok: true };
      }
    });

    const first = scheduler.tick();
    const second = await scheduler.tick();
    release();
    await first;

    assert.equal(calls, 1);
    assert.equal(second, null);
  });
});

describe('backup CLI arguments', () => {
  it('defaults to dry-run and keeps the scheduler disabled', () => {
    const args = parseBackupArgs(['node', 'backup-scheduler.js', 'schedule'], {
      NODE_ENV: 'development'
    });

    assert.equal(args.dryRun, true);
    assert.equal(args.enabled, false);
    assert.equal(args.storeDriver, 'json');
  });

  it('uses Mongo by default in production and enables explicit write mode', () => {
    const args = parseBackupArgs(['node', 'backup-scheduler.js', 'run', '--write'], {
      NODE_ENV: 'production'
    });

    assert.equal(args.dryRun, false);
    assert.equal(args.storeDriver, 'mongo');
  });

  it('rejects conflicting dry-run and write flags', () => {
    assert.throws(
      () => parseBackupArgs(['node', 'backup-scheduler.js', 'run', '--dry-run', '--write'], {}),
      /either --dry-run or --write/i
    );
  });
});
