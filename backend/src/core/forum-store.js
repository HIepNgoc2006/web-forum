import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY_STATE = {
  version: 1,
  nextGlobalNumber: 1,
  threads: [],
  comments: [],
  moderationActions: [],
  reports: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeState(value = {}) {
  const cloned = clone(value);
  return {
    ...EMPTY_STATE,
    ...cloned,
    threads: Array.isArray(cloned.threads) ? cloned.threads : [],
    comments: Array.isArray(cloned.comments) ? cloned.comments : [],
    moderationActions: Array.isArray(cloned.moderationActions) ? cloned.moderationActions : [],
    reports: Array.isArray(cloned.reports) ? cloned.reports : []
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
    }
  };
}
