import assert from 'node:assert/strict';
import test from 'node:test';

import { legacyHashForPath } from '../lib/routes.ts';
import { contentSecurityPolicy } from '../lib/security-headers.ts';
import {
  authenticatedAccountRedirectHash,
  createRouterController,
} from '../legacy/router.ts';

test('maps home and static account paths', () => {
  assert.equal(legacyHashForPath('/'), '#home');
  assert.equal(legacyHashForPath('/home/'), '#home');
  assert.equal(legacyHashForPath('/register'), '#register');
  assert.equal(legacyHashForPath('/login'), '#login');
  assert.equal(legacyHashForPath('/forgot'), '#forgot');
  assert.equal(legacyHashForPath('/account'), '#account');
  assert.equal(legacyHashForPath('/admin'), '#admin');
  assert.equal(legacyHashForPath('/HOME'), '#home');
});

test('production CSP uses a request nonce without unsafe-inline scripts', () => {
  const policy = contentSecurityPolicy('0123456789abcdef0123456789abcdef');
  assert.match(policy, /script-src[^;]*'nonce-0123456789abcdef0123456789abcdef'/);
  assert.match(policy, /script-src[^;]*'strict-dynamic'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-eval'/);
});

test('maps board and thread paths with canonical segments and queries', () => {
  assert.equal(legacyHashForPath('/Board/Confession'), '#board/Confession');
  assert.equal(
    legacyHashForPath('/board/chuy%E1%BB%87n-tr%C3%B2', '?q=xin%20ch%C3%A0o&sort=new'),
    '#board/chuy%E1%BB%87n-tr%C3%B2?q=xin+ch%C3%A0o&sort=new',
  );
  assert.equal(
    legacyHashForPath('/thread/thread%2F42/', 'cp=3&p=120'),
    '#thread/thread%2F42?cp=3&p=120',
  );
});

test('maps catalog, archive, and policy paths', () => {
  assert.equal(legacyHashForPath('/catalog/confession'), '#catalog/confession');
  assert.equal(legacyHashForPath('/archive/tin-t%E1%BB%A9c'), '#archive/tin-t%E1%BB%A9c');
  assert.equal(legacyHashForPath('/policy'), '#policy');
  assert.equal(legacyHashForPath('/policy/privacy'), '#policy/privacy');
});

test('maps messages with an optional conversation id', () => {
  assert.equal(legacyHashForPath('/messages'), '#messages');
  assert.equal(
    legacyHashForPath('/messages/ng%C6%B0%E1%BB%9Di-d%C3%B9ng'),
    '#messages/ng%C6%B0%E1%BB%9Di-d%C3%B9ng',
  );
});

test('does not attach irrelevant queries to static routes', () => {
  assert.equal(legacyHashForPath('/catalog/confession', '?q=ignored'), '#catalog/confession');
  assert.equal(legacyHashForPath('/login', '?next=%2Faccount'), '#login');
});

test('returns null for unknown, malformed, or over-nested paths', () => {
  assert.equal(legacyHashForPath('/unknown'), null);
  assert.equal(legacyHashForPath('/board'), null);
  assert.equal(legacyHashForPath('/board/a/extra'), null);
  assert.equal(legacyHashForPath('/board//a'), null);
  assert.equal(legacyHashForPath('/thread/%E0%A4%A'), null);
  assert.equal(legacyHashForPath('board/a'), null);
  assert.equal(legacyHashForPath('/board/a?sort=new'), null);
});

test('replaces stale account entry routes after account session restoration', () => {
  for (const hash of ['#login', '#register', '#forgot', '#forgot?source=history']) {
    assert.equal(authenticatedAccountRedirectHash(hash, true), '#account');
  }

  assert.equal(authenticatedAccountRedirectHash('#login', false), null);
  assert.equal(authenticatedAccountRedirectHash('#account', true), null);
  assert.equal(authenticatedAccountRedirectHash('#home', true), null);
});

test('routes an authenticated history visit to account settings without pushing history', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const replacementUrls: string[] = [];
  let accountLoads = 0;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { hash: '#forgot' },
      history: {
        state: { navigation: 'back' },
        replaceState(_state: unknown, _unused: string, url: string) {
          replacementUrls.push(url);
        },
      },
    },
  });

  try {
    const controller = createRouterController({
      els: { quickReply: null },
      state: { accountToken: 'account-token', account: { username: 'member' } },
      hideReferencePreview() {},
      loadAccountSettings() {
        accountLoads += 1;
      },
      setupRealtime() {},
      showToast() {},
    });

    await controller.route({ propagateErrors: true });

    assert.deepEqual(replacementUrls, ['#account']);
    assert.equal(accountLoads, 1);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});
