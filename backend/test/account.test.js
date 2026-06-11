import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { createForumService } from '../src/core/forum-service.js';
import { createMemoryStore } from '../src/core/forum-store.js';
import { signJwt, verifyJwt } from '../src/core/security.js';

function createTestService(overrides = {}) {
  return createForumService({
    store: createMemoryStore(),
    ai: { moderate: async () => ({ status: 'Safe', labels: [] }) },
    now: () => new Date('2026-06-10T12:00:00Z'),
    ...overrides
  });
}

describe('Account registration and login', () => {
  it('registers a new account', async () => {
    const service = createTestService();
    const account = await service.registerAccount({ username: 'testuser', password: 'securepass12' });
    assert.strictEqual(account.username, 'testuser');
    assert.strictEqual(account.role, 'user');
    assert.ok(account.id);
  });

  it('rejects duplicate username', async () => {
    const service = createTestService();
    await service.registerAccount({ username: 'testuser', password: 'securepass12' });
    await assert.rejects(
      () => service.registerAccount({ username: 'testuser', password: 'anotherpass1' }),
      (error) => error.statusCode === 409
    );
  });

  it('rejects invalid username format', async () => {
    const service = createTestService();
    await assert.rejects(
      () => service.registerAccount({ username: 'AB', password: 'securepass12' }),
      (error) => error.statusCode === 400
    );
  });

  it('rejects short password', async () => {
    const service = createTestService();
    await assert.rejects(
      () => service.registerAccount({ username: 'testuser', password: 'short' }),
      (error) => error.statusCode === 400
    );
  });

  it('logs in with correct credentials', async () => {
    const service = createTestService();
    await service.registerAccount({ username: 'testuser', password: 'securepass12' });
    const account = await service.loginAccount({ username: 'testuser', password: 'securepass12' });
    assert.strictEqual(account.username, 'testuser');
  });

  it('rejects login with wrong password', async () => {
    const service = createTestService();
    await service.registerAccount({ username: 'testuser', password: 'securepass12' });
    await assert.rejects(
      () => service.loginAccount({ username: 'testuser', password: 'wrongpass12' }),
      (error) => error.statusCode === 401
    );
  });

  it('rejects login with non-existent username', async () => {
    const service = createTestService();
    await assert.rejects(
      () => service.loginAccount({ username: 'ghost', password: 'securepass12' }),
      (error) => error.statusCode === 401
    );
  });
});

describe('Account session revocation (logout)', () => {
  const JWT_SECRET = 'test-jwt-secret-that-is-long-enough';

  it('revokeSession adds token to blacklist', () => {
    const service = createTestService();
    const token = signJwt({ role: 'user', sub: 'u1', username: 'test' }, JWT_SECRET);
    assert.strictEqual(service.isSessionRevoked(token), false);
    service.revokeSession(token);
    assert.strictEqual(service.isSessionRevoked(token), true);
  });

  it('logoutAccount revokes the token', async () => {
    const service = createTestService();
    const token = signJwt({ role: 'user', sub: 'u1', username: 'test' }, JWT_SECRET);
    const result = await service.logoutAccount(token);
    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(service.isSessionRevoked(token), true);
  });

  it('different tokens are independent', () => {
    const service = createTestService();
    const token1 = signJwt({ role: 'user', sub: 'u1', username: 'test1' }, JWT_SECRET);
    const token2 = signJwt({ role: 'user', sub: 'u2', username: 'test2' }, JWT_SECRET);
    service.revokeSession(token1);
    assert.strictEqual(service.isSessionRevoked(token1), true);
    assert.strictEqual(service.isSessionRevoked(token2), false);
  });

  it('expired revocations are cleaned up', () => {
    let mockDate = new Date('2026-01-01T00:00:00Z');
    const service = createTestService({ now: () => mockDate });
    const token = signJwt({ role: 'user', sub: 'u1', username: 'test' }, JWT_SECRET);
    service.revokeSession(token);
    assert.strictEqual(service.isSessionRevoked(token), true);

    // Advance 15 days (past the 14-day TTL)
    mockDate = new Date('2026-01-16T00:00:01Z');
    assert.strictEqual(service.isSessionRevoked(token), false);
  });
});

describe('GET /api/account/me after logout', () => {
  it('getAccount still works for valid user', async () => {
    const service = createTestService();
    const account = await service.registerAccount({ username: 'testuser', password: 'securepass12' });
    const retrieved = await service.getAccount(account.id);
    assert.strictEqual(retrieved.username, 'testuser');
  });

  it('getAccount rejects unknown user id', async () => {
    const service = createTestService();
    await assert.rejects(
      () => service.getAccount('non-existent-id'),
      (error) => error.statusCode === 401
    );
  });
});

