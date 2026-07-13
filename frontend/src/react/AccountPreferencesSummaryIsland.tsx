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
      className="account-preferences-summary login-panel account-settings-panel stack"
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
          <dd>{yesNo(syncDrafts)} bản nháp riêng tư</dd>
        </div>
        <div className="account-summary-row">
          <dt>Hiển thị</dt>
          <dd className="account-summary-chips">
            <span className="account-summary-chip">Gọn: {yesNo(compactThreads)}</span>
            <span className="account-summary-chip">Thumbnail: {yesNo(!hideThumbnails)}</span>
            <span className="account-summary-chip">Watch unread: {yesNo(watchedUnreadOnly)}</span>
          </dd>
        </div>
        <div className="account-summary-row">
          <dt>Sắp xếp watchlist</dt>
          <dd>{watchedSortLabel}</dd>
        </div>
        <div className="account-summary-row">
          <dt>Thông báo</dt>
          <dd className="account-summary-chips">
            <span className="account-summary-chip">Email: {yesNo(emailNotifications)}</span>
            <span className="account-summary-chip">Thread: {yesNo(notifyWatchedThreads)}</span>
            <span className="account-summary-chip">Bảng: {yesNo(notifyBoardSubscriptions)}</span>
            <span className="account-summary-chip">Trình duyệt: {yesNo(browserNotifyWatchedThreads)}</span>
          </dd>
        </div>
      </dl>
      <p className="account-note muted">
        Biểu mẫu bên dưới vẫn là nguồn ghi cài đặt. Tóm tắt này chỉ hiển thị trạng thái hiện tại.
      </p>
    </div>
  );
}
