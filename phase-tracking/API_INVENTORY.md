# 36chan API Inventory

Date: 2026-07-17

Base path: same origin backend. Development frontend proxies `/api`, `/events`, and `/uploads`.

Versioning: `/api/v1/...` is supported as an alias for current `/api/...` routes. Existing `/api/...` clients remain compatible.

## Response shape

Success:

```json
{ "data": {} }
```

Error:

```json
{ "error": { "message": "Thong diep loi" } }
```

HTTP 500 masks internal message as `Lỗi máy chủ nội bộ`.

## Public config and discovery

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| GET | `/api/config` | Lay boards, board groups, lifecycle, hCaptcha site key, max image bytes. | Public, khong can auth. Board items include sanitized `rules`, `banner`, and effective `retentionPolicy` fields for public display; missing rules fall back to board `description`. |
| GET | `/api/home` | Lay payload khoi dong trang chu trong mot lan doc state. | Public, khong auth. Tra `config`, boards public, `boardPostCounts`, popular threads, latest posts, hot boards, campus pulse va stats; cung payload duoc embed an toan vao initial `index.html` khi backend serve production build. |
| GET | `/api/site-content` | Lay copy public cua trang `/policy/` (title, subtitle, rules/privacy/ai/report/feedback/contact lists, appeal intro, PII text). | Public, khong can auth. Doc tu `adminSettings.siteContent` (owner editable); fallback default sanitized. |
| GET | `/api/stickers` | Lay catalog sticker Imgur tuy chinh. | Public, khong auth. Tra `key`, `label`, URL HTTPS `i.imgur.com`, `active`, `createdAt`; entry da an van duoc tra de bai cu voi token `[sticker:custom-...]` tiep tuc render, nhung khong xuat hien trong picker. Trinh duyet tai anh truc tiep tu Imgur voi `referrerpolicy=no-referrer`. |
| GET | `/api/boards` | Lay danh sach board public. | Source tu state store; excludes hidden/archived boards. Board items include effective `retentionPolicy`. |
| GET | `/api/stats` | Lay thong ke server. | Includes post/file counts va current SSE clients. |
| GET | `/api/health` | Health check van hanh. | Tra `status`, `store.type`, `store.configured`, `store.ready`, safe counts/model readiness, AI configured/model, image storage readiness, Resend email configured/readiness, realtime client count/board counts, security readiness warnings; khong tra secret. |
| POST | `/api/ai/chat` | Hoi dap AI ve trang hien tai, board hoac thread. | Public, khong auth. Body `{ question, scope: "site"|"board"|"thread", page?, boardSlug?, threadId?, history?, posterToken? }`; `question` toi da 1000 ky tu. Server tu lay va gioi han context public, redact email/phone/student ID, khong nhan raw DOM/context tu client, khong gui IP/token/private/admin data cho provider. Tra `{ answer, context: { scope, label } }`. Dung Google hoac OpenAI-compatible provider da cau hinh; rate limit 8/phut/IP, 30 luot/ngay theo identity va them tran 120 luot/ngay/IP. |
| GET | `/api/media/gifs/trending?page=&perPage=` | Lay GIF KLIPY dang thinh hanh. | Public, khong auth. Backend giu `KLIPY_API_KEY` server-only, ep content filter cao, loai ad/non-GIF va chi tra URL media HTTPS tu CDN KLIPY duoc allowlist. |
| GET | `/api/media/gifs/search?q=&page=&perPage=` | Tim GIF KLIPY. | Public, khong auth; query va page size duoc validate, rate limit theo IP. Tra item chuan hoa `slug`, `title`, `preview`, `full`; khong tra API key/provider payload raw. |
| GET | `/api/media/gifs/items?slugs=a,b` | Khoi phuc GIF da luu theo KLIPY slug. | Public, khong auth; toi da 50 slug/request. Dung de hydrate token `[gif:klipy:slug]` khi render bai cu. |
| POST | `/api/media/gifs/:slug/share` | Gui share trigger cho KLIPY sau khi user chen GIF. | Public, khong auth; body optional `{ query }`. Khong gui account ID, poster token, fingerprint hay raw IP lam customer identifier. |
| GET | `/api/posts/latest?limit=10` | Lay bai moi nhat. | Limit clamp 1-20. Chi public active thread/comment. |
| GET | `/api/boards/hot?limit=8` | Lay bang dang nong trong 24h. | Limit clamp 1-board count. Chi tinh active public threads/comments. |
| GET | `/feeds/latest.json?limit=20` | JSON Feed bai moi nhat. | Public feed, khong auth, chi gom public active thread/comment. |
| GET | `/feeds/latest.rss?limit=20` | RSS 2.0 bai moi nhat. | Public feed, escape XML, chi gom public active thread/comment. |
| GET | `/feeds/hot-boards.json?limit=8` | JSON Feed bang dang nong. | Public feed, khong auth, chi gom board public co active public thread/comment trong 24h. |
| GET | `/feeds/hot-boards.rss?limit=8` | RSS 2.0 bang dang nong. | Public feed, escape XML, chi gom board public co active public thread/comment trong 24h. |

