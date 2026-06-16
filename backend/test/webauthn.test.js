import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import crypto from 'node:crypto';

import { createForumService } from '../src/core/forum-service.js';
import { createMemoryStore } from '../src/core/forum-store.js';
import { createHttpServer } from '../src/server/http-app.js';

const mockWebAuthn = {
  getWebAuthnRegisterOptions: async ({ user, rpID }) => {
    return {
      challenge: 'registerChallengeValue',
      rp: { name: '36chan', id: rpID },
      user: { id: user.id, name: user.username, displayName: user.username },
      pubKeyCredParams: []
    };
  },
  verifyWebAuthnRegisterResponse: async ({ body, expectedChallenge, origin, rpID }) => {
    if (expectedChallenge !== 'registerChallengeValue') {
      return { verified: false };
    }
    return {
      verified: true,
      registrationInfo: {
        credential: {
          id: 'mockCredentialID_123',
          publicKey: Buffer.from('mockPublicKeyBytes'),
          counter: 10,
          transports: ['internal']
        },
        counter: 10,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: true
      }
    };
  },
  getWebAuthnLoginOptions: async ({ user, rpID }) => {
    return {
      challenge: 'loginChallengeValue',
      allowCredentials: (user.passkeys || []).map(p => ({ id: p.credentialID, type: 'public-key' }))
    };
  },
  verifyWebAuthnLoginResponse: async ({ body, expectedChallenge, origin, rpID, passkey }) => {
    if (expectedChallenge !== 'loginChallengeValue' || passkey.credentialID !== 'mockCredentialID_123') {
      return { verified: false };
    }
    return {
      verified: true,
      authenticationInfo: {
        newCounter: 11
      }
    };
  }
};

