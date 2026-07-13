import { clamp } from './format';
import type { AnyRecord } from './types';

function isNarrowQuickReplyViewport(win = window) {
  return win.matchMedia('(max-width: 640px)').matches || win.innerWidth <= 640;
}

export function bindQuickReplyEvents({ els, state, closeQuickReply, win = window }: AnyRecord) {
  els.quickReplyClose.addEventListener('click', closeQuickReply);
  els.quickReplyHandle.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) {
      return;
    }
    // Bottom-sheet mode on phones — no free drag (avoids off-screen panels).
    if (isNarrowQuickReplyViewport(win)) {
      return;
    }
    const rect = els.quickReply.getBoundingClientRect();
    state.quickReplyDrag = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    event.preventDefault();
  });
  win.addEventListener('mousemove', (event) => {
    if (!state.quickReplyDrag || isNarrowQuickReplyViewport(win)) {
      return;
    }
    const rect = els.quickReply.getBoundingClientRect();
    const left = clamp(event.clientX - state.quickReplyDrag.offsetX, 4, win.innerWidth - rect.width - 4);
    const top = clamp(event.clientY - state.quickReplyDrag.offsetY, 4, win.innerHeight - rect.height - 4);
    els.quickReply.style.left = `${left}px`;
    els.quickReply.style.top = `${top}px`;
  });
  win.addEventListener('mouseup', () => {
    state.quickReplyDrag = null;
  });
  // Keep sheet anchored if the user rotates or resizes into the phone breakpoint.
  win.addEventListener('resize', () => {
    if (els.quickReply?.classList?.contains('hidden')) {
      return;
    }
    if (isNarrowQuickReplyViewport(win)) {
      state.quickReplyDrag = null;
      els.quickReply.style.left = '';
      els.quickReply.style.top = '';
    }
  });
}
