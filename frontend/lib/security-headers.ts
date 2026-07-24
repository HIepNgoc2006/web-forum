export function contentSecurityPolicy(nonce: string, development = false): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    throw new Error('Invalid CSP nonce');
  }
  const scriptSources = [
    "'self'",
    "'nonce-" + nonce + "'",
    "'strict-dynamic'",
    development ? "'unsafe-eval'" : '',
    'https://hcaptcha.com',
    'https://*.hcaptcha.com',
  ].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    'script-src ' + scriptSources,
    "style-src 'self' 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss: https://hcaptcha.com https://*.hcaptcha.com",
    'frame-src https://hcaptcha.com https://*.hcaptcha.com https://www.youtube.com https://player.vimeo.com',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}