## Public board and thread

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| GET | `/api/boards/:boardSlug/threads?page=&pageSize=&q=&sort=&filter=` | Lay active public threads cua board. | Sticky threads sort truoc thread thuong. `sort=bump` default theo `bumpedAt` desc; `sort=created` theo OP moi nhat; `sort=replies` theo so reply public. `filter=all\|media\|video\|poll\|unanswered` loc truoc pagination. Khong tra pending/deleted/archived. Neu co query paging/search/sort/filter thi tra `{ items, page, pageSize, total, totalPages, hasMore }`; neu khong co query thi tra array cu de tuong thich. |
| GET | `/feeds/boards/:boardSlug/threads.json?limit=20` | JSON Feed active public threads cua board. | Public feed, limit clamp 1-50, returns 404 when board hidden or missing. |
| GET | `/feeds/boards/:boardSlug/threads.rss?limit=20` | RSS 2.0 active public threads cua board. | Public feed, escape XML, limit clamp 1-50, returns 404 when board hidden or missing. |
| POST | `/api/boards/:boardSlug/threads` | Tao thread moi. | Body: `body`, optional `displayName`, `image` + `image.thumbnail`, `pollOptions`, `options`, `deletePassword`, `captchaToken`, `posterToken`. `displayName` bo trong/mac dinh hien `Anonymous`; sanitize, gioi han 40 ky tu, chan reserved authority labels; khong phai account username tru khi user explicit chon gui username lam display name. `options` ho tro `noko`. Rate limited. |
| GET | `/api/boards/:boardSlug/archive` | Lay archived public threads. | Sort `archivedAt` desc. Returns 404 when board is hidden or `retentionPolicy.publicArchive` is false. |
| GET | `/feeds/boards/:boardSlug/archive.json?limit=20` | JSON Feed archived public threads cua board. | Public feed, limit clamp 1-50, returns 404 when board hidden or `retentionPolicy.publicArchive` is false. |
| GET | `/feeds/boards/:boardSlug/archive.rss?limit=20` | RSS 2.0 archived public threads cua board. | Public feed, escape XML, returns 404 when board hidden or `retentionPolicy.publicArchive` is false. |
| POST | `/api/boards/:boardSlug/summary` | AI tom tat board. | Chi dung public content. Can Google hoac OpenAI-compatible provider da cau hinh. Dung AI rate limiter va daily budget. |
| GET | `/api/threads/:threadId?commentsPage=&commentsPageSize=&focusGlobalNumber=` | Lay thread detail. | Tra OP public va comments public. Neu co query paging thi comments duoc phan trang va tra `commentPage`; `focusGlobalNumber` tu dong chon trang chua post permalink. Tra them `threadNavigation.previous/next` cho thread cong khai dang hoat dong lien ke tren cung board. |
| GET | `/feeds/threads/:threadId/posts.json?limit=20` | JSON Feed bai public trong thread. | Public feed, sap xep bai moi nhat truoc, limit clamp 1-50, chi tra OP/comment public cua thread truy cap duoc. |
| GET | `/feeds/threads/:threadId/posts.rss?limit=20` | RSS 2.0 bai public trong thread. | Public feed, escape XML, sap xep bai moi nhat truoc, limit clamp 1-50, chi tra OP/comment public cua thread truy cap duoc. |
| POST | `/api/threads/:threadId/comments` | Tao comment. | Body: `body`, optional `displayName`, `options`, `deletePassword`, `captchaToken`, `posterToken`. `displayName` bo trong/mac dinh hien `Anonymous`; sanitize, gioi han 40 ky tu, chan reserved authority labels; khong phai account username tru khi user explicit chon gui username lam display name. `options=sage` se reply khong bump thread. Rate limited. |
| POST | `/api/threads/:threadId/poll` | Vote tham do an danh. | Body `{ optionId, posterToken }`. Moi moderation fingerprint chi vote mot lan; khong tra voter map. Tra 400 neu option sai, 404 neu thread/poll khong con public, va 409 neu da vote hoac thread da khoa. Rate limited. |
| POST | `/api/threads/:threadId/summary` | AI tom tat thread. | Chi dung public content. Can Google hoac OpenAI-compatible provider da cau hinh. |
| POST | `/api/threads/:threadId/suggestions` | AI goi y comment. | Khong luu suggestion neu user chua submit. Can Google hoac OpenAI-compatible provider da cau hinh. |
| GET | `/api/posts/:globalNumber` | Lookup post by global number. | Dung cho `>>ID` preview/permalink. Chi tra public post. |
| PUT | `/api/posts/:globalNumber` | Account owner sua bai da dang. | Bearer JWT account bat buoc; chi sua bai co `accountId` trung voi token; body `{ "body": "", "images": [] }`; bo qua `images` de giu tep cu, gui `images: []` de xoa tep; luu `editHistory` admin-only va public `editedAt`. |
| POST | `/api/posts/:globalNumber` | Bao cao bai viet. | Body `{ "category": "Spam\|Toxic\|PII\|Fake News\|Illegal\|Other", "reason": "", "posterToken": "" }`; `category` khong hop le fallback `Other`; luu reporter hash, khong luu IP raw. |
| DELETE | `/api/posts/:globalNumber` | Account owner tu xoa bai/tap tin. | Bearer JWT account bat buoc; chi xoa bai co `accountId` trung voi token; body `{ "fileOnly": false }`; khong dung mat khau xoa. Admin xoa qua `/api/admin/posts/:globalNumber`. |
| POST | `/api/appeals` | Gui khang nghi an danh cho bai da bi admin xoa. | Body `{ "token": "", "reason": "", "posterToken": "" }`; token duoc cap khi dang bai va khong tra lai public/admin; chi chap nhan sau khi bai da bi xoa; luu reporter hash, khong luu IP raw. |

