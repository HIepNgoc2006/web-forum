# 36chan

Node.js + Vite for fullstack

Features:
- Anonymous public boards
- Realtime updates
- Admin JWT moderation
- AI pre-publish moderation
- AI summary
- AI reply suggestions.
- Local disk image storage for development.

The app is split into:

- `backend/`: Node API, persistence, moderation, admin routes, and static serving.
- `frontend/`: Vite-hosted browser UI.

## Run

```bash
npm test
npm run dev
```

```bash
npm run dev:backend
npm run dev:frontend
```

Browser smoke verification runs the built frontend against a temporary backend store and Chrome headless:

```bash
npm run build
npm run test:e2e
```

Use the full release gate before deployment:

```bash
npm run release:verify
```

CI runs the same release verification through `.github/workflows/ci.yml`.

## Configuration

Copy `backend/.env.example` to `backend/.env` for local backend settings.

Important runtime values:

- `STORE_DRIVER`: `mongo` is required for production.
- `MONGODB_URI`: required when `STORE_DRIVER=mongo`.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`: enable admin login.
- `MODERATION_FINGERPRINT_SECRET`: secret used to hash poster/IP fingerprints for temporary cooldown/ban enforcement.
- `POSTER_PROOF_SECRET`: secret used to recognize OP follow-up replies from the same local poster token without exposing the token.
- `GOOGLE_AI_API_KEY`, `GOOGLE_AI_MODEL`: enable AI summary/suggestions and provider-backed moderation.
- `MAX_IMAGE_BYTES`: upload payload limit.
- `IMAGE_STORAGE_DRIVER`: `local` by default, or `s3` for S3-compatible object storage.
- `UPLOAD_ROOT`: local disk folder for uploaded images, served as `/uploads/*` when `IMAGE_STORAGE_DRIVER=local`.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: required when `IMAGE_STORAGE_DRIVER=s3`.
- `S3_PUBLIC_BASE_URL`, `S3_KEY_PREFIX`: optional public CDN/base URL and object key prefix for S3-compatible storage.
- `STATIC_ROOT`: optional override for backend static file serving.

MongoDB is the production persistence store. Mongo storage uses Mongoose models for boards, threads, comments, users, reports, moderation logs, sanctions, AI usage, summary cache, and global state metadata.

```bash
STORE_DRIVER=mongo
MONGODB_URI=mongodb://127.0.0.1:27017/36chan
```

For production readiness, `GET /api/health` reports `store.type`, `store.configured`, `store.ready`, safe counts, and model readiness without returning `MONGODB_URI`, admin credentials, API keys, or other secret values.

For S3-compatible image storage:

```bash
IMAGE_STORAGE_DRIVER=s3
S3_ENDPOINT=https://account-id.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=36chan
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://cdn.example.com/36chan
S3_KEY_PREFIX=uploads
```

The backend uses path-style signed `PUT` requests, which works for common S3-compatible services such as MinIO and Cloudflare R2.
