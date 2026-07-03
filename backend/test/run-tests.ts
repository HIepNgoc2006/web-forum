import { readdir } from 'node:fs/promises';

process.env.NODE_ENV = 'test';

const entries = await readdir(new URL('.', import.meta.url));
const testFiles = entries
  .filter((entry) => entry.endsWith('.test.ts'))
  .sort((left, right) => left.localeCompare(right));

for (const file of testFiles) {
  await import(`./${file}`);
}
