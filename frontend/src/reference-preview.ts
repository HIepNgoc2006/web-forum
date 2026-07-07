import { clamp } from './format';
import type { AnyRecord } from './types';

export function createReferencePreviewController({
  state,
  refPreview,
  fetchPost,
  renderPostPreviewHtml,
  body = document.body,
  win = window
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

  function renderReferencePreviewPost(post, source) {
    refPreview.classList.remove('ref-preview-loading', 'ref-preview-error');
    refPreview.innerHTML = renderPostPreviewHtml(post);
    positionReferencePreview(source);
  }

  function renderReferencePreviewMessage(message, className, source) {
    refPreview.classList.remove('ref-preview-loading', 'ref-preview-error');
    if (className) {
      refPreview.classList.add(className);
    }
    refPreview.textContent = message;
    positionReferencePreview(source);
  }

  async function showReference(number, source) {
    const refNumber = String(number || '').trim();
    if (!refNumber) {
      return;
    }
    win.clearTimeout(state.refPreviewHideTimer);
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
    refPreview.classList.add('hidden');
    refPreview.classList.remove('ref-preview-loading', 'ref-preview-error');
    refPreview.innerHTML = '';
  }

  function scheduleHideReferencePreview() {
    win.clearTimeout(state.refPreviewHideTimer);
    state.refPreviewHideTimer = win.setTimeout(hideReferencePreview, 140);
  }

  function handleReferencePointerEnter(event) {
    const ref = event.target.closest('.ref-link[data-ref]');
    if (!ref || ref.contains(event.relatedTarget)) {
      return;
    }
    showReference(ref.dataset.ref, event).catch(() => {});
  }

  function handleReferencePointerLeave(event) {
    const ref = event.target.closest('.ref-link[data-ref]');
    if (!ref || ref.contains(event.relatedTarget) || refPreview.contains(event.relatedTarget)) {
      return;
    }
    scheduleHideReferencePreview();
  }

  function handleReferenceFocusIn(event) {
    const ref = event.target.closest('.ref-link[data-ref]');
    if (!ref) {
      return;
    }
    showReference(ref.dataset.ref, ref).catch(() => {});
  }

  function handleReferenceFocusOut(event) {
    const ref = event.target.closest('.ref-link[data-ref]');
    if (!ref || refPreview.contains(event.relatedTarget)) {
      return;
    }
    scheduleHideReferencePreview();
  }

  async function handleReferencePreviewClick(event: AnyRecord) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return false;
    }

    const ref = target.closest('.ref-link') as AnyRecord | null;
    if (ref) {
      // Cross-board refs without a post number are plain anchors; let the
      // browser navigate to the board instead of fetching a post preview.
      if (ref.dataset.ref) {
        await showReference(ref.dataset.ref, event);
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
