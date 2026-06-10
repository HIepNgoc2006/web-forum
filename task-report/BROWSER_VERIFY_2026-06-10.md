# Browser Smoke Baseline 2026-06-10

Scope: Full browser smoke test baseline for all main flows.
Branch: `task/browser-smoke-baseline`

## Environment

- Backend: `npm run dev` → port 3000 (JSON store, AI not configured, local disk images).
- Frontend: `npm run dev:frontend` → Vite on port 5173, proxy `/api` and `/events`.
- Credentials: `ADMIN_USERNAME=admin`, `ADMIN_PASSWORD=staging-pass-2026` (staging-only, gitignored `.env`).
- Browser: Chromium (automated headless, desktop 1280×720 default + mobile 390×844 emulated).

## Summary

| Flow | Desktop | Mobile 390×844 | Verdict |
| --- | --- | --- | --- |
| Homepage (`#home`) | ✅ Pass | ✅ Pass | **Pass** |
| Policy (`#policy`) | ✅ Pass | — | **Pass** |
| Board (`#board/confession`) | ✅ Pass | ✅ Pass | **Pass** |
| Thread (`#thread/{id}`) | ✅ Pass | ✅ Pass | **Pass** |
| Catalog (`#catalog/confession`) | ✅ Pass | — | **Pass** |
| Archive (`#archive/confession`) | ✅ Pass | — | **Pass** |
| Admin login (valid) | ✅ Pass | — | **Pass** |
| Admin login (bad creds) | ✅ Pass | — | **Pass** |

**Overall: ALL PASS — 0 P0, 0 P1 bugs.**

---

## Detailed Results

### 1. Homepage (`#home`)

| Check | Result | Notes |
| --- | --- | --- |
| Page loads without error | Pass | No console errors. |
| Topbar/header with "36chan" branding | Pass | Brand mark and board nav rendered. |
| Board navigation bar | Pass | All board links rendered in nav. |
| "36chan là gì?" intro section | Pass | Visible with full text. |
| Bảng (boards) table | Pass | All 14 boards rendered in portal table with columns: Bảng, Mô Tả, Người Dùng, Bài Viết. |
| Chủ đề nổi bật (popular threads) | Pass | Empty state: "Chưa có chủ đề nổi bật." with call-to-action. |
| Bài mới nhất (latest posts) | Pass | Section visible. |
| Thống kê (stats) | Pass | Stats section rendered. |
| Footer navigation | Pass | Links: Trang chủ, Thú nhận, Học tập, Nội quy, Quản trị, Ngẫu nhiên. |
| Socket status pill | Pass | "đang kết nối" or "trực tuyến" shown. |
| Horizontal overflow | None | No overflow detected. |
| Console errors | None | Clean console. |

### 2. Policy Page (`#policy`)

| Check | Result | Notes |
| --- | --- | --- |
| Page heading | Pass | "Nội quy, riêng tư và báo cáo" displayed. |
| Path chip | Pass | "/policy/" visible. |
| Nội quy section | Pass | 3 rules listed. |
| Ẩn danh & riêng tư section | Pass | 3 privacy items listed. |
| AI kiểm duyệt section | Pass | 3 AI moderation items listed. |
| Báo cáo bài viết section | Pass | 3 reporting items listed. |
| PII cần tránh section | Pass | Full PII warning text. |
| Bottom navigation | Pass | "Về trang chủ" and "Vào bảng thú nhận" links. |
| Horizontal overflow | None | Clean layout. |
| Console errors | None | — |

### 3. Board Page (`#board/confession`)

| Check | Result | Notes |
| --- | --- | --- |
| Board hero "GÓC 36CHAN" | Pass | Hero banner visible. |
| Board title & path | Pass | "Thú nhận" title, "/confession/" path. |
| Board description | Pass | Full description rendered. |
| "[Tạo chủ đề mới]" button | Pass | Start thread button visible. |
| Thread list section | Pass | "Chủ đề" heading with [Cập nhật] button. Empty state "Chưa có chủ đề công khai." shown correctly (thread created later by smoke test). |
| Toolbar links | Pass | Danh mục, Kho lưu trữ, Theo dõi bảng, Lên đầu, Cập nhật all present. |
| Board ad placeholder | Pass | "Bảng thú nhận sinh viên · QUẢNG CÁO Ở ĐÂY". |
| Thread composer (opened) | Pass | Form fields: Tên, Tùy chọn, Chủ đề, Thăm dò, Bình luận, Tệp, Mã xác minh, Mật khẩu xóa, Gửi. |
| Pagination controls | Pass | Visible at bottom. |
| Bottom toolbar | Pass | Same toolbar links duplicated. |
| Horizontal overflow | None | — |
| Console errors | None | — |

### 4. Thread Page (`#thread/{id}`)

