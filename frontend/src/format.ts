import type { AnyRecord } from './types';
import {
  API_BASE_URL,
  CAPCODE_LABELS,
  COMMENT_SORT_LABELS,
  REALTIME_URL,
  REPORT_CATEGORIES,
  STICKERS,
  privacyRiskRules,
  rumorFrictionRules
} from './constants';

export function reportCategoryLabel(value) {
  return REPORT_CATEGORIES.find((category) => category.value === value)?.label || 'Khác';
}

export function moderationPriorityLabel(priority: AnyRecord = {}) {
  if (priority.level === 'high') {
    return 'Cao';
  }
  if (priority.level === 'medium') {
    return 'Trung bình';
  }
  return 'Thấp';
}

export function moderationPriorityHtml(priority: AnyRecord = {}) {
  const level = ['high', 'medium', 'low'].includes(priority.level) ? priority.level : 'low';
  const score = Number(priority.score || 0);
  const reportCount = Number(priority.reportCount || 0);
  const details = [
    `Ưu tiên ${moderationPriorityLabel({ level })}: ${score}`,
    reportCount > 0 ? `${reportCount} báo cáo` : '',
    priority.hasPiiRisk ? 'PII' : ''
  ].filter(Boolean);
  return `<span class="priority-badge priority-${level}">${escapeHtml(details.join(' · '))}</span>`;
}

export function moderationConfidenceText(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) {
    return 'Không có';
  }
  return `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`;
}

export function moderationConfidenceHtml(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) {
    return '';
  }
  return `<span class="priority-badge priority-confidence">Tin cậy ${moderationConfidenceText(confidence)}</span>`;
}

export function withUrlBase(path, baseUrl) {
  if (!baseUrl || /^[a-z][a-z\d+\-.]*:/i.test(path)) {
    return path;
  }
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${safePath}`;
}

export function realtimeEndpoint(contextKey = '') {
  const url = withUrlBase(REALTIME_URL, API_BASE_URL);
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${contextKey ? `${separator}${contextKey}` : ''}`;
}

export function filterTypeLabel(type = '') {
  if (type === 'poster') return 'Poster ID';
  if (type === 'thread') return 'Thread';
  if (type === 'post') return 'Bài';
  return 'Từ khóa';
}

export function normalizeSearchValue(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function escapeHtml(value: any = '') {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[character];
  });
}

export function scanDraftRisks(text = '') {
  const content = String(text).normalize('NFC');
  const privacyRisks = privacyRiskRules.filter((rule) => rule.pattern.test(content)).map((rule) => rule.label);
  const rumorRisks = rumorFrictionRules.filter((rule) => rule.pattern.test(content)).map((rule) => rule.label);
  return { privacyRisks, rumorRisks, risks: [...privacyRisks, ...rumorRisks] };
}

export function plainPreview(lines, fallback = '') {
  const text = (lines || [])
    .map((line) => line.text)
    .join(' ')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
    .replace(/\[\/?spoiler\]/gi, '')
    .trim();
  return text || fallback;
}

export function threadSubject(thread) {
  return String(thread?.subject || '').trim();
}

export function threadTitle(thread, fallback = 'Chưa có nội dung') {
  return threadSubject(thread) || plainPreview(thread?.bodyLines, fallback);
}

export function threadSubjectHtml(thread) {
  const subject = threadSubject(thread);
  return subject ? `<div class="thread-subject">${escapeHtml(subject)}</div>` : '';
}

export function moderationActionText(action) {
  return (
    {
      'ai:moderate': 'AI kiểm duyệt',
      'admin:approve': 'Quản trị viên duyệt',
      'admin:delete': 'Quản trị viên xóa',
      'admin:note': 'Ghi chú',
      'admin:cooldown': 'Làm chậm',
      'admin:ban': 'Tạm khóa',
      'admin:unsanction': 'Gỡ khóa',
      'admin:sticky': 'Ghim chủ đề',
      'admin:unsticky': 'Gỡ ghim chủ đề',
      'admin:lock': 'Khóa chủ đề',
      'admin:unlock': 'Mở khóa chủ đề'
    }[action] || action
  );
}

