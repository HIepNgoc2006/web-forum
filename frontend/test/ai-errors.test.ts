import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_ERROR_MESSAGE, publicAiErrorMessage } from '../legacy/ai-errors.ts';

test('hides AI provider and configuration error details from users', () => {
  assert.equal(AI_ERROR_MESSAGE, 'AI đang gặp lỗi. Vui lòng thử lại sau.');
  assert.equal(publicAiErrorMessage(new Error('GOOGLE_AI_API_KEY is missing')), AI_ERROR_MESSAGE);
  assert.equal(publicAiErrorMessage({ statusCode: 429, message: 'provider quota exceeded' }), AI_ERROR_MESSAGE);
  assert.equal(publicAiErrorMessage('network failure'), AI_ERROR_MESSAGE);
});
