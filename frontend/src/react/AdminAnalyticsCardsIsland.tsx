export type AdminAnalyticsCardsIslandProps = {
  moderationQueue?: {
    pendingCount?: number;
    pendingThreads?: number;
    pendingComments?: number;
    oldestPendingAgeMinutes?: number;
    averageResolutionTimeMinutes?: number;
    resolvedCount?: number;
  };
  aiUsageTotal?: number;
};

/**
 * Top-row admin analytics metric cards.
 * Presentational only: tables and board-digest stay in vanilla HTML.
 */
export function AdminAnalyticsCardsIsland({
  moderationQueue = {},
  aiUsageTotal = 0
}: AdminAnalyticsCardsIslandProps) {
  const pendingCount = moderationQueue.pendingCount ?? 0;
  const pendingThreads = moderationQueue.pendingThreads ?? 0;
  const pendingComments = moderationQueue.pendingComments ?? 0;
  const oldestPendingAgeMinutes = moderationQueue.oldestPendingAgeMinutes ?? 0;
  const averageResolutionTimeMinutes = moderationQueue.averageResolutionTimeMinutes ?? 0;
  const resolvedCount = moderationQueue.resolvedCount ?? 0;

  return (
    <div className="analytics-row" data-react-island-ready="true">
      <div className="analytics-card">
        <h4>Hàng đợi kiểm duyệt</h4>
        <div className="analytics-metric">{pendingCount}</div>
        <p className="muted">
          {pendingThreads} chủ đề, {pendingComments} bình luận chưa duyệt
        </p>
      </div>
      <div className="analytics-card">
        <h4>Thời gian chờ lâu nhất</h4>
        <div className="analytics-metric">{oldestPendingAgeMinutes}m</div>
        <p className="muted">Tuổi của bài viết chờ duyệt lâu nhất</p>
      </div>
      <div className="analytics-card">
        <h4>Thời gian giải quyết TB</h4>
        <div className="analytics-metric">{averageResolutionTimeMinutes}m</div>
        <p className="muted">
          Trung bình từ lúc đăng đến khi duyệt/xóa (Tổng: {resolvedCount})
        </p>
      </div>
      <div className="analytics-card">
        <h4>Tổng lượt gọi AI</h4>
        <div className="analytics-metric">{aiUsageTotal}</div>
        <p className="muted">Tóm tắt, gợi ý bình luận và viết lại nháp</p>
      </div>
    </div>
  );
}
