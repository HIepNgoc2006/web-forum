import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { createForumService } from '../src/core/forum-service.ts';
import { createMemoryStore } from '../src/core/forum-store.ts';
import { signJwt } from '../src/core/security.ts';

type ServiceError = {
  message?: string;
  statusCode?: number;
};

function isServiceError(error: unknown, statusCode: number) {
  return typeof error === 'object' && error !== null && (error as ServiceError).statusCode === statusCode;
}

function toServiceError(error: unknown): ServiceError {
  assert.ok(typeof error === 'object' && error !== null);
  return error as ServiceError;
}

function createTestService(overrides = {}) {
  return createForumService({
    store: createMemoryStore(),
    ai: { moderate: async () => ({ status: 'Safe', labels: [] }) },
    now: () => new Date('2026-06-10T12:00:00Z'),
    ...overrides
  });
}

function createCapturingEmailClient() {
  const messages: Array<{ to: string; subject: string; text: string; html?: string }> = [];
  return {
    type: 'test',
    configured: true,
    messages,
    async send(message) {
      messages.push(message);
      return { id: `email-${messages.length}` };
    }
  };
}

function latestEmailCode(emailClient: ReturnType<typeof createCapturingEmailClient>) {
  const message = emailClient.messages.at(-1);
  assert.ok(message);
  const match = message.subject.match(/(\d{6})$/);
  assert.ok(match);
  return match[1];
}

async function registerVerifiedAccount(
  service: ReturnType<typeof createTestService>,
  emailClient: ReturnType<typeof createCapturingEmailClient>,
  username: string
) {
  const result = await service.registerAccount({
    username,
    email: `${username}@example.com`,
    password: 'securepass12',
    captchaToken: 'dev-pass'
  });
  await service.verifyAccountEmail(result.account.id, latestEmailCode(emailClient));
  return result.account;
}

describe('Account registration and login', () => {
  it('registers a new account', async () => {
    const service = createTestService();
    const { account, recoveryCode } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    assert.strictEqual(account.username, 'testuser');
    assert.strictEqual(account.role, 'user');
    assert.ok(account.id);
    assert.strictEqual(account.hasRecoveryCode, true);
    assert.match(recoveryCode, /^[A-Z0-9]{5}(-[A-Z0-9]{5})+$/);
  });

  it('rejects duplicate username', async () => {
    const service = createTestService();
    await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    await assert.rejects(
      () => service.registerAccount({ username: 'testuser', password: 'anotherpass1', captchaToken: 'dev-pass' }),
      (error) => isServiceError(error, 409)
    );
  });

  it('rejects invalid username format', async () => {
    const service = createTestService();
    await assert.rejects(
      () => service.registerAccount({ username: 'AB', password: 'securepass12', captchaToken: 'dev-pass' }),
      (error) => isServiceError(error, 400)
    );
  });

  it('rejects short password', async () => {
    const service = createTestService();
    await assert.rejects(
      () => service.registerAccount({ username: 'testuser', password: 'short', captchaToken: 'dev-pass' }),
      (error) => isServiceError(error, 400)
    );
  });

  it('logs in with correct credentials', async () => {
    const service = createTestService();
    await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    const account = await service.loginAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    assert.strictEqual(account.username, 'testuser');
  });

  it('rejects login with wrong password', async () => {
    const service = createTestService();
    await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    await assert.rejects(
      () => service.loginAccount({ username: 'testuser', password: 'wrongpass12', captchaToken: 'dev-pass' }),
      (error) => isServiceError(error, 401)
    );
  });

  it('rejects login with non-existent username', async () => {
    const service = createTestService();
    await assert.rejects(
      () => service.loginAccount({ username: 'ghost', password: 'securepass12', captchaToken: 'dev-pass' }),
      (error) => isServiceError(error, 401)
    );
  });
});

