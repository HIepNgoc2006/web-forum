# AI Daily Board Digest Decision - 2026-06-17

Issue: #62 - Implement or defer AI daily board digest

## Decision

Defer AI daily board digest for beta.

The existing app already supports user/admin-triggered AI summaries with redaction, caching, daily identity budgets, and HTTP rate limits. A daily board digest would add a new AI cost surface and a new admin workflow while production quota/cache observability is still tracked separately in #117.

Follow-up issue: #119 - Implement admin-triggered AI daily board digest after quota controls.

## Reason

- Beta launch should not add background or scheduled AI spend.
- The #62 acceptance criteria allow defer when risk or cost is too high.
- The current board summary path uses public thread bodies and redaction, but it is public-request scoped rather than an admin daily digest workflow.
- A proper implementation should wait for provider quota/cost alerts and should be admin-triggered only.

## Required Constraints For #119

- Admin-triggered action only; no automatic background digest cost.
- Public board content only.
- Explicit AI-generated label in the response and UI.
- Reuse AI budget/caching controls or add stricter admin digest limits.
- Tests must prove account private data, session tokens, IPs, captcha tokens, poster tokens, and admin tokens are never sent to AI.

## Beta Handling

For beta, keep the existing AI summaries, suggestions, rewrite, and report summary features. Do not ship the daily board digest until #119 is implemented and verified.
