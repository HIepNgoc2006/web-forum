/**
 * Shared link extraction, host classification, and Open Graph unfurl.
 * Used by DM previews and forum post link cards/embeds.
 */

import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const MAX_LINKS_PER_POST = 3;
export const LINK_PREVIEW_TIMEOUT_MS = 4_000;
export const LINK_PREVIEW_HTML_CAP = 200_000;

const LINK_PREVIEW_MAX_REDIRECTS = 3;

type PreviewAddress = {
  address: string;
  family: 4 | 6;
};

type PreviewLookup = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<PreviewAddress[]>;

type PreviewResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  discard(): void | Promise<void>;
};

export type LinkKind = 'og' | 'youtube' | 'vimeo' | 'image' | 'video';

export type ExtractedLink = {
  url: string;
  domain: string;
};

export type ClassifiedLink = ExtractedLink & {
  kind: LinkKind;
  embedId?: string;
};

export type LinkPreviewMeta = {
  url: string;
  domain: string;
  title: string;
  description: string;
  image: string;
  kind?: LinkKind;
  embedId?: string;
};

export type PostLink = ClassifiedLink & {
  title?: string;
  description?: string;
  image?: string;
};

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)(?:[?#]|$)/i;
const VIDEO_EXT = /\.(mp4|webm)(?:[?#]|$)/i;

/** Official X hosts (OG often blocked for bots). */
const X_STATUS_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com']);
/** Public fixup proxies that serve reliable Open Graph for status pages. */
const X_FIXUP_HOSTS = new Set(['fixupx.com', 'fxtwitter.com', 'vxtwitter.com', 'twittpr.com']);
const X_STATUS_PATH = /\/(?:[A-Za-z0-9_]+\/)?status(?:es)?\/(\d{5,25})/i;

const BLOCKED_IPV4 = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  BLOCKED_IPV4.addSubnet(network, prefix, 'ipv4');
}

const PUBLIC_IPV6 = new net.BlockList();
PUBLIC_IPV6.addSubnet('2000::', 3, 'ipv6');

const BLOCKED_IPV6 = new net.BlockList();
for (const [network, prefix] of [
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16]
] as const) {
  BLOCKED_IPV6.addSubnet(network, prefix, 'ipv6');
}

const defaultPreviewLookup: PreviewLookup = async (hostname, options) => {
  const addresses = await dns.lookup(hostname, options);
  return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
};

function normalizedHostname(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

export function isPublicPreviewAddress(address: string): boolean {
  const normalized = normalizedHostname(address).split('%')[0];
  const family = net.isIP(normalized);
  if (family === 4) {
    return !BLOCKED_IPV4.check(normalized, 'ipv4');
  }
  if (family === 6) {
    // Only globally routable unicast IPv6 is useful for public previews.
    // This also rejects IPv4-mapped IPv6, NAT64, loopback, ULA, link-local,
    // multicast, documentation, Teredo, and 6to4 address forms.
    return PUBLIC_IPV6.check(normalized, 'ipv6') && !BLOCKED_IPV6.check(normalized, 'ipv6');
  }
  return false;
}

/**
 * True when the URL is an X/Twitter status (or a fixup proxy of one).
 * Used to route unfurl HTML through fixupx.com while keeping the original href.
 */
export function isXStatusUrl(url: string | URL): boolean {
  try {
    const parsed = url instanceof URL ? url : new URL(String(url || '').trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (!X_STATUS_HOSTS.has(host) && !X_FIXUP_HOSTS.has(host)) {
      return false;
    }
    return X_STATUS_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Rewrite X/Twitter (and fixup aliases) status URLs to fixupx.com for OG fetch only.
 * Returns the original string when the URL is not an X status.
 */
export function fixupXUnfurlUrl(url: string | URL): string {
  try {
    const parsed = url instanceof URL ? new URL(url.toString()) : new URL(String(url || '').trim());
    if (!isXStatusUrl(parsed)) {
      return parsed.toString();
    }
    parsed.protocol = 'https:';
    parsed.hostname = 'fixupx.com';
    parsed.port = '';
    parsed.username = '';
    parsed.password = '';
    // Drop tracking / share junk; keep path + meaningful query empty.
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url || '');
  }
}

export function isBlockedPreviewHost(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  if (!host) {
    return true;
  }
  if (net.isIP(host)) {
    return !isPublicPreviewAddress(host);
  }
  return (
    !host.includes('.') ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  );
}

export function extractLinks(body: string, max = MAX_LINKS_PER_POST): ExtractedLink[] {
  const text = String(body || '');
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[),.!?;:]+$/g, '');
    if (seen.has(cleaned) || links.length >= max) {
      continue;
    }
    try {
      const url = new URL(cleaned);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        continue;
      }
      if (isBlockedPreviewHost(url.hostname)) {
        continue;
      }
      seen.add(cleaned);
      links.push({
        url: cleaned,
        domain: url.hostname.replace(/^www\./i, '')
      });
    } catch {
      // skip invalid
    }
  }
  return links;
}

function youtubeIdFromUrl(parsed: URL): string {
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (host === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0] || '';
    return /^[\w-]{6,32}$/.test(id) ? id : '';
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const v = parsed.searchParams.get('v') || '';
    if (/^[\w-]{6,32}$/.test(v)) {
      return v;
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') {
      const id = parts[1] || '';
      return /^[\w-]{6,32}$/.test(id) ? id : '';
    }
  }
  return '';
}

