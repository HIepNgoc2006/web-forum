import {
  BBCODE_COLOR_OPTIONS,
  BBCODE_FONT_OPTIONS,
  BBCODE_SIZE_OPTIONS,
  renderBbcodeMarkup,
  stripBbcode
} from './bbcode';
import { escapeHtml, renderGifText, renderStickerText } from './format';
import type { AnyRecord } from './types';

type ComposerTarget = 'thread' | 'comment' | 'quickReply' | 'postEdit';

type HistorySnapshot = {
  value: string;
  start: number;
  end: number;
};

type TextareaHistory = {
  entries: HistorySnapshot[];
  index: number;
  applying: boolean;
  debounceTimer: ReturnType<typeof setTimeout> | null;
};

const TARGETS: ComposerTarget[] = ['thread', 'comment', 'quickReply', 'postEdit'];
const MAX_HISTORY = 100;
const TYPING_HISTORY_MS = 350;

const TEXTAREA_IDS: Record<ComposerTarget, string> = {
  thread: 'threadBody',
  comment: 'commentBody',
  quickReply: 'quickReplyBody',
  postEdit: 'postEditTextarea'
};

const historyByTextarea = new WeakMap<HTMLTextAreaElement, TextareaHistory>();

function icon(label: string, title: string): string {
  return `<span class="fmt-icon" aria-hidden="true">${label}</span><span class="visually-hidden">${title}</span>`;
}

