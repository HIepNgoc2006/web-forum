import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['server.js', 'scripts', 'src', 'test'];
const ignoreDirs = new Set(['node_modules', 'data', 'coverage']);

async function collectJsFiles(target: string): Promise<string[]> {
  const absolute = path.resolve(root, target);
  if (target.endsWith('.js')) {
    return [absolute];
  }

  const files: string[] = [];
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoreDirs.has(entry.name)) {
        files.push(...(await collectJsFiles(path.relative(root, path.join(absolute, entry.name)))));
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.join(absolute, entry.name));
    }
  }
  return files;
}

const files = (await Promise.all(roots.map((target) => collectJsFiles(target))))
  .flat()
  .sort((left, right) => left.localeCompare(right));

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}