## Public uploaded files

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| GET/HEAD | `/uploads/:fileName` | Serve image files saved by local disk storage. | File name only, path traversal blocked, cache immutable. Not used when `IMAGE_STORAGE_DRIVER=s3` returns absolute public URLs. |

## Account

Account is optional and private. These endpoints require `JWT_SECRET` for issuing/verifying user JWTs. Account, admin, and temporary 2FA JWTs include the persisted user `authEpoch`; protected requests reject tokens whose epoch no longer matches live account state. Account identity is not attached to public thread/comment create payloads.

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| POST | `/api/account/register` | Tao account user optional. Body `{ "username": "", "password": "", "email": "" }`; username/email normalized lower-case, password hashed server-side. Account dung duoc ngay; neu co email thi gui OTP 6 so. | Public endpoint, returns `{ account, recoveryCode, verificationEmailSent, token }`; `account.emailVerified=false` cho den khi confirm. |
| POST | `/api/account/login` | Dang nhap account user optional. Body `{ "username": "", "password": "" }`. | Public endpoint, returns `{ account, token }`. |
| POST | `/api/account/forgot-password` | Dat lai password bang recovery code mot lan va rotate sang recovery code moi. | Public endpoint; body `{ username, recoveryCode, newPassword, captchaToken }`. |
| POST | `/api/account/password-reset/email/request` | Gui OTP dat lai password toi email da verify. | Public, response generic `{ ok, expiresInSeconds: 900 }` de giam account enumeration; body `{ identifier, captchaToken }`. |
| POST | `/api/account/password-reset/email/confirm` | Dat lai password bang OTP email va rotate recovery code. | Public; body `{ identifier, code, newPassword }`; OTP 6 so het han 15 phut, toi da 5 lan sai; request step da duoc captcha-protect. |
| POST | `/api/account/recovery-code/email/request` | Gui OTP de tao lai recovery code. | Public, response generic; body `{ identifier, captchaToken }`. |
| POST | `/api/account/recovery-code/email/confirm` | Tao recovery code moi bang OTP email. | Public; body `{ identifier, code }`; chi tra code moi mot lan; request step da duoc captcha-protect. |
| POST | `/api/account/logout` | Thu hoi session bang cach rotate persisted `authEpoch`. | Bearer JWT role `user`; returns `{ ok: true }`; tat ca JWT cu cua account bi tu choi ke ca sau khi server restart. |
| GET | `/api/account/me` | Lay account private hien tai. | Bearer JWT role `user`. |
| POST | `/api/account/email/verify` | Xac nhan email hien tai bang OTP. | Bearer JWT; body `{ code }`; challenge het han sau 15 phut va toi da 5 lan sai. |
| POST | `/api/account/email/resend` | Gui OTP verify moi, vo hieu ma cu. | Bearer JWT; cooldown 60 giay; returns account + delivery status. |
| POST | `/api/account/email/change` | Gui OTP toi email moi sau khi verify password hien tai. | Bearer JWT; body `{ newEmail, password }`; email cu van active cho den khi confirm. |
| POST | `/api/account/email/change/confirm` | Chuyen sang email moi va danh dau verified. | Bearer JWT; body `{ code }`. |
| PUT | `/api/account/settings` | Luu account-private settings: `theme`, `homeBoard`, `syncDrafts`, legacy `emailNotifications`, `displayPreferences` (gom `commentComposerMode=floating|normal`), `notificationPreferences` (`email`, `watchedThreads`, `boardSubscriptions`, `browserWatchedThreads`), va `boardSubscriptions`. | Bearer JWT role `user`. |
| POST | `/api/account/recovery-code` | Tao recovery code moi bang password hien tai. | Bearer JWT; body `{ password }`; code cu bi vo hieu; rotates `authEpoch`; returns `{ ok, recoveryCode, account, token }` voi replacement token. |
| GET | `/api/account/private-data` | Lay account-private sync bag: `watchlist`, `drafts`, `savedSearches`, `contentFilters`, `replyTemplates`, `posterNotes`, `hiddenPosts`, `hiddenThreads`. | Bearer JWT role `user`; khong expose qua public post serializers. |
| PUT | `/api/account/private-data` | Luu account-private `{ watchlist, drafts, savedSearches, contentFilters, replyTemplates, posterNotes, hiddenPosts, hiddenThreads }` de dong bo giua thiet bi. | Bearer JWT role `user`; server normalize/gioi han so luong, draft/template body, preview/search text, va id lists (`hiddenPosts` max 500, `hiddenThreads` max 200). |
| DELETE | `/api/account/private-data?section=` | Xoa account-private data; `section` co the la `watchlist`, `drafts`, `savedSearches`, `contentFilters`, `replyTemplates`, `posterNotes`, `hiddenPosts`, `hiddenThreads`, hoac bo trong de xoa tat ca. | Bearer JWT role `user`; dung cho clear controls. |
| POST | `/api/auth/2fa/totp-login` | Xac thuc TOTP sau password login. | Public endpoint; body `{ tempToken, code }`; returns fully verified account/admin JWT. `/api/auth/2fa/verify` remains a compatibility alias. |
| POST | `/api/auth/2fa/backup-login` | Xac thuc bang ma du phong sau password login. | Public endpoint; body `{ tempToken, code }`; burns backup code on success and returns fully verified account/admin JWT. |
| POST | `/api/account/2fa/setup` | Tao TOTP setup secret, QR data, va backup codes. | Bearer JWT; chua enable 2FA cho den khi verify code. |
| POST | `/api/account/2fa/verify` | Verify setup code va enable TOTP 2FA. | Bearer JWT; rotates `authEpoch`; returns current `account` va replacement fully verified `token`. |
| POST | `/api/account/2fa/disable` | Tat TOTP 2FA bang password hien tai. | Bearer JWT; rotates `authEpoch`; returns current `account` va replacement `token`. |
| GET | `/api/account/passkeys` | List passkey metadata private cua account. | Bearer JWT; khong expose credential metadata qua public API. |
| POST | `/api/account/passkeys/register-options` | Tao WebAuthn registration challenge. | Bearer JWT; challenge single-use, het han sau 5 phut. |
| POST | `/api/account/passkeys/register-verify` | Verify va luu passkey moi. | Bearer JWT; rejects duplicate credential; consumes challenge on every verify attempt; rotates `authEpoch`; returns current `account` va replacement fully verified `token`. |
| DELETE | `/api/account/passkeys/:id` | Xoa passkey cua account. | Bearer JWT; rotates `authEpoch`; returns current `account` va replacement `token`. |
| POST | `/api/auth/webauthn/login-options` | Tao WebAuthn login challenge theo username. | Public; known/unknown username deu tra HTTP 200 voi response shape tuong duong va `allowCredentials: []`; persisted challenge single-use, het han sau 5 phut cho account ton tai. |
| POST | `/api/auth/webauthn/login-verify` | Verify passkey login response. | Public; consumes challenge on every verify attempt; returns `{ account, token }` voi fully verified JWT khi thanh cong. |

