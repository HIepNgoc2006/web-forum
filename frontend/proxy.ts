import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { contentSecurityPolicy } from '@/lib/security-headers';

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    '/((?!api|socket\\.io|events|uploads|feeds|_next/static|_next/image|favicon\\.svg).*)',
  ],
};
