import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';

import { createForumService } from '../src/core/forum-service.ts';
import { createMemoryStore } from '../src/core/forum-store.ts';
import { createHttpServer } from '../src/server/http-app.ts';
import { sanitizeText } from '../src/core/text-format.ts';
import { redactSensitiveText } from '../src/core/ai.ts';
import { signJwt } from '../src/core/security.ts';

type TestAi = {
  moderate: (...args: any[]) => Promise<{ status: string; labels: string[] }>;
  summarize: (...args: any[]) => Promise<string[]>;
  suggest: (...args: any[]) => Promise<string[]>;
  rewrite: (...args: any[]) => Promise<string>;
};

type ServerCallback = (baseUrl: string, jwtSecret: string) => Promise<void>;

type ApiBody = {
  data?: any;
};

async function readApiBody(response: Response): Promise<ApiBody> {
  const body = await response.json();
  assert.ok(typeof body === 'object' && body !== null);
  return body as ApiBody;
}

const safeAi = {
  async moderate() {
    return { status: 'Safe', labels: [] };
  },
  async summarize() {
    return ['Tom tat 1', 'Tom tat 2', 'Tom tat 3'];
  },
  async suggest() {
    return ['Goi y 1', 'Goi y 2'];
  },
  async rewrite(text) {
    return `Da sua: ${text}`;
  }
} satisfies TestAi;

