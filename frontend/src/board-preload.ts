import type { AnyRecord } from './types';

type PreloadBoard = {
  slug: string;
};

type PreloadBoardThreadsOptions = {
  api: (url: string) => Promise<unknown>;
  writeBoardThreadsCache: (boardSlug: string, payload: unknown, options?: AnyRecord) => unknown;
  boards?: PreloadBoard[];
  pageSize?: number;
  sort?: string;
  filter?: string;
};

/** Full unpaged thread lists captured during startup preload (used by home). */
const fullBoardThreads = new Map<string, AnyRecord[]>();

/**
 * Prefetch board threads into the client cache so board/home screens can paint
 * immediately instead of showing empty "Đang tải..." states after route().
 */
export async function preloadBoardThreads({
  api,
  writeBoardThreadsCache,
  boards = [],
  pageSize = 15,
  sort = 'bump',
  filter = 'all'
}: PreloadBoardThreadsOptions): Promise<void> {
  if (!boards.length || typeof api !== 'function' || typeof writeBoardThreadsCache !== 'function') {
    return;
  }

  await Promise.all(
    boards.map(async (board) => {
      const slug = String(board?.slug || '').trim();
      if (!slug) {
        return;
      }
      try {
        const payload = await api(`/api/boards/${slug}/threads`);
        if (Array.isArray(payload)) {
          fullBoardThreads.set(slug, payload as AnyRecord[]);
        }
        // Stores page-1 slice under the same cache key loadBoard reads.
        writeBoardThreadsCache(slug, payload, {
          page: 1,
          pageSize: Math.max(1, Number(pageSize) || 15),
          sort: sort || 'bump',
          filter: filter || 'all',
          q: ''
        });
      } catch {
        /* ignore individual board preload failures */
      }
    })
  );
}

export function takePreloadedBoardThreads(boardSlug: string): AnyRecord[] | null {
  const slug = String(boardSlug || '').trim();
  if (!slug || !fullBoardThreads.has(slug)) {
    return null;
  }
  return fullBoardThreads.get(slug) || null;
}

export function clearPreloadedBoardThreads(): void {
  fullBoardThreads.clear();
}

/**
 * Prefer the board the user is about to open (hash route), otherwise their
 * preferred home board / default board slug.
 */
export function resolveStartupBoardSlug({
  hash = typeof window !== 'undefined' ? window.location.hash : '',
  homeBoard = '',
  fallbackSlug = 'confession'
}: {
  hash?: string;
  homeBoard?: string;
  fallbackSlug?: string;
} = {}): string {
  const raw = String(hash || '#home');
  const [hashPath] = raw.split('?');
  const boardMatch = hashPath.match(/^#board\/([^/]+)$/i);
  if (boardMatch?.[1]) {
    return decodeURIComponent(boardMatch[1]);
  }
  const catalogMatch = hashPath.match(/^#(catalog|archive)\/([^/]+)$/i);
  if (catalogMatch?.[2]) {
    return decodeURIComponent(catalogMatch[2]);
  }
  const preferred = String(homeBoard || '').trim();
  if (preferred) {
    return preferred;
  }
  return String(fallbackSlug || 'confession').trim() || 'confession';
}
