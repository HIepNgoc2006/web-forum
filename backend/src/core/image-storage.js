import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Map([
  ['image/apng', 'apng'],
  ['image/avif', 'avif'],
  ['image/bmp', 'bmp'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
  ['image/jxl', 'jxl'],
  ['image/svg+xml', 'svg'],
  ['image/tiff', 'tiff'],
  ['image/vnd.microsoft.icon', 'ico'],
  ['image/webp', 'webp'],
  ['image/x-icon', 'ico'],
  ['image/x-ms-bmp', 'bmp'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm']
]);

function trimTrailingSlash(value) {
  return String(value ?? '').replace(/\/+$/g, '');
}

function trimSlashes(value) {
  return String(value ?? '').replace(/^\/+|\/+$/g, '');
}

function normalizeStorageKey(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\/+/g, '');
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKey(key) {
  return key.split('/').map(encodePathSegment).join('/');
}

function canonicalQueryString(url) {
  return [...url.searchParams.entries()]
    .map(([key, value]) => [encodePathSegment(key), encodePathSegment(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }
      return leftKey.localeCompare(rightKey);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function imageBytes(image) {
  const base64 = String(image?.dataUrl ?? '').split(',')[1] || '';
  return Buffer.from(base64, 'base64');
}

function imageExtension(image) {
  const type = String(image?.type ?? '').toLowerCase();
  const knownExtension = IMAGE_EXTENSIONS.get(type);
  if (knownExtension) {
    return knownExtension;
  }
  if (!type.startsWith('image/')) {
    return 'img';
  }
  const subtype = type.slice('image/'.length).split(';')[0];
  const safeExtension = subtype
    .replace(/^x-/, '')
    .replace(/^vnd\./, '')
    .replace(/\+xml$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return safeExtension || 'img';
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertSafeLocalKey(root, key) {
  const normalizedKey = normalizeStorageKey(key);
  if (!normalizedKey || path.isAbsolute(normalizedKey) || normalizedKey.split('/').includes('..')) {
    throw new Error('Unsafe local upload key');
  }

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, normalizedKey);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Unsafe local upload key');
  }
  return { normalizedKey, resolvedPath };
}

async function listLocalFiles(root, directory = root) {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listLocalFiles(root, fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(root, fullPath).replace(/\\/g, '/'));
    }
  }
  return files;
}

function stripImageData(image) {
  const { dataUrl: _dataUrl, thumbnail: _thumbnail, ...metadata } = image;
  return metadata;
}

function stripThumbnailData(thumbnail) {
  const { dataUrl: _dataUrl, ...metadata } = thumbnail;
  return metadata;
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function amzTimestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function s3SigningKey(secretAccessKey, dateStamp, region) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

function s3AuthorizationHeader({ method, url, headers, payloadHash, accessKeyId, secretAccessKey, region, date }) {
  const amzDate = amzTimestamp(date);
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = Object.keys(headers)
    .map((key) => key.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaders.map((key) => `${key}:${String(headers[key]).trim()}\n`).join('');
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQueryString(url),
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(s3SigningKey(secretAccessKey, dateStamp, region), stringToSign, 'hex');

  return {
    amzDate,
    value: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(
      ';'
    )}, Signature=${signature}`
  };
}

export function createInlineImageStorage() {
  return {
    type: 'inline-json',
    async save(image) {
      return image;
    },
    async health() {
      return { type: 'inline-json', configured: true };
    }
  };
}

export function createLocalImageStorage({ root = path.resolve('data/uploads'), publicPath = '/uploads' } = {}) {
  const resolvedRoot = path.resolve(root);

  async function save(image) {
    if (!image) {
      return null;
    }

    const id = crypto.randomUUID();
    const extension = imageExtension(image);
    const bytes = imageBytes(image);
    const fileName = `${id}.${extension}`;
    await fs.mkdir(resolvedRoot, { recursive: true });
    await fs.writeFile(path.join(resolvedRoot, fileName), bytes);

    const saved = {
      ...stripImageData(image),
      storage: 'local',
      storageKey: fileName,
      url: `${publicPath}/${fileName}`
    };

    if (image.thumbnail) {
      const thumbnailExtension = imageExtension(image.thumbnail);
      const thumbnailFileName = `${id}.thumb.${thumbnailExtension}`;
      try {
        await fs.writeFile(path.join(resolvedRoot, thumbnailFileName), imageBytes(image.thumbnail));
      } catch (error) {
        await fs.rm(path.join(resolvedRoot, fileName), { force: true }).catch(() => undefined);
        throw error;
      }
      saved.thumbnail = {
        ...stripThumbnailData(image.thumbnail),
        storage: 'local',
        storageKey: thumbnailFileName,
        url: `${publicPath}/${thumbnailFileName}`
      };
    }

    return saved;
  }

  async function listKeys() {
    await fs.mkdir(resolvedRoot, { recursive: true });
    return listLocalFiles(resolvedRoot);
  }

  async function deleteKey(key) {
    const { resolvedPath } = assertSafeLocalKey(resolvedRoot, key);
    await fs.rm(resolvedPath, { force: false });
  }

  async function health() {
    await fs.mkdir(resolvedRoot, { recursive: true });
    await fs.access(resolvedRoot);
    return {
      type: 'local-disk',
      configured: true
    };
  }

  return {
    type: 'local-disk',
    root: resolvedRoot,
    publicPath,
    save,
    listKeys,
    deleteKey,
    health
  };
}

export function createS3ImageStorage({
  endpoint = process.env.S3_ENDPOINT,
  region = process.env.S3_REGION ?? 'auto',
  bucket = process.env.S3_BUCKET,
  accessKeyId = process.env.S3_ACCESS_KEY_ID,
  secretAccessKey = process.env.S3_SECRET_ACCESS_KEY,
  publicBaseUrl = process.env.S3_PUBLIC_BASE_URL,
  keyPrefix = process.env.S3_KEY_PREFIX ?? 'uploads',
  fetchImpl = global.fetch,
  now = () => new Date(),
  randomUUID = crypto.randomUUID
} = {}) {
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is required for S3 image storage');
  }

  const normalizedEndpoint = trimTrailingSlash(endpoint);
  const normalizedPrefix = trimSlashes(keyPrefix);
  const normalizedPublicBaseUrl = publicBaseUrl ? trimTrailingSlash(publicBaseUrl) : null;

  function keyFor(image) {
    const date = now();
    const datePrefix = [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0')].join('/');
    const fileName = `${randomUUID()}.${imageExtension(image)}`;
    return [normalizedPrefix, datePrefix, fileName].filter(Boolean).join('/');
  }

  function requestUrlFor(key) {
    return new URL(`${normalizedEndpoint}/${encodePathSegment(bucket)}/${encodeKey(key)}`);
  }

  function bucketUrl() {
    return new URL(`${normalizedEndpoint}/${encodePathSegment(bucket)}`);
  }

  function publicUrlFor(key) {
    if (normalizedPublicBaseUrl) {
      return `${normalizedPublicBaseUrl}/${encodeKey(key)}`;
    }
    return requestUrlFor(key).toString();
  }

  async function putObject(image, key) {
    const bytes = imageBytes(image);
    const requestUrl = requestUrlFor(key);
    const payloadHash = sha256Hex(bytes);
    const signingDate = now();
    const signingHeaders = {
      'content-type': image.type,
      host: requestUrl.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzTimestamp(signingDate)
    };
    const authorization = s3AuthorizationHeader({
      method: 'PUT',
      url: requestUrl,
      headers: signingHeaders,
      payloadHash,
      accessKeyId,
      secretAccessKey,
      region,
      date: signingDate
    });
    const headers = {
      'content-type': signingHeaders['content-type'],
      'x-amz-content-sha256': signingHeaders['x-amz-content-sha256'],
      'x-amz-date': signingHeaders['x-amz-date'],
      authorization: authorization.value
    };

    const response = await fetchImpl(requestUrl, {
      method: 'PUT',
      headers,
      body: bytes
    });
    if (!response.ok) {
      const error = new Error(`Không thể lưu ảnh lên S3-compatible storage (${response.status})`);
      error.statusCode = 502;
      throw error;
    }
  }

  async function signedRequest(method, url) {
    const payloadHash = sha256Hex('');
    const signingDate = now();
    const signingHeaders = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzTimestamp(signingDate)
    };
    const authorization = s3AuthorizationHeader({
      method,
      url,
      headers: signingHeaders,
      payloadHash,
      accessKeyId,
      secretAccessKey,
      region,
      date: signingDate
    });
    return fetchImpl(url, {
      method,
      headers: {
        'x-amz-content-sha256': signingHeaders['x-amz-content-sha256'],
        'x-amz-date': signingHeaders['x-amz-date'],
        authorization: authorization.value
      }
    });
  }

  function decodeXmlEntity(value) {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  async function listKeys() {
    const keys = [];
    let continuationToken = null;

    do {
      const url = bucketUrl();
      url.searchParams.set('list-type', '2');
      if (normalizedPrefix) {
        url.searchParams.set('prefix', normalizedPrefix.endsWith('/') ? normalizedPrefix : `${normalizedPrefix}/`);
      }
      if (continuationToken) {
        url.searchParams.set('continuation-token', continuationToken);
      }

      const response = await signedRequest('GET', url);
      if (!response.ok) {
        const error = new Error(`Không thể liệt kê upload S3 (${response.status})`);
        error.statusCode = 502;
        throw error;
      }

      const body = await response.text();
      for (const match of body.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
        keys.push(decodeXmlEntity(match[1]));
      }
      const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(body);
      const tokenMatch = body.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
      continuationToken = truncated && tokenMatch ? decodeXmlEntity(tokenMatch[1]) : null;
    } while (continuationToken);

    return keys;
  }

  async function deleteKey(key) {
    const normalizedKey = normalizeStorageKey(key);
    if (!normalizedKey) {
      throw new Error('Unsafe S3 upload key');
    }
    if (normalizedPrefix && normalizedKey !== normalizedPrefix && !normalizedKey.startsWith(`${normalizedPrefix}/`)) {
      throw new Error('S3 upload key is outside configured prefix');
    }

    const response = await signedRequest('DELETE', requestUrlFor(normalizedKey));
    if (!response.ok && response.status !== 404) {
      const error = new Error(`Không thể xóa upload S3 (${response.status})`);
      error.statusCode = 502;
      throw error;
    }
  }

  async function save(image) {
    if (!image) {
      return null;
    }

    const key = keyFor(image);
    let thumbnail = null;

    if (image.thumbnail) {
      const thumbnailExtension = imageExtension(image.thumbnail);
      const thumbnailKey = key.replace(/\.([^.]+)$/, `.thumb.${thumbnailExtension}`);
      await putObject(image.thumbnail, thumbnailKey);
      thumbnail = {
        ...stripThumbnailData(image.thumbnail),
        storage: 's3',
        storageKey: thumbnailKey,
        url: publicUrlFor(thumbnailKey)
      };
    }

    await putObject(image, key);

    const saved = {
      ...stripImageData(image),
      storage: 's3',
      storageKey: key,
      url: publicUrlFor(key)
    };

    if (thumbnail) {
      saved.thumbnail = thumbnail;
    }

    return saved;
  }

  async function health() {
    const base = {
      type: 's3-compatible',
      configured: true,
      endpoint: normalizedEndpoint,
      bucket,
      region,
      publicBaseUrl: normalizedPublicBaseUrl
    };

    try {
      const probeUrl = new URL(`${normalizedEndpoint}/${encodePathSegment(bucket)}/`);
      const signingDate = now();
      const payloadHash = sha256Hex('');
      const signingHeaders = {
        host: probeUrl.host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzTimestamp(signingDate)
      };
      const authorization = s3AuthorizationHeader({
        method: 'HEAD',
        url: probeUrl,
        headers: signingHeaders,
        payloadHash,
        accessKeyId,
        secretAccessKey,
        region,
        date: signingDate
      });
      const response = await fetchImpl(probeUrl, {
        method: 'HEAD',
        headers: {
          'x-amz-content-sha256': signingHeaders['x-amz-content-sha256'],
          'x-amz-date': signingHeaders['x-amz-date'],
          authorization: authorization.value
        }
      });
      return { ...base, ready: response.ok || response.status === 301 || response.status === 404 };
    } catch {
      return { ...base, ready: false, error: 'connectivity_check_failed' };
    }
  }

  return {
    type: 's3-compatible',
    bucket,
    region,
    endpoint: normalizedEndpoint,
    keyPrefix: normalizedPrefix,
    save,
    listKeys,
    deleteKey,
    health
  };
}
