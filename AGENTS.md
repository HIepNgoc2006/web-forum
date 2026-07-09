# Repository Guidelines

## Project Structure & Module Organization

This repository is an npm workspace for the 36chan web app. `backend/` contains the Node.js API, realtime server, moderation, persistence, and static serving. Core backend logic lives in `backend/src/core/`, HTTP and realtime glue in `backend/src/server/`, and the entry point is `backend/server.ts`. Backend tests live in `backend/test/`. `frontend/` is a Vite browser UI with `frontend/src/app.ts`, decomposed frontend modules under `frontend/src/`, `frontend/src/styles.css`, and `frontend/index.html` as the app shell. If HTML partials are used, keep them as static/build-time authoring files, not runtime templates. `phase-tracking/` contains roadmap, ADRs, API inventory, backup/restore notes, and progress tracking. `.code-review-graph/` contains the local code review graph database and generated graph artifacts. Generated runtime data such as `backend/data/forum.json`, logs, and `.env` files are ignored.

## Architecture Overview

`backend/server.ts` is the composition root: it loads `.env` (hand-parsed, no dotenv), selects drivers from env, and dependency-injects a store, AI client, realtime hub, and image storage into `createForumService`, then injects that service plus auth secrets into `createHttpServer`. To trace any request, start there and follow the injected object.

Swappable interfaces (pick by env, same shape across implementations):
- **Store** (`forum-store.ts` memory/json, `mongo-store.ts`): all expose `read()` / `write(normalizeState(...))`. The model is whole-state read-modify-write — `forum-service.ts` loads the full forum snapshot, mutates, and writes it back; all business rules live there. `STORE_DRIVER` defaults to `json` in dev but production **requires** `mongo` (server throws otherwise).
- **AI** (`ai.ts`): `google` or `openai-compatible` provider, auto-detected from env keys; moderation has a local heuristic fallback so it works with no key, but summary/suggestions need a key.
- **Image storage** (`image-storage.ts`): `local` disk (served at `/uploads/*`) or `s3`-compatible.

Gotchas:
- `express` and `socket.io` are in `backend/package.json` but **not used for routing**. HTTP is a hand-rolled `node:http` router in `server/http-app.ts` (custom `ok`/`fail` helpers, byte-capped `readJson`, Vietnamese error strings). Realtime is **Server-Sent Events** in `server/realtime.ts` (`text/event-stream`, `publish()` broadcasts) — not WebSockets.
- The current frontend baseline is a **Vite static shell plus TypeScript modules**: `frontend/index.html` provides stable DOM anchors and `frontend/src/app.ts` composes modular feature helpers with hash-based routing (`#board/...`, `#thread/...`). React, JSX, routers, or frameworks are allowed only through the frontend architecture guidelines below.
- Auth is layered: JWT admin tokens, separate account tokens, TOTP 2FA (`totp-service.ts`), and WebAuthn passkeys (`webauthn-service.ts`). Moderation uses hashed IP/poster fingerprints (`security.ts`) — raw IPs and tokens are never returned to public clients or sent to AI.

## Build, Test, and Development Commands

Use Node.js 22.18.0 or newer. Backend source-mode TypeScript relies on Node built-in type stripping.

- `npm run dev`: start the backend in watch mode on port 3000.
- `npm run dev:frontend`: start the Vite frontend; it proxies `/api` and `/events` to the backend.
- `npm test`: run backend tests through `backend/test/run-tests.ts`.
- `npm run build`: build backend compiled output into `backend/dist`, then build the frontend with Vite.
- `npm run build:backend`: compile backend TypeScript source to `backend/dist` with rewritten ESM import extensions.
- `npm run build:frontend`: build the frontend with Vite.
- `npm run check`: run backend syntax checks and frontend ESLint.
- `npm --prefix backend install` and `npm --prefix frontend install`: install workspace dependencies when needed.

## Coding Style & Naming Conventions

