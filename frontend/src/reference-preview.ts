import { clamp } from './format';
import type { AnyRecord } from './types';

export function createReferencePreviewController({
  state,
  refPreview,
  fetchPost,
  renderPostPreviewHtml,
  focusPermalinkPost,
  body = document.body,
  win = window,
  doc = document
}: AnyRecord) {
  function referencePreviewPositionSource(source) {
    const target = source?.target?.closest?.('.ref-link') || source?.currentTarget || source;
    if (Number.isFinite(source?.clientX) && Number.isFinite(source?.clientY)) {
      return { x: source.clientX + 10, y: source.clientY + 10 };
    }
    const rect = target?.getBoundingClientRect?.();
    if (rect) {
      return { x: rect.right + 10, y: rect.bottom + 6 };
    }
    return { x: 12, y: 12 };
  }

  function positionReferencePreview(source) {
    const previewWidth = Math.max(220, Math.min(420, win.innerWidth - 12));
    const previewHeight = Math.min(420, refPreview.offsetHeight || 226);
    const position = referencePreviewPositionSource(source);
    const left = clamp(position.x, 6, Math.max(6, win.innerWidth - previewWidth - 6));
    const top = clamp(position.y, 6, Math.max(6, win.innerHeight - previewHeight - 6));
    refPreview.style.left = `${left}px`;
    refPreview.style.top = `${top}px`;
    refPreview.style.maxWidth = `${previewWidth}px`;
  }

  function setPinned(pinned: boolean) {
    state.refPreviewPinned = Boolean(pinned);
    refPreview.classList.toggle('ref-preview-pinned', state.refPreviewPinned);
    refPreview.setAttribute('data-pinned', state.refPreviewPinned ? 'true' : 'false');
  }

  function renderReferencePreviewPost(post, source) {
    refPreview.classList.remove('ref-preview-loading', 'ref-preview-error');
    const closeControl = state.refPreviewPinned
      ? '<button class="ref-preview-close" type="button" aria-label="Đóng cửa sổ xem trước" title="Đóng">×</button>'
      : '';
    refPreview.innerHTML = `${closeControl}${renderPostPreviewHtml(post)}`;
    positionReferencePreview(source);
  }

  function renderReferencePreviewMessage(message, className, source) {
    refPreview.classList.remove('ref-preview-loading', 'ref-preview-error');
    if (className) {
      refPreview.classList.add(className);
    }
    refPreview.replaceChildren();
    if (state.refPreviewPinned) {
      const closeButton = doc.createElement('button');
      closeButton.className = 'ref-preview-close';
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', 'Đóng cửa sổ xem trước');
      closeButton.title = 'Đóng';
      closeButton.textContent = '×';
      refPreview.append(closeButton);
    }
    const messageEl = doc.createElement('div');
    messageEl.className = 'ref-preview-message';
    messageEl.textContent = message;
    refPreview.append(messageEl);
    positionReferencePreview(source);
  }

  async function showReference(number, source, { pin = false }: AnyRecord = {}) {
    const refNumber = String(number || '').trim();
    if (!refNumber) {
      return;
    }
    win.clearTimeout(state.refPreviewHideTimer);
    if (pin) {
      setPinned(true);
    }
    const requestId = ++state.refPreviewRequestId;
    positionReferencePreview(source);
    refPreview.classList.remove('hidden', 'ref-preview-error');
    refPreview.classList.add('ref-preview-loading');
    refPreview.textContent = `Đang tải >>${refNumber}...`;

    const cached = state.refPreviewCache.get(refNumber);
    if (cached) {
      if (cached.ok) {
        renderReferencePreviewPost(cached.post, source);
      } else {
        renderReferencePreviewMessage(cached.message, 'ref-preview-error', source);
      }
      return;
    }

    try {
      const post = await fetchPost(refNumber);
      if (requestId !== state.refPreviewRequestId) {
        return;
      }
      state.refPreviewCache.set(refNumber, { ok: true, post });
      renderReferencePreviewPost(post, source);
    } catch {
      if (requestId !== state.refPreviewRequestId) {
        return;
      }
      const message = `Bài >>${refNumber} không tồn tại hoặc chưa công khai.`;
      state.refPreviewCache.set(refNumber, { ok: false, message });
      renderReferencePreviewMessage(message, 'ref-preview-error', source);
    }
  }

  function hideReferencePreview() {
    state.refPreviewRequestId += 1;
    win.clearTimeout(state.refPreviewHideTimer);
    setPinned(false);
    refPreview.classList.add('hidden');
    refPreview.classList.remove('ref-preview-loading', 'ref-preview-error');
    refPreview.innerHTML = '';
  }

  function scheduleHideReferencePreview() {
    if (state.refPreviewPinned) {
      return;
    }
    win.clearTimeout(state.refPreviewHideTimer);
    state.refPreviewHideTimer = win.setTimeout(hideReferencePreview, 140);
  }

  function handleReferencePointerEnter(event) {
    if (state.refPreviewPinned) {
      return;
    }
    const ref = event.target.closest('.ref-link[data-ref]');
    if (!ref || ref.contains(event.relatedTarget)) {
      return;
    }
    showReference(ref.dataset.ref, event).catch(() => {});
  }

  function handleReferencePointerLeave(event) {
    if (state.refPreviewPinned) {
      return;
    }
    const ref = event.target.closest('.ref-link[data-ref]');
    if (!ref || ref.contains(event.relatedTarget) || refPreview.contains(event.relatedTarget)) {
      return;
    }
    scheduleHideReferencePreview();
  }

  function handleReferenceFocusIn(event) {
    if (state.refPreviewPinned) {
      return;
    }
    const ref = event.target.closest('.ref-link[data-ref]');
    if (!ref) {
      return;
    }
    showReference(ref.dataset.ref, ref).catch(() => {});
  }

  function handleReferenceFocusOut(event) {
    if (state.refPreviewPinned) {
      return;
    }
    const ref = event.target.closest('.ref-link[data-ref]');
    if (!ref || refPreview.contains(event.relatedTarget)) {
      return;
    }
    scheduleHideReferencePreview();
  }

  function postOnPage(refNumber: string) {
    return doc.getElementById(`p${refNumber}`);
  }

  async function handleReferencePreviewClick(event: AnyRecord) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return false;
    }

    if (target.closest('.ref-preview-close')) {
      event.preventDefault?.();
      hideReferencePreview();
      return true;
    }

    const ref = target.closest('.ref-link') as AnyRecord | null;
    if (ref) {
      // Cross-board refs without a post number are plain anchors; let the
      // browser navigate to the board instead of fetching a post preview.
      if (ref.dataset.ref) {
        event.preventDefault?.();
        const refNumber = String(ref.dataset.ref);
        // 4chan: click >>N jumps to the post when it is already on the page.
        if (postOnPage(refNumber) && typeof focusPermalinkPost === 'function') {
          hideReferencePreview();
          focusPermalinkPost(refNumber, { scroll: true });
          return true;
        }
        // Otherwise pin a floating reply window near the click (4chan-X style).
        await showReference(refNumber, event, { pin: true });
      }
      return true;
    }

    if (!target.closest('.ref-preview')) {
      hideReferencePreview();
    }
    return false;
  }

  function bindReferencePreviewEvents() {
    win.addEventListener('keydown', (event: AnyRecord) => {
      if (event.key === 'Escape') {
        hideReferencePreview();
      }
    });
    body.addEventListener('mouseover', handleReferencePointerEnter);
    body.addEventListener('mouseout', handleReferencePointerLeave);
    body.addEventListener('focusin', handleReferenceFocusIn);
    body.addEventListener('focusout', handleReferenceFocusOut);
    refPreview.addEventListener('mouseenter', () => win.clearTimeout(state.refPreviewHideTimer));
    refPreview.addEventListener('mouseleave', scheduleHideReferencePreview);
  }

  return {
    bindReferencePreviewEvents,
    handleReferencePreviewClick,
    showReference,
    hideReferencePreview,
    scheduleHideReferencePreview
  };
}
