# frontend-next — Next.js POC (not production)

**Status:** proof of concept only  
**Tracking:** part of [#706](https://github.com/36chan/36chan-web/issues/706), implementation [#709](https://github.com/36chan/36chan-web/issues/709)

This directory evaluates whether a future Next.js migration is feasible for 36chan-web. It does **not** replace the production Vite frontend.

## How to run

Requires Node.js **≥ 22.18.0**.

```bash
# install POC deps only (not part of root workspaces)
npm --prefix frontend-next install

# typecheck
npm --prefix frontend-next run typecheck

# static export build (writes .next/ and out/)
npm --prefix frontend-next run build

# preview the static export (serves frontend-next/out on port 3001)
# uses a tiny dependency-free Node server — not `next start`
npm --prefix frontend-next run start
# alias:
npm --prefix frontend-next run preview

# optional Next dev server (HMR; not the same as the static export)
npm --prefix frontend-next run dev
```

`npm run build` with `output: "export"` produces `out/`.  
`npm run start` / `preview` serve that folder locally so you can smoke-check the export.  
If `out/` is missing, the preview script exits and tells you to build first.

Preview path resolution (dependency-free `scripts/serve-static.mjs`) for a request like `/foo`:

1. `out/foo` (exact file)
2. `out/foo/index.html` (directory index)
3. `out/foo.html` (Next static-export route HTML — checked **before** root fallback)
4. `out/index.html` (SPA fallback when present)

Path traversal outside `out/` is rejected. This server is POC-only and does not affect production static serving.

Optional resolve-order smoke (no network, temp fixture only):

```bash
npm --prefix frontend-next run smoke:serve-static
```

Optional root helpers (do not affect production `build` / `check` / `release:verify`):

```bash
npm run typecheck:frontend-next
npm run build:frontend-next
npm run dev:frontend-next
```

**POC warnings**

- This is **not** production. The Vite app under `frontend/` remains the production UI.
- Backend static serving (`STATIC_ROOT` / `frontend/dist`) is **unchanged**.
- Do not treat a successful local static preview as readiness for a Next.js cutover.

## What is not migrated

| Area | Production today | This POC |
|------|------------------|----------|
| App shell | Vite + `frontend/index.html` + partials | Minimal Next layout only |
| Router | Hash routes (`#home`, `#board/...`, `#thread/...`) | Catch-all static SPA shell; no production route migration |
| React islands | Lazy-loaded mounts in Vite app | Not imported |
| API | Same backend `/api`, `/events` | Not wired; no payload changes |
| UI text | Vietnamese production copy | English POC labels only |
| CSS | `frontend/src/styles.css` | Inline minimal styles only |
| Backend static | Serves `frontend/dist` / `STATIC_ROOT` | **Unchanged** |

## Route compatibility notes

- Production navigation is **hash-based** (`frontend/src/router.ts` and friends). Links and bookmarks use `#board/...` and `#thread/...`.
- Next.js App Router is **path-based**. A real migration would need either:
  1. Keep client hash routing inside a Next SPA shell (low churn, limited Next router benefits), or
  2. Migrate to path routes with redirects/compatibility (high risk; needs dedicated planning).
- Static export (`output: "export"`) works for a catch-all shell with `generateStaticParams` returning the index route only.
- Dynamic path segments without `generateStaticParams` are **not** compatible with static export. That is a blocker for a naive “export every board/thread URL” approach.
- **This POC does not change production routes or links.**

## Backend / static-serving impact

- Backend resolves static assets from `STATIC_ROOT` or `frontend/dist` (`backend/server.ts`).
- Browser smoke and production continue to use the Vite build output.
- Serving Next `out/` from the backend is **explicitly deferred**. Doing so would require deploy/CI changes, SPA fallback review, and dual-frontend risk.

## Build / CI impact

- Root workspaces remain `backend` + `frontend` only. Next is **not** hoisted into the main install graph.
- Production scripts unchanged: `npm run build` still runs backend + Vite only.
- POC validation is opt-in via `npm --prefix frontend-next ...` or optional root `*:frontend-next` scripts.
- `release:verify` is intentionally **not** extended in this POC.

## Known blockers / findings

1. **Hash vs path routing** — largest product risk; not solved by installing Next alone.
2. **HTML shell & partials** — production UI is a large static shell + vanilla TS modules, not a pure React tree. Porting is not “drop App into Next”.
3. **React islands** — already lazy-chunked under Vite; can be shared later (Option B) but must not break Vite boundaries.
4. **Static export limits** — no Node image optimization, no server middleware, limited dynamic routes without pre-generation.
5. **Deploy story** — current production is “backend serves Vite `dist`”. Next static `out/` would need a deliberate dual-path or cutover plan.
6. **Bundle / DX** — separate package avoids contaminating production deps; full monorepo workspace adoption can wait.

## Rollback plan

1. Delete or abandon `frontend-next/` (or revert the POC PR).
2. Remove optional root scripts `dev:frontend-next`, `build:frontend-next`, `typecheck:frontend-next` if present.
3. Do **not** change `STATIC_ROOT`, Vite config, or production routes during rollback.
4. Production remains green as long as `frontend/` and backend are untouched.

## Recommendation (initial)

**Continue research; do not migrate production yet.**

- Keep React islands + Vite as the production path.
- Use this POC only to re-validate Next versions / static export over time.
- If a real migration is desired later, plan in phases:
  1. Shared component package (islands only)
  2. Explicit route strategy (hash keep vs path migrate)
  3. Deploy dual-serve or blue/green static root switch
  4. Only then consider removing Vite

## Related docs

- Repo guidelines: `AGENTS.md` → Frontend Architecture Evolution Guidelines
- Planning issue: #706
- Implementation issue: #709