describe('Account email verification', () => {
  it('keeps a newly registered account usable before email verification', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({ emailClient });
    const result = await service.registerAccount({
      username: 'testuser',
      email: 'Student@Example.com',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });

    assert.strictEqual(result.account.email, 'student@example.com');
    assert.strictEqual(result.account.emailVerified, false);
    assert.strictEqual(result.verificationEmailSent, true);
    assert.strictEqual(emailClient.messages.length, 1);

    const loggedIn = await service.loginAccount({
      username: 'testuser',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    assert.strictEqual(loggedIn.username, 'testuser');
    assert.strictEqual(loggedIn.emailVerified, false);
  });

  it('verifies a six-digit code and enables email settings', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({ emailClient });
    const { account } = await service.registerAccount({
      username: 'testuser',
      email: 'student@example.com',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });

    const verified = await service.verifyAccountEmail(account.id, latestEmailCode(emailClient));
    assert.strictEqual(verified.emailVerified, true);
    assert.strictEqual(verified.email, 'student@example.com');

    const updated = await service.updateAccountSettings(account.id, {
      notificationPreferences: { email: true }
    });
    assert.strictEqual(updated.settings.notificationPreferences.email, true);
  });

  it('expires verification codes after 15 minutes and resends a replacement', async () => {
    let current = new Date('2026-06-10T12:00:00Z');
    const emailClient = createCapturingEmailClient();
    const service = createTestService({ emailClient, now: () => current });
    const { account } = await service.registerAccount({
      username: 'testuser',
      email: 'student@example.com',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    const expiredCode = latestEmailCode(emailClient);

    current = new Date('2026-06-10T12:15:01Z');
    await assert.rejects(
      () => service.verifyAccountEmail(account.id, expiredCode),
      (error) => isServiceError(error, 400)
    );

    const resent = await service.resendAccountEmailVerification(account.id);
    assert.strictEqual(resent.emailSent, true);
    const replacementCode = latestEmailCode(emailClient);
    assert.strictEqual(emailClient.messages.length, 2);
    const verified = await service.verifyAccountEmail(account.id, replacementCode);
    assert.strictEqual(verified.emailVerified, true);
  });

  it('changes email only after the replacement address confirms its OTP', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({ emailClient });
    const { account } = await service.registerAccount({
      username: 'testuser',
      email: 'old@example.com',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    await service.verifyAccountEmail(account.id, latestEmailCode(emailClient));

    const requested = await service.requestAccountEmailChange(account.id, {
      newEmail: 'new@example.com',
      password: 'securepass12'
    });
    assert.strictEqual(requested.account.email, 'old@example.com');
    assert.strictEqual(requested.account.pendingEmail, 'new@example.com');

    const changed = await service.confirmAccountEmailChange(account.id, latestEmailCode(emailClient));
    assert.strictEqual(changed.email, 'new@example.com');
    assert.strictEqual(changed.emailVerified, true);
    assert.strictEqual(changed.pendingEmail, null);
  });
});

describe('Email account recovery', () => {
  it('resets a password by verified email and rotates the recovery code', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({ emailClient });
    const { account, recoveryCode } = await service.registerAccount({
      username: 'testuser',
      email: 'student@example.com',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    await service.verifyAccountEmail(account.id, latestEmailCode(emailClient));
    await service.requestAccountPasswordResetEmail({
      identifier: 'student@example.com',
      captchaToken: 'dev-pass'
    });

    const result = await service.resetAccountPasswordWithEmailCode({
      identifier: 'student@example.com',
      code: latestEmailCode(emailClient),
      newPassword: 'brandnewpass34',
      captchaToken: 'dev-pass'
    });
    assert.notStrictEqual(result.recoveryCode, recoveryCode);
    const loggedIn = await service.loginAccount({
      username: 'testuser',
      password: 'brandnewpass34',
      captchaToken: 'dev-pass'
    });
    assert.strictEqual(loggedIn.username, 'testuser');
  });

  it('regenerates a recovery code by verified email', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({ emailClient });
    const { account, recoveryCode } = await service.registerAccount({
      username: 'testuser',
      email: 'student@example.com',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });
    await service.verifyAccountEmail(account.id, latestEmailCode(emailClient));
    await service.requestRecoveryCodeResetEmail({
      identifier: 'testuser',
      captchaToken: 'dev-pass'
    });
    const result = await service.resetRecoveryCodeWithEmailCode({
      identifier: 'testuser',
      code: latestEmailCode(emailClient),
      captchaToken: 'dev-pass'
    });
    assert.notStrictEqual(result.recoveryCode, recoveryCode);
  });
});

describe('Forgot password (recovery code)', () => {
  it('resets the password with a valid recovery code and rotates it', async () => {
    const service = createTestService();
    const { recoveryCode } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });

    const result = await service.resetAccountPasswordWithRecoveryCode({
      username: 'testuser',
      recoveryCode,
      newPassword: 'brandnewpass34',
      captchaToken: 'dev-pass'
    });
    assert.notStrictEqual(result.recoveryCode, recoveryCode);

    // Old password no longer works; new one does.
    await assert.rejects(
      () => service.loginAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' }),
      (error) => isServiceError(error, 401)
    );
    const account = await service.loginAccount({ username: 'testuser', password: 'brandnewpass34', captchaToken: 'dev-pass' });
    assert.strictEqual(account.username, 'testuser');
  });

  it('accepts the recovery code regardless of dashes/case', async () => {
    const service = createTestService();
    const { recoveryCode } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    const messy = recoveryCode.replace(/-/g, '').toLowerCase();
    await service.resetAccountPasswordWithRecoveryCode({
      username: 'testuser',
      recoveryCode: messy,
      newPassword: 'brandnewpass34',
      captchaToken: 'dev-pass'
    });
    const account = await service.loginAccount({ username: 'testuser', password: 'brandnewpass34', captchaToken: 'dev-pass' });
    assert.strictEqual(account.username, 'testuser');
  });

  it('rejects an invalid recovery code without changing the password', async () => {
    const service = createTestService();
    await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    await assert.rejects(
      () => service.resetAccountPasswordWithRecoveryCode({
        username: 'testuser',
        recoveryCode: 'WRONG-CODE0-00000',
        newPassword: 'brandnewpass34',
        captchaToken: 'dev-pass'
      }),
      (error) => isServiceError(error, 400)
    );
    const account = await service.loginAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    assert.strictEqual(account.username, 'testuser');
  });

  it('uses the same error for unknown username and wrong code (no enumeration)', async () => {
    const service = createTestService();
    await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    const ghostError = await service.resetAccountPasswordWithRecoveryCode({
      username: 'ghost', recoveryCode: 'WRONG-CODE0-00000', newPassword: 'brandnewpass34', captchaToken: 'dev-pass'
    }).catch((error) => toServiceError(error));
    const wrongCodeError = await service.resetAccountPasswordWithRecoveryCode({
      username: 'testuser', recoveryCode: 'WRONG-CODE0-00000', newPassword: 'brandnewpass34', captchaToken: 'dev-pass'
    }).catch((error) => toServiceError(error));
    assert.strictEqual(ghostError.message, wrongCodeError.message);
    assert.strictEqual(ghostError.statusCode, wrongCodeError.statusCode);
  });

  it('rejects a recovery code already spent by a prior reset', async () => {
    const service = createTestService();
    const { recoveryCode } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    await service.resetAccountPasswordWithRecoveryCode({
      username: 'testuser', recoveryCode, newPassword: 'brandnewpass34', captchaToken: 'dev-pass'
    });
    await assert.rejects(
      () => service.resetAccountPasswordWithRecoveryCode({
        username: 'testuser', recoveryCode, newPassword: 'thirdpassword5', captchaToken: 'dev-pass'
      }),
      (error) => isServiceError(error, 400)
    );
  });

  it('regenerates a recovery code for a logged-in user with correct password', async () => {
    const service = createTestService();
    const { account, recoveryCode } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    const result = await service.regenerateRecoveryCode(account.id, 'securepass12');
    assert.notStrictEqual(result.recoveryCode, recoveryCode);

    // Old code no longer works, new one does.
    await assert.rejects(
      () => service.resetAccountPasswordWithRecoveryCode({
        username: 'testuser', recoveryCode, newPassword: 'brandnewpass34', captchaToken: 'dev-pass'
      }),
      (error) => isServiceError(error, 400)
    );
    await service.resetAccountPasswordWithRecoveryCode({
      username: 'testuser', recoveryCode: result.recoveryCode, newPassword: 'brandnewpass34', captchaToken: 'dev-pass'
    });
    const loggedIn = await service.loginAccount({ username: 'testuser', password: 'brandnewpass34', captchaToken: 'dev-pass' });
    assert.strictEqual(loggedIn.username, 'testuser');
  });

  it('rejects recovery code regeneration with wrong password', async () => {
    const service = createTestService();
    const { account } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    await assert.rejects(
      () => service.regenerateRecoveryCode(account.id, 'wrongpass99'),
      (error) => isServiceError(error, 401)
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
    const { account } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    const retrieved = await service.getAccount(account.id);
    assert.strictEqual(retrieved.username, 'testuser');
  });

  it('getAccount rejects unknown user id', async () => {
    const service = createTestService();
    await assert.rejects(
      () => service.getAccount('non-existent-id'),
      (error) => isServiceError(error, 401)
    );
  });
});

describe('Account settings', () => {
  it('updates settings for existing user', async () => {
    const service = createTestService();
    const { account } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    const updated = await service.updateAccountSettings(account.id, {
      theme: 'burichan',
      displayPreferences: {
        compactThreads: true,
        hideThumbnails: true,
        watchedUnreadOnly: true,
        watchedSort: 'board',
        commentComposerMode: 'normal',
        fontSize: 'large'
      },
      notificationPreferences: {
        email: true,
        watchedThreads: false,
        boardSubscriptions: true,
        browserWatchedThreads: true,
        browserBoardSubscriptions: true,
        browserMentions: true,
        emailMentions: true,
        emailDirectMessages: true
      },
      boardSubscriptions: ['confession', 'hoc-tap', 'unknown-board', 'confession'],
      hiddenBoards: ['an-uong', 'an-uong', 'unknown-board', 'hoc-tap']
    });
    assert.strictEqual(updated.settings.theme, 'burichan');
    assert.deepStrictEqual(updated.settings.displayPreferences, {
      compactThreads: true,
      hideThumbnails: true,
      watchedUnreadOnly: true,
      watchedSort: 'board',
      commentComposerMode: 'normal',
      fontSize: 'large'
    });
    assert.deepStrictEqual(updated.settings.notificationPreferences, {
      email: false,
      watchedThreads: false,
      boardSubscriptions: true,
      browserWatchedThreads: true,
      browserBoardSubscriptions: true,
      browserMentions: true,
      emailMentions: true,
      emailDirectMessages: true,
      directMessages: true,
      browserDirectMessages: false
    });
    assert.deepStrictEqual(updated.settings.boardSubscriptions, ['confession', 'hoc-tap']);
    assert.deepStrictEqual(updated.settings.hiddenBoards, ['an-uong', 'hoc-tap']);
    assert.strictEqual(updated.settings.emailNotifications, false);
  });

  it('rejects invalid theme', async () => {
    const service = createTestService();
    const { account } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    const updated = await service.updateAccountSettings(account.id, {
      theme: 'invalid-theme',
      displayPreferences: { commentComposerMode: 'side-panel', fontSize: 'huge' }
    });
    // Should keep the default theme instead of accepting invalid
    assert.strictEqual(updated.settings.theme, 'yotsuba-b');
    assert.strictEqual(updated.settings.displayPreferences.commentComposerMode, 'floating');
    assert.strictEqual(updated.settings.displayPreferences.fontSize, 'medium');
  });
});

describe('Verified email notifications', () => {
  it('sends subscribed-board and watched-thread notifications only after verification', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({ emailClient, appBaseUrl: 'https://example.com' });
    const { account } = await service.registerAccount({
      username: 'testuser',
      email: 'student@example.com',
      password: 'securepass12',
      captchaToken: 'dev-pass'
    });

    const unverifiedSettings = await service.updateAccountSettings(account.id, {
      notificationPreferences: { email: true, watchedThreads: true, boardSubscriptions: true },
      boardSubscriptions: ['hoc-tap']
    });
    assert.strictEqual(unverifiedSettings.settings.notificationPreferences.email, false);

    await service.verifyAccountEmail(account.id, latestEmailCode(emailClient));
    await service.updateAccountSettings(account.id, {
      notificationPreferences: { email: true, watchedThreads: true, boardSubscriptions: true },
      boardSubscriptions: ['hoc-tap']
    });
    emailClient.messages.length = 0;

    const created = await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'Chu de moi cho nguoi dang ky bang',
      captchaToken: 'dev-pass',
      ip: '203.0.113.10'
    } as Parameters<typeof service.createThread>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 1);
    assert.match(emailClient.messages[0].subject, /Chủ đề mới/);

    await service.updateAccountPrivateData(account.id, {
      watchlist: [{ threadId: created.thread.id, boardSlug: 'hoc-tap' }]
    });
    emailClient.messages.length = 0;
    await service.createComment({
      threadId: created.thread.id,
      body: 'Phan hoi moi cho watchlist',
      captchaToken: 'dev-pass',
      ip: '203.0.113.11'
    } as Parameters<typeof service.createComment>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 1);
    assert.match(emailClient.messages[0].subject, /Phản hồi mới/);
    assert.match(emailClient.messages[0].text, /https:\/\/example\.com\/#thread\//);
  });

  it('honors each board, watch, global email, and author exclusion independently', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({ emailClient, appBaseUrl: 'https://example.com' });
    const boardSubscriber = await registerVerifiedAccount(service, emailClient, 'boardsub');
    const threadWatcher = await registerVerifiedAccount(service, emailClient, 'watcher');

    await service.updateAccountSettings(boardSubscriber.id, {
      notificationPreferences: {
        email: true,
        watchedThreads: false,
        boardSubscriptions: true
      },
      boardSubscriptions: ['hoc-tap']
    });
    await service.updateAccountSettings(threadWatcher.id, {
      notificationPreferences: {
        email: true,
        watchedThreads: true,
        boardSubscriptions: false
      },
      boardSubscriptions: ['hoc-tap']
    });
    emailClient.messages.length = 0;

    await service.createThread({
      boardSlug: 'confession',
      body: 'Khong thuoc bang da dang ky',
      captchaToken: 'dev-pass',
      ip: '203.0.113.20'
    } as Parameters<typeof service.createThread>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);

    const thread = await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'Chi nguoi dang ky bang nhan thu nay',
      captchaToken: 'dev-pass',
      ip: '203.0.113.21'
    } as Parameters<typeof service.createThread>[0]);
    await service.flushEmailQueue();
    assert.deepStrictEqual(emailClient.messages.map((message) => message.to), ['boardsub@example.com']);

    await service.updateAccountPrivateData(threadWatcher.id, {
      watchlist: [{ threadId: thread.thread.id, boardSlug: 'hoc-tap' }]
    });
    emailClient.messages.length = 0;
    await service.createComment({
      threadId: thread.thread.id,
      body: 'Chi nguoi theo doi chu de nhan thu nay',
      captchaToken: 'dev-pass',
      ip: '203.0.113.22'
    } as Parameters<typeof service.createComment>[0]);
    await service.flushEmailQueue();
    assert.deepStrictEqual(emailClient.messages.map((message) => message.to), ['watcher@example.com']);

    emailClient.messages.length = 0;
    await service.createComment({
      threadId: thread.thread.id,
      body: 'Khong gui thong bao cho chinh tac gia',
      captchaToken: 'dev-pass',
      ip: '203.0.113.23',
      accountId: threadWatcher.id
    } as Parameters<typeof service.createComment>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);

    await service.updateAccountSettings(threadWatcher.id, {
      notificationPreferences: { email: false, watchedThreads: true }
    });
    await service.createComment({
      threadId: thread.thread.id,
      body: 'Thong bao email da tat',
      captchaToken: 'dev-pass',
      ip: '203.0.113.24'
    } as Parameters<typeof service.createComment>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);
  });

  it('sends exact @username mentions once without partial or email-address matches', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({ emailClient, appBaseUrl: 'https://example.com' });
    const recipient = await registerVerifiedAccount(service, emailClient, 'mention.user');
    await service.updateAccountSettings(recipient.id, {
      notificationPreferences: {
        email: true,
        watchedThreads: true,
        boardSubscriptions: false,
        emailMentions: true
      }
    });
    emailClient.messages.length = 0;

    const thread = await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'Chu de de kiem tra luot nhac',
      captchaToken: 'dev-pass',
      ip: '203.0.113.50'
    } as Parameters<typeof service.createThread>[0]);
    await service.updateAccountPrivateData(recipient.id, {
      watchlist: [{ threadId: thread.thread.id, boardSlug: 'hoc-tap' }]
    });

    await service.createComment({
      threadId: thread.thread.id,
      body: '@mention.user xem lich thi moi nhe',
      captchaToken: 'dev-pass',
      ip: '203.0.113.51'
    } as Parameters<typeof service.createComment>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 1);
    assert.match(emailClient.messages[0].subject, /được nhắc đến/);
    assert.match(emailClient.messages[0].text, /\?p=/);

    emailClient.messages.length = 0;
    await service.createComment({
      threadId: thread.thread.id,
      body: 'Khong khop @mention.user-extra va mention.user@example.com',
      captchaToken: 'dev-pass',
      ip: '203.0.113.52'
    } as Parameters<typeof service.createComment>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 1);
    assert.match(emailClient.messages[0].subject, /Phản hồi mới/);

    emailClient.messages.length = 0;
    await service.createComment({
      threadId: thread.thread.id,
      body: '@mention.user khong gui cho chinh tac gia',
      captchaToken: 'dev-pass',
      ip: '203.0.113.53',
      accountId: recipient.id
    } as Parameters<typeof service.createComment>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);

    await service.updateAccountPrivateData(recipient.id, { watchlist: [] });
    await service.updateAccountSettings(recipient.id, {
      notificationPreferences: { email: true, emailMentions: false }
    });
    await service.createComment({
      threadId: thread.thread.id,
      body: '@mention.user da tat email luot nhac',
      captchaToken: 'dev-pass',
      ip: '203.0.113.54'
    } as Parameters<typeof service.createComment>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);
  });

  it('queues mention email only after moderation approval and never after deletion', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({
      emailClient,
      ai: { moderate: async () => ({ status: 'Flagged', labels: ['Toxic'] }) }
    });
    const recipient = await registerVerifiedAccount(service, emailClient, 'mentionmod');
    await service.updateAccountSettings(recipient.id, {
      notificationPreferences: {
        email: true,
        watchedThreads: false,
        boardSubscriptions: false,
        emailMentions: true
      }
    });
    emailClient.messages.length = 0;

    const approved = await service.createThread({
      boardSlug: 'hoc-tap',
      body: '@mentionmod chu de dang cho duyet',
      captchaToken: 'dev-pass',
      ip: '203.0.113.55'
    } as Parameters<typeof service.createThread>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);
    await service.approvePending(approved.thread.id);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 1);
    assert.match(emailClient.messages[0].subject, /được nhắc đến/);

    emailClient.messages.length = 0;
    const deleted = await service.createComment({
      threadId: approved.thread.id,
      body: '@mentionmod phan hoi se bi xoa',
      captchaToken: 'dev-pass',
      ip: '203.0.113.56'
    } as Parameters<typeof service.createComment>[0]);
    await service.deletePending(deleted.comment.id);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);
  });

  it('delivers pending notifications once only after approval and never after deletion', async () => {
    const emailClient = createCapturingEmailClient();
    const service = createTestService({
      emailClient,
      appBaseUrl: 'https://example.com',
      ai: { moderate: async () => ({ status: 'Flagged', labels: ['Toxic'] }) }
    });
    const account = await registerVerifiedAccount(service, emailClient, 'moderatorflow');
    await service.updateAccountSettings(account.id, {
      notificationPreferences: {
        email: true,
        watchedThreads: true,
        boardSubscriptions: true
      },
      boardSubscriptions: ['hoc-tap']
    });
    emailClient.messages.length = 0;

    const pendingThread = await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'Chu de dang cho duyet',
      captchaToken: 'dev-pass',
      ip: '203.0.113.30'
    } as Parameters<typeof service.createThread>[0]);
    assert.strictEqual(pendingThread.status, 'pending');
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);

    await service.approvePending(pendingThread.thread.id);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 1);
    assert.match(emailClient.messages[0].subject, /Chủ đề mới/);

    await service.updateAccountPrivateData(account.id, {
      watchlist: [{ threadId: pendingThread.thread.id, boardSlug: 'hoc-tap' }]
    });
    emailClient.messages.length = 0;
    const pendingComment = await service.createComment({
      threadId: pendingThread.thread.id,
      body: 'Phan hoi dang cho duyet',
      captchaToken: 'dev-pass',
      ip: '203.0.113.31'
    } as Parameters<typeof service.createComment>[0]);
    assert.strictEqual(pendingComment.status, 'pending');
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);

    await service.approvePending(pendingComment.comment.id);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 1);
    assert.match(emailClient.messages[0].subject, /Phản hồi mới/);

    emailClient.messages.length = 0;
    const deletedComment = await service.createComment({
      threadId: pendingThread.thread.id,
      body: 'Phan hoi se bi xoa',
      captchaToken: 'dev-pass',
      ip: '203.0.113.32'
    } as Parameters<typeof service.createComment>[0]);
    await service.deletePending(deletedComment.comment.id);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 0);
  });

  it('keeps posting and later notification batches healthy after an email delivery failure', async () => {
    const emailClient = createCapturingEmailClient();
    const originalSend = emailClient.send;
    let failNotifications = false;
    emailClient.send = async (message) => {
      if (failNotifications) {
        throw new Error('temporary email outage');
      }
      return originalSend.call(emailClient, message);
    };
    const service = createTestService({ emailClient });
    const account = await registerVerifiedAccount(service, emailClient, 'mailretry');
    await service.updateAccountSettings(account.id, {
      notificationPreferences: { email: true, boardSubscriptions: true },
      boardSubscriptions: ['hoc-tap']
    });
    emailClient.messages.length = 0;

    failNotifications = true;
    const duringOutage = await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'Bai van duoc dang khi email loi',
      captchaToken: 'dev-pass',
      ip: '203.0.113.40'
    } as Parameters<typeof service.createThread>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(duringOutage.status, 'published');
    assert.strictEqual(emailClient.messages.length, 0);

    failNotifications = false;
    await service.createThread({
      boardSlug: 'hoc-tap',
      body: 'Lo email sau phuc hoi van hoat dong',
      captchaToken: 'dev-pass',
      ip: '203.0.113.41'
    } as Parameters<typeof service.createThread>[0]);
    await service.flushEmailQueue();
    assert.strictEqual(emailClient.messages.length, 1);
  });
});

