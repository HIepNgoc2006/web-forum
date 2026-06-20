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
  { versionKey: false }
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
USER_SCHEMA.index({ role: 1, createdAt: -1 });

const PRODUCTION_MODEL_READINESS = {
  boards: true,
  threads: true,
  comments: true,
  users: true,
  reports: true,
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
        { fields: { globalNumber: 1 } }
      ]),
      'threads'
    ),
    Comment: model(
      'Comment',
      flexibleSchema([
        { fields: { id: 1 }, options: { unique: true } },
        { fields: { threadId: 1, globalNumber: 1 } },
        { fields: { globalNumber: 1 } }
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
      flexibleSchema([{ fields: { createdAt: -1 } }, { fields: { status: 1, boardSlug: 1 } }]),
      'reports'
    ),
    Sanction: model(
      'Sanction',
      flexibleSchema([{ fields: { fingerprint: 1, expiresAt: 1 } }, { fields: { createdAt: -1 } }]),
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

    async read() {
      const models = await getModels();
      const [meta, boards, users, threads, comments, moderationActions, reports, sanctions, aiUsage, aiSummaryCache] = await Promise.all([
        models.StateMeta.findById('global').lean(),
        models.Board.find({}).lean(),
        models.User.find({}).lean(),
        models.Thread.find({}).lean(),
        models.Comment.find({}).lean(),
        models.ModerationAction.find({}).lean(),
        models.Report.find({}).lean(),
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
        await replaceCollection(models.Sanction, normalized.sanctions);
        await replaceCollection(models.AiUsage, objectToKeyValues(normalized.aiUsage));
        await replaceCollection(models.AiSummaryCache, objectToKeyValues(normalized.aiSummaryCache));
        return normalizeState(normalized);
      });
      return queue;
    },

    async health() {
      try {
        const models = await getModels();
        await ensureBoards(models);
        const [boards, threads, comments, users, reports, sanctions, moderationActions, meta] = await Promise.all([
          models.Board.countDocuments(),
          models.Thread.countDocuments(),
          models.Comment.countDocuments(),
          models.User.countDocuments(),
          models.Report.countDocuments(),
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
