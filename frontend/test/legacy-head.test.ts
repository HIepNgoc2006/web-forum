import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { legacyShellHtml } from '../generated/legacy-shell.ts';
import { translateUiText } from '../legacy/i18n.ts';
import {
  legacyBodyClassScript,
  legacyInitialRouteMarkup,
} from '../lib/legacy-head.ts';

const legacyHeadSource = readFileSync(
  new URL('../legacy-shell/index-partials/head.html', import.meta.url),
  'utf8',
);
const legacyHomeSource = readFileSync(
  new URL('../legacy-shell/index-partials/home.html', import.meta.url),
  'utf8',
);
const legacyChatbotSource = readFileSync(
  new URL('../legacy-shell/index-partials/chatbot.html', import.meta.url),
  'utf8',
);
const legacyTopbarSource = readFileSync(
  new URL('../legacy-shell/index-partials/topbar.html', import.meta.url),
  'utf8',
);
const legacyAccountSource = readFileSync(
  new URL('../legacy-shell/index-partials/account.html', import.meta.url),
  'utf8',
);

function initialScreen(pathname: string, hash = ''): string {
  const markup = legacyInitialRouteMarkup(legacyHeadSource);
  const script = markup.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'Legacy first-paint script is missing.');
  const dataset: Record<string, string> = {};
  runInNewContext(script, {
    location: { hash, pathname, search: '' },
    document: { documentElement: { dataset } },
  });
  return dataset.initialScreen || '';
}

test('keeps only the legacy first-paint route script and style', () => {
  const head = [
    '<meta charset="utf-8">',
    '<title>36chan</title>',
    '<script>document.documentElement.dataset.initialScreen = "board";</script>',
    '<style id="initial-route-style">#boardScreen{display:block}</style>',
    '<link rel="icon" href="/favicon.svg">',
  ].join('');

  const markup = legacyInitialRouteMarkup(head);
  assert.match(markup, /dataset\.initialScreen/);
  assert.match(markup, /initial-route-style/);
  assert.doesNotMatch(markup, /<meta|<title|<link/);
});

test('uses home for the hashless legacy alias and normalizes route-name case', () => {
  assert.equal(initialScreen('/legacy'), 'home');
  assert.equal(initialScreen('/HOME'), 'home');
  assert.equal(initialScreen('/Board/confession'), 'board');
});

test('applies the initial route body class before legacy content renders', () => {
  const classes = new Set<string>();
  const script = legacyBodyClassScript(legacyShellHtml);
  assert.ok(script, 'Legacy body-class script is missing.');
  runInNewContext(script, {
    document: {
      documentElement: { dataset: { initialScreen: 'home' } },
      body: {
        classList: {
          toggle(name: string, force: boolean) {
            if (force) classes.add(name);
            else classes.delete(name);
          },
        },
      },
    },
  });
  assert.equal(classes.has('home-page'), true);
  assert.equal(classes.has('policy-page'), false);
  assert.equal(classes.has('account-page'), false);
  assert.equal(classes.has('board-page'), false);
});

test('omits incomplete legacy route initialization markup', () => {
  assert.equal(
    legacyInitialRouteMarkup(
      '<script>document.documentElement.dataset.initialScreen = "board";</script>',
    ),
    '',
  );
  assert.equal(
    legacyInitialRouteMarkup(
      '<style id="initial-route-style">#boardScreen{display:block}</style>',
    ),
    '',
  );
});

test('keeps the generated legacy shell free of inert home controls', () => {
  for (const source of [legacyHomeSource, legacyShellHtml]) {
    assert.doesNotMatch(source, /homeFilterButton/);
    assert.doesNotMatch(source, /homeOptionsButton/);
  }
});

test('includes the visible AI launcher label in its accessible name', () => {
  assert.match(legacyChatbotSource, /aria-label="AI Hỏi AI, mở trợ lý AI"/);
  assert.match(legacyChatbotSource, /<span>Hỏi AI<\/span>/);
  assert.match(legacyShellHtml, /aria-label="AI Hỏi AI, mở trợ lý AI"/);
});

test('includes the topbar hidden-thread menu and restore target', () => {
  for (const source of [legacyTopbarSource, legacyShellHtml]) {
    assert.match(source, /id="topbarHiddenThreadsMenu"/);
    assert.match(source, /id="topbarHiddenThreadsList"/);
    assert.match(source, /class="board-nav-row"[\s\S]*id="boardNav"[\s\S]*id="topbarHiddenThreadsMenu"/);
    assert.match(source, /<span>Khác<\/span>/);
    assert.doesNotMatch(source, /Khác \/ Other/);
  }
});

test('translates the hidden-thread menu', () => {
  assert.equal(translateUiText('Khác', 'vi'), 'Khác');
  assert.equal(translateUiText('Khác', 'en'), 'Other');
  assert.equal(translateUiText('Chủ đề đã ẩn', 'en'), 'Hidden threads');
  assert.equal(translateUiText('Quản lý nội dung đã ẩn', 'en'), 'Manage hidden content');
  assert.equal(translateUiText('3 chủ đề đã ẩn', 'en'), '3 hidden threads');
});

test('keeps guest account settings localized and email-only controls unavailable', () => {
  for (const source of [legacyAccountSource, legacyShellHtml]) {
    assert.match(
      source,
      /id="accountEmailNotifications"[^>]*aria-describedby="accountEmailNotificationStatus"[^>]*disabled/,
    );
    assert.match(source, /Ẩn ảnh thu nhỏ/);
    assert.match(source, /Danh sách theo dõi chỉ hiện mục chưa đọc/);
    assert.match(source, /Sắp xếp danh sách theo dõi/);
    assert.match(source, /Email: chủ đề đang theo dõi/);
    assert.match(source, /Email: bảng đang theo dõi/);
    assert.match(source, /Trong trang: tin nhắn riêng/);
    assert.match(source, /id="accountBrowserNotifyBoardSubscriptions"/);
    assert.match(source, /id="accountBrowserNotifyMentions"/);
    assert.match(source, /id="accountEmailNotifyMentions"[^>]*disabled/);
    assert.match(source, /id="accountEmailNotifyDirectMessages"[^>]*disabled/);
    assert.doesNotMatch(
      source,
      /Ẩn thumbnail|Watchlist chỉ chưa đọc|Thread đang theo dõi|Tin nhắn riêng \(toast\)|post public|dòng stub đỏ/,
    );
  }

  assert.equal(translateUiText('Ẩn ảnh thu nhỏ', 'en'), 'Hide thumbnails');
  assert.equal(translateUiText('Email: bật thông báo', 'en'), 'Email: enable notifications');
  assert.equal(translateUiText('Email: chủ đề đang theo dõi', 'en'), 'Email: watched threads');
  assert.equal(translateUiText('Email: bảng đang theo dõi', 'en'), 'Email: subscribed boards');
  assert.equal(translateUiText('Trong trang: tin nhắn riêng', 'en'), 'In-page: direct messages');
  assert.equal(translateUiText('Trình duyệt: bảng đang theo dõi', 'en'), 'Browser: subscribed boards');
  assert.equal(translateUiText('Trình duyệt: lượt nhắc @tên', 'en'), 'Browser: @username mentions');
  assert.equal(translateUiText('Email: lượt nhắc @tên', 'en'), 'Email: @username mentions');
  assert.equal(translateUiText('Email: tin nhắn riêng', 'en'), 'Email: direct messages');
  assert.equal(
    translateUiText('Đăng nhập và xác nhận email để bật thông báo email.', 'en'),
    'Sign in and verify your email to enable email notifications.',
  );
});