function toolbarHtml(target: ComposerTarget): string {
  const sizes = BBCODE_SIZE_OPTIONS.map((n) => `<option value="${n}"${n === 13 ? ' selected' : ''}>${n}</option>`).join(
    ''
  );
  const fonts = BBCODE_FONT_OPTIONS.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
  const colors = BBCODE_COLOR_OPTIONS.map(
    (c) =>
      `<button type="button" class="fmt-color-swatch" data-fmt="color" data-fmt-value="${escapeHtml(c.value)}" title="${escapeHtml(c.label)}" style="background:${escapeHtml(c.value)}" aria-label="${escapeHtml(c.label)}"></button>`
  ).join('');

  return `
    <div class="composer-format" data-composer-format="${target}">
      <div class="composer-format-toolbar" role="toolbar" aria-label="Định dạng bình luận">
        <div class="fmt-group">
          <button type="button" class="fmt-btn" data-fmt="undo" title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác" disabled>↶</button>
          <button type="button" class="fmt-btn" data-fmt="redo" title="Làm lại (Ctrl+Shift+Z)" aria-label="Làm lại" disabled>↷</button>
        </div>
        <div class="fmt-group">
          <button type="button" class="fmt-btn" data-fmt="b" title="In đậm (Ctrl+B)" aria-label="In đậm">${icon('<b>B</b>', 'In đậm')}</button>
          <button type="button" class="fmt-btn" data-fmt="i" title="In nghiêng (Ctrl+I)" aria-label="In nghiêng">${icon('<i>I</i>', 'In nghiêng')}</button>
          <button type="button" class="fmt-btn" data-fmt="u" title="Gạch chân (Ctrl+U)" aria-label="Gạch chân">${icon('<span class="fmt-u">U</span>', 'Gạch chân')}</button>
          <button type="button" class="fmt-btn" data-fmt="s" title="Gạch ngang (Ctrl+S)" aria-label="Gạch ngang">${icon('<s>S</s>', 'Gạch ngang')}</button>
        </div>
        <div class="fmt-group">
          <label class="fmt-select-wrap" title="Cỡ chữ">
            <span class="visually-hidden">Cỡ chữ</span>
            <select class="fmt-select" data-fmt="size" aria-label="Cỡ chữ">
              <option value="">Cỡ</option>
              ${sizes}
            </select>
          </label>
          <label class="fmt-select-wrap" title="Phông chữ">
            <span class="visually-hidden">Phông chữ</span>
            <select class="fmt-select fmt-select-font" data-fmt="font" aria-label="Phông chữ">
              <option value="">Phông</option>
              ${fonts}
            </select>
          </label>
          <div class="fmt-color-dropdown" data-fmt-color-menu>
            <button type="button" class="fmt-btn fmt-color-trigger" data-fmt-toggle-colors title="Màu chữ" aria-label="Màu chữ" aria-haspopup="true" aria-expanded="false">A<span class="fmt-color-bar"></span></button>
            <div class="fmt-color-panel hidden" role="menu" aria-label="Chọn màu chữ">${colors}</div>
          </div>
        </div>
        <div class="fmt-group">
          <button type="button" class="fmt-btn" data-fmt="icode" title="Mã nội dòng" aria-label="Mã nội dòng">${icon('<>', 'Mã nội dòng')}</button>
          <button type="button" class="fmt-btn" data-fmt="spoiler" title="Spoiler nội dòng" aria-label="Spoiler">${icon('▮', 'Spoiler')}</button>
          <button type="button" class="fmt-btn" data-fmt="code" title="Khối code" aria-label="Khối code">${icon('{ }', 'Code')}</button>
          <button type="button" class="fmt-btn" data-fmt="quote" title="Trích dẫn" aria-label="Trích dẫn">${icon('“”', 'Trích dẫn')}</button>
        </div>
        <div class="fmt-group">
          <button type="button" class="fmt-btn" data-fmt="list" title="Danh sách không thứ tự" aria-label="Danh sách">•≡</button>
          <button type="button" class="fmt-btn" data-fmt="list=1" title="Danh sách có thứ tự" aria-label="Danh sách số">1.</button>
          <button type="button" class="fmt-btn" data-fmt="indent" title="Thụt lề" aria-label="Thụt lề">→</button>
          <button type="button" class="fmt-btn" data-fmt="outdent" title="Bỏ thụt lề" aria-label="Bỏ thụt lề">←</button>
        </div>
        <div class="fmt-group">
          <button type="button" class="fmt-btn" data-fmt="left" title="Căn trái" aria-label="Căn trái">⫷</button>
          <button type="button" class="fmt-btn" data-fmt="center" title="Căn giữa" aria-label="Căn giữa">≡</button>
          <button type="button" class="fmt-btn" data-fmt="right" title="Căn phải" aria-label="Căn phải">⫸</button>
          <button type="button" class="fmt-btn" data-fmt="justify" title="Căn đều" aria-label="Căn đều">☰</button>
        </div>
        <div class="fmt-group">
          <label class="fmt-select-wrap" title="Định dạng đoạn">
            <span class="visually-hidden">Định dạng đoạn</span>
            <select class="fmt-select" data-fmt="paragraph" aria-label="Định dạng đoạn">
              <option value="normal">Normal</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
            </select>
          </label>
        </div>
        <div class="fmt-group">
          <button type="button" class="fmt-btn" data-fmt="table" title="Chèn bảng" aria-label="Chèn bảng">▦</button>
          <button type="button" class="fmt-btn" data-fmt="hr" title="Đường kẻ ngang" aria-label="Đường kẻ ngang">―</button>
          <button type="button" class="fmt-btn" data-fmt="remove" title="Gỡ định dạng" aria-label="Gỡ định dạng">⌫</button>
        </div>
        <div class="fmt-group fmt-group-actions">
          <button type="button" class="fmt-btn fmt-btn-text" data-fmt="toggle-bbcode" title="Ẩn/hiện thanh BBCode" aria-pressed="true">BBCode</button>
          <button type="button" class="fmt-btn fmt-btn-text" data-fmt="preview" title="Xem trước" aria-pressed="false">Xem trước</button>
        </div>
      </div>
      <div class="composer-format-preview hidden" data-composer-preview="${target}" aria-live="polite"></div>
    </div>
  `;
}

function getTextarea(target: ComposerTarget, els: AnyRecord): HTMLTextAreaElement | null {
  if (target === 'thread') {
    return els.threadBody || document.querySelector('#threadBody');
  }
  if (target === 'comment') {
    return els.commentBody || document.querySelector('#commentBody');
  }
  if (target === 'postEdit') {
    return document.querySelector('#postEditTextarea');
  }
  return els.quickReplyBody || document.querySelector('#quickReplyBody');
}