function vimeoIdFromUrl(parsed: URL): string {
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') {
    return '';
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  // player.vimeo.com/video/123 or vimeo.com/123
  const id = parts[0] === 'video' ? parts[1] : parts[0];
  return /^\d{6,12}$/.test(String(id || '')) ? String(id) : '';
}

export function classifyLink(url: string): ClassifiedLink | null {
  let parsed: URL;
  try {
    parsed = new URL(String(url || '').trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  if (isBlockedPreviewHost(parsed.hostname)) {
    return null;
  }
  const domain = parsed.hostname.replace(/^www\./i, '');
  const youtubeId = youtubeIdFromUrl(parsed);
  if (youtubeId) {
    return { url: parsed.toString(), domain, kind: 'youtube', embedId: youtubeId };
  }
  const vimeoId = vimeoIdFromUrl(parsed);
  if (vimeoId) {
    return { url: parsed.toString(), domain, kind: 'vimeo', embedId: vimeoId };
  }
  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  if (IMAGE_EXT.test(pathAndQuery)) {
    return { url: parsed.toString(), domain, kind: 'image' };
  }
  if (VIDEO_EXT.test(pathAndQuery)) {
    return { url: parsed.toString(), domain, kind: 'video' };
  }
  return { url: parsed.toString(), domain, kind: 'og' };
}

function decodeHtmlEntities(value: string): string {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    });
}

function metaContent(html: string, property: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i'
  );
  return decodeHtmlEntities((html.match(re)?.[1] || html.match(re2)?.[1] || '').trim());
}

function resolvePreviewImage(image: string, pageUrl: URL): string {
  let value = String(image || '').trim();
  if (!value) {
    return '';
  }
  if (value.startsWith('//')) {
    value = `https:${value}`;
  } else if (value.startsWith('/')) {
    value = `${pageUrl.origin}${value}`;
  }
  try {
    const imgUrl = new URL(value);
    if (imgUrl.protocol !== 'http:' && imgUrl.protocol !== 'https:') {
      return '';
    }
    if (isBlockedPreviewHost(imgUrl.hostname)) {
      return '';
    }
    return imgUrl.toString().slice(0, 500);
  } catch {
    return '';
  }
}

export function linkPreviewServiceError(message: string, statusCode = 400): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function assertPublicPreviewUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw linkPreviewServiceError('Chỉ hỗ trợ http/https');
  }
  if (url.username || url.password || isBlockedPreviewHost(url.hostname)) {
    throw linkPreviewServiceError('Không cho phép URL nội bộ');
  }
}

async function resolvePinnedPreviewAddress(url: URL, lookupImpl: PreviewLookup): Promise<PreviewAddress> {
  const hostname = normalizedHostname(url.hostname);
  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (!isPublicPreviewAddress(hostname)) {
      throw linkPreviewServiceError('Không cho phép URL nội bộ');
    }
    return { address: hostname, family: literalFamily as 4 | 6 };
  }

  const addresses = await lookupImpl(hostname, { all: true, verbatim: true });
  const usable = addresses.filter(({ address, family }) => (
    (family === 4 || family === 6) && net.isIP(address) === family
  ));
  if (usable.length === 0) {
    throw new Error('Không thể phân giải tên miền');
  }
  // Reject the hostname completely if any answer can reach a non-public
  // address. Selecting only a public answer would leave mixed-answer DNS
  // rebinding and failover paths open.
  if (usable.some(({ address }) => !isPublicPreviewAddress(address))) {
    throw linkPreviewServiceError('Không cho phép URL nội bộ');
  }
  return usable.find(({ family }) => family === 4) ?? usable[0];
}

