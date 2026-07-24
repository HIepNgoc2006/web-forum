/**
 * BBCode helpers for post bodies.
 * Input is already HTML-escaped (from parsePostText / escapeHtml).
 * Tags survive escaping and are expanded into safe HTML here.
 */

const SAFE_COLORS = new Set([
  'black',
  'white',
  'red',
  'green',
  'blue',
  'navy',
  'purple',
  'orange',
  'brown',
  'gray',
  'grey',
  'maroon',
  'teal',
  'olive',
  'silver',
  'yellow',
  'lime',
  'aqua',
  'fuchsia',
  'cyan',
  'magenta',
  'pink',
  'gold'
]);

const SAFE_FONTS = new Set([
  'arial',
  'helvetica',
  'times new roman',
  'times',
  'courier new',
  'courier',
  'verdana',
  'georgia',
  'tahoma',
  'trebuchet ms',
  'comic sans ms',
  'impact',
  'lucida console',
  'palatino linotype',
  'segoe ui',
  'system-ui',
  'sans-serif',
  'serif',
  'monospace'
]);

function clampSize(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  const rounded = Math.round(n);
  if (rounded < 9 || rounded > 26) {
    return null;
  }
  return rounded;
}

function safeColor(value: string): string | null {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) {
    return raw.toLowerCase();
  }
  const name = raw.toLowerCase();
  return SAFE_COLORS.has(name) ? name : null;
}

