import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCustomStickers,
  normalizeImgurStickerUrl
} from '../src/core/custom-stickers.ts';
import { createForumService } from '../src/core/forum-service.ts';
import { createMemoryStore } from '../src/core/forum-store.ts';

function statusIs(statusCode: number) {
  return (error: unknown) =>
    typeof error === 'object' && error !== null && (error as { statusCode?: number }).statusCode === statusCode;
}

test('custom sticker URLs accept single Imgur images and reject unsafe links', () => {
  assert.equal(normalizeImgurStickerUrl('https://imgur.com/AbC123'), 'https://i.imgur.com/AbC123.png');
  assert.equal(normalizeImgurStickerUrl('https://i.imgur.com/XyZ987.jpeg?1'), 'https://i.imgur.com/XyZ987.jpg');
  assert.throws(() => normalizeImgurStickerUrl('https://imgur.com/a/f2ntKyZ'), statusIs(400));
  assert.throws(() => normalizeImgurStickerUrl('https://evil.test/sticker.png'), statusIs(400));
  assert.throws(() => normalizeImgurStickerUrl('https://i.imgur.com/vector.svg'), statusIs(400));
});

test('owner-managed custom stickers persist, de-duplicate, and soft-hide', async () => {
  const store = createMemoryStore();
  const service = createForumService({
    store,
    ai: {
      async moderate() {
        return { status: 'Safe', labels: [] };
      }
    },
    now: () => new Date('2026-07-17T08:00:00.000Z')
  });

  const created = await service.addCustomSticker(
    { label: ' <b>Mèo vui</b> ', url: 'https://imgur.com/Cat123' },
    { actor: 'owner' }
  );
  assert.match(created.key, /^custom-[a-f0-9-]{36}$/);
  assert.equal(created.label, 'Mèo vui');
  assert.equal(created.url, 'https://i.imgur.com/Cat123.png');
  assert.equal(created.active, true);

  await assert.rejects(
    () => service.addCustomSticker({ url: 'https://i.imgur.com/Cat123.png' }, { actor: 'owner' }),
    statusIs(409)
  );

  const hidden = await service.setCustomStickerActive(created.key, false, { actor: 'owner' });
  assert.equal(hidden.active, false);
  assert.deepEqual(await service.getCustomStickers(), [hidden]);

  const rawState = await store.read();
  assert.deepEqual(normalizeCustomStickers(rawState.adminSettings.customStickers), [hidden]);
});