function bindTextareaFormatListeners(textarea: HTMLTextAreaElement, target: ComposerTarget): void {
  if (textarea.dataset.formatListenersBound === '1') {
    return;
  }
  textarea.dataset.formatListenersBound = '1';
  textarea.addEventListener('input', () => {
    scheduleTypingHistory(textarea);
    const wrap = textarea.closest('.composer-body-wrap');
    const preview = wrap?.querySelector(`[data-composer-preview="${target}"]`) as HTMLElement | null;
    if (preview && !preview.classList.contains('hidden')) {
      preview.innerHTML = `<div class="post-body composer-preview-body">${renderPreviewHtml(textarea.value)}</div>`;
    }
  });
}

function selection(textarea: HTMLTextAreaElement) {
  const value = textarea.value;
  const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : value.length;
  const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
  return { value, start, end, selected: value.slice(start, end) };
}

function readSnapshot(textarea: HTMLTextAreaElement): HistorySnapshot {
  const { value, start, end } = selection(textarea);
  return { value, start, end };
}

function ensureHistory(textarea: HTMLTextAreaElement): TextareaHistory {
  let history = historyByTextarea.get(textarea);
  if (!history) {
    history = {
      entries: [readSnapshot(textarea)],
      index: 0,
      applying: false,
      debounceTimer: null
    };
    historyByTextarea.set(textarea, history);
  }
  return history;
}

function trimHistory(history: TextareaHistory): void {
  if (history.entries.length <= MAX_HISTORY) {
    return;
  }
  const overflow = history.entries.length - MAX_HISTORY;
  history.entries = history.entries.slice(overflow);
  history.index = Math.max(0, history.index - overflow);
}

function updateUndoRedoButtons(textarea: HTMLTextAreaElement): void {
  const history = ensureHistory(textarea);
  const wrap = textarea.closest('.composer-body-wrap');
  const formatRoot = wrap?.querySelector('[data-composer-format]') as HTMLElement | null;
  const undoBtn = formatRoot?.querySelector('[data-fmt="undo"]') as HTMLButtonElement | null;
  const redoBtn = formatRoot?.querySelector('[data-fmt="redo"]') as HTMLButtonElement | null;
  if (undoBtn) {
    undoBtn.disabled = history.index <= 0;
  }
  if (redoBtn) {
    redoBtn.disabled = history.index >= history.entries.length - 1;
  }
}

/** Keep the current draft on the stack tip before a toolbar mutation. */
function captureCurrentHistory(textarea: HTMLTextAreaElement): void {
  const history = ensureHistory(textarea);
  if (history.applying) {
    return;
  }
  if (history.debounceTimer) {
    clearTimeout(history.debounceTimer);
    history.debounceTimer = null;
  }
  const snap = readSnapshot(textarea);
  const current = history.entries[history.index];
  if (current && current.value === snap.value) {
    history.entries[history.index] = snap;
    updateUndoRedoButtons(textarea);
    return;
  }
  history.entries = history.entries.slice(0, history.index + 1);
  history.entries.push(snap);
  history.index = history.entries.length - 1;
  trimHistory(history);
  updateUndoRedoButtons(textarea);
}

function pushHistoryAfterChange(textarea: HTMLTextAreaElement): void {
  const history = ensureHistory(textarea);
  if (history.applying) {
    return;
  }
  const snap = readSnapshot(textarea);
  const current = history.entries[history.index];
  if (current && current.value === snap.value) {
    history.entries[history.index] = snap;
    updateUndoRedoButtons(textarea);
    return;
  }
  history.entries = history.entries.slice(0, history.index + 1);
  history.entries.push(snap);
  history.index = history.entries.length - 1;
  trimHistory(history);
  updateUndoRedoButtons(textarea);
}

function restoreHistorySnapshot(textarea: HTMLTextAreaElement, snap: HistorySnapshot): void {
  const history = ensureHistory(textarea);
  history.applying = true;
  textarea.value = snap.value;
  const max = snap.value.length;
  const start = Math.max(0, Math.min(snap.start, max));
  const end = Math.max(0, Math.min(snap.end, max));
  textarea.setSelectionRange(start, end);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  history.applying = false;
  updateUndoRedoButtons(textarea);
}

