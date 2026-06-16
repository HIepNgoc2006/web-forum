# 36chan Production Launch Runbook

Runbook nay dung cho dry-run truoc khi mo public traffic production.

## 1. Prerequisites

- [ ] Node.js 20+ va dependencies da cai bang `npm install`.
- [ ] MongoDB production database san sang, backup/restore access da duoc test.
- [ ] S3/R2 bucket hoac storage policy da chot; neu dung `IMAGE_STORAGE_DRIVER=s3`, bucket credentials phai co san.
- [ ] hCaptcha production `HCAPTCHA_SITE_KEY` va `HCAPTCHA_SECRET` da cau hinh.
- [ ] Admin credentials, `JWT_SECRET`, `MODERATION_FINGERPRINT_SECRET`, va `POSTER_PROOF_SECRET` la gia tri random rieng cho production.
- [ ] AI provider key/model da chot neu bat summary/suggestion/rewrite AI.

## 2. Environment Validation

Production env toi thieu:

```env
NODE_ENV=production
STORE_DRIVER=mongo
MONGODB_URI=mongodb+srv://...
IMAGE_STORAGE_DRIVER=s3
S3_ENDPOINT=...
S3_REGION=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=...
HCAPTCHA_SITE_KEY=...
HCAPTCHA_SECRET=...
ADMIN_USERNAME=...
ADMIN_PASSWORD=...
JWT_SECRET=...
MODERATION_FINGERPRINT_SECRET=...
POSTER_PROOF_SECRET=...
PORT=3000
```

If using Docker Compose, validate config before launch:

```bash
docker compose --env-file compose.env.example config --quiet
```

For real deployment, use an ignored `.env` or platform secret manager, not `compose.env.example`.

## 3. Health Checks

Start the target backend and call:

```bash
curl -fsS http://localhost:3000/api/health
```

Expected launch-ready response:

- HTTP status `200`.
- `status` is `ok`.
- `store.type` is `mongo`.
- `store.configured` and `store.ready` are `true`.
- `imageStorage.configured` and `imageStorage.ready` are `true`.
- `ai.configured` is `true` if AI features are part of the launch.
- `captcha.provider` is `hcaptcha` and `captcha.configured` is `true`.
- `security.adminConfigured` and `security.hcaptchaConfigured` are `true`.
- `security.warnings` is empty or each warning has an explicit waiver.

If `status` is `degraded`, `/api/health` returns HTTP `503`; do not launch until the degraded component is fixed or explicitly waived.

## 4. Backup Before Launch

- [ ] Run `mongodump` against the target MongoDB database.
- [ ] Record backup path, timestamp, and operator in the release notes.
- [ ] Back up local uploads or verify S3/R2 bucket versioning/external backup policy.
- [ ] Keep Mongo data and uploads from the same backup point.
- [ ] If migrating JSON or inline images, keep the generated `forum.json.backup-*` artifact until rollback window closes.

## 5. Dry-run Steps

1. Deploy the candidate build to staging or production-like infrastructure.
2. Run `npm test`, `npm run check`, and `npm run build` on the candidate commit.
3. Validate `/api/health` as above.
4. Create a test thread/comment with hCaptcha in the target environment.
5. Verify an uploaded image is readable from the public UI.
6. Verify admin login and moderation dashboard access.
7. Record all command output or links in the GitHub issue/PR.

## 6. Rollback Plan

- **Application regression:** redeploy the previous known-good image/commit and confirm `/api/health` returns `200`.
- **MongoDB data regression:** restore MongoDB from the pre-launch dump, then restore matching uploads/S3 objects from the same backup point.
- **Storage regression:** keep production on `IMAGE_STORAGE_DRIVER=s3` when using public uploads; fix bucket/CDN credentials or roll back to the previous deploy. Do not switch production to `STORE_DRIVER=json`; `backend/server.js` intentionally rejects JSON storage in `NODE_ENV=production`.
- **hCaptcha regression:** roll back to the previous deploy or correct hCaptcha keys. Do not leave production public posting on dev-pass fallback.

## 7. Dry-run Result Template

- Commit/PR:
- Environment:
- Backup path:
- `/api/health` status:
- Smoke result:
- Rollback tested or waived:
- Open blockers:
