import {
  adminRoleLabel,
  appealStatusLabel,
  escapeHtml,
  formatBytes,
  formatDateTimeLocal,
  formatPostDate,
  moderationActionText,
  moderationConfidenceText,
  moderationLabelText,
  moderationPriorityHtml,
  moderationStatusText,
  posterId,
  reportCategoryLabel
} from './format';

import type { AnyRecord } from './types';

export function adminPostEditButtonHtml(post, { className = 'quote-button' }: AnyRecord = {}) {
  if (!post?.globalNumber) {
    return '';
  }
  const encodedBody = encodeURIComponent(post.body || '');
  return `<button class="${className}" data-admin-edit-post="${post.globalNumber}" data-admin-edit-body="${escapeHtml(encodedBody)}" type="button">[Sửa]</button>`;
}

export function adminPostRestoreButtonHtml(post, { className = 'ghost-button' }: AnyRecord = {}) {
  if (!post?.globalNumber) {
    return '';
  }
  return `<button class="${className}" data-admin-restore-post="${post.globalNumber}" type="button">[Khôi phục]</button>`;
}

export function moderationActionsHtml(actions) {
  if (!actions.length) {
    return '<div class="admin-empty-state" role="status"><p class="admin-empty-title">Chưa có nhật ký</p><p class="muted">Không có hành động kiểm duyệt nào khớp bộ lọc.</p></div>';
  }

  return `
    <table class="moderation-log-table">
      <thead>
        <tr>
          <th>Thời gian</th>
          <th>Hành động</th>
          <th>Bài</th>
          <th>Nhãn</th>
          <th>Tin cậy</th>
          <th>Lý do</th>
          <th>Người xử lý</th>
        </tr>
      </thead>
      <tbody>
        ${actions
          .map(
            (action) => `
              <tr>
                <td>${formatPostDate(action.createdAt)}</td>
                <td>${escapeHtml(moderationActionText(action.action))}</td>
                <td>${escapeHtml(action.boardSlug)} / No.${action.globalNumber}</td>
                <td>${escapeHtml((action.moderationLabels || []).map(moderationLabelText).join(', ') || moderationStatusText(action.moderationStatus))}</td>
                <td>${escapeHtml(moderationConfidenceText(action.moderationConfidence))}</td>
                <td>${escapeHtml(action.reason || '-')}</td>
                <td>${escapeHtml(action.actor || '-')}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

export function reportsHtml(reports) {
  if (!reports.length) {
    return '<div class="admin-empty-state" role="status"><p class="admin-empty-title">Chưa có báo cáo</p><p class="muted">Không có báo cáo nào khớp bộ lọc hiện tại.</p></div>';
  }

  return `
    <table class="moderation-log-table">
      <thead>
        <tr>
          <th>Thời gian</th>
          <th>Bài</th>
          <th>Ưu tiên</th>
          <th>Loại</th>
          <th>Lý do</th>
          <th>Người báo cáo</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${reports
          .map(
            (report) => `
              <tr>
                <td>${formatPostDate(report.createdAt)}</td>
                <td>${escapeHtml(report.boardSlug)} / No.${report.globalNumber}</td>
                <td>${moderationPriorityHtml(report.moderationPriority)}</td>
                <td>${escapeHtml(reportCategoryLabel(report.category))}</td>
                <td>${escapeHtml(report.reason || '-')}</td>
                <td>${escapeHtml(posterId({ posterHash: report.reporterHash }))}</td>
                <td><button class="ghost-button" data-admin-detail="${report.globalNumber}" type="button" aria-expanded="false">Mở</button></td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

export function compactReportsHtml(reports) {
  if (!reports.length) {
    return '<p class="muted">Không có báo cáo.</p>';
  }

  return `
    <div class="admin-report-stack">
      ${reports
        .map(
          (report) => `
            <div class="admin-report-chip">
              <span>${formatPostDate(report.createdAt)}</span>
              <span>${moderationPriorityHtml(report.moderationPriority)}</span>
              <span>${escapeHtml(reportCategoryLabel(report.category))}</span>
              <span>${escapeHtml(report.reason || '-')}</span>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

export function appealsHtml(appeals) {
  if (!appeals.length) {
    return '<div class="admin-empty-state" role="status"><p class="admin-empty-title">Chưa có kháng nghị</p><p class="muted">Không có kháng nghị nào khớp bộ lọc hiện tại.</p></div>';
  }

  return `
    <table class="moderation-log-table">
      <thead>
        <tr>
          <th>Gửi lúc</th>
          <th>Bài</th>
          <th>Trạng thái</th>
          <th>Lý do</th>
          <th>Dấu vết</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${appeals
          .map(
            (appeal) => `
              <tr>
                <td>${formatPostDate(appeal.submittedAt || appeal.createdAt)}</td>
                <td>${escapeHtml(appeal.boardSlug)} / No.${appeal.globalNumber}</td>
                <td>${escapeHtml(appealStatusLabel(appeal.status))}</td>
                <td>${escapeHtml(appeal.reason || '-')}</td>
                <td>${escapeHtml(appeal.reporterHashPreview || '-')}</td>
                <td>
                  <button class="ghost-button" data-admin-detail="${appeal.globalNumber}" type="button">[Chi tiết]</button>
                  ${appeal.status === 'open' ? `
                    <button class="primary-button" data-admin-resolve-appeal="${appeal.id}" data-status="accepted" type="button">Chấp nhận</button>
                    <button class="danger-button" data-admin-resolve-appeal="${appeal.id}" data-status="rejected" type="button">Từ chối</button>
                  ` : ''}
                </td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

export function sanctionsHtml(sanctions) {
  if (!sanctions.length) {
    return '<div class="admin-empty-state" role="status"><p class="admin-empty-title">Chưa có lệnh chế tài</p><p class="muted">Không có lệnh làm chậm/tạm khóa nào khớp bộ lọc.</p></div>';
  }

  return `
    <table class="moderation-log-table">
      <thead>
        <tr>
          <th>Tạo lúc</th>
          <th>Hết hạn</th>
          <th>Loại</th>
          <th>Nguồn</th>
          <th>Dấu vết</th>
          <th>Lý do</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${sanctions
          .map(
            (sanction) => `
              <tr>
                <td>${formatPostDate(sanction.createdAt)}</td>
                <td>${formatPostDate(sanction.expiresAt)}</td>
                <td>${sanction.kind === 'ban' ? 'Tạm khóa' : 'Làm chậm'}</td>
                <td>${escapeHtml(sanction.boardSlug)} / No.${sanction.sourceGlobalNumber}</td>
                <td>${escapeHtml(sanction.fingerprintPreview || '-')}</td>
                <td>${escapeHtml(sanction.reason || '-')}</td>
                <td>${sanction.revokedAt ? 'Đã gỡ' : `<button class="danger-button" data-admin-revoke-sanction="${sanction.id}" type="button">Gỡ</button>`}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

export function historyActionsHtml(actions) {
  return moderationActionsHtml(actions);
}

function analyticsCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : 0;
}

function normalizeAnalyticsBoard(slug, board: AnyRecord = {}, boards = []) {
  const boardMeta = boards.find((item) => item.slug === (board.slug || slug));
  const threads = board.threads || {};
  const comments = board.comments || {};
  return {
    slug: board.slug || slug || '',
    name: board.name || boardMeta?.name || board.slug || slug || 'Board',
    threads: {
      active: analyticsCount(threads.active ?? board.activeThreads),
      pending: analyticsCount(threads.pending ?? board.pendingThreads),
      deleted: analyticsCount(threads.deleted ?? board.deletedThreads)
    },
    comments: {
      active: analyticsCount(comments.active ?? board.activeComments),
      pending: analyticsCount(comments.pending ?? board.pendingComments),
      deleted: analyticsCount(comments.deleted ?? board.deletedComments)
    },
    reportsCount: analyticsCount(board.reportsCount ?? board.totalReports)
  };
}

function analyticsBoardActivityRows(boardActivity, boards = []) {
  if (Array.isArray(boardActivity)) {
    return boardActivity.map((board) => normalizeAnalyticsBoard(board?.slug, board, boards));
  }
  if (boardActivity && typeof boardActivity === 'object') {
    return Object.entries(boardActivity).map(([slug, board]) => normalizeAnalyticsBoard(slug, board, boards));
  }
  return [];
}

export function adminAnalyticsHtml(analytics: AnyRecord = {}, boards = []) {
  const boardRows = analyticsBoardActivityRows(analytics.boardActivity, boards)
    .map((board) => {
      return `
        <tr>
          <td><strong>/${escapeHtml(board.slug)}/</strong> - ${escapeHtml(board.name)}</td>
          <td>${board.threads.active} / ${board.threads.pending} / ${board.threads.deleted}</td>
          <td>${board.comments.active} / ${board.comments.pending} / ${board.comments.deleted}</td>
          <td><span class="analytics-badge">${board.reportsCount}</span></td>
        </tr>
      `;
    })
    .join('');

  const kindList = Object.entries(analytics.aiUsage?.byKind || {})
    .map(([kind, count]) => `<li><strong>${escapeHtml(kind)}:</strong> ${count} yêu cầu</li>`)
    .join('');

  const dailyRows = (analytics.aiUsage?.daily || [])
    .map((day) => `<tr><td>${escapeHtml(day.date)}</td><td>${day.count} yêu cầu</td></tr>`)
    .join('');

  const queue = analytics.moderationQueue || {};
  const metricCardsHtml = `
      <div class="analytics-row">
        <div class="analytics-card">
          <h4>Hàng đợi kiểm duyệt</h4>
          <div class="analytics-metric">${queue.pendingCount}</div>
          <p class="muted">${queue.pendingThreads} chủ đề, ${queue.pendingComments} bình luận chưa duyệt</p>
        </div>
        <div class="analytics-card">
          <h4>Thời gian chờ lâu nhất</h4>
          <div class="analytics-metric">${queue.oldestPendingAgeMinutes}m</div>
          <p class="muted">Tuổi của bài viết chờ duyệt lâu nhất</p>
        </div>
        <div class="analytics-card">
          <h4>Thời gian giải quyết TB</h4>
          <div class="analytics-metric">${queue.averageResolutionTimeMinutes}m</div>
          <p class="muted">Trung bình từ lúc đăng đến khi duyệt/xóa (Tổng: ${queue.resolvedCount || 0})</p>
        </div>
        <div class="analytics-card">
          <h4>Tổng lượt gọi AI</h4>
          <div class="analytics-metric">${analytics.aiUsage?.total || 0}</div>
          <p class="muted">Tóm tắt, gợi ý bình luận và viết lại nháp</p>
        </div>
      </div>`;

  const restHtml = adminAnalyticsRestHtml(analytics, boards, boardRows, kindList, dailyRows);

  return `
    <div class="analytics-dashboard">
      ${metricCardsHtml}
      ${restHtml}
    </div>
  `;
}

/** Tables + digest controls kept in vanilla HTML (event handlers use data-board-digest). */
export function adminAnalyticsRestHtml(
  analytics: AnyRecord = {},
  boards = [],
  boardRows = '',
  kindList = '',
  dailyRows = ''
) {
  if (!boardRows) {
    boardRows = analyticsBoardActivityRows(analytics.boardActivity, boards)
      .map((board) => {
        return `
        <tr>
          <td><strong>/${escapeHtml(board.slug)}/</strong> - ${escapeHtml(board.name)}</td>
          <td>${board.threads.active} / ${board.threads.pending} / ${board.threads.deleted}</td>
          <td>${board.comments.active} / ${board.comments.pending} / ${board.comments.deleted}</td>
          <td><span class="analytics-badge">${board.reportsCount}</span></td>
        </tr>
      `;
      })
      .join('');
  }
  if (!kindList) {
    kindList = Object.entries(analytics.aiUsage?.byKind || {})
      .map(([kind, count]) => `<li><strong>${escapeHtml(kind)}:</strong> ${count} yêu cầu</li>`)
      .join('');
  }
  if (!dailyRows) {
    dailyRows = (analytics.aiUsage?.daily || [])
      .map((day) => `<tr><td>${escapeHtml(day.date)}</td><td>${day.count} yêu cầu</td></tr>`)
      .join('');
  }

  return `
      <div class="analytics-grid">
        <div class="analytics-section">
          <h3>Hoạt động của Bảng tin</h3>
          <table class="analytics-table">
            <thead>
              <tr>
                <th>Bảng</th>
                <th>Chủ đề (Duyệt/Chờ/Xóa)</th>
                <th>Bình luận (Duyệt/Chờ/Xóa)</th>
                <th>Lượt báo cáo</th>
              </tr>
            </thead>
            <tbody>
              ${boardRows}
            </tbody>
          </table>
        </div>

        <div class="analytics-section">
          <h3>Sử dụng AI chi tiết</h3>
          <ul>
            ${kindList}
          </ul>
          <h3>Biểu đồ sử dụng hàng ngày (7 ngày qua)</h3>
          <table class="analytics-table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Số lượt gọi</th>
              </tr>
            </thead>
            <tbody>
              ${dailyRows}
            </tbody>
          </table>
        </div>
      </div>

      <div class="analytics-section">
        <h3>Bản tổng hợp bảng tin (AI)</h3>
        <p class="muted">Quản trị viên kích hoạt thủ công. Chỉ dùng nội dung bài viết công khai; không gửi dữ liệu tài khoản, IP hay token cho AI.</p>
        <button type="button" class="btn" data-board-digest>Tạo bản tổng hợp hôm nay</button>
        <div data-board-digest-result class="reports-summary-box hidden"></div>
      </div>
  `;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

function healthStatusBadge(ready, label) {
  const color = ready ? '#2b8a3e' : '#c92a2a';
  const icon = ready ? '✔' : '✘';
  return `<span style="color:${color}; font-weight:bold;">${icon} ${escapeHtml(label)}</span>`;
}

export function adminHealthHtml(health) {
  const overallColor = health.status === 'ok' ? '#2b8a3e' : '#c92a2a';
  const overallIcon = health.status === 'ok' ? '✔' : '⚠';

  const storeRows = health.store ? `
    <tr><td>Loại</td><td><strong>${escapeHtml(health.store.type || 'unknown')}</strong></td></tr>
    <tr><td>Trạng thái</td><td>${healthStatusBadge(health.store.ready, health.store.ready ? 'Sẵn sàng' : 'Không sẵn sàng')}</td></tr>
    ${health.store.threads !== undefined ? `<tr><td>Chủ đề</td><td>${health.store.threads}</td></tr>` : ''}
    ${health.store.comments !== undefined ? `<tr><td>Bình luận</td><td>${health.store.comments}</td></tr>` : ''}
    ${health.store.users !== undefined ? `<tr><td>Tài khoản</td><td>${health.store.users}</td></tr>` : ''}
    ${health.store.reports !== undefined ? `<tr><td>Báo cáo</td><td>${health.store.reports}</td></tr>` : ''}
    ${health.store.sanctions !== undefined ? `<tr><td>Lệnh chế tài</td><td>${health.store.sanctions}</td></tr>` : ''}
    ${health.store.moderationActions !== undefined ? `<tr><td>Kiểm duyệt</td><td>${health.store.moderationActions}</td></tr>` : ''}
    ${health.store.nextGlobalNumber !== undefined ? `<tr><td>Số bài kế tiếp</td><td>#${health.store.nextGlobalNumber}</td></tr>` : ''}
  ` : '<tr><td colspan="2" class="muted">Không có dữ liệu</td></tr>';

  const aiRows = health.ai ? `
    <tr><td>Provider</td><td><strong>${escapeHtml(health.ai.provider || 'unknown')}</strong></td></tr>
    <tr><td>Trạng thái</td><td>${healthStatusBadge(health.ai.configured, health.ai.configured ? 'Đã cấu hình' : 'Chưa cấu hình')}</td></tr>
    <tr><td>Model</td><td>${escapeHtml(health.ai.model || 'unknown')}</td></tr>
    <tr><td>Ngưỡng hàng đợi</td><td>${escapeHtml(moderationConfidenceText(health.ai.moderationConfidenceThreshold))}</td></tr>
  ` : '<tr><td colspan="2" class="muted">Không có dữ liệu</td></tr>';

  const imageRows = health.imageStorage ? `
    <tr><td>Loại</td><td><strong>${escapeHtml(health.imageStorage.type || 'unknown')}</strong></td></tr>
    <tr><td>Trạng thái</td><td>${healthStatusBadge(health.imageStorage.ready, health.imageStorage.ready ? 'Sẵn sàng' : 'Không sẵn sàng')}</td></tr>
    ${health.imageStorage.error ? `<tr><td>Lỗi</td><td style="color:#c92a2a;">${escapeHtml(health.imageStorage.error)}</td></tr>` : ''}
  ` : '<tr><td colspan="2" class="muted">Không có dữ liệu</td></tr>';

  const realtimeRows = health.realtime ? `
    <tr><td>SSE clients</td><td><strong>${health.realtime.clients ?? 0}</strong></td></tr>
    ${health.realtime.boards ? Object.entries(health.realtime.boards).map(([slug, count]) =>
      `<tr><td style="padding-left:20px;">/${escapeHtml(slug)}/</td><td>${count}</td></tr>`
    ).join('') : ''}
  ` : '<tr><td colspan="2" class="muted">Không có dữ liệu</td></tr>';

  const captchaRows = health.captcha ? `
    <tr><td>Provider</td><td><strong>${escapeHtml(health.captcha.provider || 'unknown')}</strong></td></tr>
    <tr><td>Trạng thái</td><td>${healthStatusBadge(health.captcha.configured, health.captcha.configured ? 'Đã cấu hình' : 'Chưa cấu hình')}</td></tr>
  ` : '';

  const securityWarnings = health.security?.warnings?.length
    ? health.security.warnings.map((w) => `<li style="color:#c92a2a;">${escapeHtml(w.replace(/_/g, ' '))}</li>`).join('')
    : '<li style="color:#2b8a3e;">Không có cảnh báo</li>';

  const processRows = health.process ? `
    <tr><td>Node.js</td><td><strong>${escapeHtml(health.process.nodeVersion)}</strong></td></tr>
    <tr><td>Platform</td><td>${escapeHtml(health.process.platform)} / ${escapeHtml(health.process.arch)}</td></tr>
    <tr><td>PID</td><td>${health.process.pid}</td></tr>
    <tr><td>Uptime</td><td><strong>${formatUptime(health.process.uptimeSeconds)}</strong></td></tr>
    <tr><td>RSS</td><td>${formatBytes(health.process.memory.rss)}</td></tr>
    <tr><td>Heap used</td><td>${formatBytes(health.process.memory.heapUsed)} / ${formatBytes(health.process.memory.heapTotal)}</td></tr>
    <tr><td>External</td><td>${formatBytes(health.process.memory.external)}</td></tr>
  ` : '';

  return `
    <div class="health-dashboard">
      <div class="health-header">
        <span style="color:${overallColor}; font-size:1.2em; font-weight:bold;">${overallIcon} ${health.status === 'ok' ? 'Hệ thống hoạt động bình thường' : 'Hệ thống đang gặp sự cố'}</span>
        <span class="muted" style="margin-left:12px;">Kiểm tra lúc ${escapeHtml(health.checkedAt ? new Date(health.checkedAt).toLocaleString('vi-VN') : '—')}</span>
      </div>
      <div class="health-grid">
        <div class="health-card">
          <h3>Cơ sở dữ liệu</h3>
          <table class="health-table"><tbody>${storeRows}</tbody></table>
        </div>
        <div class="health-card">
          <h3>AI kiểm duyệt</h3>
          <table class="health-table"><tbody>${aiRows}</tbody></table>
        </div>
        <div class="health-card">
          <h3>Lưu trữ ảnh</h3>
          <table class="health-table"><tbody>${imageRows}</tbody></table>
        </div>
        <div class="health-card">
          <h3>Kết nối thời gian thực</h3>
          <table class="health-table"><tbody>${realtimeRows}</tbody></table>
        </div>
        ${captchaRows ? `
        <div class="health-card">
          <h3>Captcha</h3>
          <table class="health-table"><tbody>${captchaRows}</tbody></table>
        </div>` : ''}
        <div class="health-card">
          <h3>Bảo mật</h3>
          <table class="health-table"><tbody>
            <tr><td>Admin auth</td><td>${healthStatusBadge(health.security?.adminConfigured, health.security?.adminConfigured ? 'Đã cấu hình' : 'Chưa cấu hình')}</td></tr>
          </tbody></table>
          <h4>Cảnh báo</h4>
          <ul class="health-warnings">${securityWarnings}</ul>
        </div>
        ${processRows ? `
        <div class="health-card">
          <h3>Tiến trình</h3>
          <table class="health-table"><tbody>${processRows}</tbody></table>
        </div>` : ''}
      </div>
    </div>
  `;
}

export function adminLoadingHtml() {
  return '<p class="muted">Đang tải dữ liệu quản trị...</p>';
}

export function adminLoadErrorHtml(error) {
  const status = error?.timedOut ? 'hết thời gian chờ' : error?.statusCode ? `HTTP ${error.statusCode}` : 'lỗi kết nối';
  const message = error?.message || 'Không tải được dữ liệu quản trị.';
  const suffix = message.includes(status) ? '' : ` (${escapeHtml(status)})`;
  return `
    <div class="form-error" role="alert">
      <strong>Không tải được dữ liệu quản trị.</strong>
      <p>${escapeHtml(message)}${suffix}.</p>
      <button class="ghost-button" data-admin-retry type="button">[Thử lại]</button>
    </div>
  `;
}

export function adminBoardPayload(root, { includeSlug = false }: AnyRecord = {}) {
  const retentionPolicy = {
    maxActiveThreadsPerBoard: root.querySelector('[data-admin-board-retention-max]')?.value || '',
    bumpLimit: root.querySelector('[data-admin-board-retention-bump]')?.value || '',
    replyLimit: root.querySelector('[data-admin-board-retention-reply]')?.value || '',
    publicArchive: Boolean(root.querySelector('[data-admin-board-retention-public-archive]')?.checked)
  };
  const payload: AnyRecord = {
    name: root.querySelector('[data-admin-board-name]')?.value || '',
    category: root.querySelector('[data-admin-board-category]')?.value || '',
    description: root.querySelector('[data-admin-board-description]')?.value || '',
    rules: (root.querySelector('[data-admin-board-rules]')?.value || '')
      .split(/\r?\n/)
      .map((rule) => rule.trim())
      .filter(Boolean),
    banner: {
      text: root.querySelector('[data-admin-board-banner-text]')?.value || '',
      imageUrl: root.querySelector('[data-admin-board-banner-image-url]')?.value || '',
      altText: root.querySelector('[data-admin-board-banner-alt]')?.value || ''
    },
    temporary: Boolean(root.querySelector('[data-admin-board-temporary]')?.checked),
    eventEndsAt: root.querySelector('[data-admin-board-event-ends-at]')?.value || '',
    isHidden: Boolean(root.querySelector('[data-admin-board-hidden]')?.checked),
    isArchived: Boolean(root.querySelector('[data-admin-board-archived]')?.checked),
    retentionPolicy
  };
  if (includeSlug) {
    payload.slug = root.querySelector('[data-admin-board-slug]')?.value || '';
  }
  return payload;
}

export function adminUserPayload(root, { includeUsername = false }: AnyRecord = {}) {
  const payload: AnyRecord = {
    role: root.querySelector('[data-admin-user-role]')?.value || 'viewer',
    disabled: Boolean(root.querySelector('[data-admin-user-disabled]')?.checked)
  };
  const password = root.querySelector('[data-admin-user-password]')?.value || '';
  if (password) {
    payload.password = password;
  }
  if (includeUsername) {
    payload.username = root.querySelector('[data-admin-user-username]')?.value || '';
    payload.password = password;
  }
  return payload;
}

export function adminBoardsHtml(boards, lifecycle: AnyRecord = {}) {
  const rows = boards
    .map((board) => {
      const retentionPolicy = board.retentionPolicy || {};
      const eventEndsAt = formatDateTimeLocal(board.eventEndsAt);
      const rulesText = Array.isArray(board.rules) ? board.rules.join('\n') : '';
      const banner = board.banner || {};
      return `
        <tr data-admin-board-row="${escapeHtml(board.slug)}">
          <td class="admin-board-slug-cell" data-label="Board"><code>/${escapeHtml(board.slug)}/</code></td>
          <td data-label="Tên"><input data-admin-board-name aria-label="Tên board /${escapeHtml(board.slug)}/" value="${escapeHtml(board.name)}" maxlength="80" /></td>
          <td data-label="Danh mục"><input data-admin-board-category aria-label="Danh mục board /${escapeHtml(board.slug)}/" value="${escapeHtml(board.category)}" maxlength="80" /></td>
          <td data-label="Mô tả"><input data-admin-board-description aria-label="Mô tả board /${escapeHtml(board.slug)}/" value="${escapeHtml(board.description)}" maxlength="240" /></td>
          <td data-label="Hiển thị">
            <div class="admin-board-presentation">
              <label><span>Nội quy</span><textarea data-admin-board-rules aria-label="Nội quy board /${escapeHtml(board.slug)}/" rows="3" maxlength="2000">${escapeHtml(rulesText)}</textarea></label>
              <label><span>Banner</span><input data-admin-board-banner-text aria-label="Banner board /${escapeHtml(board.slug)}/" value="${escapeHtml(banner.text || '')}" maxlength="180" /></label>
              <label><span>Ảnh banner</span><input data-admin-board-banner-image-url aria-label="URL ảnh banner board /${escapeHtml(board.slug)}/" value="${escapeHtml(banner.imageUrl || '')}" maxlength="300" /></label>
              <label><span>Alt ảnh</span><input data-admin-board-banner-alt aria-label="Alt ảnh banner board /${escapeHtml(board.slug)}/" value="${escapeHtml(banner.altText || '')}" maxlength="140" /></label>
            </div>
          </td>
          <td data-label="Sự kiện">
            <div class="admin-board-events">
              <label><input data-admin-board-temporary type="checkbox" ${board.temporary ? 'checked' : ''} /> Tạm thời</label>
              <label><span>Kết thúc</span><input data-admin-board-event-ends-at aria-label="Thời điểm kết thúc board /${escapeHtml(board.slug)}/" type="datetime-local" value="${escapeHtml(eventEndsAt)}" /></label>
            </div>
          </td>
          <td data-label="Retention">
            <div class="admin-board-retention">
              <label><span>Active</span><input data-admin-board-retention-max aria-label="Giới hạn chủ đề active board /${escapeHtml(board.slug)}/" type="number" min="1" step="1" value="${escapeHtml(retentionPolicy.maxActiveThreadsPerBoard ?? '')}" /></label>
              <label><span>Bump</span><input data-admin-board-retention-bump aria-label="Bump limit board /${escapeHtml(board.slug)}/" type="number" min="1" step="1" value="${escapeHtml(retentionPolicy.bumpLimit ?? '')}" /></label>
              <label><span>Reply</span><input data-admin-board-retention-reply aria-label="Reply limit board /${escapeHtml(board.slug)}/" type="number" min="1" step="1" value="${escapeHtml(retentionPolicy.replyLimit ?? '')}" /></label>
              <label><input data-admin-board-retention-public-archive type="checkbox" ${retentionPolicy.publicArchive === false ? '' : 'checked'} /> Public archive</label>
            </div>
          </td>
          <td data-label="Trạng thái">
            <div class="admin-board-flags">
              <label><input data-admin-board-hidden type="checkbox" ${board.isHidden ? 'checked' : ''} /> Ẩn</label>
              <label><input data-admin-board-archived type="checkbox" ${board.isArchived ? 'checked' : ''} /> Lưu trữ</label>
              <label><input data-admin-board-temporary type="checkbox" ${board.temporary ? 'checked' : ''} /> Tạm thời</label>
              <label><span>Kết thúc</span><input data-admin-board-event-ends-at aria-label="Thời điểm kết thúc board /${escapeHtml(board.slug)}/" type="datetime-local" value="${escapeHtml(eventEndsAt)}" /></label>
            </div>
          </td>
          <td data-label="Thao tác">
            <div class="admin-board-actions">
              <button class="ghost-button" data-admin-board-save type="button" aria-label="Lưu board /${escapeHtml(board.slug)}/">[Lưu]</button>
              <button class="danger-button" data-admin-board-delete type="button" aria-label="Xóa board /${escapeHtml(board.slug)}/">Xóa</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="admin-board-manager">
      <section class="admin-board-create" data-admin-board-create-form>
        <h2>Thêm bảng</h2>
        <div class="admin-board-create-grid">
          <label><span>Slug</span><input data-admin-board-slug placeholder="an-uong" maxlength="40" /></label>
          <label><span>Tên</span><input data-admin-board-name placeholder="Ăn uống" maxlength="80" /></label>
          <label><span>Danh mục</span><input data-admin-board-category placeholder="Đời sống" maxlength="80" /></label>
          <label><span>Mô tả</span><input data-admin-board-description placeholder="Chia sẻ quán ăn, căn tin, deal sinh viên" maxlength="240" /></label>
          <label><span>Nội quy</span><textarea data-admin-board-rules rows="3" maxlength="2000" placeholder="Mỗi dòng là một nội quy"></textarea></label>
          <label><span>Banner</span><input data-admin-board-banner-text maxlength="180" placeholder="Thông báo ngắn trên board" /></label>
          <label><span>Ảnh banner</span><input data-admin-board-banner-image-url maxlength="300" placeholder="/uploads/banner.png hoặc https://..." /></label>
          <label><span>Alt ảnh</span><input data-admin-board-banner-alt maxlength="140" placeholder="Mô tả ảnh banner" /></label>
          <label><span>Active cap</span><input data-admin-board-retention-max type="number" min="1" step="1" value="${escapeHtml(lifecycle.maxActiveThreadsPerBoard ?? 150)}" /></label>
          <label><span>Bump limit</span><input data-admin-board-retention-bump type="number" min="1" step="1" value="${escapeHtml(lifecycle.bumpLimit ?? 300)}" /></label>
          <label><span>Reply limit</span><input data-admin-board-retention-reply type="number" min="1" step="1" value="${escapeHtml(lifecycle.replyLimit ?? 500)}" /></label>
          <label class="admin-board-checkbox-label"><input data-admin-board-hidden type="checkbox" /> Ẩn khỏi public</label>
          <label class="admin-board-checkbox-label"><input data-admin-board-archived type="checkbox" /> Lưu trữ</label>
          <label class="admin-board-checkbox-label"><input data-admin-board-temporary type="checkbox" /> Board sự kiện tạm thời</label>
          <label><span>Kết thúc</span><input data-admin-board-event-ends-at type="datetime-local" /></label>
          <label class="admin-board-checkbox-label"><input data-admin-board-retention-public-archive type="checkbox" checked /> Public archive</label>
          <button class="primary-button" data-admin-board-create type="button">Tạo bảng</button>
        </div>
      </section>
      <div class="admin-board-table-wrap admin-board-table-wrap-boards">
        <table class="admin-board-table">
          <thead>
            <tr>
              <th>Board</th>
              <th>Tên</th>
              <th>Danh mục</th>
              <th>Mô tả</th>
              <th>Hiển thị</th>
              <th>Sự kiện</th>
              <th>Retention</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="9">Chưa có board.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="muted">Xóa chỉ áp dụng cho board rỗng. Board đã có nội dung nên dùng Ẩn hoặc Lưu trữ.</p>
    </div>
  `;
}

function adminRoleOptions(selected = 'viewer') {
  return ['owner', 'moderator', 'viewer']
    .map((role) => `<option value="${role}" ${selected === role ? 'selected' : ''}>${adminRoleLabel(role)}</option>`)
    .join('');
}

export function adminUsersHtml(users = []) {
  const rows = users
    .map(
      (user) => `
        <tr data-admin-user-row="${escapeHtml(user.id)}">
          <td data-label="Tài khoản"><strong>@${escapeHtml(user.username)}</strong></td>
          <td data-label="Vai trò">
            <select data-admin-user-role aria-label="Vai trò @${escapeHtml(user.username)}">
              ${adminRoleOptions(user.role)}
            </select>
          </td>
          <td data-label="2FA">${user.twoFactorEnabled ? 'Đã bật' : 'Chưa bật'}</td>
          <td data-label="Trạng thái"><label><input data-admin-user-disabled type="checkbox" ${user.disabled ? 'checked' : ''} /> Vô hiệu hóa</label></td>
          <td data-label="Mật khẩu"><input data-admin-user-password aria-label="Đổi mật khẩu @${escapeHtml(user.username)}" type="password" minlength="10" placeholder="Đổi mật khẩu" autocomplete="new-password" /></td>
          <td class="admin-board-actions" data-label="Thao tác">
            <button class="ghost-button" data-admin-user-save type="button" aria-label="Lưu tài khoản @${escapeHtml(user.username)}">[Lưu]</button>
            <button class="danger-button" data-admin-user-disable type="button" aria-label="Tắt tài khoản @${escapeHtml(user.username)}" ${user.disabled ? 'disabled' : ''}>Tắt</button>
          </td>
        </tr>
      `
    )
    .join('');

  return `
    <div class="admin-board-manager">
      <section class="admin-board-create" data-admin-user-create-form>
        <h2>Thêm tài khoản quản trị</h2>
        <div class="admin-board-create-grid">
          <label><span>Tên đăng nhập</span><input data-admin-user-username maxlength="32" autocomplete="username" /></label>
          <label><span>Mật khẩu</span><input data-admin-user-password type="password" minlength="10" autocomplete="new-password" /></label>
          <label><span>Vai trò</span><select data-admin-user-role>${adminRoleOptions('viewer')}</select></label>
          <label class="admin-board-checkbox-label"><input data-admin-user-disabled type="checkbox" /> Tạo ở trạng thái tắt</label>
          <button class="primary-button" data-admin-user-create type="button">Tạo tài khoản</button>
        </div>
      </section>
      <div class="admin-board-table-wrap admin-board-table-wrap-users">
        <table class="admin-board-table">
          <thead>
            <tr>
              <th>Tài khoản</th>
              <th>Vai trò</th>
              <th>2FA</th>
              <th>Trạng thái</th>
              <th>Mật khẩu</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6">Chưa có tài khoản quản trị.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="muted">Owner quản lý cấu hình và tài khoản. Moderator xử lý kiểm duyệt. Viewer chỉ xem hàng đợi và nhật ký.</p>
    </div>
  `;
}

export function csvEscape(value = '') {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

export function postSubmitToast(result, publishedMessage, pendingMessage) {
  const baseMessage = result.status === 'pending' ? pendingMessage : publishedMessage;
  if (result.appealToken) {
    return `${baseMessage} Mã kháng nghị: ${result.appealToken}`;
  }
  return baseMessage;
}
