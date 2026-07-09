export type AccountPreferencesSummaryIslandProps = {
  themeLabel: string;
  homeBoardLabel: string;
  syncDrafts: boolean;
  compactThreads: boolean;
  hideThumbnails: boolean;
  watchedUnreadOnly: boolean;
  watchedSortLabel: string;
  emailNotifications: boolean;
  notifyWatchedThreads: boolean;
  notifyBoardSubscriptions: boolean;
  browserNotifyWatchedThreads: boolean;
};

function yesNo(value: boolean): string {
  return value ? 'Bật' : 'Tắt';
}

/**
 * Read-only summary of account display/notification preferences.
 * Form controls remain vanilla; this island only mirrors current values.
 */
export function AccountPreferencesSummaryIsland(props: AccountPreferencesSummaryIslandProps) {
  const {
    themeLabel,
    homeBoardLabel,
    syncDrafts,
    compactThreads,
    hideThumbnails,
    watchedUnreadOnly,
    watchedSortLabel,
    emailNotifications,
    notifyWatchedThreads,
    notifyBoardSubscriptions,
    browserNotifyWatchedThreads
  } = props;

  return (
    <div
      className="account-preferences-summary login-panel stack"
      data-react-island-ready="true"
      role="region"
      aria-label="Tóm tắt cài đặt"
    >
      <h2 className="account-summary-title">Tóm tắt cài đặt</h2>
      <dl className="account-summary-list">
        <div className="account-summary-row">
          <dt>Giao diện</dt>
          <dd>{themeLabel}</dd>
        </div>
        <div className="account-summary-row">
          <dt>Bảng nhà</dt>
          <dd>{homeBoardLabel}</dd>
        </div>
        <div className="account-summary-row">
          <dt>Đồng bộ</dt>
          <dd>Bản nháp riêng tư: {yesNo(syncDrafts)}</dd>
        </div>
        <div className="account-summary-row">
          <dt>Hiển thị</dt>
          <dd>
            Chế độ gọn: {yesNo(compactThreads)}; Ẩn thumbnail: {yesNo(hideThumbnails)};
            Watchlist chỉ chưa đọc: {yesNo(watchedUnreadOnly)}
          </dd>
        </div>
        <div className="account-summary-row">
          <dt>Sắp xếp watchlist</dt>
          <dd>{watchedSortLabel}</dd>
        </div>
        <div className="account-summary-row">
          <dt>Thông báo</dt>
          <dd>
            Thông báo email: {yesNo(emailNotifications)}; Thread đang theo dõi:{' '}
            {yesNo(notifyWatchedThreads)}; Bảng đang theo dõi: {yesNo(notifyBoardSubscriptions)};
            Trình duyệt: thread đang theo dõi: {yesNo(browserNotifyWatchedThreads)}
          </dd>
        </div>
      </dl>
      <p className="account-note muted">
        Biểu mẫu bên dưới vẫn là nguồn ghi cài đặt. Tóm tắt này chỉ hiển thị trạng thái hiện tại.
      </p>
    </div>
  );
}
