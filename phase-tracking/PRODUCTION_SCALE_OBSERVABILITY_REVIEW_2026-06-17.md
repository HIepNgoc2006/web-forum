# Production Scale and Observability Review - 2026-06-17

Issue: #63 - Production scale and observability review

## Summary

The current production path is suitable for a controlled beta after the normal release gate passes, but not for an unbounded traffic ramp. The app has health checks, safe production defaults, upload size caps, AI request limits, and admin analytics. The remaining scale risk is operational: MongoDB writes are still whole-state rewrites, SSE clients are counted but not capped, and storage/AI/cache quotas need provider-side dashboards and alerts.

Required release gate:

```powershell
rtk npm run release:verify
```

## Current Limits

| Area | Current implementation | Production limit |
| --- | --- | --- |
| MongoDB indexes/performance | `backend/src/core/mongo-store.js` defines indexes for thread IDs, board bump order, global numbers, comments by thread/global number, users, reports, sanctions, and moderation actions. | Reads load full collections and writes serialize through one queue, then replace most collections with `deleteMany()` and `insertMany()`. This is acceptable for beta data volume, but write latency and lock contention will grow with total threads/comments/users. |
| S3/R2 bandwidth | `IMAGE_STORAGE_DRIVER=s3` stores uploads through the S3-compatible driver. Uploads are bounded by `MAX_IMAGE_BYTES` and thumbnails by `MAX_THUMBNAIL_BYTES`; `/api/health` probes image storage readiness. | The app does not know bucket bandwidth/cost quotas. Provider dashboards must alert on request rate, egress, storage growth, and failed `PUT`/`HEAD` checks. |
| SSE client limits | `backend/src/server/realtime.js` enforces `SSE_MAX_CLIENTS` (default `1000`), sends heartbeat comments every `SSE_HEARTBEAT_MS` (default `25000`), counts rejected/dropped connections, and drops slow clients after `SSE_MAX_BACKPRESSURE_EVENTS` consecutive backpressure writes (default `3`). `/api/health`, `/metrics`, and `/api/metrics` expose the realtime counters and `SSE_WARN_PCT` / `SSE_CRITICAL_PCT` alert thresholds. | Limits are still per Node process. Multi-instance deployments must aggregate scrape data across instances and set load-balancer stickiness/connection draining deliberately. |
| AI provider rate/cost limits | AI features have HTTP rate limiting (`8/minute` per scoped key) and daily in-app budgets: summaries `20/day`, suggestions `30/day`, rewrites `20/day` per identity key. Summaries are cached by content fingerprint. Admin analytics include AI usage totals. | Provider-side quotas, token/cost alerts, timeout/retry policy, and monthly budget alarms are not enforced in code. Treat quota exhaustion as a degraded AI feature, not a core availability outage. |
| Frontend asset cache | Vite builds hashed assets, and uploaded files are served with `Cache-Control: public, max-age=31536000, immutable`. | Static frontend files served by `backend/src/server/http-app.js` do not currently emit explicit cache headers. Use CDN/platform cache rules for `assets/*`, short/no-cache for `index.html`, and verify behavior in the deployed environment. |
| Health and observability | `/api/health` returns `503` when store or image storage is degraded and includes safe counts/config readiness. `/metrics` and `/api/metrics` return Prometheus text gauges/counters for readiness, store counts, and SSE capacity/backpressure. Admin analytics expose board activity, moderation queues, reports, AI usage, and active user counts. | Distributed tracing and structured log shipping are still external responsibilities. Production monitoring must scrape `/metrics`, collect JSON logs, and alert on the thresholds below. |

## Broad-Traffic SSE Alert Thresholds

Scrape `/metrics` or `/api/metrics` from each backend instance. `SSE_WARN_PCT` defaults to `75`; `SSE_CRITICAL_PCT` defaults to `90`. Suggested production alerts:

- Warning: `chan36_sse_capacity_alert_level >= 1` for 5 minutes, or `chan36_sse_capacity_used_percent >= chan36_sse_capacity_warn_percent` (default 75%).
- Critical: `chan36_sse_capacity_alert_level >= 2` for 2 minutes, or `chan36_sse_capacity_used_percent >= chan36_sse_capacity_critical_percent` (default 90%).
- Backpressure: page if `increase(chan36_sse_backpressure_events_total[5m]) > 0` stays non-zero for 10 minutes; this indicates slow clients or network buffering. Investigate immediately if `increase(chan36_sse_backpressure_drops_total[5m]) > 0`.
- Rejections: page if `increase(chan36_sse_rejected_connections_total[5m]) > 0`; users are being denied realtime connections.
- Drops: investigate if `increase(chan36_sse_dropped_connections_total[5m])` spikes above the normal deploy/restart baseline.
- Readiness: page on `chan36_health_ready == 0`, `chan36_store_ready == 0`, or `chan36_image_storage_ready == 0`.

## Mitigations For Beta

- Keep `NODE_ENV=production` and `STORE_DRIVER=mongo`; do not use JSON storage for production rollback.
- Keep initial launch traffic small enough that full-collection MongoDB reads/writes stay comfortably below request timeout and deploy health-check thresholds.
- Use the launch runbook health check as a deployment gate. A degraded `/api/health` response returns HTTP `503` and should block launch unless explicitly waived.
- Put uploaded media behind S3/R2 plus a CDN when public traffic is enabled; monitor egress and storage growth outside the app.
- Set provider-side AI quota and spend alerts before enabling public AI features broadly.
- Use platform/CDN cache rules for frontend assets until static cache headers are implemented in the backend.
- Scrape `/metrics` in production and review `chan36_sse_capacity_used_percent`, rejected connections, dropped connections, and backpressure events during beta. Restart/scale conservatively if SSE clients climb unexpectedly.
- Rate limiting (`createRateLimiter` in `backend/src/core/security.js`) is **per process**: counters live in an in-process map (now bounded by automatic eviction of expired buckets). With multiple instances behind a load balancer the effective limit is multiplied by the instance count, which weakens the per-IP layer of the auth brute-force protection (#129). For multi-instance deployments, inject a shared Map-like backend (e.g. Redis-backed) via the limiter's `store` option so counters are shared. Until then, prefer a single process for auth-sensitive routes or keep instance count low.

## Follow-up Issues

| Issue | Purpose | Priority |
| --- | --- | --- |
| #115 | Add production SSE connection limits, heartbeat/backpressure handling, metrics, and alert thresholds. | Implemented in repo; configure external dashboards/alerts before broad traffic ramp |
| #116 | Define MongoDB write-path scale thresholds, run load tests, and plan incremental persistence or pagination. | P1 before broad traffic ramp |
| #117 | Add production quota/cache observability for S3/R2 bandwidth, AI provider spend/rate limits, and CDN/static cache behavior. | P1 before broad traffic ramp |
| #229 | Evaluate Redis/cache layer for catalog, AI summaries, and rate counters. | Documented in `phase-tracking/CACHE_LAYER_EVALUATION_2026-06-23.md`; Redis not required for single-instance beta |
| #261 | Add shared rate limiter backend for multi-instance deployments. | Required before broad multi-instance traffic |

## Release Readiness

No new P0 blocker was found for a controlled beta. The beta can proceed after `rtk npm run release:verify` passes and production operators accept the P1 follow-ups above as bounded operational risk for the initial traffic level.
