import fs from 'node:fs/promises';
import path from 'node:path';

import { createAiClient } from './src/core/ai.js';
import { createForumService } from './src/core/forum-service.js';
import { createJsonStore } from './src/core/forum-store.js';
import { createHttpServer } from './src/server/http-app.js';
import { createRealtimeHub } from './src/server/realtime.js';

async function loadEnv() {
  try {
    const raw = await fs.readFile('.env', 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        continue;
      }
      const [key, ...rest] = trimmed.split('=');
      if (!process.env[key]) {
        process.env[key] = rest.join('=').replace(/^"|"$/g, '');
      }
    }
  } catch {
    // .env is optional; .env.example documents the available keys.
  }
}

await loadEnv();

async function resolveStaticRoot() {
  if (process.env.STATIC_ROOT) {
    return path.resolve(process.env.STATIC_ROOT);
  }

  const distRoot = path.resolve('../frontend/dist');
  try {
    await fs.access(path.join(distRoot, 'index.html'));
    return distRoot;
  } catch {
    return path.resolve('../frontend');
  }
}

const realtime = createRealtimeHub();
const service = createForumService({
  store: createJsonStore(),
  ai: createAiClient(),
  realtime
});

const server = createHttpServer({
  service,
  realtime,
  jwtSecret: process.env.JWT_SECRET,
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
  staticRoot: await resolveStaticRoot()
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`36chan đang chạy tại http://localhost:${port}`);
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET) {
    console.log('Đăng nhập quản trị viên bị tắt cho đến khi cấu hình ADMIN_USERNAME, ADMIN_PASSWORD và JWT_SECRET.');
  }
});
