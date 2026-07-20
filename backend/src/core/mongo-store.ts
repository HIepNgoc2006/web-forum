import crypto from 'node:crypto';
import mongoose from 'mongoose';
import type { ClientSession, Connection, Model, SchemaOptions } from 'mongoose';

import { BOARDS } from './config.ts';
import { EMPTY_STATE, normalizeState } from './forum-store.ts';
import type { ForumRecord, ForumState } from './forum-store.ts';

type AnyRecord = Record<string, any>;
type MongoModel = Model<any>;
type MongoModels = Record<
  | 'Board'
  | 'Thread'
  | 'Comment'
  | 'User'
  | 'ModerationAction'
  | 'Report'
  | 'Appeal'
  | 'Sanction'
  | 'DmConversation'
  | 'DmMessage'
  | 'AiUsage'
  | 'AiSummaryCache'
  | 'StateMeta',
  MongoModel
>;

type MongoStoreOptions = {
  uri?: string;
  dbName?: string;
  mutationLockLeaseMs?: number;
  mutationLockTimeoutMs?: number;
  mutationLockRetryMs?: number;
};

type MongoForumStore = {
  type: 'mongo';
  read(): Promise<ForumState>;
  write(nextState: unknown): Promise<ForumState>;
  appendPostCreate(delta: AppendPostCreateDelta): Promise<ForumState>;
  withMutationLock<T>(callback: () => Promise<T>): Promise<T>;
  health(): Promise<AnyRecord>;
  close(): Promise<void>;
  [key: string]: any;
};

type FlexibleIndex = {
  fields: AnyRecord;
  options?: AnyRecord;
};

type AppendPostCreateDelta = {
  state?: unknown;
  thread?: ForumRecord | null;
  comment?: ForumRecord | null;
  updatedThreads?: ForumRecord[];
  moderationActions?: ForumRecord[];
  appeals?: ForumRecord[];
};

type StatusError = Error & {
  statusCode?: number;
};

const DEFAULT_MUTATION_LOCK_LEASE_MS = 120_000;
const DEFAULT_MUTATION_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_MUTATION_LOCK_RETRY_MS = 100;

function positiveInteger(value: unknown, fallback: number, minimum = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sessionOptions(session?: ClientSession) {
  return session ? { session } : {};
}

function mongoUserDocuments(users: AnyRecord[]) {
  return users.map((user) => {
    const document = { ...user };
    if (typeof document.email !== 'string' || !document.email.trim()) {
      delete document.email;
    }
    return document;
  });
}

function isUnsupportedTransactionError(error: any) {
  return error?.code === 20
    || error?.codeName === 'IllegalOperation'
    || String(error?.message ?? '').includes('Transaction numbers are only allowed');
}

async function runMongoTransaction<T>(connection: Connection, callback: (session: ClientSession) => Promise<T>) {
  const session = await connection.startSession();
  let result: T | undefined;
  try {
    await session.withTransaction(
      async () => {
        result = await callback(session);
      },
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' }
      }
    );
  } catch (error) {
    if (isUnsupportedTransactionError(error)) {
      const wrapped = new Error(
        'MongoDB transactions are required for forum writes. Configure a replica set or sharded cluster.'
      );
      (wrapped as AnyRecord).cause = error;
      throw wrapped;
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return result as T;
}

const MODEL_OPTIONS = {
  strict: false,
  versionKey: false,
  minimize: false,
  // Disable Mongoose's virtual `id` alias so a literal `id` field (UUID) is
  // persisted instead of being silently dropped in favour of the ObjectId _id.
  id: false
} as const satisfies SchemaOptions;

const BOARD_SCHEMA = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: String,
    category: String,
    path: String,
    description: String
  },
  MODEL_OPTIONS
);

const STATE_META_SCHEMA = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    version: Number,
    nextGlobalNumber: Number,
    adminSettings: mongoose.Schema.Types.Mixed,
    lockOwner: String,
    lockExpiresAt: Date
  },
  { versionKey: false }
);

const KEY_VALUE_SCHEMA = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    value: mongoose.Schema.Types.Mixed
  },
  { versionKey: false, minimize: false }
);

const USER_SCHEMA = new mongoose.Schema(
  {
    username: String,
    passwordHash: String,
    email: String,
    emailVerifiedAt: Date,
    emailChallenges: mongoose.Schema.Types.Mixed,
    authEpoch: Number,
    role: String,
    settings: mongoose.Schema.Types.Mixed,
    privateData: mongoose.Schema.Types.Mixed,
    createdAt: Date,
    updatedAt: Date
  },
  MODEL_OPTIONS
);
USER_SCHEMA.index({ username: 1 }, { unique: true, sparse: true });
USER_SCHEMA.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { email: { $type: 'string' } }
  }
);
USER_SCHEMA.index({ id: 1 }, { unique: true, sparse: true });
USER_SCHEMA.index({ role: 1, createdAt: -1 });

