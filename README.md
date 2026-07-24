# 36chan

Node.js API + Next.js App Router frontend

Features:
- Anonymous public boards
- Realtime updates
- Admin JWT moderation
- AI pre-publish moderation
- AI summary
- AI reply suggestions
- Grounded AI chatbot for the current page, board, or thread.
- Owner-managed custom stickers from validated Imgur image links.
- Local disk image storage for development.

The app is split into:

- `backend/`: Node API, persistence, moderation, admin routes, uploads, feeds, Socket.IO, and a public SSE compatibility endpoint.
- `frontend/`: primary Next.js runtime serving the Vite-derived legacy UI with same-origin API/Socket.IO/SSE/upload proxies.


## Run

Install the root/legacy dependencies and the separately locked Next dependencies:

```bash
npm ci
npm --prefix frontend ci
```

Run development in two terminals. The backend listens on `http://127.0.0.1:3000`; the default frontend command starts Next on `http://127.0.0.1:3001` and proxies backend traffic through `BACKEND_ORIGIN`.

```bash
npm run dev:backend
npm run dev:frontend
```

Default build and browser smoke verification target Next:

```bash
npm run build
npm run test:e2e
```

`npm start` performs the default build, then supervises the loopback backend on port `3000`, private Next on port `3002`, and a public streaming proxy on port `3001`. The proxy overwrites forwarding headers, routes Socket.IO polling to the backend, and sanitizes WebSocket upgrades before tunneling them. If a child exits, the supervisor terminates the others; `SIGINT` and `SIGTERM` are propagated cleanly.

```bash
npm start
```

Use the full release gate before deployment. It validates the backend and Next-hosted legacy UI through unit checks, typechecks, production builds, and the browser smoke:

```bash
npm run release:verify
```

CI runs the same release verification through `.github/workflows/ci.yml`. The Next app serves the legacy shell at `/` and all supported UI entry routes, with `/legacy` retained as an in-app compatibility alias.

For account, anonymous posting, passkey, 2FA, and admin security rules, see `docs/account-security.md`.

## Configuration

Copy `backend/.env.example` to `backend/.env` for local backend settings.

Important runtime values:

- `STORE_DRIVER`: `mongo` is required for production.
- `MONGODB_URI`: required when `STORE_DRIVER=mongo`.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`: enable admin login.
- `MODERATION_FINGERPRINT_SECRET`: secret used to hash poster/IP fingerprints for temporary cooldown/ban enforcement.
- `POSTER_PROOF_SECRET`: secret used to recognize OP follow-up replies from the same local poster token without exposing the token.
- `HCAPTCHA_SITE_KEY`, `HCAPTCHA_SECRET`: enable hCaptcha on public posting. In production, posting fails unless `HCAPTCHA_SECRET` is configured.
- `RESEND_API_KEY`: enables verification, recovery, and notification email delivery through Resend.
- `EMAIL_FROM`: verified sender identity.
- `APP_BASE_URL`: public site URL used in notification links.
- `EMAIL_OTP_SECRET`: optional dedicated HMAC secret for stored OTP hashes; falls back to `JWT_SECRET`.
- `GOOGLE_AI_API_KEY`, `GOOGLE_AI_MODEL`: enable Google-backed moderation, summaries, suggestions, the grounded chatbot, and speech features. OpenAI-compatible deployments can instead use the existing `OPENAI_COMPATIBLE_*` settings.
- `GOOGLE_TTS_MODEL`: optional Gemini speech model override for post listening, default `gemini-3.1-flash-tts-preview`.
- `KLIPY_API_KEY`: enables the server-proxied KLIPY GIF picker. The key stays on the backend; public search, trending, restore-by-slug, and share-trigger calls are rate limited.
- `AI_MODERATION_QUEUE_CONFIDENCE_THRESHOLD`: optional default queue threshold for provider confidence, default `0` to keep every `Flagged` AI result in the admin queue. Admins can override it from the moderation UI. Accepts `0..1` or `0..100`; flagged results without confidence are still queued.
- `MAX_IMAGE_BYTES`: max decoded size per uploaded image/video in bytes (default `52428800` / 50 MiB).
- `RATE_LIMIT_STORE`: `memory` by default, or `redis` to share HTTP rate counters across backend instances.
- `RATE_LIMIT_REDIS_URL` or `REDIS_URL`: required when `RATE_LIMIT_STORE=redis`.
- `RATE_LIMIT_FAILURE_MODE`: `closed` by default to deny requests when the shared limiter backend is unavailable; set `open` only when availability is preferred over strict abuse control.
- `RATE_LIMIT_REDIS_PREFIX`: optional Redis key prefix for rate-limit counters.
- `REALTIME_REDIS_URL` (or `UPSTASH_REDIS_URL`/`REDIS_URL`): TLS Redis endpoint used for Socket.IO fan-out, presence, connection metadata, per-user realtime limits, and unread-count cache. Upstash must use its `rediss://` endpoint; its REST URL cannot provide Pub/Sub.
- `REALTIME_REDIS_REQUIRED`: fail startup when shared realtime Redis is unavailable. Set `true` for multi-instance production; local development defaults to the in-memory implementation.
- `REALTIME_REDIS_FAILURE_MODE`: `closed` by default for per-user realtime limits; `open` keeps actions available if Redis fails.
- `REALTIME_PRESENCE_TTL_SECONDS`, `REALTIME_UNREAD_TTL_SECONDS`: TTLs for derived presence/connection state and unread-count cache.
- `SOCKET_IO_MAX_BUFFER_BYTES`: inbound Socket.IO payload cap. Media messages stay on the REST upload path.
- `DM_SEND_RATE_LIMIT`, `DM_READ_RATE_LIMIT`, `DM_TYPING_RATE_LIMIT`: per-account shared limits enforced through the realtime state adapter for both Socket.IO and REST fallbacks.
- `IMAGE_STORAGE_DRIVER`: `local` by default, or `s3` for S3-compatible object storage.
- `UPLOAD_ROOT`: local disk folder for uploaded images, served as `/uploads/*` when `IMAGE_STORAGE_DRIVER=local`.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: required when `IMAGE_STORAGE_DRIVER=s3`.
- `S3_PUBLIC_BASE_URL`, `S3_KEY_PREFIX`: optional public CDN/base URL and object key prefix for S3-compatible storage.
- `STATIC_ROOT`: optional override for backend static file serving.
- `BACKEND_ORIGIN`: internal backend origin used by Next server rendering and proxy rewrites. Build and runtime values must match.
- `APP_BASE_URL`: canonical public HTTP(S) origin used by WebAuthn and absolute feed/email links.
- `START_BACKEND=0`: frontend-only mode for a separately deployed backend.

MongoDB is the production persistence store. Mongo storage uses Mongoose models for boards, threads, comments, users, reports, moderation logs, sanctions, AI usage, summary cache, and global state metadata.

```bash
STORE_DRIVER=mongo
MONGODB_URI=mongodb://127.0.0.1:27017/36chan
```

For horizontally scaled production backends, configure a shared limiter:

```bash
RATE_LIMIT_STORE=redis
RATE_LIMIT_REDIS_URL=redis://127.0.0.1:6379
RATE_LIMIT_FAILURE_MODE=closed
```

Also configure shared realtime state. The same Upstash database may be used
with separate key prefixes:

```bash
REALTIME_REDIS_URL=rediss://default:replace-me@your-upstash-host:6379
REALTIME_REDIS_REQUIRED=true
REALTIME_REDIS_FAILURE_MODE=closed
REALTIME_REDIS_PREFIX=36chan:realtime:
REALTIME_PRESENCE_TTL_SECONDS=45
REALTIME_UNREAD_TTL_SECONDS=60
```

MongoDB remains authoritative for conversations, messages, unread state, and
read receipts. Redis stores only reconstructible low-latency state. The
`socket.io-client` frontend dependency is intentional: native WebSocket does
not implement Socket.IO framing, acknowledgements, reconnection, or transport
fallback.

