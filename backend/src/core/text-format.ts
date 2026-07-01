export type PostTextLineType = 'greentext' | 'text';

export interface ParsedPostTextLine {
  type: PostTextLineType;
  text: string;
  refs: number[];
}

export function sanitizeText(value: unknown = ''): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeBody(value: unknown = ''): string {
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, 5000);
}

export function parsePostText(value: unknown = ''): ParsedPostTextLine[] {
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