const PRODUCTION_MODEL_READINESS = {
  boards: true,
  threads: true,
  comments: true,
  users: true,
  reports: true,
  appeals: true,
  moderationLogs: true,
  dmConversations: true,
  dmMessages: true
};

function flexibleSchema(indexes: FlexibleIndex[] = []) {
  const schema = new mongoose.Schema({}, MODEL_OPTIONS);
  for (const index of indexes) {
    schema.index(index.fields, index.options);
  }
  return schema;
}

function plainDocument(document: any): ForumRecord {
  const { _id, ...plain } = document;
  if (!plain.id && _id) {
    plain.id = typeof _id === 'object' && _id.toString ? _id.toString() : String(_id);
  }
  return plain;
}

function objectToKeyValues(value: AnyRecord = {}) {
  return Object.entries(value).map(([key, entry]) => ({
    _id: key,
    value: entry
  }));
}

function keyValuesToObject(items: AnyRecord[] = []) {
  return Object.fromEntries(items.map((item) => [item._id, item.value]));
}

function reportQueryForFilters(filters: AnyRecord = {}) {
  const query: AnyRecord = {};
  if (filters.boardSlug) {
    query.boardSlug = filters.boardSlug;
  }
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.category) {
    query.category = filters.category;
  }
  if (filters.since) {
    query.createdAt = { $gte: filters.since };
  }
  return query;
}

function reportCandidateLimit(limit = 50, filters: AnyRecord = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const sort = String(filters.sort || '').toLowerCase();
  const needsPriorityPass = !sort || sort === 'priority' || filters.priority;
  return needsPriorityPass ? Math.min(Math.max(safeLimit * 10, 500), 2_000) : safeLimit;
}

function fingerprintPreview(fingerprint: unknown = '') {
  return `${String(fingerprint).slice(0, 12)}...`;
}

function moderationActionForPost({ action, actor = 'system', postType, post, reason = '', createdAt }: AnyRecord) {
  return {
    id: crypto.randomUUID(),
    action,
    actor: String(actor || 'system').slice(0, 80),
    reason,
    postType,
    postId: post.id,
    threadId: postType === 'thread' ? post.id : post.threadId,
    boardSlug: post.boardSlug,
    globalNumber: post.globalNumber,
    moderationStatus: post.moderationStatus,
    moderationLabels: post.moderationLabels ?? [],
    ...(Number.isFinite(Number(post.moderationConfidence)) ? { moderationConfidence: Number(post.moderationConfidence) } : {}),
    createdAt
  };
}

export function createMongoModels(connection: Connection): MongoModels {
  const model = (name: string, schema: mongoose.Schema, collection: string): MongoModel =>
    connection.models[name] ?? connection.model(name, schema, collection);

  return {
    Board: model('Board', BOARD_SCHEMA, 'boards'),
    Thread: model(
      'Thread',
      flexibleSchema([
        { fields: { id: 1 }, options: { unique: true } },
        { fields: { boardSlug: 1, bumpedAt: -1 } },
        { fields: { globalNumber: 1 } },
        { fields: { isPending: 1, isDeleted: 1, createdAt: -1 } }
      ]),
      'threads'
    ),
    Comment: model(
      'Comment',
      flexibleSchema([
        { fields: { id: 1 }, options: { unique: true } },
        { fields: { threadId: 1, globalNumber: 1 } },
        { fields: { globalNumber: 1 } },
        { fields: { isPending: 1, isDeleted: 1, createdAt: -1 } }
      ]),
      'comments'
    ),
    User: model('User', USER_SCHEMA, 'users'),
    ModerationAction: model(
      'ModerationAction',
      flexibleSchema([{ fields: { createdAt: -1 } }, { fields: { postId: 1 } }]),
      'moderationActions'
    ),
    Report: model(
      'Report',
      flexibleSchema([
        { fields: { createdAt: -1 } },
        { fields: { status: 1, boardSlug: 1 } },
        { fields: { status: 1, category: 1, createdAt: -1 } },
        { fields: { status: 1, globalNumber: 1 } },
        { fields: { boardSlug: 1, createdAt: -1 } }
      ]),
      'reports'
    ),
    Appeal: model(
      'Appeal',
      flexibleSchema([
        { fields: { id: 1 }, options: { unique: true } },
        { fields: { tokenHash: 1 }, options: { unique: true } },
        { fields: { status: 1, submittedAt: -1 } },
        { fields: { globalNumber: 1 } }
      ]),
      'appeals'
    ),
    Sanction: model(
      'Sanction',
      flexibleSchema([
        { fields: { id: 1 }, options: { unique: true, sparse: true } },
        { fields: { fingerprint: 1, expiresAt: 1 } },
        { fields: { createdAt: -1 } }
      ]),
      'sanctions'
    ),
    DmConversation: model(
      'DmConversation',
      flexibleSchema([
        { fields: { id: 1 }, options: { unique: true } },
        { fields: { participantKey: 1 }, options: { unique: true } },
        { fields: { participantIds: 1 } },
        { fields: { lastMessageAt: -1 } }
      ]),
      'dmConversations'
    ),
    DmMessage: model(
      'DmMessage',
      flexibleSchema([
        { fields: { id: 1 }, options: { unique: true } },
        { fields: { conversationId: 1, createdAt: -1 } },
        { fields: { senderId: 1, createdAt: -1 } }
      ]),
      'dmMessages'
    ),
    AiUsage: model('AiUsage', KEY_VALUE_SCHEMA, 'aiUsage'),
    AiSummaryCache: model('AiSummaryCache', KEY_VALUE_SCHEMA, 'aiSummaryCache'),
    StateMeta: model('StateMeta', STATE_META_SCHEMA, 'stateMeta')
  };
}

