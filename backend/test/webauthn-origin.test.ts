import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { createForumService } from '../src/core/forum-service.js';
import { createMemoryStore } from '../src/core/forum-store.ts';
import { createHttpServer } from '../src/server/http-app.js';

async function withServer(callback) {
  const service = createForumService({
    store: createMemoryStore(),
    ai: { moderate: async () => ({ status: 'Safe', labels: [] }) },
    now: () => new Date('2026-06-10T12:00:00Z'),
    webauthn: {
      getWebAuthnRegisterOptions: async () => {
        throw new Error('registration options should not run for invalid origins');
      },
      getWebAuthnLoginOptions: async () => {
        throw new Error('login options should not run for invalid origins');
      },
      verifyWebAuthnLoginResponse: async () => {
        throw new Error('verification should not run for invalid origins');
      },
      verifyWebAuthnRegisterResponse: async () => {
        throw new Error('verification should not run for invalid origins');
      }
    }
  });
  const server = createHttpServer({
    service,
    realtime: { publish() {} },
    jwtSecret: 'some-long-test-jwt-secret-value',
    adminUsername: 'admin',
    adminPassword: 'pass'
  } as Parameters<typeof createHttpServer>[0]);
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

describe('WebAuthn origin validation', () => {
  it('returns a client error for malformed login origins', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/webauthn/login-verify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'not a valid origin'
        },
        body: JSON.stringify({ username: 'user', assertionResponse: {} })
      });
      const body = await response.json() as { error: { message: string } };

      assert.equal(response.status, 400);
      assert.match(body.error.message, /Origin đăng nhập không hợp lệ/);
    });
  });
});
