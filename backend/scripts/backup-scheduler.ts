#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createJsonStore } from '../src/core/forum-store.js';
import { createLocalImageStorage, createS3ImageStorage } from '../src/core/image-storage.js';
import { createMongoStore } from '../src/core/mongo-store.js';
import { createBackupScheduler, runBackupJob } from '../src/core/backup-scheduler.ts';

type MongoStoreOptions = {
  uri?: string;
  dbName?: string;
};

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const backendRoot = path.resolve(scriptDir, '..');
const defaultForumPath = path.join(backendRoot, 'data', 'forum.json');
const defaultUploadRoot = path.join(backendRoot, 'data', 'uploads');
const defaultBackupDestination = path.join(backendRoot, 'data', 'backups');

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) {
    return fallback;
  }
  return argv[index + 1];
}

function usage() {
  return `Usage:
  node backend/scripts/backup-scheduler.ts run [options]
  node backend/scripts/backup-scheduler.ts schedule --enable [options]

Options:
  --store-driver <json|mongo>  State source (default: STORE_DRIVER, or mongo in production)
  --data <path>               JSON forum state path (default: backend/data/forum.json)
  --db <name>                 Mongo database name
  --driver <local|s3>         Upload storage driver (default: IMAGE_STORAGE_DRIVER or local)
  --upload-root <path>        Local upload root (default: backend/data/uploads)
  --destination <path>        Backup output directory (default: backend/data/backups)
  --dry-run                   Read sources and report without writing backup files (default)
  --write                     Write backup files
  --enable                    Required for schedule mode unless BACKUP_SCHEDULER_ENABLED=true
  --interval-ms <ms>          Schedule interval, minimum 60000 (default: BACKUP_INTERVAL_MS or 86400000)
  --operator <name>           Operator/system label recorded in backup metadata
  --s3-endpoint <url>         S3-compatible endpoint
  --s3-region <region>        S3 region (default: S3_REGION or auto)
  --s3-bucket <bucket>        S3 bucket
  --s3-key-prefix <prefix>    S3 key prefix (default: S3_KEY_PREFIX or uploads)
  -h, --help                  Show this help`;
}

export function parseBackupArgs(argv = process.argv, env = process.env) {
  const command = argv[2];
  if (!command || command === '--help' || command === '-h') {
    return { help: true };
  }
  if (!['run', 'schedule'].includes(command)) {
    throw new Error(`Unknown backup command: ${command}`);
  }
  const requestedDryRun = argv.includes('--dry-run');
  const write = argv.includes('--write');
  if (requestedDryRun && write) {
    throw new Error('Use either --dry-run or --write, not both');
  }
  const productionMode = env.NODE_ENV === 'production';
  const enabled = argv.includes('--enable') || String(env.BACKUP_SCHEDULER_ENABLED || '').toLowerCase() === 'true';
  const storeDriver = String(readOption(argv, '--store-driver', env.STORE_DRIVER ?? (productionMode ? 'mongo' : 'json'))).toLowerCase();
  if (!['json', 'mongo'].includes(storeDriver)) {
    throw new Error('STORE_DRIVER must be either json or mongo.');
  }
  const imageStorageDriver = String(readOption(argv, '--driver', env.IMAGE_STORAGE_DRIVER ?? 'local')).toLowerCase();
  if (!['local', 's3'].includes(imageStorageDriver)) {
    throw new Error('Upload backup driver must be either local or s3.');
  }

  return {
    command,
    help: false,
    dryRun: !write,
    enabled,
    intervalMs: Number(readOption(argv, '--interval-ms', env.BACKUP_INTERVAL_MS ?? 24 * 60 * 60 * 1000)),
    storeDriver,
    forumPath: path.resolve(readOption(argv, '--data', defaultForumPath)),
    mongoDbName: readOption(argv, '--db', undefined),
    imageStorageDriver,
    uploadRoot: path.resolve(readOption(argv, '--upload-root', env.UPLOAD_ROOT ?? defaultUploadRoot)),
    destination: path.resolve(readOption(argv, '--destination', env.BACKUP_DESTINATION ?? defaultBackupDestination)),
    operator: readOption(argv, '--operator', env.BACKUP_OPERATOR ?? undefined),
    s3: {
      endpoint: readOption(argv, '--s3-endpoint', env.S3_ENDPOINT),
      region: readOption(argv, '--s3-region', env.S3_REGION ?? 'auto'),
      bucket: readOption(argv, '--s3-bucket', env.S3_BUCKET),
      accessKeyId: readOption(argv, '--s3-access-key-id', env.S3_ACCESS_KEY_ID),
      secretAccessKey: readOption(argv, '--s3-secret-access-key', env.S3_SECRET_ACCESS_KEY),
      publicBaseUrl: readOption(argv, '--s3-public-base-url', env.S3_PUBLIC_BASE_URL),
      keyPrefix: readOption(argv, '--s3-key-prefix', env.S3_KEY_PREFIX ?? 'uploads')
    }
  };
}

