import './src/core/env-init.ts';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createAiClient } from './src/core/ai.ts';
import { createForumService } from './src/core/forum-service.js';
import { createJsonStore } from './src/core/forum-store.ts';
import { createLocalImageStorage, createS3ImageStorage } from './src/core/image-storage.ts';
import { createMongoStore } from './src/core/mongo-store.ts';
import { createRateLimitStoreFromEnv } from './src/core/rate-limit-store.ts';
import { createHttpServer } from './src/server/http-app.js';
import { createRealtimeHub } from './src/server/realtime.ts';
import { assertProductionSecrets } from './src/core/security.ts';

// Environment variables are loaded synchronously in env-init.ts (the first
// import above) to ensure they are available to static imports at module load.

// Fail fast in production rather than silently running with predictable
// default/missing secrets. In non-production this only surfaces warnings.
const securityStatus = assertProductionSecrets({
  jwtSecret: process.env.JWT_SECRET,
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD
});
if (securityStatus.warnings.length > 0) {
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      level: 'warn',
      event: 'security.config',
      warnings: securityStatus.warnings
    })
  );
}

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
const productionMode = process.env.NODE_ENV === 'production';
const storeDriver = String(process.env.STORE_DRIVER ?? (productionMode ? 'mongo' : 'json')).toLowerCase();
if (!['json', 'mongo'].includes(storeDriver)) {
  throw new Error('STORE_DRIVER must be either json or mongo.');
}
if (productionMode && storeDriver !== 'mongo') {
  throw new Error('Production requires STORE_DRIVER=mongo. JSON is only for local/dev/demo fallback.');
}
const imageStorageDriver = String(process.env.IMAGE_STORAGE_DRIVER ?? 'local').toLowerCase();
const forceConnectionClose = String(process.env.HTTP_FORCE_CONNECTION_CLOSE ?? (productionMode ? 'true' : 'false')).toLowerCase() === 'true';
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
const rateLimit = await createRateLimitStoreFromEnv({ logger });
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
  uploadRoot,
  rateLimitStore: rateLimit.store,
  rateLimitFailureMode: rateLimit.failureMode,
  rateLimitLogger: (error) => logger({
    level: 'warn',
    event: 'rate_limit.store.failure',
    message: error?.message ?? String(error)
  }),
  forceConnectionClose
});
server.on('close', () => {
  rateLimit.close().catch((error) => {
    logger({
      level: 'warn',
      event: 'rate_limit.store.close_failed',
      message: error?.message ?? String(error)
    });
  });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`36chan đang chạy tại http://localhost:${port}`);
  console.log(`Store: ${storeDriver === 'mongo' ? 'MongoDB' : 'JSON'}`);
  console.log(`Image storage: ${imageStorageDriver === 's3' ? 'S3-compatible' : 'local disk'}`);
  console.log(`Rate limit store: ${rateLimit.driver}${rateLimit.driver === 'redis' ? ` (${rateLimit.failureMode})` : ''}`);
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET) {
    console.log('Đăng nhập quản trị viên bị tắt cho đến khi cấu hình ADMIN_USERNAME, ADMIN_PASSWORD và JWT_SECRET.');
  }
});
