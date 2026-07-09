#!/usr/bin/env node
/**
 * Tiny smoke checks for serve-static resolve order (POC only, no deps).
 * Run: node scripts/serve-static.smoke.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveStaticFile } from './serve-static.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-static-smoke-'));
const root = path.join(tmp, 'out');
fs.mkdirSync(root);
fs.writeFileSync(path.join(root, 'index.html'), '<html>root-spa</html>');
fs.writeFileSync(path.join(root, 'foo.html'), '<html>route-foo</html>');
fs.mkdirSync(path.join(root, 'bar'));
fs.writeFileSync(path.join(root, 'bar', 'index.html'), '<html>dir-bar</html>');
fs.writeFileSync(path.join(root, 'asset.txt'), 'plain');

try {
  // 1. Exact file
  {
    const r = resolveStaticFile(root, '/asset.txt');
    assert.equal(r.status, 200);
    assert.equal(path.basename(r.filePath), 'asset.txt');
  }

  // 2. Directory index
  {
    const r = resolveStaticFile(root, '/bar');
    assert.equal(r.status, 200);
    assert.ok(r.filePath.endsWith(path.join('bar', 'index.html')));
  }

  // 3. Exported route HTML before SPA fallback (the #712 P2 fix)
  {
    const r = resolveStaticFile(root, '/foo');
    assert.equal(r.status, 200);
    assert.equal(path.basename(r.filePath), 'foo.html');
    assert.notEqual(path.basename(r.filePath), 'index.html');
  }

  // 4. Missing path falls back to SPA index
  {
    const r = resolveStaticFile(root, '/missing');
    assert.equal(r.status, 200);
    assert.equal(path.basename(r.filePath), 'index.html');
  }

  // Path traversal blocked
  {
    const r = resolveStaticFile(root, '/../outside.html');
    assert.equal(r.status, 403);
  }

  // Null byte rejected
  {
    const r = resolveStaticFile(root, '/foo\0.html');
    assert.equal(r.status, 400);
  }

  console.log('serve-static smoke: ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
