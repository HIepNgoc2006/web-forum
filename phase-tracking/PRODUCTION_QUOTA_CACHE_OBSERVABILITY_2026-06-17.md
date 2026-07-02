# Production Quota and Cache Observability - 2026-06-17

Issue: #117 - Add production quota and cache observability

Follow-up from #63
(`phase-tracking/PRODUCTION_SCALE_OBSERVABILITY_REVIEW_2026-06-17.md`).

## Summary

The app bounds upload size and AI request rate in code, but it does not know its
provider-side quotas: S3/R2 bandwidth and storage, AI provider request/cost
limits, and CDN/static-frontend cache behavior live outside the process. This
document defines the dashboards, alert thresholds, owners, and runbook actions
that must exist before broad traffic ramp. Quota exhaustion in any of these
surfaces should degrade a feature, not take down the core board.

These are provider/platform configuration items. They are tracked here because
they cannot be enforced from this repo, only observed and alerted on.

## Owners

| Surface | Owner role | Escalation |
| --- | --- | --- |
| S3/R2 storage + bandwidth | Ops on-call | Platform/account admin |
| AI provider spend + rate | Ops on-call | Account billing owner |
| CDN / static frontend cache | Ops on-call | Platform admin |

## 1. S3 / R2 Bandwidth and Storage

In-code bounds: uploads capped by `MAX_IMAGE_BYTES`, thumbnails by
`MAX_THUMBNAIL_BYTES`; `/api/health` probes image storage readiness
(`HEAD`/`PUT`). The bucket's bandwidth, request, and storage quotas are not
visible to the app.

Dashboards: object count, total stored bytes, egress bytes/day, request rate
(`GET`/`PUT`/`HEAD`), and `4xx`/`5xx` error rate.

| Metric | Warning | Critical | Action |
| --- | --- | --- | --- |
| Stored bytes vs. plan quota | 70% | 90% | Provision more storage or prune orphaned uploads. |
| Egress bytes/day vs. budget | 70% | 90% | Confirm CDN is fronting media; investigate hotlinking/abuse. |
| `PUT`/`HEAD` error rate (5 min) | > 1% | > 5% | Treat image storage as degraded; `/api/health` should report `503`. |
| Failed health `HEAD`/`PUT` probe | any | sustained > 5 min | Page on-call; check credentials/bucket policy. |

Runbook actions:
- Put uploaded media behind S3/R2 + CDN before enabling public traffic.
- If storage critical: stop accepting new uploads (lower limits) and prune
  orphaned files before increasing quota.
- If egress critical: verify CDN cache hit ratio; media should rarely hit origin.

## 2. AI Provider Request and Cost Quotas

In-code bounds: HTTP rate limit `8/min` per scoped key; daily in-app budgets of
summaries `20/day`, suggestions `30/day`, rewrites `20/day` per identity; the
admin daily board digest (#119) adds a stricter admin-only budget. Summaries are
cached by content fingerprint. Provider-side token/cost quotas are not enforced
in code.

Dashboards: requests/day per feature, token usage/day, estimated spend/day and
month-to-date, provider error/timeout rate.

| Metric | Warning | Critical | Action |
| --- | --- | --- | --- |
| Month-to-date spend vs. budget | 70% | 90% | Throttle AI features; notify billing owner. |
| Requests/day vs. provider quota | 70% | 90% | Reduce in-app daily budgets; cache more aggressively. |
| Provider `429`/timeout rate (5 min) | > 2% | > 10% | Treat AI as a degraded feature, not an outage. |
| Single-day spend spike | 2x 7-day avg | 4x 7-day avg | Investigate abuse/loop; tighten budgets. |

Runbook actions:
- Set provider-side spend and rate alerts before enabling public AI broadly.
- On quota exhaustion: AI endpoints return `503`/`429` and the UI shows the
  feature as temporarily unavailable; posting/reading are unaffected.
- If spend critical: lower in-app daily budgets and the admin digest budget; the
  digest is admin-triggered only and should be paused first.

## 3. CDN / Static Frontend Cache

In-code behavior: Vite emits content-hashed assets; uploaded files are served
with `Cache-Control: public, max-age=31536000, immutable`. Static frontend files
served by `backend/src/server/http-app.ts` do **not** emit explicit cache
headers, so CDN/platform cache rules must be set.

Recommended cache rules:

| Path | Cache rule | Reason |
| --- | --- | --- |
| `/assets/*` (hashed) | `public, max-age=31536000, immutable` | Content-hashed; safe to cache forever. |
| `/index.html` | `no-cache` (revalidate) | Entry point must pick up new asset hashes. |
| `/uploads/*` | long-lived, behind CDN | Already immutable from origin. |

Dashboards: CDN cache hit ratio, origin request rate, `index.html` vs. asset
request mix, stale-content reports after deploy.

| Metric | Warning | Critical | Action |
| --- | --- | --- | --- |
| CDN cache hit ratio (assets) | < 90% | < 70% | Check cache rules / query-string busting. |
| Origin request rate post-deploy | rising | sustained high | Confirm `index.html` revalidates and assets are immutable. |
| Stale asset reports after deploy | any | repeated | Verify hashed filenames + `index.html` no-cache. |

Runbook actions:
- Until backend static cache headers are implemented, rely on CDN/platform rules
  above and re-verify after each deploy.
- On a bad deploy: purge CDN for `index.html` only; hashed assets do not need
  purging.

## Release Gate

Before broad traffic ramp:
- [ ] S3/R2 storage, egress, and probe-failure alerts configured.
- [ ] AI spend, request-quota, and error-rate alerts configured.
- [ ] CDN cache rules applied and hit-ratio dashboard live.
- [ ] Owners and escalation paths confirmed for each surface.

This closes the #117 follow-up by documenting thresholds, owners, and runbook
actions. The remaining scale follow-ups are SSE limits (#115) and MongoDB
write-path thresholds (#116).
