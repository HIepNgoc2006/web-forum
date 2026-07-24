import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';

import {
  browserNotificationPermission,
  browserNotificationStatusText,
  browserNotificationsSupported,
  notifyDirectMessage,
  notifySubscribedBoardThread,
  notifyTaggedPost,
  notifyWatchedThreadPost,
  postMentionsUsername,
  rememberBrowserNotificationId,
  resolveBrowserWatchedThreadPreference
} from '../legacy/notification-runtime.ts';

type NotificationRecord = {
  title: string;
  options: NotificationOptions;
  onclick: (() => void) | null;
  closed: boolean;
  close: () => void;
};

const values = new Map<string, string>();
const notifications: NotificationRecord[] = [];
const realtimeSource = readFileSync(
  new URL('../legacy/realtime.ts', import.meta.url),
  'utf8'
);
let focused = 0;

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission: () => Promise<NotificationPermission> = async () => 'granted';

  title: string;
  options: NotificationOptions;
  onclick: (() => void) | null = null;
  closed = false;

  constructor(title: string, options: NotificationOptions = {}) {
    this.title = title;
    this.options = options;
    notifications.push(this);
  }

  close() {
    this.closed = true;
  }
}

function setPreferences(preferences = {}) {
  values.set('notificationPreferences', JSON.stringify(preferences));
}

function watchedDependencies(watchedThreads, overrides = {}) {
  const writes: unknown[] = [];
  return {
    writes,
    dependencies: {
      readWatchedThreads: () => watchedThreads,
      writeWatchedThreads: (value) => writes.push(structuredClone(value)),
      browserNotificationIds: new Set<string>(),
      ...overrides
    }
  };
}

beforeEach(() => {
  values.clear();
  notifications.length = 0;
  focused = 0;
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission = async () => 'granted';
  (globalThis as any).localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key)
  };
  (globalThis as any).window = {
    Notification: FakeNotification,
    focus: () => {
      focused += 1;
    },
    location: { hash: '' }
  };
});

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).localStorage;
});

test('reports browser support, permission, and every settings status', () => {
  assert.equal(browserNotificationsSupported(), true);
  assert.equal(browserNotificationPermission(), 'default');
  assert.equal(
    browserNotificationStatusText({}, false, 'unsupported'),
    'Trình duyệt này không hỗ trợ thông báo trình duyệt.'
  );
  assert.equal(
    browserNotificationStatusText({}, true, 'denied'),
    'Trình duyệt đang chặn thông báo của trang này.'
  );
  assert.equal(
    browserNotificationStatusText({ browserWatchedThreads: true }, true, 'granted'),
    'Thông báo trình duyệt đang bật (bảng / chủ đề / lượt nhắc / tin nhắn riêng).'
  );
  assert.equal(
    browserNotificationStatusText({}, true, 'granted'),
    'Đã cấp quyền thông báo trình duyệt; các tùy chọn đang tắt.'
  );
  assert.equal(
    browserNotificationStatusText({ browserDirectMessages: true }, true, 'default'),
    'Cần cấp quyền thông báo trình duyệt khi lưu cài đặt.'
  );
  assert.equal(
    browserNotificationStatusText({}, true, 'default'),
    'Tắt thông báo trình duyệt cho chủ đề / tin nhắn riêng.'
  );

  delete (globalThis as any).window.Notification;
  assert.equal(browserNotificationsSupported(), false);
  assert.equal(browserNotificationPermission(), 'unsupported');
});

test('uses authenticated Socket.IO rooms while keeping screen refreshes route-scoped', () => {
  assert.ok(realtimeSource.includes("from 'socket.io-client'"));
  assert.ok(realtimeSource.includes('path: SOCKET_IO_PATH'));
  assert.ok(realtimeSource.includes('auth: { accountToken, adminToken }'));
  assert.ok(realtimeSource.includes("source.emit('realtime:scope'"));
  assert.ok(realtimeSource.includes("eventName === 'dm:read'"));
  assert.equal(realtimeSource.includes('new EventSource'), false);
});