## Admin

Admin auth uses privileged account roles. `owner` can view/moderate/manage boards/manage moderation settings/manage privileged users; legacy stored `admin` roles are normalized to `owner`. `moderator` can view admin queues and run moderation actions. `viewer` can view admin queues, logs, health, analytics, boards, reports, and sanctions but cannot mutate them. Disabled privileged accounts are rejected by live permission checks even if an old JWT still exists. Admin JWTs still require 2FA setup/verification outside test mode.

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| POST | `/api/admin/login` | Dang nhap admin env, nhan JWT owner. | Public endpoint, can env `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`; creates/refreshes env admin as active `owner` for migration compatibility. |
| GET | `/api/admin/users` | List privileged users. | Bearer JWT with `admin:manage_users` permission (`owner`). Returns id/username/role/disabled/2FA/recovery timestamps only; no password hash, private data, or passkeys. |
| POST | `/api/admin/users` | Create privileged user. | `owner`; body `{ "username": "", "password": "", "role": "owner|moderator|viewer", "disabled": false }`. |
| PUT | `/api/admin/users/:id` | Update privileged user role/status/password. | `owner`; body may include `{ "role": "owner|moderator|viewer", "disabled": true, "password": "" }`; cannot disable/demote self or the last active owner. |
| DELETE | `/api/admin/users/:id` | Disable privileged user. | `owner`; same last-owner/self protections as update. |
| GET | `/api/admin/boards` | List all boards for admin editing. | Permission `admin:view`; returns hidden/archived flags, presentation fields `rules`/`banner`, event board fields `temporary`/`eventEndsAt`, and effective `retentionPolicy`. |
| POST | `/api/admin/boards` | Create dynamic board. | Permission `admin:manage_boards` (`owner`); body includes `slug`, `name`, `category`, `description`, optional `rules`, optional `banner.text`/`banner.imageUrl`/`banner.altText`, optional flags, optional `temporary` + ISO/datetime `eventEndsAt`, optional `retentionPolicy`. Temporary boards require `eventEndsAt`. Banner image URLs must be relative `/...` or HTTPS to render publicly. |
| PUT | `/api/admin/boards/:boardSlug` | Update board config. | Permission `admin:manage_boards` (`owner`); body may include text fields, `rules`, `banner`, flags, `temporary` + `eventEndsAt`, and partial `retentionPolicy`. Setting `temporary=false` clears `eventEndsAt`. |
| DELETE | `/api/admin/boards/:boardSlug` | Delete empty board. | Permission `admin:manage_boards` (`owner`); boards with content/reports/sanctions must be hidden or archived instead. |
| GET | `/api/admin/pending?boardSlug=&label=&since=&priority=&confidence=&sort=` | Lay pending queue. | Permission `admin:view`; ho tro filter. `priority=high|medium|low`; `confidence` la nguong toi thieu 0..1 hoac 0..100; `sort=priority|newest|oldest|confidence-desc|confidence-asc`, default `priority`. Items include `moderationPriority` va `moderationConfidence` khi AI tra ve. |
| GET | `/api/admin/moderation-settings` | Lay cau hinh moderation admin. | Permission `admin:view`; tra ve `moderationConfidenceThreshold` hien hanh. |
| PUT | `/api/admin/moderation-settings` | Cap nhat cau hinh moderation admin. | Permission `admin:manage_settings` (`owner`); body `{ "moderationConfidenceThreshold": 0.8 }` hoac percent `80`; thieu confidence tren ket qua `Flagged` van vao queue. |
| GET | `/api/admin/site-content` | Lay noi dung `/policy/` de chinh trong admin. | Permission `admin:view`; cung shape public `SiteContent`. |
| PUT | `/api/admin/site-content` | Cap nhat copy trang `/policy/`. | Permission `admin:manage_settings` (`owner`); body partial `SiteContent` (`policyTitle`, `policySubtitle`, list fields as string[] or newline text, `appealIntro`, `pii`); strip HTML, gioi han do dai; luu trong `adminSettings.siteContent`. |
| GET | `/api/admin/stickers` | Lay catalog sticker tuy chinh trong admin. | Permission `admin:manage_settings` (`owner`). Catalog luu trong `adminSettings.customStickers`; JSON, Mongo, backup va JSON-to-Mongo migration deu bao toan field nay. |
| POST | `/api/admin/stickers` | Them sticker Imgur tuy chinh. | Permission `admin:manage_settings` (`owner`). Body `{ label?, url }`; chi chap nhan anh Imgur don le HTTPS, canonicalize sang `i.imgur.com`, chan SVG/album/gallery/host khac, de-duplicate URL, toi da 100 sticker. |
| PATCH | `/api/admin/stickers/:key` | An hoac hien lai sticker trong picker. | Permission `admin:manage_settings` (`owner`). Body `{ active: boolean }`; key server-generated `custom-<uuid>`. Soft hide giu lai render cho token trong bai cu. |
| GET | `/api/admin/moderation-actions?limit=50&boardSlug=&label=&since=&action=&confidence=` | Lay audit log moderation gan nhat. | Permission `admin:view`; co the loc theo `confidence` toi thieu; khong chua IP/captcha/poster token raw. |
| GET | `/api/admin/reports?limit=50&boardSlug=&since=&status=&category=&priority=&sort=` | Lay user reports gan nhat. | Permission `admin:view`; ho tro filter `category=Spam\|Toxic\|PII\|Fake News\|Illegal\|Other`, `priority=high|medium|low`; `sort=priority|newest|oldest`, default `priority`. Items include `moderationPriority`; reporter la hash, khong co IP raw. |
| GET | `/api/admin/deleted?limit=50&boardSlug=&label=&since=` | Lay bai da xoa. | Permission `admin:view`. |
| GET | `/api/admin/approved?limit=50&boardSlug=&label=&since=` | Lay lich su admin approve. | Permission `admin:view`. |
| GET | `/api/admin/sanctions?limit=50&status=active&kind=&boardSlug=` | Lay danh sach cooldown/ban. | Permission `admin:view`; chi tra fingerprint preview, khong tra IP raw. |
| GET | `/api/admin/posts/:globalNumber` | Lay chi tiet bai cho admin. | Permission `admin:view`; gom post, thread context, reports, actions, va `editHistory` admin-only voi before/after body + media. |
| PUT | `/api/admin/posts/:globalNumber` | Sua noi dung bai dang cua user. | Permission `admin:moderate`; body `{ "body": "", "reason": "" }`; luu audit `admin:edit` va entry `editHistory` gom before/after body + media; khong public `editedBy`/`editReason`/`editHistory`. |
| DELETE | `/api/admin/posts/:globalNumber` | Xoa bai hoac tep cua bai dang. | Permission `admin:moderate`; body `{ "reason": "", "fileOnly": false }`; khong can mat khau xoa cua user. |
| POST | `/api/admin/posts/:globalNumber/restore` | Khoi phuc bai da xoa. | Permission `admin:moderate`; body optional `{ "reason": "" }`; luu audit `admin:restore`; bai pending quay lai hang doi, bai public hien lai tren public API. |
| POST | `/api/admin/posts/:globalNumber/notes` | Them moderator note noi bo. | Permission `admin:moderate`; body `{ "note": "" }`. |
| POST | `/api/admin/posts/:globalNumber/sanctions` | Tao cooldown/ban tu bai viet. | Permission `admin:moderate`; body `{ "kind": "cooldown|ban", "durationMinutes": 60, "reason": "" }`. |
| DELETE | `/api/admin/sanctions/:id` | Go cooldown/ban dang hoat dong. | Permission `admin:moderate`; body optional `{ "reason": "" }`. |
| POST | `/api/admin/threads/:threadId/archive` | Archive thread public. | Permission `admin:moderate`. |
| POST | `/api/admin/threads/:threadId/sticky` | Ghim active public thread len dau board. | Permission `admin:moderate`; chi chap nhan thread public, khong pending/deleted/archived. |
| DELETE | `/api/admin/threads/:threadId/sticky` | Go ghim active public thread. | Permission `admin:moderate`; chi chap nhan thread public, khong pending/deleted/archived. |
| POST | `/api/admin/pending/bulk` | Bulk approve/delete pending posts. | Permission `admin:moderate`; body `{ "action": "approve|delete", "ids": [], "reason": "" }`. |
| POST | `/api/admin/pending/:id/approve` | Approve pending thread/comment. | Permission `admin:moderate`; body optional `{ "reason": "" }`. |
| DELETE | `/api/admin/pending/:id` | Delete pending thread/comment. | Permission `admin:moderate`; body optional `{ "reason": "" }`. |

