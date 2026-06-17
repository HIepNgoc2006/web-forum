# Security and Privacy Release Review - 2026-06-17

Issue: #57 - Final security and privacy release review

## Decision

No P0 security or privacy blocker was found in the reviewed beta scope.

The release remains gated on normal production configuration checks in `docs/launch-runbook.md`: non-default `JWT_SECRET`, configured admin credentials, hCaptcha where required, production MongoDB, and configured AI provider keys only when AI features are enabled.

## Reviewed Scope

| Area | Evidence | Result |
| --- | --- | --- |
| Account/session security | `backend/test/account.test.js`, `backend/test/security-regression.test.js`, `backend/src/server/http-app.js` account routes | Pass. Account APIs require account JWTs, logout revokes sessions, and private data stays behind authenticated account routes. |
| Public anonymous posting | `backend/test/http.test.js` test `http account identity is not exposed on public posts` | Pass. Public posts do not expose account ids, account usernames, or account-private metadata. |
| Passkey/WebAuthn | `backend/test/webauthn.test.js`, `backend/src/core/webauthn-service.js` | Pass. Registration and login use stored challenges and credential counters; login options do not reveal whether a username exists. |
| TOTP 2FA | `backend/test/totp.test.js`, `backend/src/core/totp-service.js` | Pass. TOTP setup, login verification, backup codes, disable flow, and admin reset behavior are covered. |
| Admin/moderator mandatory 2FA | `backend/test/totp.test.js` test `admin without 2FA can bootstrap setup but cannot access admin API in production mode`, `backend/src/server/http-app.js` `requireAdmin` | Pass. Production admin access is blocked until 2FA is enabled and the session is 2FA verified. |
| AI provider secrets | `backend/test/http.test.js` health tests, `backend/test/core.test.js` OpenAI-compatible provider tests | Pass. Health/config responses avoid returning provider keys, provider env var names, raw base URLs, and upload paths. |
| AI payload redaction | `backend/test/core.test.js`, `backend/test/security-regression.test.js`, `backend/test/http.test.js` | Pass. AI moderation, rewrite, summary, and suggestion paths redact email/phone/student-id patterns and do not send IPs, captcha tokens, poster tokens, admin tokens, or account private data. |
| Upload validation | `backend/test/security-regression.test.js`, `backend/test/http.test.js`, `backend/src/core/forum-service.js` image validation | Pass. Non-image MIME types and oversized payloads are rejected; upload health and public URLs avoid leaking local filesystem paths. |
| Reports/moderation queue | `backend/test/http.test.js`, `backend/test/core.test.js` moderation/report tests | Pass. Reports use reporter hashes; moderation actions record admin reasons and AI labels without private request data. |
| Analytics privacy | `phase-tracking/ANALYTICS_EVENT_SCHEMA.md`, `backend/test/http.test.js`, `backend/test/core.test.js` analytics tests | Pass. Admin analytics are aggregate only and tests scan serialized payloads for raw IPs, account identifiers, poster tokens, poster hashes, and PII. |

## Residual Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Manual browser bug bash is tracked separately. | P1 | Complete issue #58 before beta sign-off. |
| Admin 2FA recovery still depends on trusted admin intervention rather than a dedicated scripted runbook. | P1 | Keep the current ADR restriction: do not publish a CLI command until a reviewed recovery script exists. |
| Production privacy depends on correct environment configuration. | P1 | Use `/api/health` and the launch runbook before traffic cutover; treat default JWT/admin/captcha warnings as launch blockers unless explicitly waived. |

## Verification Commands

Run from a clean worktree:

```powershell
rtk npm test
rtk npm run check
rtk npm run build
```

## Release Note

The reviewed code and tests satisfy the #57 acceptance criteria: no P0 blocker was identified, account identity is not exposed on anonymous public posts, account private data is not sent to AI, and production admin/moderator access requires 2FA.