test('handles permission already granted, blocked, unsupported, dismissed, and failed', async () => {
  const toasts: string[] = [];
  const toast = (message: string) => toasts.push(message);

  assert.equal(await resolveBrowserWatchedThreadPreference(false, toast), false);
  assert.deepEqual(toasts, []);

  FakeNotification.permission = 'granted';
  assert.equal(await resolveBrowserWatchedThreadPreference(true, toast), true);

  FakeNotification.permission = 'denied';
  assert.equal(await resolveBrowserWatchedThreadPreference(true, toast), false);
  assert.match(toasts.at(-1) || '', /bị chặn/);

  FakeNotification.permission = 'default';
  FakeNotification.requestPermission = async () => 'default';
  assert.equal(await resolveBrowserWatchedThreadPreference(true, toast), false);
  assert.match(toasts.at(-1) || '', /Chưa cấp quyền/);

  FakeNotification.requestPermission = async () => 'denied';
  assert.equal(await resolveBrowserWatchedThreadPreference(true, toast), false);
  assert.match(toasts.at(-1) || '', /từ chối/);

  FakeNotification.requestPermission = async () => {
    throw new Error('browser failure');
  };
  assert.equal(await resolveBrowserWatchedThreadPreference(true, toast), false);
  assert.match(toasts.at(-1) || '', /Không thể xin quyền/);

  delete (globalThis as any).window.Notification;
  assert.equal(await resolveBrowserWatchedThreadPreference(true, toast), false);
  assert.match(toasts.at(-1) || '', /không hỗ trợ/);
});

test('bounds the shared realtime delivery cache to the newest 100 ids', () => {
  const ids = new Set<string>();
  for (let index = 0; index < 101; index += 1) {
    rememberBrowserNotificationId(ids, `event-${index}`);
  }
  rememberBrowserNotificationId(ids, '');

  assert.equal(ids.size, 100);
  assert.equal(ids.has('event-0'), false);
  assert.equal(ids.has('event-100'), true);
});

test('updates watched unread state even when browser notifications are disabled', () => {
  setPreferences({ browserWatchedThreads: false });
  const watched = {
    'thread-1': {
      boardSlug: 'hoc-tap',
      globalNumber: 10,
      lastSeen: 10,
      maxNumber: 10,
      replyCount: 0
    }
  };
  const { dependencies, writes } = watchedDependencies(watched);

  notifyWatchedThreadPost({
    threadId: 'thread-1',
    comment: { id: 'comment-1', globalNumber: 12, createdAt: '2026-07-23T10:00:00Z' }
  }, dependencies);

  assert.equal(watched['thread-1'].maxNumber, 12);
  assert.equal(watched['thread-1'].replyCount, 1);
  assert.equal(writes.length, 1);
  assert.equal(notifications.length, 0);
});

test('repairs corrupt watched counters while processing a valid new reply', () => {
  setPreferences({ browserWatchedThreads: false });
  const watched = {
    'thread-1': {
      globalNumber: 10,
      lastSeen: 'invalid',
      maxNumber: 'invalid',
      replyCount: 'invalid'
    }
  };
  const { dependencies } = watchedDependencies(watched);

  notifyWatchedThreadPost({
    threadId: 'thread-1',
    comment: { id: 'comment-1', globalNumber: 12 }
  }, dependencies);

  assert.equal(watched['thread-1'].maxNumber, 12);
  assert.equal(watched['thread-1'].replyCount, 1);
});

