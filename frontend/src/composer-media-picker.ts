import { klipyGifToken, normalizeKlipySlug } from './media-tokens';
import {
  STICKERS,
  applyCustomStickerCatalog,
  getStickerPickerItems,
  isCustomStickerKey,
  safeImgurStickerUrl
} from './stickers';
import type { AnyRecord } from './types';

type KlipyMedia = {
  url: string;
  width: number;
  height: number;
};

type KlipyGif = {
  slug: string;
  title: string;
  preview: KlipyMedia;
  full: KlipyMedia;
};

const COMPOSER_TARGETS = new Set(['thread', 'comment', 'quickReply']);
const KLIPY_MEDIA_HOSTS = new Set(['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com']);
const GIF_PAGE_SIZE = 24;
const GIF_TIMEOUT_MS = 10_000;
const GIF_SEARCH_DEBOUNCE_MS = 350;
const MAX_HYDRATION_BATCH = 50;
const MAX_COMPOSER_STICKER_PREVIEWS = 12;
const COMPOSER_PREVIEW_TEXTAREA_IDS = {
  thread: 'threadBody',
  comment: 'commentBody',
  quickReply: 'quickReplyBody'
} as const;

type ComposerPreviewTarget = keyof typeof COMPOSER_PREVIEW_TEXTAREA_IDS;

type ComposerStickerPreview = {
  target: ComposerPreviewTarget;
  textarea: HTMLTextAreaElement;
  host: HTMLElement;
  items: HTMLElement;
  status: HTMLElement;
  signature: string | null;
  count: number | null;
};

function safeKlipyUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !KLIPY_MEDIA_HOSTS.has(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443')
    ) {
      return '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

function positiveDimension(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeMedia(value: AnyRecord): KlipyMedia | null {
  const url = safeKlipyUrl(value?.url);
  const width = positiveDimension(value?.width);
  const height = positiveDimension(value?.height);
  return url && width && height ? { url, width, height } : null;
}

function normalizeGif(value: AnyRecord): KlipyGif | null {
  const slug = normalizeKlipySlug(value?.slug);
  const preview = normalizeMedia(value?.preview);
  const full = normalizeMedia(value?.full);
  if (!slug || !preview || !full) {
    return null;
  }
  return {
    slug,
    title: String(value?.title || slug).trim().slice(0, 200) || slug,
    preview,
    full
  };
}

function responseItems(value: AnyRecord): AnyRecord[] {
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value?.items) ? value.items : [];
}

function isAbortError(error: AnyRecord): boolean {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

export function bindComposerMediaPicker({ api, insertComposerToken, showToast }: AnyRecord): () => void {
  const overlay = document.getElementById('composerMediaPickerOverlay');
  const dialog = document.getElementById('composerMediaPicker');
  const closeButton = document.getElementById('composerMediaPickerClose');
  const stickerTab = document.getElementById('composerStickerTab');
  const gifTab = document.getElementById('composerGifTab');
  const stickerPanel = document.getElementById('composerStickerPanel');
  const gifPanel = document.getElementById('composerGifPanel');
  const stickerGrid = document.getElementById('composerStickerGrid');
  const gifSearch = document.getElementById('composerGifSearchForm');
  const gifInput = document.getElementById('composerGifSearchInput') as HTMLInputElement | null;
  const gifSearchButton = document.getElementById('composerGifSearchButton') as HTMLButtonElement | null;
  const gifStatus = document.getElementById('composerGifStatus');
  const gifResults = document.getElementById('composerGifResults');
  const gifMoreButton = document.getElementById('composerGifMore') as HTMLButtonElement | null;
  const composerStickerPreviews: ComposerStickerPreview[] = [];

  for (const [target, textareaId] of Object.entries(COMPOSER_PREVIEW_TEXTAREA_IDS)) {
    const textarea = document.getElementById(textareaId);
    const host = document.querySelector<HTMLElement>(`[data-composer-sticker-preview="${target}"]`);
    const items = host?.querySelector<HTMLElement>('[data-composer-sticker-preview-items]');
    const status = document.querySelector<HTMLElement>(`[data-composer-sticker-preview-status="${target}"]`);
    if (textarea instanceof HTMLTextAreaElement && host && items && status) {
      composerStickerPreviews.push({
        target: target as ComposerPreviewTarget,
        textarea,
        host,
        items,
        status,
        signature: null,
        count: null
      });
    }
  }

  if (
    !overlay ||
    !dialog ||
    !closeButton ||
    !stickerTab ||
    !gifTab ||
    !stickerPanel ||
    !gifPanel ||
    !stickerGrid ||
    !gifSearch ||
    !gifInput ||
    !gifSearchButton ||
    !gifStatus ||
    !gifResults ||
    !gifMoreButton
  ) {
    return () => {};
  }

  const pickerHome = overlay.parentElement;
  const pickerHomeNextSibling = overlay.nextSibling;

  let activeTarget = '';
  let returnFocus: HTMLElement | null = null;
  let activeTab: 'sticker' | 'gif' = 'sticker';
  let gifMode: 'trending' | 'search' = 'trending';
  let gifQuery = '';
  let gifPage = 0;
  let gifHasNext = false;
  let gifsLoaded = false;
  let requestSequence = 0;
  let requestController: AbortController | null = null;
  let gifSearchTimer: ReturnType<typeof setTimeout> | null = null;
  let hydrationScheduled = false;
  let hydrationRunning = false;
  let customStickerHydrationRunning = false;
  let customStickersLoaded = false;
  let customStickersRequest: Promise<void> | null = null;
  const gifCache = new Map<string, KlipyGif>();
  const removeComposerPreviewListeners: Array<() => void> = [];

  function renderComposerStickerPreview(
    preview: ComposerStickerPreview,
    { force = false }: { force?: boolean } = {}
  ): void {
    const keys = [...preview.textarea.value.matchAll(/\[sticker:([a-z0-9-]+)\]/gi)].map((match) =>
      String(match[1] || '').toLowerCase()
    );
    const signature = keys.join('\n');
    const signatureChanged = preview.signature !== signature;
    if (!force && !signatureChanged) {
      return;
    }
    preview.signature = signature;

    const fragment = document.createDocumentFragment();
    let validCount = 0;
    let renderedCount = 0;

    for (const key of keys) {
      const sticker = STICKERS[key];
      const pendingCustomSticker = !sticker && isCustomStickerKey(key);
      if (!sticker && !pendingCustomSticker) {
        continue;
      }
      const src = sticker?.src ? (sticker.custom ? safeImgurStickerUrl(sticker.src) : sticker.src) : '';
      if (sticker && !src && !sticker.icon) {
        continue;
      }
      validCount += 1;
      if (renderedCount >= MAX_COMPOSER_STICKER_PREVIEWS) {
        continue;
      }
      renderedCount += 1;

      const item = document.createElement('span');
      item.className = 'composer-sticker-preview-item';
      item.dataset.composerStickerPreviewKey = sticker?.key || key;
      item.title = sticker?.label || 'Sticker tùy chỉnh';

      if (!sticker) {
        item.classList.add('composer-sticker-preview-placeholder');
        item.setAttribute('aria-label', 'Sticker tùy chỉnh');
        item.textContent = 'Sticker';
      } else if (src) {
        const image = document.createElement('img');
        image.src = src;
        image.alt = sticker.label;
        image.loading = 'eager';
        image.decoding = 'async';
        if (sticker.custom) {
          image.referrerPolicy = 'no-referrer';
        }
        if (sticker.width && sticker.height) {
          image.width = sticker.width;
          image.height = sticker.height;
        }
        item.appendChild(image);
      } else {
        item.classList.add('composer-sticker-preview-icon');
        item.setAttribute('role', 'img');
        item.setAttribute('aria-label', sticker.label);
        item.textContent = sticker.icon || '';
      }
      fragment.appendChild(item);
    }

    const overflowCount = validCount - renderedCount;
    if (overflowCount > 0) {
      const overflow = document.createElement('span');
      overflow.className = 'composer-sticker-preview-overflow';
      overflow.textContent = `+${overflowCount}`;
      overflow.setAttribute('aria-label', `+${overflowCount}`);
      fragment.appendChild(overflow);
    }

    preview.items.replaceChildren(fragment);
    preview.host.hidden = validCount === 0;
    if (signatureChanged && preview.count !== null) {
      preview.status.textContent =
        validCount > 0 ? `Đã chọn ${validCount} sticker.` : 'Đã bỏ tất cả sticker đã chọn.';
    }
    preview.count = validCount;
  }

  function renderAllComposerStickerPreviews({ force = false }: { force?: boolean } = {}): void {
    for (const preview of composerStickerPreviews) {
      renderComposerStickerPreview(preview, { force });
    }
  }

  for (const preview of composerStickerPreviews) {
    const syncPreview = () => renderComposerStickerPreview(preview);
    preview.textarea.addEventListener('input', syncPreview);
    preview.textarea.addEventListener('focus', syncPreview);
    removeComposerPreviewListeners.push(() => {
      preview.textarea.removeEventListener('input', syncPreview);
      preview.textarea.removeEventListener('focus', syncPreview);
    });
  }

  function renderStickerGrid(): void {
    const fragment = document.createDocumentFragment();
    for (const sticker of getStickerPickerItems()) {
      if (!sticker.src) {
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'composer-sticker-choice';
      button.dataset.composerSticker = sticker.key;
      button.setAttribute('aria-label', 'Chèn ' + sticker.label);
      button.title = sticker.label;

      const image = document.createElement('img');
      image.src = sticker.src;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      if (sticker.custom) {
        image.referrerPolicy = 'no-referrer';
      }
      if (sticker.width && sticker.height) {
        image.width = sticker.width;
        image.height = sticker.height;
      }
      button.appendChild(image);
      fragment.appendChild(button);
    }
    stickerGrid.replaceChildren(fragment);
  }

  async function loadCustomStickers({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (customStickersLoaded && !force) {
      return;
    }
    if (customStickersRequest) {
      return customStickersRequest;
    }
    customStickersRequest = api('/api/stickers', {
      auth: 'none',
      timeoutMs: GIF_TIMEOUT_MS,
      timeoutMessage: 'Danh sách sticker phản hồi quá lâu, vui lòng thử lại.'
    })
      .then((items: unknown) => {
        applyCustomStickerCatalog(items);
        customStickersLoaded = true;
        renderStickerGrid();
        renderAllComposerStickerPreviews({ force: true });
        document
          .querySelectorAll<HTMLElement>('[data-custom-sticker-state="failed"]')
          .forEach((host) => host.removeAttribute('data-custom-sticker-state'));
        scheduleHydration();
      })
      .finally(() => {
        customStickersRequest = null;
      });
    return customStickersRequest;
  }

  function setTab(tab: 'sticker' | 'gif', { focus = false }: { focus?: boolean } = {}): void {
    activeTab = tab;
    const stickerActive = tab === 'sticker';
    stickerTab.classList.toggle('active', stickerActive);
    gifTab.classList.toggle('active', !stickerActive);
    stickerTab.setAttribute('aria-selected', String(stickerActive));
    gifTab.setAttribute('aria-selected', String(!stickerActive));
    stickerPanel.hidden = !stickerActive;
    gifPanel.hidden = stickerActive;
    if (focus) {
      (stickerActive ? stickerTab : gifTab).focus();
    }
    if (!stickerActive && !gifsLoaded) {
      void loadGifs({ mode: 'trending', page: 1 });
    }
  }

  function openPicker(target: string, trigger: HTMLElement): void {
    if (!COMPOSER_TARGETS.has(target)) {
      return;
    }
    if (!overlay.hidden && returnFocus === trigger) {
      closePicker();
      return;
    }
    const anchor = trigger.closest<HTMLElement>('[data-composer-picker]');
    if (!anchor) {
      return;
    }
    returnFocus?.setAttribute('aria-expanded', 'false');
    anchor.insertAdjacentElement('afterend', overlay);
    renderStickerGrid();
    void loadCustomStickers().catch(() => {});
    activeTarget = target;
    returnFocus = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    overlay.hidden = false;
    setTab('sticker');
    stickerTab.focus();
  }

  function restorePickerHome(): void {
    if (!pickerHome || overlay.parentElement === pickerHome) {
      return;
    }
    const nextSibling = pickerHomeNextSibling?.parentNode === pickerHome ? pickerHomeNextSibling : null;
    pickerHome.insertBefore(overlay, nextSibling);
  }

  function closePicker({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
    if (overlay.hidden) {
      return;
    }
    requestController?.abort();
    requestController = null;
    if (gifSearchTimer !== null) {
      clearTimeout(gifSearchTimer);
      gifSearchTimer = null;
    }
    overlay.hidden = true;
    restorePickerHome();
    activeTarget = '';
    returnFocus?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && returnFocus?.isConnected) {
      returnFocus.focus();
    }
    returnFocus = null;
  }

  function setLoading(loading: boolean): void {
    gifSearchButton.disabled = loading;
    gifMoreButton.disabled = loading;
  }

  function renderGifCard(item: KlipyGif): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'composer-gif-choice';
    button.dataset.composerGif = item.slug;
    button.setAttribute('aria-label', 'Chèn GIF ' + item.title);

    const image = document.createElement('img');
    image.src = item.preview.url;
    image.alt = item.title;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.width = item.preview.width;
    image.height = item.preview.height;

    const label = document.createElement('span');
    label.textContent = item.title;
    button.append(image, label);
    return button;
  }

  function appendGifItems(items: AnyRecord[], append: boolean): number {
    if (!append) {
      gifResults.replaceChildren();
    }
    const fragment = document.createDocumentFragment();
    let count = 0;
    for (const rawItem of items) {
      const item = normalizeGif(rawItem);
      if (!item) {
        continue;
      }
      gifCache.set(item.slug, item);
      fragment.appendChild(renderGifCard(item));
      count += 1;
    }
    gifResults.appendChild(fragment);
    scheduleHydration();
    return count;
  }

  async function loadGifs({
    mode,
    query = '',
    page = 1,
    append = false
  }: {
    mode: 'trending' | 'search';
    query?: string;
    page?: number;
    append?: boolean;
  }): Promise<void> {
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    const requestId = ++requestSequence;
    const params = new URLSearchParams({ page: String(page), perPage: String(GIF_PAGE_SIZE) });
    if (mode === 'search') {
      params.set('q', query);
    }
    gifStatus.textContent = 'Đang tải GIF...';
    setLoading(true);
    try {
      const result = await api(`/api/media/gifs/${mode}?${params}`, {
        auth: 'none',
        timeoutMs: GIF_TIMEOUT_MS,
        timeoutMessage: 'KLIPY phản hồi quá lâu, vui lòng thử lại.',
        signal: controller.signal
      });
      if (requestId !== requestSequence) {
        return;
      }
      const items = responseItems(result);
      const added = appendGifItems(items, append);
      gifMode = mode;
      gifQuery = query;
      gifPage = Number(result?.page || page);
      gifHasNext = Boolean(result?.hasNext);
      gifsLoaded = true;
      gifMoreButton.hidden = !gifHasNext;
      gifStatus.textContent = added > 0
        ? `Đã tải ${added} GIF.`
        : 'Không tìm thấy GIF phù hợp.';
    } catch (error) {
      if (requestId !== requestSequence || isAbortError(error)) {
        return;
      }
      gifHasNext = false;
      gifMoreButton.hidden = true;
      gifStatus.textContent = error instanceof Error ? error.message : 'Không tải được GIF.';
    } finally {
      if (requestId === requestSequence) {
        requestController = null;
        setLoading(false);
      }
    }
  }

  function shareGif(slug: string): void {
    void api(`/api/media/gifs/${encodeURIComponent(slug)}/share`, {
      method: 'POST',
      auth: 'none',
      timeoutMs: GIF_TIMEOUT_MS,
      body: JSON.stringify(gifMode === 'search' && gifQuery ? { query: gifQuery } : {})
    }).catch(() => {});
  }

  function renderHydratedGif(host: HTMLElement, item: KlipyGif): void {
    const image = document.createElement('img');
    image.src = item.full.url;
    image.alt = item.title || 'GIF từ KLIPY';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.width = item.full.width;
    image.height = item.full.height;
    host.dataset.klipyState = 'ready';
    host.title = item.title;
    host.replaceChildren(image);
  }

  function renderGifFailure(host: HTMLElement): void {
    host.dataset.klipyState = 'failed';
    const placeholder = document.createElement('span');
    placeholder.className = 'post-gif-placeholder';
    placeholder.textContent = 'GIF không tải được';
    host.replaceChildren(placeholder);
  }

  function renderHydratedCustomSticker(host: HTMLElement, key: string): void {
    const sticker = STICKERS[key];
    const src = safeImgurStickerUrl(sticker?.src);
    if (!sticker?.custom || !src) {
      host.dataset.customStickerState = 'failed';
      host.textContent = 'Sticker không tải được';
      return;
    }
    const image = document.createElement('img');
    image.className = 'post-sticker';
    image.src = src;
    image.alt = sticker.label;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    host.replaceWith(image);
  }

  async function hydratePendingCustomStickers(): Promise<void> {
    if (customStickerHydrationRunning) {
      return;
    }
    const hosts = Array.from(
      document.querySelectorAll<HTMLElement>('.post-sticker[data-custom-sticker]:not([data-custom-sticker-state])')
    );
    if (hosts.length === 0) {
      return;
    }
    customStickerHydrationRunning = true;
    try {
      try {
        await loadCustomStickers();
      } catch {
        for (const host of hosts) {
          host.dataset.customStickerState = 'failed';
          host.textContent = 'Sticker không tải được';
        }
        return;
      }
      for (const host of hosts) {
        const key = String(host.dataset.customSticker || '').toLowerCase();
        if (isCustomStickerKey(key)) {
          renderHydratedCustomSticker(host, key);
        }
      }
    } finally {
      customStickerHydrationRunning = false;
    }
  }

  async function hydratePendingGifs(): Promise<void> {
    if (hydrationRunning) {
      return;
    }
    hydrationRunning = true;
    try {
      const hosts = Array.from(
        document.querySelectorAll<HTMLElement>('.post-gif[data-klipy-gif]:not([data-klipy-state])')
      ).slice(0, MAX_HYDRATION_BATCH);
      if (hosts.length === 0) {
        return;
      }

      const missing = new Set<string>();
      for (const host of hosts) {
        const slug = normalizeKlipySlug(host.dataset.klipyGif);
        if (!slug) {
          renderGifFailure(host);
        } else if (gifCache.has(slug)) {
          renderHydratedGif(host, gifCache.get(slug)!);
        } else {
          host.dataset.klipyState = 'pending';
          missing.add(slug);
        }
      }

      if (missing.size > 0) {
        try {
          const result = await api(`/api/media/gifs/items?slugs=${encodeURIComponent([...missing].join(','))}`, {
            auth: 'none',
            timeoutMs: GIF_TIMEOUT_MS,
            timeoutMessage: 'KLIPY phản hồi quá lâu, vui lòng thử lại.'
          });
          for (const rawItem of responseItems(result)) {
            const item = normalizeGif(rawItem);
            if (item) {
              gifCache.set(item.slug, item);
            }
          }
        } catch {
          // Each unresolved placeholder receives a neutral failure state below.
        }

        for (const host of hosts) {
          if (host.dataset.klipyState !== 'pending') {
            continue;
          }
          const slug = normalizeKlipySlug(host.dataset.klipyGif);
          const item = gifCache.get(slug);
          if (item) {
            renderHydratedGif(host, item);
          } else {
            renderGifFailure(host);
          }
        }
      }
    } finally {
      hydrationRunning = false;
      if (document.querySelector('.post-gif[data-klipy-gif]:not([data-klipy-state])')) {
        scheduleHydration();
      }
    }
  }

  function scheduleHydration(): void {
    if (hydrationScheduled) {
      return;
    }
    hydrationScheduled = true;
    queueMicrotask(() => {
      hydrationScheduled = false;
      void hydratePendingGifs();
      void hydratePendingCustomStickers();
    });
  }

  function onCustomStickersChanged(): void {
    customStickersLoaded = false;
    void loadCustomStickers({ force: true }).catch(() => {});
  }

  function onDocumentClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }
    const opener = target.closest<HTMLElement>('[data-composer-media-open]');
    if (opener) {
      openPicker(opener.dataset.composerMediaOpen || '', opener);
      return;
    }
    if (overlay.hidden) {
      return;
    }
    if (!overlay.contains(target)) {
      closePicker({ restoreFocus: false });
      return;
    }
    if (target === overlay || target.closest('#composerMediaPickerClose')) {
      closePicker();
      return;
    }
    const tab = target.closest<HTMLElement>('[data-composer-media-tab]');
    if (tab) {
      setTab(tab.dataset.composerMediaTab === 'gif' ? 'gif' : 'sticker', { focus: true });
      return;
    }
    const stickerChoice = target.closest<HTMLElement>('[data-composer-sticker]');
    if (stickerChoice) {
      const key = stickerChoice.dataset.composerSticker || '';
      if (key && activeTarget) {
        insertComposerToken(activeTarget, `[sticker:${key}]`, { showToast });
        closePicker();
      }
      return;
    }
    const gifChoice = target.closest<HTMLElement>('[data-composer-gif]');
    if (gifChoice) {
      const slug = normalizeKlipySlug(gifChoice.dataset.composerGif);
      const token = klipyGifToken(slug);
      if (token && activeTarget) {
        insertComposerToken(activeTarget, token, { showToast });
        shareGif(slug);
        closePicker();
      }
      return;
    }
    if (target.closest('#composerGifMore') && gifHasNext) {
      void loadGifs({
        mode: gifMode,
        query: gifQuery,
        page: gifPage + 1,
        append: true
      });
    }
  }

  function loadGifInput({ force = false }: { force?: boolean } = {}): void {
    const query = gifInput.value.trim();
    if (query) {
      if (!force && gifsLoaded && gifMode === 'search' && gifQuery === query && gifPage === 1) {
        return;
      }
      void loadGifs({ mode: 'search', query, page: 1 });
    } else {
      if (!force && gifsLoaded && gifMode === 'trending' && gifPage === 1) {
        return;
      }
      void loadGifs({ mode: 'trending', page: 1 });
    }
  }

  function runGifSearch(): void {
    if (gifSearchTimer !== null) {
      clearTimeout(gifSearchTimer);
      gifSearchTimer = null;
    }
    loadGifInput({ force: true });
  }

  function onSearchKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    runGifSearch();
  }

  function onSearchInput(): void {
    if (gifSearchTimer !== null) {
      clearTimeout(gifSearchTimer);
    }
    gifSearchTimer = setTimeout(() => {
      gifSearchTimer = null;
      if (!overlay.hidden && activeTab === 'gif') {
        loadGifInput();
      }
    }, GIF_SEARCH_DEBOUNCE_MS);
  }

  function onDocumentKeyDown(event: KeyboardEvent): void {
    if (overlay.hidden) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
      return;
    }
    if (
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      document.activeElement?.getAttribute('role') === 'tab'
    ) {
      event.preventDefault();
      setTab(activeTab === 'sticker' ? 'gif' : 'sticker', { focus: true });
    }
  }

  function onHashChange(): void {
    closePicker({ restoreFocus: false });
  }

  const hydrationObserver = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length > 0)) {
      scheduleHydration();
    }
  });

  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeyDown);
  gifSearchButton.addEventListener('click', runGifSearch);
  gifInput.addEventListener('keydown', onSearchKeyDown);
  gifInput.addEventListener('input', onSearchInput);
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('custom-stickers-changed', onCustomStickersChanged);
  hydrationObserver.observe(document.body, { childList: true, subtree: true });
  renderStickerGrid();
  renderAllComposerStickerPreviews({ force: true });
  void loadCustomStickers().catch(() => {});
  scheduleHydration();

  return () => {
    requestController?.abort();
    hydrationObserver.disconnect();
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeyDown);
    gifSearchButton.removeEventListener('click', runGifSearch);
    gifInput.removeEventListener('keydown', onSearchKeyDown);
    gifInput.removeEventListener('input', onSearchInput);
    window.removeEventListener('hashchange', onHashChange);
    window.removeEventListener('custom-stickers-changed', onCustomStickersChanged);
    removeComposerPreviewListeners.forEach((removeListener) => removeListener());
    closePicker({ restoreFocus: false });
  };
}