function nodeHeaderValue(headers: http.IncomingHttpHeaders, name: string): string | null {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value === undefined ? null : String(value);
}

function cappedResponseText(response: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks, total).toString('utf8'));
    };
    response.on('data', (value) => {
      if (settled) {
        return;
      }
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const remaining = LINK_PREVIEW_HTML_CAP - total;
      if (remaining <= 0) {
        finish();
        response.destroy();
        return;
      }
      const accepted = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      chunks.push(accepted);
      total += accepted.length;
      if (chunk.length > remaining) {
        finish();
        response.destroy();
      }
    });
    response.on('end', finish);
    response.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

async function pinnedPreviewRequest(
  url: URL,
  signal: AbortSignal,
  lookupImpl: PreviewLookup
): Promise<PreviewResponse> {
  const pinned = await resolvePinnedPreviewAddress(url, lookupImpl);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: 'GET',
        signal,
        headers: {
          'user-agent': '36chan-link-preview/1.0',
          accept: 'text/html,application/xhtml+xml'
        },
        lookup: ((_hostname, options, callback) => {
          if (typeof options === 'object' && options?.all) {
            callback(null, [pinned]);
            return;
          }
          callback(null, pinned.address, pinned.family);
        }) as any
      },
      (response) => {
        resolve({
          status: Number(response.statusCode || 0),
          headers: {
            get(name) {
              return nodeHeaderValue(response.headers, name);
            }
          },
          text: () => cappedResponseText(response),
          discard() {
            response.resume();
          }
        });
      }
    );
    request.on('error', reject);
    request.end();
  });
}

async function injectedPreviewRequest(
  url: URL,
  signal: AbortSignal,
  fetchImpl: typeof fetch
): Promise<PreviewResponse> {
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'manual',
    signal,
    headers: {
      'user-agent': '36chan-link-preview/1.0',
      accept: 'text/html,application/xhtml+xml'
    }
  });
  return {
    status: Number(response.status || 200),
    headers: response.headers,
    async text() {
      return (await response.text()).slice(0, LINK_PREVIEW_HTML_CAP);
    },
    async discard() {
      await response.body?.cancel().catch(() => undefined);
    }
  };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function requestPreviewWithRedirects(
  initialUrl: URL,
  {
    signal,
    fetchImpl,
    lookupImpl
  }: {
    signal: AbortSignal;
    fetchImpl?: typeof fetch;
    lookupImpl: PreviewLookup;
  }
): Promise<{ response: PreviewResponse; finalUrl: URL }> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= LINK_PREVIEW_MAX_REDIRECTS; redirectCount += 1) {
    assertPublicPreviewUrl(currentUrl);
    const response = fetchImpl && fetchImpl !== fetch
      ? await injectedPreviewRequest(currentUrl, signal, fetchImpl)
      : await pinnedPreviewRequest(currentUrl, signal, lookupImpl);
    if (!isRedirectStatus(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get('location');
    await response.discard();
    if (!location) {
      return { response, finalUrl: currentUrl };
    }
    if (redirectCount >= LINK_PREVIEW_MAX_REDIRECTS) {
      throw linkPreviewServiceError('URL chuyển hướng quá nhiều lần');
    }
    try {
      currentUrl = new URL(location, currentUrl);
    } catch {
      throw linkPreviewServiceError('URL chuyển hướng không hợp lệ');
    }
  }
  throw linkPreviewServiceError('URL chuyển hướng quá nhiều lần');
}

export async function fetchLinkPreview(
  rawUrl: string,
  {
    fetchImpl,
    lookupImpl = defaultPreviewLookup
  }: { fetchImpl?: typeof fetch; lookupImpl?: PreviewLookup } = {}
): Promise<LinkPreviewMeta> {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw linkPreviewServiceError('URL không hợp lệ');
  }
  assertPublicPreviewUrl(parsed);
  const host = normalizedHostname(parsed.hostname);

  const classified = classifyLink(parsed.toString());
  const displayHost = host.replace(/^www\./, '');
  // Prefer "x.com" on cards even when the posted URL was a fixup proxy.
  const domain = isXStatusUrl(parsed)
    ? 'x.com'
    : displayHost;
  const base: LinkPreviewMeta = {
    url: parsed.toString(),
    domain,
    title: domain,
    description: '',
    image: '',
    kind: classified?.kind || 'og',
    ...(classified?.embedId ? { embedId: classified.embedId } : {})
  };

  // Direct media: no HTML fetch needed for a useful shell.
  if (classified?.kind === 'image' || classified?.kind === 'video') {
    return {
      ...base,
      title: classified.kind === 'image' ? 'Hình ảnh' : 'Video',
      image: classified.kind === 'image' ? parsed.toString().slice(0, 500) : ''
    };
  }

  // X/Twitter status pages: unfurl via fixupx.com (reliable OG for bots).
  let fetchUrl: URL;
  try {
    fetchUrl = new URL(fixupXUnfurlUrl(parsed));
  } catch {
    fetchUrl = parsed;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_PREVIEW_TIMEOUT_MS);
  try {
    const { response, finalUrl } = await requestPreviewWithRedirects(fetchUrl, {
      signal: controller.signal,
      fetchImpl,
      lookupImpl
    });
    const contentType = String(response.headers.get('content-type') || '');
    if (!contentType.includes('text/html')) {
      await response.discard();
      return base;
    }
    const html = await response.text();
    const titleTag = decodeHtmlEntities(html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] || '');
    const title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || titleTag || domain;
    const description = metaContent(html, 'og:description') || metaContent(html, 'description') || '';
    const image = resolvePreviewImage(
      metaContent(html, 'og:image') || metaContent(html, 'twitter:image') || '',
      finalUrl
    );
    return {
      ...base,
      title: title.slice(0, 200),
      description: description.slice(0, 400),
      image
    };
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) {
      throw error;
    }
    return base;
  } finally {
    clearTimeout(timer);
  }
}

