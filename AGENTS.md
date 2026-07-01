# Repository Guidelines

## Project Structure & Module Organization

This repository is an npm workspace for the 36chan web app. `backend/` contains the Node.js API, realtime server, moderation, persistence, and static serving. Core backend logic lives in `backend/src/core/`, HTTP and realtime glue in `backend/src/server/`, and the entry point is `backend/server.js`. Backend tests live in `backend/test/`. `frontend/` is a Vite browser UI with `frontend/src/app.js`, `frontend/src/styles.css`, and `frontend/index.html`. `phase-tracking/` contains roadmap, ADRs, API inventory, backup/restore notes, and progress tracking. `.code-review-graph/` contains the local code review graph database and generated graph artifacts. Generated runtime data such as `backend/data/forum.json`, logs, and `.env` files are ignored.

## Architecture Overview

`backend/server.js` is the composition root: it loads `.env` (hand-parsed, no dotenv), selects drivers from env, and dependency-injects a store, AI client, realtime hub, and image storage into `createForumService`, then injects that service plus auth secrets into `createHttpServer`. To trace any request, start there and follow the injected object.

Swappable interfaces (pick by env, same shape across implementations):
- **Store** (`forum-store.js` memory/json, `mongo-store.js`): all expose `read()` / `write(normalizeState(...))`. The model is whole-state read-modify-write — `forum-service.js` loads the full forum snapshot, mutates, and writes it back; all business rules live there. `STORE_DRIVER` defaults to `json` in dev but production **requires** `mongo` (server throws otherwise).
- **AI** (`ai.js`): `google` or `openai-compatible` provider, auto-detected from env keys; moderation has a local heuristic fallback so it works with no key, but summary/suggestions need a key.
- **Image storage** (`image-storage.js`): `local` disk (served at `/uploads/*`) or `s3`-compatible.

Gotchas:
- `express` and `socket.io` are in `backend/package.json` but **not used for routing**. HTTP is a hand-rolled `node:http` router in `server/http-app.js` (custom `ok`/`fail` helpers, byte-capped `readJson`, Vietnamese error strings). Realtime is **Server-Sent Events** in `server/realtime.js` (`text/event-stream`, `publish()` broadcasts) — not WebSockets.
- The frontend is **vanilla DOM**, not React: `frontend/index.html` holds the full markup and `frontend/src/app.js` is one imperative module with a central `state` object and hash-based routing (`#board/...`, `#thread/...`). React-listed deps are incidental; `@simplewebauthn/browser` drives passkey login. UI text is Vietnamese.
- Auth is layered: JWT admin tokens, separate account tokens, TOTP 2FA (`totp-service.js`), and WebAuthn passkeys (`webauthn-service.js`). Moderation uses hashed IP/poster fingerprints (`security.js`) — raw IPs and tokens are never returned to public clients or sent to AI.

## Build, Test, and Development Commands

Use Node.js 22 or newer.

- `npm run dev`: start the backend in watch mode on port 3000.
- `npm run dev:frontend`: start the Vite frontend; it proxies `/api` and `/events` to the backend.
- `npm test`: run backend tests through `backend/test/run-tests.js`.
- `npm run build`: build the frontend with Vite.
- `npm run check`: run backend syntax checks and frontend ESLint.
- `npm --prefix backend install` and `npm --prefix frontend install`: install workspace dependencies when needed.

## Coding Style & Naming Conventions

Use modern ESM JavaScript and TypeScript during migration. Match the existing 2-space indentation, single quotes, trailing semicolons in application and test code, and concise named exports. Prefer kebab-case filenames such as `forum-service.js`; use camelCase for functions and variables. Keep business rules in `backend/src/core/` and route/socket wiring in `backend/src/server/`. Frontend changes should preserve the current plain Vite structure unless a larger refactor is explicitly requested.

## TypeScript Migration Guidelines

Port JavaScript to TypeScript incrementally. Do not do a repo-wide `.js` to `.ts` rename in a single PR unless explicitly requested. Use small, reviewable migration passes that keep runtime behavior unchanged.

Recommended order:
1. Add TypeScript infrastructure first: `typescript`, package-level `tsconfig.json` files, shared compiler settings if useful, and `typecheck` scripts that can be wired into `npm run check`.
2. Enable mixed JS/TS with `allowJs` at the start so `.ts` files can coexist with existing `.js` files. Start with permissive settings, then tighten after the code compiles.
3. Convert leaf modules before entry points: pure helpers, validators, formatters, security utilities, and service types before `backend/server.js` or frontend app bootstrap files.
4. Define shared domain types for boards, threads, posts, users/accounts, moderation results, store state, realtime events, image metadata, and API payloads before typing large service functions.
5. Convert tests alongside the code they cover. Keep existing `node:test` behavior unless the test runner is intentionally changed.
6. Convert frontend files with Vite-compatible TypeScript. Keep the current vanilla DOM architecture; do not introduce React or JSX as part of the TypeScript migration.
7. Convert backend entry points only after the build/dev/start story is decided. If backend emits compiled files, keep source in `src/` and run production from `dist/`; if using a TS runtime for development, keep production startup explicit and documented.
8. Turn on stricter compiler options gradually: first `noEmit` typechecks, then `strict`/`noUncheckedIndexedAccess`/similar checks once the initial migration is stable.

Migration PR rules:
- Keep each PR focused on one layer or feature area.
- Avoid behavior changes unless the migration exposes a confirmed bug; put bug fixes in their own commit or PR when practical.
- Do not add new production dependencies just for typing.
- Prefer `import type` / `export type` for type-only imports and exports.
- Add explicit return types for public service, store, auth, moderation, and API boundary functions.
- Validate each migration pass with `npm test`, `npm run check`, and `npm run build` when affected.

