import assert from 'node:assert/strict';
import test from 'node:test';

import { klipyGifToken, normalizeKlipySlug } from '../src/media-tokens.ts';
import {
  STICKERS,
  STICKER_PICKER_ITEMS,
  applyCustomStickerCatalog,
  getStickerPickerItems,
  safeImgurStickerUrl
} from '../src/stickers.ts';

test('KLIPY tokens accept provider slugs and reject attribute-shaped input', () => {
  assert.equal(normalizeKlipySlug('happy-dance_123'), 'happy-dance_123');
  assert.equal(klipyGifToken('happy-dance_123'), '[gif:klipy:happy-dance_123]');
  assert.equal(normalizeKlipySlug('bad"><img'), '');
  assert.equal(klipyGifToken('bad"><img'), '');
});

test('sticker catalog exposes local picker images without legacy shortcuts', () => {
  assert.equal(STICKER_PICKER_ITEMS.length, 34);
  assert.ok(STICKER_PICKER_ITEMS.every((sticker) => sticker.picker));
  assert.ok(STICKER_PICKER_ITEMS.every((sticker) => sticker.src?.startsWith('/stickers/pepe-vang-vau/')));
  assert.equal(STICKER_PICKER_ITEMS.some((sticker) => sticker.key === 'cheer'), false);
  assert.equal(STICKERS.cheer.picker, false);
});

test('custom sticker catalog validates Imgur media and preserves hidden token rendering', () => {
  assert.equal(safeImgurStickerUrl('https://i.imgur.com/AbC123.png?1'), 'https://i.imgur.com/AbC123.png');
  assert.equal(safeImgurStickerUrl('https://imgur.com/AbC123'), '');
  assert.equal(safeImgurStickerUrl('https://evil.test/AbC123.png'), '');

  applyCustomStickerCatalog([
    {
      key: 'custom-12345678',
      label: 'Mèo vui',
      url: 'https://i.imgur.com/AbC123.png',
      active: false,
      createdAt: '2026-07-17T08:00:00.000Z'
    }
  ]);
  assert.equal(getStickerPickerItems().some((sticker) => sticker.key === 'custom-12345678'), false);
  assert.equal(STICKERS['custom-12345678'].custom, true);
  assert.equal(STICKERS['custom-12345678'].picker, false);

  applyCustomStickerCatalog([]);
  assert.equal(STICKERS['custom-12345678'], undefined);
});
