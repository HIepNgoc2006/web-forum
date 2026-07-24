import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindDmClickDelegation,
  isDmAccountSessionCurrent,
  syncDmAuthenticationDom
} from '../legacy/dm-dom.ts';
import {
  createTrailingAsyncCoalescer,
  isOwnDmMessageEvent,
  shouldLoadDmConversationsForRealtime
} from '../legacy/dm-realtime.ts';

function fakeClassList(...initial: string[]) {
  const values = new Set(initial);
  return {
    add(value: string) {
      values.add(value);
    },
    remove(value: string) {
      values.delete(value);
    },
    toggle(value: string, force?: boolean) {
      const enabled = force === undefined ? !values.has(value) : force;
      if (enabled) {
        values.add(value);
      } else {
        values.delete(value);
      }
      return enabled;
    },
    contains(value: string) {
      return values.has(value);
    }
  };
}

function fakeNode(value = 'private value') {
  return {
    classList: fakeClassList(),
    textContent: value,
    value,
    replaceChildren() {
      this.textContent = '';
    }
  };
}

test('scrubs the populated DM view when the account session is cleared', () => {
  const els = {
    dmLoggedOut: fakeNode(),
    dmLoggedIn: fakeNode(),
    dmEmptyState: fakeNode(),
    dmThread: fakeNode(),
    dmLoadOlder: fakeNode(),
    dmTypingStatus: fakeNode('@private-user đang gõ'),
    dmReplyBanner: fakeNode(),
    dmReplyPreview: fakeNode('private reply'),
    dmAttachPreview: fakeNode('private attachment'),
    dmGroupPanel: fakeNode('private members'),
    dmSearchResults: fakeNode('private search result'),
    dmConversationList: fakeNode('private conversation preview'),
    dmMessageList: fakeNode('private decrypted message'),
    dmThreadActions: fakeNode('private actions'),
    dmThreadTitle: fakeNode('@private-user'),
    dmThreadMeta: fakeNode('private metadata'),
    dmPeerUsername: fakeNode('@private-user'),
    dmGroupTitle: fakeNode('private group'),
    dmGroupUsernames: fakeNode('@private-user'),
    dmSearchInput: fakeNode('private search'),
    dmMessageBody: fakeNode('private draft')
  };

  syncDmAuthenticationDom(els, false);

  assert.equal(els.dmLoggedOut.classList.contains('hidden'), false);
  assert.equal(els.dmLoggedIn.classList.contains('hidden'), true);
  assert.equal(els.dmThread.classList.contains('hidden'), true);
  assert.equal(els.dmConversationList.textContent, '');
  assert.equal(els.dmMessageList.textContent, '');
  assert.equal(els.dmSearchResults.textContent, '');
  assert.equal(els.dmReplyPreview.textContent, '');
  assert.equal(els.dmThreadTitle.textContent, 'Chat');
  assert.equal(els.dmThreadMeta.textContent, '');
  assert.equal(els.dmMessageBody.value, '');
});

test('delegates DM actions once from the common logged-in ancestor', () => {
  const listenerCounts = new Map<string, number>();
  const eventRoot = (name: string) => ({
    addEventListener(type: string) {
      assert.equal(type, 'click');
      listenerCounts.set(name, (listenerCounts.get(name) || 0) + 1);
    }
  });
  const els = {
    dmLoggedIn: eventRoot('logged-in'),
    dmConversationList: eventRoot('conversation-list'),
    dmMessageList: eventRoot('message-list'),
    dmThread: eventRoot('thread'),
    dmReplyBanner: eventRoot('reply-banner')
  };

  bindDmClickDelegation(els, () => {});

  assert.deepEqual([...listenerCounts], [['logged-in', 1]]);
});

test('a delayed DM response cannot repopulate DOM after logout', async () => {
  const state = { accountToken: 'account-token', account: { id: 'account-1' } };
  const els = {
    dmLoggedOut: fakeNode(),
    dmLoggedIn: fakeNode(),
    dmEmptyState: fakeNode(),
    dmThread: fakeNode(),
    dmLoadOlder: fakeNode(),
    dmTypingStatus: fakeNode(),
    dmReplyBanner: fakeNode(),
    dmReplyPreview: fakeNode(),
    dmAttachPreview: fakeNode(),
    dmGroupPanel: fakeNode(),
    dmSearchResults: fakeNode(),
    dmConversationList: fakeNode(),
    dmMessageList: fakeNode('private decrypted message'),
    dmThreadActions: fakeNode(),
    dmThreadTitle: fakeNode(),
    dmThreadMeta: fakeNode(),
    dmPeerUsername: fakeNode(),
    dmGroupTitle: fakeNode(),
    dmGroupUsernames: fakeNode(),
    dmSearchInput: fakeNode(),
    dmMessageBody: fakeNode()
  };
  const capturedToken = state.accountToken;
  let release: (value: string) => void = () => {};
  const delayed = new Promise<string>((resolve) => {
    release = resolve;
  });
  const completion = delayed.then((privateText) => {
    if (isDmAccountSessionCurrent(state, capturedToken)) {
      els.dmMessageList.textContent = privateText;
      els.dmSearchResults.textContent = privateText;
    }
  });

  state.accountToken = '';
  state.account = null;
  syncDmAuthenticationDom(els, false);
  release('late private response');
  await completion;

  assert.equal(els.dmMessageList.textContent, '');
  assert.equal(els.dmSearchResults.textContent, '');
});

test('ignores the realtime echo for a message sent by the current account', () => {
  assert.equal(isOwnDmMessageEvent('dm:message', 'account-1', 'account-1'), true);
  assert.equal(isOwnDmMessageEvent('dm:message', 'account-2', 'account-1'), false);
  assert.equal(isOwnDmMessageEvent('dm:message-updated', 'account-1', 'account-1'), false);
});

test('loads authoritative mute state before notifying for every incoming DM', () => {
  assert.equal(shouldLoadDmConversationsForRealtime('dm:message', '#home'), true);
  assert.equal(shouldLoadDmConversationsForRealtime('dm:message', '#thread/thread-1'), true);
  assert.equal(shouldLoadDmConversationsForRealtime('dm:message-updated', '#messages'), true);
  assert.equal(shouldLoadDmConversationsForRealtime('dm:message-deleted', '#home'), false);
});

test('coalesces a burst of DM refreshes into the active and latest request', async () => {
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const refreshed: string[] = [];
  const schedule = createTrailingAsyncCoalescer(async (conversationId: string) => {
    refreshed.push(conversationId);
    if (conversationId === 'first') {
      await firstGate;
    }
  });

  const first = schedule('first');
  await Promise.resolve();
  const second = schedule('second');
  const latest = schedule('latest');

  assert.equal(first, second);
  assert.equal(second, latest);
  assert.deepEqual(refreshed, ['first']);

  releaseFirst();
  await first;

  assert.deepEqual(refreshed, ['first', 'latest']);
});
