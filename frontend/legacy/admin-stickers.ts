import { escapeHtml } from './format';
import { normalizeCustomStickerCatalog } from './stickers';

export function adminCustomStickersHtml(value: unknown): string {
  const stickers = normalizeCustomStickerCatalog(value);
  const rows = stickers
    .map((sticker) => {
      const active = sticker.active !== false;
      return `
        <article class="admin-custom-sticker-row${active ? '' : ' is-inactive'}" data-admin-sticker-row="${escapeHtml(sticker.key)}">
          <img src="${escapeHtml(sticker.src)}" alt="${escapeHtml(sticker.label)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
          <div class="admin-custom-sticker-copy">
            <strong>${escapeHtml(sticker.label)}</strong>
            <code>[sticker:${escapeHtml(sticker.key)}]</code>
            <a href="${escapeHtml(sticker.src)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sticker.src)}</a>
          </div>
          <span class="admin-custom-sticker-status">${active ? 'Đang hiện' : 'Đã ẩn'}</span>
          <button class="${active ? 'danger-button' : 'ghost-button'}" data-admin-sticker-toggle data-next-active="${active ? 'false' : 'true'}" type="button">
            ${active ? 'Ẩn khỏi bộ chọn' : 'Hiện lại'}
          </button>
        </article>
      `;
    })
    .join('');

  return `
    <div class="admin-custom-stickers">
      <section class="admin-board-create">
        <h2>Sticker tùy chỉnh</h2>
        <p class="muted">Thêm ảnh Imgur đơn lẻ bằng liên kết dạng <code>https://imgur.com/ID</code> hoặc <code>https://i.imgur.com/ID.png</code>.</p>
        <div class="admin-custom-sticker-form" data-admin-sticker-add-form>
          <label><span>Tên sticker (không bắt buộc)</span><input data-admin-sticker-label maxlength="80" placeholder="Ví dụ: Mèo vui" /></label>
          <label><span>Liên kết Imgur</span><input data-admin-sticker-url maxlength="500" placeholder="https://imgur.com/ID" inputmode="url" /></label>
          <button class="primary-button" data-admin-sticker-add type="button">Thêm sticker</button>
        </div>
        <p class="muted">Ẩn sticker chỉ gỡ nó khỏi bộ chọn; bài cũ vẫn tiếp tục hiển thị.</p>
      </section>
      <section class="admin-custom-sticker-list" aria-label="Danh sách sticker tùy chỉnh">
        ${rows || '<p class="muted">Chưa có sticker tùy chỉnh.</p>'}
      </section>
    </div>
  `;
}