describe('Account private data', () => {
  it('syncs watchlist, drafts, saved searches, content filters, reply templates and poster notes for existing user', async () => {
    const service = createTestService();
    const { account } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
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
      ],
      contentFilters: [
        {
          id: 'filter-1',
          type: 'keyword',
          value: 'spoiler exam',
          label: 'exam spoiler'
        },
        {
          type: 'poster',
          value: 'ID:ABCD1234',
          label: 'noisy poster',
          boardSlug: 'hoc-tap'
        },
        {
          type: 'invalid',
          value: 'drop me'
        }
      ],
      replyTemplates: [
        {
          id: 'template-1',
          title: 'Can hoi them',
          body: 'Ban co the noi ro hon khong?',
          boardSlug: 'hoc-tap'
        },
        {
          title: 'Bo trong',
          body: ''
        }
      ],
      posterNotes: [
        {
          id: 'note-1',
          posterId: 'ID:ABCD1234',
          label: 'Nguoi hay spam',
          note: 'Thuong lap lai mot noi dung',
          boardSlug: 'hoc-tap'
        },
        {
          posterId: '',
          label: 'Bo qua'
        }
      ],
      hiddenPosts: ['42', 42, ' 99 ', '', '42'],
      hiddenThreads: ['thread-hidden-1', 'thread-hidden-1', '  thread-hidden-2  ']
    });

    assert.equal(data.watchlist.length, 1);
    assert.equal(data.watchlist[0].threadId, 'thread-1');
    assert.equal(data.drafts.length, 1);
    assert.equal(data.drafts[0].body, 'Ban nhap rieng tu');
    assert.equal(data.savedSearches.length, 1);
    assert.equal(data.contentFilters.length, 2);
    assert.equal(data.contentFilters[0].type, 'keyword');
    assert.equal(data.contentFilters[1].boardSlug, 'hoc-tap');
    assert.equal(data.replyTemplates.length, 1);
    assert.equal(data.replyTemplates[0].title, 'Can hoi them');
    assert.equal(data.posterNotes.length, 1);
    assert.equal(data.posterNotes[0].posterId, 'ID:ABCD1234');
    assert.equal(data.posterNotes[0].boardSlug, 'hoc-tap');
    assert.deepEqual(data.hiddenPosts, ['42', '99']);
    assert.deepEqual(data.hiddenThreads, ['thread-hidden-1', 'thread-hidden-2']);

    const retrieved = await service.getAccountPrivateData(account.id);
    assert.deepEqual(retrieved, data);
  });

  it('clears one section or all private data', async () => {
    const service = createTestService();
    const { account } = await service.registerAccount({ username: 'testuser', password: 'securepass12', captchaToken: 'dev-pass' });
    await service.updateAccountPrivateData(account.id, {
      watchlist: [{ threadId: 'thread-1' }],
      drafts: [{ key: 'draft:thread:hoc-tap', body: 'Draft' }],
      savedSearches: [{ boardSlug: 'hoc-tap', query: 'exam' }],
      contentFilters: [{ type: 'keyword', value: 'spoiler' }],
      replyTemplates: [{ title: 'Hoi them', body: 'Ban noi them duoc khong?' }],
      posterNotes: [{ posterId: 'ID:ABCD1234', label: 'Nguoi quen' }],
      hiddenPosts: ['10', '20'],
      hiddenThreads: ['thread-a']
    });

    const withoutDrafts = await service.clearAccountPrivateData(account.id, 'drafts');
    assert.equal(withoutDrafts.watchlist.length, 1);
    assert.equal(withoutDrafts.drafts.length, 0);
    assert.equal(withoutDrafts.savedSearches.length, 1);
    assert.equal(withoutDrafts.contentFilters.length, 1);
    assert.equal(withoutDrafts.replyTemplates.length, 1);
    assert.equal(withoutDrafts.posterNotes.length, 1);
    assert.equal(withoutDrafts.hiddenPosts.length, 2);
    assert.equal(withoutDrafts.hiddenThreads.length, 1);

    const withoutFilters = await service.clearAccountPrivateData(account.id, 'contentFilters');
    assert.equal(withoutFilters.watchlist.length, 1);
    assert.equal(withoutFilters.contentFilters.length, 0);

    const withoutTemplates = await service.clearAccountPrivateData(account.id, 'replyTemplates');
    assert.equal(withoutTemplates.watchlist.length, 1);
    assert.equal(withoutTemplates.replyTemplates.length, 0);

    const withoutPosterNotes = await service.clearAccountPrivateData(account.id, 'posterNotes');
    assert.equal(withoutPosterNotes.watchlist.length, 1);
    assert.equal(withoutPosterNotes.posterNotes.length, 0);

    const withoutHiddenPosts = await service.clearAccountPrivateData(account.id, 'hiddenPosts');
    assert.equal(withoutHiddenPosts.hiddenPosts.length, 0);
    assert.equal(withoutHiddenPosts.hiddenThreads.length, 1);

    const withoutHiddenThreads = await service.clearAccountPrivateData(account.id, 'hiddenThreads');
    assert.equal(withoutHiddenThreads.hiddenThreads.length, 0);

    const empty = await service.clearAccountPrivateData(account.id);
    assert.deepEqual(empty, {
      watchlist: [],
      drafts: [],
      savedSearches: [],
      contentFilters: [],
      replyTemplates: [],
      posterNotes: [],
      hiddenPosts: [],
      hiddenThreads: []
    });
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
    } as Parameters<typeof service.createThread>[0]);
    assert.ok(result.thread);
    assert.strictEqual(result.thread.displayName, 'Anonymous');
  });
});
