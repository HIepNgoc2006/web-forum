import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, describe, it } from 'node:test';
import crypto from 'node:crypto';

import * as totpService from '../src/core/totp-service.js';
import { createForumService } from '../src/core/forum-service.js';
import { createMemoryStore } from '../src/core/forum-store.js';
import { createHttpServer } from '../src/server/http-app.js';
import { signJwt } from '../src/core/security.js';

function createTestService(overrides = {}) {
  return createForumService({
    store: createMemoryStore(),
    ai: { moderate: async () => ({ status: 'Safe', labels: [] }) },
    now: () => new Date('2026-06-10T12:00:00Z'),
    ...overrides
  });
}

async function withServer(
  callback,
  {
    now = () => new Date('2026-05-22T08:00:00.000Z'),
    jwtSecret = 'secret-long-enough-for-signing-jwt-properly-in-tests'
  } = {}
) {
  const realtime = { publish() {} };
  const service = createForumService({
    store: createMemoryStore(),
    ai: { moderate: async () => ({ status: 'Safe', labels: [] }) },
    realtime,
    now
  });
  const server = createHttpServer({
    service,
    realtime,
    jwtSecret,
    adminUsername: 'admin',
    adminPassword: 'pass'
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`, service, jwtSecret);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

describe('TOTP Service Cryptography', () => {
  it('generates base32 secret', () => {
    const secret = totpService.generateSecret();
    assert.equal(secret.length, 16);
    assert.match(secret, /^[A-Z2-7]+$/);
  });

  it('generates and verifies valid TOTP token', () => {
    const secret = totpService.generateSecret();
    const token = totpService.generateTOTP(secret);
    assert.match(token, /^\d{6}$/);

    const verified = totpService.verifyTOTP(token, secret);
    assert.equal(verified, true);
  });

  it('tolerates window drift in verifyTOTP', () => {
    const secret = totpService.generateSecret();
    const step = 30;
    // Token generated 30 seconds in the future
    const tokenFuture = totpService.generateTOTP(secret, Date.now() + step * 1000);
    assert.equal(totpService.verifyTOTP(tokenFuture, secret, 1), true);

    // Token generated 60 seconds in the future (outside window of 1)
    const tokenFarFuture = totpService.generateTOTP(secret, Date.now() + 2 * step * 1000);
    assert.equal(totpService.verifyTOTP(tokenFarFuture, secret, 1), false);
  });

  it('rejects invalid or wrong TOTP tokens', () => {
    const secret = totpService.generateSecret();
    assert.equal(totpService.verifyTOTP('12345', secret), false);
    assert.equal(totpService.verifyTOTP('12345a', secret), false);
    assert.equal(totpService.verifyTOTP('123456', secret), false);
  });

  it('generates backup codes in correct format', () => {
    const codes = totpService.generateBackupCodes();
    assert.equal(codes.length, 10);
    for (const code of codes) {
      assert.equal(code.length, 8);
      assert.match(code, /^[0-9A-F]{8}$/);
    }
  });

  it('generates QR code data URL', async () => {
    const secret = totpService.generateSecret();
    const qrData = await totpService.generateQrCodeDataUrl('user@36chan', secret);
    assert.ok(qrData.startsWith('data:image/png;base64,'));
  });
});

describe('Forum Service 2FA Functions', () => {
  it('handles 2FA setup lifecycle for users', async () => {
    const service = createTestService();
    const { account } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });

    // Default state: disabled
    assert.equal(account.twoFactorEnabled, false);

    // Generate setup
    const setup = await service.generate2FASetup(account.id);
    assert.ok(setup.secret);
    assert.ok(setup.qrCodeUrl);
    assert.equal(setup.backupCodes.length, 10);

    // Verify setup failure with wrong code
    await assert.rejects(
      () => service.verify2FASetup(account.id, '000000'),
      (error) => error.statusCode === 400
    );

    // Verify setup success
    const validCode = totpService.generateTOTP(setup.secret);
    const verifyResult = await service.verify2FASetup(account.id, validCode);
    assert.equal(verifyResult.ok, true);
    assert.equal(verifyResult.account.twoFactorEnabled, true);

    // Verify login works with valid code
    const loginVerify = await service.verify2FALogin(account.id, validCode);
    assert.equal(loginVerify.ok, true);

    // Verify login fails with invalid code
    await assert.rejects(
      () => service.verify2FALogin(account.id, '000000'),
      (error) => error.statusCode === 400
    );

    // Verify backup code login
    const firstBackup = setup.backupCodes[0];
    const backupVerify = await service.verifyBackupCodeLogin(account.id, firstBackup);
    assert.equal(backupVerify.ok, true);

    // Second use of the same backup code fails
    await assert.rejects(
      () => service.verifyBackupCodeLogin(account.id, firstBackup),
      (error) => error.statusCode === 400
    );

    // Disable 2FA requires correct password
    await assert.rejects(
      () => service.disable2FA(account.id, 'wrongpass'),
      (error) => error.statusCode === 401
    );

    const disableResult = await service.disable2FA(account.id, 'securepass12');
    assert.equal(disableResult.ok, true);
    assert.equal(disableResult.account.twoFactorEnabled, false);
  });

  it('allows administrative reset of 2FA', async () => {
    const service = createTestService();
    const { account } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    const setup = await service.generate2FASetup(account.id);
    const validCode = totpService.generateTOTP(setup.secret);
    await service.verify2FASetup(account.id, validCode);

    const resetResult = await service.resetUser2FA('testuser');
    assert.equal(resetResult.ok, true);

    const updated = await service.getAccount(account.id);
    assert.equal(updated.twoFactorEnabled, false);
  });
});

describe('HTTP 2FA Integration API', () => {
  test('login flows and security enforcement via HTTP', async () => {
    await withServer(async (baseUrl, service, jwtSecret) => {
      // 1. Register a user
      const registerRes = await fetch(`${baseUrl}/api/account/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'user2fa', password: 'strong-2fa-pass', captchaToken: 'dev-pass' })
      });
      const registerBody = await registerRes.json();
      assert.equal(registerRes.status, 201);
      const userToken = registerBody.data.token;
      const userId = registerBody.data.account.id;

      // 2. Setup 2FA
      const setupRes = await fetch(`${baseUrl}/api/account/2fa/setup`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userToken}` }
      });
      const setupBody = await setupRes.json();
      assert.equal(setupRes.status, 200);
      const secret = setupBody.data.secret;
      const backupCodes = setupBody.data.backupCodes;

      // 3. Verify setup
      const validCode = totpService.generateTOTP(secret);
      const setupVerifyRes = await fetch(`${baseUrl}/api/account/2fa/verify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${userToken}`
        },
        body: JSON.stringify({ code: validCode })
      });
      assert.equal(setupVerifyRes.status, 200);

      // 4. Try normal login -> should prompt for 2FA (requires2FA = true)
      const loginRes = await fetch(`${baseUrl}/api/account/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'user2fa', password: 'strong-2fa-pass', captchaToken: 'dev-pass' })
      });
      const loginBody = await loginRes.json();
      assert.equal(loginRes.status, 200);
      assert.equal(loginBody.data.requires2FA, true);
      assert.ok(loginBody.data.tempToken);

      // 5. Verify 2FA Login with invalid token
      const verifyFailRes = await fetch(`${baseUrl}/api/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tempToken: loginBody.data.tempToken, code: '000000' })
      });
      assert.equal(verifyFailRes.status, 400);

      // 6. Verify 2FA Login with valid token
      const verifySuccessRes = await fetch(`${baseUrl}/api/auth/2fa/totp-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tempToken: loginBody.data.tempToken, code: validCode })
      });
      const verifySuccessBody = await verifySuccessRes.json();
      assert.equal(verifySuccessRes.status, 200);
      assert.ok(verifySuccessBody.data.token);

      // 7. Verify login using backup code
      const backupLoginRes = await fetch(`${baseUrl}/api/auth/2fa/backup-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tempToken: loginBody.data.tempToken, code: backupCodes[0] })
      });
      const backupLoginBody = await backupLoginRes.json();
      assert.equal(backupLoginRes.status, 200);
      assert.ok(backupLoginBody.data.token);

      // 8. Re-use backup code should fail
      const backupReuseRes = await fetch(`${baseUrl}/api/auth/2fa/backup-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tempToken: loginBody.data.tempToken, code: backupCodes[0] })
      });
      assert.equal(backupReuseRes.status, 400);
    });
  });

  test('admin 2FA setup and enforcement', async () => {
    await withServer(async (baseUrl, service, jwtSecret) => {
      // Create admin token (isTwoFactorVerified: false by default since 2FA is disabled)
      const adminLoginRes = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass' })
      });
      const adminLoginBody = await adminLoginRes.json();
      assert.equal(adminLoginRes.status, 200);
      const adminToken = adminLoginBody.data.token;

      // Get admin account details
      const adminAcc = await service.getOrCreateAdminAccount('admin', 'pass');

      // Admin access should return 403 (setupRequired: true) if process.env.NODE_ENV is not 'test'
      // Wait, in requireAdmin:
      // "If process.env.NODE_ENV === 'test' and 2FA is not enabled, bypasses enforcement"
      // Let's explicitly test by enabling 2FA for the admin in the database,
      // which triggers the requirement regardless of NODE_ENV.
      const setup = await service.generate2FASetup(adminAcc.id);
      const validCode = totpService.generateTOTP(setup.secret);
      await service.verify2FASetup(adminAcc.id, validCode);

      // Now 2FA is enabled. Re-authenticating should prompt for 2FA
      const adminLogin2FARes = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass' })
      });
      const adminLogin2FABody = await adminLogin2FARes.json();
      assert.equal(adminLogin2FARes.status, 200);
      assert.equal(adminLogin2FABody.data.requires2FA, true);
      const tempToken = adminLogin2FABody.data.tempToken;

      // Accessing admin endpoint with tempToken or unverified token should return 401
      const accessBlockedRes = await fetch(`${baseUrl}/api/admin/pending`, {
        headers: { authorization: `Bearer ${tempToken}` }
      });
      const accessBlockedBody = await accessBlockedRes.json();
      assert.equal(accessBlockedRes.status, 401);
      assert.equal(accessBlockedBody.error.requires2FA, true);

      // Verify and upgrade token
      const verifyRes = await fetch(`${baseUrl}/api/auth/2fa/totp-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tempToken, code: validCode })
      });
      const verifyBody = await verifyRes.json();
      assert.equal(verifyRes.status, 200);
      const verifiedAdminToken = verifyBody.data.token;

      // Accessing admin endpoint with verified token should succeed
      const accessAllowedRes = await fetch(`${baseUrl}/api/admin/pending`, {
        headers: { authorization: `Bearer ${verifiedAdminToken}` }
      });
      assert.equal(accessAllowedRes.status, 200);
    });
  });

  test('admin without 2FA can bootstrap setup but cannot access admin API in production mode', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await withServer(async (baseUrl) => {
        const adminLoginRes = await fetch(`${baseUrl}/api/admin/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'pass' })
        });
        const adminLoginBody = await adminLoginRes.json();
        assert.equal(adminLoginRes.status, 200);
        const adminToken = adminLoginBody.data.token;

        const blockedAdminRes = await fetch(`${baseUrl}/api/admin/pending`, {
          headers: { authorization: `Bearer ${adminToken}` }
        });
        const blockedAdminBody = await blockedAdminRes.json();
        assert.equal(blockedAdminRes.status, 403);
        assert.equal(blockedAdminBody.error.setupRequired, true);

        const setupRes = await fetch(`${baseUrl}/api/account/2fa/setup`, {
          method: 'POST',
          headers: { authorization: `Bearer ${adminToken}` }
        });
        const setupBody = await setupRes.json();
        assert.equal(setupRes.status, 200);
        assert.ok(setupBody.data.secret);

        const setupCode = totpService.generateTOTP(setupBody.data.secret);
        const verifySetupRes = await fetch(`${baseUrl}/api/account/2fa/verify`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${adminToken}`
          },
          body: JSON.stringify({ code: setupCode })
        });
        assert.equal(verifySetupRes.status, 200);
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
