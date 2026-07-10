import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(root, '..');
const roots = ['server.ts', 'scripts', 'src', 'test'];
const ignoreDirs = new Set(['node_modules', 'data', 'coverage']);

async function resolveTscPath(): Promise<string> {
  // Prefer TypeScript 7's native package when dual-installed with the TS 6 API
  // package (needed by typescript-eslint until it gains a TS 7 programmatic API).
  const candidates = [
    path.resolve(workspaceRoot, 'node_modules', '@typescript', 'native', 'bin', 'tsc'),
    path.resolve(workspaceRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.resolve(root, 'node_modules', '@typescript', 'native', 'bin', 'tsc'),
    path.resolve(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    'Unable to locate the TypeScript compiler (tsc). Install @typescript/native or typescript.'
  );
}

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
  const tscPath = await resolveTscPath();
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