export function createBackupStore(args, {
  createJsonStoreImpl = createJsonStore,
  createMongoStoreImpl = createMongoStore
} = {}) {
  if (args.storeDriver === 'json') {
    return createJsonStoreImpl(args.forumPath);
  }
  return createMongoStoreImpl({ dbName: args.mongoDbName } as MongoStoreOptions);
}

export function createBackupImageStorage(args) {
  if (args.imageStorageDriver === 'local') {
    return createLocalImageStorage({ root: args.uploadRoot });
  }
  return createS3ImageStorage(args.s3);
}

export async function runBackupCommand(args, {
  dependencies = {},
  logger = (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry })),
  output = (value) => {
    if (typeof value === 'string') {
      console.log(value);
      return;
    }
    console.log(JSON.stringify(value, null, 2));
  }
} = {}) {
  if (args.help) {
    output(usage());
    return { help: true };
  }
  const typedDependencies = dependencies as typeof dependencies & {
    createJsonStoreImpl?: typeof createJsonStore;
    createMongoStoreImpl?: typeof createMongoStore;
    createImageStorageImpl?: (args: unknown) => ReturnType<typeof createBackupImageStorage>;
    writeJsonImpl?: (filePath: string, value: unknown) => Promise<void>;
  };
  const store = createBackupStore(args, typedDependencies);
  const imageStorage = typedDependencies.createImageStorageImpl?.(args) ?? createBackupImageStorage(args);

  async function runOnce() {
    return runBackupJob({
      store,
      imageStorage,
      destination: args.destination,
      storeDriver: args.storeDriver,
      imageStorageDriver: args.imageStorageDriver,
      forumPath: args.forumPath,
      mongoDbName: args.mongoDbName,
      uploadRoot: args.uploadRoot,
      s3: args.s3,
      dryRun: args.dryRun,
      operator: args.operator,
      logger,
      writeJsonImpl: typedDependencies.writeJsonImpl
    });
  }

  try {
    if (args.command === 'run') {
      const result = await runOnce();
      output(result);
      return result;
    }

    const scheduler = createBackupScheduler({
      enabled: args.enabled,
      intervalMs: args.intervalMs,
      runJob: runOnce,
      logger
    });
    const started = scheduler.start();
    if (!started) {
      const result = { enabled: false, dryRun: args.dryRun, reason: 'backup scheduler disabled' };
      output(result);
      return result;
    }
    output({ enabled: true, dryRun: args.dryRun, intervalMs: scheduler.intervalMs, destination: args.destination });
    return scheduler;
  } finally {
    if (args.command !== 'schedule') {
      await store.close?.();
    }
  }
}

if (process.argv[1] === scriptPath) {
  try {
    await runBackupCommand(parseBackupArgs());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
