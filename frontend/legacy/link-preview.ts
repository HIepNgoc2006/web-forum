import { escapeHtml } from './format';
import type { AnyRecord } from './types';

const linkPreviewCache = new Map<string, AnyRecord | null>();
const MAX_POST_LINKS = 3;
const MAX_RICH_EMBEDS = 1;

function truncateText(value: string, max: number) {
  const text = String(value || '');
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

/** Client-side extract for old posts without stored links. */
export function extractPostLinksFromBody(body: string, max = MAX_POST_LINKS): AnyRecord[] {
  const text = String(body || '');
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  const seen = new Set<string>();
  const links: AnyRecord[] = [];
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
      seen.add(cleaned);
      links.push({
        url: cleaned,
        domain: url.hostname.replace(/^www\./i, ''),
        kind: classifyClientLink(cleaned)
      });
    } catch {
      // skip
    }
  }
  return links;
}

function youtubeId(url: string): string {
  try {
    const parsed = new URL(url);
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
  } catch {
    return '';
  }
  return '';
}

function vimeoId(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'vimeo.com' && host !== 'player.vimeo.com') {
      return '';
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    const id = parts[0] === 'video' ? parts[1] : parts[0];
    return /^\d{6,12}$/.test(String(id || '')) ? String(id) : '';
  } catch {
    return '';
  }
}

