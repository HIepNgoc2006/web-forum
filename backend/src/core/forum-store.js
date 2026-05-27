import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY_STATE = {
  version: 1,
  nextGlobalNumber: 1,
  threads: [],
  comments: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createMemoryStore(initialState = EMPTY_STATE) {
  let state = clone(initialState);
  return {
    async read() {
      return clone(state);
    },
    async write(nextState) {
      state = clone(nextState);
      return clone(state);
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
      return JSON.parse(raw);
    },
    async write(nextState) {
      queue = queue.then(async () => {
        await ensure();
        await fs.writeFile(filePath, JSON.stringify(nextState, null, 2));
        return clone(nextState);
      });
      return queue;
    }
  };
}
