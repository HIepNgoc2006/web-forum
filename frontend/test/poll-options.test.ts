import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePollOptions } from '../src/poll-options.ts';

test('parsePollOptions returns no poll for empty input and ignores blank lines', () => {
  assert.deepEqual(parsePollOptions(''), []);
  assert.deepEqual(parsePollOptions(' \n\t\n '), []);
});

test('parsePollOptions normalizes whitespace without changing user text', () => {
  assert.deepEqual(parsePollOptions('  T\u00ean   m\u1ed9t  \r\n\r\n T\u1ec7p\t hai '), ['T\u00ean m\u1ed9t', 'T\u1ec7p hai']);
  assert.deepEqual(parsePollOptions('M\u1ee5c\u0000m\u1ed9t\nM\u1ee5c\u007fhai'), ['M\u1ee5c m\u1ed9t', 'M\u1ee5c hai']);
});

test('parsePollOptions enforces poll count, length, and uniqueness', () => {
  assert.throws(() => parsePollOptions('Ch\u1ec9 m\u1ed9t'), /\u00edt nh\u1ea5t 2/);
  assert.throws(
    () => parsePollOptions(Array.from({ length: 7 }, (_, index) => 'L\u1ef1a ch\u1ecdn ' + index).join('\n')),
    /t\u1ed1i \u0111a 6/
  );
  assert.throws(() => parsePollOptions('x'.repeat(121) + '\nH\u1ee3p l\u1ec7'), /t\u1ed1i \u0111a 120/);
  assert.throws(() => parsePollOptions('Tr\u00f9ng l\u1eb7p\n  TR\u00d9NG   L\u1eb6P '), /tr\u00f9ng nhau/);
});