async function withServer(
  callback: ServerCallback,
  {
    ai = safeAi,
    now = () => new Date('2026-05-22T08:00:00.000Z'),
    jwtSecret = 'test-secret-long-enough-for-jwt'
  }: { ai?: TestAi; now?: () => Date; jwtSecret?: string } = {}
) {
  const realtime = { publish() {}, count: () => 0 };
  const service = createForumService({
    store: createMemoryStore(),
    ai,
    realtime,
    now
  });
  const server = createHttpServer({
    service,
    realtime,
    jwtSecret,
    adminUsername: 'admin',
    adminPassword: 'secure-admin-password-12'
  } as Parameters<typeof createHttpServer>[0]);
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${port}`, jwtSecret);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

// =============================================
// XSS Regression Tests
// =============================================

test('security: XSS payloads in thread body are escaped', async () => {
  await withServer(async (baseUrl) => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      '"><script>document.cookie</script>',
      "javascript:alert('xss')",
      '<svg onload=alert(1)>',
      '<iframe src="javascript:alert(1)"></iframe>'
    ];

    let ipCounter = 1;
    for (const payload of xssPayloads) {
      const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `127.0.0.${ipCounter}`
        },
        body: JSON.stringify({
          body: payload,
          captchaToken: 'dev-pass'
        })
      });
      ipCounter += 1;
      const createdBody = await readApiBody(created);
      assert.equal(created.status, 201);

      const serialized = JSON.stringify(createdBody.data);
      assert.equal(serialized.includes('<script'), false, `XSS script leaked: ${payload}`);
      assert.equal(serialized.includes('<img'), false, `XSS img leaked: ${payload}`);
      assert.equal(serialized.includes('<iframe'), false, `XSS iframe leaked: ${payload}`);
      assert.equal(serialized.includes('<svg'), false, `XSS svg leaked: ${payload}`);
    }
  });
});

test('security: XSS payloads in display name are escaped', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Normal body',
        displayName: '<script>alert(1)</script>User',
        captchaToken: 'dev-pass'
      })
    });
    const createdBody = await readApiBody(created);

    // The sanitized display name should not contain raw script tags
    const serialized = JSON.stringify(createdBody.data);
    assert.equal(serialized.includes('<script>'), false);
  });
});

test('security: sanitizeText escapes all dangerous HTML characters', () => {
  const input = '<script>alert("xss")</script> & <img onerror=1>';
  const result = sanitizeText(input);

  assert.equal(result.includes('<'), false);
  assert.equal(result.includes('>'), false);
  assert.equal(result.includes('"'), false);
  assert.ok(result.includes('&lt;'));
  assert.ok(result.includes('&gt;'));
  assert.ok(result.includes('&quot;'));
  assert.ok(result.includes('&amp;'));
});

// =============================================
// Upload Validation Regression Tests
// =============================================

test('security: thread creation rejects invalid image MIME types', async () => {
  await withServer(async (baseUrl) => {
    const invalidMimes = [
      { type: 'image/svg+xml', name: 'payload.svg' },
      { type: 'application/javascript', name: 'malware.js' },
      { type: 'text/html', name: 'page.html' },
      { type: 'application/x-executable', name: 'malware.exe' }
    ];

    for (const { type, name } of invalidMimes) {
      const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Thread voi file khong hop le',
          captchaToken: 'dev-pass',
          image: {
            name,
            type,
            dataUrl: 'data:application/octet-stream;base64,AAAA',
            sizeBytes: 100,
            width: 1,
            height: 1
          }
        })
      });

      assert.notEqual(created.status, 201, `Should reject MIME type: ${type}`);
    }
  });
});

test('security: thread creation rejects oversized image payloads', async () => {
  await withServer(async (baseUrl) => {
    // Default max is ~1.6MB total JSON. Create a body that exceeds it.
    const oversizedData = 'A'.repeat(1_700_001);
    const created = await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: oversizedData,
        captchaToken: 'dev-pass'
      })
    });

    assert.equal(created.status, 413);
  });
});

// =============================================
// Auth & Session Regression Tests
// =============================================

test('security: admin API rejects requests without authorization header', async () => {
  await withServer(async (baseUrl) => {
    const endpoints = [
      '/api/admin/pending',
      '/api/admin/moderation-actions',
      '/api/admin/reports',
      '/api/admin/appeals',
      '/api/admin/deleted',
      '/api/admin/approved',
      '/api/admin/sanctions'
    ];

    for (const endpoint of endpoints) {
      const response = await fetch(`${baseUrl}${endpoint}`);
      assert.equal(response.status, 401, `Should reject unauthenticated access to ${endpoint}`);
    }
  });
});

test('security: admin API rejects expired JWT tokens', async () => {
  await withServer(async (baseUrl, jwtSecret) => {
    // Create a token that expired 1 hour ago
    const expiredToken = signJwt(
      { role: 'admin', username: 'admin' },
      jwtSecret,
      { expiresInSeconds: -3600 }
    );

    const response = await fetch(`${baseUrl}/api/admin/pending`, {
      headers: { authorization: `Bearer ${expiredToken}` }
    });
    assert.equal(response.status, 401);
  });
});

test('security: admin API rejects tokens with non-admin role', async () => {
  await withServer(async (baseUrl, jwtSecret) => {
    const userToken = signJwt(
      { role: 'user', sub: 'user-123', username: 'regular_user' },
      jwtSecret
    );

    const response = await fetch(`${baseUrl}/api/admin/pending`, {
      headers: { authorization: `Bearer ${userToken}` }
    });
    assert.equal(response.status, 401);
  });
});

test('security: admin API rejects tokens signed with wrong secret', async () => {
  await withServer(async (baseUrl) => {
    const wrongToken = signJwt(
      { role: 'admin', username: 'admin' },
      'wrong-secret-completely-different'
    );

    const response = await fetch(`${baseUrl}/api/admin/pending`, {
      headers: { authorization: `Bearer ${wrongToken}` }
    });
    assert.equal(response.status, 401);
  });
});

test('security: admin login rejects wrong credentials', async () => {
  await withServer(async (baseUrl) => {
    const wrongPassword = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' })
    });
    assert.equal(wrongPassword.status, 401);

    const wrongUsername = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'hacker', password: 'secure-admin-password-12' })
    });
    assert.equal(wrongUsername.status, 401);
  });
});

test('security: account API rejects access after logout (session revocation)', async () => {
  await withServer(async (baseUrl) => {
    const registered = await fetch(`${baseUrl}/api/account/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'revoke_test', password: 'long-enough-pass', captchaToken: 'dev-pass' })
    });
    const registeredBody = await readApiBody(registered);
    const token = registeredBody.data.token;

    // Logout
    await fetch(`${baseUrl}/api/account/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    });

    // Attempt to use revoked token
    const me = await fetch(`${baseUrl}/api/account/me`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(me.status, 401);
  });
});

// =============================================
// Admin API Access Control Regression Tests
// =============================================

test('security: admin moderation actions require valid admin JWT', async () => {
  await withServer(async (baseUrl, jwtSecret) => {
    // First login as admin
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'secure-admin-password-12' })
    });
    const loginBody = await readApiBody(login);
    const adminToken = loginBody.data.token;

    // Create a thread to have something in pending
    await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Thread de kiem tra moderation',
        captchaToken: 'dev-pass'
      })
    });

    // Admin CAN access pending
    const pending = await fetch(`${baseUrl}/api/admin/pending`, {
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(pending.status, 200);

    // Without token CANNOT access
    const noToken = await fetch(`${baseUrl}/api/admin/pending`);
    assert.equal(noToken.status, 401);
  });
});

// =============================================
// AI Payload Redaction Regression Tests
// =============================================

test('security: redactSensitiveText removes email, phone, and student ID', () => {
  const input = 'Lien he admin@36chan.com, sdt 0901234567, MSSV B2212345';
  const result = redactSensitiveText(input);

  assert.equal(result.includes('admin@36chan.com'), false);
  assert.equal(result.includes('0901234567'), false);
  assert.equal(result.includes('B2212345'), false);
  assert.ok(result.includes('[email da an]'));
  assert.ok(result.includes('[so dien thoai da an]'));
  assert.ok(result.includes('[ma sinh vien da an]'));
});

test('security: AI rewrite does not receive IP or account tokens', async () => {
  const receivedInputs = [];
  const spyAi = {
    async moderate() {
      return { status: 'Safe', labels: [] };
    },
    async summarize() {
      return [];
    },
    async suggest() {
      return [];
    },
    async rewrite(text) {
      receivedInputs.push(text);
      return `Da sua: ${text}`;
    }
  };

  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ai/rewrite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Noi dung can rewrite, email admin@test.com, sdt 0901234567',
          posterToken: 'secret-poster-token-123'
        })
      });
      assert.equal(response.status, 200);

      // AI should NOT receive raw poster token or IP
      for (const input of receivedInputs) {
        assert.equal(input.includes('secret-poster-token-123'), false, 'Poster token leaked to AI');
        assert.equal(input.includes('127.0.0.1'), false, 'IP address leaked to AI');
      }

      // AI SHOULD receive redacted version
      assert.ok(receivedInputs.length > 0, 'AI rewrite should have been called');
    },
    { ai: spyAi }
  );
});

test('security: AI summary does not receive raw PII from threads', async () => {
  const summaryInputs = [];
  const spyAi = {
    async moderate() {
      return { status: 'Safe', labels: [] };
    },
    async summarize(items) {
      summaryInputs.push(...items.map((item) => item.body));
      return ['Tom tat'];
    },
    async suggest() {
      return [];
    },
    async rewrite(text) {
      return text;
    }
  };

  await withServer(
    async (baseUrl) => {
      await fetch(`${baseUrl}/api/boards/hoc-tap/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'Lien he email secret@test.com de biet them',
          captchaToken: 'dev-pass'
        })
      });

      const response = await fetch(`${baseUrl}/api/boards/hoc-tap/summary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(response.status, 200);
    },
    { ai: spyAi }
  );

  assert.ok(summaryInputs.length > 0, 'AI summary should have been called');
  for (const input of summaryInputs) {
    assert.equal(input.includes('secret@test.com'), false, 'Raw email leaked to AI summary');
    assert.equal(input.includes('[email da an]'), true, 'AI summary should receive redacted email marker');
  }
});
