import fs from 'node:fs/promises';
import path from 'node:path';

import { createLocalImageStorage } from './image-storage.ts';

type InlineImage = Record<string, unknown> & {
  dataUrl: string;
};

type ImageMigrationOptions = {
  forumPath?: string;
  uploadRoot?: string;
  publicPath?: string;
  dryRun?: boolean;
  now?: Date;
};

type ImageMigrationResult = {
  scanned: number;
  migrated: number;
  skipped: number;
  bytesWritten: number;
  backupPath: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isInlineImage(image: unknown): image is InlineImage {
  return Boolean(
    isRecord(image) &&
    typeof image.dataUrl === 'string' &&
    image.dataUrl.startsWith('data:image/')
  );
}

function postImages(item: { image?: unknown; images?: unknown }): unknown[] {
  if (Array.isArray(item.images) && item.images.length) {
    return item.images;
  }
  return item.image ? [item.image] : [];
}

function backupPathFor(forumPath: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${forumPath}.backup-${stamp}`;
}

export async function migrateInlineImages({
  forumPath = path.resolve('data/forum.json'),
  uploadRoot = path.resolve('data/uploads'),
  publicPath = '/uploads',
  dryRun = false,
  now = new Date()
}: ImageMigrationOptions = {}): Promise<ImageMigrationResult> {
  const raw = await fs.readFile(forumPath, 'utf8');
  const state = JSON.parse(raw);
  const storage = createLocalImageStorage({ root: uploadRoot, publicPath });
  const collections = ['threads', 'comments'];
  const result: ImageMigrationResult = {
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
      const images = postImages(item);
      if (!images.length) {
        continue;
      }

      result.scanned += images.length;
      const nextImages: unknown[] = [];
      let itemMigrated = false;

      for (const image of images) {
        if (!isInlineImage(image)) {
          result.skipped += 1;
          nextImages.push(image);
          continue;
        }

        const base64 = image.dataUrl.split(',')[1] || '';
        const byteLength = Buffer.from(base64, 'base64').length;
        result.bytesWritten += byteLength;
        result.migrated += 1;
        itemMigrated = true;

        if (dryRun) {
          nextImages.push(image);
          continue;
        }

        nextImages.push(await storage.save(image));
      }

      if (!dryRun && itemMigrated) {
        item.images = nextImages;
        item.image = nextImages[0] ?? null;
      }
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
