# Hidden boards (account discovery filter) design

**Date:** 2026-07-21  
**Status:** Approved for planning  
**Scope:** Let logged-in accounts hide specific boards from discovery UI while keeping direct board URLs and board subscriptions independent

## Summary

Account users can maintain a **hide list** of board slugs so discovery surfaces only show boards they care about. Example: hide everything except when browsing via direct links; keep following `/confession/` and `/tam-su/` for notifications and “Bảng đang theo dõi.”

This is **client-side discovery filtering** backed by account settings. Public APIs and feeds stay unfiltered. Board access by direct URL is unchanged.

## Goals

- Logged-in users can hide boards from top nav, home board list, hot boards, popular threads, and latest posts.
- Hide list is separate from `boardSubscriptions` (follow / email / “Bảng đang theo dõi”).
- Settings sync with the account (same path as theme, home board, subscriptions).
- On-board quick toggle **Ẩn bảng / Hiện bảng** in addition to account settings checkboxes.
- Empty hide list means show all boards (safe default for new accounts).

## Non-goals

- Server-side filtering of public board/home APIs or JSON/RSS feeds.
- Guests: no hide list (accounts only). Local mirror may exist for logged-in session UX only; guests always see all boards.
- Blocking or soft-blocking direct `#board/…`, catalog, archive, or thread URLs.
- Hiding boards from admin UIs, account settings board option lists, search, watchlist, my posts, or DMs.
- Replacing `boardSubscriptions` with a whitelist visibility model.

## Decisions

| Topic | Choice |
|-------|--------|
| Discovery scope | Full UI hide (nav, home table, hot, popular, latest) |
| Preference model | Separate `hiddenBoards` list + existing `boardSubscriptions` |
| Conflict | Hide wins on discovery; follow list + email still use subscriptions |
| Architecture | Client filter + account settings field (Approach 1) |
| Quick action | On-board Ẩn/Hiện toggle + settings checkboxes |
| Direct URLs | Always work |
| Guests | No hide feature |

## Architecture

### Approach

Mirror the existing board-subscription stack:

1. **Backend:** add `settings.hiddenBoards: string[]` to account defaults and `normalizeAccountSettings`, reusing the same slug normalization used for `boardSubscriptions` (known non-archived boards only, unique, capped to board count).
2. **Frontend storage:** local mirror of hidden slugs (for snappy toggles), overwritten when account settings apply.
3. **Shared helper:** `isBoardHidden(slug)`, `hiddenBoardSlugs()`, `writeHiddenBoardSlugs()`, `visibleBoards(boards)` used by all discovery renderers.
4. **UI:** account settings checkbox group + board-page toggle buttons next to theo dõi.

No new HTTP routes. Persist through the existing account settings update endpoint.

### Data model

On `user.settings` (already returned by `/api/account/me` and written by account settings save):

```ts
settings: {
  // existing fields...
  boardSubscriptions: string[]; // follow / notify / “đang theo dõi”
  hiddenBoards: string[];       // NEW — discovery hide list
}
```

Rules:

- Default: `hiddenBoards: []` → no filtering.
- Normalize with the same rules as `normalizeBoardSubscriptionSlugs` (or a shared `normalizeBoardSlugList`):
  - coerce to strings, trim
  - keep only slugs present on current non-archived boards
  - dedupe
  - stop once size reaches board count
- Independent of `boardSubscriptions`: a board may be in both, one, or neither.

**Conflict rule**

| Surface | Hidden + subscribed |
|---------|---------------------|
| Top nav, home board table, hot boards | Hidden (omit) |
| Popular threads / latest posts | Hidden (omit posts with that `boardSlug`) |
| “Bảng đang theo dõi” | Still shown if subscribed |
| Subscription email notifications | Still eligible if subscription notify prefs allow |
| Direct board/thread URLs | Still load normally |

### Settings API

No new endpoints. Existing account settings PATCH/PUT (whatever the app already uses for `boardSubscriptions`) accepts:

```json
{
  "hiddenBoards": ["an-uong", "hoc-tap"]
}
```

- Invalid / unknown slugs dropped on normalize.
- Response `settings.hiddenBoards` is the normalized list.
- Account settings tests extended to assert normalize + round-trip (same pattern as `boardSubscriptions` in `backend/test/account.test.ts` and `http.test.ts`).

### Frontend sync

1. On login / `applyAccountSyncedSettings`:  
   `writeHiddenBoardSlugs(settings.hiddenBoards || [])` then re-render discovery (nav, home if on home).
2. On settings form save: collect checked hide checkboxes → include in settings payload → write local mirror → re-render.
3. On board toggle: update local set → `persistAccountSettings({ silent: true })` → sync button labels → re-render nav if needed.
4. Logged out: clear or ignore local hide list for rendering; discovery shows all boards. Do not show Ẩn/Hiện as an active control without account (match account-gated patterns; if theo dõi currently works offline via localStorage only, hide should still require account because the product requirement is “users with accounts”—prefer **require account** for hide toggle: toast “Đăng nhập để ẩn bảng.”).

### Filter surfaces (must apply)

