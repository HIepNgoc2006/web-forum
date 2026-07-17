import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInlineImageStorage,
  createLocalImageStorage,
  createS3ImageStorage
} from '../src/core/image-storage.ts';

type MockResponse = {
  ok: boolean;
  status: number;
  text?: () => Promise<string>;
};

type FetchCall = {
  url: string;
  method?: string;
  headers: Record<string, string>;
};

type TestUuid = `${string}-${string}-${string}-${string}-${string}`;

function mockResponse(response: MockResponse): Response {
  return response as Response;
}

function testUuid(value: string): TestUuid {
  return value as TestUuid;
}

describe('createInlineImageStorage', () => {
  it('returns the image unchanged', async () => {
    const storage = createInlineImageStorage();
    const image = { name: 'test.png', type: 'image/png', dataUrl: 'data:image/png;base64,abc' };
    const result = await storage.save(image);
    assert.deepStrictEqual(result, image);
  });

  it('returns null for null input', async () => {
    const storage = createInlineImageStorage();
    const result = await storage.save(null);
    assert.strictEqual(result, null);
  });

  it('health returns inline-json type', async () => {
    const storage = createInlineImageStorage();
    const health = await storage.health();
    assert.strictEqual(health.type, 'inline-json');
    assert.strictEqual(health.configured, true);
  });
});

describe('createLocalImageStorage', () => {
  it('has correct type and properties', () => {
    const storage = createLocalImageStorage({ root: '/tmp/test-uploads', publicPath: '/uploads' });
    assert.strictEqual(storage.type, 'local-disk');
    assert.strictEqual(storage.publicPath, '/uploads');
  });

  it('returns null for null image', async () => {
    const storage = createLocalImageStorage({ root: '/tmp/test-uploads' });
    const result = await storage.save(null);
    assert.strictEqual(result, null);
  });
});

