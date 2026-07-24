# Repository Guidelines

## Project Structure & Module Organization

This repository contains the 36chan web app. `backend/` contains the Node.js API, realtime server, moderation, persistence, and upload/static serving. Core backend logic lives in `backend/src/core/`, HTTP and realtime glue in `backend/src/server/`, and the entry point is `backend/server.ts`. Backend tests live in `backend/test/`. `frontend/` is the primary Next.js App Router runtime and serves the Vite-derived legacy shell at all supported UI routes; `/legacy` remains a direct alias. `phase-tracking/` contains roadmap, ADRs, API inventory, backup/restore notes, and progress tracking. `.code-review-graph/` contains the local code review graph database and generated graph artifacts. Generated runtime data such as `backend/data/forum.json`, logs, and `.env` files are ignored.

## Architecture Overview

`backend/server.ts` is the composition root: it loads `.env` (hand-parsed, no dotenv), selects drivers from env, and dependency-injects a store, AI client, Socket.IO realtime hub, shared realtime state, and image storage into `createForumService`, then injects that service plus auth secrets into `createHttpServer`. To trace any request, start there and follow the injected object.

Swappable interfaces (pick by env, same shape across implementations):
- **Store** (`forum-store.ts` memory/json, `mongo-store.ts`): all expose `read()` / `write(normalizeState(...))`. The model is whole-state read-modify-write — `forum-service.ts` loads the full forum snapshot, mutates, and writes it back; all business rules live there. `STORE_DRIVER` defaults to `json` in dev but production **requires** `mongo` (server throws otherwise).
- **AI** (`ai.ts`): `google` or `openai-compatible` provider, auto-detected from env keys; moderation has a local heuristic fallback so it works with no key, but summary/suggestions need a key.
- **Image storage** (`image-storage.ts`): `local` disk (served at `/uploads/*`) or `s3`-compatible.
- **Realtime state** (`server/realtime-state.ts`): in-memory for local/single-instance use or Redis/Upstash via `REALTIME_REDIS_URL`. Redis owns derived presence TTLs, connection metadata, per-user realtime rate limits, unread-count cache, and Pub/Sub fan-out; Mongo/JSON remains authoritative for messages and read state.

Gotchas:
- HTTP remains a hand-rolled `node:http` router in `server/http-app.ts`; Express is not used for routing. Socket.IO attaches to that same HTTP server at `/socket.io` for bidirectional/private events. `/events` remains a public-only SSE compatibility endpoint and must never receive DM, notification, moderation, or presence events.
- The production frontend runtime is **Next.js App Router** in `frontend/`. Supported UI routes are rewritten before filesystem routing to the Vite-derived legacy shell, while `/api`, `/socket.io`, `/events`, `/uploads`, and `/feeds` proxy to `BACKEND_ORIGIN`. The production front proxy sends `/socket.io` polling and sanitized WebSocket upgrades directly to the backend. The shell is also available directly at `/legacy`.
- Auth is layered: JWT admin tokens, separate account tokens, TOTP 2FA (`totp-service.ts`), and WebAuthn passkeys (`webauthn-service.ts`). Moderation uses hashed IP/poster fingerprints (`security.ts`) — raw IPs and tokens are never returned to public clients or sent to AI.

## Build, Test, and Development Commands

Use Node.js 22.18.0 or newer. Backend source-mode TypeScript relies on Node built-in type stripping.

- `npm run dev` or `npm run dev:backend`: start the backend in watch mode on port 3000.
- `npm run dev:frontend`: start the primary Next frontend on port 3001; run the backend separately.

- `npm test`: run backend and primary Next unit tests.
- `npm run build`: build backend compiled output into `backend/dist`, then build the primary Next frontend.
- `npm run build:backend`: compile backend TypeScript source to `backend/dist` with rewritten ESM import extensions.
- `npm run build:frontend`: build Next.
- `npm run test:e2e`: run the Next browser smoke.
- `npm start`: build, then supervise the loopback backend on 3000, private Next on 3002, and the public forwarding-header-sanitizing proxy on 3001.
- `npm run check`: run script/backend checks and the primary Next typecheck.
- Run `npm ci` for the root/backend workspace and `npm --prefix frontend ci` for the separately locked Next package.

## Coding Style & Naming Conventions

Use modern ESM TypeScript. Match the existing 2-space indentation, single quotes, trailing semicolons in application and test code, and concise named exports. Prefer kebab-case filenames such as `forum-service.ts`; use camelCase for functions and variables. Keep business rules in `backend/src/core/` and HTTP/SSE wiring in `backend/src/server/`. Primary frontend work belongs in `frontend/legacy/` and `frontend/legacy-shell/` while legacy-only mode is active.

## Frontend Architecture Guidelines

`frontend/` remains the approved deployment and routing boundary, and its only UI implementation is the Vite-derived legacy shell. Keep browser calls same-origin through the existing Next rewrites; do not add a separate native App Router UI unless a future task explicitly changes this architecture.

Rules for primary frontend work:
- Preserve backend API payloads, Vietnamese UI text, accessibility semantics, account/admin token boundaries, Socket.IO room/event contracts, and public compatibility SSE contracts unless a task explicitly changes them.
- Keep `/legacy` working as the in-app compatibility route.

- Do not add another router or frontend framework. Next App Router is the production routing boundary.
- Keep `BACKEND_ORIGIN` server-only; browser code should use same-origin proxy paths.
- Do not add production dependencies without explaining why local Next/React/browser capabilities are insufficient.
- Avoid `AnyRecord` outside compatibility boundaries; define explicit component and API types.