function undoTextarea(textarea: HTMLTextAreaElement): boolean {
  const history = ensureHistory(textarea);
  captureCurrentHistory(textarea);
  if (history.index <= 0) {
    updateUndoRedoButtons(textarea);
    return false;
  }
  history.index -= 1;
  restoreHistorySnapshot(textarea, history.entries[history.index]);
  return true;
}

function redoTextarea(textarea: HTMLTextAreaElement): boolean {
  const history = ensureHistory(textarea);
  if (history.index >= history.entries.length - 1) {
    updateUndoRedoButtons(textarea);
    return false;
  }
  history.index += 1;
  restoreHistorySnapshot(textarea, history.entries[history.index]);
  return true;
}

function scheduleTypingHistory(textarea: HTMLTextAreaElement): void {
  const history = ensureHistory(textarea);
  if (history.applying) {
    return;
  }
  if (history.debounceTimer) {
    clearTimeout(history.debounceTimer);
  }
  history.debounceTimer = setTimeout(() => {
    history.debounceTimer = null;
    pushHistoryAfterChange(textarea);
  }, TYPING_HISTORY_MS);
}

function applyTextareaChange(textarea: HTMLTextAreaElement, next: string, cursorStart: number, cursorEnd = cursorStart) {
  const maxLength = Number(textarea.maxLength);
  if (Number.isFinite(maxLength) && maxLength > 0 && next.length > maxLength) {
    return false;
  }
  captureCurrentHistory(textarea);
  const history = ensureHistory(textarea);
  history.applying = true;
  textarea.value = next;
  textarea.setSelectionRange(cursorStart, cursorEnd);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  history.applying = false;
  pushHistoryAfterChange(textarea);
  return true;
}

function wrapTag(textarea: HTMLTextAreaElement, open: string, close: string, placeholder = 'text') {
  const { value, start, end, selected } = selection(textarea);
  const inner = selected || placeholder;
  const insert = `${open}${inner}${close}`;
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  if (selected) {
    applyTextareaChange(textarea, next, start, start + insert.length);
  } else {
    const innerStart = start + open.length;
    applyTextareaChange(textarea, next, innerStart, innerStart + inner.length);
  }
}

function wrapAttrTag(textarea: HTMLTextAreaElement, name: string, attr: string, placeholder = 'text') {
  wrapTag(textarea, `[${name}=${attr}]`, `[/${name}]`, placeholder);
}

function insertSnippet(textarea: HTMLTextAreaElement, snippet: string, selectInner?: { openLen: number; innerLen: number }) {
  const { value, start, end } = selection(textarea);
  const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
  if (selectInner) {
    applyTextareaChange(textarea, next, start + selectInner.openLen, start + selectInner.openLen + selectInner.innerLen);
  } else {
    applyTextareaChange(textarea, next, start + snippet.length);
  }
}

function wrapLinesAsList(textarea: HTMLTextAreaElement, ordered: boolean) {
  const { value, start, end, selected } = selection(textarea);
  const block = selected || 'Mục 1\nMục 2';
  const items = block
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `[*]${line}`)
    .join('\n');
  const open = ordered ? '[list=1]\n' : '[list]\n';
  const close = '\n[/list]';
  const insert = `${open}${items}${close}`;
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  applyTextareaChange(textarea, next, start, start + insert.length);
}

function applyParagraph(textarea: HTMLTextAreaElement, kind: string) {
  const { value, start, end, selected } = selection(textarea);
  let block = selected || value.slice(start, end) || 'Tiêu đề';
  // Strip existing heading tags on selection.
  block = block
    .replace(/\[h[123]\]/gi, '')
    .replace(/\[\/h[123]\]/gi, '');
  if (kind === 'normal') {
    const next = `${value.slice(0, start)}${block}${value.slice(end)}`;
    applyTextareaChange(textarea, next, start, start + block.length);
    return;
  }
  const open = `[${kind}]`;
  const close = `[/${kind}]`;
  const insert = `${open}${block}${close}`;
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  applyTextareaChange(textarea, next, start, start + insert.length);
}

