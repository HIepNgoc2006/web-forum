import { escapeHtml } from './format';
import { postMediaCount } from './thread';
import type { AnyRecord } from './types';

export function accountPostEditButtonHtml(post: AnyRecord = {}, { className = 'quote-button', isAccountPost }: AnyRecord = {}): string {
  if (!isAccountPost?.(post) || !post?.globalNumber) {
    return '';
  }
  const encodedBody = encodeURIComponent(post.body || '');
  return `<button class="${className}" data-account-edit-post="${post.globalNumber}" data-account-edit-body="${escapeHtml(encodedBody)}" type="button">[Sửa bài]</button>`;
}

export function selfDeletePostActionsHtml(
  post: AnyRecord = {},
  { className = 'quote-button', canDeletePost }: AnyRecord = {}
): string {
  if (!post?.globalNumber || post.isDeleted) {
    return '';
  }
  if (typeof canDeletePost === 'function' && !canDeletePost(post)) {
    return '';
  }
  const deleteFileButton = postMediaCount(post)
    ? `<button class="${className}" data-self-delete-post="${post.globalNumber}" data-file-only="true" type="button">[Xóa tệp]</button>`
    : '';
  return `${deleteFileButton}<button class="${className}" data-self-delete-post="${post.globalNumber}" type="button">[Xóa bài]</button>`;
}

export function selfEditPostButtonHtml(post: AnyRecord = {}, { className = 'quote-button' }: AnyRecord = {}): string {
  if (!post?.globalNumber || post.isDeleted) {
    return '';
  }
  const encodedBody = encodeURIComponent(post.body || '');
  return `<button class="${className}" data-self-edit-post="${post.globalNumber}" data-self-edit-body="${escapeHtml(encodedBody)}" type="button">[Sửa bài]</button>`;
}