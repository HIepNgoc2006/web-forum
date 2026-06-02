import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp']
]);

function trimTrailingSlash(value) {
  return String(value ?? '').replace(/\/+$/g, '');
}

function trimSlashes(value) {
  return String(value ?? '').replace(/^\/+|\/+$/g, '');
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKey(key) {
  return key.split('/').map(encodePathSegment).join('/');
}

function imageBytes(image) {
  const base64 = String(image?.dataUrl ?? '').split(',')[1] || '';
  return Buffer.from(base64, 'base64');
}

function imageExtension(image) {
  return IMAGE_EXTENSIONS.get(image?.type) ?? 'img';
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
    url.searchParams.toString(),
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
  async function save(image) {
    if (!image) {
      return null;
    }

    const extension = IMAGE_EXTENSIONS.get(image.type) ?? 'img';
    const bytes = imageBytes(image);
    const fileName = `${crypto.randomUUID()}.${extension}`;
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, fileName), bytes);

    const { dataUrl: _dataUrl, ...metadata } = image;
    return {
      ...metadata,
      storage: 'local',
      storageKey: fileName,
      url: `${publicPath}/${fileName}`
    };
  }

  async function health() {
    await fs.mkdir(root, { recursive: true });
    await fs.access(root);
    return {
      type: 'local-disk',
      configured: true,
      root
    };
  }

  return {
    type: 'local-disk',
    root,
    publicPath,
    save,
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

  function publicUrlFor(key) {
    if (normalizedPublicBaseUrl) {
      return `${normalizedPublicBaseUrl}/${encodeKey(key)}`;
    }
    return requestUrlFor(key).toString();
  }

  async function save(image) {
    if (!image) {
      return null;
    }

    const bytes = imageBytes(image);
    const key = keyFor(image);
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

    const { dataUrl: _dataUrl, ...metadata } = image;
    return {
      ...metadata,
      storage: 's3',
      storageKey: key,
      url: publicUrlFor(key)
    };
  }

  async function health() {
    return {
      type: 's3-compatible',
      configured: true,
      endpoint: normalizedEndpoint,
      bucket,
      region,
      publicBaseUrl: normalizedPublicBaseUrl
    };
  }

  return {
    type: 's3-compatible',
    bucket,
    region,
    endpoint: normalizedEndpoint,
    save,
    health
  };
}
