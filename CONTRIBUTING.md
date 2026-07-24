# Contributing to 36chan

Thanks for your interest. This guide covers the essentials; see
[AGENTS.md](AGENTS.md) for the full architecture and repository conventions.

## Prerequisites

- Node.js 22.18.0 or newer.

## Setup

```bash
npm ci
npm --prefix frontend install
cp .env.example .env   # then fill in values
```

## Development

```bash
npm run dev            # backend on port 3000 (watch mode)
npm run dev:frontend   # Next frontend on port 3001, proxies backend traffic
```

## Before You Submit

```bash
npm test               # backend and frontend unit tests
npm run check          # script/backend checks + frontend typecheck
npm run build          # backend and frontend production builds
```

`npm run release:verify` chains tests, checks, build, and the browser smoke test.

## Coding Style

- Modern ESM TypeScript, 2-space indentation, single quotes, trailing semicolons.
- kebab-case filenames (`forum-service.ts`); camelCase for functions/variables.
- Business rules live in `backend/src/core/`; HTTP/SSE wiring lives in
  `backend/src/server/`.
- Keep frontend work in the Next App Router package and preserve its legacy DOM
  shell, same-origin proxy contracts, and Vietnamese UI text.
- Add tests under `backend/test/` as `*.test.ts` and import them from
  `backend/test/run-tests.ts`.

## Pull Requests

Use concise, imperative commit messages (Conventional Commit prefixes such as
`feat:` / `fix:` / `docs:` are welcome). PRs should include a summary, linked
issue when applicable, commands run, and screenshots for visible frontend
changes. Call out any environment variable or data migration changes explicitly.

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE).
