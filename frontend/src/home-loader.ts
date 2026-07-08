import type { AnyRecord } from './types';
import { popularThreadsFrom } from './board';

type HomeLoadDependencies = {
  setScreen: (name: string) => void;
  state: {
    watchedThreadSummaries?: AnyRecord[];
  };
  homeController: {
    loadHomeThreadsByBoard: () => Promise<AnyRecord>;
    renderBoards: () => void;
    renderPopularThreads: (threads: AnyRecord[]) => void;
    renderLatestPosts: (posts: AnyRecord[]) => void;
  };
  renderHomeBoards: (threadsByBoard?: AnyRecord, stats?: AnyRecord) => void;
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
    loadHome
  };

  async function loadHome() {
    setScreen('home');
    homeController.renderBoards();
    renderHomeBoards();
    renderMyPosts();
    renderSubscribedBoards();
    const [threadsByBoard, latestPosts, watchedThreads, hotBoards, campusPulse, stats] = await Promise.all([
      homeController.loadHomeThreadsByBoard(),
      api('/api/posts/latest?limit=10'),
      watchlistController.loadWatchedThreadSummaries(),
      api('/api/boards/hot?limit=8'),
      api('/api/pulse?limit=12'),
      api('/api/stats')
    ]);
    renderHomeBoards(threadsByBoard, stats);
    homeController.renderPopularThreads(popularThreadsFrom(threadsByBoard));
    homeController.renderLatestPosts(latestPosts);
    state.watchedThreadSummaries = watchedThreads;
    watchlistController.renderWatchedThreads();
    renderMyPosts();
    renderSubscribedBoards();
    renderHotBoards(hotBoards);
    renderCampusPulse(campusPulse);
    renderStats(stats);
  }
}

