/**
 * Local browser-test entry: load env, then disable hCaptcha so register/login
 * accept dev-pass. Does not change committed .env.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(backendRoot);

// Load env first (same rules as env-init).
await import(pathToFileURL(path.join(backendRoot, 'src/core/env-init.ts')).href);

// After env-init, force captcha off for browser automation.
delete process.env.HCAPTCHA_SECRET;
delete process.env.HCAPTCHA_SITE_KEY;
if (process.env.NODE_ENV === 'production') {
  process.env.NODE_ENV = 'development';
}

// Import server body without re-running env-init side effects that would re-fill
// captcha: env-init only fills missing keys, so leave captcha deleted.
// server.ts starts with `import './src/core/env-init.ts'` which is cached.
await import(pathToFileURL(path.join(backendRoot, 'server.ts')).href);
