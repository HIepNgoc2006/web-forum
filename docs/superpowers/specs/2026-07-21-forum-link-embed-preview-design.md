# Forum link embed & preview design

**Date:** 2026-07-21  
**Status:** Approved for planning  
**Scope:** Thread-screen post link previews (OG cards) and rich media embeds

## Summary

Extend the existing DM Open Graph unfurl pipeline so **forum thread posts** (OP + replies) show:

1. **OG link cards** for normal `http(s)` URLs (title, description, thumbnail, domain).
2. **Rich embeds** for a core host set: YouTube, YouTube Shorts, Vimeo, and safe direct image/video file URLs.

Strategy is **hybrid**: best-effort unfurl and store on create/edit; lazy client fetch for old posts and cache misses. Previews appear **only on the thread screen**, not board list, catalog, archive, or admin views.

## Goals

- Users see useful previews when posts contain links, without leaving the thread.
- Reuse DM SSRF protections and OG parsing; avoid a second unfurl stack.
- Never block post publish if remote unfurl fails.
- Keep threads light: capped links, click-to-load iframes, max one rich player per post.

## Non-goals

- Board list, catalog, archive, or admin link cards.
- Twitter/X, TikTok, Instagram, or other social embeds.
- Autoplay, playlist embeds, or generic oEmbed discovery beyond host regex.
- Replacing inline URL text in the post body (cards are additive below the body).

## Decisions

| Topic | Choice |
|-------|--------|
| Preview types | Both OG cards and rich embeds |
| Surfaces | Thread posts only |
| Fetch model | Hybrid (store on write + lazy fallback) |
| Embed hosts | YouTube, Shorts, Vimeo, safe direct image/video URLs |
| Architecture | Shared public unfurl module (extend DM path) |

## Architecture

### Approach

Extract URL extraction, host classification, and OG fetch from the DM path into a shared module (e.g. `backend/src/core/link-preview.ts`). Forum posts gain a `links[]` field. A public `POST /api/link-preview` supports lazy hydration. Thread UI renders cards/embeds under each full post.

DM continues to work: either call the shared helper, or keep `/api/dm/link-preview` as a thin authenticated alias that delegates to the same fetcher.

### Data model

On each thread and comment (persisted + public serialize):

```ts
links?: Array<{
  url: string;
  domain: string;
  kind: 'og' | 'youtube' | 'vimeo' | 'image' | 'video';
  title?: string;
  description?: string;
  image?: string;
  embedId?: string; // youtube / vimeo id when classified
}>
```

Rules:

- Max **3** links per post.
- On create/edit: extract URLs → classify → best-effort unfurl for OG metadata (4s timeout, SSRF blocklist). Post always saves if unfurl fails.
- Missing/legacy `links`: treat as empty for storage; client may re-extract from body for lazy path.
- Normalize/migrate: ensure `links` is an array when present; do not re-unfurl every read on the server.

### API

| Method / path | Auth | Behavior |
|---------------|------|----------|
| `POST /api/link-preview` body `{ url }` | Public (rate-limited by IP) | Returns `{ url, domain, title, description, image }` (and optionally `kind` / `embedId` if classified) |
| `POST /api/dm/link-preview` | Keep for DM clients | Delegate to shared fetcher (account gate optional to preserve current DM contract) |

Response shape should stay compatible with the existing DM frontend cache/hydration path where practical.

### Write path

1. Create/edit thread or comment with body text.
2. `extractLinks(body, max=3)` (shared with DM extraction rules).
3. For each link, `classifyLink(url)` → set `kind` and `embedId` when applicable.
4. Best-effort `fetchOgMeta(url)` for title/description/image (skip or light-touch for pure media kinds if unnecessary).
5. Persist `links` on the post; serialize to clients on thread detail.

### Read / lazy path

