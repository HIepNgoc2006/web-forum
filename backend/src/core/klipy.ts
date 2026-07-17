type FetchLike = typeof fetch;

type UnknownRecord = Record<string, unknown>;
type KlipyError = Error & {
  statusCode?: number;
  code?: string;
};

export type KlipyContentFilter = 'off' | 'low' | 'medium' | 'high';

export type KlipyMedia = {
  url: string;
  width: number;
  height: number;
};

export type KlipyGif = {
  slug: string;
  title: string;
  type: 'gif';
  preview: KlipyMedia;
  full: KlipyMedia;
};

export type KlipyPage = {
  items: KlipyGif[];
  page: number;
  perPage: number;
  hasNext: boolean;
};

export type KlipyListOptions = {
  page?: number;
  perPage?: number;
  contentFilter?: KlipyContentFilter;
};

export type KlipySearchOptions = KlipyListOptions & {
  query: string;
};

export type KlipyShareOptions = {
  slug: string;
  customerId?: string;
  query?: string;
};

export type KlipyClient = {
  type: 'klipy';
  configured: boolean;
  search(options: KlipySearchOptions): Promise<KlipyPage>;
  trending(options?: KlipyListOptions): Promise<KlipyPage>;
  items(slugs: readonly string[]): Promise<KlipyGif[]>;
  share(options: KlipyShareOptions): Promise<{ shared: true }>;
};