## Realtime events

Endpoint: `GET /events?boardSlug=&threadId=`

Transport: Server-Sent Events.

| Event | Emitted when | Public safety rule |
| --- | --- | --- |
| `connected` | Client opens SSE connection. | Payload `{ "ok": true }`. |
| `thread:created` | Safe thread created or pending thread approved. | Only public serialized thread. |
| `comment:created` | Safe comment created or pending comment approved. | Only public serialized comment/thread. |
| `thread:bumped` | Public comment bumps active thread. | No pending/deleted payload. |
| `thread:updated` | Public thread metadata changes such as sticky or slow mode. | Only public serialized thread or null parent after safe update. |
| `thread:archived` | Thread archived by lifecycle/admin. | Only public archived thread. |

## Important data fields

- `globalNumber`: monotonically increasing global post number.
- `displayName`: optional public per-post label. Missing/empty values render as `Anonymous`; sanitized, length-limited to 40 characters, and rejected for reserved authority labels before public serialization. It is not account username or verified identity unless a logged-in user explicitly chooses to send their username as this per-post label. A `#` in the submitted value splits off a classic tripcode (see `tripcode`); the reserved-name and length rules apply to the name part only.
- `tripcode`: optional classic imageboard tripcode derived from the part of `displayName` after the first `#`. `name#secret` yields an insecure (deterministic, forgeable) tripcode `!xxxxxxxxxx`; `name##secret` yields a secure tripcode `!!xxxxxxxxxxx` salted with `TRIPCODE_SECRET` (falls back to `JWT_SECRET`). The raw secret never reaches storage or the public API; only the derived code is serialized.
- `image.spoiler`: boolean per-image spoiler flag. When true, board/catalog/thread views blur the thumbnail behind a reveal label until the viewer clicks it. Set from the post form's "Ẩn ảnh" checkbox; preserved across local/S3 storage.
- `capcode`: optional verified staff role badge (`admin` or `moderator`, otherwise `null`). Requested per-post via the form's "Capcode" checkbox (`capcode: true` in the create body); the server only honors it after resolving the requester's role from live account state in `getOptionalCapcode` — anonymous and regular `user` posters always serialize as `null`, and forged role strings are dropped by `normalizeCapcode`. Rendered as `## Quản trị viên` / `## Điều hành viên`.
- `posterHash`: hash of IP + daily salt + thread ID + poster token; raw IP is not exposed.
- `isPending`: quarantined by AI moderation.
- `isDeleted`: removed from public surface.
- `moderationStatus`: `Safe` or `Flagged`.
- `moderationLabels`: AI labels such as Toxic, Spam, Hate Speech, Fake News.
- `moderationPriority`: admin-only derived object on pending/report rows: `{ score, level, reportCount, hasPiiRisk }`. Score is derived from open report count, moderation/report labels, and recency; it does not persist or expose raw IP/poster token data.
- `bumpedAt`: sort key for active thread list.
- `isSticky`, `stickiedAt`: public active thread sticky state; sticky threads sort above normal threads on board/catalog views. Pending/deleted/archived threads serialize as not sticky.
- `isArchived`, `archivedAt`, `archivedReason`: lifecycle state.
- `image.storage`, `image.storageKey`, `image.url`: original image metadata after migration/upload storage.
- `image.thumbnail.storage`, `image.thumbnail.storageKey`, `image.thumbnail.url`: lightweight thumbnail metadata. Board/catalog/home thumbnails should use this URL; original `image.url` should load only when opening the file link or expanding the image.
- `authorFingerprint`: private server-side hash for cooldown/ban enforcement; never returned by public API.
- `backlinks`: public post numbers that reply/reference this post in the same thread. Same-thread `>>123` references count toward backlinks; cross-board `>>>/slug/123` references render as links but do not create backlinks.
- Post body markup (rendered client-side from the stored, escaped body): greentext (`>` line prefix), `>>123` quote links, `>>>/slug/` and `>>>/slug/123` cross-board links (slug validated against known boards), `[spoiler]...[/spoiler]` click-to-reveal inline text, trusted `[sticker:key]` catalog images, and `[gif:klipy:slug]` placeholders hydrated through the restore-by-slug endpoint. No private server fields are added; the raw body is stored and HTML-escaped as before.
- "(You)" own-post markers are client-side only (no server field): the frontend stamps `(You)` on posts whose `globalNumber` is in the local `myPosts` store and on `>>123` quotes pointing at them. The set is per-browser localStorage; the server never tracks post ownership.
- `options`, `sage`, `noko`: classic posting options; `sage` suppresses bump on replies, `noko` is honored by frontend redirect behavior.
- `deletePasswordHash`: stored private server-side only, never returned by public/admin serialization.