1. Thread screen renders posts; for each post with incomplete or missing previews, client extracts bare URLs from body (max 3) or uses stored `links`.
2. Call `POST /api/link-preview` for missing metadata; cache in a session `Map`.
3. Hydrate card DOM in place.

## Frontend (thread screen only)

Place previews under `.post-body` inside a container such as:

```html
<div class="post-link-previews" data-post-links>
  <!-- OG card, embed shell, or direct media -->
</div>
```

### Render rules

| `kind` | UI |
|--------|----|
| `og` | Card: optional image, title, description, domain; whole card is a link |
| `youtube` | Click-to-load shell → iframe `https://www.youtube-nocookie.com/embed/{id}` |
| `vimeo` | Click-to-load shell → Vimeo player iframe |
| `image` | Safe `<img>` or card with thumbnail |
| `video` | Safe `<video controls>` or card |

Additional rules:

- Prefer API `post.links` when present.
- Max **1** rich iframe embed per post; additional YouTube/Vimeo links render as cards.
- No autoplay; iframe inserted only after explicit click.
- Body still shows the raw URL; previews are additive.
- Deleted/hidden posts: no previews.
- Styles: adapt `.dm-link-card` patterns for `.post` (compact, max-width ~480px, board theme tokens).

## Classification

| Pattern | `kind` |
|---------|--------|
| `youtube.com/watch`, `youtu.be/`, `youtube.com/shorts/` | `youtube` |
| `vimeo.com/{numeric id}` | `vimeo` |
| Path ends with common image ext (`jpg`, `jpeg`, `png`, `gif`, `webp`, `avif`) | `image` |
| Path ends with common video ext (`mp4`, `webm`) | `video` |
| Other `http`/`https` | `og` |

## Security

- Protocols: `http` and `https` only.
- SSRF blocklist: localhost, `.local`, `0.0.0.0`, `127.*`, `10.*`, `192.168.*`, `172.16–31.*` (match existing DM logic; extend if gaps found).
- Fetch: ~4s timeout, ~200KB body cap, HTML content-type for OG parse.
- Card images: absolute `http(s)` only after resolve relative/`//` against page origin.
- Iframes: fixed allowlist hosts only (`youtube-nocookie.com`, `player.vimeo.com`).
- Direct media: only classified image/video URLs; never arbitrary iframes.
- Public preview endpoint: rate-limit by IP.
- Do not leak poster IP/tokens beyond normal server-side fetch headers (`User-Agent: 36chan-link-preview/1.0`).

## Limits

| Limit | Value |
|-------|--------|
| Links per post (stored/shown) | 3 |
| Rich iframes per post | 1 |
| Unfurl timeout | 4s |
| HTML body cap for OG | ~200KB |
| Client preview cache | In-memory Map (session) |

## Testing

**Backend**

- Classify YouTube, Shorts, Vimeo, image, video, og.
- SSRF hosts rejected.
- OG parse happy path with mocked fetch.
- Create/edit attaches `links`; thread serialize includes `links`.
- Unfurl failure does not fail post create.

**Frontend**

- Thread post HTML includes `.post-link-previews` when `links` present.
- Click-to-load inserts allowlisted iframe.
- Board list does not render post link previews.

**Optional smoke**

- Post containing a YouTube URL shows embed shell on thread view.

## Implementation sketch (not a full plan)

1. Shared `link-preview` module: extract, classify, fetch OG, SSRF checks.
2. Wire create/edit + normalize/serialize for threads/comments.
3. Public `POST /api/link-preview` + DM alias.
4. Thread renderer + styles + click-to-load behavior.
5. Tests + API inventory / phase-tracking notes if contracts change.

## Open implementation notes

- Exact field list on Mongo/json schemas follows existing post field sanitization patterns (`THREAD_FIELDS` / `COMMENT_FIELDS` or equivalent).
- Prefer extracting shared code from `getDmLinkPreview` rather than duplicating regex/fetch logic.
- Vietnamese UI copy for embed button (e.g. "Phát video") should match existing product tone.