function outdentSelection(textarea: HTMLTextAreaElement) {
  const { value, start, end, selected } = selection(textarea);
  if (selected) {
    const stripped = selected.replace(/\[indent\]([\s\S]*?)\[\/indent\]/i, '$1');
    if (stripped !== selected) {
      const next = `${value.slice(0, start)}${stripped}${value.slice(end)}`;
      applyTextareaChange(textarea, next, start, start + stripped.length);
      return;
    }
  }
  // Fallback: unwrap nearest indent around cursor.
  const before = value.slice(0, start);
  const after = value.slice(end);
  const openIdx = before.toLowerCase().lastIndexOf('[indent]');
  const closeIdx = after.toLowerCase().indexOf('[/indent]');
  if (openIdx >= 0 && closeIdx >= 0) {
    const inner = value.slice(openIdx + '[indent]'.length, end + closeIdx);
    const next = `${value.slice(0, openIdx)}${inner}${value.slice(end + closeIdx + '[/indent]'.length)}`;
    applyTextareaChange(textarea, next, openIdx, openIdx + inner.length);
  }
}

function removeFormatting(textarea: HTMLTextAreaElement) {
  const { value, start, end, selected } = selection(textarea);
  if (selected) {
    const stripped = stripBbcode(selected);
    const next = `${value.slice(0, start)}${stripped}${value.slice(end)}`;
    applyTextareaChange(textarea, next, start, start + stripped.length);
    return;
  }
  const stripped = stripBbcode(value);
  applyTextareaChange(textarea, stripped, 0, stripped.length);
}

function renderPreviewHtml(raw: string): string {
  let html = escapeHtml(String(raw || ''));
  html = renderBbcodeMarkup(html);
  html = renderStickerText(html);
  html = renderGifText(html);
  // Preview uses simpler line breaks for plain segments.
  if (!/<(pre|table|ul|ol|blockquote|h[3-5]|div|hr)\b/i.test(html)) {
    html = html
      .split('\n')
      .map((line) => {
        const isGreentext = /^&gt;(?!&gt;)/.test(line);
        return `<div class="post-line ${isGreentext ? 'greentext' : ''}">${line || '&nbsp;'}</div>`;
      })
      .join('');
  } else {
    html = html.replace(/\n/g, '<br />');
  }
  return html || '<p class="muted">Chưa có nội dung để xem trước.</p>';
}

function closeAllColorPanels(root: ParentNode = document) {
  root.querySelectorAll('.fmt-color-panel').forEach((panel) => panel.classList.add('hidden'));
  root.querySelectorAll('.fmt-color-trigger').forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
}

