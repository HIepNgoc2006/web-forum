# Full Web Bug Bash and Release Blocker Triage - 2026-06-17

Issue: #58 - Full web bug bash and release blocker triage

## Decision

No P0 product blocker was found in the local beta bug bash pass.

One P1 release-verification blocker was found, filed as #111, and fixed in this branch: `npm run release:verify` failed in `scripts/browser-smoke.mts` because the temporary smoke backend did not set `NODE_ENV=test`, so production admin 2FA enforcement rejected the smoke dashboard login before the dashboard assertions ran.

The fix keeps production admin 2FA enforcement covered by backend tests and makes the browser smoke harness explicitly run its disposable backend in test mode.

## Coverage Matrix

| Scope | Evidence | Result |
| --- | --- | --- |
| Homepage | `scripts/browser-smoke.mts` home desktop/mobile checks; `backend/test/http.test.ts` homepage stats/latest/hot boards/campus pulse tests | Pass |
| Board/thread/catalog/archive | Browser smoke board/thread/catalog checks; `backend/test/http.test.ts` archive/admin archive tests; `backend/test/core.test.ts` archive lifecycle tests | Pass |
| Posting/commenting | Browser smoke seed thread/comment flow; backend HTTP thread/comment tests; rate-limit and moderation tests | Pass |
| Uploads | `backend/test/http.test.ts` local upload serving tests; `backend/test/security-regression.test.ts` invalid MIME and oversize tests; `backend/test/image-storage.test.ts` storage adapter tests | Pass |
| Account login/settings | `backend/test/account.test.ts`, `backend/test/http.test.ts`, WebAuthn and 2FA tests | Pass |
| Admin moderation | Browser smoke admin login/dashboard checks; `backend/test/http.test.ts` admin queue/reports/sanctions/sticky/archive tests; security regression admin JWT tests | P1 smoke harness failure found and fixed |
| AI moderation/summary/suggestion | `backend/test/core.test.ts`, `backend/test/http.test.ts`, and security regression AI redaction tests | Pass |
| Search/watchlist/drafts | `backend/test/http.test.ts` paged search test; `backend/test/account.test.ts` and HTTP private-data sync/clear tests | Pass |
| Responsive layout smoke | Browser smoke home/thread mobile checks | Pass |

## Release Blocker Triage

| Severity | Count | Issues |
| --- | ---: | --- |
| P0 | 0 | None found |
| P1 | 1 | #111 - Browser smoke admin dashboard login blocked by production 2FA mode in the disposable smoke backend; fixed in this branch |
| P2+ | 0 | None filed from this pass |

## Executed Verification

Run from the #58 worktree:

```powershell
rtk npm run release:verify
```

This command runs:

- `npm test`
- `npm run check`
- `npm run build`
- `npm run test:e2e` (`scripts/browser-smoke.mts`)

## Residual QA Risk

This pass covers local automated backend behavior, frontend lint/build, and scripted browser smoke for core desktop/mobile routes. It does not replace a multi-browser/manual device pass against the deployed beta environment with real hCaptcha, real object storage, real AI provider keys, and production CDN/cache behavior.
