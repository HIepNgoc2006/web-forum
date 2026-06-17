#!/usr/bin/env node
// Load-test harness for the MongoDB whole-state write path (issue #116).
//
// The store model is read-modify-write: every thread/comment create reads the
// full forum snapshot, mutates it, and writes it back. This harness drives the
// public HTTP API to measure create latency under that model so we can set a
// supported beta traffic envelope.
//
// It does NOT talk to MongoDB directly on purpose: it measures the real
// end-to-end write path (HTTP -> forum-service mutate queue -> store.write).
//
// Usage (against a running server, ideally STORE_DRIVER=mongo):
//   node scripts/load-test-write-path.mjs
//
// Env:
//   BASE_URL          default http://localhost:3000
//   BOARD_SLUG        default hoc-tap
//   THREADS           thread creates (default 200)
//   COMMENTS_PER      comments per created thread (default 5)
//   CONCURRENCY       in-flight requests (default 10)
//   CAPTCHA_TOKEN     default dev-pass (works when HCAPTCHA_SECRET unset)
//   P95_BUDGET_MS     fail run if write p95 exceeds this (default 750)
//
// Exit code is non-zero if the p95 budget is exceeded, so it can gate CI.

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const BOARD_SLUG = process.env.BOARD_SLUG || 'hoc-tap';
const THREADS = Number(process.env.THREADS || 200);
const COMMENTS_PER = Number(process.env.COMMENTS_PER || 5);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 10));
const CAPTCHA_TOKEN = process.env.CAPTCHA_TOKEN || 'dev-pass';
const P95_BUDGET_MS = Number(process.env.P95_BUDGET_MS || 750);

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarize(label, samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    label,
    count: sorted.length,
    avg: sorted.length ? Number((sum / sorted.length).toFixed(1)) : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : 0
  };
}

async function timedPost(path, payload) {
  const started = performance.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const elapsed = performance.now() - started;
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { ok: response.ok, status: response.status, elapsed, data };
}

async function runPool(tasks) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor++;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

async function main() {
  console.log(`Load test write path against ${BASE_URL}`);
  console.log(`board=${BOARD_SLUG} threads=${THREADS} commentsPer=${COMMENTS_PER} concurrency=${CONCURRENCY}`);

  const threadLatencies = [];
  const commentLatencies = [];
  let threadFailures = 0;
  let commentFailures = 0;

  const threadTasks = Array.from({ length: THREADS }, (_, i) => async () => {
    const result = await timedPost(`/api/boards/${BOARD_SLUG}/threads`, {
      body: `loadtest thread ${i} ${Date.now()}`,
      captchaToken: CAPTCHA_TOKEN
    });
    if (result.ok) {
      threadLatencies.push(result.elapsed);
    } else {
      threadFailures++;
    }
    return result.data?.thread?.id || result.data?.id || null;
  });

  const threadIds = (await runPool(threadTasks)).filter(Boolean);

  const commentTasks = [];
  for (const threadId of threadIds) {
    for (let c = 0; c < COMMENTS_PER; c++) {
      commentTasks.push(async () => {
        const result = await timedPost(`/api/threads/${threadId}/comments`, {
          body: `loadtest comment ${c} ${Date.now()}`,
          captchaToken: CAPTCHA_TOKEN
        });
        if (result.ok) {
          commentLatencies.push(result.elapsed);
        } else {
          commentFailures++;
        }
      });
    }
  }
  await runPool(commentTasks);

  const threadStats = summarize('thread create', threadLatencies);
  const commentStats = summarize('comment create', commentLatencies);

  console.log('\nResults (ms):');
  for (const stats of [threadStats, commentStats]) {
    console.log(
      `  ${stats.label.padEnd(16)} n=${stats.count} avg=${stats.avg} p50=${Math.round(stats.p50)} ` +
        `p95=${Math.round(stats.p95)} p99=${Math.round(stats.p99)} max=${Math.round(stats.max)}`
    );
  }
  console.log(`  failures: threads=${threadFailures} comments=${commentFailures}`);

  const worstP95 = Math.max(threadStats.p95, commentStats.p95);
  console.log(`\nP95 budget: ${P95_BUDGET_MS}ms, observed worst p95: ${Math.round(worstP95)}ms`);

  if (threadFailures || commentFailures) {
    console.error('FAIL: write requests failed during the run.');
    process.exitCode = 1;
    return;
  }
  if (worstP95 > P95_BUDGET_MS) {
    console.error('FAIL: write p95 exceeded budget. Reduce traffic envelope or add incremental write paths (see #116 doc).');
    process.exitCode = 1;
    return;
  }
  console.log('PASS: write path within budget for this traffic level.');
}

main().catch((error) => {
  console.error('Load test harness error:', error);
  process.exitCode = 1;
});
