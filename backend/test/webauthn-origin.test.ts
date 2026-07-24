import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { createForumService } from '../src/core/forum-service.ts';
import { createMemoryStore } from '../src/core/forum-store.ts';
import {
  createHttpServer,
  resolvePublicOrigin,
  resolveWebAuthnContext
} from '../src/server/http-app.ts';

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
  it('prefers APP_BASE_URL over request and forwarded hosts', () => {
    const request = {
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'forwarded.example',
        'x-forwarded-proto': 'http'
      },
      socket: {}
    } as unknown as Parameters<typeof resolvePublicOrigin>[0];
    const context = resolveWebAuthnContext(request, {
      NODE_ENV: 'production',
      TRUST_PROXY: '1',
      APP_BASE_URL: 'https://forum.example/some-path'
    } as NodeJS.ProcessEnv);
    assert.deepEqual(context, { origin: 'https://forum.example', rpID: 'forum.example' });
  });

  it('uses forwarded host and protocol only for trusted proxies', () => {
    const request = {
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'forum.example',
        'x-forwarded-proto': 'https'
      },
      socket: {}
    } as unknown as Parameters<typeof resolvePublicOrigin>[0];
    assert.equal(
      resolvePublicOrigin(request, { NODE_ENV: 'production', TRUST_PROXY: '1' } as NodeJS.ProcessEnv),
      'https://forum.example'
    );
    assert.equal(
      resolvePublicOrigin(request, { NODE_ENV: 'production', TRUST_PROXY: '0' } as NodeJS.ProcessEnv),
      'http://127.0.0.1:3000'
    );
  });

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