async function replaceCollection(model: MongoModel, items: AnyRecord[], session?: ClientSession) {
  await model.deleteMany({}, sessionOptions(session));
  if (items.length > 0) {
    // `id: false` on the schema keeps the literal UUID `id` field, while Mongo
    // assigns its own ObjectId `_id`. plainDocument() reads `id` back unchanged.
    await model.insertMany(items, { ordered: true, ...sessionOptions(session) });
  }
}

async function insertDocuments(model: MongoModel, items: AnyRecord[], session?: ClientSession) {
  if (items.length === 1) {
    await model.collection.insertOne(items[0], sessionOptions(session));
    return;
  }
  if (items.length > 1) {
    await model.collection.insertMany(items, { ordered: true, ...sessionOptions(session) });
  }
}

async function updateDocumentsById(model: MongoModel, items: AnyRecord[], session?: ClientSession) {
  if (items.length === 0) {
    return;
  }
  await model.bulkWrite(
    items.map((item) => ({
      updateOne: {
        filter: { id: item.id },
        update: { $set: item }
      }
    })),
    { ordered: true, ...sessionOptions(session) }
  );
}

export async function appendMongoPostCreate(models, {
  state,
  thread = null,
  comment = null,
  updatedThreads = [],
  moderationActions = [],
  appeals = []
}: AppendPostCreateDelta = {}, session?: ClientSession): Promise<ForumState> {
  const normalized = normalizeState(state);
  const threadsToInsert = thread ? [thread] : [];
  const commentsToInsert = comment ? [comment] : [];
  const threadIdsToInsert = new Set(threadsToInsert.map((item) => item.id));
  const threadsToUpdate = updatedThreads.filter((item) => item?.id && !threadIdsToInsert.has(item.id));

  await insertDocuments(models.Thread, threadsToInsert, session);
  await insertDocuments(models.Comment, commentsToInsert, session);
  await insertDocuments(models.ModerationAction, moderationActions, session);
  await insertDocuments(models.Appeal, appeals, session);
  await updateDocumentsById(models.Thread, threadsToUpdate, session);
  await models.StateMeta.updateOne(
    { _id: 'global' },
    {
      $set: {
        version: normalized.version,
        nextGlobalNumber: normalized.nextGlobalNumber,
        adminSettings: normalized.adminSettings
      }
    },
    { upsert: true, ...sessionOptions(session) }
  );
  return normalizeState(normalized);
}

export async function replaceMongoState(
  models: MongoModels,
  nextState: unknown,
  session?: ClientSession
): Promise<ForumState> {
  const normalized = normalizeState(nextState);
  const users = mongoUserDocuments(normalized.users);
  await models.StateMeta.updateOne(
    { _id: 'global' },
    {
      $set: {
        version: normalized.version,
        nextGlobalNumber: normalized.nextGlobalNumber,
        adminSettings: normalized.adminSettings
      }
    },
    { upsert: true, ...sessionOptions(session) }
  );
  await replaceCollection(models.Board, normalized.boards, session);
  await replaceCollection(models.User, users, session);
  await replaceCollection(models.Thread, normalized.threads, session);
  await replaceCollection(models.Comment, normalized.comments, session);
  await replaceCollection(models.ModerationAction, normalized.moderationActions, session);
  await replaceCollection(models.Report, normalized.reports, session);
  await replaceCollection(models.Appeal, normalized.appeals, session);
  await replaceCollection(models.Sanction, normalized.sanctions, session);
  await replaceCollection(models.DmConversation, normalized.dmConversations, session);
  await replaceCollection(models.DmMessage, normalized.dmMessages, session);
  await replaceCollection(models.AiUsage, objectToKeyValues(normalized.aiUsage), session);
  await replaceCollection(models.AiSummaryCache, objectToKeyValues(normalized.aiSummaryCache), session);
  return normalizeState({ ...normalized, users });
}