Rules for routing and deployment work:
- The legacy shell is primary at `/` and every supported clean entry route; preserve `/legacy` as a direct alias until a dedicated removal decision.
- `BACKEND_ORIGIN` affects rewrite output during `next build`; the stamped build value must match runtime or startup fails.
- Keep the supervised backend loopback-only. The public proxy owns the exposed port and overwrites forwarding headers before Next/backend trust them.
- Use `START_BACKEND=0` only for a separately deployed backend built with the same `BACKEND_ORIGIN`.
- Deployment changes must update `AGENTS.md`, README, CI, container health checks, and production commands together.
- Preserve host port 3000 for users; the supervised Next process listens on 3001 and the backend listens on container/local port 3000.

Validation for primary frontend or cutover changes:
- Run `npm run typecheck`, `npm run check`, `npm run build`, `npm test`, and `npm run test:e2e`.

- Include screenshots or browser-smoke notes for visible UI changes.
- Request review for clean-route regressions, `/legacy` regressions, API payload changes, accessibility changes, and server/client boundary mistakes.

## TypeScript Migration Guidelines

Current status: repository-owned source, scripts, tests, and frontend files are TypeScript. Keep new repository-owned code TypeScript; use mixed JS/TS settings only in a dedicated future migration setup if needed.

Port JavaScript to TypeScript incrementally. Do not do a repo-wide `.js` to `.ts` rename in a single PR unless explicitly requested. Use small, reviewable migration passes that keep runtime behavior unchanged.

Recommended order:
1. Add TypeScript infrastructure first: `typescript`, package-level `tsconfig.json` files, shared compiler settings if useful, and `typecheck` scripts that can be wired into `npm run check`.
2. Mixed JS/TS with `allowJs` was only for migration bootstrap; the current config is TypeScript-only. If future repository-owned JavaScript appears, isolate any temporary mixed-mode setup in its own PR and remove it after conversion.
3. Convert leaf modules before entry points: pure helpers, validators, formatters, security utilities, and service types before `backend/server.ts` or frontend app bootstrap files.
4. Define shared domain types for boards, threads, posts, users/accounts, moderation results, store state, realtime events, image metadata, and API payloads before typing large service functions.
5. Convert tests alongside the code they cover. Keep existing `node:test` behavior unless the test runner is intentionally changed.
6. Frontend TypeScript migration is complete. React/JSX, router, or framework adoption is no longer a TypeScript migration task; treat it as frontend architecture work under the guidelines above.
7. Convert backend entry points only after the build/dev/start story is decided. If backend emits compiled files, keep source in `src/` and run production from `dist/`; if using a TS runtime for development, keep production startup explicit and documented.
8. Turn on stricter compiler options gradually: first `noEmit` typechecks, then `strict`/`noUncheckedIndexedAccess`/similar checks once the initial migration is stable.

Migration PR rules:
- Keep each PR focused on one layer or feature area.
- Avoid behavior changes unless the migration exposes a confirmed bug; put bug fixes in their own commit or PR when practical.
- Do not add new production dependencies just for typing.
- Prefer `import type` / `export type` for type-only imports and exports.
- Add explicit return types for public service, store, auth, moderation, and API boundary functions.
- Validate each migration pass with `npm test`, `npm run check`, and `npm run build` when affected.

Backend TypeScript source-mode rules:

- Backend dev/start/test currently execute source files directly with Node.
- Node.js must be >=22.18.0 because source `.ts` execution relies on built-in type stripping.
- Backend `.ts` files must use erasable TypeScript syntax only.
- Do not use TypeScript enums, parameter properties, runtime namespaces, decorators, or `import =` aliases in backend source files.
- Use `import type` for type-only imports.
- When source files import converted TypeScript modules, use `.ts` extensions in source imports.
- `backend/tsconfig.build.json` must keep `rewriteRelativeImportExtensions` so emitted `dist` JavaScript imports use `.js`.
- Every backend conversion must pass `npm run typecheck`, `npm --prefix backend run build`, `npm test`, `npm run check`, and `npm run build`.

## Testing Guidelines

Backend tests use Node's built-in `node:test` with `node:assert/strict`. Name files `*.test.ts` under `backend/test/`; if you add a new test file, import it from `backend/test/run-tests.ts`. Cover moderation, security, formatting, and HTTP behavior when those areas change. Run `npm test` for backend and primary Next behavior and `npm run check` before submitting changes. Run a single backend suite directly with `node --test backend/test/http.test.ts`. `npm run release:verify` chains primary tests/checks/build/Next smoke and then the explicit legacy verification gate.

## Review Guidelines

For repo-wide reviews, do a read-only audit first. Do not edit files until a separate correction pass is requested. Start by mapping:
- runtime entry points and dependency injection from `backend/server.ts`
- HTTP routes, request parsing, response helpers, and byte/body limits in `backend/src/server/http-app.ts`
- Socket.IO/SSE routing in `backend/src/server/realtime.ts`, Redis-derived state in `realtime-state.ts`, and the production WebSocket upgrade path in `front-proxy.ts`
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

Do not commit secrets or local data. Keep `GOOGLE_AI_API_KEY`, `GOOGLE_AI_MODEL`, `HCAPTCHA_SITE_KEY`, `HCAPTCHA_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, `METRICS_TOKEN`, `MONGO_ROOT_PASSWORD`, `MONGO_APP_PASSWORD`, `MONGO_REPLICA_SET_KEY`, `MONGODB_URI`, `PORT`, `STATIC_ROOT`, and `BACKEND_ORIGIN` in local environment files. Production Compose must keep Mongo authentication, the least-privilege application user, and the replica-set key enabled. Automated agents in this workspace should prefix shell commands with `rtk`.
