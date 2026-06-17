# Beta Changelog and Known Limitations - 2026-06-17

Issue: #60 - Prepare beta changelog and known limitations

## Beta Summary

The web beta is ready for release candidate validation after the production dry-run, security/privacy review, and bug-bash triage are complete.

Required release gate:

```powershell
rtk npm run release:verify
```

## Completed Web Features

- Anonymous imageboard posting with fixed and admin-managed boards.
- Board, thread, catalog, archive, search, latest posts, hot boards, and campus pulse discovery views.
- Thread lifecycle controls: bump limit, reply limit, board caps, archive handling, sticky threads, slow mode, and self-delete passwords.
- Image upload support with local and S3-compatible storage drivers, thumbnail metadata, MIME/size validation, and public `/uploads/*` serving for local storage.
- AI moderation labels, AI summaries, draft suggestions, privacy-safer rewrite, and report summaries with redaction guards.
- Admin moderation queue, reports, sanctions, moderation history, deleted content views, board administration, analytics, and CSV export.
- Optional accounts with private settings, watchlist, drafts, saved searches, account post history, logout/session revocation, passkeys, TOTP 2FA, and backup codes.
- Server-sent events for realtime refresh of thread and archive activity.
- Production health endpoint with safe readiness details for store, storage, AI, captcha, security, and content counts.
- Browser smoke coverage for homepage, board, thread, catalog, admin dashboard, and mobile home/thread layouts.

## Mobile Alpha Status

- No native mobile app is shipped from this repository in the beta.
- Mobile web is alpha-supported through responsive browser smoke coverage for home and thread pages.
- Mobile clients should treat `docs/openapi.yaml` as the API contract and should not assume unlisted account/admin APIs are stable.
- Production beta sign-off still needs a manual mobile browser pass against the deployed environment.

## Desktop Alpha Status

- No native desktop app is shipped from this repository in the beta.
- Desktop browser web is the primary supported client for the beta.
- Desktop native clients, if developed separately, should use `docs/openapi.yaml` and the same account/security constraints as the web client.

## Known Limitations

| Area | Limitation | Beta Handling |
| --- | --- | --- |
| Manual device QA | Local browser smoke does not replace a multi-browser/manual mobile device pass. | Complete manual deployed-environment smoke before widening beta traffic. |
| hCaptcha | Development fallback accepts `dev-pass`; production requires `HCAPTCHA_SECRET`. | Treat missing production hCaptcha config as a launch blocker unless explicitly waived. |
| AI providers | Summary/suggestion/rewrite require a configured Google or OpenAI-compatible provider. | Launch without AI only if product scope explicitly waives AI features. |
| Admin 2FA recovery | Admin 2FA reset exists in service code, but a dedicated operator runbook/script is not published. | Use trusted-admin intervention only; document a recovery script before broad admin onboarding. |
| Storage rollback | Production image uploads should stay on S3-compatible storage when public uploads are in use. | Do not roll production back to JSON storage; follow `docs/launch-runbook.md`. |
| Observability | Health and analytics are available, but production alerting limits are still tracked separately. | Complete issue #63 for scale/observability review. |
| Account docs | Account/security user-facing docs are tracked separately. | Complete issue #61 before broad user onboarding. |

## Security and Privacy Notes

- Security/privacy review #57 found no P0 blocker.
- Public posts do not expose account ids, account usernames, account-private metadata, raw IPs, poster tokens, or delete password hashes.
- AI paths redact sensitive text and do not receive account private data, session tokens, IPs, captcha tokens, poster tokens, or admin tokens.
- Admin analytics are aggregate-only and exclude raw identifiers.
- Production admin/moderator access requires 2FA; browser smoke uses a disposable test-mode backend only for dashboard rendering checks.

## Setup and Deploy Notes

- Use `docs/launch-runbook.md` for production cutover, backup, health, smoke, and rollback steps.
- Use ignored environment files or platform secret managers for production secrets.
- `STORE_DRIVER=mongo` is required in production; JSON storage is for development and test only.
- Verify `/api/health` returns HTTP 200 before traffic cutover; degraded dependencies return HTTP 503.
- Run `rtk npm run release:verify` after any release-branch change.

## P0/P1 Gate Status

| Item | Severity | Status |
| --- | --- | --- |
| #56 production launch dry-run | P0 | Closed by PR #86 |
| #57 security/privacy release review | P0 | Closed by PR #110 |
| #58 bug bash and release blocker triage | P0 | Closed by PR #112 |
| #111 browser smoke admin dashboard blocker | P1 | Closed by PR #112 |
| #60 beta changelog and known limitations | P0 | Closes with this PR |
| #61 account/security documentation | P1 | Open follow-up before broad user onboarding |
| #63 production scale and observability review | P1 | Open follow-up before broad traffic ramp |

## Release Note

Beta is suitable for release-candidate validation once this changelog lands, #61 and #63 are completed or explicitly waived, and `rtk npm run release:verify` passes on the release commit.
