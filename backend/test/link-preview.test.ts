import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPostLinks,
  classifyLink,
  extractLinks,
  fetchLinkPreview,
  fixupXUnfurlUrl,
  isBlockedPreviewHost,
  isPublicPreviewAddress,
  isXStatusUrl,
  serializePostLinks
} from '../src/core/link-preview.ts';
import { createForumService } from '../src/core/forum-service.ts';
import { createMemoryStore } from '../src/core/forum-store.ts';
import { createHttpServer } from '../src/server/http-app.ts';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

describe('link-preview helpers', () => {
  it('extracts unique http(s) links and skips blocked hosts', () => {
    const links = extractLinks(
      'see https://example.com/a and https://example.com/a again http://127.0.0.1/x https://youtu.be/dQw4w9WgXcQ'
    );
    assert.equal(links.length, 2);
    assert.equal(links[0].domain, 'example.com');
    assert.equal(links[1].domain, 'youtu.be');
  });

  it('classifies youtube shorts, vimeo, image, video, and og', () => {
    assert.equal(classifyLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.kind, 'youtube');
    assert.equal(classifyLink('https://youtu.be/dQw4w9WgXcQ')?.embedId, 'dQw4w9WgXcQ');
    assert.equal(classifyLink('https://www.youtube.com/shorts/abcdefghijk')?.kind, 'youtube');
    assert.equal(classifyLink('https://vimeo.com/123456789')?.kind, 'vimeo');
    assert.equal(classifyLink('https://cdn.example.com/pic.png')?.kind, 'image');
    assert.equal(classifyLink('https://cdn.example.com/clip.mp4')?.kind, 'video');
    assert.equal(classifyLink('https://news.example.com/story')?.kind, 'og');
  });

  it('blocks private hosts', () => {
    assert.equal(isBlockedPreviewHost('localhost'), true);
    assert.equal(isBlockedPreviewHost('10.0.0.5'), true);
    assert.equal(isBlockedPreviewHost('192.168.1.1'), true);
    assert.equal(isBlockedPreviewHost('172.16.0.1'), true);
    assert.equal(isBlockedPreviewHost('169.254.169.254'), true);
    assert.equal(isBlockedPreviewHost('[::1]'), true);
    assert.equal(isPublicPreviewAddress('::ffff:7f00:1'), false);
    assert.equal(isPublicPreviewAddress('8.8.8.8'), true);
    assert.equal(isBlockedPreviewHost('example.com'), false);
  });

  it('parses open graph meta from HTML', async () => {
    const fetchImpl = mock.fn(async () => ({
      headers: {
        get(name: string) {
          return name === 'content-type' ? 'text/html; charset=utf-8' : null;
        }
      },
      text: async () =>
        `<html><head>
          <meta property="og:title" content="Hello OG" />
          <meta property="og:description" content="Desc" />
          <meta property="og:image" content="https://cdn.example.com/i.jpg" />
          <title>Fallback</title>
        </head></html>`
    }));
    const preview = await fetchLinkPreview('https://example.com/page', {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    assert.equal(preview.title, 'Hello OG');
    assert.equal(preview.description, 'Desc');
    assert.equal(preview.image, 'https://cdn.example.com/i.jpg');
    assert.equal(preview.kind, 'og');
  });

  it('rejects SSRF targets', async () => {
    await assert.rejects(() => fetchLinkPreview('http://127.0.0.1/secret'), (error: any) => {
      assert.equal(error.statusCode, 400);
      return true;
    });
  });

  it('rejects hostnames whose DNS answers include a private address', async () => {
    await assert.rejects(
      () => fetchLinkPreview('https://public.example.test/page', {
        lookupImpl: async () => [{ address: '169.254.169.254', family: 4 }]
      }),
      (error: any) => {
        assert.equal(error.statusCode, 400);
        return true;
      }
    );
  });

  it('revalidates every redirect before issuing the next request', async () => {
    const fetchImpl = mock.fn(async () => ({
      status: 302,
      headers: {
        get(name: string) {
          return name === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null;
        }
      },
      text: async () => ''
    }));
    await assert.rejects(
      () => fetchLinkPreview('https://example.com/page', {
        fetchImpl: fetchImpl as unknown as typeof fetch
      }),
      (error: any) => {
        assert.equal(error.statusCode, 400);
        return true;
      }
    );
    assert.equal(fetchImpl.mock.callCount(), 1);
  });

  it('serializes stored links safely', () => {
    const links = serializePostLinks([
      {
        url: 'https://youtu.be/dQw4w9WgXcQ',
        title: 'Song',
        image: 'javascript:alert(1)'
      },
      { url: 'not-a-url' }
    ]);
    assert.equal(links.length, 1);
    assert.equal(links[0].kind, 'youtube');
    assert.equal(links[0].title, 'Song');
    assert.equal(links[0].image, undefined);
  });

  it('buildPostLinks attaches classified media without requiring HTML', async () => {
    const links = await buildPostLinks('https://cdn.example.com/a.webp', { fetchMeta: true });
    assert.equal(links.length, 1);
    assert.equal(links[0].kind, 'image');
    assert.equal(links[0].image, 'https://cdn.example.com/a.webp');
  });

  it('rewrites X/Twitter status URLs to fixupx.com for unfurl only', () => {
    assert.equal(isXStatusUrl('https://x.com/thsottiaux/status/2077114635308986427'), true);
    assert.equal(isXStatusUrl('https://twitter.com/thsottiaux/status/2077114635308986427'), true);
    assert.equal(isXStatusUrl('https://fixupx.com/thsottiaux/status/2077114635308986427'), true);
    assert.equal(isXStatusUrl('https://example.com/status/1'), false);
    assert.equal(
      fixupXUnfurlUrl('https://x.com/thsottiaux/status/2077114635308986427?s=20'),
      'https://fixupx.com/thsottiaux/status/2077114635308986427'
    );
  });

  it('fetches X status OG via fixupx while preserving original url/domain', async () => {
    const calls: string[] = [];
    const fetchImpl = mock.fn(async (input: string | URL) => {
      calls.push(String(input));
      return {
        headers: {
          get(name: string) {
            return name === 'content-type' ? 'text/html; charset=utf-8' : null;
          }
        },
        text: async () =>
          `<html><head>
            <meta property="og:title" content="Tibo (@thsottiaux)" />
            <meta property="og:description" content="Hello from X" />
            <meta property="og:image" content="https://pbs.twimg.com/profile_images/test.jpg" />
          </head></html>`
      };
    });
    const preview = await fetchLinkPreview('https://x.com/thsottiaux/status/2077114635308986427', {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    assert.equal(preview.url, 'https://x.com/thsottiaux/status/2077114635308986427');
    assert.equal(preview.domain, 'x.com');
    assert.equal(preview.title, 'Tibo (@thsottiaux)');
    assert.equal(preview.description, 'Hello from X');
    assert.match(preview.image, /pbs\.twimg\.com/);
    assert.equal(calls[0], 'https://fixupx.com/thsottiaux/status/2077114635308986427');
  });
});

describe('forum post link previews', () => {
  function createTestService() {
    return createForumService({
      store: createMemoryStore(),
      ai: { moderate: async () => ({ status: 'Safe', labels: [] }) },
      now: () => new Date('2026-07-21T12:00:00Z')
    });
  }

  it('stores links on thread create and returns them from getThread', async () => {
    const service = createTestService();
    const created = await service.createThread({
      boardSlug: 'confession',
      body: 'Xem video https://youtu.be/dQw4w9WgXcQ và https://example.com/article',
      captchaToken: 'dev-pass',
      ip: '203.0.113.10',
      posterToken: 'poster-link-preview-1',
      accountId: null,
      image: null,
      images: [],
      pollOptions: undefined
    } as any);
    assert.equal(created.status, 'published');
    assert.ok(Array.isArray(created.thread.links));
    assert.ok(created.thread.links.length >= 1);
    assert.ok(created.thread.links.some((link: { kind: string }) => link.kind === 'youtube'));

    const detail = await service.getThread(created.thread.id);
    assert.ok(Array.isArray(detail.thread.links));
    assert.ok(detail.thread.links.some((link: { url: string }) => link.url.includes('youtu.be')));
  });

  it('exposes public POST /api/link-preview', async () => {
    const service = createTestService();
    const server = createHttpServer({
      service,
      realtime: { publish() {}, clientCount() { return 0; }, boardClientCounts() { return {}; } },
      jwtSecret: 'test-jwt-secret-for-link-preview',
      adminUsername: 'admin',
      adminPassword: 'pass',
      staticRoot: null
    } as any);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/link-preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://cdn.example.com/x.png' })
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { data: { kind: string; domain: string } };
      assert.equal(body.data.kind, 'image');
      assert.equal(body.data.domain, 'cdn.example.com');
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
