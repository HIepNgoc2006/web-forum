import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createResendEmailClient } from '../src/core/email.ts';

describe('Resend email client', () => {
  it('sends the expected authenticated Resend API payload', async () => {
    const calls: Array<{ input: Parameters<typeof fetch>[0]; init?: Parameters<typeof fetch>[1] }> = [];
    const client = createResendEmailClient({
      apiKey: 're_test_key',
      from: '36chan <noreply@example.com>',
      fetchImpl: async (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify({ id: 'email-123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });

    assert.strictEqual(client.configured, true);
    const result = await client.send({
      to: 'student@example.com',
      subject: 'Xác nhận email',
      text: 'Mã OTP: 123456',
      html: '<p>123456</p>'
    });

    assert.deepStrictEqual(result, { id: 'email-123' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(String(calls[0].input), 'https://api.resend.com/emails');
    assert.strictEqual(new Headers(calls[0].init?.headers).get('authorization'), 'Bearer re_test_key');
    assert.deepStrictEqual(JSON.parse(String(calls[0].init?.body)), {
      from: '36chan <noreply@example.com>',
      to: ['student@example.com'],
      subject: 'Xác nhận email',
      text: 'Mã OTP: 123456',
      html: '<p>123456</p>'
    });
  });

  it('stays disabled without an API key and sender', async () => {
    const client = createResendEmailClient({ apiKey: '', from: '' });
    assert.strictEqual(client.configured, false);
    await assert.rejects(
      () => client.send({ to: 'student@example.com', subject: 'test', text: 'test' }),
      (error: unknown) => typeof error === 'object' && error !== null && (error as { statusCode?: number }).statusCode === 503
    );
  });
});
