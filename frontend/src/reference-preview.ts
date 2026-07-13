import { clamp } from './format';
import type { AnyRecord } from './types';

const SHOW_DELAY_MS = 80;
const HIDE_DELAY_MS = 200;
const PREVIEW_MAX_WIDTH = 520;
const PREVIEW_MAX_HEIGHT = 720;
const PREVIEW_GAP = 12;
const VIEWPORT_PAD = 8;

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
      return {
        x: source.clientX,
        y: source.clientY,
        anchorLeft: source.clientX,
        anchorRight: source.clientX,
        anchorTop: source.clientY,
        anchorBottom: source.clientY
      };
    }
    const rect = target?.getBoundingClientRect?.();
    if (rect) {
      return {
        x: rect.right,
        y: rect.bottom,
        anchorLeft: rect.left,
        anchorRight: rect.right,
        anchorTop: rect.top,
        anchorBottom: rect.bottom
      };
    }
    return {
      x: VIEWPORT_PAD,
      y: VIEWPORT_PAD,
      anchorLeft: VIEWPORT_PAD,
      anchorRight: VIEWPORT_PAD,
      anchorTop: VIEWPORT_PAD,
      anchorBottom: VIEWPORT_PAD
    };
  }

  function positionReferencePreview(source) {
    const maxWidth = Math.max(240, Math.min(PREVIEW_MAX_WIDTH, win.innerWidth - VIEWPORT_PAD * 2));
    const maxHeight = Math.min(PREVIEW_MAX_HEIGHT, win.innerHeight - VIEWPORT_PAD * 2);
    const measuredHeight = refPreview.offsetHeight || 0;
    const previewHeight = Math.min(
      maxHeight,
      measuredHeight > 0 ? measuredHeight : Math.min(320, maxHeight)
    );
    const previewWidth = Math.min(maxWidth, refPreview.offsetWidth || maxWidth);
    refPreview.style.maxHeight = `${maxHeight}px`;
    const position = referencePreviewPositionSource(source);
    const spaceRight = win.innerWidth - position.anchorRight - VIEWPORT_PAD;
    const spaceLeft = position.anchorLeft - VIEWPORT_PAD;
    const spaceBelow = win.innerHeight - position.anchorBottom - VIEWPORT_PAD;
    const spaceAbove = position.anchorTop - VIEWPORT_PAD;

    let left: number;
    if (spaceRight >= previewWidth + PREVIEW_GAP || spaceRight >= spaceLeft) {
      left = position.anchorRight + PREVIEW_GAP;
    } else {
      left = position.anchorLeft - previewWidth - PREVIEW_GAP;
    }

    let top: number;
    if (spaceBelow >= previewHeight + 6 || spaceBelow >= spaceAbove) {
      top = Number.isFinite(source?.clientY)
        ? source.clientY + 14
        : position.anchorBottom + 6;
    } else {
      top = Number.isFinite(source?.clientY)
        ? source.clientY - previewHeight - 10
        : position.anchorTop - previewHeight - 6;
    }

    left = clamp(left, VIEWPORT_PAD, Math.max(VIEWPORT_PAD, win.innerWidth - previewWidth - VIEWPORT_PAD));
    top = clamp(top, VIEWPORT_PAD, Math.max(VIEWPORT_PAD, win.innerHeight - previewHeight - VIEWPORT_PAD));

    refPreview.style.left = `${left}px`;
    refPreview.style.top = `${top}px`;
    refPreview.style.width = `${maxWidth}px`;
    refPreview.style.maxWidth = `${maxWidth}px`;
  }

  function setPinned(pinned: boolean) {
    state.refPreviewPinned = Boolean(pinned);
    refPreview.classList.toggle('ref-preview-pinned', state.refPreviewPinned);
    refPreview.setAttribute('data-pinned', state.refPreviewPinned ? 'true' : 'false');
  }

  function clearHoverTargetHighlight() {
    doc.querySelectorAll('.ref-hover-target').forEach((node) => {
      node.classList.remove('ref-hover-target');
    });
    state.refPreviewHoverNumber = '';
  }

  function highlightHoverTarget(refNumber: string) {
    clearHoverTargetHighlight();
    const target = doc.getElementById(`p${refNumber}`);
    if (!target) {
      return;
    }
    target.classList.add('ref-hover-target');
    state.refPreviewHoverNumber = refNumber;
  }

  /** Avoid duplicate DOM ids when the referenced post is already on the page. */
  function sanitizePreviewHtml(html: string): string {
    return String(html || '')
      .replace(/\sid="p\d+"/g, '')
      .replace(/\sid='p\d+'/g, '');
  }

  function renderReferencePreviewPost(post, source) {
    refPreview.classList.remove('ref-preview-loading', 'ref-preview-error');
    const closeControl = state.refPreviewPinned
      ? '<button class="ref-preview-close" type="button" aria-label="Đóng cửa sổ xem trước" title="Đóng">×</button>'
      : '';
    refPreview.innerHTML = `${closeControl}${sanitizePreviewHtml(renderPostPreviewHtml(post))}`;
    // Re-measure after layout so tall image posts flip above the cursor when needed.
    positionReferencePreview(source);
    win.requestAnimationFrame(() => positionReferencePreview(source));
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
    win.clearTimeout(state.refPreviewShowTimer);
    if (pin) {
      setPinned(true);
    }
    const requestId = ++state.refPreviewRequestId;
    highlightHoverTarget(refNumber);
    positionReferencePreview(source);
    refPreview.classList.remove('hidden', 'ref-preview-error');
    refPreview.classList.add('ref-preview-loading', 'ref-preview-visible');
    refPreview.setAttribute('role', 'tooltip');
    refPreview.setAttribute('aria-live', 'polite');
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
    win.clearTimeout(state.refPreviewShowTimer);
    setPinned(false);
    clearHoverTargetHighlight();
    refPreview.classList.add('hidden');
    refPreview.classList.remove('ref-preview-loading', 'ref-preview-error', 'ref-preview-visible');
    refPreview.removeAttribute('role');
    refPreview.removeAttribute('aria-live');
    refPreview.innerHTML = '';
  }

  function scheduleHideReferencePreview() {
    if (state.refPreviewPinned) {
      return;
    }
    win.clearTimeout(state.refPreviewHideTimer);
    win.clearTimeout(state.refPreviewShowTimer);
    state.refPreviewHideTimer = win.setTimeout(hideReferencePreview, HIDE_DELAY_MS);
  }

  function scheduleShowReference(refNumber: string, source) {
    win.clearTimeout(state.refPreviewHideTimer);
    win.clearTimeout(state.refPreviewShowTimer);
    // Already showing this post — keep it and re-position near the cursor.
    if (
      !refPreview.classList.contains('hidden') &&
      state.refPreviewHoverNumber === refNumber &&
      !state.refPreviewPinned
    ) {
      positionReferencePreview(source);
      return;
    }
    state.refPreviewShowTimer = win.setTimeout(() => {
      showReference(refNumber, source).catch(() => {});
    }, SHOW_DELAY_MS);
  }

  function handleReferencePointerEnter(event) {
    if (state.refPreviewPinned) {
      return;
    }
    const ref = event.target.closest('.ref-link[data-ref]');
    if (!ref || ref.contains(event.relatedTarget)) {
      return;
    }
    scheduleShowReference(ref.dataset.ref, event);
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
    // Keyboard focus should show immediately for accessibility.
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
    refPreview.addEventListener('mouseenter', () => {
      win.clearTimeout(state.refPreviewHideTimer);
      win.clearTimeout(state.refPreviewShowTimer);
    });
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
