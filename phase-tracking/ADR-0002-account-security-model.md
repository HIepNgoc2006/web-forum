# ADR 0002 - Account, Passkey/WebAuthn, and TOTP 2FA Security Model

Date: 2026-06-16
Closes: https://github.com/36chan/36chan-web/issues/19

## Status

Accepted. Ready for implementation (Week 2-3).

## Context

36chan la imageboard an danh cho sinh vien Viet Nam. Account la optional layer, khong thay the anonymous posting mac dinh. Tuy nhien admin va moderator can bao mat cao hon de bao ve moderation flow va user data. Can thiet ke model bao mat bao gom:

- Account register/login voi password hash (Argon2id/bcrypt).
- Session cookie HTTP-only, khong dung JWT cho session (JWT chi cho admin legacy va account token).
- Passkey/WebAuthn cho passwordless login.
- TOTP 2FA theo RFC 6238 voi backup codes.
- Admin/moderator bat buoc bat 2FA truoc khi truy cap dashboard.
- Recovery flow cho admin/moderator mat 2FA.

## Decision

### 1. Account la optional, anonymous la mac dinh

- Public user doc/dang anonymous ma khong can tai khoan.
- Account dung de dong bo watchlist, settings, drafts, saved searches, notifications, appeals.
- Display name khi dang la tuy chon, mac dinh `Anonymous`.
- Account identity (username/email/role) tach rieng khoi public post identity (poster hash).

### 2. Session management bang HTTP-only cookie

- Cookie: `__Host-36chan-Session` voi flags `HttpOnly; Secure; SameSite=Strict; Path=/`.
- Session token la cryptographically secure random, hash SHA-256 truoc khi luu vao MongoDB.
- Max-age 14 ngay, TTL index tren `expiresAt` de auto-cleanup.
- Session co field `isTwoFactorVerified` de track 2FA challenge da hoan thanh chua.
- Logout xoa session document va clear cookie.
- Logout everywhere xoa tat ca session cua user.

### 3. Passkey/WebAuthn (passwordless)

- User them passkey tu account settings.
- Registration: server tao challenge, client goi authenticator (FaceID/Windows Hello/YubiKey), server verify attestation va luu credential ID + public key.
- Login: server tao authentication challenge, client sign, server verify signature va tao session.
- Fallback: neu browser khong ho tro WebAuthn, user dung password + TOTP.
- Khong luu private credential secret tren server.

### 4. TOTP 2FA va backup codes

- TOTP theo RFC 6238, HMAC-SHA1, 30s window, 6 digits.
- Secret la 32-character base32, encrypt tai rest bang AES-256-GCM voi server-side key.
- 10 backup codes (8-char hex), bcrypt-hash truoc khi luu.
- Setup flow: generate secret → QR code → user verify 1 code → enable.
- Backup code dung 1 lan, xoa khoi array sau khi verify.

### 5. Admin/moderator bat buoc 2FA

- Moi request den `/api/admin/*` phai qua middleware:
  1. Verify session token tu cookie.
  2. Fetch session + user document.
  3. Neu role la `admin` hoac `moderator`:
     - `twoFactorEnabled === false` → 403, redirect `/admin/setup-2fa`.
     - `isTwoFactorVerified === false` → 401, redirect `/admin/verify-2fa`.
- Login 2 buoc: Step 1 (password/passkey) → Step 2 (TOTP/backup code).
- User thuong khong bat buoc 2FA nhung khuyen khich.

### 6. Recovery flow

- Method 1: Backup codes — user nhap backup code thay TOTP, session duoc verify.
- Method 2: Admin reset — truoc production phai co runbook/script rieng de admin khac reset `twoFactorEnabled` ve `false` sau khi xac minh ngoai he thong. Khong document lenh CLI cu the cho den khi script do ton tai trong repo.

### 7. Privacy guards

- Account metadata (role, login history, 2FA settings) khong gui len AI API.
- Session token, IP, poster token khong gui len AI.
- Public post khong tu dong hien account username/email.

## Database Schema

### User model extensions

```javascript
{
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String },           // AES-256-GCM encrypted
  backupCodes: [{ type: String }],              // bcrypt-hashed
  credentials: [{                               // WebAuthn passkeys
    credentialID: { type: String, required: true },
    publicKey: { type: String, required: true }, // Base64url
    counter: { type: Number, default: 0 },
    transports: [{ type: String }]
  }]
}
```

### Session model

```javascript
{
  userId: ObjectId,
  sessionToken: String,    // SHA-256 hash of raw token
  ipAddress: String,
  userAgent: String,
  isTwoFactorVerified: { type: Boolean, default: false },
  expiresAt: Date          // TTL index
}
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/webauthn/register-options` | Session | Get passkey registration challenge |
| POST | `/api/auth/webauthn/register-verify` | Session | Verify passkey registration |
| POST | `/api/auth/webauthn/login-options` | Public | Get passkey login challenge |
| POST | `/api/auth/webauthn/login-verify` | Public | Verify passkey login, create session |
| POST | `/api/account/2fa/setup` | Session | Generate TOTP secret + QR + backup codes |
| POST | `/api/account/2fa/verify` | Session | Verify TOTP code, enable 2FA |
| POST | `/api/account/2fa/disable` | Session + TOTP | Disable 2FA |
| GET  | `/api/account/2fa/backup-codes` | Session + TOTP | Regenerate backup codes |
| POST | `/api/admin/verify-2fa` | Session | Verify 2FA for admin session |

## Rationale

- HTTP-only cookie session an toan hon JWT trong browser (khong bi XSS doc token).
- WebAuthn la standard W3C, ho tro rong tren modern browsers.
- TOTP la 2FA pho bien nhat, khong can SMS/email infrastructure.
- Backup codes la recovery fallback don gian nhat, khong can third-party service.
- Admin bat buoc 2FA de bao ve moderation flow — anonymous forum can moderation controls manh.

## Consequences

- Can them dependencies: WebAuthn server library, TOTP verification.
- Session store tang load MongoDB, can TTL index de cleanup.
- Admin UX phuc tap hon (2-step login), nhung bao mat tot hon.
- Neu user mat ca TOTP device va backup codes, can admin khac reset.

## References

- `phase-tracking/ACCOUNT_UX_AND_ANONYMOUS_RULES.md` — UX rules cho account vs anonymous.
- `phase-tracking/GITHUB_5_WEEK_DELIVERY_PLAN_2026-06-04.md` — account/auth product rule and Week 2-3 security scope.
- `phase-tracking/API_INVENTORY.md` — account and admin API tracking.
