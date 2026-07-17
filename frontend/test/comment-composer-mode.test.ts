import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCommentComposerMode } from '../src/comment-composer-mode.ts';

test('comment composer mode accepts the normal mode', () => {
  assert.equal(normalizeCommentComposerMode('normal'), 'normal');
});

test('comment composer mode defaults legacy and invalid values to floating', () => {
  assert.equal(normalizeCommentComposerMode(undefined), 'floating');
  assert.equal(normalizeCommentComposerMode(''), 'floating');
  assert.equal(normalizeCommentComposerMode('side-panel'), 'floating');
});
