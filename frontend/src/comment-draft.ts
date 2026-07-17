export type AppendedReplyQuote = {
  value: string;
  changed: boolean;
};

export function appendReplyQuote(
  value: string,
  number: string | number,
  selectedQuote = ''
): AppendedReplyQuote {
  const existingLines = value.split('\n');
  const existingNormalized = new Set(
    existingLines.map((line) => line.trim()).filter(Boolean)
  );
  const additions: string[] = [];

  const addLine = (line: string) => {
    const normalized = line.trim();
    if (
      normalized &&
      !existingNormalized.has(normalized) &&
      !additions.includes(normalized)
    ) {
      additions.push(normalized);
    }
  };

  addLine('>>' + number);
  selectedQuote.split('\n').forEach(addLine);

  if (!additions.length) {
    return { value, changed: false };
  }

  const separator = value && !value.endsWith('\n') ? '\n' : '';
  return {
    value: value + separator + additions.join('\n') + '\n',
    changed: true
  };
}