export function classifyClientLink(url: string): string {
  if (youtubeId(url)) {
    return 'youtube';
  }
  if (vimeoId(url)) {
    return 'vimeo';
  }
  if (/\.(jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(url)) {
    return 'image';
  }
  if (/\.(mp4|webm)(?:[?#]|$)/i.test(url)) {
    return 'video';
  }
  return 'og';
}

function normalizeLinksForPost(post: AnyRecord): AnyRecord[] {
  if (Array.isArray(post?.links) && post.links.length) {
    return post.links
      .map((link: AnyRecord) => {
        const url = String(link?.url || '');
        if (!url) {
          return null;
        }
        const kind = String(link.kind || classifyClientLink(url));
        const embedId =
          String(link.embedId || '') ||
          (kind === 'youtube' ? youtubeId(url) : kind === 'vimeo' ? vimeoId(url) : '');
        return {
          url,
          domain: String(link.domain || domainFromUrl(url)),
          kind,
          title: String(link.title || ''),
          description: String(link.description || ''),
          image: String(link.image || ''),
          embedId
        };
      })
      .filter(Boolean)
      .slice(0, MAX_POST_LINKS) as AnyRecord[];
  }
  const body = String(post?.body || '');
  if (!body) {
    return [];
  }
  return extractPostLinksFromBody(body).map((link) => ({
    ...link,
    embedId:
      link.kind === 'youtube' ? youtubeId(link.url) : link.kind === 'vimeo' ? vimeoId(link.url) : ''
  }));
}

function ogCardHtml(link: AnyRecord) {
  const url = String(link.url || '');
  const domain = String(link.domain || domainFromUrl(url));
  const cached = linkPreviewCache.get(url);
  // Prefer server-stored link meta over any stale session cache entry.
  const title = link.title || cached?.title || domain || url;
  const description = link.description || cached?.description || '';
  const image = link.image || cached?.image || '';
  return `<a class="post-link-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" data-post-link="${escapeHtml(url)}">
    ${image ? `<img class="post-link-card-image" src="${escapeHtml(image)}" alt="" loading="lazy" />` : ''}
    <span class="post-link-card-body">
      <span class="post-link-card-title">${escapeHtml(truncateText(String(title), 90))}</span>
      ${description ? `<span class="post-link-card-desc muted">${escapeHtml(truncateText(String(description), 120))}</span>` : ''}
      <span class="post-link-card-domain muted">${escapeHtml(domain || url)}</span>
    </span>
  </a>`;
}

function youtubePosterUrl(id: string): string {
  // hqdefault is widely available; maxresdefault 404s for some videos.
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
}

function embedShellHtml(link: AnyRecord, host: 'youtube' | 'vimeo') {
  const url = String(link.url || '');
  const id = String(link.embedId || (host === 'youtube' ? youtubeId(url) : vimeoId(url)));
  if (!id) {
    return ogCardHtml(link);
  }
  const label = host === 'youtube' ? 'YouTube' : 'Vimeo';
  const poster =
    host === 'youtube'
      ? `<img class="post-link-embed-thumb" src="${escapeHtml(youtubePosterUrl(id))}" alt="" loading="lazy" decoding="async" />`
      : '';
  return `<div class="post-link-embed post-link-embed-${host}" data-embed-host="${host}" data-embed-id="${escapeHtml(id)}">
    <div class="post-link-embed-poster">
      ${poster}
      <span class="post-link-embed-label">${escapeHtml(label)}</span>
      <button type="button" class="post-link-embed-load" data-post-embed-load aria-label="Phát video ${escapeHtml(label)}">Phát video</button>
      <a class="post-link-embed-open muted" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(domainFromUrl(url))}</a>
    </div>
  </div>`;
}

function mediaHtml(link: AnyRecord) {
  const url = String(link.url || '');
  const kind = String(link.kind || 'og');
  if (kind === 'image') {
    return `<a class="post-link-media post-link-media-image" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
      <img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" />
    </a>`;
  }
  if (kind === 'video') {
    return `<div class="post-link-media post-link-media-video">
      <video src="${escapeHtml(url)}" controls preload="metadata" playsinline></video>
    </div>`;
  }
  return ogCardHtml(link);
}

export function postLinksHtml(post: AnyRecord): string {
  if (post?.isDeleted || post?.deleted) {
    return '';
  }
  const links = normalizeLinksForPost(post);
  if (!links.length) {
    return '';
  }
  let richEmbeds = 0;
  const cards = links
    .map((link) => {
      const kind = String(link.kind || 'og');
      if ((kind === 'youtube' || kind === 'vimeo') && richEmbeds < MAX_RICH_EMBEDS) {
        richEmbeds += 1;
        return embedShellHtml(link, kind as 'youtube' | 'vimeo');
      }
      if (kind === 'image' || kind === 'video') {
        return mediaHtml(link);
      }
      return ogCardHtml(link);
    })
    .join('');
  return `<div class="post-link-previews" data-post-links>${cards}</div>`;
}

function applyPreviewToCard(card: Element, preview: AnyRecord | null, url: string) {
  if (!preview || !(card instanceof HTMLElement)) {
    return;
  }
  const title = String(preview.title || preview.domain || url);
  const description = String(preview.description || '');
  const image = String(preview.image || '');
  const domain = String(preview.domain || '');
  const titleEl = card.querySelector('.post-link-card-title');
  const descEl = card.querySelector('.post-link-card-desc');
  const domainEl = card.querySelector('.post-link-card-domain');
  if (titleEl) {
    titleEl.textContent = truncateText(title, 90);
  }
  if (domainEl) {
    domainEl.textContent = domain || url;
  }
  if (description) {
    if (descEl) {
      descEl.textContent = truncateText(description, 120);
    } else {
      const span = document.createElement('span');
      span.className = 'post-link-card-desc muted';
      span.textContent = truncateText(description, 120);
      card.querySelector('.post-link-card-body')?.insertBefore(span, domainEl);
    }
  }
  if (image && !card.querySelector('.post-link-card-image')) {
    const img = document.createElement('img');
    img.className = 'post-link-card-image';
    img.src = image;
    img.alt = '';
    img.loading = 'lazy';
    card.insertBefore(img, card.firstChild);
  }
}

export function hydratePostLinkPreviews(
  root: ParentNode | null | undefined,
  api: (path: string, options?: AnyRecord) => Promise<AnyRecord>
) {
  if (!root) {
    return;
  }
  const cards = root.querySelectorAll('[data-post-link]');
  cards.forEach((node) => {
    const url = node.getAttribute('data-post-link') || '';
    if (!url) {
      return;
    }
    if (linkPreviewCache.has(url)) {
      const cached = linkPreviewCache.get(url);
      if (cached) {
        applyPreviewToCard(node, cached, url);
      }
      return;
    }
    // Skip fetch when card already has a non-domain title from stored links.
    const titleEl = node.querySelector('.post-link-card-title');
    const domainEl = node.querySelector('.post-link-card-domain');
    const existingTitle = titleEl?.textContent?.trim() || '';
    const existingDomain = domainEl?.textContent?.trim() || '';
    const hasImage = Boolean(node.querySelector('.post-link-card-image'));
    if (existingTitle && existingTitle !== existingDomain && existingTitle !== url && hasImage) {
      linkPreviewCache.set(url, {
        url,
        title: existingTitle,
        description: node.querySelector('.post-link-card-desc')?.textContent || '',
        image: (node.querySelector('.post-link-card-image') as HTMLImageElement | null)?.src || '',
        domain: existingDomain
      });
      return;
    }
    linkPreviewCache.set(url, null);
    api('/api/link-preview', {
      method: 'POST',
      body: JSON.stringify({ url })
    })
      .then((preview) => {
        linkPreviewCache.set(url, preview || null);
        document.querySelectorAll(`[data-post-link="${CSS.escape(url)}"]`).forEach((card) => {
          applyPreviewToCard(card, preview || null, url);
        });
      })
      .catch(() => {
        // keep bare card
      });
  });
}

function buildYoutubeEmbedSrc(id: string): string {
  // Use the standard embed host (not youtube-nocookie): nocookie + missing/weak
  // Referer commonly yields "Video unavailable" / Error 153.
  // origin + referrerpolicy help YouTube accept the embedder identity.
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    modestbranding: '1',
    playsinline: '1'
  });
  try {
    if (typeof window !== 'undefined' && window.location?.origin) {
      params.set('origin', window.location.origin);
    }
  } catch {
    // ignore
  }
  return `https://www.youtube.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
}

function loadPostLinkEmbed(shell: HTMLElement): boolean {
  if (shell.classList.contains('is-loaded')) {
    return true;
  }
  const host = shell.getAttribute('data-embed-host') || '';
  const id = shell.getAttribute('data-embed-id') || '';
  if (!id) {
    return true;
  }
  let src = '';
  if (host === 'youtube' && /^[\w-]{6,32}$/.test(id)) {
    src = buildYoutubeEmbedSrc(id);
  } else if (host === 'vimeo' && /^\d{6,12}$/.test(id)) {
    src = `https://player.vimeo.com/video/${encodeURIComponent(id)}?autoplay=1`;
  }
  if (!src) {
    return true;
  }
  const iframe = document.createElement('iframe');
  iframe.className = 'post-link-embed-frame';
  iframe.title = host === 'youtube' ? 'YouTube video' : 'Vimeo video';
  iframe.setAttribute('loading', 'lazy');
  iframe.allow =
    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  // Required by YouTube embeds (Error 153 / "Video unavailable" when missing).
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('frameborder', '0');
  // Set src last so referrerpolicy is applied to the navigation.
  iframe.src = src;
  shell.innerHTML = '';
  shell.appendChild(iframe);
  shell.classList.add('is-loaded');
  return true;
}

export function handlePostLinkEmbedClick(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }
  // External "open on YouTube" link should navigate normally.
  if (target.closest('a.post-link-embed-open')) {
    return false;
  }
  const shell = target.closest('.post-link-embed') as HTMLElement | null;
  if (!shell || shell.classList.contains('is-loaded')) {
    return Boolean(target.closest('[data-post-embed-load]'));
  }
  // Whole poster (or the play button) starts playback.
  if (!target.closest('[data-post-embed-load]') && !target.closest('.post-link-embed-poster')) {
    return false;
  }
  event.preventDefault();
  return loadPostLinkEmbed(shell);
}