describe('Account settings', () => {
  it('updates settings for existing user', async () => {
    const service = createTestService();
    const account = await service.registerAccount({ username: 'testuser', password: 'securepass12' });
    const updated = await service.updateAccountSettings(account.id, {
      theme: 'tomorrow',
      displayPreferences: {
        compactThreads: true,
        hideThumbnails: true
      },
      notificationPreferences: {
        email: true,
        watchedThreads: false,
        boardSubscriptions: true
      },
      boardSubscriptions: ['confession', 'hoc-tap', 'unknown-board', 'confession']
    });
    assert.strictEqual(updated.settings.theme, 'tomorrow');
    assert.deepStrictEqual(updated.settings.displayPreferences, {
      compactThreads: true,
      hideThumbnails: true
    });
    assert.deepStrictEqual(updated.settings.notificationPreferences, {
      email: true,
      watchedThreads: false,
      boardSubscriptions: true
    });
    assert.deepStrictEqual(updated.settings.boardSubscriptions, ['confession', 'hoc-tap']);
    assert.strictEqual(updated.settings.emailNotifications, true);
  });

  it('rejects invalid theme', async () => {
    const service = createTestService();
    const account = await service.registerAccount({ username: 'testuser', password: 'securepass12' });
    const updated = await service.updateAccountSettings(account.id, { theme: 'invalid-theme' });
    // Should keep the default theme instead of accepting invalid
    assert.strictEqual(updated.settings.theme, 'yotsuba-b');
  });
});

describe('Account private data', () => {
  it('syncs watchlist, drafts and saved searches for existing user', async () => {
    const service = createTestService();
    const account = await service.registerAccount({ username: 'testuser', password: 'securepass12' });
    const data = await service.updateAccountPrivateData(account.id, {
      watchlist: [
        {
          threadId: 'thread-1',
          boardSlug: 'hoc-tap',
          boardPath: '/hoc-tap/',
          globalNumber: 12,
          preview: 'Thread dang theo doi',
          lastSeen: 14,
          maxNumber: 20,
          replyCount: 8,
          fileCount: 1
        }
      ],
      drafts: [
        {
          key: 'draft:thread:hoc-tap',
          kind: 'thread',
          id: 'hoc-tap',
          boardSlug: 'hoc-tap',
          body: 'Ban nhap rieng tu',
          updatedAt: '2026-06-10T12:00:00Z'
        }
      ],
      savedSearches: [
        {
          id: 'search-1',
          boardSlug: 'hoc-tap',
          query: 'lich thi',
          label: 'hoc tap: lich thi'
        }
      ]
    });

    assert.equal(data.watchlist.length, 1);
    assert.equal(data.watchlist[0].threadId, 'thread-1');
    assert.equal(data.drafts.length, 1);
    assert.equal(data.drafts[0].body, 'Ban nhap rieng tu');
    assert.equal(data.savedSearches.length, 1);

    const retrieved = await service.getAccountPrivateData(account.id);
    assert.deepEqual(retrieved, data);
  });

  it('clears one section or all private data', async () => {
    const service = createTestService();
    const account = await service.registerAccount({ username: 'testuser', password: 'securepass12' });
    await service.updateAccountPrivateData(account.id, {
      watchlist: [{ threadId: 'thread-1' }],
      drafts: [{ key: 'draft:thread:hoc-tap', body: 'Draft' }],
      savedSearches: [{ boardSlug: 'hoc-tap', query: 'exam' }]
    });

    const withoutDrafts = await service.clearAccountPrivateData(account.id, 'drafts');
    assert.equal(withoutDrafts.watchlist.length, 1);
    assert.equal(withoutDrafts.drafts.length, 0);
    assert.equal(withoutDrafts.savedSearches.length, 1);

    const empty = await service.clearAccountPrivateData(account.id);
    assert.deepEqual(empty, { watchlist: [], drafts: [], savedSearches: [] });
  });
});

describe('Anonymous posting works without login', () => {
  it('creates a thread without account', async () => {
    const service = createTestService();
    const result = await service.createThread({
      boardSlug: 'confession',
      body: 'Anonymous post',
      captchaToken: 'dev-pass',
      ip: '127.0.0.1',
      posterToken: crypto.randomUUID()
    });
    assert.ok(result.thread);
    assert.strictEqual(result.thread.displayName, 'Anonymous');
  });
});
