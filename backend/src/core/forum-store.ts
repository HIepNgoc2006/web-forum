import fs from 'node:fs/promises';
import path from 'node:path';
import { BOARDS, normalizeRetentionPolicy, type BoardConfig } from './config.ts';

export type ForumRecord = Record<string, any>;
export type StoredBoardConfig = BoardConfig & ForumRecord;

export type ForumState = {
  version: number;
  nextGlobalNumber: number;
  boards: StoredBoardConfig[];
  users: ForumRecord[];
  threads: ForumRecord[];
  comments: ForumRecord[];
  moderationActions: ForumRecord[];
  reports: ForumRecord[];
  appeals: ForumRecord[];
  sanctions: ForumRecord[];
  adminSettings: Record<string, unknown>;
  aiUsage: Record<string, unknown>;
  aiSummaryCache: Record<string, unknown>;
};

export type StoreHealth = {
  type: string;
  configured: boolean;
  ready: boolean;
  threads: number;
  comments: number;
  users: number;
  reports: number;
  appeals: number;
  sanctions: number;
  moderationActions: number;
  nextGlobalNumber: number;
};

export type ForumStore = {
  type?: string;
  read(): Promise<ForumState>;
  write(nextState: unknown): Promise<ForumState>;
  withMutationLock?<T>(callback: () => Promise<T>): Promise<T>;
  health?(): Promise<StoreHealth>;
  close?(): Promise<void>;
};

export const EMPTY_STATE: ForumState = {
  version: 1,
  nextGlobalNumber: 1,
  boards: BOARDS,
  users: [],
  threads: [],
  comments: [],
  moderationActions: [],
  reports: [],
  appeals: [],
  sanctions: [],
  adminSettings: {},
  aiUsage: {},
  aiSummaryCache: {}
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function objectRecord(value: unknown): ForumRecord {
  return value && typeof value === 'object' ? (value as ForumRecord) : {};
}

function arrayRecords(value: unknown): ForumRecord[] {
  return Array.isArray(value) ? (value as ForumRecord[]) : [];
}

export function normalizeState(value: unknown = {}): ForumState {
  const cloned = clone(objectRecord(value));
  const boards = Array.isArray(cloned.boards) && cloned.boards.length > 0 ? cloned.boards : BOARDS;
  return {
    ...EMPTY_STATE,
    ...cloned,
    boards: boards.map((board) => {
      if (!Object.hasOwn(board, 'retentionPolicy')) {
        return board;
      }
      return {
        ...board,
        retentionPolicy: normalizeRetentionPolicy((board as BoardConfig).retentionPolicy)
      };
    }) as StoredBoardConfig[],
    users: arrayRecords(cloned.users),
    threads: arrayRecords(cloned.threads),
    comments: arrayRecords(cloned.comments),
    moderationActions: arrayRecords(cloned.moderationActions),
    reports: arrayRecords(cloned.reports),
    appeals: arrayRecords(cloned.appeals),
    sanctions: arrayRecords(cloned.sanctions),
    adminSettings: objectRecord(cloned.adminSettings),
    aiUsage: objectRecord(cloned.aiUsage),
    aiSummaryCache: objectRecord(cloned.aiSummaryCache)
  };
}

export function createMemoryStore(initialState: unknown = EMPTY_STATE): ForumStore {
  let state = normalizeState(initialState);
  return {
    async read() {
      return normalizeState(state);
    },
    async write(nextState) {
      state = normalizeState(nextState);
      return normalizeState(state);
    }
  };
}

export function createJsonStore(filePath = path.resolve('data/forum.json')): ForumStore {
  let queue: Promise<unknown> = Promise.resolve();

  async function ensure() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, JSON.stringify(EMPTY_STATE, null, 2));
    }
  }

  return {
    async read() {
      await ensure();
      const raw = await fs.readFile(filePath, 'utf8');
      return normalizeState(JSON.parse(raw));
    },
    async write(nextState) {
      const writeJob = queue.then(async () => {
        await ensure();
        const normalized = normalizeState(nextState);
        await fs.writeFile(filePath, JSON.stringify(normalized, null, 2));
        return normalizeState(normalized);
      });
      queue = writeJob.then(() => undefined, () => undefined);
      return writeJob;
    },
    async health() {
      await ensure();
      const state = await this.read();
      return {
        type: 'json',
        configured: true,
        ready: true,
        threads: state.threads.length,
        comments: state.comments.length,
        users: Array.isArray(state.users) ? state.users.length : 0,
        reports: state.reports.length,
        appeals: state.appeals.length,
        sanctions: state.sanctions.length,
        moderationActions: state.moderationActions.length,
        nextGlobalNumber: state.nextGlobalNumber
      };
    }
  };
}
