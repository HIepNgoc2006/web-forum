import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['server.ts', 'scripts', 'src', 'test'];
const ignoreDirs = new Set(['node_modules', 'data', 'coverage']);

function isTypeScriptSourceFile(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.d.ts');
}

function isCheckedSourceFile(file: string): boolean {
  return isTypeScriptSourceFile(file);
}

async function collectSourceFiles(target: string): Promise<string[]> {
  const absolute = path.resolve(root, target);
  if (isCheckedSourceFile(target)) {
    return [absolute];
  }

  const files: string[] = [];
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoreDirs.has(entry.name)) {
        files.push(...(await collectSourceFiles(path.relative(root, path.join(absolute, entry.name)))));
      }
      continue;
    }
    if (entry.isFile() && isCheckedSourceFile(entry.name)) {
      files.push(path.join(absolute, entry.name));
    }
  }
  return files;
}

const files = (await Promise.all(roots.map((target) => collectSourceFiles(target))))
  .flat()
  .sort((left, right) => left.localeCompare(right));

let failed = false;
if (files.some(isTypeScriptSourceFile)) {
  const tscPath = path.resolve(root, '..', 'node_modules', 'typescript', 'bin', 'tsc');
  const tsc = spawnSync(
    process.execPath,
    [tscPath, '-p', path.join(root, 'tsconfig.json'), '--noEmit', '--pretty', 'false'],
    { cwd: root, stdio: 'inherit' }
  );
  if (tsc.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}
