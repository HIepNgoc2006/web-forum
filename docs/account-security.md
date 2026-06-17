# Account and Security Guide

Issue: #61 - Finalize user account and security documentation

## Core Rules

- Accounts are optional. Anonymous posting remains the default way to use 36chan.
- A public post is not tied to a public account identity unless the poster explicitly chooses a display name for that post.
- Display names are per-post labels. They are not proof of account ownership and they are not the same thing as account usernames.
- Account usernames, account ids, private settings, watchlist entries, drafts, saved searches, passkeys, and 2FA state are account-private data.
- Public thread/comment responses must not expose account ids, account usernames, raw IPs, poster tokens, delete password hashes, or account-private metadata.

## User Accounts

An account lets a user keep private preferences and private helper data across sessions:

- Theme and display settings.
- Watchlist.
- Drafts.
- Saved searches.
- Account post history.
- Passkeys.
- TOTP 2FA and backup codes.

Users can still post without an account. When a logged-in user posts, the anonymous post identity is still based on the normal anonymous posting flow, not on public account identity.

## Display Name vs Account Username

Display name:

- Optional on each post.
- Visible publicly when supplied.
- Can be different from the account username.
- Does not prove ownership of an account.
- May be rejected if it uses reserved/admin-like names.

Account username:

- Used for login and private account management.
- Not shown automatically on anonymous public posts.
- Should not be treated as a public author field.

## Passkey Setup

Passkeys are managed from account settings after login.

Expected flow:

1. User logs in with username/password.
2. User opens account settings.
3. User starts passkey registration.
4. Browser or OS authenticator prompts the user.
5. Server stores the verified credential metadata and counter.
6. Future login can use passkey authentication for that username.

Security notes:

- Passkey login options should not reveal whether a username exists.
- Registration and login challenges are one-time server-side challenges.
- Passkey public metadata is private account data and must not appear on public posts.

## TOTP 2FA Setup

TOTP 2FA is optional for normal users and mandatory for admin/moderator access.

Expected setup flow:

1. User opens account security settings.
2. User starts 2FA setup.
3. Server returns a TOTP secret, QR code data, and backup codes.
4. User saves backup codes in a safe place.
5. User enters a current 6-digit authenticator code.
6. Server verifies the code and enables 2FA.

After 2FA is enabled, login requires a valid TOTP code or a valid backup code.

## Backup Codes

- Backup codes are generated during 2FA setup.
- They are intended for account recovery when the authenticator app is unavailable.
- Users should store them outside the 36chan app.
- A used backup code should be treated as spent.
- If a user loses both the authenticator and backup codes, recovery requires trusted admin intervention.

## Disabling 2FA

Normal users can disable 2FA from account settings after entering their password.

Do not disable 2FA for admin/moderator accounts as a routine support shortcut. Admin/moderator 2FA protects moderation tools and user safety workflows.

## Admin and Moderator 2FA

Admin/moderator accounts must enable 2FA before accessing `/api/admin/*` in production.

Admin access rules:

- Missing or invalid admin token returns unauthorized.
- Admin token without completed 2FA is rejected when 2FA is enabled.
- Admin/moderator account without 2FA setup is rejected in production and should be sent through setup.
- Test-mode browser smoke can bypass setup only for the disposable local smoke backend; it is not production behavior.

Operational rule:

- Keep at least one trusted admin recovery path documented internally before adding more admin/moderator users.
- Do not publish a direct 2FA reset command until a reviewed recovery script/runbook exists.

## AI and Privacy

Account data must not be sent to AI providers.

Do not send:

- Account ids or usernames.
- Private account settings.
- Watchlist, drafts, or saved searches.
- Session tokens.
- Admin tokens.
- Raw IPs.
- Poster tokens.
- Captcha tokens.
- TOTP secrets or backup codes.
- Passkey metadata.

AI features may receive public post content after redaction. Email, phone, student-id-like values, and other sensitive text patterns should be redacted before provider calls.

## Admin Support Checklist

Before telling a user that account identity is safe:

- Confirm the user understands account username is not public author identity.
- Confirm display name is optional and public only when entered on a post.
- Confirm anonymous posting remains available without login.
- Confirm account private data is separate from public post payloads.

Before granting admin/moderator access:

- Confirm `JWT_SECRET` is non-default.
- Confirm admin credentials are configured through secrets, not committed files.
- Confirm the admin/moderator has completed 2FA setup.
- Confirm backup codes were saved.
- Confirm `/api/health` does not report security warnings that affect launch.
