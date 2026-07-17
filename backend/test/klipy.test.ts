import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createKlipyClient } from '../src/core/klipy.ts';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function gifItem(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug,
    title: 'Hello',
    type: 'gif',
    file: {
      hd: {
        gif: {
          url: `https://static.klipy.com/media/${slug}-full.gif`,
          width: 480,
          height: 270
        }
      },
      sm: {
        gif: {
          url: `https://static1.klipy.com/media/${slug}-preview.gif`,
          width: 240,
          height: 135
        }
      }
    },
    ...overrides
  };
}

function hasStatus(error: unknown, statusCode: number): boolean {
  return typeof error === 'object' && error !== null && (error as { statusCode?: number }).statusCode === statusCode;
}

describe('KLIPY client', () => {
  it('constructs encoded search URLs and never repeats the API key in errors', async () => {
    const calls: Array<{ input: Parameters<typeof fetch>[0]; init?: Parameters<typeof fetch>[1] }> = [];
    const apiKey = 'server/key secret';
    const client = createKlipyClient({
      apiKey,
      fetchImpl: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse({ result: true, data: { data: [], current_page: 2, per_page: 12, has_next: false } });
      }
    });

    const result = await client.search({
      query: 'xin chào',
      page: 2,
      perPage: 12,
      contentFilter: 'medium'
    });

    assert.deepStrictEqual(result, { items: [], page: 2, perPage: 12, hasNext: false });
    assert.strictEqual(calls.length, 1);
    const url = new URL(String(calls[0].input));
    assert.strictEqual(url.origin, 'https://api.klipy.com');
    assert.strictEqual(url.pathname, '/api/v1/server%2Fkey%20secret/gifs/search');
    assert.strictEqual(url.searchParams.get('q'), 'xin chào');
    assert.strictEqual(url.searchParams.get('page'), '2');
    assert.strictEqual(url.searchParams.get('per_page'), '12');
    assert.strictEqual(url.searchParams.get('content_filter'), 'medium');
    assert.strictEqual(url.searchParams.get('format_filter'), 'gif');

    const failingClient = createKlipyClient({
      apiKey,
      fetchImpl: async (input) => {
        throw new Error(`network failure for ${String(input)}`);
      }
    });
    await assert.rejects(
      () => failingClient.trending(),
      (error: unknown) => {
        assert.ok(hasStatus(error, 502));
        assert.ok(!String((error as Error).message).includes(apiKey));
        assert.ok(!String((error as Error).message).includes(encodeURIComponent(apiKey)));
        return true;
      }
    );
  });

  it('normalizes GIF renditions with safe-host fallbacks and title fallback', async () => {
    const client = createKlipyClient({
      apiKey: 'test-key',
      fetchImpl: async () => jsonResponse({
        result: true,
        data: {
          data: [gifItem('fallback-gif', {
            title: '   ',
            file: {
              hd: { gif: { url: 'http://static.klipy.com/full.gif', width: 500, height: 300 } },
              md: { gif: { url: 'https://static1.klipy.com/full.gif', width: 420, height: 250 } },
              sm: { gif: { url: 'https://static.klipy.com.evil.test/preview.gif', width: 240, height: 140 } },
              xs: { gif: { url: 'https://static2.klipy.com/preview.gif', width: 90, height: 50 } }
            }
          })],
          current_page: 3,
          per_page: 24,
          has_next: true
        }
      })
    });

    const result = await client.trending({ page: 3 });

    assert.strictEqual(result.items.length, 1);
    assert.deepStrictEqual(result.items[0], {
      slug: 'fallback-gif',
      title: 'fallback-gif',
      type: 'gif',
      preview: {
        url: 'https://static2.klipy.com/preview.gif',
        width: 90,
        height: 50
      },
      full: {
        url: 'https://static1.klipy.com/full.gif',
        width: 420,
        height: 250
      }
    });
    assert.strictEqual(result.hasNext, true);
  });

  it('filters advertisements, non-GIF items, and GIFs without safe renditions', async () => {
    const client = createKlipyClient({
      apiKey: 'test-key',
      fetchImpl: async () => jsonResponse({
        result: true,
        data: {
          data: [
            gifItem('advertisement', { type: 'ad' }),
            gifItem('sticker', { type: 'sticker' }),
            gifItem('unsafe', {
              file: {
                hd: { gif: { url: 'https://example.com/unsafe.gif', width: 480, height: 270 } }
              }
            }),
            gifItem('safe')
          ],
          current_page: 1,
          per_page: 24,
          has_next: false
        }
      })
    });

    const result = await client.trending();
    assert.deepStrictEqual(result.items.map((item) => item.slug), ['safe']);
  });

  it('stays disabled without a server-side API key', async () => {
    let fetchCalled = false;
    const client = createKlipyClient({
      apiKey: '',
      fetchImpl: async () => {
        fetchCalled = true;
        return jsonResponse({ result: true });
      }
    });

    assert.strictEqual(client.configured, false);
    await assert.rejects(() => client.trending(), (error: unknown) => hasStatus(error, 503));
    assert.strictEqual(fetchCalled, false);
  });

  it('fetches items and registers shares without requiring a customer ID', async () => {
    const calls: Array<{ input: Parameters<typeof fetch>[0]; init?: Parameters<typeof fetch>[1] }> = [];
    const client = createKlipyClient({
      apiKey: 'test-key',
      fetchImpl: async (input, init) => {
        calls.push({ input, init });
        if (String(input).includes('/items?')) {
          return jsonResponse({ result: true, data: { data: [gifItem('hello-hi-662')] } });
        }
        return jsonResponse({ result: true });
      }
    });

    const items = await client.items(['hello-hi-662', 'hello-hi-662', 'thanks-12']);
    assert.deepStrictEqual(items.map((item) => item.slug), ['hello-hi-662']);
    const itemsUrl = new URL(String(calls[0].input));
    assert.strictEqual(itemsUrl.pathname, '/api/v1/test-key/gifs/items');
    assert.strictEqual(itemsUrl.searchParams.get('slugs'), 'hello-hi-662,thanks-12');

    assert.deepStrictEqual(await client.share({ slug: 'hello-hi-662', query: 'hello there' }), { shared: true });
    const shareUrl = new URL(String(calls[1].input));
    assert.strictEqual(shareUrl.pathname, '/api/v1/test-key/gifs/share/hello-hi-662');
    assert.strictEqual(calls[1].init?.method, 'POST');
    assert.deepStrictEqual(JSON.parse(String(calls[1].init?.body)), { q: 'hello there' });
  });

  it('validates list inputs and enforces request timeouts', async () => {
    const client = createKlipyClient({
      apiKey: 'timeout-secret',
      timeoutMs: 5,
      fetchImpl: async () => new Promise<Response>(() => undefined)
    });

    await assert.rejects(() => client.search({ query: '', perPage: 24 }), (error: unknown) => hasStatus(error, 400));
    await assert.rejects(() => client.search({ query: 'hello', page: 0 }), (error: unknown) => hasStatus(error, 400));
    await assert.rejects(() => client.search({ query: 'hello', perPage: 7 }), (error: unknown) => hasStatus(error, 400));
    await assert.rejects(
      () => client.trending({ contentFilter: 'invalid' as never }),
      (error: unknown) => hasStatus(error, 400)
    );
    await assert.rejects(
      () => client.trending(),
      (error: unknown) => {
        assert.ok(hasStatus(error, 504));
        assert.ok(!String((error as Error).message).includes('timeout-secret'));
        return true;
      }
    );
  });
});
