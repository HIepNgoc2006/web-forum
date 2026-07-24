#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const standaloneRoot = path.join(packageRoot, '.next', 'standalone');
const backendOrigin = new URL(
  process.env.BACKEND_ORIGIN || 'http://127.0.0.1:3000',
).origin;
const copies = [
  [path.join(packageRoot, 'public'), path.join(standaloneRoot, 'public')],
  [path.join(packageRoot, '.next', 'static'), path.join(standaloneRoot, '.next', 'static')],
];

for (const [source, destination] of copies) {
  if (!fs.existsSync(source)) {
    throw new Error('Missing standalone asset source: ' + source);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

fs.writeFileSync(
  path.join(standaloneRoot, 'backend-origin.json'),
  `${JSON.stringify({ version: 1, backendOrigin }, null, 2)}\n`,
  'utf8',
);
