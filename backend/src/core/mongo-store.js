import crypto from 'node:crypto';
import mongoose from 'mongoose';

import { BOARDS } from './config.js';
import { EMPTY_STATE, normalizeState } from './forum-store.js';

const MODEL_OPTIONS = {
  strict: false,
  versionKey: false,
  minimize: false,
  // Disable Mongoose's virtual `id` alias so a literal `id` field (UUID) is
  // persisted instead of being silently dropped in favour of the ObjectId _id.
  id: false
};

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
    adminSettings: mongoose.Schema.Types.Mixed
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
    role: String,
    settings: mongoose.Schema.Types.Mixed,
    privateData: mongoose.Schema.Types.Mixed,
    createdAt: Date,
    updatedAt: Date
  },
  MODEL_OPTIONS
);
USER_SCHEMA.index({ username: 1 }, { unique: true, sparse: true });
USER_SCHEMA.index({ id: 1 }, { unique: true, sparse: true });
USER_SCHEMA.index({ role: 1, createdAt: -1 });

const PRODUCTION_MODEL_READINESS = {
  boards: true,
  threads: true,
  comments: true,
  users: true,
  reports: true,
  appeals: true,
  moderationLogs: true
};

function flexibleSchema(indexes = []) {
  const schema = new mongoose.Schema({}, MODEL_OPTIONS);
  for (const index of indexes) {
    schema.index(index.fields, index.options);
  }
  return schema;
}

function plainDocument(document) {
  const { _id, ...plain } = document;
  if (!plain.id && _id) {
    plain.id = typeof _id === 'object' && _id.toString ? _id.toString() : String(_id);
  }
  return plain;
}

function objectToKeyValues(value = {}) {
  return Object.entries(value).map(([key, entry]) => ({
    _id: key,
    value: entry
  }));
}

function keyValuesToObject(items = []) {
  return Object.fromEntries(items.map((item) => [item._id, item.value]));
}

function reportQueryForFilters(filters = {}) {
  const query = {};
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

function reportCandidateLimit(limit = 50, filters = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const sort = String(filters.sort || '').toLowerCase();
  const needsPriorityPass = !sort || sort === 'priority' || filters.priority;
  return needsPriorityPass ? Math.min(Math.max(safeLimit * 10, 500), 2_000) : safeLimit;
}

function fingerprintPreview(fingerprint = '') {
  return `${String(fingerprint).slice(0, 12)}...`;
}

function moderationActionForPost({ action, actor = 'system', postType, post, reason = '', createdAt }) {
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

export function createMongoModels(connection) {
  const model = (name, schema, collection) =>
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
    AiUsage: model('AiUsage', KEY_VALUE_SCHEMA, 'aiUsage'),
    AiSummaryCache: model('AiSummaryCache', KEY_VALUE_SCHEMA, 'aiSummaryCache'),
    StateMeta: model('StateMeta', STATE_META_SCHEMA, 'stateMeta')
  };
}

async function replaceCollection(model, items) {
  await model.deleteMany({});
  if (items.length > 0) {
    // `id: false` on the schema keeps the literal UUID `id` field, while Mongo
    // assigns its own ObjectId `_id`. plainDocument() reads `id` back unchanged.
    await model.insertMany(items, { ordered: true });
  }
}

async function insertDocuments(model, items) {
  if (items.length === 1) {
    await model.collection.insertOne(items[0]);
    return;
  }
  if (items.length > 1) {
    await model.collection.insertMany(items, { ordered: true });
  }
}

async function updateDocumentsById(model, items) {
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
    { ordered: true }
  );
}

export async function appendMongoPostCreate(models, {
  state,
  thread = null,
  comment = null,
  updatedThreads = [],
  moderationActions = [],
  appeals = []
} = {}) {
  const normalized = normalizeState(state);
  const threadsToInsert = thread ? [thread] : [];
  const commentsToInsert = comment ? [comment] : [];
  const threadIdsToInsert = new Set(threadsToInsert.map((item) => item.id));
  const threadsToUpdate = updatedThreads.filter((item) => item?.id && !threadIdsToInsert.has(item.id));

  await insertDocuments(models.Thread, threadsToInsert);
  await insertDocuments(models.Comment, commentsToInsert);
  await insertDocuments(models.ModerationAction, moderationActions);
  await insertDocuments(models.Appeal, appeals);
  await updateDocumentsById(models.Thread, threadsToUpdate);
  await models.StateMeta.updateOne(
    { _id: 'global' },
    {
      $set: {
        version: normalized.version,
        nextGlobalNumber: normalized.nextGlobalNumber,
        adminSettings: normalized.adminSettings
      }
    },
    { upsert: true }
  );
  return normalizeState(normalized);
}

