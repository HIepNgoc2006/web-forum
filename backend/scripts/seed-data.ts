#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createJsonStore } from '../src/core/forum-store.ts';
import { createMongoStore } from '../src/core/mongo-store.ts';
import { exportSeedData, importSeedData, readSeedFile, restoreSeedRollback } from '../src/core/seed-data.ts';

type MongoStoreOptions = {
  uri?: string;
  dbName?: string;
};

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const defaultForumPath = path.resolve(scriptDir, '..', 'data', 'forum.json');

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) {
    return fallback;
  }
  return argv[index + 1];
}

function usage() {
  return `Usage:
  node backend/scripts/seed-data.ts export --out <seed.json> [options]
  node backend/scripts/seed-data.ts import --in <seed.json> [--dry-run|--write] [options]
  node backend/scripts/seed-data.ts restore --in <rollback.json> [--dry-run|--write] [options]

Options:
  --store-driver <json|mongo>  State source (default: STORE_DRIVER or json)
  --data <path>               JSON forum state path (default: backend/data/forum.json)
  --db <name>                 Mongo database name
  --out <path>                Export output path
  --in <path>                 Import input path
  --dry-run                   Validate and summarize import without writing (default)
  --write                     Apply import
  --replace                   Replace matching boards/posts instead of skipping duplicates
  --rollback <path>           Rollback snapshot path for write imports
  --public-boards-only        Exclude hidden boards during export
  -h, --help                  Show this help`;
}

export function parseSeedArgs(argv = process.argv, env = process.env) {
  const command = argv[2];
  if (!command || command === '--help' || command === '-h') {
    return { help: true };
  }
  if (!['export', 'import', 'restore'].includes(command)) {
    throw new Error(`Unknown seed command: ${command}`);
  }

  const requestedDryRun = argv.includes('--dry-run');
  const write = argv.includes('--write');
  if (requestedDryRun && write) {
    throw new Error('Use either --dry-run or --write, not both');
  }

  const storeDriver = String(readOption(argv, '--store-driver', env.STORE_DRIVER ?? 'json')).toLowerCase();
  if (!['json', 'mongo'].includes(storeDriver)) {
    throw new Error('STORE_DRIVER must be either json or mongo.');
  }

  const dataPath = path.resolve(readOption(argv, '--data', defaultForumPath));
  return {
    command,
    storeDriver,
    forumPath: dataPath,
    mongoDbName: readOption(argv, '--db', undefined),
    outPath: readOption(argv, '--out', null),
    inPath: readOption(argv, '--in', null),
    dryRun: command === 'import' || command === 'restore' ? !write : false,
    mode: argv.includes('--replace') ? 'replace' : 'skip',
    rollbackPath: readOption(argv, '--rollback', null),
    includeHiddenBoards: !argv.includes('--public-boards-only'),
    help: false
  };
}

export function createSeedStore(args, {
  createJsonStoreImpl = createJsonStore,
  createMongoStoreImpl = createMongoStore
} = {}) {
  if (args.storeDriver === 'json') {
    return createJsonStoreImpl(args.forumPath);
  }
  return createMongoStoreImpl({ dbName: args.mongoDbName } as MongoStoreOptions);
}

function summarizeResult(result) {
  return JSON.stringify(result, null, 2);
}

export async function runSeedTool(args, {
  dependencies = {},
  logger = (message) => console.log(message)
} = {}) {
  if (args.help) {
    logger(usage());
    return { help: true };
  }

  const store = createSeedStore(args, dependencies);
  try {
    if (args.command === 'export') {
      if (!args.outPath) {
        throw new Error('Export requires --out <path>');
      }
      const result = await exportSeedData({
        store,
        outPath: path.resolve(args.outPath),
        includeHiddenBoards: args.includeHiddenBoards
      });
      logger(summarizeResult(result));
      return result;
    }

    if (!args.inPath) {
      throw new Error(`${args.command === 'restore' ? 'Restore' : 'Import'} requires --in <path>`);
    }
    const input = await readSeedFile(path.resolve(args.inPath));
    const result =
      args.command === 'restore'
        ? await restoreSeedRollback({
            store,
            rollbackState: input,
            dryRun: args.dryRun,
            rollbackPath: args.rollbackPath ? path.resolve(args.rollbackPath) : null
          })
        : await importSeedData({
            store,
            seed: input,
            dryRun: args.dryRun,
            mode: args.mode,
            rollbackPath: args.rollbackPath ? path.resolve(args.rollbackPath) : null
          });
    logger(summarizeResult(result));
    return result;
  } finally {
    await store.close?.();
  }
}

if (process.argv[1] === scriptPath) {
  try {
    await runSeedTool(parseSeedArgs());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
