import type { AnyRecord } from './types';
import { popularThreadsFrom } from './board';
import { applyHomeSnapshotState } from './home-snapshot';

type HomeLoadDependencies = {
  setScreen: (name: string) => void;
  state: {
    boards?: AnyRecord[];
    initialHomeSnapshot?: AnyRecord | null;
    watchedThreadSummaries?: AnyRecord[];
  };
  homeController: {
    loadHomeThreadsByBoard: () => Promise<AnyRecord>;
    renderBoards: () => void;
    renderPopularThreads: (threads: AnyRecord[]) => void;
    renderLatestPosts: (posts: AnyRecord[]) => void;
  };
  renderHomeBoards: (threadsByBoard?: AnyRecord, stats?: AnyRecord, boardPostCounts?: AnyRecord) => void;
  renderMyPosts: () => void;
  renderSubscribedBoards: () => void;
  renderHotBoards: (boards: AnyRecord[]) => void;
  renderCampusPulse: (items: AnyRecord[]) => void;
  renderStats: (stats: AnyRecord) => void;
  api: (url: string) => Promise<any>;
  watchlistController: {
    loadWatchedThreadSummaries: () => Promise<AnyRecord[]>;
    renderWatchedThreads: () => void;
  };
};

export function createHomeLoadController({
  setScreen,
  state,
  homeController,
  renderHomeBoards,
  renderMyPosts,
  renderSubscribedBoards,
  renderHotBoards,
  renderCampusPulse,
  renderStats,
  api,
  watchlistController
}: HomeLoadDependencies) {
  return {
    loadHome,
    refreshHomePersonalData
  };

  function renderHomeSnapshot(snapshot: AnyRecord) {
    applyHomeSnapshotState(state, snapshot);
    homeController.renderBoards();
    const threadsByBoard = snapshot.threadsByBoard || {};
    renderHomeBoards(threadsByBoard, snapshot.stats || {}, snapshot.boardPostCounts || {});
    homeController.renderPopularThreads(snapshot.popularThreads || popularThreadsFrom(threadsByBoard));
    homeController.renderLatestPosts(snapshot.latestPosts || []);
    renderHotBoards(snapshot.hotBoards || []);
    renderCampusPulse(snapshot.campusPulse || []);
    renderStats(snapshot.stats || {});
  }

  async function loadHomeSnapshot() {
    try {
      return await api('/api/home');
    } catch {
      const [threadsByBoard, latestPosts, hotBoards, campusPulse, stats] = await Promise.all([
        homeController.loadHomeThreadsByBoard(),
        api('/api/posts/latest?limit=10'),
        api('/api/boards/hot?limit=8'),
        api('/api/pulse?limit=12'),
        api('/api/stats')
      ]);
      return {
        boards: state.boards || [],
        threadsByBoard,
        popularThreads: popularThreadsFrom(threadsByBoard),
        latestPosts,
        hotBoards,
        campusPulse,
        stats
      };
    }
  }

  async function refreshHomePersonalData() {
    try {
      state.watchedThreadSummaries = await watchlistController.loadWatchedThreadSummaries();
    } catch {
      state.watchedThreadSummaries = [];
    }
    watchlistController.renderWatchedThreads();
    renderMyPosts();
    renderSubscribedBoards();
  }

  async function loadHome() {
    setScreen('home');
    const initialSnapshot = state.initialHomeSnapshot || null;
    state.initialHomeSnapshot = null;
    if (initialSnapshot) {
      renderHomeSnapshot(initialSnapshot);
    } else {
      if (state.boards?.length) {
        homeController.renderBoards();
        renderHomeBoards();
      }
      renderHomeSnapshot(await loadHomeSnapshot());
    }
    renderMyPosts();
    renderSubscribedBoards();
    watchlistController.renderWatchedThreads();
    await refreshHomePersonalData();
  }
}