test('shows a watched-thread notification and navigates to the exact reply', () => {
  setPreferences({ browserWatchedThreads: true });
  FakeNotification.permission = 'granted';
  const watched = {
    'thread/id': {
      boardPath: '/hoc-tap/',
      globalNumber: 10,
      lastSeen: 10,
      maxNumber: 10,
      replyCount: 0
    }
  };
  const { dependencies } = watchedDependencies(watched);

  notifyWatchedThreadPost({
    threadId: 'thread/id',
    comment: {
      id: 'comment-1',
      globalNumber: 12,
      bodyLines: [{ type: 'text', text: 'Phản hồi mới' }]
    }
  }, dependencies);

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, '/hoc-tap/ No.10');
  assert.equal(notifications[0].options.body, 'Phản hồi mới');
  assert.equal(notifications[0].options.tag, 'watched-thread-thread/id');
  assert.equal((notifications[0].options.data as { kind?: string }).kind, 'thread');
  notifications[0].onclick?.();
  assert.equal(focused, 1);
  assert.equal((globalThis as any).window.location.hash, '#thread/thread%2Fid?p=12');
  assert.equal(notifications[0].closed, true);
});

test('ignores malformed, unwatched, already known, and duplicate watched events', () => {
  setPreferences({ browserWatchedThreads: true });
  FakeNotification.permission = 'granted';
  const watched = {
    'thread-1': {
      globalNumber: 10,
      lastSeen: 10,
      maxNumber: 12,
      replyCount: 2
    }
  };
  const { dependencies, writes } = watchedDependencies(watched);

  notifyWatchedThreadPost({ threadId: 'thread-1', comment: { globalNumber: 'bad' } }, dependencies);
  notifyWatchedThreadPost({ threadId: 'missing', comment: { globalNumber: 13 } }, dependencies);
  notifyWatchedThreadPost({ threadId: 'thread-1', comment: { id: 'old', globalNumber: 12 } }, dependencies);
  const payload = { threadId: 'thread-1', comment: { id: 'new', globalNumber: 13 } };
  notifyWatchedThreadPost(payload, dependencies);
  notifyWatchedThreadPost(payload, dependencies);

  assert.equal(writes.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(watched['thread-1'].replyCount, 3);
});

test('updates watched state but suppresses popups for own posts and the visible thread', () => {
  setPreferences({ browserWatchedThreads: true });
  FakeNotification.permission = 'granted';
  const watched = {
    'thread-1': { globalNumber: 1, lastSeen: 1, maxNumber: 1, replyCount: 0 },
    'thread-2': { globalNumber: 2, lastSeen: 2, maxNumber: 2, replyCount: 0 }
  };
  const { dependencies, writes } = watchedDependencies(watched, {
    isOwnPost: (comment) => comment.id === 'own',
    isViewingThread: (threadId) => threadId === 'thread-2'
  });

  notifyWatchedThreadPost({
    threadId: 'thread-1',
    comment: { id: 'own', globalNumber: 3 }
  }, dependencies);
  notifyWatchedThreadPost({
    threadId: 'thread-2',
    comment: { id: 'visible', globalNumber: 4 }
  }, dependencies);

  assert.equal(writes.length, 2);
  assert.equal(notifications.length, 0);
});

test('contains browser constructor failures without breaking watched state updates', () => {
  setPreferences({ browserWatchedThreads: true });
  const errors: unknown[] = [];
  class BrokenNotification {
    static permission = 'granted';
    constructor() {
      throw new Error('constructor failed');
    }
  }
  (globalThis as any).window.Notification = BrokenNotification;
  const watched = {
    'thread-1': { globalNumber: 1, lastSeen: 1, maxNumber: 1, replyCount: 0 }
  };
  const { dependencies, writes } = watchedDependencies(watched, {
    onNotificationError: (error) => errors.push(error)
  });

  assert.doesNotThrow(() => notifyWatchedThreadPost({
    threadId: 'thread-1',
    comment: { id: 'comment-1', globalNumber: 2 }
  }, dependencies));
  assert.equal(writes.length, 1);
  assert.equal(errors.length, 1);
});

test('shows subscribed-board notifications only for eligible new threads', () => {
  setPreferences({ browserBoardSubscriptions: true });
  FakeNotification.permission = 'granted';
  const dependencies = {
    browserNotificationIds: new Set<string>(),
    isBoardSubscribed: (slug: string) => slug === 'hoc-tap',
    isOwnPost: () => false,
    isViewingBoard: () => false
  };
  const payload = {
    thread: {
      id: 'thread/id',
      boardSlug: 'hoc-tap',
      globalNumber: 20,
      subject: 'Lịch thi mới',
      bodyLines: [{ type: 'text', text: 'Nội dung chủ đề' }]
    }
  };

  assert.equal(notifySubscribedBoardThread(payload, dependencies), true);
  assert.equal(notifySubscribedBoardThread(payload, dependencies), true);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, '/hoc-tap/ · Chủ đề mới');
  assert.equal(notifications[0].options.body, 'Lịch thi mới');
  assert.deepEqual(notifications[0].options.data, {
    threadId: 'thread/id',
    boardSlug: 'hoc-tap',
    kind: 'board'
  });
  notifications[0].onclick?.();
  assert.equal((globalThis as any).window.location.hash, '#thread/thread%2Fid');
});

