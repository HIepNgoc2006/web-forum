import { els } from './dom';
import type { AnyRecord } from './types';

export function focusPermalinkPost(globalNumber: string, { scroll = false }: AnyRecord = {}) {
  const postNumber = String(globalNumber || '').trim();
  if (!postNumber) {
    return;
  }
  const target = document.getElementById(`p${postNumber}`);
  if (!target) {
    return;
  }
  document.querySelectorAll('.permalink-target').forEach((post) => {
    post.classList.remove('permalink-target');
  });
  target.classList.add('permalink-target');
  if (scroll) {
    window.setTimeout(() => {
      target.scrollIntoView({ block: 'center' });
    }, 0);
  }
}

function loadFullMediaForToggle(imageToggle) {
  const fullSrc = imageToggle.dataset.fullSrc;
  if (!fullSrc) {
    return;
  }

  if (imageToggle.dataset.mediaType === 'video') {
    let video = imageToggle.querySelector('video');
    if (!video) {
      video = document.createElement('video');
      video.className = imageToggle.dataset.imageClass || 'post-image';
      video.controls = true;
      video.preload = 'metadata';
      imageToggle.replaceChildren(video);
    }
    if (video.dataset.fullLoaded !== 'true') {
      video.src = fullSrc;
      video.dataset.fullLoaded = 'true';
    }
    return;
  }

  let image = imageToggle.querySelector('img');
  if (!image) {
    image = document.createElement('img');
    image.className = imageToggle.dataset.imageClass || 'post-image';
    image.alt = imageToggle.dataset.imageName || 'tai-len';
    imageToggle.replaceChildren(image);
  }

  if (image.dataset.fullLoaded !== 'true') {
    image.src = fullSrc;
    image.dataset.fullLoaded = 'true';
  }
}

function threadMediaToggles() {
  return els.threadDetail ? [...els.threadDetail.querySelectorAll('[data-image-toggle]')] : [];
}

export function bindThreadMediaKeyboardEvents({ body = document.body }: AnyRecord = {}) {
  body.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const mediaToggle = target.closest('[data-image-toggle][role="button"]');
    if (!(mediaToggle instanceof HTMLElement) || (event.key !== 'Enter' && event.key !== ' ')) {
      return;
    }
    event.preventDefault();
    mediaToggle.click();
  });
}

export function handleThreadMediaClick(event, { showToast }: AnyRecord = {}) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  const imageToggle = target.closest('[data-image-toggle]');
  if (imageToggle) {
    if (imageToggle.classList.contains('expanded') && target.closest('video')) {
      return true;
    }
    // A spoilered image reveals on its first click instead of zooming.
    if (imageToggle.hasAttribute('data-spoiler-image') && !imageToggle.classList.contains('spoiler-revealed')) {
      imageToggle.classList.add('spoiler-revealed');
      imageToggle.closest('.thread-thumb-wrap')?.classList.remove('spoiler-image');
      syncThreadMediaToolbarState();
      return true;
    }
    setMediaToggleExpanded(imageToggle, !imageToggle.classList.contains('expanded'));
    syncThreadMediaToolbarState();
    return true;
  }

  const threadMediaButton = target.closest('[data-thread-media-toggle]');
  if (threadMediaButton) {
    const expanded = toggleAllThreadMedia();
    showToast(expanded ? 'Đã mở toàn bộ media trong thread.' : 'Đã thu toàn bộ media trong thread.');
    return true;
  }

  return false;
}

/** Roots that can collapse: thread posts, board OPs, board reply previews. */
const POST_COLLAPSE_ROOT_SELECTOR = 'article.post, .thread-op, article.reply-preview';

export function findPostCollapseRoot(from: Element | null): HTMLElement | null {
  if (!from) {
    return null;
  }
  return from.closest(POST_COLLAPSE_ROOT_SELECTOR);
}

