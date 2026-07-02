# Cache Layer Evaluation - 2026-06-23

Issue: #229 - Evaluate Redis/cache layer for catalog, AI summaries, and rate counters

## Decision

Redis is not required for the controlled beta while the backend runs as a
single production instance backed by MongoDB. MongoDB remains the required
production store, and the current app already persists the AI summary cache and
AI usage counters through the store layer.

Redis, or another shared low-latency backend, should gate broad multi-instance
traffic for rate counters. The default HTTP rate limiters use in-process
fixed-window maps, so horizontal scaling multiplies the effective per-IP limit
by the number of backend instances. That weakens auth, posting, search, and AI
abuse controls. Follow-up #261 implemented a Redis-backed shared limiter option
for multi-instance deployments.

Catalog caching should not move to Redis yet. The catalog view is derived from
the same thread listing data as board/archive pages, and the higher-priority
scale work is incremental MongoDB reads/writes plus pagination. Add a catalog
cache only after production metrics show read latency or MongoDB load from
catalog/list endpoints is the bottleneck.

AI summary caching should stay in the existing store-backed `aiSummaryCache`.
A Redis hot cache can be considered later, but it is not needed for correctness
or beta cost control because summaries are keyed by content fingerprint and
persisted in MongoDB in production.

## Current Integration Points

| Surface | Current implementation | Cache decision |
| --- | --- | --- |
| HTTP rate counters | `backend/src/core/security.ts` exposes `createRateLimiter({ store })`; `backend/src/core/rate-limit-store.ts` provides Redis-backed atomic counters; `backend/src/server/http-app.ts` creates scoped limiters for thread, comment, AI, account, admin, search, and generic routes. | Use `RATE_LIMIT_STORE=redis` before broad multi-instance traffic. |
| AI summaries | `cacheSummary(...)` in `backend/src/core/forum-service.ts` stores summaries in `state.aiSummaryCache` by fingerprint. `mongo-store.ts` persists this as the `aiSummaryCache` key-value collection. | Keep store-backed cache. Redis hot cache is optional only if metrics show repeated hot-read pressure. |
| AI daily budgets | `consumeAiBudget(...)` stores daily counters in `state.aiUsage`; Mongo persists them as the `aiUsage` key-value collection. | Keep store-backed counters for daily budgets; do not mix them with minute-scale HTTP limiter counters. |
| Catalog/list reads | Frontend catalog rendering uses the normal board/thread data path. Backend list/archive responses are derived from store reads and service filtering/sorting. | Do not add Redis now. Prefer indexed/paginated Mongo reads and measured read latency first. |

## Migration Risks

- **Rate limiter API shape.** The current limiter store behaves like a
  synchronous `Map`. A real Redis backend needs atomic increment plus TTL and
  likely an async abstraction. Blocking Redis calls or a non-atomic get/set
  adapter would make the limiter less reliable than the current in-process map.
- **Availability mode.** If Redis is required for all writes, Redis downtime can
  turn an abuse-control dependency into a site outage. The shared limiter should
  define fail-open vs. fail-closed behavior per route class; admin/auth routes
  may deserve stricter behavior than read-only public routes.
- **Key compatibility.** Existing limiter keys include IP, route class, method,
  pathname, and sometimes thread/action identifiers. A Redis migration must
  preserve those scopes so limits do not become broader or weaker by accident.
- **Catalog invalidation.** A catalog cache would need invalidation on thread
  create, comment bump, archive, sticky, lock, delete, approve, poll update, and
  board lifecycle changes. That is more risk than value until list-read metrics
  identify catalog as a bottleneck.
- **AI cache consistency.** The AI summary cache is fingerprint-based. A second
  cache layer must preserve fingerprint semantics and avoid serving summaries
  after comments or redaction-relevant content changes.
- **Cold-cache cost spikes.** Moving AI summaries to a volatile cache without
  the persistent Mongo fallback would raise provider spend after restarts or
  cache eviction.
- **Operational ownership.** Redis adds credentials, network policy, backup or
  persistence decisions, dashboards, alerts, and local/staging parity. It should
  be introduced only where shared state is required.

## Prototype / Benchmark Decision

No Redis prototype is needed for this spike. The correctness gap is already
known: per-process limiter state cannot enforce global limits behind a load
balancer. A prototype would not change that decision.

Before implementing catalog caching, collect production/staging metrics for:

| Metric | Trigger to revisit catalog cache |
| --- | --- |
| Board/catalog/list p95 latency | Sustained p95 above the release budget after indexed Mongo pagination is in place. |
| MongoDB read CPU / query latency | Read load, not writes or SSE, is the dominant bottleneck. |
| Cacheable repeated list reads | High repeated same-board catalog requests with low write churn. |
| Invalidation churn | Writes are low enough that cache hit ratio would stay useful. |

## Recommended Follow-ups

| Issue | Recommendation | Release gate |
| --- | --- | --- |
| #261 | Add a shared Redis-compatible rate limiter backend with atomic increment/TTL, fail-open/fail-closed policy, env-based wiring, and tests for auth/posting/AI buckets. | Implemented; enable with `RATE_LIMIT_STORE=redis` before broad multi-instance traffic. |

No follow-up is filed for catalog or AI summary Redis caching. Revisit those
only after observability shows list-read latency or repeated AI summary hot
reads are a material cost or latency problem.

## Release Gate

For controlled beta:

- [x] MongoDB remains the production store.
- [x] AI summary cache and AI daily budgets are persisted in MongoDB.
- [x] In-process HTTP rate limiters remain the default for single-instance beta.
- [x] Shared Redis limiter follow-up #261 is implemented and documented.

Before broad multi-instance traffic:

- [ ] Configure `RATE_LIMIT_STORE=redis` with `RATE_LIMIT_REDIS_URL` or keep
      auth/posting/AI routes on a single backend instance with load-balancer
      routing that does not multiply limits.
- [ ] Add Redis/shared-limiter availability metrics and alerts.
- [ ] Re-check catalog/list latency after Mongo read pagination and production
      traffic metrics are available.
