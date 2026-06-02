import fs from 'node:fs/promises';
import path from 'node:path';

import { createLocalImageStorage } from './image-storage.js';

function isInlineImage(image) {
  return Boolean(
    image &&
    typeof image === 'object' &&
    typeof image.dataUrl === 'string' &&
    image.dataUrl.startsWith('data:image/')
  );
}

function backupPathFor(forumPath, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${forumPath}.backup-${stamp}`;
}

export async function migrateInlineImages({
  forumPath = path.resolve('data/forum.json'),
  uploadRoot = path.resolve('data/uploads'),
  publicPath = '/uploads',
  dryRun = false,
  now = new Date()
} = {}) {
  const raw = await fs.readFile(forumPath, 'utf8');
  const state = JSON.parse(raw);
  const storage = createLocalImageStorage({ root: uploadRoot, publicPath });
  const collections = ['threads', 'comments'];
  const result = {
    scanned: 0,
    migrated: 0,
    skipped: 0,
    bytesWritten: 0,
    backupPath: dryRun ? null : backupPathFor(forumPath, now)
  };

  for (const collection of collections) {
    if (!Array.isArray(state[collection])) {
      continue;
    }

    for (const item of state[collection]) {
      if (!item.image) {
        continue;
      }

      result.scanned += 1;
      if (!isInlineImage(item.image)) {
        result.skipped += 1;
        continue;
      }

      const base64 = item.image.dataUrl.split(',')[1] || '';
      const byteLength = Buffer.from(base64, 'base64').length;

      if (dryRun) {
        result.bytesWritten += byteLength;
        result.migrated += 1;
        continue;
      }

      const saved = await storage.save(item.image);
      result.bytesWritten += byteLength;
      item.image = saved;
      result.migrated += 1;
    }
  }

  if (!dryRun && result.migrated > 0) {
    await fs.copyFile(forumPath, result.backupPath);
    await fs.writeFile(forumPath, JSON.stringify(state, null, 2));
  }

  if (!dryRun && result.migrated === 0) {
    result.backupPath = null;
  }

  return result;
}
