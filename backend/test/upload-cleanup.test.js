import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLocalImageStorage, createS3ImageStorage } from '../src/core/image-storage.js';
import { cleanupOrphanUploads, collectReferencedUploadKeys } from '../src/core/upload-cleanup.js';

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
      ]
    };

    assert.deepStrictEqual([...collectReferencedUploadKeys(state, { storage: 'local' })].sort(), [
      'comment.png',
      'thread.png',
      'thread.thumb.jpg'
    ]);
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
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url: url.toString(), method: options.method });
      if (options.method === 'GET') {
        return {
          ok: true,
          status: 200,
          text: async () => [
            '<ListBucketResult>',
            '<IsTruncated>false</IsTruncated>',
            '<Contents><Key>uploads/keep.png</Key></Contents>',
            '<Contents><Key>uploads/orphan.png</Key></Contents>',
            '</ListBucketResult>'
          ].join('')
        };
      }
      return { ok: true, status: 204 };
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
    assert.ok(calls.find((call) => call.method === 'DELETE').url.includes('/uploads/orphan.png'));
  });

  it('records failure details when deletion fails', async () => {
    const fetchImpl = async (_url, options) => {
      if (options.method === 'GET') {
        return {
          ok: true,
          status: 200,
          text: async () => '<ListBucketResult><Contents><Key>uploads/orphan.png</Key></Contents></ListBucketResult>'
        };
      }
      return { ok: false, status: 503 };
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
