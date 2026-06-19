# Security Policy

## Supported Versions

This project is in early `0.x` development. Only the latest release on `main`
receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

Report privately via GitHub's [Security Advisories](https://github.com/36chan/36chan-web/security/advisories/new)
("Report a vulnerability"). Include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected version/commit.

We aim to acknowledge reports within 7 days and to ship a fix or mitigation
before public disclosure. Please give us reasonable time to remediate.

## Scope

In scope: auth (JWT/TOTP/WebAuthn), moderation fingerprinting, file uploads,
rate limiting, secret handling, and data exposure to public clients or AI.

Out of scope: issues requiring a compromised admin account, denial-of-service
from unbounded load testing, and vulnerabilities in third-party dependencies
(report those upstream).