export type KlipyClientOptions = {
  apiKey?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

const KLIPY_BASE_URL = 'https://api.klipy.com';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 24;
const MAX_PER_PAGE = 50;
const MAX_QUERY_LENGTH = 200;
const MAX_SLUG_LENGTH = 200;
const MAX_ITEM_SLUGS = 50;
const CONTENT_FILTERS = new Set(['off', 'low', 'medium', 'high']);
const MEDIA_HOSTS = new Set([
  'static.klipy.com',
  'static1.klipy.com',
  'static2.klipy.com'
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createError(message: string, statusCode: number, code: string): KlipyError {
  const error: KlipyError = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function invalidArgument(message: string): KlipyError {
  return createError(message, 400, 'KLIPY_INVALID_ARGUMENT');
}

function positiveInteger(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || Number(candidate) < minimum || Number(candidate) > maximum) {
    throw invalidArgument(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return Number(candidate);
}

function requiredText(value: unknown, name: string, maximumLength: number): string {
  if (typeof value !== 'string') {
    throw invalidArgument(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw invalidArgument(`${name} must contain 1 to ${maximumLength} characters`);
  }
  return normalized;
}

function optionalText(value: unknown, name: string, maximumLength: number): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return requiredText(value, name, maximumLength);
}

function slugValue(value: unknown): string {
  const slug = requiredText(value, 'slug', MAX_SLUG_LENGTH);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug)) {
    throw invalidArgument('slug contains unsupported characters');
  }
  return slug;
}

function contentFilterValue(value: unknown): KlipyContentFilter {
  const normalized = value === undefined ? 'high' : value;
  if (typeof normalized !== 'string' || !CONTENT_FILTERS.has(normalized)) {
    throw invalidArgument('content_filter must be off, low, medium, or high');
  }
  return normalized as KlipyContentFilter;
}

function safeMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  try {
    const url = new URL(value);
    const allowedPort = !url.port || url.port === '443';
    const gifPath = url.pathname.toLowerCase().endsWith('.gif');
    if (
      url.protocol !== 'https:' ||
      !MEDIA_HOSTS.has(url.hostname.toLowerCase()) ||
      !allowedPort ||
      url.username ||
      url.password ||
      !gifPath
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function positiveDimension(value: unknown): number | null {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    return null;
  }
  return Number(value);
}

function normalizeMedia(value: unknown): KlipyMedia | null {
  if (!isRecord(value)) {
    return null;
  }
  const url = safeMediaUrl(value.url);
  const width = positiveDimension(value.width);
  const height = positiveDimension(value.height);
  if (!url || width === null || height === null) {
    return null;
  }
  return { url, width, height };
}

function gifMedia(item: UnknownRecord, size: 'hd' | 'md' | 'sm' | 'xs'): KlipyMedia | null {
  const file = isRecord(item.file) ? item.file : null;
  const rendition = file && isRecord(file[size]) ? file[size] : null;
  return rendition ? normalizeMedia(rendition.gif) : null;
}

function normalizedText(value: unknown, maximumLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

function normalizeGif(value: unknown): KlipyGif | null {
  if (!isRecord(value) || value.type !== 'gif') {
    return null;
  }
  const slug = normalizedText(value.slug, MAX_SLUG_LENGTH);
  if (!slug) {
    return null;
  }

  const hd = gifMedia(value, 'hd');
  const md = gifMedia(value, 'md');
  const sm = gifMedia(value, 'sm');
  const xs = gifMedia(value, 'xs');
  const full = hd ?? md ?? sm ?? xs;
  const preview = sm ?? xs ?? md ?? hd;
  if (!full || !preview) {
    return null;
  }

  return {
    slug,
    title: normalizedText(value.title, MAX_QUERY_LENGTH) || slug,
    type: 'gif',
    preview,
    full
  };
}

function payloadItems(payload: UnknownRecord): unknown[] {
  const data = payload.data;
  if (Array.isArray(data)) {
    return data;
  }
  if (isRecord(data)) {
    if (Array.isArray(data.data)) {
      return data.data;
    }
    if (Array.isArray(data.items)) {
      return data.items;
    }
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  if (Array.isArray(payload.results)) {
    return payload.results;
  }
  return [];
}

function normalizeItems(payload: UnknownRecord): KlipyGif[] {
  return payloadItems(payload)
    .map(normalizeGif)
    .filter((item): item is KlipyGif => item !== null);
}

function paginationEnvelope(payload: UnknownRecord): UnknownRecord | null {
  return isRecord(payload.data) ? payload.data : null;
}

function upstreamInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function normalizePage(payload: UnknownRecord, page: number, perPage: number): KlipyPage {
  const pagination = paginationEnvelope(payload);
  return {
    items: normalizeItems(payload),
    page: upstreamInteger(pagination?.current_page, page),
    perPage: upstreamInteger(pagination?.per_page, perPage),
    hasNext: typeof pagination?.has_next === 'boolean' ? pagination.has_next : false
  };
}

function normalizeSlugs(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEM_SLUGS) {
    throw invalidArgument(`slugs must contain 1 to ${MAX_ITEM_SLUGS} values`);
  }
  return [...new Set(value.map(slugValue))];
}

export function createKlipyClient({
  apiKey = process.env.KLIPY_API_KEY,
  fetchImpl = global.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
}: KlipyClientOptions = {}): KlipyClient {
  const safeApiKey = String(apiKey ?? '').trim();
  const configured = Boolean(safeApiKey);
  const safeTimeoutMs = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs', 1, 60_000);

  if (typeof fetchImpl !== 'function') {
    throw createError('fetch is required for KLIPY', 500, 'KLIPY_FETCH_UNAVAILABLE');
  }

  function requestUrl(endpoint: string): URL {
    return new URL(`/api/v1/${encodeURIComponent(safeApiKey)}/gifs/${endpoint}`, KLIPY_BASE_URL);
  }

  async function request(endpoint: string, init: RequestInit = {}): Promise<UnknownRecord> {
    if (!configured) {
      throw createError('KLIPY GIF service is not configured', 503, 'KLIPY_NOT_CONFIGURED');
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let response: Response;
    try {
      const timeout = new Promise<Response>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(createError('KLIPY request timed out', 504, 'KLIPY_TIMEOUT'));
        }, safeTimeoutMs);
      });
      response = await Promise.race([
        fetchImpl(requestUrl(endpoint), {
          ...init,
          headers: {
            accept: 'application/json',
            ...init.headers
          },
          signal: controller.signal
        }),
        timeout
      ]);
    } catch {
      if (timedOut) {
        throw createError('KLIPY request timed out', 504, 'KLIPY_TIMEOUT');
      }
      throw createError('KLIPY request failed', 502, 'KLIPY_REQUEST_FAILED');
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }

    if (!response.ok) {
      throw createError(`KLIPY returned HTTP ${response.status}`, 502, 'KLIPY_UPSTREAM_ERROR');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw createError('KLIPY returned an invalid response', 502, 'KLIPY_INVALID_RESPONSE');
    }
    if (!isRecord(payload) || payload.result !== true) {
      throw createError('KLIPY returned an unsuccessful response', 502, 'KLIPY_UPSTREAM_ERROR');
    }
    return payload;
  }

  return {
    type: 'klipy',
    configured,
    async search(options) {
      const query = requiredText(options?.query, 'query', MAX_QUERY_LENGTH);
      const page = positiveInteger(options?.page, DEFAULT_PAGE, 'page', 1);
      const perPage = positiveInteger(options?.perPage, DEFAULT_PER_PAGE, 'per_page', 8, MAX_PER_PAGE);
      const contentFilter = contentFilterValue(options?.contentFilter);
      const url = requestUrl('search');
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(perPage));
      url.searchParams.set('q', query);
      url.searchParams.set('content_filter', contentFilter);
      url.searchParams.set('format_filter', 'gif');
      return normalizePage(await request(`search${url.search}`), page, perPage);
    },
    async trending(options = {}) {
      const page = positiveInteger(options.page, DEFAULT_PAGE, 'page', 1);
      const perPage = positiveInteger(options.perPage, DEFAULT_PER_PAGE, 'per_page', 1, MAX_PER_PAGE);
      const contentFilter = contentFilterValue(options.contentFilter);
      const url = requestUrl('trending');
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(perPage));
      url.searchParams.set('content_filter', contentFilter);
      url.searchParams.set('format_filter', 'gif');
      return normalizePage(await request(`trending${url.search}`), page, perPage);
    },
    async items(slugs) {
      const url = requestUrl('items');
      url.searchParams.set('slugs', normalizeSlugs(slugs).join(','));
      return normalizeItems(await request(`items${url.search}`));
    },
    async share(options) {
      const slug = slugValue(options?.slug);
      const customerId = optionalText(options?.customerId, 'customerId', 200);
      const query = optionalText(options?.query, 'query', MAX_QUERY_LENGTH);
      const body = {
        ...(customerId ? { customer_id: customerId } : {}),
        ...(query ? { q: query } : {})
      };
      await request(`share/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { shared: true };
    }
  };
}