describe('createS3ImageStorage', () => {
  const validConfig = {
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    publicBaseUrl: 'https://cdn.example.com',
    keyPrefix: 'uploads',
    now: () => new Date('2026-01-15T12:00:00Z'),
    randomUUID: () => testUuid('test-uuid-1234')
  };

  it('throws if required config is missing', () => {
    assert.throws(() => createS3ImageStorage({ endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' }), /required/i);
    assert.throws(() => createS3ImageStorage({ endpoint: 'https://s3.example.com', bucket: 'b', accessKeyId: 'a', secretAccessKey: '' }), /required/i);
  });

  it('creates storage with valid config', () => {
    const mockFetch = async () => mockResponse({ ok: true, status: 200 });
    const storage = createS3ImageStorage({ ...validConfig, fetchImpl: mockFetch });
    assert.strictEqual(storage.type, 's3-compatible');
    assert.strictEqual(storage.bucket, 'test-bucket');
    assert.strictEqual(storage.region, 'us-east-1');
  });

  it('returns null for null image save', async () => {
    const mockFetch = async () => mockResponse({ ok: true, status: 200 });
    const storage = createS3ImageStorage({ ...validConfig, fetchImpl: mockFetch });
    const result = await storage.save(null);
    assert.strictEqual(result, null);
  });

  it('save calls fetch with PUT and correct authorization', async () => {
    const calls: FetchCall[] = [];
    const mockFetch = async (url: string | URL | Request, options: RequestInit = {}) => {
      calls.push({
        url: url.toString(),
        method: options.method,
        headers: options.headers as Record<string, string>
      });
      return mockResponse({ ok: true, status: 200 });
    };

    const storage = createS3ImageStorage({ ...validConfig, fetchImpl: mockFetch });
    const image = {
      name: 'test.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      sizeBytes: 10
    };

    const result = await storage.save(image);

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].method, 'PUT');
    assert.ok(calls[0].url.includes('test-bucket'));
    assert.ok(calls[0].url.includes('test-uuid-1234.png'));
    assert.ok(calls[0].headers.authorization.startsWith('AWS4-HMAC-SHA256'));
    assert.strictEqual(result.storage, 's3');
    assert.ok(result.url.startsWith('https://cdn.example.com/'));
    assert.strictEqual(result.storageKey.includes('test-uuid-1234.png'), true);
    assert.strictEqual(result.dataUrl, undefined);
  });

  it('save uses specific extensions for common and unknown image MIME types', async () => {
    const calls: FetchCall[] = [];
    const mockFetch = async (url: string | URL | Request, options: RequestInit = {}) => {
      calls.push({
        url: url.toString(),
        headers: options.headers as Record<string, string>
      });
      return mockResponse({ ok: true, status: 200 });
    };
    let uuid = 0;
    const storage = createS3ImageStorage({
      ...validConfig,
      fetchImpl: mockFetch,
      randomUUID: () => testUuid(`test-uuid-${uuid += 1}`)
    });
    const cases = [
      ['image/avif', '.avif'],
      ['image/heic', '.heic'],
      ['image/heif', '.heif'],
      ['image/svg+xml', '.svg'],
      ['image/vnd.custom-format', '.custom-format']
    ];

    for (const [type, extension] of cases) {
      const result = await storage.save({
        name: `image${extension}`,
        type,
        dataUrl: `data:${type};base64,AAAA`,
        sizeBytes: 3
      });
      assert.strictEqual(result.storageKey.endsWith(extension), true);
      assert.strictEqual(calls.at(-1)?.headers['content-type'], type);
    }
  });

  it('save with thumbnail uploads both files', async () => {
    const calls: FetchCall[] = [];
    const mockFetch = async (url: string | URL | Request, options: RequestInit = {}) => {
      calls.push({
        url: url.toString(),
        method: options.method,
        headers: options.headers as Record<string, string>
      });
      return mockResponse({ ok: true, status: 200 });
    };

    const storage = createS3ImageStorage({ ...validConfig, fetchImpl: mockFetch });
    const image = {
      name: 'photo.jpg',
      type: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      sizeBytes: 100,
      thumbnail: {
        name: 'photo.thumb.jpg',
        type: 'image/jpeg',
        dataUrl: 'data:image/jpeg;base64,/9j/4A=='
      }
    };

    const result = await storage.save(image);

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(result.storage, 's3');
    assert.ok(result.thumbnail);
    assert.strictEqual(result.thumbnail.storage, 's3');
    assert.ok(result.thumbnail.url.includes('thumb'));
  });

  it('save throws on upload failure', async () => {
    const mockFetch = async () => mockResponse({ ok: false, status: 500 });
    const storage = createS3ImageStorage({ ...validConfig, fetchImpl: mockFetch });
    const image = {
      name: 'fail.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,abc=',
      sizeBytes: 3
    };

    await assert.rejects(() => storage.save(image), /Không thể lưu ảnh/);
  });

  it('times out a provider request that never settles', async () => {
    const mockFetch = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    const storage = createS3ImageStorage({
      ...validConfig,
      fetchImpl: mockFetch,
      requestTimeoutMs: 100
    });
    const image = {
      name: 'timeout.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,abc=',
      sizeBytes: 3
    };

    await assert.rejects(
      () => storage.save(image),
      (error: Error & { statusCode?: number }) => error.statusCode === 504 && /timed out/.test(error.message)
    );
  });

  it('health check returns ready:true on successful probe', async () => {
    const mockFetch = async () => mockResponse({ ok: true, status: 200 });
    const storage = createS3ImageStorage({ ...validConfig, fetchImpl: mockFetch });
    const health = await storage.health();

    assert.strictEqual(health.type, 's3-compatible');
    assert.strictEqual(health.configured, true);
    assert.strictEqual(health.ready, true);
    assert.strictEqual(health.bucket, 'test-bucket');
  });

  it('health check returns ready:true on 404 (bucket exists but empty)', async () => {
    const mockFetch = async () => mockResponse({ ok: false, status: 404 });
    const storage = createS3ImageStorage({ ...validConfig, fetchImpl: mockFetch });
    const health = await storage.health();

    assert.strictEqual(health.ready, true);
  });

  it('health check returns ready:false on fetch error', async () => {
    const mockFetch = async () => { throw new Error('network error'); };
    const storage = createS3ImageStorage({ ...validConfig, fetchImpl: mockFetch });
    const health = await storage.health();

    assert.strictEqual(health.ready, false);
    assert.strictEqual((health as { error?: string }).error, 'connectivity_check_failed');
  });

  it('public URL uses publicBaseUrl when set', async () => {
    const mockFetch = async () => mockResponse({ ok: true, status: 200 });
    const storage = createS3ImageStorage({ ...validConfig, fetchImpl: mockFetch });
    const image = {
      name: 'test.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,abc=',
      sizeBytes: 3
    };

    const result = await storage.save(image);
    assert.ok(result.url.startsWith('https://cdn.example.com/'));
  });

  it('public URL falls back to endpoint when no publicBaseUrl', async () => {
    const mockFetch = async () => mockResponse({ ok: true, status: 200 });
    const storage = createS3ImageStorage({
      ...validConfig,
      publicBaseUrl: undefined,
      fetchImpl: mockFetch
    });
    const image = {
      name: 'test.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,abc=',
      sizeBytes: 3
    };

    const result = await storage.save(image);
    assert.ok(result.url.startsWith('https://s3.example.com/'));
  });
});