function handleFormatAction(
  target: ComposerTarget,
  action: string,
  els: AnyRecord,
  value?: string,
  showToast?: (message: string) => void
) {
  const textarea = getTextarea(target, els);
  if (!textarea) {
    return;
  }
  const root = textarea.closest('.composer-body-wrap') || textarea.parentElement;
  const formatRoot = root?.querySelector?.(`[data-composer-format="${target}"]`) as HTMLElement | null;
  const toolbar = formatRoot?.querySelector('.composer-format-toolbar') as HTMLElement | null;
  const preview = formatRoot?.querySelector(`[data-composer-preview="${target}"]`) as HTMLElement | null;

  if (action === 'toggle-bbcode') {
    if (!toolbar) {
      return;
    }
    const hidden = toolbar.classList.toggle('fmt-toolbar-collapsed');
    const btn = formatRoot?.querySelector('[data-fmt="toggle-bbcode"]') as HTMLButtonElement | null;
    btn?.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    btn?.classList.toggle('is-active', !hidden);
    return;
  }

  if (action === 'preview') {
    if (!preview) {
      return;
    }
    const showing = preview.classList.toggle('hidden') === false;
    const btn = formatRoot?.querySelector('[data-fmt="preview"]') as HTMLButtonElement | null;
    btn?.setAttribute('aria-pressed', showing ? 'true' : 'false');
    btn?.classList.toggle('is-active', showing);
    if (showing) {
      preview.innerHTML = `<div class="post-body composer-preview-body">${renderPreviewHtml(textarea.value)}</div>`;
      textarea.classList.add('composer-body-previewing');
    } else {
      preview.innerHTML = '';
      textarea.classList.remove('composer-body-previewing');
    }
    return;
  }

  if (action === 'undo') {
    undoTextarea(textarea);
    return;
  }

  if (action === 'redo') {
    redoTextarea(textarea);
    return;
  }

  // Any edit action leaves preview mode so the textarea stays authoritative.
  if (preview && !preview.classList.contains('hidden')) {
    preview.classList.add('hidden');
    preview.innerHTML = '';
    textarea.classList.remove('composer-body-previewing');
    formatRoot?.querySelector('[data-fmt="preview"]')?.setAttribute('aria-pressed', 'false');
    formatRoot?.querySelector('[data-fmt="preview"]')?.classList.remove('is-active');
  }

  switch (action) {
    case 'b':
      wrapTag(textarea, '[b]', '[/b]', 'in đậm');
      break;
    case 'i':
      wrapTag(textarea, '[i]', '[/i]', 'in nghiêng');
      break;
    case 'u':
      wrapTag(textarea, '[u]', '[/u]', 'gạch chân');
      break;
    case 's':
      wrapTag(textarea, '[s]', '[/s]', 'gạch ngang');
      break;
    case 'icode':
      wrapTag(textarea, '[icode]', '[/icode]', 'code');
      break;
    case 'spoiler':
      wrapTag(textarea, '[spoiler]', '[/spoiler]', 'spoiler');
      break;
    case 'code':
      wrapTag(textarea, '[code]\n', '\n[/code]', 'code ở đây');
      break;
    case 'quote':
      wrapTag(textarea, '[quote]\n', '\n[/quote]', 'trích dẫn');
      break;
    case 'size':
      if (value) {
        wrapAttrTag(textarea, 'size', value, 'cỡ chữ');
      }
      break;
    case 'font':
      if (value) {
        wrapAttrTag(textarea, 'font', value, 'phông chữ');
      }
      break;
    case 'color':
      if (value) {
        wrapAttrTag(textarea, 'color', value, 'màu chữ');
      }
      break;
    case 'list':
      wrapLinesAsList(textarea, false);
      break;
    case 'list=1':
      wrapLinesAsList(textarea, true);
      break;
    case 'indent':
      wrapTag(textarea, '[indent]', '[/indent]', 'thụt lề');
      break;
    case 'outdent':
      outdentSelection(textarea);
      break;
    case 'left':
    case 'center':
    case 'right':
    case 'justify':
      wrapTag(textarea, `[${action}]`, `[/${action}]`, 'văn bản');
      break;
    case 'paragraph':
      applyParagraph(textarea, value || 'normal');
      break;
    case 'table': {
      const snippet =
        '[table]\n[tr][th]Cột 1[/th][th]Cột 2[/th][/tr]\n[tr][td]Ô 1[/td][td]Ô 2[/td][/tr]\n[/table]';
      insertSnippet(textarea, snippet);
      break;
    }
    case 'hr':
      insertSnippet(textarea, '[hr]\n');
      break;
    case 'remove':
      removeFormatting(textarea);
      break;
    default:
      showToast?.('Không nhận diện được thao tác định dạng.');
  }
}

export function mountComposerFormatToolbars(els: AnyRecord = {}): void {
  for (const target of TARGETS) {
    const textarea = getTextarea(target, els);
    if (!textarea || textarea.dataset.formatToolbarMounted === '1') {
      continue;
    }
    textarea.dataset.formatToolbarMounted = '1';

    let wrap = textarea.closest('.composer-body-wrap') as HTMLElement | null;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'composer-body-wrap';
      textarea.parentElement?.insertBefore(wrap, textarea);
      wrap.appendChild(textarea);
    }

    if (!wrap.querySelector(`[data-composer-format="${target}"]`)) {
      wrap.insertAdjacentHTML('afterbegin', toolbarHtml(target));
    }
    ensureHistory(textarea);
    updateUndoRedoButtons(textarea);
    bindTextareaFormatListeners(textarea, target);
  }
}

