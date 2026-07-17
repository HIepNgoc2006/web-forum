const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 6;
const MAX_POLL_OPTION_LENGTH = 120;

function replaceAsciiControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  }).join('');
}

export function parsePollOptions(value: unknown): string[] {
  const options = String(value ?? '')
    .split(/\r?\n/)
    .map((option) => replaceAsciiControlCharacters(option).replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (options.length === 0) {
    return [];
  }
  if (options.length < MIN_POLL_OPTIONS) {
    throw new Error('Th\u0103m d\u00f2 c\u1ea7n \u00edt nh\u1ea5t 2 l\u1ef1a ch\u1ecdn');
  }
  if (options.length > MAX_POLL_OPTIONS) {
    throw new Error('Th\u0103m d\u00f2 c\u00f3 t\u1ed1i \u0111a 6 l\u1ef1a ch\u1ecdn');
  }

  const seen = new Set<string>();
  for (const option of options) {
    if (option.length > MAX_POLL_OPTION_LENGTH) {
      throw new Error('M\u1ed7i l\u1ef1a ch\u1ecdn th\u0103m d\u00f2 t\u1ed1i \u0111a 120 k\u00fd t\u1ef1');
    }
    const key = option.toLowerCase();
    if (seen.has(key)) {
      throw new Error('C\u00e1c l\u1ef1a ch\u1ecdn th\u0103m d\u00f2 kh\u00f4ng \u0111\u01b0\u1ee3c tr\u00f9ng nhau');
    }
    seen.add(key);
  }

  return options;
}