Use modern ESM TypeScript. Match the existing 2-space indentation, single quotes, trailing semicolons in application and test code, and concise named exports. Prefer kebab-case filenames such as `forum-service.ts`; use camelCase for functions and variables. Keep business rules in `backend/src/core/` and route/socket wiring in `backend/src/server/`. Frontend changes should preserve the current Vite/static-shell behavior unless a scoped frontend architecture change explicitly asks to introduce React, JSX, a router, or a framework.

## Frontend Architecture Evolution Guidelines

The current frontend default is Vite + static `index.html` shell + TypeScript modules + vanilla DOM orchestration. React, JSX, routers, or frameworks may be introduced, but only as explicit, scoped architecture work.

Preferred path:
1. **React/JSX islands first**: add isolated `.tsx` widgets mounted into existing DOM anchors, with typed props and no route/API behavior changes.
2. **Feature-by-feature migration**: convert one low-risk widget, panel, or screen section per PR. Avoid whole-app rewrites.
3. **Router later**: keep current hash routes unless a dedicated router migration issue defines compatibility, redirects, tests, and rollback.
4. **Framework last**: Next.js or any full framework migration must start as a planning issue or POC branch, not as a direct replacement of the current Vite app.

Rules for React/JSX work:
- Add React/JSX support in its own PR before converting existing UI.
- Prefer isolated mount nodes and `mountReactIslands()`-style composition over replacing the whole app shell.
- Keep `frontend/index.html` or its build-time partials as the stable shell unless a dedicated PR proves a safe alternative.
- Preserve existing DOM IDs/classes, Vietnamese UI text, accessibility attributes, hash routes, and API payloads unless the issue explicitly says otherwise.
- Do not introduce React Router, Next.js, Remix, Astro, Svelte, or another framework in the same PR as a simple widget conversion.
- Do not move HTML into runtime template injection just to reduce file size. HTML partials should be static/build-time only.
- Do not add production dependencies without explaining why they are necessary and why a smaller Vite/local alternative is insufficient.
- New React components should avoid `AnyRecord` except at legacy boundaries; define explicit prop types.
- If a React island duplicates existing vanilla behavior, keep the old behavior until validation proves the island is equivalent, then remove the old path in the same PR or a follow-up cleanup.

Rules for router/framework work:
- Create a planning issue before implementation. Include deployment impact, build output, routing compatibility, browser smoke coverage, rollback plan, and whether the backend static serving path changes.
- Keep current hash-route compatibility until a migration PR explicitly updates tests and user-facing links.
- A Next.js/framework POC should live in a clearly separated branch or directory and must not break the existing Vite build until the migration is approved.
- Framework adoption must update `AGENTS.md`, README/deployment docs, CI scripts, and release verification commands in the same planning sequence.

Validation for frontend architecture PRs:
- Run `npm run typecheck`, `npm run check`, `npm run build`, `npm test`, and `npm run test:e2e` when frontend behavior, routing, build setup, or UI rendering changes.
- Include screenshots or browser-smoke notes for visible UI changes.
- Request review for route/hash regressions, DOM ID/class changes, API payload changes, accessibility changes, accidental UI text changes, and bundle/build regressions.

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

Backend tests use Node's built-in `node:test` with `node:assert/strict`. Name files `*.test.ts` under `backend/test/`; if you add a new test file, import it from `backend/test/run-tests.ts`. Cover moderation, security, formatting, and HTTP behavior when those areas change. Run `npm test` for backend behavior and `npm run check` before submitting changes. Run a single suite directly with `node --test backend/test/http.test.ts` (each `*.test.ts` is self-contained and also imported by `run-tests.ts`). `npm run release:verify` chains tests, checks, build, and the `scripts/browser-smoke.mts` e2e smoke.

## Review Guidelines

For repo-wide reviews, do a read-only audit first. Do not edit files until a separate correction pass is requested. Start by mapping:
- runtime entry points and dependency injection from `backend/server.ts`
- HTTP routes, request parsing, response helpers, and byte/body limits in `backend/src/server/http-app.ts`
- Server-Sent Events flow in `backend/src/server/realtime.ts`
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
