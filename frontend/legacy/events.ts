export function handleBrokenThumbnailError(event) {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.thumbBroken === '1') {
    return;
  }
  if (!img.closest('.thread-thumb-wrap, .catalog-thumb, .popular-thumb, .thread-media-index-item')) {
    return;
  }

  // Prefer original file when the thumbnail URL fails.
  const fullSrc = img.dataset.fullSrc || '';
  if (fullSrc && img.currentSrc !== fullSrc && img.src !== fullSrc && img.dataset.thumbFallbackTried !== '1') {
    img.dataset.thumbFallbackTried = '1';
    img.src = fullSrc;
    return;
  }

  img.dataset.thumbBroken = '1';
  const isThumb = img.classList.contains('thumb') || Boolean(img.closest('.catalog-thumb, .popular-thumb, .thread-media-index-item'));
  const placeholder = document.createElement('span');
  placeholder.className = `${isThumb ? 'thumb' : img.className} placeholder thumb-broken`.trim();
  placeholder.textContent = 'Tệp lỗi';
  placeholder.setAttribute('role', 'img');
  placeholder.setAttribute('aria-label', 'Không tải được ảnh');
  if (fullSrc) {
    placeholder.dataset.fullSrc = fullSrc;
  }
  img.replaceWith(placeholder);
}
