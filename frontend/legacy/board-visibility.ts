export function isHiddenBoardSlug(slug: unknown, hiddenSlugs: Iterable<unknown>): boolean {
  const safeSlug = String(slug);
  for (const hiddenSlug of hiddenSlugs) {
    if (String(hiddenSlug) === safeSlug) {
      return true;
    }
  }
  return false;
}

export function filterHiddenBoards<T extends { slug?: unknown }>(
  boards: T[],
  hiddenSlugs: Iterable<unknown>,
): T[] {
  const hidden = new Set([...hiddenSlugs].map(String));
  if (!hidden.size) {
    return boards;
  }
  return boards.filter((board) => board && !hidden.has(String(board.slug)));
}
