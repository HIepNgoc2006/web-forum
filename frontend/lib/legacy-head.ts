function extractElement(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? '' : source.slice(start, end + endMarker.length);
}

function extractScript(source: string): string {
  const element = extractElement(source, '<script>', '</script>');
  return element ? element.slice('<script>'.length, -'</script>'.length) : '';
}

export function legacyInitialRouteScript(headHtml: string): string {
  const script = extractScript(headHtml);
  return script.includes('dataset.initialScreen') ? script : '';
}

export function legacyBodyClassScript(shellHtml: string): string {
  const script = extractScript(shellHtml);
  return script.includes("classList.toggle('home-page'") ? script : '';
}

export function legacyInitialRouteMarkup(headHtml: string): string {
  const script = legacyInitialRouteScript(headHtml);
  const style = extractElement(headHtml, '<style id="initial-route-style">', '</style>');
  if (!script || !style) return '';
  return `<script>${script}</script>\n${style}`;
}
