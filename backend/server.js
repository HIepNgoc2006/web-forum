import fs from 'node:fs/promises';
import path from 'node:path';

import { createAiClient } from './src/core/ai.js';
import { createForumService } from './src/core/forum-service.js';
import { createJsonStore } from './src/core/forum-store.js';
import { createLocalImageStorage, createS3ImageStorage } from './src/core/image-storage.js';
import { createMongoStore } from './src/core/mongo-store.js';
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
const uploadRoot = path.resolve(process.env.UPLOAD_ROOT ?? 'data/uploads');
const storeDriver = String(process.env.STORE_DRIVER ?? 'json').toLowerCase();
const imageStorageDriver = String(process.env.IMAGE_STORAGE_DRIVER ?? 'local').toLowerCase();
const logger = (entry) => {
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      level: 'info',
      ...entry
    })
  );
};
const store = storeDriver === 'mongo' ? createMongoStore() : createJsonStore();
const imageStorage =
  imageStorageDriver === 's3'
    ? createS3ImageStorage()
    : createLocalImageStorage({ root: uploadRoot });
const service = createForumService({
  store,
  ai: createAiClient(),
  realtime,
  logger,
  imageStorage
});

const server = createHttpServer({
  service,
  realtime,
  jwtSecret: process.env.JWT_SECRET,
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
  staticRoot: await resolveStaticRoot(),
  uploadRoot
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`36chan đang chạy tại http://localhost:${port}`);
  console.log(`Store: ${storeDriver === 'mongo' ? 'MongoDB' : 'JSON'}`);
  console.log(`Image storage: ${imageStorageDriver === 's3' ? 'S3-compatible' : 'local disk'}`);
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET) {
    console.log('Đăng nhập quản trị viên bị tắt cho đến khi cấu hình ADMIN_USERNAME, ADMIN_PASSWORD và JWT_SECRET.');
  }
});
