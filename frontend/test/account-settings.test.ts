import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { accountEmailNotificationState } from '../legacy/account-settings-availability.ts';
import { filterHiddenBoards, isHiddenBoardSlug } from '../legacy/board-visibility.ts';

const accountPreferencesSource = readFileSync(
  new URL('../legacy/account-preferences.ts', import.meta.url),
  'utf8',
);
const accountFormEventsSource = readFileSync(
  new URL('../legacy/account-form-events.ts', import.meta.url),
  'utf8',
);
const homeSource = readFileSync(
  new URL('../legacy/home.ts', import.meta.url),
  'utf8',
);
const accountUiSource = readFileSync(
  new URL('../legacy/account-ui.ts', import.meta.url),
  'utf8',
);
const adminAuthEventsSource = readFileSync(
  new URL('../legacy/admin-auth-events.ts', import.meta.url),
  'utf8',
);

test('disables and clears email notifications for guests', () => {
  assert.deepEqual(
    accountEmailNotificationState({
      loggedIn: false,
      emailVerified: false,
      requested: true,
    }),
    {
      checked: false,
      disabled: true,
      statusText: 'Đăng nhập và xác nhận email để bật thông báo email.',
    },
  );
});

test('keeps email notifications disabled until the signed-in email is verified', () => {
  const unverified = accountEmailNotificationState({
    loggedIn: true,
    emailVerified: false,
    requested: true,
    email: 'member@example.com',
  });
  assert.equal(unverified.checked, false);
  assert.equal(unverified.disabled, true);

  assert.deepEqual(
    accountEmailNotificationState({
      loggedIn: true,
      emailVerified: true,
      requested: true,
      email: 'member@example.com',
    }),
    {
      checked: true,
      disabled: false,
      statusText: 'Thông báo sẽ gửi tới member@example.com.',
    },
  );
});

test('filters locally hidden boards without requiring account state', () => {
  const boards = [
    { slug: 'confession', name: 'Thú nhận' },
    { slug: 'hoc-tap', name: 'Học tập' },
  ];
  const hidden = new Set(['hoc-tap']);

  assert.equal(isHiddenBoardSlug('hoc-tap', hidden), true);
  assert.deepEqual(filterHiddenBoards(boards, hidden), [boards[0]]);
  assert.strictEqual(filterHiddenBoards(boards, []), boards);
});

test('persists guest hidden-board selections instead of clearing them at auth boundaries', () => {
  assert.match(accountPreferencesSource, /hiddenBoards: \[\.\.\.hiddenBoardSlugs\(\)\]/);
  assert.doesNotMatch(accountPreferencesSource, /hiddenBoards: state\.accountToken/);
  assert.doesNotMatch(accountPreferencesSource, /writeHiddenBoardSlugs\(\[\]\)/);

  assert.match(
    accountFormEventsSource,
    /writeHiddenBoardSlugs\?\.\(hiddenBoards\)[\s\S]*if \(!state\.accountToken \|\| !state\.account\)/,
  );
  assert.doesNotMatch(accountFormEventsSource, /writeHiddenBoardSlugs\?\.\(\[\]\)/);

  assert.match(homeSource, /return filterHiddenBoards\(list, hidden\)/);
  assert.doesNotMatch(homeSource, /if \(!state\.accountToken \|\| !state\.account\)/);
});

test('renders browser-stored hidden threads before guest session startup returns', () => {
  assert.match(
    accountUiSource,
    /async function loadAccountSession\(\) \{\s*updateAccountNav\(\);\s*renderBrowserHiddenData\(\);\s*if \(!state\.accountToken\)/,
  );
});

test('renders hidden threads in the topbar without the account summary panel', () => {
  const topbarRenderIndex = accountUiSource.indexOf('if (els.topbarHiddenThreadsCount)');
  const accountSummaryGuardIndex = accountUiSource.indexOf('if (!els.browserHiddenSummary)');

  assert.notEqual(topbarRenderIndex, -1);
  assert.ok(accountSummaryGuardIndex > topbarRenderIndex);
});

test('escapes decoded popular-thread previews before assigning innerHTML', () => {
  assert.match(
    homeSource,
    /const title = plainPreview\(thread\.bodyLines, board\?\.description\)\.slice\(0, 120\)/,
  );
  assert.match(homeSource, /<span>\$\{escapeHtml\(title\)\}/);
  assert.match(
    homeSource,
    /<strong>\$\{escapeHtml\(board\?\.name \|\| thread\.boardSlug\)\}/,
  );
});

test('revokes the admin session server-side before clearing local state', () => {
  assert.match(
    adminAuthEventsSource,
    /api\('\/api\/account\/logout', \{ auth: 'admin', method: 'POST' \}\)/,
  );
  assert.match(adminAuthEventsSource, /finally \{[\s\S]*clearAdminToken\(\)/);
});
