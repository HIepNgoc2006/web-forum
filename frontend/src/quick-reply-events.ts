import { clamp } from './format';
import type { AnyRecord } from './types';

export function bindQuickReplyEvents({ els, state, closeQuickReply, win = window }: AnyRecord) {
  els.quickReplyClose.addEventListener('click', closeQuickReply);
  els.quickReplyHandle.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) {
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
    if (!state.quickReplyDrag) {
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
}
