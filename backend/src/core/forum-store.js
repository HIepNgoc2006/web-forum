import fs from 'node:fs/promises';
import path from 'node:path';
import { BOARDS, normalizeRetentionPolicy } from './config.js';

export const EMPTY_STATE = {
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeState(value = {}) {
  const cloned = clone(value);
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
        retentionPolicy: normalizeRetentionPolicy(board.retentionPolicy)
      };
    }),
    users: Array.isArray(cloned.users) ? cloned.users : [],
    threads: Array.isArray(cloned.threads) ? cloned.threads : [],
    comments: Array.isArray(cloned.comments) ? cloned.comments : [],
    moderationActions: Array.isArray(cloned.moderationActions) ? cloned.moderationActions : [],
    reports: Array.isArray(cloned.reports) ? cloned.reports : [],
    appeals: Array.isArray(cloned.appeals) ? cloned.appeals : [],
    sanctions: Array.isArray(cloned.sanctions) ? cloned.sanctions : [],
    adminSettings: cloned.adminSettings && typeof cloned.adminSettings === 'object' ? cloned.adminSettings : {},
    aiUsage: cloned.aiUsage && typeof cloned.aiUsage === 'object' ? cloned.aiUsage : {},
    aiSummaryCache: cloned.aiSummaryCache && typeof cloned.aiSummaryCache === 'object' ? cloned.aiSummaryCache : {}
  };
}

export function createMemoryStore(initialState = EMPTY_STATE) {
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

export function createJsonStore(filePath = path.resolve('data/forum.json')) {
  let queue = Promise.resolve();

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
      queue = queue.then(async () => {
        await ensure();
        const normalized = normalizeState(nextState);
        await fs.writeFile(filePath, JSON.stringify(normalized, null, 2));
        return normalizeState(normalized);
      });
      return queue;
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
