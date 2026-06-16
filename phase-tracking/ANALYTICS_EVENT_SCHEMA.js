/**
 * 36chan Analytics Schema & Aggregation Implementation Reference
 * Defines the PII-free response schema structures and dynamic aggregation functions.
 */

// ==========================================
// 1. JSON Schema Definition
// ==========================================
export const AnalyticsEventSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'AnalyticsPayload',
  type: 'object',
  required: ['boardActivity', 'aiUsage', 'moderationQueue'],
  additionalProperties: false,
  properties: {
    boardActivity: {
      type: 'object',
      patternProperties: {
        '^[a-z0-9-]+$': {
          type: 'object',
          required: [
            'activeThreads',
            'activeComments',
            'pendingThreads',
            'pendingComments',
            'deletedThreads',
            'deletedComments',
            'totalReports'
          ],
          properties: {
            activeThreads: { type: 'integer', minimum: 0 },
            activeComments: { type: 'integer', minimum: 0 },
            pendingThreads: { type: 'integer', minimum: 0 },
            pendingComments: { type: 'integer', minimum: 0 },
            deletedThreads: { type: 'integer', minimum: 0 },
            deletedComments: { type: 'integer', minimum: 0 },
            totalReports: { type: 'integer', minimum: 0 }
          }
        }
      }
    },
    aiUsage: {
      type: 'object',
      required: ['total', 'byKind', 'daily'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        byKind: {
          type: 'object',
          required: ['moderation', 'summary', 'suggestion', 'rewrite'],
          properties: {
            moderation: { type: 'integer', minimum: 0 },
            summary: { type: 'integer', minimum: 0 },
            suggestion: { type: 'integer', minimum: 0 },
            rewrite: { type: 'integer', minimum: 0 }
          }
        },
        daily: {
          type: 'array',
          items: {
            type: 'object',
            required: ['date', 'count'],
            properties: {
              date: { type: 'string', format: 'date' },
              count: { type: 'integer', minimum: 0 }
            }
          }
        }
      }
    },
    moderationQueue: {
      type: 'object',
      required: [
        'pendingCount',
        'pendingThreads',
        'pendingComments',
        'oldestPendingAgeMinutes',
        'averageResolutionTimeMinutes',
        'resolvedCount'
      ],
      properties: {
        pendingCount: { type: 'integer', minimum: 0 },
        pendingThreads: { type: 'integer', minimum: 0 },
        pendingComments: { type: 'integer', minimum: 0 },
        oldestPendingAgeMinutes: { type: 'integer', minimum: 0 },
        averageResolutionTimeMinutes: { type: 'integer', minimum: 0 },
        resolvedCount: { type: 'integer', minimum: 0 }
      }
    }
  }
};

// ==========================================
// 2. Pure Aggregate calculation helpers
// ==========================================

/**
 * Builds the board-level activity metrics without pulling individual poster data.
 * @param {Array} threads 
 * @param {Array} comments 
 * @param {Array} reports 
 * @param {Array} boards 
 */
export function aggregateBoardActivity(threads, comments, reports, boards) {
  const activity = {};

  for (const board of boards) {
    const slug = board.slug;
    
    const activeThreads = threads.filter((t) => t.boardSlug === slug && !t.isPending && !t.isDeleted && !t.isArchived).length;
    const activeComments = comments.filter((c) => {
      const parent = threads.find((t) => t.id === c.threadId);
      return parent && parent.boardSlug === slug && !c.isPending && !c.isDeleted;
    }).length;

    const pendingThreads = threads.filter((t) => t.boardSlug === slug && t.isPending && !t.isDeleted).length;
    const pendingComments = comments.filter((c) => {
      const parent = threads.find((t) => t.id === c.threadId);
      return parent && parent.boardSlug === slug && c.isPending && !c.isDeleted;
    }).length;

    const deletedThreads = threads.filter((t) => t.boardSlug === slug && t.isDeleted).length;
    const deletedComments = comments.filter((c) => {
      const parent = threads.find((t) => t.id === c.threadId);
      return parent && parent.boardSlug === slug && c.isDeleted;
    }).length;

    const totalReports = reports.filter((r) => r.boardSlug === slug).length;

    activity[slug] = {
      activeThreads,
      activeComments,
      pendingThreads,
      pendingComments,
      deletedThreads,
      deletedComments,
      totalReports
    };
  }

  return activity;
}

/**
 * Parses in-memory usage keys while stripping all pseudonymous/identifiable key hashes
 * Key structure: YYYY-MM-DD:kind:hashedIdentity24
 */
export function aggregateAiUsage(aiUsageKeys = []) {
  let total = 0;
  const byKind = { moderation: 0, summary: 0, suggestion: 0, rewrite: 0 };
  const dailyMap = {};

  for (const key of aiUsageKeys) {
    const parts = key.split(':');
    if (parts.length < 2) continue;

    const [date, kind] = parts;
    if (kind in byKind) {
      byKind[kind] += 1;
      total += 1;
      dailyMap[date] = (dailyMap[date] || 0) + 1;
    }
  }

  // Build sorted daily array (past 7 days)
  const daily = Object.keys(dailyMap)
    .sort()
    .slice(-7)
    .map((date) => ({ date, count: dailyMap[date] }));

  return { total, byKind, daily };
}
