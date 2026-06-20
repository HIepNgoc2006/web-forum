import fs from 'node:fs/promises';
import path from 'node:path';

import { createLocalImageStorage, createS3ImageStorage } from '../src/core/image-storage.js';
import { cleanupOrphanUploads } from '../src/core/upload-cleanup.js';

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

function createImageStorage(driver) {
  if (driver === 'local') {
    return createLocalImageStorage({
      root: path.resolve(readOption('--upload-root', process.env.UPLOAD_ROOT ?? 'data/uploads')),
      publicPath: readOption('--public-path', '/uploads')
    });
  }

  if (driver === 's3') {
    return createS3ImageStorage({
      endpoint: readOption('--s3-endpoint', process.env.S3_ENDPOINT),
      region: readOption('--s3-region', process.env.S3_REGION ?? 'auto'),
      bucket: readOption('--s3-bucket', process.env.S3_BUCKET),
      accessKeyId: readOption('--s3-access-key-id', process.env.S3_ACCESS_KEY_ID),
      secretAccessKey: readOption('--s3-secret-access-key', process.env.S3_SECRET_ACCESS_KEY),
      publicBaseUrl: readOption('--s3-public-base-url', process.env.S3_PUBLIC_BASE_URL),
      keyPrefix: readOption('--s3-key-prefix', process.env.S3_KEY_PREFIX ?? 'uploads')
    });
  }

  throw new Error(`Unsupported upload cleanup driver: ${driver}`);
}

const requestedDryRun = process.argv.includes('--dry-run');
const deleteMode = process.argv.includes('--delete');
if (requestedDryRun && deleteMode) {
  console.error('Use either --dry-run or --delete, not both');
  process.exit(1);
}
const dryRun = !deleteMode;
const forumPath = path.resolve(readOption('--data', 'data/forum.json'));
const driver = String(readOption('--driver', process.env.IMAGE_STORAGE_DRIVER ?? 'local')).toLowerCase();
const auditPath = readOption('--audit', null);

try {
  const state = JSON.parse(await fs.readFile(forumPath, 'utf8'));
  const result = await cleanupOrphanUploads({
    state,
    imageStorage: createImageStorage(driver),
    dryRun,
    logger: (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }))
  });
  const output = JSON.stringify(result, null, 2);
  if (auditPath) {
    const resolvedAuditPath = path.resolve(auditPath);
    await fs.mkdir(path.dirname(resolvedAuditPath), { recursive: true });
    await fs.writeFile(resolvedAuditPath, output);
  }
  console.log(output);
  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
