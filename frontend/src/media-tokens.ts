const KLIPY_SLUG_PATTERN = /^[a-z0-9_-]{1,120}$/i;

export function normalizeKlipySlug(value: unknown): string {
  const slug = String(value ?? '').trim();
  return KLIPY_SLUG_PATTERN.test(slug) ? slug : '';
}

export function klipyGifToken(value: unknown): string {
  const slug = normalizeKlipySlug(value);
  return slug ? `[gif:klipy:${slug}]` : '';
}
