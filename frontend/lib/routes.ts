type PathSegment = {
  decoded: string;
  encoded: string;
};

function parsePathSegments(pathname: string): PathSegment[] | null {
  if (typeof pathname !== 'string') {
    return null;
  }

  const path = pathname.trim();
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    return null;
  }

  const rawSegments = path.replace(/^\/+|\/+$/g, '').split('/');
  if (rawSegments.length === 1 && rawSegments[0] === '') {
    return [];
  }
  if (rawSegments.some((segment) => segment === '')) {
    return null;
  }

  try {
    return rawSegments.map((segment) => {
      const decoded = decodeURIComponent(segment);
      return {
        decoded,
        encoded: encodeURIComponent(decoded),
      };
    });
  } catch {
    return null;
  }
}

function querySuffix(search: string): string {
  const raw = String(search || '').replace(/^\?/, '');
  if (!raw) {
    return '';
  }

  const normalized = new URLSearchParams(raw).toString();
  return normalized ? `?${normalized}` : '';
}

/**
 * Convert a clean App Router pathname to the equivalent legacy Vite hash.
 *
 * Board and thread routes retain their query strings because the legacy router
 * consumes board filters/search and thread pagination/focus parameters there.
 */
export function legacyHashForPath(
  pathname: string,
  search = '',
): string | null {
  const segments = parsePathSegments(pathname);
  if (!segments) {
    return null;
  }
  if (segments.length === 0) {
    return '#home';
  }

  const [route, parameter] = segments;
  const routeName = route.decoded.toLowerCase();
  if (segments.length === 1) {
    const staticHashes: Record<string, string> = {
      home: '#home',
      policy: '#policy',
      register: '#register',
      login: '#login',
      forgot: '#forgot',
      account: '#account',
      admin: '#admin',
      messages: '#messages',
    };
    return staticHashes[routeName] ?? null;
  }

  if (segments.length !== 2 || !parameter.decoded) {
    return null;
  }

  if (routeName === 'board' || routeName === 'thread') {
    return `#${routeName}/${parameter.encoded}${querySuffix(search)}`;
  }
  if (routeName === 'catalog' || routeName === 'archive') {
    return `#${routeName}/${parameter.encoded}`;
  }
  if (routeName === 'policy') {
    return `#policy/${parameter.encoded}`;
  }
  if (routeName === 'messages') {
    return `#messages/${parameter.encoded}`;
  }

  return null;
}
