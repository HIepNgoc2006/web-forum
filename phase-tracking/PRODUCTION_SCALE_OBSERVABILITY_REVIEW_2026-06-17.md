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
| SSE client limits | `backend/src/server/realtime.js` tracks connected clients and board counts, and `/api/health` exposes realtime client counts. | There is no hard connection cap, heartbeat, slow-client backpressure handling, or external metrics export. A single Node process should be treated as beta-scale only until those are added. |
| AI provider rate/cost limits | AI features have HTTP rate limiting (`8/minute` per scoped key) and daily in-app budgets: summaries `20/day`, suggestions `30/day`, rewrites `20/day` per identity key. Summaries are cached by content fingerprint. Admin analytics include AI usage totals. | Provider-side quotas, token/cost alerts, timeout/retry policy, and monthly budget alarms are not enforced in code. Treat quota exhaustion as a degraded AI feature, not a core availability outage. |
| Frontend asset cache | Vite builds hashed assets, and uploaded files are served with `Cache-Control: public, max-age=31536000, immutable`. | Static frontend files served by `backend/src/server/http-app.js` do not currently emit explicit cache headers. Use CDN/platform cache rules for `assets/*`, short/no-cache for `index.html`, and verify behavior in the deployed environment. |
| Health and observability | `/api/health` returns `503` when store or image storage is degraded and includes safe counts/config readiness. Admin analytics expose board activity, moderation queues, reports, AI usage, and active user counts. | There is no metrics endpoint, distributed tracing, structured log sink, or alert policy in this repo. Production monitoring must scrape health, collect JSON logs, and set external alerts. |

## Mitigations For Beta

- Keep `NODE_ENV=production` and `STORE_DRIVER=mongo`; do not use JSON storage for production rollback.
- Keep initial launch traffic small enough that full-collection MongoDB reads/writes stay comfortably below request timeout and deploy health-check thresholds.
- Use the launch runbook health check as a deployment gate. A degraded `/api/health` response returns HTTP `503` and should block launch unless explicitly waived.
- Put uploaded media behind S3/R2 plus a CDN when public traffic is enabled; monitor egress and storage growth outside the app.
- Set provider-side AI quota and spend alerts before enabling public AI features broadly.
- Use platform/CDN cache rules for frontend assets until static cache headers are implemented in the backend.
- Review realtime client counts during beta and restart/scale conservatively if SSE clients climb unexpectedly.

## Follow-up Issues

| Issue | Purpose | Priority |
| --- | --- | --- |
| #115 | Add production SSE connection limits, heartbeat/backpressure handling, metrics, and alert thresholds. | P1 before broad traffic ramp |
| #116 | Define MongoDB write-path scale thresholds, run load tests, and plan incremental persistence or pagination. | P1 before broad traffic ramp |
| #117 | Add production quota/cache observability for S3/R2 bandwidth, AI provider spend/rate limits, and CDN/static cache behavior. | P1 before broad traffic ramp |

## Release Readiness

No new P0 blocker was found for a controlled beta. The beta can proceed after `rtk npm run release:verify` passes and production operators accept the P1 follow-ups above as bounded operational risk for the initial traffic level.
