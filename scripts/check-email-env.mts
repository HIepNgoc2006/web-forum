import fs from 'node:fs';

function check(file: string) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const keys: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        continue;
      }
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      const value = trimmed
        .slice(index + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      keys[key] = value;
    }
    const present = (name: string) => Boolean(String(keys[name] || '').trim());
    return {
      exists: true,
      path: file,
      hasResendKey: present('RESEND_API_KEY'),
      hasEmailFrom: present('EMAIL_FROM'),
      hasAppBaseUrl: present('APP_BASE_URL'),
      hasEmailOtpSecret: present('EMAIL_OTP_SECRET'),
      emailFrom: present('EMAIL_FROM') ? String(keys.EMAIL_FROM).slice(0, 80) : null,
      appBaseUrl: keys.APP_BASE_URL || null,
      resendKeyShape: present('RESEND_API_KEY')
        ? `${String(keys.RESEND_API_KEY).startsWith('re_') ? 're_…' : 'unexpected-prefix'} (len ${String(keys.RESEND_API_KEY).length})`
        : null
    };
  } catch (error) {
    return {
      exists: false,
      path: file,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

console.log(
  JSON.stringify(
    {
      root: check('.env'),
      backend: check('backend/.env')
    },
    null,
    2
  )
);