export function createMongoStore({ uri = process.env.MONGODB_URI, dbName } = {}) {
  if (!uri) {
    throw new Error('MONGODB_URI is required when STORE_DRIVER=mongo');
  }

  let connectionPromise;
  let queue = Promise.resolve();

  async function getModels() {
    if (!connectionPromise) {
      const connection = mongoose.createConnection(uri, dbName ? { dbName } : undefined);
      connectionPromise = connection.asPromise().catch(async (error) => {
        connectionPromise = undefined;
        await connection.close().catch(() => undefined);
        throw error;
      });
    }
    return createMongoModels(await connectionPromise);
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

    async readUser(userId) {
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

    async readModerationActions({ limit = 50, filters = {} } = {}) {
      const models = await getModels();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const query = {};
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
      disabled = false,
      createdAt,
      updatedAt
    } = {}) {
      const models = await getModels();
      queue = queue.then(async () => {
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
            disabled,
            createdAt,
            updatedAt
          });
        }
        const user = await models.User.findOne({ username }).lean();
        return user ? plainDocument(user) : null;
      });
      return queue;
    },

    async readDeletedModerationState({ limit = 50, filters = {} } = {}) {
      const models = await getModels();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const deletedQuery = { isDeleted: true };
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

    async readAppealsModerationState({ limit = 50, filters = {} } = {}) {
      const models = await getModels();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const query = { status: { $ne: 'issued' } };
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

    async readSanctions({ limit = 50, filters = {} } = {}) {
      const models = await getModels();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const query = {};
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

    async readReportsModerationState({ limit = 50, filters = {} } = {}) {
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
      });
      state.reportCounts = new Map(
        reportCountRows
          .map((row) => [Number(row._id), Number(row.count) || 0])
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
    } = {}) {
      queue = queue.then(async () => {
        const models = await getModels();
        const postNumber = Number(globalNumber);
        const [thread, comment] = await Promise.all([
          models.Thread.findOne({ globalNumber: postNumber }).lean(),
          models.Comment.findOne({ globalNumber: postNumber }).lean()
        ]);
        const postType = thread ? 'thread' : comment ? 'comment' : '';
        const post = thread ? plainDocument(thread) : comment ? plainDocument(comment) : null;
        if (!post) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }
        if (!post.authorFingerprint) {
          const error = new Error('Bài viết này chưa có fingerprint vận hành');
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
      return queue;
    },

    async revokeSanction({ id, reason = '', actor = 'admin', revokedAt = new Date().toISOString() } = {}) {
      queue = queue.then(async () => {
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
          const error = new Error('Không tìm thấy khóa tạm đang hoạt động');
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
      return queue;
    },

    async approvePending({ id, reason = '', actor = 'admin', createdAt = new Date().toISOString() } = {}) {
      queue = queue.then(async () => {
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
          const error = new Error('Không tìm thấy bài đang chờ duyệt');
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
          const error = new Error('Không tìm thấy chủ đề cha');
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
          const error = new Error('Không tìm thấy bài đang chờ duyệt');
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
      return queue;
    },

    async read() {
      const models = await getModels();
      const [meta, boards, users, threads, comments, moderationActions, reports, appeals, sanctions, aiUsage, aiSummaryCache] = await Promise.all([
        models.StateMeta.findById('global').lean(),
        models.Board.find({}).lean(),
        models.User.find({}).lean(),
        models.Thread.find({}).lean(),
        models.Comment.find({}).lean(),
        models.ModerationAction.find({}).lean(),
        models.Report.find({}).lean(),
        models.Appeal.find({}).lean(),
        models.Sanction.find({}).lean(),
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
        aiUsage: keyValuesToObject(aiUsage),
        aiSummaryCache: keyValuesToObject(aiSummaryCache)
      });
    },

    async write(nextState) {
      queue = queue.then(async () => {
        const models = await getModels();
        const normalized = normalizeState(nextState);
        await models.StateMeta.updateOne(
          { _id: 'global' },
          {
            $set: {
              version: normalized.version,
              nextGlobalNumber: normalized.nextGlobalNumber,
              adminSettings: normalized.adminSettings
            }
          },
          { upsert: true }
        );
        await replaceCollection(models.Board, normalized.boards);
        await replaceCollection(models.User, normalized.users);
        await replaceCollection(models.Thread, normalized.threads);
        await replaceCollection(models.Comment, normalized.comments);
        await replaceCollection(models.ModerationAction, normalized.moderationActions);
        await replaceCollection(models.Report, normalized.reports);
        await replaceCollection(models.Appeal, normalized.appeals);
        await replaceCollection(models.Sanction, normalized.sanctions);
        await replaceCollection(models.AiUsage, objectToKeyValues(normalized.aiUsage));
        await replaceCollection(models.AiSummaryCache, objectToKeyValues(normalized.aiSummaryCache));
        return normalizeState(normalized);
      });
      return queue;
    },

    async appendPostCreate(delta) {
      queue = queue.then(async () => {
        const models = await getModels();
        await ensureBoards(models);
        return appendMongoPostCreate(models, delta);
      });
      return queue;
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
