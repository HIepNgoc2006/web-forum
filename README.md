# 36chan

Node.js + Vite for the 36chan: anonymous public boards, realtime updates, admin JWT moderation, AI pre-publish moderation, AI summary, and AI reply suggestions.

The app is split into:

- `backend/`: Node API, persistence, moderation, admin routes, and static serving.
- `frontend/`: Vite-hosted browser UI.

## Run

```bash
npm test
npm run dev
```

```bash
npm run dev:backend
npm run dev:frontend
```