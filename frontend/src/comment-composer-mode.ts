export type CommentComposerMode = 'floating' | 'normal';

export function normalizeCommentComposerMode(value: unknown): CommentComposerMode {
  return value === 'normal' ? 'normal' : 'floating';
}
