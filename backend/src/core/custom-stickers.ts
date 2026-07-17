export const MAX_CUSTOM_STICKERS = 100;

export type CustomSticker = {
  key: string;
  label: string;
  url: string;
  active: boolean;
  createdAt: string;
};

type StickerError = Error & {
  statusCode?: number;
};

const CUSTOM_STICKER_KEY_PATTERN = /^custom-[a-z0-9-]{8,80}$/;
const IMGUR_IMAGE_PATH_PATTERN = /^\/([a-zA-Z0-9]+)(?:\.(png|jpe?g|gif|webp))?\/?$/i;
const IMGUR_HOSTS = new Set(['imgur.com', 'www.imgur.com', 'i.imgur.com']);

function invalidSticker(message: string, statusCode = 400): StickerError {
  const error: StickerError = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeStickerLabel(value: unknown, fallback: string): string {
  const label = String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return label || fallback;
}

export function normalizeImgurStickerUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 500) {
    throw invalidSticker('Liên kết sticker Imgur không hợp lệ');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalidSticker('Liên kết sticker Imgur không hợp lệ');
  }

  const hostname = url.hostname.toLowerCase();
  const pathMatch = url.pathname.match(IMGUR_IMAGE_PATH_PATTERN);
  if (
    url.protocol !== 'https:' ||
    !IMGUR_HOSTS.has(hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !pathMatch
  ) {
    throw invalidSticker('Chỉ hỗ trợ liên kết ảnh Imgur đơn lẻ');
  }

  const imageId = pathMatch[1];
  const extension = String(pathMatch[2] || 'png').toLowerCase().replace('jpeg', 'jpg');
  return `https://i.imgur.com/${imageId}.${extension}`;
}

export function assertCustomStickerKey(value: unknown): string {
  const key = String(value ?? '').trim().toLowerCase();
  if (!CUSTOM_STICKER_KEY_PATTERN.test(key)) {
    throw invalidSticker('Mã sticker tùy chỉnh không hợp lệ');
  }
  return key;
}

export function createCustomSticker({
  key,
  label,
  url,
  createdAt
}: {
  key: unknown;
  label?: unknown;
  url: unknown;
  createdAt: unknown;
}): CustomSticker {
  const safeKey = assertCustomStickerKey(key);
  const safeUrl = normalizeImgurStickerUrl(url);
  const imageId = new URL(safeUrl).pathname.split('/').pop()?.split('.')[0] || 'Imgur';
  const date = new Date(String(createdAt ?? ''));
  if (!Number.isFinite(date.getTime())) {
    throw invalidSticker('Thời gian tạo sticker không hợp lệ');
  }
  return {
    key: safeKey,
    label: sanitizeStickerLabel(label, `Sticker ${imageId}`),
    url: safeUrl,
    active: true,
    createdAt: date.toISOString()
  };
}

export function normalizeCustomSticker(value: unknown): CustomSticker | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  try {
    const sticker = createCustomSticker({
      key: record.key,
      label: record.label,
      url: record.url,
      createdAt: record.createdAt
    });
    return {
      ...sticker,
      active: record.active !== false
    };
  } catch {
    return null;
  }
}

export function normalizeCustomStickers(value: unknown): CustomSticker[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const stickers: CustomSticker[] = [];
  const keys = new Set<string>();
  const urls = new Set<string>();
  for (const valueItem of value) {
    const sticker = normalizeCustomSticker(valueItem);
    if (!sticker || keys.has(sticker.key) || urls.has(sticker.url)) {
      continue;
    }
    keys.add(sticker.key);
    urls.add(sticker.url);
    stickers.push(sticker);
    if (stickers.length >= MAX_CUSTOM_STICKERS) {
      break;
    }
  }
  return stickers;
}
