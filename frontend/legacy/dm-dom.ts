import type { AnyRecord } from './types';

export function isDmAccountSessionCurrent(state: AnyRecord, accountToken: unknown): boolean {
  return Boolean(accountToken && state.accountToken === accountToken && state.account?.id);
}

function clearNode(node: AnyRecord | null | undefined): void {
  if (!node) {
    return;
  }
  if (typeof node.replaceChildren === 'function') {
    node.replaceChildren();
    return;
  }
  node.textContent = '';
}

export function syncDmAuthenticationDom(els: AnyRecord, loggedIn: boolean): void {
  els.dmLoggedOut?.classList.toggle('hidden', loggedIn);
  els.dmLoggedIn?.classList.toggle('hidden', !loggedIn);
  if (loggedIn) {
    return;
  }

  els.dmEmptyState?.classList.remove('hidden');
  els.dmThread?.classList.add('hidden');
  els.dmLoadOlder?.classList.add('hidden');
  els.dmTypingStatus?.classList.add('hidden');
  els.dmReplyBanner?.classList.add('hidden');
  els.dmAttachPreview?.classList.add('hidden');
  els.dmGroupPanel?.classList.add('hidden');
  els.dmSearchResults?.classList.add('hidden');

  for (const node of [
    els.dmConversationList,
    els.dmMessageList,
    els.dmThreadActions,
    els.dmGroupPanel,
    els.dmSearchResults,
    els.dmReplyPreview,
    els.dmAttachPreview,
    els.dmTypingStatus
  ]) {
    clearNode(node);
  }

  if (els.dmThreadTitle) {
    els.dmThreadTitle.textContent = 'Chat';
  }
  if (els.dmThreadMeta) {
    els.dmThreadMeta.textContent = '';
  }
  for (const input of [
    els.dmPeerUsername,
    els.dmGroupTitle,
    els.dmGroupUsernames,
    els.dmSearchInput,
    els.dmMessageBody
  ]) {
    if (input) {
      input.value = '';
    }
  }
}

export function bindDmClickDelegation(
  els: AnyRecord,
  listener: (event: Event) => unknown
): void {
  els.dmLoggedIn?.addEventListener('click', listener);
}