## Board config public display contract

Status: public board banner/rules display is implemented for fixed and dynamic/admin-managed boards.

- `/api/config` board items may include `rules: string[]`.
- `/api/config` board items include `banner: { text, imageUrl?, altText? }`.
- Public/admin board serializers include effective `retentionPolicy: { maxActiveThreadsPerBoard, bumpLimit, replyLimit, publicArchive }`.
- `retentionPolicy.maxActiveThreadsPerBoard` controls board-limit auto archive; `bumpLimit` controls when replies stop bumping; `replyLimit` controls max public replies; `publicArchive=false` hides `/api/boards/:boardSlug/archive`.
- Board rules/banner text is sanitized to plain text before public exposure and rendered with DOM text APIs on the frontend.
- Missing or empty `rules` falls back to the board `description`, plus default safety rules where available.
- `banner.imageUrl` is optional and only accepts same-origin absolute paths or HTTPS URLs; unsafe schemes are omitted.
- Public board/thread pages must not render board config text as raw HTML.

## Account/display-name contract

Status: per-post `displayName` is implemented for public thread/comment create endpoints. Account register/login/logout/me/settings, persisted session revocation, 2FA/passkeys, and verified-email recovery flows are implemented as private optional account features, including synced theme, display preferences, notification preferences, and board subscriptions. Account-private data via `/api/account/private-data` includes `watchlist`, `drafts`, `savedSearches`, `contentFilters`, `replyTemplates`, `posterNotes`, `hiddenPosts`, and `hiddenThreads`. Appeal history and per-device session inventory/management remain planned by `phase-tracking/ACCOUNT_UX_AND_ANONYMOUS_RULES.md`.