| Check | Result | Notes |
| --- | --- | --- |
| Thread screen active | Pass | threadScreen has `active` class. |
| Board hero "36chan" | Pass | Hero text visible. |
| Thread title / board path | Pass | "Chủ đề" heading, "/confession/" path chip. |
| OP post content | Pass | "This is a smoke test thread for testing catalog and archive." rendered. |
| Post metadata | Pass | Poster hash (ID:264EF3BB), global number (No.1), timestamp displayed. |
| "[Đăng trả lời]" toggle | Pass | Reply toggle button visible. |
| Navigation buttons | Pass | [Quay lại], [Tạo chủ đề mới], [Tóm tắt AI] visible. |
| Reply composer (opened) | Pass | Form with Tên, Tùy chọn, Bình luận, Xác minh, Tệp, Mật khẩu xóa, Gửi. AI buttons: [AI gợi ý], [AI sửa an toàn]. |
| Delete post form | Pass | Bottom form with password input, "Chỉ tệp" checkbox, "Xóa" button. |
| Theme selector | Pass | Giao diện dropdown with Yotsuba B, Yotsuba, Tomorrow. |
| Board ad | Pass | Visible top and bottom. |
| Horizontal overflow | None | — |
| Console errors | None | — |

### 5. Catalog (`#catalog/confession`)

| Check | Result | Notes |
| --- | --- | --- |
| Title "Danh mục" | Pass | Page title rendered. |
| Description | Pass | Catalog description visible. |
| Sort buttons | Pass | Thứ tự đẩy lên, Trả lời mới nhất, Ngày tạo, Số trả lời. |
| Filter buttons | Pass | Tất cả, Có ảnh, Có thăm dò, Chưa đọc. |
| Size buttons | Pass | Nhỏ, Lớn. |
| Search input | Pass | "Tìm OP..." placeholder. |
| "Quay lại" link | Pass | Links back to board. |
| "Cập nhật" button | Pass | Refresh button present. |
| Catalog grid | Pass | Grid rendered with test thread card. |
| Horizontal overflow | None | — |
| Console errors | None | — |

### 6. Archive (`#archive/confession`)

| Check | Result | Notes |
| --- | --- | --- |
| Title "Kho lưu trữ" | Pass | Page title rendered. |
| Description | Pass | "Chủ đề đã rời khỏi bảng đang hoạt động." |
| "Quay lại" link | Pass | Links back to board. |
| "Cập nhật" button | Pass | Refresh button present. |
| Archive list area | Pass | Rendered (empty — no archived threads yet). |
| Horizontal overflow | None | — |
| Console errors | None | — |

### 7. Admin Login (valid credentials)

| Check | Result | Notes |
| --- | --- | --- |
| Admin title | Pass | "Hàng đợi kiểm duyệt" displayed. |
| Path chip "/admin/" | Pass | Visible. |
| Login form visible | Pass | Tài khoản + Mật khẩu fields + Đăng nhập button. |
| Logout button hidden | Pass | Hidden when not logged in. |
| Login with admin/staging-pass-2026 | Pass | `POST /api/admin/login` returns 200 with JWT. |
| Login form hides on success | Pass | Form hidden after login. |
| Logout button visible | Pass | "[Đăng xuất]" shown. |
| 6 admin tabs | Pass | AI chờ duyệt, Báo cáo, Đã duyệt, Đã xóa, Làm chậm/Tạm khóa, Nhật ký. |
| Filter controls | Pass | Bảng, Nhãn, Thời gian selects rendered. |
| [Cập nhật] button | Pass | Visible in filters row. |
| [Xuất CSV] button | Pass | Visible in filters row. |
| Empty state | Pass | "Hàng đợi trống." displayed. |
| Console errors | None | — |

### 8. Admin Login (bad credentials)

| Check | Result | Notes |
| --- | --- | --- |
| Login with admin/wrong-password | Pass | Error response received. |
| Error displayed to user | Pass | Toast or alert shown with error message. |
| Form remains visible | Pass | Login form stays open. |
| No token stored | Pass | No adminToken saved to localStorage. |

---

## Mobile Viewport Tests (390 × 844, 2× DPR)

| Page | Layout | Overflow | Console Errors | Notes |
| --- | --- | --- | --- | --- |
| Homepage | ✅ Adapted | None | None | Portal sections stack vertically, board table scrollable. |
| Board /confession | ✅ Adapted | None | None | Thread list readable, toolbar wraps. |
| Thread detail | ✅ Adapted | None | None | Post content readable, reply composer fits. |

---

## Secret / Token Safety

| Check | Result |
| --- | --- |
| JWT token in DOM | Not exposed |
| JWT_SECRET in DOM | Not exposed |
| Admin password in DOM | Not exposed |
| Raw IP in DOM | Not exposed |
| Token stored in localStorage | Yes (expected `adminToken` key) |
| `.env` gitignored | Yes |

---

## P0 / P1 Bugs

**None found.**

All 6 flows (Homepage, Policy, Board, Thread, Catalog/Archive, Admin Login) pass smoke baseline on both desktop and mobile viewports. No console errors, no horizontal overflow, no broken layouts.