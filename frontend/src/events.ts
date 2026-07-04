export function handleBrokenThumbnailError(event) {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.thumbBroken === '1') {
    return;
  }
  if (!img.closest('.thread-thumb-wrap, .catalog-thumb, .popular-thumb')) {
    return;
  }
  img.dataset.thumbBroken = '1';
  const placeholder = document.createElement('span');
  placeholder.className = `${img.className} placeholder thumb-broken`.trim();
  placeholder.textContent = 'Tệp lỗi';
  if (img.dataset.fullSrc) {
    placeholder.dataset.fullSrc = img.dataset.fullSrc;
  }
  img.replaceWith(placeholder);
}
