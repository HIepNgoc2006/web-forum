import { formatBytes, moderationConfidenceText } from '../format';

export type AdminHealthIslandProps = {
  health: {
    status?: string;
    checkedAt?: string;
    store?: {
      type?: string;
      ready?: boolean;
      threads?: number;
      comments?: number;
      users?: number;
      reports?: number;
      sanctions?: number;
      moderationActions?: number;
      nextGlobalNumber?: number;
    };
    ai?: {
      provider?: string;
      configured?: boolean;
      model?: string;
      moderationConfidenceThreshold?: number;
    };
    imageStorage?: {
      type?: string;
      ready?: boolean;
      error?: string;
    };
    realtime?: {
      clients?: number;
      boards?: Record<string, number>;
    };
    captcha?: {
      provider?: string;
      configured?: boolean;
    };
    security?: {
      adminConfigured?: boolean;
      warnings?: string[];
    };
    process?: {
      nodeVersion?: string;
      platform?: string;
      arch?: string;
      pid?: number;
      uptimeSeconds?: number;
      memory?: {
        rss?: number;
        heapUsed?: number;
        heapTotal?: number;
        external?: number;
      };
    };
  };
};

function formatUptime(seconds: number | undefined): string {
  const safe = Number(seconds) || 0;
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

function StatusBadge({ ready, label }: { ready?: boolean; label: string }) {
  const color = ready ? '#2b8a3e' : '#c92a2a';
  const icon = ready ? '✔' : '✘';
  return (
    <span style={{ color, fontWeight: 'bold' }}>
      {icon} {label}
    </span>
  );
}

function EmptyRows() {
  return (
    <tr>
      <td colSpan={2} className="muted">
        Không có dữ liệu
      </td>
    </tr>
  );
}

/**
 * Admin health dashboard React island.
 * Presentational only: data is fetched by the vanilla admin loader.
 */
export function AdminHealthIsland({ health }: AdminHealthIslandProps) {
  const overallOk = health.status === 'ok';
  const overallColor = overallOk ? '#2b8a3e' : '#c92a2a';
  const overallIcon = overallOk ? '✔' : '⚠';
  const checkedAt = health.checkedAt
    ? new Date(health.checkedAt).toLocaleString('vi-VN')
    : '—';

  const store = health.store;
  const ai = health.ai;
  const imageStorage = health.imageStorage;
  const realtime = health.realtime;
  const captcha = health.captcha;
  const security = health.security;
  const processInfo = health.process;
  const warnings = security?.warnings?.length
    ? security.warnings
    : null;

  return (
    <div className="health-dashboard" data-react-island-ready="true">
      <div className="health-header">
        <span style={{ color: overallColor, fontSize: '1.2em', fontWeight: 'bold' }}>
          {overallIcon}{' '}
          {overallOk ? 'Hệ thống hoạt động bình thường' : 'Hệ thống đang gặp sự cố'}
        </span>
        <span className="muted" style={{ marginLeft: 12 }}>
          Kiểm tra lúc {checkedAt}
        </span>
      </div>
      <div className="health-grid">
        <div className="health-card">
          <h3>Cơ sở dữ liệu</h3>
          <table className="health-table">
            <tbody>
              {store ? (
                <>
                  <tr>
                    <td>Loại</td>
                    <td>
                      <strong>{store.type || 'unknown'}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Trạng thái</td>
                    <td>
                      <StatusBadge
                        ready={store.ready}
                        label={store.ready ? 'Sẵn sàng' : 'Không sẵn sàng'}
                      />
                    </td>
                  </tr>
                  {store.threads !== undefined ? (
                    <tr>
                      <td>Chủ đề</td>
                      <td>{store.threads}</td>
                    </tr>
                  ) : null}
                  {store.comments !== undefined ? (
                    <tr>
                      <td>Bình luận</td>
                      <td>{store.comments}</td>
                    </tr>
                  ) : null}
                  {store.users !== undefined ? (
                    <tr>
                      <td>Tài khoản</td>
                      <td>{store.users}</td>
                    </tr>
                  ) : null}
                  {store.reports !== undefined ? (
                    <tr>
                      <td>Báo cáo</td>
                      <td>{store.reports}</td>
                    </tr>
                  ) : null}
                  {store.sanctions !== undefined ? (
                    <tr>
                      <td>Lệnh chế tài</td>
                      <td>{store.sanctions}</td>
                    </tr>
                  ) : null}
                  {store.moderationActions !== undefined ? (
                    <tr>
                      <td>Kiểm duyệt</td>
                      <td>{store.moderationActions}</td>
                    </tr>
                  ) : null}
                  {store.nextGlobalNumber !== undefined ? (
                    <tr>
                      <td>Số bài kế tiếp</td>
                      <td>#{store.nextGlobalNumber}</td>
                    </tr>
                  ) : null}
                </>
              ) : (
                <EmptyRows />
              )}
            </tbody>
          </table>
        </div>

        <div className="health-card">
          <h3>AI kiểm duyệt</h3>
          <table className="health-table">
            <tbody>
              {ai ? (
                <>
                  <tr>
                    <td>Provider</td>
                    <td>
                      <strong>{ai.provider || 'unknown'}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Trạng thái</td>
                    <td>
                      <StatusBadge
                        ready={ai.configured}
                        label={ai.configured ? 'Đã cấu hình' : 'Chưa cấu hình'}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Model</td>
                    <td>{ai.model || 'unknown'}</td>
                  </tr>
                  <tr>
                    <td>Ngưỡng hàng đợi</td>
                    <td>{moderationConfidenceText(ai.moderationConfidenceThreshold)}</td>
                  </tr>
                </>
              ) : (
                <EmptyRows />
              )}
            </tbody>
          </table>
        </div>

        <div className="health-card">
          <h3>Lưu trữ ảnh</h3>
          <table className="health-table">
            <tbody>
              {imageStorage ? (
                <>
                  <tr>
                    <td>Loại</td>
                    <td>
                      <strong>{imageStorage.type || 'unknown'}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Trạng thái</td>
                    <td>
                      <StatusBadge
                        ready={imageStorage.ready}
                        label={imageStorage.ready ? 'Sẵn sàng' : 'Không sẵn sàng'}
                      />
                    </td>
                  </tr>
                  {imageStorage.error ? (
                    <tr>
                      <td>Lỗi</td>
                      <td style={{ color: '#c92a2a' }}>{imageStorage.error}</td>
                    </tr>
                  ) : null}
                </>
              ) : (
                <EmptyRows />
              )}
            </tbody>
          </table>
        </div>

        <div className="health-card">
          <h3>Kết nối thời gian thực</h3>
          <table className="health-table">
            <tbody>
              {realtime ? (
                <>
                  <tr>
                    <td>SSE clients</td>
                    <td>
                      <strong>{realtime.clients ?? 0}</strong>
                    </td>
                  </tr>
                  {realtime.boards
                    ? Object.entries(realtime.boards).map(([slug, count]) => (
                        <tr key={slug}>
                          <td style={{ paddingLeft: 20 }}>/{slug}/</td>
                          <td>{count}</td>
                        </tr>
                      ))
                    : null}
                </>
              ) : (
                <EmptyRows />
              )}
            </tbody>
          </table>
        </div>

        {captcha ? (
          <div className="health-card">
            <h3>Captcha</h3>
            <table className="health-table">
              <tbody>
                <tr>
                  <td>Provider</td>
                  <td>
                    <strong>{captcha.provider || 'unknown'}</strong>
                  </td>
                </tr>
                <tr>
                  <td>Trạng thái</td>
                  <td>
                    <StatusBadge
                      ready={captcha.configured}
                      label={captcha.configured ? 'Đã cấu hình' : 'Chưa cấu hình'}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="health-card">
          <h3>Bảo mật</h3>
          <table className="health-table">
            <tbody>
              <tr>
                <td>Admin auth</td>
                <td>
                  <StatusBadge
                    ready={security?.adminConfigured}
                    label={security?.adminConfigured ? 'Đã cấu hình' : 'Chưa cấu hình'}
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <h4>Cảnh báo</h4>
          <ul className="health-warnings">
            {warnings ? (
              warnings.map((warning) => (
                <li key={warning} style={{ color: '#c92a2a' }}>
                  {warning.replace(/_/g, ' ')}
                </li>
              ))
            ) : (
              <li style={{ color: '#2b8a3e' }}>Không có cảnh báo</li>
            )}
          </ul>
        </div>

        {processInfo ? (
          <div className="health-card">
            <h3>Tiến trình</h3>
            <table className="health-table">
              <tbody>
                <tr>
                  <td>Node.js</td>
                  <td>
                    <strong>{processInfo.nodeVersion}</strong>
                  </td>
                </tr>
                <tr>
                  <td>Platform</td>
                  <td>
                    {processInfo.platform} / {processInfo.arch}
                  </td>
                </tr>
                <tr>
                  <td>PID</td>
                  <td>{processInfo.pid}</td>
                </tr>
                <tr>
                  <td>Uptime</td>
                  <td>
                    <strong>{formatUptime(processInfo.uptimeSeconds)}</strong>
                  </td>
                </tr>
                <tr>
                  <td>RSS</td>
                  <td>{formatBytes(processInfo.memory?.rss)}</td>
                </tr>
                <tr>
                  <td>Heap used</td>
                  <td>
                    {formatBytes(processInfo.memory?.heapUsed)} /{' '}
                    {formatBytes(processInfo.memory?.heapTotal)}
                  </td>
                </tr>
                <tr>
                  <td>External</td>
                  <td>{formatBytes(processInfo.memory?.external)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