export function bindComposerFormatToolbars({
  els,
  showToast
}: {
  els: AnyRecord;
  showToast?: (message: string) => void;
}): void {
  mountComposerFormatToolbars(els);

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (!target.closest('[data-fmt-color-menu]')) {
      closeAllColorPanels();
    }

    const toggleColors = target.closest('[data-fmt-toggle-colors]') as HTMLElement | null;
    if (toggleColors) {
      event.preventDefault();
      const menu = toggleColors.closest('[data-fmt-color-menu]');
      const panel = menu?.querySelector('.fmt-color-panel');
      const open = panel?.classList.toggle('hidden') === false;
      toggleColors.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }

    const fmtBtn = target.closest('[data-fmt]') as HTMLElement | null;
    if (!fmtBtn || fmtBtn.tagName === 'SELECT') {
      return;
    }
    const formatRoot = fmtBtn.closest('[data-composer-format]') as HTMLElement | null;
    const composerTarget = (formatRoot?.getAttribute('data-composer-format') || '') as ComposerTarget;
    if (!TARGETS.includes(composerTarget)) {
      return;
    }
    event.preventDefault();
    const action = fmtBtn.getAttribute('data-fmt') || '';
    const value = fmtBtn.getAttribute('data-fmt-value') || undefined;
    handleFormatAction(composerTarget, action, els, value, showToast);
    if (action === 'color') {
      closeAllColorPanels(formatRoot || document);
    }
  });

  document.addEventListener('change', (event) => {
    const select = (event.target as HTMLElement | null)?.closest?.('select[data-fmt]') as HTMLSelectElement | null;
    if (!select) {
      return;
    }
    const formatRoot = select.closest('[data-composer-format]') as HTMLElement | null;
    const composerTarget = (formatRoot?.getAttribute('data-composer-format') || '') as ComposerTarget;
    if (!TARGETS.includes(composerTarget)) {
      return;
    }
    const action = select.getAttribute('data-fmt') || '';
    const value = select.value;
    if (!value && action !== 'paragraph') {
      return;
    }
    handleFormatAction(composerTarget, action, els, value || 'normal', showToast);
    // Reset size/font selects so the same option can be re-applied.
    if (action === 'size' || action === 'font') {
      select.selectedIndex = 0;
    }
    if (action === 'paragraph') {
      select.value = 'normal';
    }
  });

  document.addEventListener('keydown', (event) => {
    const active = document.activeElement as HTMLTextAreaElement | null;
    if (!active || active.tagName !== 'TEXTAREA') {
      return;
    }
    const id = active.id || '';
    let target: ComposerTarget | null = null;
    if (id === TEXTAREA_IDS.thread) target = 'thread';
    if (id === TEXTAREA_IDS.comment) target = 'comment';
    if (id === TEXTAREA_IDS.quickReply) target = 'quickReply';
    if (id === TEXTAREA_IDS.postEdit) target = 'postEdit';
    if (!target) {
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();

    // Undo / Redo take priority over format shortcuts.
    if (key === 'z' && event.shiftKey) {
      event.preventDefault();
      redoTextarea(active);
      return;
    }
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoTextarea(active);
      return;
    }
    if (key === 'y') {
      event.preventDefault();
      redoTextarea(active);
      return;
    }

    const map: Record<string, string> = {
      b: 'b',
      i: 'i',
      u: 'u',
      s: 's'
    };
    const action = map[key];
    if (!action) {
      return;
    }
    event.preventDefault();
    handleFormatAction(target, action, els, undefined, showToast);
  });

  // Live-refresh preview when typing if preview is open; also track typing history.
  // Dynamic targets (e.g. post-edit modal) are bound inside mountComposerFormatToolbars.
  for (const target of TARGETS) {
    const textarea = getTextarea(target, els);
    if (!textarea) {
      continue;
    }
    ensureHistory(textarea);
    updateUndoRedoButtons(textarea);
    bindTextareaFormatListeners(textarea, target);
  }
}