| Surface | Implementation hook |
|---------|---------------------|
| Top board nav | `renderBoards` in `frontend/src/home.ts` — map over `visibleBoards(state.boards)` |
| Home board table | `homeBoardList` / `renderHomeBoards` — filter hidden |
| Hot boards | `renderHotBoards` — filter by `boardSlug` / slug |
| Popular threads | `renderPopularThreads` — skip threads with hidden `boardSlug` |
| Latest posts | `renderLatestPosts` — skip posts with hidden `boardSlug` |

Optional empty-state when every public board is hidden (home table / nav): short Vietnamese muted message pointing to account settings, e.g. “Không có bảng hiển thị. Bỏ ẩn trong Cài đặt tài khoản.”

### Surfaces that must **not** filter

- Direct `#board/:slug`, `#catalog/:slug`, `#archive/:slug`, `#thread/:id`
- “Bảng đang theo dõi” (`renderSubscribedBoards`)
- Account settings checkbox lists (must list all public boards so user can unhide)
- Admin board filters and moderation UI
- Public feeds under `/feeds/…`
- Search, watchlist, my posts, DMs, content filters

### Account settings UI

In `frontend/index-partials/account.html` (near board subscriptions):

- Container `#accountHiddenBoards` (class reuses `account-board-subscriptions` layout)
- Label: **Ẩn bảng khỏi trang chủ / thanh điều hướng**
- Help: **Bảng đã ẩn vẫn mở được bằng link trực tiếp. Theo dõi và email không bị ảnh hưởng.**
- Checkboxes generated like subscriptions (`data-account-hidden-board`, value = slug)
- Checked = board is hidden

### Board page UI

In `frontend/index-partials/board.html` (top and bottom chrome, next to theo dõi):

```html
[<button class="link-button" data-toggle-board-hidden type="button">Ẩn bảng</button>]
```

- Label when not hidden: **Ẩn bảng**
- Label when hidden: **Hiện bảng**
- `syncBoardHiddenButtons()` mirrors `syncBoardSubscriptionButtons()`
- Event binding in `board-events.ts` (or home controller) via `data-toggle-board-hidden`
- i18n strings added in `frontend/src/i18n.ts` for EN mirror

### Shared helpers (suggested)

```ts
// storage / home helpers
hiddenBoardSlugs(): Set<string>
writeHiddenBoardSlugs(slugs: string[]): string[]
isBoardHidden(slug: string): boolean
visibleBoards(boards: Board[]): Board[]  // boards.filter(b => !isBoardHidden(b.slug))
```

Prefer one place for discovery filtering so nav/home/hot/popular/latest stay consistent.

## Edge cases

| Case | Behavior |
|------|----------|
| `hiddenBoards: []` | Show all boards |
| All boards hidden | Empty discovery lists + short empty-state copy |
| Board removed later | Slug dropped on next normalize |
| New board created | Visible by default |
| `homeBoard` is hidden | Setting still valid; discovery simply omits it |
| Viewing a hidden board via URL | Page works; toggle shows **Hiện bảng**; nav has no link |
| Guest clicks Ẩn | Toast to log in; no local hide list applied to UI |
| Settings save with both lists | Both persist independently |

## Testing

### Backend

- `normalizeAccountSettings` / settings update:
  - accepts valid slugs
  - drops unknown / archived / duplicates
  - defaults missing field to `[]`
  - round-trip on account settings HTTP test

### Frontend

- `visibleBoards` / `isBoardHidden` unit coverage if a small test harness exists; otherwise cover via existing frontend test patterns
- Settings form collects and applies `hiddenBoards`
- Popular/latest omit hidden board items
- Board toggle updates labels and local set

### Validation commands

- `npm test` (backend account + http settings tests)
- `npm run check` / typecheck as affected
- Manual: login → hide two boards → confirm nav/home/hot/popular/latest → open hidden board by URL → unhide from button and settings

## Implementation sketch (for planning)

Likely touch list (minimal):

**Backend**

- `backend/src/core/forum-service.ts` — default + normalize `hiddenBoards`
- `backend/test/account.test.ts`, `backend/test/http.test.ts` — extend settings cases

**Frontend**

- `frontend/src/constants.ts` — local storage key
- `frontend/src/storage.ts` — read/write hidden slugs
- `frontend/src/account-preferences.ts` — sync options, apply/persist
- `frontend/src/account-form-events.ts` — save payload
- `frontend/src/account-screen.ts` / account HTML partial — UI block
- `frontend/src/dom.ts` — element refs
- `frontend/src/home.ts` — `visibleBoards` in nav/home; hide toggle helpers
- Popular/latest/hot renderers (home-related modules)
- `frontend/src/board-events.ts` + `board.html` — toggle button
- `frontend/src/i18n.ts` — VI/EN strings

## Risks

- **Inconsistent filtering:** a discovery surface missed → user still sees “hidden” content. Mitigate with a single `visibleBoards` / `isBoardHidden` helper and a checklist of five surfaces.
- **Confusion with follow:** clear Vietnamese help text that hide ≠ unfollow.
- **Empty home:** if user hides everything, empty-state must explain how to recover.

## Success criteria

1. Account can hide e.g. all boards except two they care about in discovery.
2. Hidden boards still open via direct URL.
3. Subscriptions / “đang theo dõi” / board subscription emails unchanged by hide alone.
4. Settings survive logout/login for the same account.
5. On-board Ẩn/Hiện and settings checkboxes stay in sync after save/reload.