function safeFont(value: string): string | null {
  const raw = String(value || '')
    .trim()
    .replace(/['"]/g, '')
    .toLowerCase();
  if (!raw || raw.length > 40) {
    return null;
  }
  return SAFE_FONTS.has(raw) ? raw : null;
}

function protectSegments(
  html: string,
  pattern: RegExp,
  wrap: (inner: string, full: string) => string,
  kind: string
) {
  const slots: string[] = [];
  // Unique kind keeps nested protect/restore passes from wiping each other.
  const prefix = `\uE000${kind}:`;
  const suffix = '\uE001';
  const next = String(html).replace(pattern, (full, ...args) => {
    const inner = typeof args[0] === 'string' ? args[0] : '';
    const token = `${prefix}${slots.length}${suffix}`;
    slots.push(wrap(inner, full));
    return token;
  });
  return { html: next, slots, prefix, suffix };
}

function restoreSlots(
  html: string,
  slots: string[],
  prefix: string,
  suffix: string
) {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(html).replace(
    new RegExp(`${escapedPrefix}(\\d+)${escapedSuffix}`, 'g'),
    (_m, index) => slots[Number(index)] ?? ''
  );
}

function renderListBody(inner: string, ordered: boolean): string {
  const items = String(inner)
    .replace(/^\s*\[\*\]\s*/i, '')
    .split(/\[\*\]/i)
    .map((item) => item.replace(/^\s+|\s+$/g, ''))
    .filter((item) => item.length > 0);
  if (!items.length) {
    return ordered ? '<ol class="post-list"></ol>' : '<ul class="post-list"></ul>';
  }
  const lis = items.map((item) => `<li>${item}</li>`).join('');
  return ordered ? `<ol class="post-list">${lis}</ol>` : `<ul class="post-list">${lis}</ul>`;
}

function renderTableBody(inner: string): string {
  let body = String(inner);
  body = body.replace(/\[tr\]([\s\S]*?)\[\/tr\]/gi, (_m, rowInner) => {
    let row = String(rowInner);
    row = row.replace(/\[th\]([\s\S]*?)\[\/th\]/gi, (_hm, cell) => `<th>${cell}</th>`);
    row = row.replace(/\[td\]([\s\S]*?)\[\/td\]/gi, (_dm, cell) => `<td>${cell}</td>`);
    return `<tr>${row}</tr>`;
  });
  return `<table class="post-table">${body}</table>`;
}

/** Expand BBCode + markdown-like inline tags in already-escaped HTML. */
export function renderBbcodeMarkup(html: string): string {
  let out = String(html || '');

  // Protect code blocks first so inner markup is not processed.
  // Match [code] but not [icode] via negative lookbehind.
  const codeBlocks = protectSegments(
    out,
    /(?<!\[i)\[code\]([\s\S]*?)\[\/code\]/gi,
    (inner) => {
      const trimmed = inner.replace(/^\n+|\n+$/g, '');
      return `<pre class="post-code"><code>${trimmed}</code></pre>`;
    },
    'code'
  );
  out = codeBlocks.html;

  const inlineCodes = protectSegments(
    out,
    /\[icode\]([\s\S]*?)\[\/icode\]/gi,
    (inner) => `<code class="post-icode">${inner}</code>`,
    'icode'
  );
  out = inlineCodes.html;

  // Horizontal rules (standalone).
  out = out.replace(/\[hr\]/gi, '<hr class="post-hr" />');

  // Block alignment / indent / headings / quote / spoiler (multi-line ok).
  const blockPairs: Array<[RegExp, (inner: string) => string]> = [
    [/\[quote\]([\s\S]*?)\[\/quote\]/gi, (inner) => `<blockquote class="post-quote">${inner}</blockquote>`],
    [/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, (inner) =>
      `<span class="spoiler-text" data-spoiler tabindex="0" title="Bấm để hiện">${inner}</span>`
    ],
    [/\[h1\]([\s\S]*?)\[\/h1\]/gi, (inner) => `<h3 class="post-heading post-h1">${inner}</h3>`],
    [/\[h2\]([\s\S]*?)\[\/h2\]/gi, (inner) => `<h4 class="post-heading post-h2">${inner}</h4>`],
    [/\[h3\]([\s\S]*?)\[\/h3\]/gi, (inner) => `<h5 class="post-heading post-h3">${inner}</h5>`],
    [/\[left\]([\s\S]*?)\[\/left\]/gi, (inner) => `<div class="post-align post-align-left">${inner}</div>`],
    [/\[center\]([\s\S]*?)\[\/center\]/gi, (inner) => `<div class="post-align post-align-center">${inner}</div>`],
    [/\[right\]([\s\S]*?)\[\/right\]/gi, (inner) => `<div class="post-align post-align-right">${inner}</div>`],
    [/\[justify\]([\s\S]*?)\[\/justify\]/gi, (inner) => `<div class="post-align post-align-justify">${inner}</div>`],
    [/\[indent\]([\s\S]*?)\[\/indent\]/gi, (inner) => `<div class="post-indent">${inner}</div>`]
  ];
  for (const [pattern, wrap] of blockPairs) {
    // Allow limited nesting depth.
    for (let i = 0; i < 4; i += 1) {
      const next = out.replace(pattern, (_m, inner) => wrap(inner));
      if (next === out) {
        break;
      }
      out = next;
    }
  }

  // Lists.
  for (let i = 0; i < 4; i += 1) {
    const next = out
      .replace(/\[list=1\]([\s\S]*?)\[\/list\]/gi, (_m, inner) => renderListBody(inner, true))
      .replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_m, inner) => renderListBody(inner, false));
    if (next === out) {
      break;
    }
    out = next;
  }

  // Tables.
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(/\[table\]([\s\S]*?)\[\/table\]/gi, (_m, inner) => renderTableBody(inner));
    if (next === out) {
      break;
    }
    out = next;
  }

  // Inline style tags.
  for (let i = 0; i < 4; i += 1) {
    const next = out
      .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
      .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
      .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<span class="post-underline">$1</span>')
      .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<del>$1</del>')
      .replace(/\[size=(\d{1,2})\]([\s\S]*?)\[\/size\]/gi, (_m, size, inner) => {
        const px = clampSize(size);
        return px ? `<span class="post-size" style="font-size:${px}px">${inner}</span>` : inner;
      })
      .replace(/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi, (_m, color, inner) => {
        const safe = safeColor(color);
        return safe ? `<span class="post-color" style="color:${safe}">${inner}</span>` : inner;
      })
      .replace(/\[font=([^\]]+)\]([\s\S]*?)\[\/font\]/gi, (_m, font, inner) => {
        const safe = safeFont(font);
        return safe ? `<span class="post-font" style="font-family:${safe}">${inner}</span>` : inner;
      });
    if (next === out) {
      break;
    }
    out = next;
  }

  // Legacy markdown-like inline (outside protected code).
  out = out
    .replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^\n*]+?)\*/g, '<em>$1</em>')
    .replace(/~~([^\n~]+?)~~/g, '<del>$1</del>');

  out = restoreSlots(out, inlineCodes.slots, inlineCodes.prefix, inlineCodes.suffix);
  out = restoreSlots(out, codeBlocks.slots, codeBlocks.prefix, codeBlocks.suffix);
  return out;
}

