import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeState } from './forum-store.js';

const SEED_VERSION = 1;
const PRIVATE_POST_FIELDS = new Set([
  'authorFingerprint',
  'opProofHash',
  'deletePasswordHash',
  'pollVotes',
  'voters',
  'stickiedBy',
  'accountId',
  'ip',
  'posterToken',
  'captchaToken',
  'adminToken'
]);

const MEDIA_FIELDS = [
  'name',
  'type',
  'sizeBytes',
  'width',
  'height',
  'durationSeconds',
  'storage',
  'storageKey',
  'url',
  'spoiler'
];

const THREAD_FIELDS = [
  'id',
  'boardSlug',
  'subject',
  'body',
  'displayName',
  'tripcode',
  'capcode',
  'image',
  'images',
  'poll',
  'diceRolls',
  'globalNumber',
  'options',
  'sage',
  'noko',
  'isPending',
  'isDeleted',
  'moderationStatus',
  'moderationLabels',
  'moderationConfidence',
  'createdAt',
  'bumpedAt',
  'isArchived',
  'archivedAt',
  'archivedReason',
  'isLocked',
  'lockedAt',
  'slowModeUntil',
  'slowModeSeconds',
  'isSticky',
  'stickiedAt'
];

const COMMENT_FIELDS = [
  'id',
  'threadId',
  'boardSlug',
  'body',
  'displayName',
  'tripcode',
  'capcode',
  'image',
  'images',
  'diceRolls',
  'globalNumber',
  'options',
  'sage',
  'noko',
  'isPending',
  'isDeleted',
  'moderationStatus',
  'moderationLabels',
  'moderationConfidence',
  'createdAt'
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function pickFields(source, fields) {
  const result = {};
  for (const field of fields) {
    if (Object.hasOwn(source, field)) {
      result[field] = source[field];
    }
  }
  return result;
}

function sanitizeMedia(media) {
  if (!media || typeof media !== 'object') {
    return null;
  }
  const sanitized = pickFields(media, MEDIA_FIELDS);
  if (media.thumbnail && typeof media.thumbnail === 'object') {
    sanitized.thumbnail = sanitizeMedia(media.thumbnail);
  }
  return compactObject(sanitized);
}

function sanitizePoll(poll) {
  if (!poll || typeof poll !== 'object' || !Array.isArray(poll.options)) {
    return null;
  }
  const options = poll.options
    .filter((option) => option && typeof option === 'object')
    .map((option) => compactObject({
      id: option.id,
      text: option.text,
      votes: Number(option.votes || 0)
    }))
    .filter((option) => option.id && option.text);
  if (options.length < 2) {
    return null;
  }
  return compactObject({
    options,
    totalVotes: options.reduce((total, option) => total + Number(option.votes || 0), 0),
    updatedAt: poll.updatedAt
  });
}

function sanitizePost(post, fields) {
  const source = { ...post };
  for (const field of PRIVATE_POST_FIELDS) {
    delete source[field];
  }
  const sanitized = pickFields(source, fields);
  if (sanitized.image) {
    sanitized.image = sanitizeMedia(sanitized.image);
  }
  if (Array.isArray(sanitized.images)) {
    sanitized.images = sanitized.images.map(sanitizeMedia).filter(Boolean);
    sanitized.image = sanitized.images[0] ?? sanitized.image ?? null;
  } else if (sanitized.image) {
    sanitized.images = [sanitized.image];
  }
  if (sanitized.poll) {
    sanitized.poll = sanitizePoll(sanitized.poll);
  }
  return compactObject(sanitized);
}

function sanitizeBoard(board) {
  return clone(board);
}

function publicSeedPost(post) {
  return !post.isDeleted && !post.isPending;
}

export function sanitizeSeedState(state, { includeHiddenBoards = true } = {}) {
  const normalized = normalizeState(state);
  const boards = normalized.boards
    .filter((board) => includeHiddenBoards || !board.hidden)
    .map(sanitizeBoard);
  const boardSlugs = new Set(boards.map((board) => board.slug));
  const threads = normalized.threads
    .filter((thread) => publicSeedPost(thread) && boardSlugs.has(thread.boardSlug))
    .map((thread) => sanitizePost(thread, THREAD_FIELDS));
  const threadIds = new Set(threads.map((thread) => thread.id));
  const comments = normalized.comments
    .filter((comment) => publicSeedPost(comment) && threadIds.has(comment.threadId))
    .map((comment) => sanitizePost(comment, COMMENT_FIELDS));
  const maxGlobalNumber = Math.max(
    0,
    ...threads.map((thread) => Number(thread.globalNumber) || 0),
    ...comments.map((comment) => Number(comment.globalNumber) || 0)
  );

  return {
    version: SEED_VERSION,
    exportedAt: new Date().toISOString(),
    boards,
    threads,
    comments,
    nextGlobalNumber: Math.max(Number(normalized.nextGlobalNumber) || 1, maxGlobalNumber + 1)
  };
}

function requireArray(seed, key, errors) {
  if (!Array.isArray(seed[key])) {
    errors.push(`${key} must be an array`);
    return [];
  }
  return seed[key];
}

function validateRequired(record, fields, label, errors) {
  for (const field of fields) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      errors.push(`${label} is missing ${field}`);
    }
  }
}

function validateUnique(items, key, label, errors) {
  const seen = new Set();
  for (const item of items) {
    const value = item?.[key];
    if (!value) {
      continue;
    }
    if (seen.has(value)) {
      errors.push(`${label} has duplicate ${key}: ${value}`);
    }
    seen.add(value);
  }
}

function validateGlobalNumbers(items, label, errors) {
  const seen = new Set();
  for (const item of items) {
    const value = Number(item?.globalNumber);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value < 1) {
      errors.push(`${label} ${item.id ?? '(unknown)'} has invalid globalNumber`);
    }
    if (seen.has(value)) {
      errors.push(`${label} has duplicate globalNumber: ${value}`);
    }
    seen.add(value);
  }
}

export function validateSeed(seed) {
  const errors = [];
  if (!seed || typeof seed !== 'object') {
    return { valid: false, errors: ['Seed file must contain a JSON object'] };
  }
  if (seed.version !== SEED_VERSION) {
    errors.push(`Unsupported seed version: ${seed.version ?? '(missing)'}`);
  }

  const boards = requireArray(seed, 'boards', errors);
  const threads = requireArray(seed, 'threads', errors);
  const comments = requireArray(seed, 'comments', errors);

  for (const board of boards) {
    validateRequired(board, ['slug', 'name'], `Board ${board?.slug ?? '(unknown)'}`, errors);
  }
  for (const thread of threads) {
    validateRequired(thread, ['id', 'boardSlug', 'body', 'createdAt'], `Thread ${thread?.id ?? '(unknown)'}`, errors);
  }
  for (const comment of comments) {
    validateRequired(comment, ['id', 'threadId', 'boardSlug', 'body', 'createdAt'], `Comment ${comment?.id ?? '(unknown)'}`, errors);
  }

  validateUnique(boards, 'slug', 'boards', errors);
  validateUnique(threads, 'id', 'threads', errors);
  validateUnique(comments, 'id', 'comments', errors);
  validateGlobalNumbers([...threads, ...comments], 'post', errors);

  const boardSlugs = new Set(boards.map((board) => board.slug));
  const threadIds = new Set(threads.map((thread) => thread.id));
  for (const thread of threads) {
    if (thread.boardSlug && !boardSlugs.has(thread.boardSlug)) {
      errors.push(`Thread ${thread.id} references missing board ${thread.boardSlug}`);
    }
  }
  for (const comment of comments) {
    if (comment.threadId && !threadIds.has(comment.threadId)) {
      errors.push(`Comment ${comment.id} references missing thread ${comment.threadId}`);
    }
    if (comment.boardSlug && !boardSlugs.has(comment.boardSlug)) {
      errors.push(`Comment ${comment.id} references missing board ${comment.boardSlug}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function indexBy(values, key) {
  const index = new Map();
  for (const value of values) {
    if (value?.[key] !== undefined && value?.[key] !== null) {
      index.set(value[key], value);
    }
  }
  return index;
}

function duplicatePost(existingById, existingByNumber, post) {
  if (existingById.has(post.id)) {
    return true;
  }
  const globalNumber = Number(post.globalNumber);
  return Number.isFinite(globalNumber) && existingByNumber.has(globalNumber);
}

function removeDuplicatePosts(items, post) {
  const globalNumber = Number(post.globalNumber);
  return items.filter((item) => {
    if (item.id === post.id) {
      return false;
    }
    return !(Number.isFinite(globalNumber) && Number(item.globalNumber) === globalNumber);
  });
}

function maxPostNumber(state) {
  return Math.max(
    0,
    ...state.threads.map((thread) => Number(thread.globalNumber) || 0),
    ...state.comments.map((comment) => Number(comment.globalNumber) || 0)
  );
}

export function planSeedImport(currentState, seed, { mode = 'skip' } = {}) {
  if (!['skip', 'replace'].includes(mode)) {
    throw new Error('Seed import mode must be skip or replace');
  }
  const validation = validateSeed(seed);
  if (!validation.valid) {
    const error = new Error(`Seed validation failed: ${validation.errors.join('; ')}`);
    error.validationErrors = validation.errors;
    throw error;
  }

  const current = normalizeState(currentState);
  const next = normalizeState(current);
  const summary = {
    mode,
    boards: { added: 0, replaced: 0, skipped: 0 },
    threads: { added: 0, replaced: 0, skipped: 0 },
    comments: { added: 0, replaced: 0, skipped: 0 }
  };

  const boardsBySlug = indexBy(next.boards, 'slug');
  for (const board of seed.boards.map(sanitizeBoard)) {
    if (!boardsBySlug.has(board.slug)) {
      next.boards.push(board);
      boardsBySlug.set(board.slug, board);
      summary.boards.added += 1;
    } else if (mode === 'replace') {
      const index = next.boards.findIndex((item) => item.slug === board.slug);
      next.boards[index] = board;
      boardsBySlug.set(board.slug, board);
      summary.boards.replaced += 1;
    } else {
      summary.boards.skipped += 1;
    }
  }

  const skippedThreadIds = new Set();
  let threadsById = indexBy(next.threads, 'id');
  let threadsByNumber = indexBy(next.threads, 'globalNumber');
  for (const thread of seed.threads.map((item) => sanitizePost(item, THREAD_FIELDS))) {
    if (duplicatePost(threadsById, threadsByNumber, thread)) {
      if (mode === 'replace') {
        next.threads = removeDuplicatePosts(next.threads, thread);
        next.comments = next.comments.filter((comment) => comment.threadId !== thread.id);
        next.threads.push(thread);
        summary.threads.replaced += 1;
      } else {
        summary.threads.skipped += 1;
        skippedThreadIds.add(thread.id);
      }
    } else {
      next.threads.push(thread);
      summary.threads.added += 1;
    }
    threadsById = indexBy(next.threads, 'id');
    threadsByNumber = indexBy(next.threads, 'globalNumber');
  }

  let commentsById = indexBy(next.comments, 'id');
  let commentsByNumber = indexBy(next.comments, 'globalNumber');
  const knownThreadIds = new Set(next.threads.map((thread) => thread.id));
  for (const comment of seed.comments.map((item) => sanitizePost(item, COMMENT_FIELDS))) {
    if (!knownThreadIds.has(comment.threadId) || skippedThreadIds.has(comment.threadId)) {
      summary.comments.skipped += 1;
      continue;
    }
    if (duplicatePost(commentsById, commentsByNumber, comment)) {
      if (mode === 'replace') {
        next.comments = removeDuplicatePosts(next.comments, comment);
        next.comments.push(comment);
        summary.comments.replaced += 1;
      } else {
        summary.comments.skipped += 1;
      }
    } else {
      next.comments.push(comment);
      summary.comments.added += 1;
    }
    commentsById = indexBy(next.comments, 'id');
    commentsByNumber = indexBy(next.comments, 'globalNumber');
  }

  next.nextGlobalNumber = Math.max(Number(next.nextGlobalNumber) || 1, Number(seed.nextGlobalNumber) || 1, maxPostNumber(next) + 1);
  return { nextState: normalizeState(next), summary };
}

export async function readSeedFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function writeSeedFile(filePath, seed) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(seed, null, 2)}\n`);
}

export async function exportSeedData({ store, outPath, includeHiddenBoards = true }) {
  const state = await store.read();
  const seed = sanitizeSeedState(state, { includeHiddenBoards });
  await writeSeedFile(outPath, seed);
  return {
    outPath,
    counts: {
      boards: seed.boards.length,
      threads: seed.threads.length,
      comments: seed.comments.length
    }
  };
}

export async function importSeedData({
  store,
  seed,
  dryRun = true,
  mode = 'skip',
  rollbackPath = null,
  now = () => new Date()
}) {
  const currentState = await store.read();
  const { nextState, summary } = planSeedImport(currentState, seed, { mode });
  if (dryRun) {
    return { dryRun: true, summary, rollbackPath: null };
  }

  const resolvedRollbackPath = rollbackPath ?? path.resolve('data', `seed-rollback-${now().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeSeedFile(resolvedRollbackPath, normalizeState(currentState));
  try {
    await store.write(nextState);
  } catch (error) {
    await store.write(currentState);
    error.rollbackPath = resolvedRollbackPath;
    throw error;
  }
  return { dryRun: false, summary, rollbackPath: resolvedRollbackPath };
}

export async function restoreSeedRollback({
  store,
  rollbackState,
  dryRun = true,
  rollbackPath = null,
  now = () => new Date()
}) {
  const currentState = await store.read();
  const restoredState = normalizeState(rollbackState);
  const result = {
    dryRun,
    counts: {
      boards: restoredState.boards.length,
      threads: restoredState.threads.length,
      comments: restoredState.comments.length,
      users: restoredState.users.length,
      reports: restoredState.reports.length,
      sanctions: restoredState.sanctions.length,
      moderationActions: restoredState.moderationActions.length
    },
    rollbackPath: null
  };

  if (dryRun) {
    return result;
  }

  const resolvedRollbackPath = rollbackPath ?? path.resolve('data', `seed-restore-rollback-${now().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeSeedFile(resolvedRollbackPath, normalizeState(currentState));
  await store.write(restoredState);
  return { ...result, rollbackPath: resolvedRollbackPath };
}
