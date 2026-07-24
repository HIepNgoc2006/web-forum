type UploadStorageName = 'local' | 's3';

type ForumPostLike = {
  image?: unknown;
  images?: unknown;
};

type ForumStateLike = {
  threads?: unknown;
  comments?: unknown;
  dmMessages?: unknown;
};

type UploadMediaLike = {
  storage?: unknown;
  storageKey?: unknown;
  thumbnail?: unknown;
};

type UploadCleanupStorage = {
  type?: string;
  listKeys: () => Promise<unknown[]>;
  deleteKey: (storageKey: string) => Promise<unknown>;
  getLastModified?: (storageKey: string) => Promise<unknown>;
};

type UploadCleanupCandidate = {
  storageKey: string;
};

type UploadCleanupFailure = UploadCleanupCandidate & {
  error: string;
};

type UploadCleanupSkipped = UploadCleanupCandidate & {
  reason: 'referenced-on-recheck' | 'minimum-age' | 'age-unavailable';
};

type UploadCleanupResult = {
  dryRun: boolean;
  storageType: string;
  startedAt: string;
  finishedAt: string | null;
  scanned: number;
  referenced: number;
  candidates: UploadCleanupCandidate[];
  deleted: UploadCleanupCandidate[];
  skipped: UploadCleanupSkipped[];
  failures: UploadCleanupFailure[];
};

type UploadCleanupLogger = (entry: Record<string, unknown>) => unknown;

type CollectReferencedOptions = {
  storage?: UploadStorageName;
};

type CleanupOrphanUploadsOptions = {
  state?: ForumStateLike;
  imageStorage?: UploadCleanupStorage;
  dryRun?: boolean;
  logger?: UploadCleanupLogger;
  now?: () => Date;
  minimumAgeMs?: number;
  readState?: () => Promise<ForumStateLike>;
  withMutationLock?: <T>(callback: () => Promise<T>) => Promise<T>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function mediaItems(post: ForumPostLike): unknown[] {
  if (Array.isArray(post?.images)) {
    return post.images.filter(Boolean);
  }
  return post?.image ? [post.image] : [];
}

function normalizeStorageKey(value: unknown): string {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\/+/g, '');
}

function addReferencedKey(keys: Set<string>, media: unknown, storage?: UploadStorageName): void {
  if (!isRecord(media)) {
    return;
  }
  const uploadMedia = media as UploadMediaLike;
  if (storage && uploadMedia.storage !== storage) {
    return;
  }

  const key = normalizeStorageKey(uploadMedia.storageKey);
  if (key) {
    keys.add(key);
  }

  if (isRecord(uploadMedia.thumbnail)) {
    addReferencedKey(keys, uploadMedia.thumbnail, storage);
  }
}

export function collectReferencedUploadKeys(state: ForumStateLike = {}, { storage }: CollectReferencedOptions = {}): Set<string> {
  const keys = new Set<string>();
  for (const collection of [state.threads, state.comments, state.dmMessages]) {
    if (!Array.isArray(collection)) {
      continue;
    }
    for (const post of collection) {
      for (const media of mediaItems(post)) {
        addReferencedKey(keys, media, storage);
      }
    }
  }
  return keys;
}

export async function cleanupOrphanUploads({
  state,
  imageStorage,
  dryRun = true,
  logger = () => undefined,
  now = () => new Date(),
  minimumAgeMs = 0,
  readState,
  withMutationLock
}: CleanupOrphanUploadsOptions = {}): Promise<UploadCleanupResult> {
  if (!state || typeof state !== 'object') {
    throw new Error('Forum state is required');
  }
  if (!imageStorage || typeof imageStorage.listKeys !== 'function' || typeof imageStorage.deleteKey !== 'function') {
    throw new Error('Image storage must provide listKeys and deleteKey');
  }

  const storageName = imageStorage.type === 's3-compatible' ? 's3' : 'local';
  const startedAt = now().toISOString();
  const referencedKeys = collectReferencedUploadKeys(state, { storage: storageName });
  const listedKeys = (await imageStorage.listKeys()).map(normalizeStorageKey).filter(Boolean);
  const candidates = listedKeys
    .filter((key) => !referencedKeys.has(key))
    .sort()
    .map((storageKey) => ({ storageKey }));
  const result: UploadCleanupResult = {
    dryRun: Boolean(dryRun),
    storageType: imageStorage.type ?? 'unknown',
    startedAt,
    finishedAt: null,
    scanned: listedKeys.length,
    referenced: referencedKeys.size,
    candidates,
    deleted: [],
    skipped: [],
    failures: []
  };

  logger({ event: 'upload_cleanup_started', dryRun: result.dryRun, storageType: result.storageType });

  if (dryRun) {
    for (const candidate of candidates) {
      logger({ event: 'upload_cleanup_candidate', storageKey: candidate.storageKey });
    }
  } else {
    const sweep = async () => {
      const authoritativeState = readState ? await readState() : state;
      const currentReferences = collectReferencedUploadKeys(authoritativeState, { storage: storageName });
      const checkedAt = now().getTime();
      const safeMinimumAgeMs = Math.max(0, Number(minimumAgeMs) || 0);
      for (const candidate of candidates) {
        if (currentReferences.has(candidate.storageKey)) {
          const skipped = { ...candidate, reason: 'referenced-on-recheck' as const };
          result.skipped.push(skipped);
          logger({ event: 'upload_cleanup_skipped', ...skipped });
          continue;
        }
        if (safeMinimumAgeMs > 0) {
          const rawLastModified = await imageStorage.getLastModified?.(candidate.storageKey);
          const lastModified = rawLastModified instanceof Date
            ? rawLastModified.getTime()
            : new Date(String(rawLastModified || '')).getTime();
          if (!Number.isFinite(lastModified)) {
            const skipped = { ...candidate, reason: 'age-unavailable' as const };
            result.skipped.push(skipped);
            logger({ event: 'upload_cleanup_skipped', ...skipped });
            continue;
          }
          if (checkedAt - lastModified < safeMinimumAgeMs) {
            const skipped = { ...candidate, reason: 'minimum-age' as const };
            result.skipped.push(skipped);
            logger({ event: 'upload_cleanup_skipped', ...skipped });
            continue;
          }
        }

        try {
          await imageStorage.deleteKey(candidate.storageKey);
          result.deleted.push(candidate);
          logger({ event: 'upload_cleanup_deleted', storageKey: candidate.storageKey });
        } catch (error) {
          const failure = {
            storageKey: candidate.storageKey,
            error: error instanceof Error ? error.message : String(error)
          };
          result.failures.push(failure);
          logger({ event: 'upload_cleanup_failed', ...failure });
        }
      }
    };
    if (withMutationLock) {
      await withMutationLock(sweep);
    } else {
      await sweep();
    }
  }

  result.finishedAt = now().toISOString();
  logger({
    event: 'upload_cleanup_finished',
    dryRun: result.dryRun,
    storageType: result.storageType,
    scanned: result.scanned,
    candidates: result.candidates.length,
    deleted: result.deleted.length,
    skipped: result.skipped.length,
    failures: result.failures.length
  });
  return result;
}