/** Strip BBCode tags (and light markdown) from raw draft text. */
export function stripBbcode(text: string): string {
  let out = String(text || '');
  // Remove paired tags repeatedly.
  const pairPatterns = [
    /\[b\]([\s\S]*?)\[\/b\]/gi,
    /\[i\]([\s\S]*?)\[\/i\]/gi,
    /\[u\]([\s\S]*?)\[\/u\]/gi,
    /\[s\]([\s\S]*?)\[\/s\]/gi,
    /\[icode\]([\s\S]*?)\[\/icode\]/gi,
    /\[code\]([\s\S]*?)\[\/code\]/gi,
    /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi,
    /\[quote\]([\s\S]*?)\[\/quote\]/gi,
    /\[h1\]([\s\S]*?)\[\/h1\]/gi,
    /\[h2\]([\s\S]*?)\[\/h2\]/gi,
    /\[h3\]([\s\S]*?)\[\/h3\]/gi,
    /\[left\]([\s\S]*?)\[\/left\]/gi,
    /\[center\]([\s\S]*?)\[\/center\]/gi,
    /\[right\]([\s\S]*?)\[\/right\]/gi,
    /\[justify\]([\s\S]*?)\[\/justify\]/gi,
    /\[indent\]([\s\S]*?)\[\/indent\]/gi,
    /\[size=\d{1,2}\]([\s\S]*?)\[\/size\]/gi,
    /\[color=[^\]]+\]([\s\S]*?)\[\/color\]/gi,
    /\[font=[^\]]+\]([\s\S]*?)\[\/font\]/gi,
    /\[list(?:=1)?\]([\s\S]*?)\[\/list\]/gi,
    /\[table\]([\s\S]*?)\[\/table\]/gi,
    /\[tr\]([\s\S]*?)\[\/tr\]/gi,
    /\[th\]([\s\S]*?)\[\/th\]/gi,
    /\[td\]([\s\S]*?)\[\/td\]/gi
  ];
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;
    for (const pattern of pairPatterns) {
      const next = out.replace(pattern, '$1');
      if (next !== out) {
        changed = true;
        out = next;
      }
    }
    if (!changed) {
      break;
    }
  }
  out = out
    .replace(/\[\*\]/gi, '')
    .replace(/\[hr\]/gi, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1');
  return out;
}

export function stripBbcodeTagsForPreview(text: string): string {
  return stripBbcode(text)
    .replace(/\s+/g, ' ')
    .trim();
}

export const BBCODE_FONT_OPTIONS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Georgia',
  'Tahoma',
  'Trebuchet MS',
  'Comic Sans MS',
  'Impact',
  'Segoe UI',
  'monospace'
];

export const BBCODE_SIZE_OPTIONS = Array.from({ length: 26 - 9 + 1 }, (_, i) => 9 + i);

export const BBCODE_COLOR_OPTIONS = [
  { label: 'Đen', value: '#000000' },
  { label: 'Đỏ', value: '#cc0000' },
  { label: 'Cam', value: '#e67e22' },
  { label: 'Vàng', value: '#f1c40f' },
  { label: 'Xanh lá', value: '#27ae60' },
  { label: 'Xanh dương', value: '#2980b9' },
  { label: 'Tím', value: '#8e44ad' },
  { label: 'Hồng', value: '#e91e63' },
  { label: 'Nâu', value: '#8b4513' },
  { label: 'Xám', value: '#7f8c8d' },
  { label: 'Trắng', value: '#ffffff' }
];
