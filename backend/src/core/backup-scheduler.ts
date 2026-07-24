import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { normalizeState } from './forum-store.ts';

type Logger = (entry: Record<string, unknown>) => void;
type BackupStore = {
  read: () => Promise<unknown> | unknown;
  withMutationLock?: <T>(callback: () => Promise<T>) => Promise<T>;
};
type ImageStorage = {
  type?: string;
  listKeys: () => Promise<unknown[]> | unknown[];
};
type S3Metadata = {
  bucket?: unknown;
  endpoint?: unknown;
  keyPrefix?: unknown;
  backupConfirmed?: unknown;
};
type SourceMetadataOptions = {
  storeDriver?: string;
  imageStorageDriver?: string;
  forumPath?: string;
  mongoDbName?: string | null;
  uploadRoot?: string;
  s3?: S3Metadata;
};
type SystemMetadataOptions = {
  operator?: string;
  hostname?: string;
  pid?: number;
};
type ForumStateLike = {
  boards?: unknown[];
  users?: unknown[];
  threads?: unknown[];
  comments?: unknown[];
  reports?: unknown[];
  sanctions?: unknown[];
  moderationActions?: unknown[];
};
type UploadManifestOptions = {
  imageStorage?: ImageStorage;
  imageStorageDriver?: string;
  uploadRoot?: string;
};
type BackupJobOptions = {
  store?: BackupStore;
  imageStorage?: ImageStorage;
  destination?: string;
  storeDriver?: string;
  imageStorageDriver?: string;
  forumPath?: string;
  mongoDbName?: string | null;
  uploadRoot?: string;
  s3?: S3Metadata;
  dryRun?: boolean;
  operator?: string;
  now?: () => Date;
  logger?: Logger;
  writeJsonImpl?: (filePath: string, value: unknown) => Promise<void>;
};
type BackupFailure = {
  stage: string;
  error: string;
};
type BackupJobError = Error & {
  result?: Record<string, unknown>;
};
type BackupSchedulerOptions = {
  enabled?: boolean;
  intervalMs?: number;
  runJob?: () => Promise<unknown> | unknown;
  logger?: Logger;
  setIntervalImpl?: (callback: () => void, ms: number) => unknown;
  clearIntervalImpl?: (timer: unknown) => void;
};

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function safeChildPath(root: string, key: string) {
  const resolvedRoot = path.resolve(root);
  const normalizedKey = String(key).replace(/\\/g, '/').replace(/^\/+/, '');
  const resolvedPath = path.resolve(resolvedRoot, normalizedKey);
  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`) || resolvedPath === resolvedRoot) {
    throw new Error(`Unsafe local upload key: ${key}`);
  }
  return { normalizedKey, resolvedPath };
}

function backupId(now: Date): string {
  return safeTimestamp(now);
}

function sourceMetadata({ storeDriver, imageStorageDriver, forumPath, mongoDbName, uploadRoot, s3 = {} }: SourceMetadataOptions) {
  return {
    store: {
      driver: storeDriver,
      forumPath: storeDriver === 'json' ? forumPath : undefined,
      dbName: storeDriver === 'mongo' ? mongoDbName ?? null : undefined
    },
    uploads: {
      driver: imageStorageDriver,
      root: imageStorageDriver === 'local' ? uploadRoot : undefined,
      bucket: imageStorageDriver === 's3' ? s3.bucket ?? null : undefined,
      endpoint: imageStorageDriver === 's3' ? s3.endpoint ?? null : undefined,
      keyPrefix: imageStorageDriver === 's3' ? s3.keyPrefix ?? null : undefined
    }
  };
}

function systemMetadata({ operator, hostname = os.hostname(), pid = process.pid }: SystemMetadataOptions = {}) {
  return {
    operator: operator || process.env.USER || process.env.USERNAME || 'system',
    hostname,
    pid
  };
}

async function localUploadMetadata(uploadRoot: string, key: string) {
  const { normalizedKey, resolvedPath } = safeChildPath(uploadRoot, key);
  const stat = await fs.stat(resolvedPath);
  return {
    storageKey: normalizedKey,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString()
  };
}

async function copyLocalUploads(uploadRoot: string, backupRoot: string, uploads: Array<Record<string, unknown>>) {
  const copied = [];
  for (const upload of uploads) {
    const storageKey = String(upload.storageKey ?? '');
    const source = safeChildPath(uploadRoot, storageKey);
    const destination = safeChildPath(backupRoot, storageKey);
    await ensureDirectory(path.dirname(destination.resolvedPath));
    await fs.copyFile(source.resolvedPath, destination.resolvedPath);
    const stat = await fs.stat(destination.resolvedPath);
    copied.push({
      ...upload,
      sizeBytes: stat.size,
      sha256: await sha256File(destination.resolvedPath),
      backupPath: destination.normalizedKey
    });
  }
  return copied;
}

async function uploadManifest({ imageStorage, imageStorageDriver, uploadRoot }: UploadManifestOptions) {
  if (!imageStorage || typeof imageStorage.listKeys !== 'function') {
    throw new Error('Image storage must provide listKeys');
  }
  const keys = (await imageStorage.listKeys()).map((key) => String(key).replace(/\\/g, '/')).sort();
  if (imageStorageDriver !== 'local') {
    return keys.map((storageKey) => ({ storageKey }));
  }
  const entries = [];
  for (const key of keys) {
    entries.push(await localUploadMetadata(uploadRoot, key));
  }
  return entries;
}

export function backupSummary({ state, uploads }: { state: ForumStateLike; uploads: unknown[] }) {
  return {
    boards: Array.isArray(state.boards) ? state.boards.length : 0,
    users: Array.isArray(state.users) ? state.users.length : 0,
    threads: Array.isArray(state.threads) ? state.threads.length : 0,
    comments: Array.isArray(state.comments) ? state.comments.length : 0,
    reports: Array.isArray(state.reports) ? state.reports.length : 0,
    sanctions: Array.isArray(state.sanctions) ? state.sanctions.length : 0,
    moderationActions: Array.isArray(state.moderationActions) ? state.moderationActions.length : 0,
    uploads: uploads.length
  };
}

export async function runBackupJob({
  store,
  imageStorage,
  destination,
  storeDriver,
  imageStorageDriver,
  forumPath,
  mongoDbName,
  uploadRoot,
  s3 = {},
  dryRun = true,
  operator,
  now = () => new Date(),
  logger = () => undefined,
  writeJsonImpl = writeJson
}: BackupJobOptions = {}) {
  if (!store || typeof store.read !== 'function') {
    throw new Error('Backup store must provide read()');
  }
  if (!destination) {
    throw new Error('Backup destination is required');
  }

  const startedAtDate = now();
  const startedAt = startedAtDate.toISOString();
  const id = backupId(startedAtDate);
  const resolvedDestination = path.resolve(destination);
  const readSources = async () => ({
    state: normalizeState(await store.read()),
    uploads: await uploadManifest({ imageStorage, imageStorageDriver, uploadRoot })
  });
  const { state, uploads } = storeDriver === 'mongo' && store.withMutationLock
    ? await store.withMutationLock(readSources)
    : await readSources();
  const s3BackupConfirmed = s3.backupConfirmed === true
    || String(s3.backupConfirmed ?? '').toLowerCase() === 'true';
  const metadata = {
    id,
    dryRun: Boolean(dryRun),
    startedAt,
    finishedAt: null,
    source: sourceMetadata({ storeDriver, imageStorageDriver, forumPath, mongoDbName, uploadRoot, s3 }),
    destination: {
      root: resolvedDestination,
      statePath: path.join(resolvedDestination, `${id}-forum-state.json`),
      uploadsPath: path.join(resolvedDestination, `${id}-uploads-manifest.json`),
      uploadsDirectory: path.join(resolvedDestination, `${id}-uploads`),
      metadataPath: path.join(resolvedDestination, `${id}-backup-metadata.json`)
    },
    system: systemMetadata({ operator }),
    counts: backupSummary({ state, uploads }),
    recoverability: {
      state: { complete: false },
      uploads: {
        complete: false,
        strategy: imageStorageDriver === 'local' ? 'copied-files' : 'provider-managed',
        reason: dryRun ? 'dry_run' : null
      }
    },
    failures: [] as BackupFailure[]
  };

  logger({ event: 'backup_started', id, dryRun: metadata.dryRun, destination: resolvedDestination });

  let manifestUploads = uploads;
  if (!dryRun) {
    try {
      await writeJsonImpl(metadata.destination.statePath, state);
      metadata.recoverability.state.complete = true;
    } catch (error) {
      metadata.failures.push({ stage: 'state', error: error instanceof Error ? error.message : String(error) });
    }

    if (imageStorageDriver === 'local') {
      try {
        manifestUploads = await copyLocalUploads(
          String(uploadRoot || ''),
          metadata.destination.uploadsDirectory,
          uploads as Array<Record<string, unknown>>
        );
        metadata.recoverability.uploads.complete = true;
        metadata.recoverability.uploads.reason = null;
      } catch (error) {
        metadata.failures.push({
          stage: 'uploads',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } else if (s3BackupConfirmed) {
      metadata.recoverability.uploads.complete = true;
      metadata.recoverability.uploads.reason = 'provider_backup_confirmed';
    } else {
      metadata.recoverability.uploads.reason = 'provider_backup_not_confirmed';
      metadata.failures.push({
        stage: 'uploads',
        error: 'S3 upload bytes are not backed up by this job. Confirm provider versioning/export with S3_BACKUP_CONFIRMED=true.'
      });
    }

    try {
      await writeJsonImpl(metadata.destination.uploadsPath, {
        id,
        generatedAt: startedAt,
        recoverability: metadata.recoverability.uploads,
        uploads: manifestUploads
      });
    } catch (error) {
      metadata.failures.push({ stage: 'manifest', error: error instanceof Error ? error.message : String(error) });
    }
  }

  metadata.finishedAt = now().toISOString();
  if (!dryRun) {
    try {
      await writeJsonImpl(metadata.destination.metadataPath, metadata);
    } catch (error) {
      metadata.failures.push({ stage: 'metadata', error: error instanceof Error ? error.message : String(error) });
    }
  }
  logger({
    event: 'backup_finished',
    id,
    dryRun: metadata.dryRun,
    failures: metadata.failures.length,
    counts: metadata.counts
  });
  const result = jsonClone(metadata);
  if (!dryRun && metadata.failures.length > 0) {
    const error: BackupJobError = new Error(`Backup ${id} failed in ${metadata.failures.length} stage(s)`);
    error.result = result;
    throw error;
  }
  return result;
}

export function createBackupScheduler({
  enabled = false,
  intervalMs = 24 * 60 * 60 * 1000,
  runJob,
  logger = () => undefined,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
}: BackupSchedulerOptions = {}) {
  if (typeof runJob !== 'function') {
    throw new Error('Backup scheduler requires runJob');
  }
  const safeIntervalMs = Math.max(60_000, Number(intervalMs) || 0);
  let timer: unknown = null;
  let running = false;

  async function tick() {
    if (running) {
      logger({ event: 'backup_skipped', reason: 'already_running' });
      return null;
    }
    running = true;
    try {
      return await runJob();
    } finally {
      running = false;
    }
  }

  return {
    enabled: Boolean(enabled),
    intervalMs: safeIntervalMs,
    start() {
      if (!enabled) {
        logger({ event: 'backup_scheduler_disabled' });
        return false;
      }
      if (timer) {
        return true;
      }
      timer = setIntervalImpl(() => {
        tick().catch((error) => {
          logger({ event: 'backup_failed', error: error instanceof Error ? error.message : String(error) });
        });
      }, safeIntervalMs);
      logger({ event: 'backup_scheduler_started', intervalMs: safeIntervalMs });
      return true;
    },
    stop() {
      if (!timer) {
        return false;
      }
      clearIntervalImpl(timer);
      timer = null;
      logger({ event: 'backup_scheduler_stopped' });
      return true;
    },
    tick
  };
}
