# Analytics Event Schema Design (Privacy-First)

This document formalizes the analytics event schema and data constraints for 36chan, ensuring all metrics are pure aggregates with zero personally identifiable information (PII) tracking.

---

## 1. Privacy Constraints & Guarantees
To prevent user tracking and comply with the data retention baseline, the analytics engine enforces the following constraints:
1. **No Raw Identifiers**: Under no circumstances are raw IP addresses, account IDs, browser fingerprints, or poster tokens collected, persisted, or returned.
2. **Pseudonym Redaction**: Temporary storage keys used for AI request budgets (e.g. rate limit keys) contain non-reversible cryptographically hashed identities. These are strictly excluded from the serialization process and never exposed in the analytics payloads.
3. **Pure Aggregates Only**: Metrics are calculated dynamically or using global counters, ensuring individual activity cannot be reconstructed.

---

## 2. JSON Response Schema (`GET /api/admin/analytics`)

The analytics endpoint returns a JSON payload containing three primary metric areas:

```json
{
  "data": {
    "boardActivity": {
      "boardSlug": {
        "activeThreads": 0,
        "activeComments": 0,
        "pendingThreads": 0,
        "pendingComments": 0,
        "deletedThreads": 0,
        "deletedComments": 0,
        "totalReports": 0
      }
    },
    "aiUsage": {
      "total": 0,
      "byKind": {
        "moderation": 0,
        "summary": 0,
        "suggestion": 0,
        "rewrite": 0
      },
      "daily": [
        { "date": "YYYY-MM-DD", "count": 0 }
      ]
    },
    "moderationQueue": {
      "pendingCount": 0,
      "pendingThreads": 0,
      "pendingComments": 0,
      "oldestPendingAgeMinutes": 0,
      "averageResolutionTimeMinutes": 0,
      "resolvedCount": 0
    }
  }
}
```

### Schema Field Descriptions

#### 1. `boardActivity` (Board-Level Metrics)
- Map of board identifier keys (e.g., `v`, `tech`) to aggregate post states:
  - `activeThreads` / `activeComments`: Safe, visible public posts.
  - `pendingThreads` / `pendingComments`: Posts flagged by AI awaiting admin review.
  - `deletedThreads` / `deletedComments`: Posts removed by admins or deleted by users.
  - `totalReports`: Cumulative reports filed on posts in this board.

#### 2. `aiUsage` (AI Operation Metrics)
- `total`: Cumulative API count across all models and features.
- `byKind`: Operation category breakdown (`moderation`, `summary`, `suggestion`, `rewrite`).
- `daily`: List of dates and aggregate counts for the past 7 days, allowing administrators to monitor API cost trends.

#### 3. `moderationQueue` (Queue Health Metrics)
- `pendingCount`: Total pending moderation items (`pendingThreads` + `pendingComments`).
- `oldestPendingAgeMinutes`: Age of the oldest pending queue item in minutes, highlighting processing delay.
- `averageResolutionTimeMinutes`: Mean time from report/flag to final admin action (approval or deletion) in minutes.
- `resolvedCount`: Total items processed (approved or deleted) during the tracking window.

---

## 3. Verification & Compliance
- **PII-free tests**: Both `core.test.ts` and `http.test.ts` contain assertions scanning serialized analytics payloads for patterns matching IP addresses (`192.168.x.x`, `127.0.0.1`), `posterToken`, `authorFingerprint`, or `posterHash` values, ensuring no data leaks exist.
