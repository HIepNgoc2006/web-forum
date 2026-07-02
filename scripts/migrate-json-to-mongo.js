#!/usr/bin/env node

/**
 * migrate-json-to-mongo.js
 *
 * Migrate forum data from JSON file store to MongoDB.
 *
 * Usage:
 *   MONGODB_URI=mongodb://... node scripts/migrate-json-to-mongo.js [options]
 *
 * Options:
 *   --data <path>     Path to forum.json (default: data/forum.json)
 *   --db <name>       MongoDB database name (optional, derived from URI if omitted)
 *   --dry-run         Validate and report without writing to MongoDB
 *   --drop            Drop existing collections before migrating (destructive!)
 *   --quiet           Suppress per-collection progress output
 *
 * Environment:
 *   MONGODB_URI       Required. MongoDB connection string.
 *
 * Rollback:
 *   This script inserts data into MongoDB collections. To rollback, drop the
 *   affected collections: threads, comments, users, reports, sanctions,
 *   moderationActions, aiUsage, aiSummaryCache, stateMeta, boards.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    dataPath: path.resolve(__dirname, '..', 'data', 'forum.json'),
    dbName: undefined,
    dryRun: false,
    drop: false,
    quiet: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--data' && argv[i + 1]) {
      args.dataPath = path.resolve(argv[++i]);
    } else if (arg === '--db' && argv[i + 1]) {
      args.dbName = argv[++i];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--drop') {
      args.drop = true;
    } else if (arg === '--quiet') {
      args.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: MONGODB_URI=mongodb://... node scripts/migrate-json-to-mongo.js [options]

Options:
  --data <path>   Path to forum.json (default: data/forum.json)
  --db <name>     MongoDB database name
  --dry-run       Validate and report without writing
  --drop          Drop existing collections before migrating
  --quiet         Suppress per-collection progress
  -h, --help      Show this help`);
      process.exit(0);
    }
  }

  return args;
}

function validateRecord(record, requiredFields, label) {
  const errors = [];
  for (const field of requiredFields) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      errors.push(`${label}: missing required field "${field}"`);
    }
  }
  return errors;
}

function validateState(state) {
  const errors = [];
  const warnings = [];
  const counts = {};

  // Validate threads
  const threads = Array.isArray(state.threads) ? state.threads : [];
  counts.threads = threads.length;
  for (const thread of threads) {
    const threadErrors = validateRecord(
      thread,
      ['id', 'boardSlug', 'body', 'createdAt'],
      `Thread ${thread.id ?? thread.globalNumber ?? '(unknown)'}`
    );
    errors.push(...threadErrors);
  }

  // Validate comments
  const comments = Array.isArray(state.comments) ? state.comments : [];
  counts.comments = comments.length;
  for (const comment of comments) {
    const commentErrors = validateRecord(
      comment,
      ['id', 'threadId', 'boardSlug', 'body', 'createdAt'],
      `Comment ${comment.id ?? comment.globalNumber ?? '(unknown)'}`
    );
    errors.push(...commentErrors);
  }

  // Validate users
  const users = Array.isArray(state.users) ? state.users : [];
  counts.users = users.length;
  for (const user of users) {
    const userErrors = validateRecord(
      user,
      ['id', 'username'],
      `User ${user.id ?? user.username ?? '(unknown)'}`
    );
    errors.push(...userErrors);
  }

  // Validate reports
  const reports = Array.isArray(state.reports) ? state.reports : [];
  counts.reports = reports.length;
  for (const report of reports) {
    const reportErrors = validateRecord(
      report,
      ['id', 'createdAt'],
      `Report ${report.id ?? '(unknown)'}`
    );
    errors.push(...reportErrors);
  }

  // Validate appeals
  const appeals = Array.isArray(state.appeals) ? state.appeals : [];
  counts.appeals = appeals.length;
  for (const appeal of appeals) {
    const appealErrors = validateRecord(
      appeal,
      ['id', 'tokenHash', 'createdAt'],
      `Appeal ${appeal.id ?? '(unknown)'}`
    );
    errors.push(...appealErrors);
  }

  // Validate sanctions
  const sanctions = Array.isArray(state.sanctions) ? state.sanctions : [];
  counts.sanctions = sanctions.length;
  for (const sanction of sanctions) {
    const sanctionErrors = validateRecord(
      sanction,
      ['id', 'fingerprint', 'createdAt'],
      `Sanction ${sanction.id ?? '(unknown)'}`
    );
    errors.push(...sanctionErrors);
  }

  // Validate moderation actions
  const moderationActions = Array.isArray(state.moderationActions) ? state.moderationActions : [];
  counts.moderationActions = moderationActions.length;

  // AI usage / summary cache (key-value maps)
  const aiUsage = state.aiUsage && typeof state.aiUsage === 'object' ? state.aiUsage : {};
  counts.aiUsageKeys = Object.keys(aiUsage).length;
  const aiSummaryCache = state.aiSummaryCache && typeof state.aiSummaryCache === 'object' ? state.aiSummaryCache : {};
  counts.aiSummaryCacheKeys = Object.keys(aiSummaryCache).length;

  // State meta
  const nextGlobalNumber = state.nextGlobalNumber;
  if (!Number.isFinite(nextGlobalNumber) || nextGlobalNumber < 1) {
    warnings.push(`nextGlobalNumber is invalid: ${nextGlobalNumber}`);
  }
  counts.nextGlobalNumber = nextGlobalNumber;

  return { errors, warnings, counts };
}

async function migrate(args) {
  const uri = process.env.MONGODB_URI;
  if (!uri && !args.dryRun) {
    console.error('❌ MONGODB_URI environment variable is required');
    process.exit(1);
  }

  // Read JSON data
  console.log(`📂 Reading data from: ${args.dataPath}`);
  let raw;
  try {
    raw = await fs.readFile(args.dataPath, 'utf8');
  } catch (error) {
    console.error(`❌ Cannot read data file: ${error.message}`);
    process.exit(1);
  }

  let state;
  try {
    state = JSON.parse(raw);
  } catch (error) {
    console.error(`❌ Invalid JSON: ${error.message}`);
    process.exit(1);
  }

  // Validate
  console.log('\n🔍 Validating data...');
  const { errors, warnings, counts } = validateState(state);

  console.log('\n📊 Data Summary:');
  console.log(`   Threads:            ${counts.threads}`);
  console.log(`   Comments:           ${counts.comments}`);
  console.log(`   Users:              ${counts.users}`);
  console.log(`   Reports:            ${counts.reports}`);
  console.log(`   Appeals:            ${counts.appeals}`);
  console.log(`   Sanctions:          ${counts.sanctions}`);
  console.log(`   Moderation Actions: ${counts.moderationActions}`);
  console.log(`   AI Usage Keys:      ${counts.aiUsageKeys}`);
  console.log(`   AI Cache Keys:      ${counts.aiSummaryCacheKeys}`);
  console.log(`   Next Global Number: ${counts.nextGlobalNumber}`);

  if (warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${warnings.length}):`);
    for (const warning of warnings) {
      console.log(`   - ${warning}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n❌ Validation Errors (${errors.length}):`);
    for (const error of errors.slice(0, 20)) {
      console.log(`   - ${error}`);
    }
    if (errors.length > 20) {
      console.log(`   ... and ${errors.length - 20} more errors`);
    }
    console.error('\n❌ Fix validation errors before migrating.');
    process.exit(1);
  }

  console.log('\n✅ Validation passed');

  if (args.dryRun) {
    console.log('\n🏁 Dry run complete. No data was written.');
    return;
  }

  // Connect to MongoDB
  console.log(`\n🔌 Connecting to MongoDB...`);
  const mongoose = (await import('mongoose')).default;
  const { createMongoModels } = await import('../backend/src/core/mongo-store.ts');
  const { BOARDS } = await import('../backend/src/core/config.ts');

  const connectOptions = args.dbName ? { dbName: args.dbName } : undefined;
  const connection = await mongoose.createConnection(uri, connectOptions).asPromise();
  console.log('✅ Connected');

  try {
    const models = createMongoModels(connection);

    // Drop collections if requested
    if (args.drop) {
      console.log('\n🗑️  Dropping existing collections...');
      const collectionNames = [
        'threads', 'comments', 'users', 'reports', 'appeals', 'sanctions',
        'moderationActions', 'aiUsage', 'aiSummaryCache', 'stateMeta', 'boards'
      ];
      for (const name of collectionNames) {
        try {
          await connection.db.collection(name).drop();
          if (!args.quiet) console.log(`   Dropped: ${name}`);
        } catch {
          if (!args.quiet) console.log(`   Skip (not found): ${name}`);
        }
      }
    }

    // Migrate boards from config
    console.log('\n📦 Migrating boards...');
    await models.Board.bulkWrite(
      BOARDS.map((board) => ({
        updateOne: {
          filter: { slug: board.slug },
          update: { $set: board },
          upsert: true
        }
      })),
      { ordered: true }
    );
    if (!args.quiet) console.log(`   ✅ ${BOARDS.length} boards upserted`);

    // Migrate state meta
    console.log('\n📦 Migrating state meta...');
    await models.StateMeta.updateOne(
      { _id: 'global' },
      {
        $set: {
          version: state.version ?? 1,
          nextGlobalNumber: state.nextGlobalNumber ?? 1
        }
      },
      { upsert: true }
    );
    if (!args.quiet) console.log(`   ✅ nextGlobalNumber = ${state.nextGlobalNumber}`);

    // Helper for bulk insert
    async function migrateCollection(label, model, items) {
      if (!args.quiet) process.stdout.write(`\n📦 Migrating ${label}... `);
      if (items.length === 0) {
        if (!args.quiet) console.log('(empty)');
        return;
      }
      await model.insertMany(items, { ordered: true });
      if (!args.quiet) console.log(`✅ ${items.length} documents`);
    }

    // Migrate each collection
    await migrateCollection('threads', models.Thread, state.threads ?? []);
    await migrateCollection('comments', models.Comment, state.comments ?? []);
    await migrateCollection('users', models.User, state.users ?? []);
    await migrateCollection('reports', models.Report, state.reports ?? []);
    await migrateCollection('appeals', models.Appeal, state.appeals ?? []);
    await migrateCollection('sanctions', models.Sanction, state.sanctions ?? []);
    await migrateCollection('moderationActions', models.ModerationAction, state.moderationActions ?? []);

    // AI usage (key-value)
    const aiUsageEntries = Object.entries(state.aiUsage ?? {}).map(([key, value]) => ({
      _id: key,
      value
    }));
    await migrateCollection('aiUsage', models.AiUsage, aiUsageEntries);

    // AI summary cache (key-value)
    const aiCacheEntries = Object.entries(state.aiSummaryCache ?? {}).map(([key, value]) => ({
      _id: key,
      value
    }));
    await migrateCollection('aiSummaryCache', models.AiSummaryCache, aiCacheEntries);

    // Verify counts
    console.log('\n🔍 Verifying migration...');
    const [threadCount, commentCount, userCount, reportCount, appealCount, sanctionCount, modActionCount] =
      await Promise.all([
        models.Thread.countDocuments(),
        models.Comment.countDocuments(),
        models.User.countDocuments(),
        models.Report.countDocuments(),
        models.Appeal.countDocuments(),
        models.Sanction.countDocuments(),
        models.ModerationAction.countDocuments()
      ]);

    const expected = {
      threads: (state.threads ?? []).length,
      comments: (state.comments ?? []).length,
      users: (state.users ?? []).length,
      reports: (state.reports ?? []).length,
      appeals: (state.appeals ?? []).length,
      sanctions: (state.sanctions ?? []).length,
      moderationActions: (state.moderationActions ?? []).length
    };
    const actual = {
      threads: threadCount,
      comments: commentCount,
      users: userCount,
      reports: reportCount,
      appeals: appealCount,
      sanctions: sanctionCount,
      moderationActions: modActionCount
    };

    let mismatch = false;
    for (const [key, expectedCount] of Object.entries(expected)) {
      const actualCount = actual[key];
      const status = actualCount >= expectedCount ? '✅' : '❌';
      if (actualCount < expectedCount) mismatch = true;
      console.log(`   ${status} ${key}: ${actualCount} (expected ${expectedCount})`);
    }

    if (mismatch) {
      console.error('\n⚠️  Some counts do not match. Check for pre-existing data or duplicates.');
    }

    console.log('\n🏁 Migration complete!');
    console.log('\nTo rollback, drop the following MongoDB collections:');
    console.log('   threads, comments, users, reports, appeals, sanctions,');
    console.log('   moderationActions, aiUsage, aiSummaryCache, stateMeta, boards');
  } finally {
    await connection.close();
  }
}

migrate(parseArgs(process.argv)).catch((error) => {
  console.error(`\n❌ Migration failed: ${error.message}`);
  process.exit(1);
});