For account email verification and recovery, verify `email` in Resend, add the DNS records Resend provides, then configure:

```bash
RESEND_API_KEY=re_...
EMAIL_FROM=
APP_BASE_URL=
EMAIL_OTP_SECRET=
```

Accounts can log in and post immediately after registration. Email-only features remain disabled until the six-digit OTP is confirmed. OTP challenges expire after 15 minutes, are stored only as HMAC hashes, and are replaced when a new code is sent.

For production readiness and Docker/deployment probes, public `GET /api/health` returns only `{ status, ready }` and disables caching. Authenticated administrators can use `GET /api/admin/health` for store, image storage, AI, hCaptcha, email, realtime, and process diagnostics; neither endpoint returns raw credentials, keys, connection strings, or storage endpoints.

KLIPY searches go through the backend so visitor IPs and private forum identifiers are not sent to the search API. Rendered GIF media is loaded from KLIPY's CDN with `referrerpolicy=no-referrer`, so a viewer's browser still contacts KLIPY when displaying a GIF.

Owners can manage custom stickers from the admin **Sticker** tab. The backend accepts only single-image HTTPS Imgur links, canonicalizes them to `i.imgur.com`, and stores stable `[sticker:custom-…]` tokens. Hiding a sticker removes it from the picker without breaking older posts. The browser loads custom sticker media directly from Imgur with `referrerpolicy=no-referrer`.

### MongoDB Database Structure

`backend/src/core/mongo-store.ts` maps the normalized forum state into these production collections:

| Collection | Purpose | Main keys and indexes |
|---|---|---|
| `boards` | Fixed public board catalog seeded from backend config. | Unique `slug`. |
| `threads` | Original posts, thread lifecycle state, moderation state, poll/image metadata, OP proof fields, and public sorting timestamps. | Unique `id`; `{ boardSlug, bumpedAt }`; `globalNumber`. |
| `comments` | Replies attached to threads with the same public post, moderation, image, OP proof, and delete-password fields used by threads. | Unique `id`; `{ threadId, globalNumber }`; `globalNumber`. |
| `users` | Optional accounts for synced settings and private data. Accounts do not replace anonymous posting by default. | Unique sparse `username`; `{ role, createdAt }`. |
| `reports` | User reports against thread/comment global numbers and admin report workflow status. | `createdAt`; `{ status, boardSlug }`. |
| `moderationActions` | Audit trail for AI/admin decisions, approve/delete reasons, sanctions, and queue history. | `createdAt`; `postId`. |
| `sanctions` | Temporary cooldown/ban records keyed by hashed posting fingerprint. | `{ fingerprint, expiresAt }`; `createdAt`. |
| `aiUsage` | Key/value counters for daily AI budget guards. | `_id` key. |
| `aiSummaryCache` | Key/value cache for generated thread summaries. | `_id` key. |
| `stateMeta` | Global metadata such as schema `version`, `nextGlobalNumber`, and admin moderation settings. | `_id` key, currently `global`. |

The Mongo store reads collections into the same normalized state shape used by the JSON fallback (`users`, `threads`, `comments`, `moderationActions`, `reports`, `sanctions`, `aiUsage`, `aiSummaryCache`, and `nextGlobalNumber`). Writes currently normalize the full state and replace the mutable collections in a serialized queue, which keeps JSON and Mongo behavior aligned for the current single-process service design.

Use placeholders in documentation and environment examples:

```bash
STORE_DRIVER=mongo
MONGODB_URI=mongodb://127.0.0.1:27017/36chan
```

Never commit a production `MONGODB_URI`, admin credential, JWT secret, AI key, S3 key, or hCaptcha secret. `/api/health` exposes only coarse readiness for deployment monitors; detailed diagnostics require admin authentication at `/api/admin/health`.

## Docker

Create a local compose env file, replace every placeholder secret, then build and run the production-like stack with MongoDB:

```bash
cp compose.env.example .env
docker compose up --build
```

The compose stack serves the public frontend proxy on `http://localhost:3000` by mapping host port `3000` to container port `3001`. Private Next listens on loopback port `3002` and the backend listens on loopback port `3000`; the public proxy overwrites forwarding headers, and Next proxies `/api`, `/events`, `/uploads`, and `/feeds` to the backend. MongoDB uses an authenticated replica set with a root bootstrap account, a separate least-privilege `readWrite` application account, and an internal replica-set key. Local uploads remain in the `uploads` Docker volume.

`BACKEND_ORIGIN` is baked into Next rewrite output during the image build. If the backend is moved to another container or host, pass the matching Docker build argument as well as the runtime environment value.

`docker-compose.yml` fails fast when required production secrets are missing. For config validation without committing secrets, run:

```bash
docker compose --env-file compose.env.example config --quiet
```

Set real secrets through your shell or the ignored local compose `.env` before running a deploy-like environment:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-long-password
JWT_SECRET=replace-with-long-random-secret
MODERATION_FINGERPRINT_SECRET=replace-with-long-random-secret
POSTER_PROOF_SECRET=replace-with-long-random-secret
HCAPTCHA_SITE_KEY=10000000-ffff-ffff-ffff-000000000001
HCAPTCHA_SECRET=replace-with-hcaptcha-secret
MONGO_ROOT_USERNAME=root
MONGO_ROOT_PASSWORD=replace-with-long-url-safe-root-password
MONGO_APP_USERNAME=chanapp
MONGO_APP_PASSWORD=replace-with-long-url-safe-app-password
MONGO_REPLICA_SET_KEY=replace-with-long-random-base64-replica-set-key
METRICS_TOKEN=replace-with-long-random-metrics-token
STORE_DRIVER=mongo
MONGODB_URI=mongodb://chanapp:replace-with-long-url-safe-app-password@mongo:27017/36chan?replicaSet=rs0&authSource=36chan
```

Use URL-safe random values for the Mongo passwords when embedding them in `MONGODB_URI`, and keep the root password out of the web service. Configure `HCAPTCHA_SITE_KEY`, `HCAPTCHA_SECRET`, and `METRICS_TOKEN` before using the compose stack as a real public deployment. If `NODE_ENV=production` and `HCAPTCHA_SECRET` is empty, thread/comment posting is blocked by design. Use `npm run dev` for local no-secret development.

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

## Architecture Diagrams

### Entity Relationship Diagram

```mermaid
erDiagram
  BOARD ||--o{ THREAD : contains
  THREAD ||--o{ COMMENT : has
  THREAD ||--o{ REPORT : reported_by_global_number
  COMMENT ||--o{ REPORT : reported_by_global_number
  THREAD ||--o{ MODERATION_ACTION : moderated_by_global_number
  COMMENT ||--o{ MODERATION_ACTION : moderated_by_global_number
  THREAD ||--o{ SANCTION : source_post
  COMMENT ||--o{ SANCTION : source_post
  USER ||--|| ACCOUNT_PRIVATE_DATA : embeds
  STATE_META ||--o{ THREAD : assigns_global_numbers
  STATE_META ||--o{ COMMENT : assigns_global_numbers
  AI_USAGE ||--o{ THREAD : rate_limits_ai_features
  AI_SUMMARY_CACHE ||--o{ THREAD : caches_summary

  BOARD {
    string slug PK
    string name
    string category
    string path
    string description
  }

  THREAD {
    string id PK
    string boardSlug FK
    number globalNumber
    number moderationConfidence
    string displayName
    string authorFingerprint
    string posterHash
    string opProofHash
    string deletePasswordHash
    boolean isPending
    boolean isDeleted
    string moderationStatus
    string moderationLabels
    datetime bumpedAt
    datetime createdAt
  }

  COMMENT {
    string id PK
    string threadId FK
    string boardSlug
    number globalNumber
    string displayName
    string authorFingerprint
    string posterHash
    string opProofHash
    string deletePasswordHash
    boolean isPending
    boolean isDeleted
    string moderationStatus
    datetime createdAt
  }

  USER {
    string id PK
    string username UK
    string email UK
    datetime emailVerifiedAt
    string passwordHash
    string role
    object settings
    object privateData
    datetime createdAt
    datetime updatedAt
  }

  ACCOUNT_PRIVATE_DATA {
    object watchlist
    object drafts
    object savedSearches
    object contentFilters
    object replyTemplates
    object posterNotes
    object hiddenPosts
    object hiddenThreads
  }

  REPORT {
    string id PK
    string postType
    string postId
    string threadId
    number globalNumber
    string boardSlug
    string status
    string reporterHash
    datetime createdAt
  }

  MODERATION_ACTION {
    string id PK
    string action
    string postType
    string postId
    string threadId
    number globalNumber
    string boardSlug
    string actor
    number moderationConfidence
    datetime createdAt
  }

  SANCTION {
    string id PK
    string fingerprint
    string boardSlug
    string sourcePostType
    number sourceGlobalNumber
    datetime expiresAt
    datetime createdAt
  }

  STATE_META {
    string id PK
    number version
    number nextGlobalNumber
  }

  AI_USAGE {
    string id PK
    object value
  }

  AI_SUMMARY_CACHE {
    string id PK
    object value
  }
```

The public post identity is intentionally anonymous-first: `displayName` is a per-post label, while account `username` stays in `User` and is not exposed as the public author by default. Account watchlist, drafts, saved searches, content filters, reply templates, poster notes, and hidden posts/threads are embedded in `User.privateData`; local/dev JSON storage mirrors the same normalized state shape, while MongoDB is the production store. Hidden posts/threads also work anonymously via browser localStorage and merge into the account on login.

### Activity Diagram

```mermaid
flowchart TD
  Start([User opens 36chan]) --> Browse[Browse public boards, catalog, archive, latest posts]
  Browse --> Choose{Choose action}

  Choose --> Read[Read thread]
  Read --> Watch{Watch locally or with account?}
  Watch -->|Local only| LocalWatch[Store watch state in browser localStorage]
  Watch -->|Logged in and sync enabled| AccountSync[Sync watchlist, drafts, saved searches, and settings through account private data]
  AccountSync --> Browse
  LocalWatch --> Browse

  Choose --> Compose[Compose anonymous thread or comment]
  Compose --> PrivacyScan[Run browser privacy scanner and user edits draft if needed]
  PrivacyScan --> Submit[Submit to API with captcha, poster token, optional display name, and optional image metadata]
  Submit --> Validate[Rate limit, captcha, input, image, and board lifecycle validation]
  Validate --> AiModeration[AI moderation with redacted text only]
  AiModeration --> Decision{Safe?}
  Decision -->|Yes| Publish[Persist public post and emit Socket.IO update]
  Decision -->|No| Pending[Persist pending post for admin review]
  Publish --> Browse

  Pending --> AdminLogin[Admin logs in with JWT]
  AdminLogin --> Review[Review pending queue, reports, history, labels, and context]
  Review --> AdminDecision{Approve or delete?}
  AdminDecision -->|Approve| Approve[Mark public, record moderation action, emit Socket.IO update]
  AdminDecision -->|Delete| Delete[Mark deleted, record moderation action and reason]
  Approve --> Browse
  Delete --> Browse

  Choose --> Account{Use optional account?}
  Account -->|Register or login| Login[Create or validate account session]
  Login --> Settings[Update theme, display preferences, notifications, board subscriptions, and private sync options]
  Settings --> Browse
  Account -->|Stay anonymous| Browse
```

Public reading and anonymous posting do not require an account. Accounts only add opt-in cross-device private data and settings sync; public posts remain `Anonymous` unless a per-post `displayName` is explicitly entered.

### Data Flow Diagram

```mermaid
flowchart LR
  Browser["Browser UI\nfrontend App Router\nlegacy shell on all UI routes"]
  Admin["Admin user\nJWT-protected UI"]
  Http["Node HTTP API\nbackend/src/server/http-app.ts"]
  Service["Forum service\nbackend/src/core/forum-service.ts"]
  Store["Forum store\nMongoDB production\nJSON dev/demo fallback"]
  Mongo[("MongoDB collections")]
  Json[("backend/data/forum.json")]
  Uploads["Image storage\nlocal disk or S3/R2"]
  HCaptcha["hCaptcha verify"]
  AI["AI provider\nGoogle AI Studio"]
  Realtime["Socket.IO /socket.io\npublic SSE compatibility /events"]
  Redis[("Upstash Redis\npresence TTLs, limits, unread cache, fan-out")]

  Browser -->|"public config, boards, threads, catalog, archive, latest, feeds"| Http
  Browser -->|"thread/comment submit: body, captcha token, poster token, optional image metadata"| Http
  Browser -->|"account token: settings and private data sync"| Http
  Admin -->|"admin JWT: queue, reports, sanctions, moderation actions"| Http

  Http -->|"rate limits and auth checks"| Service
  Http -->|"captcha response only for posting"| HCaptcha
  Service -->|"redacted moderation, grounded chat, summary, suggestions, rewrite prompts"| AI
  Service -->|"normalized forum state read/write"| Store
  Service -->|"validated image bytes and metadata"| Uploads
  Store --> Mongo
  Store -. "local/dev/demo only" .-> Json
  Service -->|"public, DM, read, typing, moderation events"| Realtime
  Realtime <-->|"presence, metadata, limits, cache, Pub/Sub"| Redis
  Realtime -->|"public events + authenticated user/moderation rooms"| Browser

  Http -. "safe readiness only: no secrets" .-> Browser
  AI -. "no IP, captcha, poster token, admin token, or account private data" .-> Service
```

Trust boundaries are explicit: public responses and `/api/health` return only coarse readiness without secret values; detailed health requires admin authentication; AI calls receive redacted draft/content text; account/admin JWTs stay in request authorization headers and are not written to public post records.

### Posting Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Browser as Browser SPA
  participant API as Node HTTP API
  participant Captcha as hCaptcha
  participant Service as Forum service
  participant AI as AI provider
  participant Images as Image storage
  participant Store as MongoDB or JSON store
  participant Events as Socket.IO realtime hub
  actor Admin

  User->>Browser: Compose anonymous thread or comment
  Browser->>Browser: Autosave draft and run privacy scanner
  Browser->>API: POST /api/boards/:slug/threads or /api/threads/:id/comments
  API->>API: Apply route rate limit and parse JSON
  API->>Captcha: Verify captcha token for posting
  Captcha-->>API: Pass or reject
  API->>Service: createThread or createComment
  Service->>Service: Validate board, lifecycle, sage/noko, limits, and post fields
  Service->>AI: Moderate redacted post text
  AI-->>Service: Safe or flagged labels
  Service->>Images: Save validated image bytes when present
  Images-->>Service: Public image metadata
  Service->>Store: Persist normalized thread or comment state

  alt Safe content
    Store-->>Service: Saved public post
    Service->>Events: Publish thread or comment event
    Events-->>Browser: Socket.IO event
    API-->>Browser: 201 public post response
  else Flagged content
    Store-->>Service: Saved pending post
    API-->>Browser: 202 pending moderation response
    Admin->>API: Review pending queue with admin JWT
    API->>Service: approvePending or deletePending
    Service->>Store: Record moderation action and update post
    alt Admin approves
      Service->>Events: Publish public post event
      Events-->>Browser: Socket.IO event
    else Admin deletes
      Service-->>API: Deleted stays non-public
    end
  end
```

Pending and deleted posts are stored for moderation history but are not emitted as public realtime content. Logged-in accounts can sync private data around this flow, but account identity is not copied into the public author field by default. `/events` remains public-only during compatibility migration; private DM, notification, presence, read-receipt, and moderation events are Socket.IO room events.