- Thread/comment create endpoints accept optional `displayName`.
- Missing or empty `displayName` must render as `Anonymous`.
- Reserved display names `admin`, `administrator`, `moderator`, `mod`, and `system` are rejected after sanitization.
- `displayName` is a public per-post label, not account username or verified identity.
- Public post serializers may include sanitized `displayName`.
- Public post serializers must never include `accountId`, `username`, `email`, session identifiers, linked local identity records, or admin/moderator role as author data.
- Account-private serializers may include `email`, `emailVerified`, `emailVerifiedAt`, `pendingEmail`, and verification expiry, but never OTP plaintext or challenge hashes.
- Logout and security-sensitive credential changes rotate persisted `authEpoch`; older account/admin/temp-2FA JWTs stay revoked across process restarts. Endpoints that preserve the active browser session return a replacement token.
- Email notifications require `emailVerified=true`, `notificationPreferences.email=true`, plus the matching watched-thread or board-subscription preference. Notification delivery is queued so posting does not fail when Resend is unavailable.
- Account-private convenience data uses `/api/account/private-data` with sections: `watchlist`, `drafts`, `savedSearches`, `contentFilters`, `replyTemplates`, `posterNotes`, `hiddenPosts`, `hiddenThreads`. Logged-out clients keep the same data in browser localStorage; login merges local ∪ server then persists. Hidden posts/threads are viewer-local UI filters only (not moderation delete). Future appeal history and security/session state must be added to this inventory when implemented.
- AI payload tests must confirm account identity fields and private-data sections are absent.

## Known gaps

- S3-compatible production image storage is implemented behind `IMAGE_STORAGE_DRIVER=s3`; production rollout still needs bucket/CDN credentials and backup policy from `phase-tracking/RELEASE_CHECKLIST.md`.
- Account-private private-data sections and durable session invalidation are implemented. Appeal history and per-device session inventory/revocation remain future work; product rules are defined in `phase-tracking/ACCOUNT_UX_AND_ANONYMOUS_RULES.md`.
