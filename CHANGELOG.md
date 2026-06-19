# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-19

First public pre-release of the 36chan web app: a Vietnamese imageboard/forum
with a hand-rolled Node.js API, Server-Sent Events realtime, AI moderation, and
a vanilla Vite frontend.

### Added

- **Core forum** — boards, threads, posts, and replies over a whole-state
  read-modify-write store (in-memory, JSON file, or MongoDB drivers).
- **Realtime** — Server-Sent Events stream for live thread updates, with
  production connection limits and metrics.
- **Voting** — upvote/downvote on posts and comments; voting restricted to
  logged-in accounts.
- **Comment sorting** — best, top, new, controversial, and old orderings.
- **Accounts & auth** — account registration/login, JWT admin tokens, TOTP
  two-factor authentication, and WebAuthn passkey login for admin and accounts.
- **Account recovery** — forgot-password via one-time recovery code.
- **Security hardening** — login lockout, captcha on login/register, hCaptcha
  verification, strengthened password policy, equalized login timing, rate-limit
  bucket eviction, and fail-safe on missing/default secrets in production.
- **Privacy** — hashed IP/poster fingerprints; raw IPs and tokens never exposed
  to public clients or sent to AI. Privacy-preserving analytics.
- **AI features** — moderation (with local heuristic fallback), report
  assistant, rewrite tones, admin-triggered daily board digest, translation,
  transcription, image caption/OCR, and text-to-speech via Gemini native audio.
  Supports Google and OpenAI-compatible providers.
- **Moderation** — admin post/file delete, thread lock/unlock, moderation reason
  macros, and an admin health dashboard.
- **Image storage** — local disk or S3-compatible backends.
- **Deployment** — Docker/production stack, deployment health endpoint, and
  production deployment documentation.

### Known Issues

- This is an early `0.x` pre-release. APIs, configuration, and behavior may
  change before `v1.0.0`; backward compatibility is not guaranteed.
- Production requires the MongoDB store driver (`STORE_DRIVER=mongo`); the
  server refuses to start in production with other drivers.
- AI summary/suggestion features require a provider API key; only moderation has
  a keyless fallback.

[0.1.0]: https://github.com/36chan/36chan-web/releases/tag/v0.1.0
