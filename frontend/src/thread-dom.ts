import { els } from './dom';
import type { AnyRecord } from './types';

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
