import assert from 'node:assert/strict';
import test from 'node:test';

import { createRouterController } from '../src/router.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function installBrowserGlobals(t, initialHash: string) {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const location = { hash: initialHash };
  const inlineTarget = { id: 'p42' };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location,
      scrollTo() {}
    }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      getElementById(id: string) {
        return id === 'p42' ? inlineTarget : null;
      },
      querySelector() {
        return null;
      }
    }
  });

  t.after(() => {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      delete (globalThis as typeof globalThis & { window?: unknown }).window;
    }
    if (documentDescriptor) {
      Object.defineProperty(globalThis, 'document', documentDescriptor);
    } else {
      delete (globalThis as typeof globalThis & { document?: unknown }).document;
    }
  });

  return { location, inlineTarget };
}

function routerDependencies(overrides = {}) {
  return {
    els: {
      quickReply: {
        classList: {
          contains: () => true
        }
      }
    },
    state: {
      threadId: '',
      threadSearchTerm: '',
      threadCommentPage: 1,
      pendingInlineReply: null
    },
    showToast() {},
    hideReferencePreview() {},
    setFormError() {},
    setScreen() {},
    loadHome: async () => {},
    loadThread: async () => {},
    loadCatalog: async () => {},
    loadArchive: async () => {},
    loadBoard: async () => {},
    loadAccountSettings: async () => {},
    loadAdmin: async () => {},
    resetForgotPasswordForm() {},
    loadPolicy() {},
    normalizeBoardSort: (value: string) => value,
    normalizeBoardFilter: (value: string) => value,
    setupRealtime() {},
    moveKeyboardNavigation: () => false,
    eventInTextInput: () => false,
    openReplyComposer() {},
    closeQuickReply() {},
    ...overrides
  };
}

test('route closes an open floating reply before changing screens', async (t) => {
  installBrowserGlobals(t, '#thread/thread-a');
  let hidden = false;
  let closeCalls = 0;
  const controller = createRouterController(
    routerDependencies({
      els: {
        quickReply: {
          classList: {
            contains: () => hidden
          }
        }
      },
      closeQuickReply() {
        closeCalls += 1;
        hidden = true;
      }
    })
  );

  await controller.route();

  assert.equal(closeCalls, 1);
});

test('stale normal reply navigation cannot open on a newer thread', async (t) => {
  const { location } = installBrowserGlobals(t, '#thread/thread-a');
  const threadALoad = deferred();
  const threadBLoad = deferred();
  const state = {
    threadId: '',
    threadSearchTerm: '',
    threadCommentPage: 1,
    pendingInlineReply: {
      threadId: 'thread-a',
      number: '42',
      selectedQuote: 'quoted text'
    }
  };
  const opened: unknown[] = [];
  const controller = createRouterController(
    routerDependencies({
      state,
      loadThread: () =>
        state.threadId === 'thread-a' ? threadALoad.promise : threadBLoad.promise,
      openReplyComposer(options: unknown) {
        opened.push(options);
      }
    })
  );

  const firstNavigation = controller.route();
  location.hash = '#thread/thread-b';
  const secondNavigation = controller.route();

  threadALoad.resolve();
  await firstNavigation;
  assert.deepEqual(opened, []);

  threadBLoad.resolve();
  await secondNavigation;
  assert.deepEqual(opened, []);
});

test('current normal reply navigation opens beneath its target post', async (t) => {
  const { inlineTarget } = installBrowserGlobals(t, '#thread/thread-a');
  const state = {
    threadId: '',
    threadSearchTerm: '',
    threadCommentPage: 1,
    pendingInlineReply: {
      threadId: 'thread-a',
      number: '42',
      selectedQuote: 'quoted text'
    }
  };
  const opened: Array<Record<string, unknown>> = [];
  const controller = createRouterController(
    routerDependencies({
      state,
      openReplyComposer(options: Record<string, unknown>) {
        opened.push(options);
      }
    })
  );

  await controller.route();

  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.number, '42');
  assert.equal(opened[0]?.selectedQuote, 'quoted text');
  assert.equal(opened[0]?.inlineTarget, inlineTarget);
});