export function appealStatusLabel(status = '') {
  if (status === 'open') return 'Đang mở';
  if (status === 'accepted') return 'Đã chấp nhận';
  if (status === 'rejected') return 'Đã từ chối';
  return status || '-';
}

export function formatDateTimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (number) => String(number).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + 'T' + [pad(date.getHours()), pad(date.getMinutes())].join(':');
}

export function adminRoleLabel(role = '') {
  if (role === 'owner') return 'Owner';
  if (role === 'moderator') return 'Moderator';
  if (role === 'viewer') return 'Viewer';
  return role || 'User';
}

// Inline text markup on already-sanitized, ref-linked HTML. Bold is matched
// before italic so the single-asterisk pass does not split `**`. The class
// names emitted by the ref/spoiler passes contain no `*`/`~`, so generated
// markup is never re-matched here.
export function renderInlineMarkup(html) {
  return String(html)
    .replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^\n*]+?)\*/g, '<em>$1</em>')
    .replace(/~~([^\n~]+?)~~/g, '<del>$1</del>');
}

// Inline [spoiler]...[/spoiler] -> click-to-reveal span. Runs after ref
// linkification so refs nested inside a spoiler still work once revealed.
export function renderSpoilerText(html) {
  return String(html).replace(
    /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi,
    (_match, inner) => `<span class="spoiler-text" data-spoiler tabindex="0" title="Bấm để hiện">${inner}</span>`
  );
}

export function renderStickerText(html) {
  return String(html).replace(/\[sticker:([a-z0-9-]+)\]/gi, (match, key) => {
    const sticker = STICKERS[String(key).toLowerCase()];
    if (!sticker) {
      return match;
    }
    return `<span class="post-sticker" role="img" aria-label="${escapeHtml(sticker.label)}">${escapeHtml(sticker.icon)}</span>`;
  });
}

