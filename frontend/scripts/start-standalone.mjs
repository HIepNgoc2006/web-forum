#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const standaloneRoot = path.join(packageRoot, '.next', 'standalone');
const stampPath = path.join(standaloneRoot, 'backend-origin.json');
const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
const builtOrigin = new URL(String(stamp.backendOrigin)).origin;
const runtimeOrigin = new URL(process.env.BACKEND_ORIGIN || builtOrigin).origin;

if (runtimeOrigin !== builtOrigin) {
  throw new Error(
    `BACKEND_ORIGIN mismatch: build=${builtOrigin}, runtime=${runtimeOrigin}. Rebuild Next for the runtime backend.`,
  );
}

process.env.BACKEND_ORIGIN = runtimeOrigin;
process.env.PORT ||= '3001';
process.env.HOSTNAME ||= '0.0.0.0';
await import(pathToFileURL(path.join(standaloneRoot, 'server.js')).href);