test('suppresses board notifications when unsubscribed, self-authored, visible, or disabled', () => {
  FakeNotification.permission = 'granted';
  const payload = {
    thread: { id: 'thread-1', boardSlug: 'hoc-tap', globalNumber: 20 }
  };

  setPreferences({ browserBoardSubscriptions: false });
  notifySubscribedBoardThread(payload, {
    isBoardSubscribed: () => true,
    browserNotificationIds: new Set<string>()
  });
  setPreferences({ browserBoardSubscriptions: true });
  notifySubscribedBoardThread(payload, {
    isBoardSubscribed: () => false,
    browserNotificationIds: new Set<string>()
  });
  notifySubscribedBoardThread(payload, {
    isBoardSubscribed: () => true,
    isOwnPost: () => true,
    browserNotificationIds: new Set<string>()
  });
  notifySubscribedBoardThread(payload, {
    isBoardSubscribed: () => true,
    isViewingBoard: () => true,
    browserNotificationIds: new Set<string>()
  });

  assert.equal(notifications.length, 0);
});

test('matches exact @username tags without partial or email-address matches', () => {
  assert.equal(postMentionsUsername({
    bodyLines: [{ text: 'Chào @Student.Name, xem giúp mình nhé.' }]
  }, 'student.name'), true);
  assert.equal(postMentionsUsername({
    bodyLines: [{ text: 'Không khớp @student.name-extra' }]
  }, 'student.name'), false);
  assert.equal(postMentionsUsername({
    bodyLines: [{ text: 'Email student.name@example.com không phải lượt nhắc' }]
  }, 'student.name'), false);
  assert.equal(postMentionsUsername({
    bodyLines: [{ text: 'Tên ngắn @ab không hợp lệ' }]
  }, 'ab'), false);
});

test('shows one tagged-post notification with an exact post click target', () => {
  setPreferences({ browserMentions: true });
  FakeNotification.permission = 'granted';
  const dependencies = {
    accountUsername: 'student.name',
    browserNotificationIds: new Set<string>(),
    isOwnPost: () => false,
    isViewingThread: () => false
  };
  const payload = {
    threadId: 'thread/id',
    comment: {
      id: 'comment-mention',
      boardSlug: 'hoc-tap',
      globalNumber: 25,
      bodyLines: [{ type: 'text', text: '@student.name xem lịch thi mới nhé' }]
    }
  };

  assert.equal(notifyTaggedPost(payload, dependencies), true);
  assert.equal(notifyTaggedPost(payload, dependencies), true);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, 'Bạn được nhắc đến trên /hoc-tap/');
  assert.equal(notifications[0].options.tag, 'mention-comment-mention');
  assert.deepEqual(notifications[0].options.data, {
    threadId: 'thread/id',
    globalNumber: 25,
    kind: 'mention'
  });
  notifications[0].onclick?.();
  assert.equal((globalThis as any).window.location.hash, '#thread/thread%2Fid?p=25');
});

