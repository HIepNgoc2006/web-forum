import assert from 'node:assert/strict';
import test from 'node:test';

import { appendReplyQuote } from '../src/comment-draft.ts';

test('adding a reply quote preserves the existing draft byte-for-byte', () => {
  const draft = '  indented line\n\nparagraph with trailing spaces  ';
  const result = appendReplyQuote(draft, 123, '  > selected line  ');

  assert.equal(result.changed, true);
  assert.equal(
    result.value,
    draft + '\n>>123\n> selected line\n'
  );
});

test('adding an existing quote leaves the draft and ordering untouched', () => {
  const draft = 'first\n  >>123  \n> selected line\n';
  const result = appendReplyQuote(draft, 123, '> selected line');

  assert.equal(result.changed, false);
  assert.equal(result.value, draft);
});
