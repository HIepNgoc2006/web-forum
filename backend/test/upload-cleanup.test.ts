import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseCleanupArgs, readForumStateForCleanup } from '../scripts/cleanup-orphan-uploads.ts';
import { createLocalImageStorage, createS3ImageStorage } from '../src/core/image-storage.ts';
import { cleanupOrphanUploads, collectReferencedUploadKeys } from '../src/core/upload-cleanup.ts';

type MockResponse = {
  ok: boolean;
  status: number;
  text?: () => Promise<string>;
};

type FetchCall = {
  url: string;
  method?: string;
};

function mockResponse(response: MockResponse): Response {
  return response as Response;
}

const tempRoots = [];

async function tempDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '36chan-upload-cleanup-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tempRoots.length) {
    await fs.rm(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe('collectReferencedUploadKeys', () => {
  it('collects post images and thumbnails for the selected storage driver', () => {
    const state = {
      threads: [
        {
          images: [
            {
              storage: 'local',
              storageKey: 'thread.png',
              thumbnail: { storage: 'local', storageKey: 'thread.thumb.jpg' }
            },
            { storage: 's3', storageKey: 'uploads/remote.png' }
          ]
        }
      ],
      comments: [
        {
          image: {
            storage: 'local',
            storageKey: 'comment.png'
          }
        }
      ],
      dmMessages: [
        {
          images: [
            {
              storage: 'local',
              storageKey: 'dm.png',
              thumbnail: { storage: 'local', storageKey: 'dm.thumb.jpg' }
            }
          ]
        }
      ]
    };

    assert.deepStrictEqual([...collectReferencedUploadKeys(state, { storage: 'local' })].sort(), [
      'comment.png',
      'dm.png',
      'dm.thumb.jpg',
      'thread.png',
      'thread.thumb.jpg'
    ]);
  });
});

describe('cleanup upload CLI state source', () => {
  it('defaults production cleanup to the Mongo store source', () => {
    const args = parseCleanupArgs(['node', 'cleanup-orphan-uploads.ts'], {
      NODE_ENV: 'production',
      IMAGE_STORAGE_DRIVER: 's3'
    });

    assert.strictEqual(args.storeDriver, 'mongo');
    assert.strictEqual(args.imageStorageDriver, 's3');
    assert.strictEqual(args.dryRun, true);
    assert.strictEqual(args.minimumAgeMs, 24 * 60 * 60 * 1000);
  });

  it('rejects conflicting dry-run and delete flags', () => {
    assert.throws(
      () => parseCleanupArgs(['node', 'cleanup-orphan-uploads.ts', '--dry-run', '--delete'], {}),
      /either --dry-run or --delete/i
    );
  });

  it('rejects production delete mode with a non-Mongo state source', () => {
    assert.throws(
      () => parseCleanupArgs(['node', 'cleanup-orphan-uploads.ts', '--store-driver', 'json', '--delete'], {
        NODE_ENV: 'production'
      }),
      /production upload cleanup delete requires store_driver=mongo/i
    );
  });

  it('reads Mongo state through the configured store and closes it', async () => {
    const state = {
      threads: [{ image: { storage: 's3', storageKey: 'uploads/keep.png' } }],
      comments: []
    };
    let closed = false;
    const args = parseCleanupArgs(['node', 'cleanup-orphan-uploads.ts', '--store-driver', 'mongo'], {});

    const result = await readForumStateForCleanup(args, {
      createJsonStoreImpl: () => {
        throw new Error('json store must not be used for mongo cleanup');
      },
      createMongoStoreImpl: () => ({
        async read() {
          return state;
        },
        async close() {
          closed = true;
        }
      })
    });

    assert.deepStrictEqual(result, state);
    assert.strictEqual(closed, true);
  });

  it('uses the explicit JSON data path only for json store cleanup', async () => {
    const root = await tempDir();
    const forumPath = path.join(root, 'forum.json');
    const args = parseCleanupArgs(['node', 'cleanup-orphan-uploads.ts', '--store-driver', 'json', '--data', forumPath], {});
    let jsonPath = null;

    await readForumStateForCleanup(args, {
      createJsonStoreImpl: (filePath) => {
        jsonPath = filePath;
        return {
          async read() {
            return { threads: [], comments: [] };
          }
        };
      },
      createMongoStoreImpl: () => {
        throw new Error('mongo store must not be used for json cleanup');
      }
    });

    assert.strictEqual(jsonPath, forumPath);
  });
});

describe('cleanupOrphanUploads local storage', () => {
  it('reports orphan candidates during dry-run without deleting files', async () => {
    const root = await tempDir();
    await fs.writeFile(path.join(root, 'keep.png'), 'keep');
    await fs.writeFile(path.join(root, 'keep.thumb.jpg'), 'thumb');
    await fs.writeFile(path.join(root, 'orphan.png'), 'orphan');
    const storage = createLocalImageStorage({ root });
    const state = {
      threads: [
        {
          image: {
            storage: 'local',
            storageKey: 'keep.png',
            thumbnail: { storage: 'local', storageKey: 'keep.thumb.jpg' }
          }
        }
      ],
      comments: []
    };

    const result = await cleanupOrphanUploads({ state, imageStorage: storage, dryRun: true });

    assert.strictEqual(result.scanned, 3);
    assert.strictEqual(result.referenced, 2);
    assert.deepStrictEqual(result.candidates, [{ storageKey: 'orphan.png' }]);
    assert.deepStrictEqual(result.deleted, []);
    assert.strictEqual(await fs.readFile(path.join(root, 'orphan.png'), 'utf8'), 'orphan');
  });

  it('deletes only verified orphan files inside the upload root', async () => {
    const root = await tempDir();
    await fs.writeFile(path.join(root, 'keep.png'), 'keep');
    await fs.writeFile(path.join(root, 'orphan.png'), 'orphan');
    const storage = createLocalImageStorage({ root });
    const state = {
      threads: [{ image: { storage: 'local', storageKey: 'keep.png' } }],
      comments: []
    };

    const result = await cleanupOrphanUploads({ state, imageStorage: storage, dryRun: false });

    assert.deepStrictEqual(result.deleted, [{ storageKey: 'orphan.png' }]);
    assert.strictEqual(await fs.readFile(path.join(root, 'keep.png'), 'utf8'), 'keep');
    await assert.rejects(() => fs.access(path.join(root, 'orphan.png')), /ENOENT/);
  });

  it('rechecks authoritative references under the mutation lock before delete', async () => {
    let locked = false;
    let deleted = false;
    const imageStorage = {
      type: 'local-disk',
      async listKeys() {
        return ['claimed-by-dm.png'];
      },
      async deleteKey() {
        deleted = true;
      }
    };
    const result = await cleanupOrphanUploads({
      state: { threads: [], comments: [], dmMessages: [] },
      imageStorage,
      dryRun: false,
      readState: async () => ({
        threads: [],
        comments: [],
        dmMessages: [{
          image: { storage: 'local', storageKey: 'claimed-by-dm.png' }
        }]
      }),
      withMutationLock: async (callback) => {
        locked = true;
        return callback();
      }
    });

    assert.strictEqual(locked, true);
    assert.strictEqual(deleted, false);
    assert.deepStrictEqual(result.skipped, [{
      storageKey: 'claimed-by-dm.png',
      reason: 'referenced-on-recheck'
    }]);
  });

  it('keeps unreferenced uploads that are newer than the grace period', async () => {
    let deleted = false;
    const result = await cleanupOrphanUploads({
      state: { threads: [], comments: [], dmMessages: [] },
      imageStorage: {
        type: 'local-disk',
        async listKeys() {
          return ['fresh.png'];
        },
        async deleteKey() {
          deleted = true;
        },
        async getLastModified() {
          return new Date('2026-07-24T01:30:00.000Z');
        }
      },
      dryRun: false,
      minimumAgeMs: 60 * 60 * 1000,
      now: () => new Date('2026-07-24T02:00:00.000Z')
    });

    assert.strictEqual(deleted, false);
    assert.deepStrictEqual(result.skipped, [{
      storageKey: 'fresh.png',
      reason: 'minimum-age'
    }]);
  });

  it('rejects unsafe local keys before deleting', async () => {
    const parent = await tempDir();
    const root = path.join(parent, 'uploads');
    await fs.mkdir(root);
    const outsidePath = path.join(parent, 'outside.png');
    await fs.writeFile(outsidePath, 'outside');
    const storage = createLocalImageStorage({ root });

    await assert.rejects(() => storage.deleteKey('../outside.png'), /unsafe/i);
    assert.strictEqual(await fs.readFile(outsidePath, 'utf8'), 'outside');
  });
});

describe('cleanupOrphanUploads S3 storage', () => {
  const s3Config = {
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    keyPrefix: 'uploads',
    now: () => new Date('2026-01-15T12:00:00Z')
  };

  it('deletes only orphan keys listed within the configured bucket prefix', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = async (url: string | URL | Request, options: RequestInit = {}) => {
      calls.push({ url: url.toString(), method: options.method });
      if (options.method === 'GET') {
        return mockResponse({
          ok: true,
          status: 200,
          text: async () => [
            '<ListBucketResult>',
            '<IsTruncated>false</IsTruncated>',
            '<Contents><Key>uploads/keep.png</Key></Contents>',
            '<Contents><Key>uploads/orphan.png</Key></Contents>',
            '</ListBucketResult>'
          ].join('')
        });
      }
      return mockResponse({ ok: true, status: 204 });
    };
    const storage = createS3ImageStorage({ ...s3Config, fetchImpl });
    const state = {
      threads: [{ image: { storage: 's3', storageKey: 'uploads/keep.png' } }],
      comments: []
    };

    const result = await cleanupOrphanUploads({ state, imageStorage: storage, dryRun: false });

    assert.deepStrictEqual(result.candidates, [{ storageKey: 'uploads/orphan.png' }]);
    assert.deepStrictEqual(result.deleted, [{ storageKey: 'uploads/orphan.png' }]);
    assert.strictEqual(calls.filter((call) => call.method === 'DELETE').length, 1);
    assert.ok(calls.find((call) => call.method === 'DELETE')?.url.includes('/uploads/orphan.png'));
  });

  it('records failure details when deletion fails', async () => {
    const fetchImpl = async (_url: string | URL | Request, options: RequestInit = {}) => {
      if (options.method === 'GET') {
        return mockResponse({
          ok: true,
          status: 200,
          text: async () => '<ListBucketResult><Contents><Key>uploads/orphan.png</Key></Contents></ListBucketResult>'
        });
      }
      return mockResponse({ ok: false, status: 503 });
    };
    const storage = createS3ImageStorage({ ...s3Config, fetchImpl });

    const result = await cleanupOrphanUploads({
      state: { threads: [], comments: [] },
      imageStorage: storage,
      dryRun: false
    });

    assert.strictEqual(result.deleted.length, 0);
    assert.deepStrictEqual(result.failures, [
      {
        storageKey: 'uploads/orphan.png',
        error: 'Không thể xóa upload S3 (503)'
      }
    ]);
  });
});
