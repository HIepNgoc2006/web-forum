# 36chan Next.js frontend

`frontend/` is the production Next.js runtime for the Vite-derived 36chan UI and the repository's sole frontend package.

## Architecture

The only UI implementation is the legacy DOM/hash shell hosted by Next.js App Router.

- Supported clean entry routes are rewritten to the legacy shell before native page matching.
- `/` serves legacy home, clean board/thread/account routes seed the matching legacy hash, and `/legacy#...` remains a direct alias.
- `legacy-shell/` remains build-time authoring input for the compatibility UI.

Next remains responsible for deployment, security headers, assets, and same-origin backend proxying while the browser experience stays on the previous UI.

## Run locally

Requires Node.js 22.18.0 or newer.

```powershell
npm --prefix frontend install
npm run dev
npm --prefix frontend run dev
```

The backend runs on `http://127.0.0.1:3000`; Next runs on `http://127.0.0.1:3001`. Next proxies `/api`, `/socket.io`, `/events`, `/uploads`, and `/feeds` so auth, WebAuthn host handling, uploads, Socket.IO, and compatibility SSE stay same-origin in the browser.

Set `BACKEND_ORIGIN` before `next build` when the backend uses another internal origin. The build records that origin and standalone startup fails if runtime configuration does not match.

## Validate

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:browser
```

`test:browser` starts the real backend and built Next server, opens local Chrome or Edge through CDP, and checks rendered home and board routes, Next assets, API/realtime proxying, console errors, and horizontal overflow. Outside CI it skips with a clear message when no supported browser is installed.

## Production deployment

The build uses `output: 'standalone'`; it is a Node service, not a static export. `npm start` supervises a loopback backend, private Next, and a public dependency-free streaming proxy that overwrites forwarding headers. Set `APP_BASE_URL` to the canonical HTTPS origin in real deployments, especially behind TLS termination.

For an external backend, build with its origin and run with `START_BACKEND=0` plus the same `BACKEND_ORIGIN`. The public proxy routes Socket.IO polling and WebSocket upgrades directly to that origin. Keep `/events` streaming unbuffered only for compatibility clients.

## Active screen status

- `/`, `/home`, board, catalog, archive, thread, account, message, policy, and admin entry routes render the legacy shell.
- The legacy router owns screen changes through hashes and continues to use same-origin API and Socket.IO endpoints.
- `/legacy#...` remains an alias; unknown top-level paths remain 404 responses, while missing board/thread resources use the legacy shell's in-page error handling.
- No separate modern/native route components are compiled or shipped.
