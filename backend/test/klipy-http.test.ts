import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import type { KlipyClient, KlipyGif, KlipyPage } from '../src/core/klipy.ts';
import { createHttpServer } from '../src/server/http-app.ts';

type JsonResponse = {
  data?: unknown;
  error?: { message?: string };
};

async function readJson(response: Response): Promise<JsonResponse> {
  return response.json() as Promise<JsonResponse>;
}

const gif: KlipyGif = {
  slug: 'hello-hi-662',
  title: 'Hello',
  type: 'gif',
  preview: {
    url: 'https://static.klipy.com/media/hello-hi-662-preview.gif',
    width: 240,
    height: 135
  },
  full: {
    url: 'https://static.klipy.com/media/hello-hi-662-full.gif',
    width: 480,
    height: 270
  }
};

const page: KlipyPage = {
  items: [gif],
  page: 1,
  perPage: 24,
  hasNext: false
};

async function withGifServer(gifClient: KlipyClient | undefined, callback: (baseUrl: string) => Promise<void>) {
  const server = createHttpServer({
    service: {},
    realtime: {},
    gifClient,
    forceConnectionClose: true
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('KLIPY HTTP routes map public inputs and return normalized client results', async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const gifClient: KlipyClient = {
    type: 'klipy',
    configured: true,
    async trending(options = {}) {
      calls.push({ method: 'trending', input: options });
      return { ...page, page: options.page ?? page.page, perPage: options.perPage ?? page.perPage };
    },
    async search(options) {
      calls.push({ method: 'search', input: options });
      return { ...page, page: options.page ?? page.page, perPage: options.perPage ?? page.perPage };
    },
    async items(slugs) {
      calls.push({ method: 'items', input: slugs });
      return [gif];
    },
    async share(options) {
      calls.push({ method: 'share', input: options });
      return { shared: true };
    }
  };

  await withGifServer(gifClient, async (baseUrl) => {
    const trending = await fetch(`${baseUrl}/api/media/gifs/trending?page=2&perPage=12`);
    assert.equal(trending.status, 200);
    assert.deepEqual((await readJson(trending)).data, { ...page, page: 2, perPage: 12 });

    const search = await fetch(`${baseUrl}/api/media/gifs/search?q=xin%20ch%C3%A0o&page=3&perPage=8`);
    assert.equal(search.status, 200);
    assert.deepEqual((await readJson(search)).data, { ...page, page: 3, perPage: 8 });

    const items = await fetch(`${baseUrl}/api/media/gifs/items?slugs=hello-hi-662,thanks-12`);
    assert.equal(items.status, 200);
    assert.deepEqual((await readJson(items)).data, [gif]);

    const share = await fetch(`${baseUrl}/api/media/gifs/hello-hi-662/share`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer must-not-be-forwarded',
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9'
      },
      body: JSON.stringify({ query: 'hello there', customerId: 'must-not-be-forwarded' })
    });
    assert.equal(share.status, 200);
    assert.deepEqual((await readJson(share)).data, { shared: true });
  });

  assert.deepEqual(calls, [
    { method: 'trending', input: { page: 2, perPage: 12 } },
    { method: 'search', input: { query: 'xin chào', page: 3, perPage: 8 } },
    { method: 'items', input: ['hello-hi-662', 'thanks-12'] },
    { method: 'share', input: { slug: 'hello-hi-662', query: 'hello there' } }
  ]);
});

test('KLIPY HTTP routes return 503 when the server-side client is unavailable', async () => {
  await withGifServer(undefined, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/media/gifs/trending`);
    assert.equal(response.status, 503);
    assert.match((await readJson(response)).error?.message ?? '', /KLIPY_API_KEY/);
  });
});
