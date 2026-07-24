import './src/core/env-init.ts';

import path from 'node:path';

import { createAiClient } from './src/core/ai.ts';
import { createResendEmailClient } from './src/core/email.ts';
import { createForumService } from './src/core/forum-service.ts';
import { createJsonStore } from './src/core/forum-store.ts';
import { createLocalImageStorage, createS3ImageStorage } from './src/core/image-storage.ts';
import { createKlipyClient } from './src/core/klipy.ts';
import { createMongoStore } from './src/core/mongo-store.ts';
import { createRateLimitStoreFromEnv } from './src/core/rate-limit-store.ts';
import { authenticateRealtimeSession, createHttpServer } from './src/server/http-app.ts';
import { createRealtimeHub } from './src/server/realtime.ts';
import { createRealtimeStateFromEnv } from './src/server/realtime-state.ts';
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

function resolveStaticRoot(): string {
  return path.resolve(process.env.STATIC_ROOT || 'public');
}

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
const realtimeState = await createRealtimeStateFromEnv({ logger });
const realtime = createRealtimeHub({ state: realtimeState, logger });
const store = storeDriver === 'mongo' ? createMongoStore() : createJsonStore();
const imageStorage =
  imageStorageDriver === 's3'
    ? createS3ImageStorage()
    : createLocalImageStorage({ root: uploadRoot });
const rateLimit = await createRateLimitStoreFromEnv({ logger });
const emailClient = createResendEmailClient({
  from: process.env.EMAIL_FROM
});
const gifClient = createKlipyClient();
const service = createForumService({
  store,
  ai: createAiClient(),
  realtime,
  logger,
  imageStorage,
  emailClient,
  appBaseUrl: process.env.APP_BASE_URL,
  realtimeState
});

const server = createHttpServer({
  service,
  realtime,
  jwtSecret: process.env.JWT_SECRET,
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
  staticRoot: resolveStaticRoot(),
  uploadRoot,
  rateLimitStore: rateLimit.store,
  rateLimitFailureMode: rateLimit.failureMode,
  rateLimitLogger: (error) => logger({
    level: 'warn',
    event: 'rate_limit.store.failure',
    message: error?.message ?? String(error)
  }),
  gifClient,
  forceConnectionClose
});
await realtime.attach(server, {
  service,
  authenticate: (tokens) => authenticateRealtimeSession({
    ...tokens,
    jwtSecret: process.env.JWT_SECRET,
    service
  })
});
server.on('close', () => {
  Promise.all([rateLimit.close(), realtime.close()]).catch((error) => {
    logger({
      level: 'warn',
      event: 'server.dependencies.close_failed',
      message: error?.message ?? String(error)
    });
  });
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => {
  console.log(`36chan đang chạy tại http://${host}:${port}`);
  console.log(`Store: ${storeDriver === 'mongo' ? 'MongoDB' : 'JSON'}`);
  console.log(`Image storage: ${imageStorageDriver === 's3' ? 'S3-compatible' : 'local disk'}`);
  console.log(`Email: ${emailClient.configured ? 'Resend' : 'disabled'}`);
  console.log(`GIF service: ${gifClient.configured ? 'KLIPY enabled' : 'disabled'}`);
  console.log(`Rate limit store: ${rateLimit.driver}${rateLimit.driver === 'redis' ? ` (${rateLimit.failureMode})` : ''}`);
  console.log(`Realtime state: ${realtimeState.driver}`);
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET) {
    console.log('Đăng nhập quản trị viên bị tắt cho đến khi cấu hình ADMIN_USERNAME, ADMIN_PASSWORD và JWT_SECRET.');
  }
});
