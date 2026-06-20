import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createJsonStore } from '../src/core/forum-store.js';
import { createLocalImageStorage, createS3ImageStorage } from '../src/core/image-storage.js';
import { createMongoStore } from '../src/core/mongo-store.js';
import { cleanupOrphanUploads } from '../src/core/upload-cleanup.js';

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) {
    return fallback;
  }
  return argv[index + 1];
}

export function parseCleanupArgs(argv = process.argv, env = process.env) {
  const requestedDryRun = argv.includes('--dry-run');
  const deleteMode = argv.includes('--delete');
  if (requestedDryRun && deleteMode) {
    throw new Error('Use either --dry-run or --delete, not both');
  }

  const productionMode = env.NODE_ENV === 'production';
  const storeDriver = String(readOption(argv, '--store-driver', env.STORE_DRIVER ?? (productionMode ? 'mongo' : 'json'))).toLowerCase();
  if (productionMode && deleteMode && storeDriver !== 'mongo') {
    throw new Error('Production upload cleanup delete requires STORE_DRIVER=mongo');
  }

  return {
    dryRun: !deleteMode,
    forumPath: path.resolve(readOption(argv, '--data', 'data/forum.json')),
    storeDriver,
    mongoDbName: readOption(argv, '--db', undefined),
    imageStorageDriver: String(readOption(argv, '--driver', env.IMAGE_STORAGE_DRIVER ?? 'local')).toLowerCase(),
    uploadRoot: path.resolve(readOption(argv, '--upload-root', env.UPLOAD_ROOT ?? 'data/uploads')),
    publicPath: readOption(argv, '--public-path', '/uploads'),
    s3: {
      endpoint: readOption(argv, '--s3-endpoint', env.S3_ENDPOINT),
      region: readOption(argv, '--s3-region', env.S3_REGION ?? 'auto'),
      bucket: readOption(argv, '--s3-bucket', env.S3_BUCKET),
      accessKeyId: readOption(argv, '--s3-access-key-id', env.S3_ACCESS_KEY_ID),
      secretAccessKey: readOption(argv, '--s3-secret-access-key', env.S3_SECRET_ACCESS_KEY),
      publicBaseUrl: readOption(argv, '--s3-public-base-url', env.S3_PUBLIC_BASE_URL),
      keyPrefix: readOption(argv, '--s3-key-prefix', env.S3_KEY_PREFIX ?? 'uploads')
    },
    auditPath: readOption(argv, '--audit', null)
  };
}

export function createImageStorageForCleanup(args) {
  const driver = args.imageStorageDriver;
  if (driver === 'local') {
    return createLocalImageStorage({
      root: args.uploadRoot,
      publicPath: args.publicPath
    });
  }

  if (driver === 's3') {
    return createS3ImageStorage({
      endpoint: args.s3.endpoint,
      region: args.s3.region,
      bucket: args.s3.bucket,
      accessKeyId: args.s3.accessKeyId,
      secretAccessKey: args.s3.secretAccessKey,
      publicBaseUrl: args.s3.publicBaseUrl,
      keyPrefix: args.s3.keyPrefix
    });
  }

  throw new Error(`Unsupported upload cleanup driver: ${driver}`);
}

export function createForumStateStore(args, {
  createJsonStoreImpl = createJsonStore,
  createMongoStoreImpl = createMongoStore
} = {}) {
  if (args.storeDriver === 'json') {
    return createJsonStoreImpl(args.forumPath);
  }
  if (args.storeDriver === 'mongo') {
    return createMongoStoreImpl({ dbName: args.mongoDbName });
  }
  throw new Error('STORE_DRIVER must be either json or mongo.');
}

export async function readForumStateForCleanup(args, dependencies = {}) {
  const store = createForumStateStore(args, dependencies);
  try {
    return await store.read();
  } finally {
    await store.close?.();
  }
}

export async function runCleanupUploads(args, {
  logger = (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry })),
  dependencies = {}
} = {}) {
  const state = await readForumStateForCleanup(args, dependencies);
  const result = await cleanupOrphanUploads({
    state,
    imageStorage: createImageStorageForCleanup(args),
    dryRun: args.dryRun,
    logger
  });
  const output = JSON.stringify(result, null, 2);
  if (args.auditPath) {
    const resolvedAuditPath = path.resolve(args.auditPath);
    await fs.mkdir(path.dirname(resolvedAuditPath), { recursive: true });
    await fs.writeFile(resolvedAuditPath, output);
  }
  console.log(output);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runCleanupUploads(parseCleanupArgs());
    if (result.failures.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
