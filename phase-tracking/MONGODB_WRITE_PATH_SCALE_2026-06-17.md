# MongoDB Write-Path Scale Threshold and Load Test - 2026-06-17

Issue: #116 - Define MongoDB write-path scale threshold and load test

Follow-up from #63
(`phase-tracking/PRODUCTION_SCALE_OBSERVABILITY_REVIEW_2026-06-17.md`).

## Problem

`backend/src/core/mongo-store.js` follows the same whole-state model as the JSON
store: `read()` loads full collections and `write(normalizeState(...))`
serializes the entire forum snapshot, replacing most collections with
`deleteMany()` + `insertMany()` inside a single mutate queue in
`forum-service.js`. Every thread or comment create therefore reads and rewrites
the whole dataset.

This is fine for beta data volume, but write latency and lock/queue contention
grow with the total number of threads + comments + users, not just with request
rate. The dataset size, not concurrency alone, is the dominant cost.

## Supported Beta Traffic Envelope

These are the documented limits for the current whole-state write path. Stay
within them until incremental writes (below) are implemented.

| Dimension | Beta envelope | Hard re-evaluation point |
| --- | --- | --- |
| Total threads (active + archived) | <= 10,000 | 25,000 |
| Total comments | <= 100,000 | 250,000 |
| Total users | <= 5,000 | 15,000 |
| Sustained write rate (thread/comment creates) | <= 5 writes/sec | 15 writes/sec |
| Peak concurrent writers | <= 10 | 25 |

Rationale: writes serialize through one queue and rewrite full collections, so
per-write cost scales with collection size. Beyond the re-evaluation points the
full-collection rewrite risks exceeding request-timeout and deploy health-check
thresholds.

## Load-Test Thresholds

Pass/fail budget for `scripts/load-test-write-path.mjs` (measures end-to-end
HTTP create latency through the real write path):

| Metric | Target (pass) | Warning | Fail |
| --- | --- | --- | --- |
| Thread create p95 | <= 500 ms | 500-750 ms | > 750 ms |
| Comment create p95 | <= 500 ms | 500-750 ms | > 750 ms |
| Write request error rate | 0% | > 0% | any failure |
| p99 / p50 ratio (latency cliff) | <= 3x | 3-5x | > 5x |

The harness exits non-zero when worst p95 exceeds `P95_BUDGET_MS` (default 750)
or any write fails, so it can gate a release.

## How to Run

Run against a server backed by MongoDB at the dataset size you want to validate
(seed the dataset to near the envelope first to test realistic write cost):

```powershell
# Terminal 1: backend with mongo store
$env:STORE_DRIVER = "mongo"; rtk npm run dev

# Terminal 2: drive the write path
$env:THREADS = "500"; $env:COMMENTS_PER = "10"; $env:CONCURRENCY = "10"
node scripts/load-test-write-path.mjs
```

Record p50/p95/p99 for thread and comment creates at: empty dataset, mid
envelope (~50%), and full envelope (100%). The latency growth between those
points shows how close the whole-state rewrite is to the cliff.

> Note: with no `HCAPTCHA_SECRET` set, the default `dev-pass` captcha token is
> accepted. Do not point the harness at a production instance with a real
> captcha secret; run it against a staging/load environment.

## Incremental Write-Path Plan

Before scaling past the beta envelope, replace whole-state rewrites with
targeted writes. Ordered by impact:

1. **Append-only creates.** Insert a single thread/comment document
   (`insertOne`) instead of `deleteMany` + `insertMany` on the whole collection.
   Highest win: makes create cost independent of collection size.
2. **Targeted updates.** Use `updateOne` for bump/sticky/archive/soft-delete
   instead of rewriting the collection.
3. **Pagination on reads.** `listThreads` already supports `paged`; push board
   thread listing and comment listing to indexed, paginated queries so reads
   stop loading whole collections.
4. **Per-document mutate scope.** Narrow the single global mutate queue to
   per-resource operations so unrelated writes do not serialize behind a full
   snapshot write.
5. **Counters/denormalized fields.** Maintain `replyCount`/`bumpedAt` via atomic
   updates rather than recomputing from full scans.

These are tracked as the production hardening path; beta ships on the
whole-state model within the envelope above.

## Release Gate

Before broad traffic ramp:
- [ ] Load test run at full beta envelope with p95 within budget.
- [ ] Dataset-growth alert set (thread/comment/user counts approaching limits).
- [x] Incremental append-only creates implemented before exceeding the
      re-evaluation points.
      - 2026-06-22: thread/comment create paths use Mongo `appendPostCreate`
        for single-document inserts plus targeted parent/archive updates.

Pairs with SSE limits (#115) and quota/cache observability (#117) as the #63
scale follow-ups.
