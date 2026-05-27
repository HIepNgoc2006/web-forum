# 36chan MVP

Node.js + Vite MVP for the 36chan plan: anonymous public boards, realtime updates, admin JWT moderation, AI pre-publish moderation, AI summary, and AI reply suggestions.

The app is split into:

- `backend/`: Node API, persistence, moderation, admin routes, and static serving.
- `frontend/`: Vite-hosted browser UI.

## Run

```bash
npm test
npm run dev
```

Open `http://localhost:3000`.

Admin login is disabled until `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `JWT_SECRET` are set in `backend/.env`. Public posting uses `dev-pass` as the local hCaptcha token when `HCAPTCHA_SECRET` is not configured.

For separate frontend development:

```bash
npm run dev:backend
npm run dev:frontend
```

## API

- `GET /api/boards`
- `GET /api/boards/:boardSlug/threads`
- `POST /api/boards/:boardSlug/threads`
- `GET /api/threads/:threadId`
- `POST /api/threads/:threadId/comments`
- `GET /api/posts/:globalNumber`
- `POST /api/threads/:threadId/summary`
- `POST /api/threads/:threadId/suggestions`
- `POST /api/admin/login`
- `GET /api/admin/pending`
- `POST /api/admin/pending/:id/approve`
- `DELETE /api/admin/pending/:id`

Realtime events are delivered from `GET /events` as Server-Sent Events with the event names from the MVP contract: `thread:created`, `comment:created`, and `thread:bumped`.