## Testing Guidelines

Backend tests use Node's built-in `node:test` with `node:assert/strict`. Name files `*.test.js` under `backend/test/`; if you add a new test file, import it from `backend/test/run-tests.js`. Cover moderation, security, formatting, and HTTP behavior when those areas change. Run `npm test` for backend behavior and `npm run check` before submitting changes. Run a single suite directly with `node --test backend/test/http.test.js` (each `*.test.js` is self-contained and also imported by `run-tests.js`). `npm run release:verify` chains tests, checks, build, and the `scripts/browser-smoke.mjs` e2e smoke.

## Review Guidelines

For repo-wide reviews, do a read-only audit first. Do not edit files until a separate correction pass is requested. Start by mapping:
- runtime entry points and dependency injection from `backend/server.js`
- HTTP routes, request parsing, response helpers, and byte/body limits in `backend/src/server/http-app.js`
- Server-Sent Events flow in `backend/src/server/realtime.js`
- auth, admin, account token, TOTP, and WebAuthn boundaries
- moderation, rate limiting, fingerprinting, and IP/token privacy rules
- store drivers, whole-state read-modify-write behavior, normalization, migrations, and backup/restore paths
- image upload validation and local/S3 storage behavior
- frontend routing, state mutation, API calls, forms, and Vietnamese user-facing copy
- test coverage, release verification, and CI/build scripts

Prioritize findings by production risk:
- **P0**: exploitable security issue, data loss/corruption, secret exposure, account/admin takeover, or broken production startup.
- **P1**: auth/authz bypass, duplicate charge/action style bug, persistent XSS, destructive migration/backup risk, race condition in write paths, high-impact missing validation, or missing tests around changed critical behavior.
- **P2**: correctness bug, reliability issue, performance hot path, confusing API contract, insufficient error handling, flaky or incomplete tests.
- **P3**: maintainability, naming, duplication, docs, or low-risk cleanup.

For every finding, include:
- file path and closest function/route/component
- severity and confidence
- why it matters for this app
- concrete fix strategy
- test or validation command
- whether it should be fixed in an isolated PR

Prefer actionable, high-signal comments. Do not flag broad style preferences, speculative rewrites, or dependency swaps unless they reduce a concrete risk. Treat missing tests as P1 only when behavior is security-sensitive, destructive, or user-visible. Treat docs-only typos as P3 unless they would mislead deployment, security, or operations work.

## Codex Review Workflow

Use this prompt for a whole-codebase review:

```text
Review this entire repository according to AGENTS.md. Do not edit files yet.

First map the architecture, runtime entry points, data flow, auth/authz boundaries, persistence layer, realtime flow, image storage, frontend routing, test strategy, and CI/build commands.

Then produce a prioritized report with P0/P1/P2 findings for correctness, security, data-loss risk, concurrency/race issues, missing tests, performance hot paths, dead code, duplicated logic, and maintainability risks.

For each finding include file paths, closest function/route/component, why it matters, confidence level, proposed correction, test/validation command, and whether it should be fixed in an isolated PR.
```

Use this prompt for a correction pass:

```text
Proceed with correction pass 1 only.

Requirements:
- Keep the diff minimal.
- Preserve public behavior unless fixing a confirmed bug.
- Add or update tests for changed behavior.
- Run the relevant validation commands.
- Do not touch unrelated files.
- Summarize files changed, behavior changed, tests run, tests not run, and remaining risks.
```

For GitHub PR review, comment:

```text
@codex review for security regressions, missing tests, auth/authz issues, data-loss risks, concurrency bugs, XSS/input-validation issues, and production correctness bugs.
```

For local diff review in Codex CLI, use `/review` and choose the branch, commit, or uncommitted changes to inspect. For non-interactive read-only repo triage, use:

```sh
codex exec "Review this repository according to AGENTS.md. Do not edit files. Produce a prioritized P0/P1/P2 correction plan."
```

For controlled correction work, use workspace-write only after reviewing the plan:

```sh
codex exec --sandbox workspace-write "Implement only the first P1 fix from the review. Keep the patch minimal, add/update tests, run validation, and summarize the result."
```

## Project Tracking & Graph Artifacts

Use `phase-tracking/36chan-phase-roadmap.md` as the source for phase status, `phase-tracking/API_INVENTORY.md` for API tracking, and backup/restore notes for operational recovery decisions. Update these files when a task changes scope, status, deadline, API contract, operational decision, backup behavior, or restore behavior.

Use the code review graph for impact analysis on non-trivial backend/frontend changes. Rebuild `.code-review-graph/graph.db` after large code moves or before graph-based review. Treat `.code-review-graph/` as generated local tooling data unless explicitly asked to commit graph artifacts.

## Commit & Pull Request Guidelines

The history uses short imperative messages, sometimes with Conventional Commit prefixes such as `docs:`. Prefer concise messages like `fix: validate image uploads` or `update readme`. Pull requests should include a summary, linked issue when applicable, commands run, and screenshots for visible frontend changes. Call out environment variable or data migration changes explicitly.

## Security & Configuration Tips

Do not commit secrets or local data. Keep `GOOGLE_AI_API_KEY`, `GOOGLE_AI_MODEL`, `HCAPTCHA_SITE_KEY`, `HCAPTCHA_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, `PORT`, and `STATIC_ROOT` in local environment files. Automated agents in this workspace should prefix shell commands with `rtk`.
