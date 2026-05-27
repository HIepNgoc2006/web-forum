export function sanitizeText(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeBody(value = '') {
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, 5000);
}

export function parsePostText(value = '') {
  return normalizeBody(value)
    .split('\n')
    .map((rawLine) => {
      const refs = [...rawLine.matchAll(/>>(\d+)/g)].map((match) => Number(match[1]));
      return {
        type: rawLine.startsWith('>') ? 'greentext' : 'text',
        text: sanitizeText(rawLine),
        refs
      };
    });
}