export function handleThreadPostCollapseClick(event, { showToast }: AnyRecord = {}) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  const collapsePostButton = target.closest('[data-collapse-post]');
  if (collapsePostButton) {
    const post = findPostCollapseRoot(collapsePostButton);
    const collapsed = !post?.classList.contains('post-collapsed');
    setPostCollapsed(post, collapsed);
    syncThreadPostCollapseToolbarState();
    return true;
  }

  const collapseThreadPostsButton = target.closest('[data-thread-collapse-posts]');
  if (collapseThreadPostsButton) {
    const collapsed = toggleAllThreadPostsCollapsed();
    showToast(collapsed ? 'Đã thu toàn bộ bài trong thread.' : 'Đã mở toàn bộ bài trong thread.');
    return true;
  }

  return false;
}
export function setMediaToggleExpanded(imageToggle, expanded, { revealSpoiler = false }: AnyRecord = {}) {
  if (!imageToggle) {
    return;
  }
  if (revealSpoiler && imageToggle.hasAttribute('data-spoiler-image')) {
    imageToggle.classList.add('spoiler-revealed');
    imageToggle.closest('.thread-thumb-wrap')?.classList.remove('spoiler-image');
  }
  imageToggle.classList.toggle('expanded', expanded);
  if (expanded) {
    loadFullMediaForToggle(imageToggle);
  }
  imageToggle.closest('.thread-thumb-wrap')?.classList.toggle('image-expanded', expanded);
  imageToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

export function syncThreadMediaToolbarState() {
  const toggles = threadMediaToggles();
  const buttons = document.querySelectorAll('[data-thread-media-toggle]');
  const expandedCount = toggles.filter((toggle) => toggle.classList.contains('expanded')).length;
  const allExpanded = toggles.length > 0 && expandedCount === toggles.length;
  buttons.forEach((button) => {
    button.disabled = toggles.length === 0;
    button.textContent = allExpanded ? 'Thu media' : 'Mở media';
    button.setAttribute('aria-pressed', allExpanded ? 'true' : 'false');
    button.title = allExpanded ? 'Thu toàn bộ ảnh và video trong thread' : 'Mở toàn bộ ảnh và video trong thread';
  });
}

export function toggleAllThreadMedia() {
  const toggles = threadMediaToggles();
  if (!toggles.length) {
    return false;
  }
  const shouldExpand = toggles.some((toggle) => !toggle.classList.contains('expanded'));
  toggles.forEach((toggle) => setMediaToggleExpanded(toggle, shouldExpand, { revealSpoiler: shouldExpand }));
  syncThreadMediaToolbarState();
  return shouldExpand;
}

function threadPosts() {
  return els.threadDetail ? [...els.threadDetail.querySelectorAll('article.post')] : [];
}

export function setPostCollapsed(post, collapsed) {
  if (!post) {
    return;
  }
  post.classList.toggle('post-collapsed', collapsed);
  const button = post.querySelector('[data-collapse-post]');
  if (button) {
    button.textContent = collapsed ? '[Mở]' : '[Thu]';
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    button.title = collapsed ? 'Mở lại bài viết' : 'Thu gọn bài viết';
  }
  // Keep Vietnamese in the DOM (UTF-8 HTML/JS), not CSS content strings.
  const meta = post.querySelector('.post-meta');
  if (meta) {
    let label = meta.querySelector('.post-collapsed-label');
    if (collapsed) {
      if (!label) {
        label = document.createElement('span');
        label.className = 'post-collapsed-label';
        label.textContent = '(đã thu gọn)';
        meta.appendChild(label);
      }
    } else if (label) {
      label.remove();
    }
  }
}

export function syncThreadPostCollapseToolbarState() {
  const posts = threadPosts();
  const buttons = document.querySelectorAll('[data-thread-collapse-posts]');
  const collapsedCount = posts.filter((post) => post.classList.contains('post-collapsed')).length;
  const allCollapsed = posts.length > 0 && collapsedCount === posts.length;
  buttons.forEach((button) => {
    button.disabled = posts.length === 0;
    button.textContent = allCollapsed ? 'Mở bài' : 'Thu bài';
    button.setAttribute('aria-pressed', allCollapsed ? 'true' : 'false');
    button.title = allCollapsed ? 'Mở toàn bộ bài trong thread' : 'Thu gọn toàn bộ bài trong thread';
  });
}

export function toggleAllThreadPostsCollapsed() {
  const posts = threadPosts();
  if (!posts.length) {
    return false;
  }
  const shouldCollapse = posts.some((post) => !post.classList.contains('post-collapsed'));
  posts.forEach((post) => setPostCollapsed(post, shouldCollapse));
  syncThreadPostCollapseToolbarState();
  return shouldCollapse;
}