export function serializePostLinks(value: unknown): PostLink[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: PostLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const classified = classifyLink(String((item as PostLink).url || ''));
    if (!classified) {
      continue;
    }
    const title = String((item as PostLink).title || '').slice(0, 200);
    const description = String((item as PostLink).description || '').slice(0, 400);
    let image = String((item as PostLink).image || '').slice(0, 500);
    if (image) {
      try {
        const imgUrl = new URL(image);
        if (
          (imgUrl.protocol !== 'http:' && imgUrl.protocol !== 'https:') ||
          isBlockedPreviewHost(imgUrl.hostname)
        ) {
          image = '';
        } else {
          image = imgUrl.toString().slice(0, 500);
        }
      } catch {
        image = '';
      }
    }
    out.push({
      url: classified.url,
      domain: classified.domain,
      kind: classified.kind,
      ...(classified.embedId ? { embedId: classified.embedId } : {}),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(image ? { image } : {})
    });
    if (out.length >= MAX_LINKS_PER_POST) {
      break;
    }
  }
  return out;
}

/** Extract, classify, and optionally unfurl links for storage on a post. */
export async function buildPostLinks(
  body: string,
  {
    fetchMeta = true,
    fetchImpl = fetch,
    max = MAX_LINKS_PER_POST
  }: { fetchMeta?: boolean; fetchImpl?: typeof fetch; max?: number } = {}
): Promise<PostLink[]> {
  const extracted = extractLinks(body, max);
  const results: PostLink[] = [];
  await Promise.all(
    extracted.map(async (item) => {
      const classified = classifyLink(item.url);
      if (!classified) {
        return;
      }
      let meta: LinkPreviewMeta | null = null;
      if (fetchMeta) {
        try {
          meta = await fetchLinkPreview(classified.url, { fetchImpl });
        } catch {
          meta = null;
        }
      }
      results.push({
        ...classified,
        // Prefer unfurl domain (e.g. fixupx → display as x.com).
        ...(meta?.domain ? { domain: meta.domain } : {}),
        ...(meta?.title ? { title: meta.title } : {}),
        ...(meta?.description ? { description: meta.description } : {}),
        ...(meta?.image ? { image: meta.image } : {})
      });
    })
  );
  // Preserve body order
  const byUrl = new Map(results.map((link) => [link.url, link]));
  return extracted
    .map((item) => byUrl.get(item.url))
    .filter(Boolean)
    .slice(0, max) as PostLink[];
}
