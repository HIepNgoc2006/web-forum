function mediaItems(post) {
  if (Array.isArray(post?.images)) {
    return post.images.filter(Boolean);
  }
  return post?.image ? [post.image] : [];
}

function normalizeStorageKey(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\/+/g, '');
}

function addReferencedKey(keys, media, storage) {
  if (!media || typeof media !== 'object') {
    return;
  }
  if (storage && media.storage !== storage) {
    return;
  }

  const key = normalizeStorageKey(media.storageKey);
  if (key) {
    keys.add(key);
  }

  if (media.thumbnail && typeof media.thumbnail === 'object') {
    addReferencedKey(keys, media.thumbnail, storage);
  }
}

export function collectReferencedUploadKeys(state = {}, { storage } = {}) {
  const keys = new Set();
  for (const collection of [state.threads, state.comments]) {
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
  now = () => new Date()
} = {}) {
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
  const result = {
    dryRun: Boolean(dryRun),
    storageType: imageStorage.type ?? 'unknown',
    startedAt,
    finishedAt: null,
    scanned: listedKeys.length,
    referenced: referencedKeys.size,
    candidates,
    deleted: [],
    failures: []
  };

  logger({ event: 'upload_cleanup_started', dryRun: result.dryRun, storageType: result.storageType });

  for (const candidate of candidates) {
    if (dryRun) {
      logger({ event: 'upload_cleanup_candidate', storageKey: candidate.storageKey });
      continue;
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

  result.finishedAt = now().toISOString();
  logger({
    event: 'upload_cleanup_finished',
    dryRun: result.dryRun,
    storageType: result.storageType,
    scanned: result.scanned,
    candidates: result.candidates.length,
    deleted: result.deleted.length,
    failures: result.failures.length
  });
  return result;
}
