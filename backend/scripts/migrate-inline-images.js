import path from 'node:path';

import { migrateInlineImages } from '../src/core/image-migration.ts';

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

const dryRun = process.argv.includes('--dry-run');
const forumPath = path.resolve(readOption('--data', 'data/forum.json'));
const uploadRoot = path.resolve(readOption('--upload-root', process.env.UPLOAD_ROOT ?? 'data/uploads'));
const publicPath = readOption('--public-path', '/uploads');

try {
  const result = await migrateInlineImages({
    forumPath,
    uploadRoot,
    publicPath,
    dryRun
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
