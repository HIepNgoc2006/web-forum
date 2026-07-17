export type StickerDefinition = {
  key: string;
  label: string;
  icon?: string;
  src?: string;
  width?: number;
  height?: number;
  picker: boolean;
  sourceUrl?: string;
  custom?: boolean;
  active?: boolean;
  createdAt?: string;
};

const CUSTOM_STICKER_KEY_PATTERN = /^custom-[a-z0-9-]{8,80}$/;
const IMGUR_STICKER_PATH_PATTERN = /^\/[a-zA-Z0-9]+\.(png|jpe?g|gif|webp)$/i;
const customStickerKeys = new Set<string>();

export function isCustomStickerKey(value: unknown): boolean {
  return CUSTOM_STICKER_KEY_PATTERN.test(String(value ?? '').trim().toLowerCase());
}

export function safeImgurStickerUrl(value: unknown): string {
  try {
    const url = new URL(String(value ?? '').trim());
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'i.imgur.com' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !IMGUR_STICKER_PATH_PATTERN.test(url.pathname)
    ) {
      return '';
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

const legacyStickers: StickerDefinition[] = [
  { key: 'cheer', icon: '🎉', label: 'Cổ vũ', picker: false },
  { key: 'panic', icon: '😱', label: 'Hoảng', picker: false },
  { key: 'study', icon: '📚', label: 'Học', picker: false },
  { key: 'thanks', icon: '🙏', label: 'Cảm ơn', picker: false }
];

const pepeVangVauMetadata = [
  ['gulEHPV', 'png', 106, 100],
  ['KPDr13y', 'png', 80, 80],
  ['i0oFXpc', 'png', 80, 53],
  ['xYNbr9A', 'png', 83, 76],
  ['DO6ZsaE', 'png', 56, 56],
  ['JQwkuSi', 'png', 67, 80],
  ['7vMYZ5z', 'png', 80, 91],
  ['c3ej25G', 'png', 80, 77],
  ['jd3lGPM', 'png', 56, 56],
  ['aKIgAHP', 'png', 80, 80],
  ['5vAUedR', 'jpg', 80, 80],
  ['sCyCFTn', 'png', 56, 51],
  ['SOBeCRy', 'png', 80, 80],
  ['AA0UdrC', 'png', 111, 100],
  ['ipp8I0n', 'png', 118, 80],
  ['s0XjggS', 'png', 56, 56],
  ['nj6va2a', 'png', 80, 80],
  ['5B6ZOt0', 'png', 80, 80],
  ['fxXDyeS', 'png', 95, 84],
  ['gKrDjrS', 'png', 80, 80],
  ['VfWz9Sk', 'png', 80, 80],
  ['R3NyhCt', 'jpg', 80, 80],
  ['wR0CHyz', 'png', 120, 70],
  ['TxMdUrC', 'png', 80, 80],
  ['jyFtIVG', 'png', 100, 100],
  ['5BC9Qn2', 'png', 80, 79],
  ['QnbVsBM', 'png', 80, 80],
  ['CifBgsO', 'png', 80, 80],
  ['mpiS25H', 'png', 80, 80],
  ['27SuJxf', 'png', 80, 80],
  ['AXDQva5', 'png', 104, 79],
  ['iEFRFv3', 'png', 92, 80],
  ['zgKHdjM', 'png', 80, 80],
  ['IKDiosi', 'png', 80, 90]
] as const;

export const STICKER_PICKER_ITEMS: StickerDefinition[] = pepeVangVauMetadata.map(
  ([sourceId, extension, width, height], index) => {
    const number = String(index + 1).padStart(2, '0');
    return {
      key: 'pepe-vang-vau-' + number,
      label: 'Pepe vàng vẩu ' + number,
      src: '/stickers/pepe-vang-vau/' + number + '.' + extension,
      width,
      height,
      picker: true,
      sourceUrl: 'https://i.imgur.com/' + sourceId + '.' + extension
    };
  }
);

export const STICKERS: Record<string, StickerDefinition> = Object.fromEntries(
  [...legacyStickers, ...STICKER_PICKER_ITEMS].map((sticker) => [sticker.key, sticker])
);

export function normalizeCustomStickerCatalog(value: unknown): StickerDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const stickers: StickerDefinition[] = [];
  const keys = new Set<string>();
  const urls = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const key = String(record.key ?? '').trim().toLowerCase();
    const src = safeImgurStickerUrl(record.url);
    if (!isCustomStickerKey(key) || !src || keys.has(key) || urls.has(src) || STICKER_PICKER_ITEMS.some((sticker) => sticker.key === key)) {
      continue;
    }
    keys.add(key);
    urls.add(src);
    stickers.push({
      key,
      label: String(record.label || 'Sticker tùy chỉnh').trim().slice(0, 80) || 'Sticker tùy chỉnh',
      src,
      picker: record.active !== false,
      sourceUrl: src,
      custom: true,
      active: record.active !== false,
      createdAt: String(record.createdAt || '')
    });
    if (stickers.length >= 100) {
      break;
    }
  }
  return stickers;
}

export function applyCustomStickerCatalog(value: unknown): StickerDefinition[] {
  for (const key of customStickerKeys) {
    delete STICKERS[key];
  }
  customStickerKeys.clear();
  const stickers = normalizeCustomStickerCatalog(value);
  for (const sticker of stickers) {
    STICKERS[sticker.key] = sticker;
    customStickerKeys.add(sticker.key);
  }
  return stickers;
}

export function getStickerPickerItems(): StickerDefinition[] {
  return [
    ...STICKER_PICKER_ITEMS,
    ...[...customStickerKeys]
      .map((key) => STICKERS[key])
      .filter((sticker): sticker is StickerDefinition => Boolean(sticker?.picker && sticker.src))
  ];
}

export const STICKER_SOURCE_ALBUM = 'https://imgur.com/a/f2ntKyZ';
