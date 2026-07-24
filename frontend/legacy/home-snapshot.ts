import type { AnyRecord } from './types';

const INITIAL_HOME_SNAPSHOT_ID = 'initialHomeSnapshot';

function record(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};
}

export function readEmbeddedHomeSnapshot(): AnyRecord | null {
  const element = document.getElementById(INITIAL_HOME_SNAPSHOT_ID);
  if (!element) {
    return null;
  }
  const raw = element.textContent || '';
  element.remove();
  try {
    const snapshot = JSON.parse(raw);
    return snapshot && typeof snapshot === 'object' && Array.isArray(snapshot.boards) ? snapshot : null;
  } catch {
    return null;
  }
}

export function applyHomeSnapshotState(state: AnyRecord, snapshot: AnyRecord): void {
  const config = record(snapshot.config);
  const boards = Array.isArray(snapshot.boards)
    ? snapshot.boards
    : Array.isArray(config.boards)
      ? config.boards
      : [];
  state.boards = boards;
  state.boardGroups = Array.isArray(config.boardGroups) ? config.boardGroups : [];
  state.lifecycle = record(config.lifecycle).maxActiveThreadsPerBoard
    ? config.lifecycle
    : state.lifecycle;
  state.aiConfigured = Boolean(config.ai?.configured);
  state.moderationConfidenceThreshold = Number(config.ai?.moderationConfidenceThreshold || 0);
  state.hcaptchaSiteKey = String(config.hcaptchaSiteKey || '');
  const maxImageBytes = Number(config.maxImageBytes);
  if (Number.isFinite(maxImageBytes) && maxImageBytes > 0) {
    state.maxImageBytes = maxImageBytes;
  }
}
