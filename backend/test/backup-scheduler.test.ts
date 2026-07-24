import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseBackupArgs } from '../scripts/backup-scheduler.ts';
import { createBackupScheduler, runBackupJob } from '../src/core/backup-scheduler.ts';

const tempRoots: string[] = [];

async function tempDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '36chan-backup-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tempRoots.length) {
    await fs.rm(tempRoots.pop(), { recursive: true, force: true });
  }
});

function memoryStore(state: Record<string, unknown> = {}) {
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
    const writes: Array<{ filePath: string; value: unknown }> = [];
    const result = await runBackupJob({
      store: memoryStore(),
      imageStorage: {
        type: 's3-compatible',
        async listKeys() {
          return ['uploads/a.png', 'uploads/b.png'];
        }
      } as { type: string; listKeys(): Promise<string[]> },
      destination: root,
      storeDriver: 'mongo',
      imageStorageDriver: 's3',
      mongoDbName: 'staging',
      s3: { bucket: 'uploads', endpoint: 'https://s3.example.com', keyPrefix: 'uploads' },
      dryRun: true,
      operator: 'ci',
      now: () => new Date('2026-06-22T10:00:00.000Z'),
      async writeJsonImpl(filePath, value) {
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

  it('holds the Mongo mutation lock while reading state and upload metadata', async () => {
    const root = await tempDir();
    let lockHeld = false;
    const store = {
      async withMutationLock(callback) {
        lockHeld = true;
        try {
          return await callback();
        } finally {
          lockHeld = false;
        }
      },
      async read() {
        assert.equal(lockHeld, true);
        return memoryStore().read();
      }
    };
    const result = await runBackupJob({
      store,
      imageStorage: {
        type: 's3-compatible',
        async listKeys() {
          assert.equal(lockHeld, true);
          return [];
        }
      },
      destination: root,
      storeDriver: 'mongo',
      imageStorageDriver: 's3',
      dryRun: true
    });

    assert.equal(result.counts.threads, 1);
    assert.equal(lockHeld, false);
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
      } as { type: string; listKeys(): Promise<string[]> },
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
    assert.match(uploads.uploads[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(await fs.readFile(path.join(result.destination.uploadsDirectory, 'keep.png'), 'utf8'), 'image');
    assert.equal(metadata.system.operator, 'backup-test');
    assert.equal(metadata.counts.uploads, 1);
    assert.equal(metadata.recoverability.state.complete, true);
    assert.equal(metadata.recoverability.uploads.complete, true);
  });

  it('restores state and local upload bytes into empty target directories', async () => {
    const root = await tempDir();
    const uploadRoot = path.join(root, 'uploads-source');
    const destination = path.join(root, 'backups');
    const restoreRoot = path.join(root, 'restore');
    await fs.mkdir(path.join(uploadRoot, '2026', '07'), { recursive: true });
    await fs.writeFile(path.join(uploadRoot, '2026', '07', 'restored.png'), 'restorable-bytes');
    const state = {
      threads: [{
        id: 'thread-restore',
        boardSlug: 'demo',
        body: 'Restore me',
        globalNumber: 1,
        image: { storage: 'local', storageKey: '2026/07/restored.png', url: '/uploads/2026/07/restored.png' },
        images: [{ storage: 'local', storageKey: '2026/07/restored.png', url: '/uploads/2026/07/restored.png' }]
      }],
      comments: []
    };
    const result = await runBackupJob({
      store: memoryStore(state),
      imageStorage: {
        type: 'local-disk',
        async listKeys() {
          return ['2026/07/restored.png'];
        }
      },
      destination,
      storeDriver: 'json',
      imageStorageDriver: 'local',
      uploadRoot,
      dryRun: false,
      now: () => new Date('2026-07-15T12:00:00.000Z')
    });

    await fs.mkdir(path.join(restoreRoot, 'uploads'), { recursive: true });
    await fs.copyFile(result.destination.statePath, path.join(restoreRoot, 'forum.json'));
    await fs.cp(result.destination.uploadsDirectory, path.join(restoreRoot, 'uploads'), { recursive: true });

    const restoredState = JSON.parse(await fs.readFile(path.join(restoreRoot, 'forum.json'), 'utf8'));
    assert.equal(restoredState.threads[0].image.storageKey, '2026/07/restored.png');
    assert.equal(
      await fs.readFile(path.join(restoreRoot, 'uploads', '2026', '07', 'restored.png'), 'utf8'),
      'restorable-bytes'
    );
  });

  it('throws with failure metadata when backup writes fail', async () => {
    let failureResult;
    await assert.rejects(
      () => runBackupJob({
        store: memoryStore(),
        imageStorage: {
          type: 's3-compatible',
          async listKeys() {
            return [];
          }
        } as { type: string; listKeys(): Promise<string[]> },
        destination: 'backups',
        storeDriver: 'mongo',
        imageStorageDriver: 's3',
        s3: { backupConfirmed: true },
        dryRun: false,
        writeJsonImpl() {
          throw new Error('disk unavailable');
        }
      }),
      (error: Error & { result?: any }) => {
        failureResult = error.result;
        return /failed in 3 stage/.test(error.message);
      }
    );

    assert.deepEqual(failureResult.failures.map((failure) => failure.stage), ['state', 'manifest', 'metadata']);
  });

  it('fails S3 write backups unless provider backup is explicitly confirmed', async () => {
    const root = await tempDir();
    let failureResult;
    await assert.rejects(
      () => runBackupJob({
        store: memoryStore(),
        imageStorage: {
          type: 's3-compatible',
          async listKeys() {
            return ['uploads/a.png'];
          }
        },
        destination: root,
        storeDriver: 'mongo',
        imageStorageDriver: 's3',
        dryRun: false
      }),
      (error: Error & { result?: any }) => {
        failureResult = error.result;
        return /failed in 1 stage/.test(error.message);
      }
    );

    assert.equal(failureResult.recoverability.uploads.complete, false);
    assert.equal(failureResult.recoverability.uploads.reason, 'provider_backup_not_confirmed');
    assert.equal(failureResult.failures[0].stage, 'uploads');
  });
});

describe('backup scheduler', () => {
  it('is disabled unless explicitly enabled', () => {
    const events: Array<Record<string, unknown>> = [];
    const scheduler = createBackupScheduler({
      enabled: false,
      runJob: async () => ({ ok: true }),
      logger: (entry) => events.push(entry)
    });

    assert.equal(scheduler.start(), false);
    assert.equal(events[0]?.event, 'backup_scheduler_disabled');
  });

  it('prevents overlapping backup jobs', async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const scheduler = createBackupScheduler({
      enabled: true,
      runJob: async () => {
        calls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ok: true };
      }
    });

    const first = scheduler.tick();
    const second = await scheduler.tick();
    assert.ok(release);
    release();
    await first;

    assert.equal(calls, 1);
    assert.equal(second, null);
  });
});

describe('backup CLI arguments', () => {
  it('defaults to dry-run and keeps the scheduler disabled', () => {
    const args = parseBackupArgs(['node', 'backup-scheduler.ts', 'schedule'], {
      NODE_ENV: 'development'
    });

    assert.equal(args.dryRun, true);
    assert.equal(args.enabled, false);
    assert.equal(args.storeDriver, 'json');
  });

  it('uses Mongo by default in production and enables explicit write mode', () => {
    const args = parseBackupArgs(['node', 'backup-scheduler.ts', 'run', '--write'], {
      NODE_ENV: 'production'
    });

    assert.equal(args.dryRun, false);
    assert.equal(args.storeDriver, 'mongo');
  });

  it('accepts explicit provider backup confirmation for S3 bytes', () => {
    const args = parseBackupArgs([
      'node',
      'backup-scheduler.ts',
      'run',
      '--driver',
      's3',
      '--s3-backup-confirmed'
    ], {});

    assert.equal(args.s3.backupConfirmed, true);
  });

  it('rejects conflicting dry-run and write flags', () => {
    assert.throws(
      () => parseBackupArgs(['node', 'backup-scheduler.ts', 'run', '--dry-run', '--write'], {}),
      /either --dry-run or --write/i
    );
  });
});
