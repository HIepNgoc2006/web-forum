# Release Checklist

Issue: #108 - Release Checklist

Use this checklist before promoting 36chan to production for the Week 8 hardening
release. It complements `docs/launch-runbook.md` (deployment steps and health
gate) and the production scale review in
`phase-tracking/PRODUCTION_SCALE_OBSERVABILITY_REVIEW_2026-06-17.md`.

Mark each item before merging the release branch into `main`.

## 1. hCaptcha Environment Setup

- [ ] `HCAPTCHA_SITE_KEY` set to the production site key.
- [ ] `HCAPTCHA_SECRET` set to the production secret.
- [ ] Verified the frontend renders the hCaptcha widget and posting sends a real
      token (not the `dev-pass` placeholder). Leaving `HCAPTCHA_SECRET` set while
      the frontend still sends `dev-pass` rejects every post.
- [ ] Confirmed posting works end-to-end with a real solved captcha.
- [ ] Reference: production hCaptcha posting flow PR #103 (issue #98).

## 2. Docker Compose / Deploy Verification

- [ ] `docker compose config` validates without errors.
- [ ] `docker compose up` brings up the backend and reaches a healthy state.
- [ ] `/api/health` returns HTTP `200` from inside the composed network.
- [ ] `.dockerignore` excludes `node_modules`, local data, and `.env`.
- [ ] Image builds from a clean checkout (no host-only files baked in).
- [ ] Reference: Docker and DevOps stack PR #101 (issue #100).

## 3. Admin Board Management Verification

- [ ] Admin login works with `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `JWT_SECRET`
      configured (and TOTP if enabled).
- [ ] Create, update, hide/show, and archive a board from the admin UI.
- [ ] Hidden boards are not returned by the public `/api/boards` endpoint.
- [ ] Board changes are reflected on the public board list after refresh.
- [ ] Reference: admin board management PR #102 (issue #99).

## 4. Test / QA Gates

- [ ] Demo/staging seed data dry-run and import flow reviewed using
      `docs/seed-data.md`.
- [ ] `rtk npm test` passes.
- [ ] `rtk npm run check` passes (backend syntax + frontend ESLint).
- [ ] `rtk npm run build` succeeds.
- [ ] `rtk npm run release:verify` passes (tests + check + build + browser smoke).
- [ ] Deployment health endpoint returns `503` when degraded — reference PR #109
      (issue #106).
- [ ] Open QA follow-ups reviewed and triaged, not silently skipped:
      board visibility tests (#104), hCaptcha failure/bypass tests (#105),
      admin board responsive QA (#107), visual regression screenshots (#59).

## 5. Rollback Notes

- [ ] Keep `NODE_ENV=production` and `STORE_DRIVER=mongo`. Do **not** roll back to
      `STORE_DRIVER=json`; JSON storage is dev/demo only and is not a production
      data source.
- [ ] Previous container image tag recorded so it can be redeployed quickly.
- [ ] MongoDB backup/snapshot taken before the release (see backup/restore notes
      in `phase-tracking/`).
- [ ] Rollback plan: redeploy the previous image tag, confirm `/api/health`
      returns `200`, then verify posting and admin login.
- [ ] A degraded `/api/health` (`503`) blocks launch unless explicitly waived.

## 6. Commands Run Before Merge

Record the actual commands and results in the PR description:

```powershell
rtk npm test
rtk npm run check
rtk npm run build
rtk npm run release:verify
docker compose config
```

## 7. Week 8 PR Links

| Area | Issue | PR |
| --- | --- | --- |
| Production hCaptcha posting flow | #98 | #103 |
| Admin board management | #99 | #102 |
| Docker and DevOps stack | #100 | #101 |
| Deployment health check endpoint | #106 | #109 |

## Verification

- [ ] Documentation reviewed by @MCPEngu.
- [ ] Links to all Week 8 PRs are included (section 7).