export function createMongoStore({
  uri = process.env.MONGODB_URI,
  dbName,
  mutationLockLeaseMs,
  mutationLockTimeoutMs,
  mutationLockRetryMs
}: MongoStoreOptions = {}): MongoForumStore {
  if (!uri) {
    throw new Error('MONGODB_URI is required when STORE_DRIVER=mongo');
  }

  let connectionPromise: Promise<Connection> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const instanceId = crypto.randomUUID();
  const lockLeaseMs = positiveInteger(
    mutationLockLeaseMs ?? process.env.MONGO_MUTATION_LOCK_LEASE_MS,
    DEFAULT_MUTATION_LOCK_LEASE_MS,
    5_000
  );
  const lockTimeoutMs = positiveInteger(
    mutationLockTimeoutMs ?? process.env.MONGO_MUTATION_LOCK_TIMEOUT_MS,
    DEFAULT_MUTATION_LOCK_TIMEOUT_MS,
    1_000
  );
  const lockRetryMs = positiveInteger(
    mutationLockRetryMs ?? process.env.MONGO_MUTATION_LOCK_RETRY_MS,
    DEFAULT_MUTATION_LOCK_RETRY_MS,
    10
  );

  function enqueue<T>(callback: () => Promise<T>): Promise<T> {
    const job = queue.then(callback);
    queue = job.then(() => undefined, () => undefined);
    return job;
  }

  async function getConnection() {
    if (!connectionPromise) {
      const connection = mongoose.createConnection(uri, dbName ? { dbName } : undefined);
      connectionPromise = connection.asPromise().catch(async (error) => {
        connectionPromise = undefined;
        await connection.close().catch(() => undefined);
        throw error;
      });
    }
    return connectionPromise;
  }

  async function getModels() {
    return createMongoModels(await getConnection());
  }

  async function acquireMutationLock(models: MongoModels, owner: string) {
    const now = new Date();
    try {
      const lock = await models.StateMeta.findOneAndUpdate(
        {
          _id: 'mutation-lock',
          $or: [
            { lockOwner: owner },
            { lockExpiresAt: { $exists: false } },
            { lockExpiresAt: { $lte: now } }
          ]
        },
        {
          $set: {
            lockOwner: owner,
            lockExpiresAt: new Date(now.getTime() + lockLeaseMs)
          }
        },
        { upsert: true, new: true }
      ).lean();
      return lock?.lockOwner === owner;
    } catch (error: any) {
      if (error?.code === 11000) {
        return false;
      }
      throw error;
    }
  }

  async function runWithMutationLock<T>(callback: () => Promise<T>) {
    const models = await getModels();
    const owner = instanceId + ':' + crypto.randomUUID();
    const deadline = Date.now() + lockTimeoutMs;
    while (!(await acquireMutationLock(models, owner))) {
      if (Date.now() >= deadline) {
        throw new Error('Timed out after ' + lockTimeoutMs + 'ms waiting for the MongoDB mutation lock.');
      }
      await wait(Math.min(lockRetryMs, Math.max(1, deadline - Date.now())));
    }

    let lockLost = false;
    let renewal = Promise.resolve();
    const renew = () => {
      renewal = renewal.then(async () => {
        const result = await models.StateMeta.updateOne(
          { _id: 'mutation-lock', lockOwner: owner },
          { $set: { lockExpiresAt: new Date(Date.now() + lockLeaseMs) } }
        );
        if (result.matchedCount !== 1) {
          lockLost = true;
        }
      }).catch(() => {
        lockLost = true;
      });
    };
    const heartbeat = setInterval(renew, Math.max(1_000, Math.floor(lockLeaseMs / 3)));
    heartbeat.unref?.();

    try {
      const result = await callback();
      await renewal;
      if (lockLost) {
        throw new Error('Lost the MongoDB mutation lock before the operation completed.');
      }
      return result;
    } finally {
      clearInterval(heartbeat);
      await renewal;
      await models.StateMeta.updateOne(
        { _id: 'mutation-lock', lockOwner: owner },
        { $unset: { lockOwner: '', lockExpiresAt: '' } }
      ).catch(() => undefined);
    }
  }

  async function ensureBoards(models) {
    await models.Board.bulkWrite(
      BOARDS.map((board) => ({
        updateOne: {
          filter: { slug: board.slug },
          update: { $setOnInsert: board },
          upsert: true
        }
      })),
      { ordered: true }
    );
  }

  return {
    type: 'mongo',

    async readUser(userId: string) {
      const models = await getModels();
      const user = await models.User.findOne({ id: userId }).lean();
      return user ? plainDocument(user) : null;
    },

    async readBoards() {
      const models = await getModels();
      await ensureBoards(models);
      const boards = await models.Board.find({}).lean();
      return boards.map(plainDocument);
    },

    async readPrivilegedUsers() {
      const models = await getModels();
      const users = await models.User.find({ role: { $in: ['owner', 'moderator', 'viewer'] } }).lean();
      return users.map(plainDocument);
    },

    async readModerationActions({ limit = 50, filters = {} }: AnyRecord = {}) {
      const models = await getModels();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const query: AnyRecord = {};
      if (filters.action) {
        query.action = filters.action;
      }
      if (filters.boardSlug) {
        query.boardSlug = filters.boardSlug;
      }
      if (filters.since) {
        query.createdAt = { $gte: filters.since };
      }
      const actions = await models.ModerationAction.find(query).sort({ createdAt: -1 }).limit(safeLimit).lean();
      return actions.map(plainDocument);
    },

    async upsertAdminAccount({
      username,
      passwordHash,
      role = 'owner',
      settings = {},
      privateData = {},
      authEpoch = 0,
      disabled = false,
      createdAt,
      updatedAt
    }: AnyRecord = {}) {
      const models = await getModels();
      return enqueue(async () => {
        const existing = await models.User.findOne({ username }).lean();
        if (existing) {
          const existingPlain = plainDocument(existing);
          await models.User.updateOne(
            { username },
            {
              $set: {
                id: existingPlain.id || crypto.randomUUID(),
                passwordHash,
                role,
                disabled,
                authEpoch,
                privateData: existingPlain.privateData ?? privateData,
                updatedAt
              }
            }
          );
        } else {
          await models.User.create({
            id: crypto.randomUUID(),
            username,
            passwordHash,
            role,
            settings,
            privateData,
            authEpoch,
            disabled,
            createdAt,
            updatedAt
          });
        }
        const user = await models.User.findOne({ username }).lean();
        return user ? plainDocument(user) : null;
      });
    },

    async readDeletedModerationState({ limit = 50, filters = {} }: AnyRecord = {}) {
      const models = await getModels();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const deletedQuery: AnyRecord = { isDeleted: true };
      if (filters.boardSlug) {
        deletedQuery.boardSlug = filters.boardSlug;
      }
      if (filters.since) {
        deletedQuery.deletedAt = { $gte: filters.since };
      }
      const [deletedThreads, deletedComments] = await Promise.all([
        models.Thread.find(deletedQuery).sort({ deletedAt: -1 }).limit(safeLimit).lean(),
        models.Comment.find(deletedQuery).sort({ deletedAt: -1 }).limit(safeLimit).lean()
      ]);
      const threadIds = [
        ...new Set([
          ...deletedThreads.map((thread) => thread.id).filter(Boolean),
          ...deletedComments.map((comment) => comment.threadId).filter(Boolean)
        ])
      ];
      const [parentThreads, threadComments] = threadIds.length
        ? await Promise.all([
            models.Thread.find({ id: { $in: threadIds } }).lean(),
            models.Comment.find({ threadId: { $in: threadIds } }).lean()
          ])
        : [[], []];
      const threadsById = new Map();
      for (const thread of [...parentThreads, ...deletedThreads]) {
        const plain = plainDocument(thread);
        if (plain.id) {
          threadsById.set(plain.id, plain);
        }
      }
      return normalizeState({
        ...EMPTY_STATE,
        boards: BOARDS,
        threads: [...threadsById.values()],
        comments: [...deletedComments, ...threadComments].map(plainDocument)
      });
    },

    async readAppealsModerationState({ limit = 50, filters = {} }: AnyRecord = {}) {
      const models = await getModels();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const query: AnyRecord = { status: { $ne: 'issued' } };
      if (filters.boardSlug) {
        query.boardSlug = filters.boardSlug;
      }
      const appeals = await models.Appeal.find(query)
        .sort({ submittedAt: -1, resolvedAt: -1, createdAt: -1 })
        .limit(safeLimit)
        .lean();
      const plainAppeals = appeals.map(plainDocument);
      const globalNumbers = [
        ...new Set(plainAppeals.map((appeal) => Number(appeal.globalNumber)).filter(Number.isFinite))
      ];
      const [threads, comments] = globalNumbers.length
        ? await Promise.all([
            models.Thread.find({ globalNumber: { $in: globalNumbers } }).lean(),
            models.Comment.find({ globalNumber: { $in: globalNumbers } }).lean()
          ])
        : [[], []];
      const threadIds = new Set(comments.map((comment) => comment.threadId).filter(Boolean));
      const parentThreads = threadIds.size
        ? await models.Thread.find({ id: { $in: [...threadIds] } }).lean()
        : [];
      const threadsById = new Map();
      for (const thread of [...threads, ...parentThreads]) {
        const plain = plainDocument(thread);
        if (plain.id) {
          threadsById.set(plain.id, plain);
        }
      }
      return normalizeState({
        ...EMPTY_STATE,
        boards: BOARDS,
        threads: [...threadsById.values()],
        comments: comments.map(plainDocument),
        appeals: plainAppeals
      });
    },

    async readSanctions({ limit = 50, filters = {} }: AnyRecord = {}) {
      const models = await getModels();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const query: AnyRecord = {};
      if (filters.kind) {
        query.kind = filters.kind;
      }
      if (filters.boardSlug) {
        query.boardSlug = filters.boardSlug;
      }
      const sanctions = await models.Sanction.find(query).sort({ createdAt: -1 }).limit(safeLimit).lean();
      return sanctions.map(plainDocument);
    },

    async readPendingModerationState() {
      const models = await getModels();
      const [pendingThreads, pendingComments, reports] = await Promise.all([
        models.Thread.find({ isPending: true, isDeleted: { $ne: true } }).lean(),
        models.Comment.find({ isPending: true, isDeleted: { $ne: true } }).lean(),
        models.Report.find({
          $or: [
            { status: 'open' },
            { status: { $exists: false } },
            { status: null },
            { status: '' }
          ]
        }).lean()
      ]);

      const threadIds = new Set([
        ...pendingThreads.map((thread) => thread.id).filter(Boolean),
        ...pendingComments.map((comment) => comment.threadId).filter(Boolean)
      ]);
      const publicComments = threadIds.size
        ? await models.Comment.find({
            threadId: { $in: [...threadIds] },
            isPending: { $ne: true },
            isDeleted: { $ne: true }
          }).lean()
        : [];
      const parentThreads = threadIds.size
        ? await models.Thread.find({ id: { $in: [...threadIds] } }).lean()
        : [];

      const threadsById = new Map();
      for (const thread of [...parentThreads, ...pendingThreads]) {
        const plain = plainDocument(thread);
        if (plain.id) {
          threadsById.set(plain.id, plain);
        }
      }

      return normalizeState({
        ...EMPTY_STATE,
        boards: BOARDS,
        threads: [...threadsById.values()],
        comments: [...pendingComments, ...publicComments].map(plainDocument),
        reports: reports.map(plainDocument)
      });
    },

    async readReportsModerationState({ limit = 50, filters = {} }: AnyRecord = {}) {
      const models = await getModels();
      const query = reportQueryForFilters(filters);
      const sortDirection = String(filters.sort || '').toLowerCase() === 'oldest' ? 1 : -1;
      const candidateLimit = reportCandidateLimit(limit, filters);
      const [reports, reportCountRows] = await Promise.all([
        models.Report.find(query).sort({ createdAt: sortDirection }).limit(candidateLimit).lean(),
        models.Report.aggregate([
          {
            $match: {
              $or: [
                { status: 'open' },
                { status: { $exists: false } },
                { status: null },
                { status: '' }
              ]
            }
          },
          { $group: { _id: '$globalNumber', count: { $sum: 1 } } }
        ])
      ]);
      const plainReports = reports.map(plainDocument);
      const globalNumbers = [
        ...new Set(plainReports.map((report) => Number(report.globalNumber)).filter(Number.isFinite))
      ];
      const [threads, comments] = globalNumbers.length
        ? await Promise.all([
            models.Thread.find({ globalNumber: { $in: globalNumbers } }).lean(),
            models.Comment.find({ globalNumber: { $in: globalNumbers } }).lean()
          ])
        : [[], []];
      const state = normalizeState({
        ...EMPTY_STATE,
        boards: BOARDS,
        threads: threads.map(plainDocument),
        comments: comments.map(plainDocument),
        reports: plainReports
      }) as ForumState & { reportCounts?: Map<number, number> };
      state.reportCounts = new Map(
        reportCountRows
          .map((row): [number, number] => [Number(row._id), Number(row.count) || 0])
          .filter(([globalNumber]) => Number.isFinite(globalNumber))
      );
      return state;
    },

    async createSanctionForPost({
      globalNumber,
      kind = 'cooldown',
      durationMinutes = 60,
      reason = '',
      actor = 'admin',
      createdAt = new Date().toISOString(),
      expiresAt
    }: AnyRecord = {}) {
      return enqueue(async () => {
        const models = await getModels();
        const postNumber = Number(globalNumber);
        const [thread, comment] = await Promise.all([
          models.Thread.findOne({ globalNumber: postNumber }).lean(),
          models.Comment.findOne({ globalNumber: postNumber }).lean()
        ]);
        const postType = thread ? 'thread' : comment ? 'comment' : '';
        const post = thread ? plainDocument(thread) : comment ? plainDocument(comment) : null;
        if (!post) {
          const error = new Error('Không tìm thấy bài viết') as StatusError;
          error.statusCode = 404;
          throw error;
        }
        if (!post.authorFingerprint) {
          const error = new Error('Bài viết này chưa có fingerprint vận hành') as StatusError;
          error.statusCode = 409;
          throw error;
        }

        const safeKind = kind === 'ban' ? 'ban' : 'cooldown';
        const safeDuration = Math.max(1, Math.min(Number(durationMinutes) || 60, 60 * 24 * 30));
        const safeReason = String(reason || '').slice(0, 240);
        const safeExpiresAt = expiresAt || new Date(new Date(createdAt).getTime() + safeDuration * 60 * 1000).toISOString();
        const sanction = {
          id: crypto.randomUUID(),
          kind: safeKind,
          fingerprint: post.authorFingerprint,
          fingerprintPreview: fingerprintPreview(post.authorFingerprint),
          sourceGlobalNumber: post.globalNumber,
          sourcePostType: postType,
          boardSlug: post.boardSlug,
          reason: safeReason,
          actor: String(actor || 'admin').slice(0, 80),
          createdAt,
          expiresAt: safeExpiresAt
        };
        const moderationAction = moderationActionForPost({
          action: safeKind === 'ban' ? 'admin:ban' : 'admin:cooldown',
          actor,
          postType,
          post,
          reason: `${safeReason} (${safeDuration} phút)`,
          createdAt
        });
        await Promise.all([
          models.Sanction.collection.insertOne(sanction),
          models.ModerationAction.collection.insertOne(moderationAction)
        ]);
        return sanction;
      });
    },

    async revokeSanction({ id, reason = '', actor = 'admin', revokedAt = new Date().toISOString() }: AnyRecord = {}) {
      return enqueue(async () => {
        const models = await getModels();
        const revokeReason = String(reason || '').slice(0, 240);
        const sanction = await models.Sanction.findOneAndUpdate(
          {
            id,
            $or: [
              { revokedAt: { $exists: false } },
              { revokedAt: null },
              { revokedAt: '' }
            ]
          },
          {
            $set: {
              revokedAt,
              revokeReason,
              revokedBy: String(actor || 'admin').slice(0, 80)
            }
          },
          { new: true }
        ).lean();
        if (!sanction) {
          const error = new Error('Không tìm thấy khóa tạm đang hoạt động') as StatusError;
          error.statusCode = 404;
          throw error;
        }

        const plainSanction = plainDocument(sanction);
        const postNumber = Number(plainSanction.sourceGlobalNumber);
        const [thread, comment] = await Promise.all([
          models.Thread.findOne({ globalNumber: postNumber }).lean(),
          models.Comment.findOne({ globalNumber: postNumber }).lean()
        ]);
        const postType = thread ? 'thread' : comment ? 'comment' : '';
        const post = thread ? plainDocument(thread) : comment ? plainDocument(comment) : null;
        if (post) {
          await models.ModerationAction.collection.insertOne(
            moderationActionForPost({
              action: 'admin:unsanction',
              actor,
              postType,
              post,
              reason: revokeReason || 'Gỡ khóa tạm',
              createdAt: revokedAt
            })
          );
        }
        return { sanction: plainSanction };
      });
    },

    async approvePending({ id, reason = '', actor = 'admin', createdAt = new Date().toISOString() }: AnyRecord = {}) {
      return enqueue(async () => {
        const models = await getModels();
        const moderationReason = String(reason || '').slice(0, 240);
        const thread = await models.Thread.findOneAndUpdate(
          { id, isPending: true, isDeleted: { $ne: true } },
          {
            $set: {
              isPending: false,
              moderationStatus: 'ApprovedByAdmin',
              moderationReason,
              bumpedAt: createdAt
            }
          },
          { new: true }
        ).lean();

        if (thread) {
          const post = plainDocument(thread);
          const moderationAction = moderationActionForPost({
            action: 'admin:approve',
            actor,
            postType: 'thread',
            post,
            reason: moderationReason,
            createdAt
          });
          await models.ModerationAction.collection.insertOne(moderationAction);
          const comments = await models.Comment.find({
            threadId: post.id,
            isPending: { $ne: true },
            isDeleted: { $ne: true }
          }).lean();
          return {
            postType: 'thread',
            post,
            comments: comments.map(plainDocument),
            moderationAction
          };
        }

        const pendingComment = await models.Comment.findOne({ id, isPending: true, isDeleted: { $ne: true } }).lean();
        if (!pendingComment) {
          const error = new Error('Không tìm thấy bài đang chờ duyệt') as StatusError;
          error.statusCode = 404;
          throw error;
        }

        const parentBeforeUpdate = await models.Thread.findOne({
          id: pendingComment.threadId,
          isPending: { $ne: true },
          isDeleted: { $ne: true },
          isArchived: { $ne: true }
        }).lean();
        if (!parentBeforeUpdate) {
          const error = new Error('Không tìm thấy chủ đề cha') as StatusError;
          error.statusCode = 404;
          throw error;
        }

        const comment = await models.Comment.findOneAndUpdate(
          { id, isPending: true, isDeleted: { $ne: true } },
          {
            $set: {
              isPending: false,
              moderationStatus: 'ApprovedByAdmin',
              moderationReason
            }
          },
          { new: true }
        ).lean();
        if (!comment) {
          const error = new Error('Không tìm thấy bài đang chờ duyệt') as StatusError;
          error.statusCode = 404;
          throw error;
        }

        const parent = await models.Thread.findOneAndUpdate(
          { id: pendingComment.threadId },
          { $set: { bumpedAt: createdAt } },
          { new: true }
        ).lean();
        const post = plainDocument(comment);
        const moderationAction = moderationActionForPost({
          action: 'admin:approve',
          actor,
          postType: 'comment',
          post,
          reason: moderationReason,
          createdAt
        });
        await models.ModerationAction.collection.insertOne(moderationAction);
        const comments = await models.Comment.find({
          threadId: post.threadId,
          isPending: { $ne: true },
          isDeleted: { $ne: true }
        }).lean();
        return {
          postType: 'comment',
          post,
          parent: plainDocument(parent ?? parentBeforeUpdate),
          comments: comments.map(plainDocument),
          moderationAction
        };
      });
    },

    async read() {
      const models = await getModels();
      const [
        meta,
        boards,
        users,
        threads,
        comments,
        moderationActions,
        reports,
        appeals,
        sanctions,
        dmConversations,
        dmMessages,
        aiUsage,
        aiSummaryCache
      ] = await Promise.all([
        models.StateMeta.findById('global').lean(),
        models.Board.find({}).lean(),
        models.User.find({}).lean(),
        models.Thread.find({}).lean(),
        models.Comment.find({}).lean(),
        models.ModerationAction.find({}).lean(),
        models.Report.find({}).lean(),
        models.Appeal.find({}).lean(),
        models.Sanction.find({}).lean(),
        models.DmConversation.find({}).lean(),
        models.DmMessage.find({}).lean(),
        models.AiUsage.find({}).lean(),
        models.AiSummaryCache.find({}).lean()
      ]);

      return normalizeState({
        version: meta?.version ?? EMPTY_STATE.version,
        nextGlobalNumber: meta?.nextGlobalNumber ?? EMPTY_STATE.nextGlobalNumber,
        adminSettings: meta?.adminSettings ?? EMPTY_STATE.adminSettings,
        boards: boards.map(plainDocument),
        users: users.map(plainDocument),
        threads: threads.map(plainDocument),
        comments: comments.map(plainDocument),
        moderationActions: moderationActions.map(plainDocument),
        reports: reports.map(plainDocument),
        appeals: appeals.map(plainDocument),
        sanctions: sanctions.map(plainDocument),
        dmConversations: dmConversations.map(plainDocument),
        dmMessages: dmMessages.map(plainDocument),
        aiUsage: keyValuesToObject(aiUsage),
        aiSummaryCache: keyValuesToObject(aiSummaryCache)
      });
    },

    async write(nextState: unknown) {
      return enqueue<ForumState>(async () => {
        const connection = await getConnection();
        const models = await getModels();
        return runMongoTransaction(connection, (session) => replaceMongoState(models, nextState, session));
      });
    },

    async appendPostCreate(delta: AppendPostCreateDelta) {
      return enqueue<ForumState>(async () => {
        const connection = await getConnection();
        const models = await getModels();
        await ensureBoards(models);
        return runMongoTransaction(connection, (session) => appendMongoPostCreate(models, delta, session));
      });
    },

    async withMutationLock<T>(callback: () => Promise<T>) {
      return runWithMutationLock(callback);
    },

    async health() {
      try {
        const models = await getModels();
        await ensureBoards(models);
        const [boards, threads, comments, users, reports, appeals, sanctions, moderationActions, meta] = await Promise.all([
          models.Board.countDocuments(),
          models.Thread.countDocuments(),
          models.Comment.countDocuments(),
          models.User.countDocuments(),
          models.Report.countDocuments(),
          models.Appeal.countDocuments(),
          models.Sanction.countDocuments(),
          models.ModerationAction.countDocuments(),
          models.StateMeta.findById('global').lean()
        ]);
        return {
          type: 'mongo',
          configured: true,
          ready: true,
          connected: true,
          models: PRODUCTION_MODEL_READINESS,
          boards,
          threads,
          comments,
          users,
          reports,
          appeals,
          sanctions,
          moderationActions,
          nextGlobalNumber: meta?.nextGlobalNumber ?? EMPTY_STATE.nextGlobalNumber
        };
      } catch {
        return {
          type: 'mongo',
          configured: true,
          ready: false,
          connected: false,
          error: 'unavailable',
          models: PRODUCTION_MODEL_READINESS
        };
      }
    },

    async close() {
      if (!connectionPromise) {
        return;
      }
      const connection = await connectionPromise;
      await connection.close();
    }
  };
}