test('tag notifications are opt-in and suppress own or foreground posts', () => {
  FakeNotification.permission = 'granted';
  const payload = {
    threadId: 'thread-1',
    comment: {
      id: 'comment-1',
      globalNumber: 5,
      bodyLines: [{ text: '@student hello' }]
    }
  };

  setPreferences({ browserMentions: false });
  notifyTaggedPost(payload, {
    accountUsername: 'student',
    browserNotificationIds: new Set<string>()
  });
  setPreferences({ browserMentions: true });
  notifyTaggedPost(payload, {
    accountUsername: 'student',
    isOwnPost: () => true,
    browserNotificationIds: new Set<string>()
  });
  notifyTaggedPost(payload, {
    accountUsername: 'student',
    isViewingThread: () => true,
    browserNotificationIds: new Set<string>()
  });

  assert.equal(notifications.length, 0);
});

test('a tagged watched reply updates unread state without a duplicate watched popup', () => {
  setPreferences({ browserWatchedThreads: true, browserMentions: true });
  FakeNotification.permission = 'granted';
  const watched = {
    'thread-1': { globalNumber: 1, lastSeen: 1, maxNumber: 1, replyCount: 0 }
  };
  const { dependencies, writes } = watchedDependencies(watched, {
    suppressBrowserNotification: true
  });

  notifyWatchedThreadPost({
    threadId: 'thread-1',
    comment: { id: 'comment-1', globalNumber: 2 }
  }, dependencies);

  assert.equal(writes.length, 1);
  assert.equal(watched['thread-1'].replyCount, 1);
  assert.equal(notifications.length, 0);
});

test('deduplicates DM toasts even when browser popups are disabled', () => {
  setPreferences({ directMessages: true, browserDirectMessages: false });
  const toasts: string[] = [];
  const dependencies = {
    showToast: (message: string) => toasts.push(message),
    browserNotificationIds: new Set<string>()
  };
  const payload = {
    conversationId: 'conversation-1',
    messageId: 'message-1',
    senderUsername: 'friend'
  };

  notifyDirectMessage(payload, dependencies);
  notifyDirectMessage(payload, dependencies);

  assert.deepEqual(toasts, ['Tin nhắn mới từ @friend']);
  assert.equal(notifications.length, 0);
});

test('supports independent DM toast and browser preferences and click navigation', () => {
  setPreferences({ directMessages: false, browserDirectMessages: true });
  FakeNotification.permission = 'granted';
  const toasts: string[] = [];
  const dependencies = {
    showToast: (message: string) => toasts.push(message),
    browserNotificationIds: new Set<string>()
  };

  notifyDirectMessage({
    conversationId: 'conversation/id',
    messageId: 'message-1',
    senderUsername: 'friend'
  }, dependencies);

  assert.deepEqual(toasts, []);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].options.tag, 'dm-conversation/id');
  assert.deepEqual(notifications[0].options.data, {
    conversationId: 'conversation/id',
    messageId: 'message-1',
    kind: 'message'
  });
  notifications[0].onclick?.();
  assert.equal((globalThis as any).window.location.hash, '#messages/conversation%2Fid');
  assert.equal(notifications[0].closed, true);
});

test('ignores malformed DM events and contains popup constructor failures', () => {
  setPreferences({ directMessages: true, browserDirectMessages: true });
  const toasts: string[] = [];
  const errors: unknown[] = [];
  class BrokenNotification {
    static permission = 'granted';
    constructor() {
      throw new Error('constructor failed');
    }
  }
  (globalThis as any).window.Notification = BrokenNotification;
  const dependencies = {
    showToast: (message: string) => toasts.push(message),
    browserNotificationIds: new Set<string>(),
    onNotificationError: (error) => errors.push(error)
  };

  notifyDirectMessage({ messageId: 'missing-conversation' }, dependencies);
  notifyDirectMessage({ conversationId: 'missing-message' }, dependencies);
  assert.doesNotThrow(() => notifyDirectMessage({
    conversationId: 'conversation-1',
    messageId: 'message-1',
    senderUsername: 'friend'
  }, dependencies));

  assert.deepEqual(toasts, ['Tin nhắn mới từ @friend']);
  assert.equal(errors.length, 1);
});