async function withServer(callback, jwtSecret = 'test-jwt-secret') {
  const store = createMemoryStore();
  const service = createForumService({
    store,
    ai: { moderate: async () => ({ status: 'Safe', labels: [] }) },
    now: () => new Date('2026-06-10T12:00:00Z'),
    webauthn: mockWebAuthn
  });
  const server = createHttpServer({
    service,
    realtime: { publish() {} },
    jwtSecret,
    adminUsername: 'admin',
    adminPassword: 'pass'
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`, service);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

describe('WebAuthn Passkey Registration and Authentication API', () => {
  const jwtSecret = 'some-long-test-jwt-secret-value';

  it('performs registration and authentication flow', async () => {
    await withServer(async (baseUrl, service) => {
      // 1. Register a user first using password
      const regRes = await fetch(`${baseUrl}/api/account/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'webauthnuser', password: 'securepass123' })
      });
      assert.strictEqual(regRes.status, 201);
      const regData = await regRes.json();
      const userToken = regData.data.token;
      assert.ok(userToken);

      // Verify listing passkeys initially returns empty array
      const listEmptyRes = await fetch(`${baseUrl}/api/account/passkeys`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.strictEqual(listEmptyRes.status, 200);
      const emptyPasskeys = (await listEmptyRes.json()).data;
      assert.deepStrictEqual(emptyPasskeys, []);

      // 2. Generate registration options
      const optRes = await fetch(`${baseUrl}/api/account/passkeys/register-options`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      });
      assert.strictEqual(optRes.status, 200);
      const optData = (await optRes.json()).data;
      assert.strictEqual(optData.challenge, 'registerChallengeValue');

      // 3. Verify/complete registration
      const verifyRes = await fetch(`${baseUrl}/api/account/passkeys/register-verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: 'mockCredentialID_123',
          rawId: 'mockCredentialID_123',
          type: 'public-key',
          response: {
            clientDataJSON: 'mockClientDataJSON',
            attestationObject: 'mockAttestationObject',
            transports: ['internal']
          }
        })
      });
      assert.strictEqual(verifyRes.status, 200);
      const verifyData = (await verifyRes.json()).data;
      assert.deepStrictEqual(verifyData, { ok: true });

      // Verify listing passkeys now returns 1 registered passkey
      const listRes = await fetch(`${baseUrl}/api/account/passkeys`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.strictEqual(listRes.status, 200);
      const passkeys = (await listRes.json()).data;
      assert.strictEqual(passkeys.length, 1);
      assert.strictEqual(passkeys[0].id, 'mockCredentialID_123');
      assert.strictEqual(passkeys[0].credentialDeviceType, 'singleDevice');

      // 4. Generate login options
      const loginOptRes = await fetch(`${baseUrl}/api/auth/webauthn/login-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'webauthnuser' })
      });
      assert.strictEqual(loginOptRes.status, 200);
      const loginOptData = (await loginOptRes.json()).data;
      assert.strictEqual(loginOptData.challenge, 'loginChallengeValue');

      // 5. Verify login response
      const loginVerifyRes = await fetch(`${baseUrl}/api/auth/webauthn/login-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'webauthnuser',
          assertionResponse: {
            id: 'mockCredentialID_123',
            rawId: 'mockCredentialID_123',
            type: 'public-key',
            response: {
              authenticatorData: 'mockAuthData',
              clientDataJSON: 'mockClientDataJSON',
              signature: 'mockSignature',
              userHandle: 'mockUserHandle'
            }
          }
        })
      });
      assert.strictEqual(loginVerifyRes.status, 200);
      const loginVerifyData = (await loginVerifyRes.json()).data;
      assert.ok(loginVerifyData.token);
      assert.strictEqual(loginVerifyData.account.username, 'webauthnuser');

      // 6. Delete the passkey
      const deleteRes = await fetch(`${baseUrl}/api/account/passkeys/mockCredentialID_123`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.strictEqual(deleteRes.status, 200);
      const deleteData = (await deleteRes.json()).data;
      assert.deepStrictEqual(deleteData, { ok: true });

      // Verify passkey is gone
      const listAfterDeleteRes = await fetch(`${baseUrl}/api/account/passkeys`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      assert.strictEqual(listAfterDeleteRes.status, 200);
      const passkeysAfterDelete = (await listAfterDeleteRes.json()).data;
      assert.deepStrictEqual(passkeysAfterDelete, []);
    }, jwtSecret);
  });

  it('rejects registration verification if expected challenge is missing', async () => {
    await withServer(async (baseUrl) => {
      // Register a user
      const regRes = await fetch(`${baseUrl}/api/account/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'anotheruser', password: 'securepass123' })
      });
      const regData = await regRes.json();
      const userToken = regData.data.token;

      // Submit verification directly without request options
      const verifyRes = await fetch(`${baseUrl}/api/account/passkeys/register-verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: 'mockCredentialID_123',
          rawId: 'mockCredentialID_123',
          type: 'public-key',
          response: {
            clientDataJSON: 'mockClientDataJSON',
            attestationObject: 'mockAttestationObject'
          }
        })
      });
      assert.strictEqual(verifyRes.status, 400);
      const errorData = await verifyRes.json();
      assert.strictEqual(errorData.error.message, 'Không tìm thấy yêu cầu đăng ký tương ứng');
    }, jwtSecret);
  });

  it('rejects login verification if expected challenge is missing', async () => {
    await withServer(async (baseUrl) => {
      // Attempt login verification directly without requesting options first
      const loginVerifyRes = await fetch(`${baseUrl}/api/auth/webauthn/login-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'webauthnuser',
          assertionResponse: {
            id: 'mockCredentialID_123',
            rawId: 'mockCredentialID_123',
            type: 'public-key',
            response: {}
          }
        })
      });
      assert.strictEqual(loginVerifyRes.status, 401);
      const errorData = await loginVerifyRes.json();
      assert.strictEqual(errorData.error.message, 'Tên tài khoản hoặc mật khẩu không đúng');
    }, jwtSecret);
  });

  it('does not reveal whether a username exists when requesting login options', async () => {
    await withServer(async (baseUrl) => {
      const loginOptRes = await fetch(`${baseUrl}/api/auth/webauthn/login-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'missinguser' })
      });
      assert.strictEqual(loginOptRes.status, 401);
      const errorData = await loginOptRes.json();
      assert.strictEqual(errorData.error.message, 'Tên tài khoản hoặc thiết bị đăng nhập không đúng');
      assert.equal(errorData.error.message.includes('không tồn tại'), false);
    }, jwtSecret);
  });
});