export function formatPostDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${String(date.getFullYear()).slice(-2)}(${days[date.getDay()]})${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatEditedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dataUrlBytes(dataUrl = '') {
  const base64 = String(dataUrl).split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function imageSizeBytes(image: AnyRecord = {}) {
  const sizeBytes = Number(image.sizeBytes);
  if (Number.isFinite(sizeBytes) && sizeBytes > 0) {
    return Math.round(sizeBytes);
  }
  return dataUrlBytes(image.dataUrl);
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${bytes} B`;
}

export function imageInfoText(image: AnyRecord = {}) {
  const size = formatBytes(imageSizeBytes(image));
  const width = Number(image.width);
  const height = Number(image.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return `${size}, ${Math.round(width)}x${Math.round(height)}`;
  }
  return size;
}

export function mediaOriginalSrc(image: AnyRecord = {}) {
  const value = image || {};
  return value.url || value.dataUrl || '';
}

export function mediaThumbnailSrc(image: AnyRecord = {}, options: AnyRecord = {}) {
  const value = image || {};
  const src = value.thumbnail?.url || value.thumbnail?.dataUrl || '';
  return src || (options.fallbackOriginal ? mediaOriginalSrc(value) : '');
}

export function truncateFileName(name, maxLength = 42) {
  const value = String(name || 'tai-len').trim() || 'tai-len';
  if (value.length <= maxLength) {
    return value;
  }
  const extensionMatch = value.match(/(\.[a-z0-9]{1,10})$/i);
  const extension = extensionMatch ? extensionMatch[1] : '';
  const keep = Math.max(10, maxLength - extension.length - 1);
  return `${value.slice(0, keep)}…${extension}`;
}

export function fileTextHtml(image) {
  const rawName = String(image?.name || 'tai-len').trim() || 'tai-len';
  const displayName = escapeHtml(truncateFileName(rawName));
  const fullName = escapeHtml(rawName);
  const src = escapeHtml(mediaOriginalSrc(image));
  const info = escapeHtml(imageInfoText(image));
  return `Tệp: <a class="file-name" href="${src}" target="_blank" rel="noopener noreferrer" title="${fullName}">${displayName}</a> <span class="file-size">(${info})</span>`;
}

export function mediaToggleHtml(image, className = 'post-image') {
  const name = escapeHtml(image?.name || 'tai-len');
  const isVideo = mediaKind(image) === 'video';
  const thumbnailSrc = mediaThumbnailSrc(image, { fallbackOriginal: !isVideo });
  const originalSrc = escapeHtml(mediaOriginalSrc(image));
  const spoiler = Boolean(image?.spoiler);
  const mediaLabel = isVideo ? 'video' : 'ảnh';
  const preview = thumbnailSrc
    ? `<img class="${className}" src="${escapeHtml(thumbnailSrc)}" alt="${name}" data-full-src="${originalSrc}" loading="lazy" decoding="async">`
    : `<span class="${className} placeholder image-lazy-placeholder" data-full-src="${originalSrc}">${isVideo ? 'Video' : 'Có tệp'}</span>`;
  const spoilerLabel = spoiler ? '<span class="spoiler-image-label">Spoiler — bấm để hiện</span>' : '';
  const toggleAttributes = `class="image-toggle" data-image-toggle${spoiler ? ' data-spoiler-image' : ''} data-media-type="${
    isVideo ? 'video' : 'image'
  }" data-full-src="${originalSrc}" data-image-name="${name}" data-image-class="${className}" aria-expanded="false" aria-label="Phóng to ${mediaLabel} ${name}"`;
  const toggleOpen = isVideo ? `<div ${toggleAttributes} role="button" tabindex="0">` : `<button ${toggleAttributes} type="button">`;
  const toggleClose = isVideo ? '</div>' : '</button>';
  return `
    <div class="thread-thumb-wrap${spoiler ? ' spoiler-image' : ''}">
      <div class="file-text">${fileTextHtml(image)}</div>
      ${toggleOpen}
        ${preview}
        ${spoilerLabel}
      ${toggleClose}
    </div>
  `;
}

export function posterId(post) {
  const value = post.posterHash || '????';
  return value.startsWith('ID:') ? value : `ID:${value}`;
}

export function postDisplayName(post) {
  return String(post.displayName || 'Anonymous').trim() || 'Anonymous';
}

export function commentSortHtml(current = 'old') {
  const options = COMMENT_SORT_LABELS.map(
    ([value, label]) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`
  ).join('');
  return `
    <div class="comment-sort">
      <label>sắp xếp theo: <select data-comment-sort aria-label="Sắp xếp bình luận">${options}</select></label>
    </div>
  `;
}

export function capcodeBadgeHtml(post) {
  const label = CAPCODE_LABELS[post?.capcode];
  if (!label) {
    return '';
  }
  return `<span class="capcode capcode-${post.capcode}" title="Chức danh đã xác minh">${label}</span>`;
}

export function moderationLabelText(label) {
  return (
    {
      Toxic: 'Độc hại',
      Spam: 'Nội dung rác',
      'Hate Speech': 'Thù ghét',
      'Fake News': 'Tin giả',
      'PII Risk': 'Rủi ro thông tin cá nhân'
    }[label] || label
  );
}

export function moderationStatusText(status) {
  return (
    {
      Safe: 'An toàn',
      Flagged: 'Bị gắn cờ',
      ApprovedByAdmin: 'Quản trị viên đã duyệt'
    }[status] || status
  );
}

export function timestamp(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function hoursSince(value) {
  const time = timestamp(value);
  if (!time) {
    return 0;
  }
  return Math.max(0, (Date.now() - time) / (60 * 60 * 1000));
}

export function mediaKind(media: AnyRecord = {}) {
  return String(media.type || '').startsWith('video/') ? 'video' : 'image';
}

export function mediaList(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return value ? [value] : [];
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

export function audioExtension(mimeType = '') {
  const type = String(mimeType).toLowerCase();
  if (type.includes('mp4')) {
    return 'm4a';
  }
  if (type.includes('ogg')) {
    return 'ogg';
  }
  if (type.includes('mpeg') || type.includes('mp3')) {
    return 'mp3';
  }
  if (type.includes('wav')) {
    return 'wav';
  }
  return 'webm';
}
