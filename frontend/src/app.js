const state = {
  boards: [],
  boardGroups: [],
  boardSlug: 'confession',
  threadId: '',
  threadGlobalNumber: '',
  threadPosterHash: '',
  token: localStorage.getItem('adminToken') || '',
  posterToken: getPosterToken(),
  selectedImage: null,
  quickReplyDrag: null,
  replyComposerOpen: false,
  threadIsArchived: false,
  autoUpdate: true,
  autoCountdown: 7,
  autoTimer: null,
  boardThreads: [],
  catalogThreads: [],
  catalogSort: 'bump',
  catalogImageSize: 'small',
  archiveThreads: []
};

function getPosterToken() {
  const key = 'posterToken';
  const current = localStorage.getItem(key);
  if (current) {
    return current;
  }
  const next =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(key, next);
  return next;
}

const els = {
  homeScreen: document.querySelector('#homeScreen'),
  homeBoards: document.querySelector('#homeBoards'),
  homeBoardSearchForm: document.querySelector('#homeBoardSearchForm'),
  homeBoardSearchInput: document.querySelector('#homeBoardSearchInput'),
  popularThreads: document.querySelector('#popularThreads'),
  latestPosts: document.querySelector('#latestPosts'),
  hotBoards: document.querySelector('#hotBoards'),
  homeStats: document.querySelector('#homeStats'),
  serverStats: document.querySelector('#serverStats'),
  boardNav: document.querySelector('#boardNav'),
  socketStatus: document.querySelector('#socketStatus'),
  boardScreen: document.querySelector('#boardScreen'),
  catalogScreen: document.querySelector('#catalogScreen'),
  archiveScreen: document.querySelector('#archiveScreen'),
  threadScreen: document.querySelector('#threadScreen'),
  adminScreen: document.querySelector('#adminScreen'),
  boardTitle: document.querySelector('#boardTitle'),
  boardPath: document.querySelector('#boardPath'),
  boardDescription: document.querySelector('#boardDescription'),
  boardSearchInput: document.querySelector('#boardSearchInput'),
  boardCatalogLink: document.querySelector('#boardCatalogLink'),
  boardArchiveLink: document.querySelector('#boardArchiveLink'),
  boardCatalogLinkBottom: document.querySelector('#boardCatalogLinkBottom'),
  boardArchiveLinkBottom: document.querySelector('#boardArchiveLinkBottom'),
  threadList: document.querySelector('#threadList'),
  catalogTitle: document.querySelector('#catalogTitle'),
  catalogDescription: document.querySelector('#catalogDescription'),
  catalogSearchInput: document.querySelector('#catalogSearchInput'),
  catalogGrid: document.querySelector('#catalogGrid'),
  catalogReturnTop: document.querySelector('#catalogReturnTop'),
  catalogReturnBottom: document.querySelector('#catalogReturnBottom'),
  archiveTitle: document.querySelector('#archiveTitle'),
  archiveDescription: document.querySelector('#archiveDescription'),
  archiveReturnTop: document.querySelector('#archiveReturnTop'),
  archiveReturnBottom: document.querySelector('#archiveReturnBottom'),
  archiveList: document.querySelector('#archiveList'),
  startThreadButton: document.querySelector('#startThreadButton'),
  threadStartThreadButton: document.querySelector('#threadStartThreadButton'),
  threadComposer: document.querySelector('#threadComposer'),
  threadForm: document.querySelector('#threadForm'),
  threadBody: document.querySelector('#threadBody'),
  threadImage: document.querySelector('#threadImage'),
  threadCaptcha: document.querySelector('#threadCaptcha'),
  imagePreview: document.querySelector('#imagePreview'),
  refreshThreads: document.querySelector('#refreshThreads'),
  boardSummaryButton: document.querySelector('#boardSummaryButton'),
  boardSummary: document.querySelector('#boardSummary'),
  backToBoard: document.querySelector('#backToBoard'),
  threadTitle: document.querySelector('#threadTitle'),
  threadBoardPath: document.querySelector('#threadBoardPath'),
  threadBoardDescription: document.querySelector('#threadBoardDescription'),
  threadToolbarTop: document.querySelector('#threadToolbarTop'),
  threadToolbarBottom: document.querySelector('#threadToolbarBottom'),
  threadSummaryButton: document.querySelector('#threadSummaryButton'),
  threadSummary: document.querySelector('#threadSummary'),
  postReplyToggle: document.querySelector('#postReplyToggle'),
  replyComposer: document.querySelector('#replyComposer'),
  threadDetail: document.querySelector('#threadDetail'),
  commentForm: document.querySelector('#commentForm'),
  commentBody: document.querySelector('#commentBody'),
  commentCaptcha: document.querySelector('#commentCaptcha'),
  suggestButton: document.querySelector('#suggestButton'),
  suggestions: document.querySelector('#suggestions'),
  adminTitle: document.querySelector('#adminTitle'),
  loginForm: document.querySelector('#loginForm'),
  adminUsername: document.querySelector('#adminUsername'),
  adminPassword: document.querySelector('#adminPassword'),
  logoutButton: document.querySelector('#logoutButton'),
  pendingList: document.querySelector('#pendingList'),
  reportList: document.querySelector('#reportList'),
  moderationActions: document.querySelector('#moderationActions'),
  toast: document.querySelector('#toast'),
  refPreview: document.querySelector('#refPreview'),
  quickReply: document.querySelector('#quickReply'),
  quickReplyHandle: document.querySelector('#quickReplyHandle'),
  quickReplyTitle: document.querySelector('#quickReplyTitle'),
  quickReplyClose: document.querySelector('#quickReplyClose'),
  quickReplyForm: document.querySelector('#quickReplyForm'),
  quickReplyBody: document.querySelector('#quickReplyBody'),
  quickReplyCaptcha: document.querySelector('#quickReplyCaptcha'),
  quickReplyCaptchaButton: document.querySelector('#quickReplyCaptchaButton'),
  quickReplyFileName: document.querySelector('#quickReplyFileName')
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add('hidden'), 3400);
}

function setButtonLoading(button, label = 'Đang gửi...') {
  if (!button) {
    return () => {};
  }
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = label;
  return () => {
    button.disabled = false;
    button.textContent = previousText;
  };
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  if (state.token) {
    headers.authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || 'Yêu cầu thất bại');
  }
  return payload.data;
}

function setScreen(name) {
  if (name !== 'thread') {
    stopAutoUpdateTimer();
  }
  for (const screen of [
    els.homeScreen,
    els.boardScreen,
    els.catalogScreen,
    els.archiveScreen,
    els.threadScreen,
    els.adminScreen
  ]) {
    screen.classList.remove('active');
  }
  document.body.classList.toggle('home-page', name === 'home');
  document.body.classList.toggle(
    'board-page',
    name === 'board' || name === 'catalog' || name === 'archive' || name === 'thread'
  );
  if (name === 'home') {
    els.homeScreen.classList.add('active');
  } else if (name === 'catalog') {
    els.catalogScreen.classList.add('active');
  } else if (name === 'archive') {
    els.archiveScreen.classList.add('active');
  } else if (name === 'thread') {
    els.threadScreen.classList.add('active');
  } else if (name === 'admin') {
    els.adminScreen.classList.add('active');
  } else {
    els.boardScreen.classList.add('active');
  }
}

function currentBoard() {
  return state.boards.find((board) => board.slug === state.boardSlug) || state.boards[0];
}

function normalizeSearchValue(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function findBoardByQuery(query) {
  const normalized = normalizeSearchValue(query);
  if (!normalized) {
    return null;
  }
  return state.boards.find((board) => {
    const slug = normalizeSearchValue(board.slug);
    const path = normalizeSearchValue(board.path).replaceAll('/', '');
    const name = normalizeSearchValue(board.name);
    return slug === normalized || path === normalized.replaceAll('/', '') || name.includes(normalized);
  });
}

function boardHeading(board) {
  if (!board) {
    return '36chan';
  }
  return `${board.path} - ${board.name}`;
}

function updateBoardAds(board) {
  const label = board?.name?.toLowerCase() || '36chan';
  document.querySelectorAll('.board-ad').forEach((ad) => {
    ad.textContent = `Bảng ${label} sinh viên · QUẢNG CÁO Ở ĐÂY`;
  });
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[character];
  });
}

function renderBoards() {
  els.boardNav.innerHTML = state.boards
    .map(
      (board) =>
        `<a class="${board.slug === state.boardSlug ? 'active' : ''}" href="#board/${board.slug}" title="${board.path}">${board.name}</a>`
    )
    .join('');
}

function openThreadComposer({ focus = true } = {}) {
  els.threadComposer.classList.remove('hidden');
  els.startThreadButton.classList.add('hidden');
  if (focus) {
    window.setTimeout(() => els.threadBody.focus(), 0);
  }
}

function closeThreadComposer() {
  els.threadComposer.classList.add('hidden');
  els.startThreadButton.classList.remove('hidden');
}

function syncReplyComposer() {
  const canReply = !state.threadIsArchived;
  els.replyComposer.classList.toggle('hidden', !state.replyComposerOpen || !canReply);
  els.postReplyToggle.classList.toggle('hidden', state.replyComposerOpen || !canReply);
  if (!state.replyComposerOpen || !canReply) {
    els.suggestions.classList.add('hidden');
  }
}

function openReplyComposer({ focus = true } = {}) {
  if (state.threadIsArchived) {
    showToast('Chủ đề đã lưu trữ, không thể trả lời.');
    return;
  }
  state.replyComposerOpen = true;
  syncReplyComposer();
  if (focus) {
    window.setTimeout(() => els.commentBody.focus(), 0);
  }
}

function closeReplyComposer({ clear = false } = {}) {
  state.replyComposerOpen = false;
  if (clear) {
    els.commentBody.value = '';
    els.suggestions.classList.add('hidden');
  }
  syncReplyComposer();
}

function plainPreview(lines, fallback = '') {
  const text = (lines || [])
    .map((line) => line.text)
    .join(' ')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
    .trim();
  return text || fallback;
}

function homeBoardList() {
  const groupedBoards = state.boardGroups.flatMap((group) => group.boards || []);
  const source = groupedBoards.length ? groupedBoards : state.boards;
  const seen = new Set();
  return source.filter((board) => {
    if (!board || seen.has(board.slug)) {
      return false;
    }
    seen.add(board.slug);
    return true;
  });
}

function boardPostCount(threads = []) {
  return threads.reduce((total, thread) => total + 1 + Number(thread.replyCount || 0), 0);
}

async function loadHomeThreadsByBoard() {
  const entries = await Promise.all(
    state.boards.map(async (board) => {
      try {
        return [board.slug, await api(`/api/boards/${board.slug}/threads`)];
      } catch {
        return [board.slug, []];
      }
    })
  );
  return Object.fromEntries(entries);
}

function renderHomeBoards(threadsByBoard = {}) {
  const rows = homeBoardList()
    .map((board) => {
      const postCount = boardPostCount(threadsByBoard[board.slug]);
      return `
        <tr>
          <td class="portal-board-icon-cell"><span class="board-row-icon" aria-hidden="true"></span></td>
          <td class="portal-board-name-cell">
            <a class="portal-board-link" href="#board/${board.slug}" title="${escapeHtml(board.description)}">
              <span class="board-path">${escapeHtml(board.path)}</span> - ${escapeHtml(board.name)}
            </a>
          </td>
          <td class="portal-board-desc-cell">${escapeHtml(board.description)}</td>
          <td class="portal-board-number-cell">0</td>
          <td class="portal-board-number-cell">${postCount.toLocaleString()}</td>
        </tr>
      `;
    })
    .join('');

  els.homeBoards.innerHTML = `
    <table class="portal-board-table">
      <colgroup>
        <col class="portal-board-icon-col">
        <col class="portal-board-name-col">
        <col class="portal-board-desc-col">
        <col class="portal-board-number-col">
        <col class="portal-board-number-col">
      </colgroup>
      <thead>
        <tr>
          <th class="portal-board-icon-head" scope="col"></th>
          <th scope="col">Bảng</th>
          <th scope="col">Mô Tả</th>
          <th scope="col">Người Dùng</th>
          <th scope="col">Bài Viết</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function popularThreadsFrom(threadsByBoard) {
  return Object.values(threadsByBoard)
    .flat()
    .sort((left, right) => right.bumpedAt.localeCompare(left.bumpedAt))
    .slice(0, 8);
}

function renderPopularThreads(threads) {
  if (!threads.length) {
    els.popularThreads.classList.add('popular-empty');
    els.popularThreads.innerHTML = `
      <p>
        Chưa có chủ đề nổi bật. Chủ đề công khai sẽ xuất hiện ở đây sau khi có người đăng bài.
      </p>
    `;
    return;
  }

  els.popularThreads.classList.remove('popular-empty');
  els.popularThreads.innerHTML = threads
    .map((thread) => {
      const board = state.boards.find((item) => item.slug === thread.boardSlug);
      const href = `#thread/${thread.id}`;
      const title = plainPreview(thread.bodyLines, board?.description).slice(0, 120);
      const initials = (board?.name || thread.boardSlug).slice(0, 2).toUpperCase();

      return `
        <a class="popular-item" href="${href}">
          <strong>${board?.name || thread.boardSlug}</strong>
          ${
            thread.image
              ? `<img src="${thread.image.dataUrl}" alt="${thread.image.name}">`
              : `<span class="popular-placeholder">${initials}</span>`
          }
          <span>${title}${title.length >= 120 ? '...' : ''}</span>
        </a>
      `;
    })
    .join('');
}

function latestPostHref(post) {
  const threadId = post.threadId || post.id;
  if (!threadId) {
    return '#home';
  }
  return `#thread/${encodeURIComponent(threadId)}?p=${encodeURIComponent(post.globalNumber)}`;
}

function renderLatestPosts(posts) {
  if (!posts.length) {
    els.latestPosts.innerHTML = '<p class="latest-empty">Chưa có bài công khai.</p>';
    return;
  }

  els.latestPosts.innerHTML = posts
    .map((post) => {
      const board = state.boards.find((item) => item.slug === post.boardSlug);
      const preview = plainPreview(post.bodyLines, 'Không có nội dung').slice(0, 140);
      const kind = post.type === 'comment' ? 'Phản hồi' : 'Chủ đề';
      return `
        <a class="latest-post-item" href="${latestPostHref(post)}">
          <span class="latest-post-board">${escapeHtml(board?.path || `/${post.boardSlug}/`)}</span>
          <span class="latest-post-number">No.${post.globalNumber}</span>
          <span class="latest-post-kind">${kind}</span>
          <span class="latest-post-preview">${escapeHtml(preview)}${preview.length >= 140 ? '...' : ''}</span>
          <span class="latest-post-date">${formatPostDate(post.createdAt)}</span>
        </a>
      `;
    })
    .join('');
}

function renderHotBoards(boards) {
  if (!boards.length) {
    els.hotBoards.innerHTML = '<p class="latest-empty">Chưa có bảng nào nóng trong 24 giờ qua.</p>';
    return;
  }

  els.hotBoards.innerHTML = `
    <table class="hot-board-table">
      <thead>
        <tr>
          <th scope="col">Bảng</th>
          <th scope="col">Bài 24h</th>
          <th scope="col">Chủ đề</th>
          <th scope="col">Phản hồi</th>
          <th scope="col">Hoạt động cuối</th>
        </tr>
      </thead>
      <tbody>
        ${boards
          .map((item) => {
            const board = state.boards.find((entry) => entry.slug === item.boardSlug);
            const latest = item.latestActivityAt ? formatPostDate(item.latestActivityAt) : '-';
            return `
              <tr>
                <td><a href="#board/${item.boardSlug}">${escapeHtml(board?.path || `/${item.boardSlug}/`)}</a></td>
                <td>${Number(item.postCountLast24h || 0).toLocaleString()}</td>
                <td>${Number(item.threadCountLast24h || 0).toLocaleString()}</td>
                <td>${Number(item.replyCountLast24h || 0).toLocaleString()}</td>
                <td>${escapeHtml(latest)}</td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

function renderStats(stats) {
  els.homeStats.innerHTML = `
    <span><strong>Tổng bài viết:</strong> ${stats.totalPosts.toLocaleString()}</span>
    <span><strong>Người dùng hiện tại:</strong> ${stats.currentUsers.toLocaleString()}</span>
    <span><strong>Dung lượng nội dung:</strong> ${stats.activeContentMb.toLocaleString()} MB</span>
    <span><strong>Bảng đang hoạt động:</strong> ${stats.activeBoards.toLocaleString()}</span>
  `;
  els.serverStats.innerHTML = `
    <p>
      Hiện có <strong>${stats.publicBoardCount.toLocaleString()}</strong> bảng công khai,
      tổng cộng <strong>${stats.totalBoardCount.toLocaleString()}</strong>.
      Trên toàn hệ thống, <strong>${stats.postCountLast24h.toLocaleString()}</strong> bài viết
      đã được đăng trong ngày qua, <strong>${stats.postCountLastHour.toLocaleString()}</strong>
      bài trong giờ qua, tổng cộng <strong>${stats.totalPosts.toLocaleString()}</strong>.
    </p>
    <p>
      <strong>${stats.fileCount.toLocaleString()}</strong> tệp đang được phục vụ,
      tổng cộng <strong>${stats.fileMegabytes.toLocaleString()}MB</strong>.
    </p>
  `;
}

function moderationActionText(action) {
  return (
    {
      'ai:moderate': 'AI kiểm duyệt',
      'admin:approve': 'Admin duyệt',
      'admin:delete': 'Admin xóa'
    }[action] || action
  );
}

function renderModerationActions(actions) {
  if (!actions.length) {
    els.moderationActions.innerHTML = '<p class="muted">Chưa có nhật ký kiểm duyệt.</p>';
    return;
  }

  els.moderationActions.innerHTML = `
    <table class="moderation-log-table">
      <thead>
        <tr>
          <th>Thời gian</th>
          <th>Hành động</th>
          <th>Bài</th>
          <th>Nhãn</th>
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

function renderReports(reports) {
  if (!reports.length) {
    els.reportList.innerHTML = '<p class="muted">Chưa có báo cáo nào.</p>';
    return;
  }

  els.reportList.innerHTML = `
    <table class="moderation-log-table">
      <thead>
        <tr>
          <th>Thời gian</th>
          <th>Bài</th>
          <th>Loại</th>
          <th>Lý do</th>
          <th>Người báo cáo</th>
        </tr>
      </thead>
      <tbody>
        ${reports
          .map(
            (report) => `
              <tr>
                <td>${formatPostDate(report.createdAt)}</td>
                <td>${escapeHtml(report.boardSlug)} / No.${report.globalNumber}</td>
                <td>${report.postType === 'thread' ? 'Chủ đề' : 'Bình luận'}</td>
                <td>${escapeHtml(report.reason || '-')}</td>
                <td>${escapeHtml(posterId({ posterHash: report.reporterHash }))}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function loadHome() {
  setScreen('home');
  renderBoards();
  const [threadsByBoard, latestPosts, hotBoards, stats] = await Promise.all([
    loadHomeThreadsByBoard(),
    api('/api/posts/latest?limit=10'),
    api('/api/boards/hot?limit=8'),
    api('/api/stats')
  ]);
  renderHomeBoards(threadsByBoard);
  renderPopularThreads(popularThreadsFrom(threadsByBoard));
  renderLatestPosts(latestPosts);
  renderHotBoards(hotBoards);
  renderStats(stats);
}

function renderPostLines(lines, options = {}) {
  const opNumber = Number(options.opNumber || 0);
  return lines
    .map((line) => {
      const html = line.text.replace(/&gt;&gt;(\d+)/g, (_match, number) => {
        const refNumber = Number(number);
        const isOpReference = opNumber > 0 && refNumber === opNumber;
        const className = isOpReference ? 'ref-link op-ref' : 'ref-link';
        const marker = isOpReference ? ' <span class="op-ref-marker">(OP)</span>' : '';
        return `<button class="${className}" data-ref="${number}" type="button">&gt;&gt;${number}${marker}</button>`;
      });
      return `<div class="post-line ${line.type === 'greentext' ? 'greentext' : ''}">${html || '&nbsp;'}</div>`;
    })
    .join('');
}

function formatPostDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${String(date.getFullYear()).slice(-2)}(${days[date.getDay()]})${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function dataUrlBytes(dataUrl = '') {
  const base64 = String(dataUrl).split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function imageSizeBytes(image = {}) {
  const sizeBytes = Number(image.sizeBytes);
  if (Number.isFinite(sizeBytes) && sizeBytes > 0) {
    return Math.round(sizeBytes);
  }
  return dataUrlBytes(image.dataUrl);
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${bytes} B`;
}

function imageInfoText(image = {}) {
  const size = formatBytes(imageSizeBytes(image));
  const width = Number(image.width);
  const height = Number(image.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return `${size}, ${Math.round(width)}x${Math.round(height)}`;
  }
  return size;
}

function fileTextHtml(image) {
  const name = escapeHtml(image?.name || 'tai-len');
  const dataUrl = escapeHtml(image?.dataUrl || '');
  const info = escapeHtml(imageInfoText(image));
  return `Tệp: <a href="${dataUrl}" target="_blank" rel="noopener">${name}</a> (${info})`;
}

function imageHtml(post) {
  if (!post.image) {
    return '';
  }

  const name = escapeHtml(post.image.name || 'tai-len');
  const dataUrl = escapeHtml(post.image.dataUrl || '');
  return `
    <div class="thread-thumb-wrap">
      <div class="file-text">${fileTextHtml(post.image)}</div>
      <button class="image-toggle" data-image-toggle type="button" aria-expanded="false" aria-label="Phóng to ảnh ${name}">
        <img class="post-image" src="${dataUrl}" alt="${name}">
      </button>
    </div>
  `;
}

function posterId(post) {
  const value = post.posterHash || '????';
  return value.startsWith('ID:') ? value : `ID:${value}`;
}

function postPermalink(post, options = {}) {
  const threadId = options.threadId || post.threadId || post.id || state.threadId;
  if (!threadId || !post.globalNumber) {
    return '#';
  }
  return `#thread/${encodeURIComponent(threadId)}?p=${encodeURIComponent(post.globalNumber)}`;
}

function meta(post, options = {}) {
  const labels = post.moderationLabels?.length
    ? `AI:${post.moderationLabels.map(moderationLabelText).join(',')}`
    : moderationStatusText(post.moderationStatus);
  const showCheckbox = options.checkbox !== false;
  const showReplyAction = options.replyAction !== false;
  const canReply = options.canReply !== false;
  const permalink = postPermalink(post, options);
  const opNumber = Number(options.opNumber || 0);
  const isOpReply =
    opNumber > 0 &&
    Number(post.globalNumber) !== opNumber &&
    options.opPosterHash &&
    post.posterHash === options.opPosterHash;
  const opMarker = isOpReply ? '<span class="op-post-marker">(OP)</span>' : '';
  const posterIdentity = canReply
    ? `<button class="post-id-button hash" data-quick-reply="${post.globalNumber}" title="Trả lời bài này" type="button">${escapeHtml(posterId(post))}</button>`
    : `<span class="hash">${escapeHtml(posterId(post))}</span>`;
  return `
    <div class="post-meta">
      ${showCheckbox ? `<label class="post-check"><input type="checkbox" aria-label="Chọn bài ${post.globalNumber}"></label>` : ''}
      <span class="name">Anonymous</span>
      <span class="date">${formatPostDate(post.createdAt)}</span>
      <span class="post-number"><span class="post-number-prefix">No.</span><a class="number post-number-link" href="${permalink}" title="Liên kết tới bài này">${post.globalNumber}</a></span>
      ${posterIdentity}
      ${opMarker}
      <span class="status">${labels}</span>
      ${
        showReplyAction && canReply
          ? `<button class="quote-button" data-quote="&gt;&gt;${post.globalNumber}" type="button">[Trả lời]</button>`
          : ''
      }
      <button class="quote-button" data-report="${post.globalNumber}" type="button">[Báo cáo]</button>
    </div>
  `;
}

function postHtml(post, type = 'post', options = {}) {
  const classes = String(type)
    .split(/\s+/)
    .filter(Boolean);
  if (!classes.includes('post')) {
    classes.unshift('post');
  }

  return `
    <article class="${classes.join(' ')}" id="p${post.globalNumber}">
      ${imageHtml(post)}
      ${meta(post, options)}
      <div class="post-body">${renderPostLines(post.bodyLines || [], options)}</div>
    </article>
  `;
}

function threadToolbarHtml(detail, position) {
  const posts = [detail.thread, ...detail.comments];
  const fileCount = posts.filter((post) => post.image).length;
  const canReply = !detail.thread.isArchived;
  const replyLink =
    position === 'bottom' && canReply
      ? '<button class="link-button toolbar-reply-link" data-open-reply type="button">Đăng trả lời</button>'
      : '<span></span>';
  const checked = state.autoUpdate ? 'checked' : '';
  const archivedLabel = detail.thread.isArchived ? '<span class="archived-label">Đã lưu trữ</span>' : '';

  return `
    <div class="toolbar-links">
      [<a href="#board/${state.boardSlug}">Quay lại</a>]
      [<a href="#catalog/${state.boardSlug}">Danh mục</a>]
      [<button class="link-button" data-scroll-page-top type="button">Lên đầu</button>]
      [<button class="link-button" data-thread-refresh type="button">Cập nhật</button>]
      [<label title="Tự lấy phản hồi mới"><input type="checkbox" data-auto-update ${checked}> Tự động</label>]
      <span class="auto-countdown">${state.autoUpdate ? state.autoCountdown : ''}</span>
      ${archivedLabel}
    </div>
    ${replyLink}
    <div class="toolbar-counts">${posts.length} / ${detail.comments.length} / ${fileCount}</div>
  `;
}

function moderationLabelText(label) {
  return (
    {
      Toxic: 'Độc hại',
      Spam: 'Nội dung rác',
      'Hate Speech': 'Thù ghét',
      'Fake News': 'Tin giả',
      'PII Risk': 'Rủi ro thông tin cá nhân'
    }[label] || label
  );
}

function moderationStatusText(status) {
  return (
    {
      Safe: 'An toàn',
      Flagged: 'Bị gắn cờ',
      ApprovedByAdmin: 'Quản trị viên đã duyệt'
    }[status] || status
  );
}

function syncAutoUpdateControls() {
  document.querySelectorAll('[data-auto-update]').forEach((checkbox) => {
    checkbox.checked = state.autoUpdate;
  });
  document.querySelectorAll('.auto-countdown').forEach((counter) => {
    counter.textContent = state.autoUpdate ? String(state.autoCountdown) : '';
  });
}

function stopAutoUpdateTimer() {
  if (state.autoTimer) {
    window.clearInterval(state.autoTimer);
    state.autoTimer = null;
  }
}

function resetAutoUpdateTimer() {
  stopAutoUpdateTimer();
  state.autoCountdown = 7;
  syncAutoUpdateControls();
  if (!state.autoUpdate || !(window.location.hash || '').startsWith('#thread/')) {
    return;
  }
  state.autoTimer = window.setInterval(() => {
    if (!(window.location.hash || '').startsWith('#thread/')) {
      stopAutoUpdateTimer();
      return;
    }
    state.autoCountdown -= 1;
    if (state.autoCountdown <= 0) {
      state.autoCountdown = 7;
      syncAutoUpdateControls();
      loadThread().catch((error) => showToast(error.message));
      return;
    }
    syncAutoUpdateControls();
  }, 1000);
}

function setAutoUpdate(enabled) {
  state.autoUpdate = enabled;
  resetAutoUpdateTimer();
}

function currentPermalinkPost() {
  return new URLSearchParams((window.location.hash || '').split('?')[1] || '').get('p') || '';
}

function focusPermalinkPost(globalNumber, { scroll = false } = {}) {
  const postNumber = String(globalNumber || '').trim();
  if (!postNumber) {
    return;
  }

  const target = document.getElementById(`p${postNumber}`);
  if (!target) {
    return;
  }

  document.querySelectorAll('.permalink-target').forEach((post) => {
    post.classList.remove('permalink-target');
  });
  target.classList.add('permalink-target');
  if (scroll) {
    window.setTimeout(() => {
      target.scrollIntoView({ block: 'center' });
    }, 0);
  }
}

function threadMatchesSearch(thread, term) {
  const normalizedTerm = normalizeSearchValue(term);
  if (!normalizedTerm) {
    return true;
  }
  const haystack = normalizeSearchValue(
    `${boardHeading(state.boards.find((board) => board.slug === thread.boardSlug))} ${plainPreview(
      thread.bodyLines,
      ''
    )} No.${thread.globalNumber}`
  );
  return haystack.includes(normalizedTerm);
}

function catalogThreadHtml(thread) {
  const title = plainPreview(thread.bodyLines, 'Chưa có nội dung').slice(0, 260);
  const image = thread.image
    ? `<img src="${escapeHtml(thread.image.dataUrl)}" alt="${escapeHtml(thread.image.name)}">`
    : '<span class="catalog-placeholder">Không có tệp</span>';

  return `
    <a class="catalog-thread" href="#thread/${thread.id}">
      <span class="catalog-thumb">${image}</span>
      <strong>${escapeHtml(title.slice(0, 70))}${title.length >= 70 ? '...' : ''}</strong>
      <span class="catalog-thread-stats">R: ${thread.replyCount} / I: ${thread.image ? 1 : 0} / No.${thread.globalNumber}</span>
      <p>${escapeHtml(title)}${title.length >= 260 ? '...' : ''}</p>
    </a>
  `;
}

function sortedCatalogThreads(threads) {
  const copy = [...threads];
  if (state.catalogSort === 'created') {
    return copy.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  if (state.catalogSort === 'replies') {
    return copy.sort((left, right) => Number(right.replyCount || 0) - Number(left.replyCount || 0));
  }
  if (state.catalogSort === 'latest-reply') {
    return copy.sort((left, right) => right.bumpedAt.localeCompare(left.bumpedAt));
  }
  return copy.sort((left, right) => right.bumpedAt.localeCompare(left.bumpedAt));
}

function renderCatalogThreads(threads) {
  const term = els.catalogSearchInput.value.trim();
  const visibleThreads = sortedCatalogThreads(threads.filter((thread) => threadMatchesSearch(thread, term)));
  els.catalogGrid.classList.toggle('catalog-grid-large', state.catalogImageSize === 'large');
  document.querySelectorAll('[data-catalog-sort]').forEach((button) => {
    button.classList.toggle('active', button.dataset.catalogSort === state.catalogSort);
  });
  document.querySelectorAll('[data-catalog-size]').forEach((button) => {
    button.classList.toggle('active', button.dataset.catalogSize === state.catalogImageSize);
  });
  if (!visibleThreads.length) {
    els.catalogGrid.innerHTML = '<p class="muted">Không có OP khớp tìm kiếm.</p>';
    return;
  }

  els.catalogGrid.innerHTML = visibleThreads.map(catalogThreadHtml).join('');
}

async function loadCatalog() {
  const board = currentBoard();
  if (!board) {
    return;
  }
  setScreen('catalog');
  renderBoards();
  els.catalogTitle.textContent = `${board.path} - ${board.name} Danh mục`;
  els.catalogDescription.textContent = board.description;
  els.catalogReturnTop.href = `#board/${board.slug}`;
  els.catalogReturnBottom.href = `#board/${board.slug}`;
  els.catalogSearchInput.value = '';

  const threads = await api(`/api/boards/${board.slug}/threads`);
  state.catalogThreads = threads;
  if (!threads.length) {
    els.catalogGrid.innerHTML = '<p class="muted">Chưa có chủ đề công khai.</p>';
    return;
  }

  renderCatalogThreads(threads);
}

function archiveThreadHtml(thread) {
  const title = plainPreview(thread.bodyLines, 'Chưa có nội dung').slice(0, 180);
  const archivedAt = thread.archivedAt ? new Date(thread.archivedAt).toLocaleString('vi-VN') : 'không rõ';
  return `
    <a class="archive-row" href="#thread/${thread.id}">
      <span class="archive-no">No.${thread.globalNumber}</span>
      <span class="archive-title">${escapeHtml(title)}${title.length >= 180 ? '...' : ''}</span>
      <span class="archive-meta">${thread.replyCount} trả lời · lưu lúc ${escapeHtml(archivedAt)}</span>
    </a>
  `;
}

function renderArchiveThreads(threads) {
  if (!threads.length) {
    els.archiveList.innerHTML = '<p class="muted">Kho lưu trữ chưa có chủ đề.</p>';
    return;
  }
  els.archiveList.innerHTML = threads.map(archiveThreadHtml).join('');
}

async function loadArchive() {
  const board = state.boards.find((item) => item.slug === state.boardSlug);
  setScreen('archive');
  renderBoards();
  if (!board) {
    els.archiveTitle.textContent = 'Không tìm thấy bảng';
    els.archiveDescription.textContent = `Bảng /${state.boardSlug}/ không tồn tại.`;
    els.archiveReturnTop.href = '#home';
    els.archiveReturnBottom.href = '#home';
    els.archiveList.innerHTML = '<p class="muted">Không có kho lưu trữ để hiển thị.</p>';
    return;
  }
  updateBoardAds(board);
  els.archiveTitle.textContent = `${board.path} - ${board.name} Kho lưu trữ`;
  els.archiveDescription.textContent = board.description;
  els.archiveReturnTop.href = `#board/${board.slug}`;
  els.archiveReturnBottom.href = `#board/${board.slug}`;

  const threads = await api(`/api/boards/${board.slug}/archive`);
  state.archiveThreads = threads;
  renderArchiveThreads(threads);
}

function renderBoardThreads(threads) {
  const term = els.boardSearchInput.value.trim();
  const visibleThreads = threads.filter((thread) => threadMatchesSearch(thread, term));
  if (!visibleThreads.length) {
    els.threadList.innerHTML = term
      ? '<p class="muted">Không có OP khớp tìm kiếm.</p>'
      : '<p class="muted">Chưa có chủ đề công khai.</p>';
    return;
  }

  els.threadList.innerHTML = visibleThreads
    .map((thread) => {
      return `
        <div class="thread" id="p${thread.globalNumber}">
          <div class="thread-op">
          ${
            thread.image
              ? `<div class="thread-thumb-wrap"><div class="file-text">${fileTextHtml(thread.image)}</div><button class="image-toggle" data-image-toggle type="button" aria-expanded="false" aria-label="Phóng to ảnh ${escapeHtml(thread.image.name)}"><img class="thumb" src="${escapeHtml(thread.image.dataUrl)}" alt="${escapeHtml(thread.image.name)}"></button></div>`
              : '<div class="thread-thumb-wrap"><div class="thumb placeholder">Không có tệp</div></div>'
          }
            ${meta(thread, { replyAction: false })}
            <a class="thread-open" href="#thread/${thread.id}">[Trả lời]</a>
            <div class="post-body">${renderPostLines(thread.bodyLines || [], { opNumber: thread.globalNumber })}</div>
            <div class="thread-meta">
              <span>${thread.replyCount} trả lời</span>
              <span>đẩy lúc ${new Date(thread.bumpedAt).toLocaleTimeString()}</span>
              <a href="#thread/${thread.id}">Xem chủ đề</a>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

async function loadBoard() {
  const board = currentBoard();
  if (!board) {
    return;
  }
  setScreen('board');
  renderBoards();
  updateBoardAds(board);
  els.boardTitle.textContent = boardHeading(board);
  els.boardPath.textContent = board.path;
  els.boardDescription.textContent = board.description;
  els.boardCatalogLink.href = `#catalog/${board.slug}`;
  els.boardArchiveLink.href = `#archive/${board.slug}`;
  els.boardCatalogLinkBottom.href = `#catalog/${board.slug}`;
  els.boardArchiveLinkBottom.href = `#archive/${board.slug}`;
  els.boardSearchInput.value = '';
  els.boardSummary.classList.add('hidden');
  const shouldOpenComposer = new URLSearchParams(window.location.hash.split('?')[1] || '').get('new') === '1';
  if (shouldOpenComposer) {
    openThreadComposer({ focus: true });
  } else {
    closeThreadComposer();
  }

  const threads = await api(`/api/boards/${board.slug}/threads`);
  state.boardThreads = threads;
  renderBoardThreads(threads);
}

async function loadThread({ resetReply = false, focusPost = '' } = {}) {
  setScreen('thread');
  els.threadSummary.classList.add('hidden');
  const detail = await api(`/api/threads/${state.threadId}`);
  state.boardSlug = detail.thread.boardSlug;
  state.threadGlobalNumber = detail.thread.globalNumber;
  state.threadPosterHash = detail.thread.posterHash;
  state.threadIsArchived = Boolean(detail.thread.isArchived);
  if (resetReply || state.threadIsArchived) {
    closeReplyComposer({ clear: true });
  } else {
    syncReplyComposer();
  }
  const board = currentBoard();
  renderBoards();
  updateBoardAds(board);
  els.threadTitle.textContent = boardHeading(board) || detail.thread.boardSlug;
  els.threadBoardPath.textContent = board?.path || `/${detail.thread.boardSlug}/`;
  els.threadBoardDescription.textContent = board?.description || 'Diễn đàn ảnh sinh viên ẩn danh có AI kiểm duyệt';
  els.threadToolbarTop.innerHTML = threadToolbarHtml(detail, 'top');
  els.threadToolbarBottom.innerHTML = threadToolbarHtml(detail, 'bottom');
  const archivedNotice = detail.thread.isArchived
    ? `<div class="archived-notice">
        Chủ đề đã được lưu trữ${detail.thread.archivedAt ? ` lúc ${escapeHtml(formatPostDate(detail.thread.archivedAt))}` : ''}.
        Không thể đăng trả lời mới.
      </div>`
    : '';
  const canReply = !detail.thread.isArchived;
  els.threadDetail.innerHTML = `
    ${archivedNotice}
    ${postHtml(detail.thread, 'post op', {
      opNumber: detail.thread.globalNumber,
      opPosterHash: detail.thread.posterHash,
      canReply
    })}
    <div class="comment-list">
      ${
        detail.comments.length
          ? detail.comments
              .map((comment) =>
                postHtml(comment, 'post comment', {
                  opNumber: detail.thread.globalNumber,
                  opPosterHash: detail.thread.posterHash,
                  canReply
                })
              )
              .join('')
          : '<p class="muted">Chưa có bình luận công khai.</p>'
      }
    </div>
  `;
  const focusedPost = focusPost || currentPermalinkPost();
  focusPermalinkPost(focusedPost, { scroll: Boolean(focusPost) });
  resetAutoUpdateTimer();
}

async function loadAdmin() {
  setScreen('admin');
  const loggedIn = Boolean(state.token);
  els.loginForm.classList.toggle('hidden', loggedIn);
  els.logoutButton.classList.toggle('hidden', !loggedIn);
  if (!loggedIn) {
    els.pendingList.innerHTML = '';
    els.reportList.innerHTML = '';
    els.moderationActions.innerHTML = '';
    return;
  }

  try {
    const [pending, reports, moderationActions] = await Promise.all([
      api('/api/admin/pending'),
      api('/api/admin/reports?limit=30'),
      api('/api/admin/moderation-actions?limit=30')
    ]);
    if (!pending.length) {
      els.pendingList.innerHTML = '<p class="muted">Hàng đợi trống.</p>';
    } else {
      els.pendingList.innerHTML = pending
        .map(
          (post) => `
            <article class="pending-item" data-id="${post.id}">
              <div class="post-meta">
                <span>${post.type === 'thread' ? 'chủ đề' : 'bình luận'}</span>
                <span>No.${post.globalNumber}</span>
                <span>${post.boardSlug}</span>
                <span>AI:${post.moderationLabels.map(moderationLabelText).join(', ') || moderationStatusText(post.moderationStatus)}</span>
              </div>
              <div class="post-body">${renderPostLines(post.bodyLines || [])}</div>
              <div class="pending-actions">
                <button class="primary-button" data-action="approve" type="button">Duyệt</button>
                <button class="danger-button" data-action="delete" type="button">Xóa</button>
              </div>
            </article>
          `
        )
        .join('');
    }
    renderReports(reports);
    renderModerationActions(moderationActions);
  } catch (error) {
    state.token = '';
    localStorage.removeItem('adminToken');
    showToast(error.message);
    loadAdmin();
  }
}

function route() {
  const hash = window.location.hash || '#home';
  const [hashPath, hashQuery = ''] = hash.split('?');
  const [, name, id] = hashPath.match(/^#([^/]+)\/?(.+)?$/) || [];
  if (name === 'home' || !name) {
    loadHome().catch((error) => showToast(error.message));
  } else if (name === 'thread' && id) {
    const params = new URLSearchParams(hashQuery);
    state.threadId = decodeURIComponent(id);
    loadThread({ resetReply: true, focusPost: params.get('p') || '' }).catch((error) => showToast(error.message));
  } else if (name === 'catalog') {
    state.boardSlug = id || 'confession';
    loadCatalog().catch((error) => showToast(error.message));
  } else if (name === 'archive') {
    state.boardSlug = id || 'confession';
    loadArchive().catch((error) => showToast(error.message));
  } else if (name === 'admin') {
    loadAdmin().catch((error) => showToast(error.message));
  } else {
    state.boardSlug = id || 'confession';
    loadBoard().catch((error) => showToast(error.message));
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc ảnh'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const image = new Image();
      image.onload = () =>
        resolve({
          name: file.name,
          type: file.type,
          sizeBytes: file.size,
          width: image.naturalWidth,
          height: image.naturalHeight,
          dataUrl
        });
      image.onerror = () =>
        resolve({
          name: file.name,
          type: file.type,
          sizeBytes: file.size,
          dataUrl
        });
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function imagePreviewHtml(image) {
  return `
    <img src="${escapeHtml(image.dataUrl)}" alt="${escapeHtml(image.name)}">
    <div class="file-text">${fileTextHtml(image)}</div>
  `;
}

async function submitThread(event) {
  event.preventDefault();
  const button = event.submitter;
  const restoreButton = setButtonLoading(button);
  try {
    const payload = {
      body: els.threadBody.value,
      captchaToken: els.threadCaptcha.value,
      posterToken: state.posterToken,
      image: state.selectedImage
    };
    const result = await api(`/api/boards/${state.boardSlug}/threads`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    els.threadBody.value = '';
    els.threadImage.value = '';
    state.selectedImage = null;
    els.imagePreview.classList.add('hidden');
    closeThreadComposer();
    showToast(result.status === 'pending' ? 'Đã vào hàng đợi chờ quản trị viên duyệt.' : 'Chủ đề đã công khai.');
    await loadBoard();
  } catch (error) {
    showToast(error.message);
  } finally {
    restoreButton();
  }
}

async function submitComment(event) {
  event.preventDefault();
  if (state.threadIsArchived) {
    showToast('Chủ đề đã lưu trữ, không thể trả lời.');
    return;
  }
  const button = event.submitter || els.commentForm.querySelector('[type="submit"]');
  const restoreButton = setButtonLoading(button);
  try {
    const result = await createComment(els.commentBody.value, els.commentCaptcha.value);
    els.commentBody.value = '';
    showToast(result.status === 'pending' ? 'Bình luận đang chờ duyệt.' : 'Đã gửi.');
    closeReplyComposer();
    await loadThread();
  } catch (error) {
    showToast(error.message);
  } finally {
    restoreButton();
  }
}

async function createComment(body, captchaToken) {
  return api(`/api/threads/${state.threadId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, captchaToken, posterToken: state.posterToken })
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function positionQuickReply(event) {
  const width = Math.min(332, window.innerWidth - 8);
  const height = Math.min(334, window.innerHeight - 8);
  const left = clamp(event.clientX - 20, 6, window.innerWidth - width - 6);
  const top = clamp(event.clientY + 10, 6, window.innerHeight - height - 6);
  els.quickReply.style.left = `${left}px`;
  els.quickReply.style.top = `${top}px`;
}

function addQuoteToQuickReply(number) {
  const quote = `>>${number}`;
  const lines = els.quickReplyBody.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.includes(quote)) {
    lines.push(quote);
  }
  els.quickReplyBody.value = `${lines.join('\n')}\n`;
}

function openQuickReply(number, event) {
  if (state.threadIsArchived) {
    showToast('Chủ đề đã lưu trữ, không thể trả lời.');
    return;
  }
  const wasHidden = els.quickReply.classList.contains('hidden');
  const threadNumber = state.threadGlobalNumber || number;
  els.quickReplyTitle.textContent = `Trả lời chủ đề No.${threadNumber}`;
  if (wasHidden) {
    els.quickReplyBody.value = '';
  }
  addQuoteToQuickReply(number);
  els.quickReplyCaptcha.value = els.commentCaptcha.value || 'dev-pass';
  els.quickReplyFileName.textContent = 'Chưa chọn tệp';
  if (wasHidden) {
    positionQuickReply(event);
  }
  els.quickReply.classList.remove('hidden');
  els.refPreview.classList.add('hidden');
  window.setTimeout(() => els.quickReplyBody.focus(), 0);
}

function closeQuickReply() {
  els.quickReply.classList.add('hidden');
  state.quickReplyDrag = null;
}

async function submitQuickReply(event) {
  event.preventDefault();
  if (state.threadIsArchived) {
    showToast('Chủ đề đã lưu trữ, không thể trả lời.');
    closeQuickReply();
    return;
  }
  const button = event.submitter;
  const restoreButton = setButtonLoading(button);
  try {
    const result = await createComment(els.quickReplyBody.value, els.quickReplyCaptcha.value);
    showToast(result.status === 'pending' ? 'Bình luận đang chờ duyệt.' : 'Đã gửi.');
    closeQuickReply();
    await loadThread();
  } catch (error) {
    showToast(error.message);
  } finally {
    restoreButton();
  }
}

async function showSummary(target) {
  const box = target === 'board' ? els.boardSummary : els.threadSummary;
  const button = target === 'board' ? els.boardSummaryButton : els.threadSummaryButton;
  button.disabled = true;
  box.classList.remove('hidden');
  box.innerHTML = '<strong>Nội dung do AI tổng hợp</strong><p class="muted">Đang tóm tắt...</p>';
  try {
    const path =
      target === 'board'
        ? `/api/boards/${state.boardSlug}/summary`
        : `/api/threads/${state.threadId}/summary`;
    const result = await api(path, { method: 'POST', body: '{}' });
    box.innerHTML = `
      <strong>Nội dung do AI tổng hợp</strong>
      <ul>${result.bullets.map((bullet) => `<li>${bullet}</li>`).join('')}</ul>
    `;
  } catch (error) {
    box.innerHTML = `<strong>Nội dung do AI tổng hợp</strong><p>${error.message}</p>`;
  } finally {
    button.disabled = false;
  }
}

async function loadSuggestions() {
  els.suggestButton.disabled = true;
  els.suggestions.classList.remove('hidden');
  els.suggestions.textContent = 'Đang gợi ý...';
  try {
    const result = await api(`/api/threads/${state.threadId}/suggestions`, {
      method: 'POST',
      body: '{}'
    });
    els.suggestions.innerHTML = result.suggestions
      .map((text) => `<button type="button" data-suggestion="${encodeURIComponent(text)}">${text}</button>`)
      .join('');
  } catch (error) {
    els.suggestions.textContent = error.message;
  } finally {
    els.suggestButton.disabled = false;
  }
}

async function showReference(number, event) {
  const previewWidth = Math.min(360, window.innerWidth - 12);
  const left = clamp(event.clientX + 10, 6, window.innerWidth - previewWidth - 6);
  const top = clamp(event.clientY + 10, 6, window.innerHeight - 226);
  els.refPreview.style.left = `${left}px`;
  els.refPreview.style.top = `${top}px`;
  els.refPreview.style.maxWidth = `${previewWidth}px`;
  try {
    const result = await api(`/api/posts/${number}`);
    els.refPreview.innerHTML = postHtml(result.post, 'post', {
      opNumber: state.threadGlobalNumber,
      opPosterHash: state.threadPosterHash
    });
    els.refPreview.classList.remove('hidden');
  } catch {
    els.refPreview.textContent = `Bài >>${number} không tồn tại hoặc chưa công khai.`;
    els.refPreview.classList.remove('hidden');
  }
}

function setupRealtime() {
  const source = new EventSource('/events');
  source.addEventListener('connected', () => {
    els.socketStatus.textContent = 'trực tiếp';
    els.socketStatus.classList.add('live');
    els.socketStatus.classList.remove('offline');
  });
  source.onerror = () => {
    els.socketStatus.textContent = 'mất kết nối';
    els.socketStatus.classList.add('offline');
    els.socketStatus.classList.remove('live');
  };
  for (const eventName of ['thread:created', 'thread:bumped', 'comment:created', 'thread:archived']) {
    source.addEventListener(eventName, () => {
      const hash = window.location.hash || '#home';
      if (hash.startsWith('#home') || hash === '') {
        loadHome().catch(() => {});
      } else if (hash.startsWith('#thread/')) {
        loadThread().catch(() => {});
      } else if (hash.startsWith('#catalog/')) {
        loadCatalog().catch(() => {});
      } else if (hash.startsWith('#archive/')) {
        if (eventName === 'thread:archived') {
          loadArchive().catch(() => {});
        }
      } else if (hash.startsWith('#board/')) {
        loadBoard().catch(() => {});
      }
    });
  }
}

function bindEvents() {
  window.addEventListener('hashchange', route);
  els.homeBoardSearchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const board = findBoardByQuery(els.homeBoardSearchInput.value);
    if (!board) {
      showToast('Không tìm thấy bảng phù hợp.');
      return;
    }
    window.location.hash = `#board/${board.slug}`;
  });
  els.refreshThreads.addEventListener('click', () => loadBoard().catch((error) => showToast(error.message)));
  els.boardSearchInput.addEventListener('input', () => renderBoardThreads(state.boardThreads));
  els.catalogSearchInput.addEventListener('input', () => renderCatalogThreads(state.catalogThreads));
  els.startThreadButton.addEventListener('click', () => openThreadComposer());
  els.postReplyToggle.addEventListener('click', () => openReplyComposer());
  els.threadStartThreadButton.addEventListener('click', () => {
    window.location.hash = `#board/${state.boardSlug}?new=1`;
  });
  els.backToBoard.addEventListener('click', () => {
    window.location.hash = `#board/${state.boardSlug}`;
  });
  els.threadForm.addEventListener('submit', submitThread);
  els.commentForm.addEventListener('submit', submitComment);
  els.quickReplyForm.addEventListener('submit', submitQuickReply);
  els.quickReplyClose.addEventListener('click', closeQuickReply);
  els.quickReplyCaptchaButton.addEventListener('click', () => {
    els.quickReplyCaptcha.value = 'dev-pass';
  });
  els.quickReplyHandle.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) {
      return;
    }
    const rect = els.quickReply.getBoundingClientRect();
    state.quickReplyDrag = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    event.preventDefault();
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.quickReplyDrag) {
      return;
    }
    const rect = els.quickReply.getBoundingClientRect();
    const left = clamp(event.clientX - state.quickReplyDrag.offsetX, 4, window.innerWidth - rect.width - 4);
    const top = clamp(event.clientY - state.quickReplyDrag.offsetY, 4, window.innerHeight - rect.height - 4);
    els.quickReply.style.left = `${left}px`;
    els.quickReply.style.top = `${top}px`;
  });
  window.addEventListener('mouseup', () => {
    state.quickReplyDrag = null;
  });
  els.boardSummaryButton.addEventListener('click', () => showSummary('board'));
  els.threadSummaryButton.addEventListener('click', () => showSummary('thread'));
  els.suggestButton.addEventListener('click', loadSuggestions);
  els.threadImage.addEventListener('change', async () => {
    const file = els.threadImage.files?.[0];
    if (!file) {
      state.selectedImage = null;
      els.imagePreview.innerHTML = '';
      els.imagePreview.classList.add('hidden');
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast('Chỉ hỗ trợ ảnh.');
      els.threadImage.value = '';
      state.selectedImage = null;
      els.imagePreview.innerHTML = '';
      els.imagePreview.classList.add('hidden');
      return;
    }
    try {
      state.selectedImage = await fileToDataUrl(file);
      els.imagePreview.innerHTML = imagePreviewHtml(state.selectedImage);
      els.imagePreview.classList.remove('hidden');
    } catch (error) {
      showToast(error.message);
      els.threadImage.value = '';
      state.selectedImage = null;
      els.imagePreview.innerHTML = '';
      els.imagePreview.classList.add('hidden');
    }
  });

  document.body.addEventListener('click', async (event) => {
    const imageToggle = event.target.closest('[data-image-toggle]');
    if (imageToggle) {
      const expanded = imageToggle.classList.toggle('expanded');
      imageToggle.closest('.thread-thumb-wrap')?.classList.toggle('image-expanded', expanded);
      imageToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      return;
    }

    const quickReplyNumber = event.target.closest('[data-quick-reply]');
    if (quickReplyNumber) {
      openQuickReply(quickReplyNumber.dataset.quickReply, event);
      return;
    }

    const refreshButton = event.target.closest('[data-thread-refresh]');
    if (refreshButton) {
      await loadThread().catch((error) => showToast(error.message));
      return;
    }

    const boardRefreshButton = event.target.closest('[data-board-refresh]');
    if (boardRefreshButton) {
      await loadBoard().catch((error) => showToast(error.message));
      return;
    }

    const catalogRefreshButton = event.target.closest('[data-catalog-refresh]');
    if (catalogRefreshButton) {
      await loadCatalog().catch((error) => showToast(error.message));
      return;
    }

    const catalogSortButton = event.target.closest('[data-catalog-sort]');
    if (catalogSortButton) {
      state.catalogSort = catalogSortButton.dataset.catalogSort;
      renderCatalogThreads(state.catalogThreads);
      return;
    }

    const catalogSizeButton = event.target.closest('[data-catalog-size]');
    if (catalogSizeButton) {
      state.catalogImageSize = catalogSizeButton.dataset.catalogSize;
      renderCatalogThreads(state.catalogThreads);
      return;
    }

    const archiveRefreshButton = event.target.closest('[data-archive-refresh]');
    if (archiveRefreshButton) {
      await loadArchive().catch((error) => showToast(error.message));
      return;
    }

    const replyLink = event.target.closest('[data-open-reply]');
    if (replyLink) {
      openReplyComposer();
      els.replyComposer.scrollIntoView({ block: 'center' });
      return;
    }

    const pageTopButton = event.target.closest('[data-scroll-page-top]');
    if (pageTopButton) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const scrollButton = event.target.closest('[data-scroll-thread]');
    if (scrollButton) {
      const target = scrollButton.dataset.scrollThread === 'bottom' ? els.threadToolbarBottom : els.threadScreen;
      target.scrollIntoView({ block: scrollButton.dataset.scrollThread === 'bottom' ? 'end' : 'start' });
      return;
    }

    const quoteButton = event.target.closest('[data-quote]');
    if (quoteButton) {
      const quote = quoteButton.dataset.quote;
      openReplyComposer({ focus: false });
      const spacer = els.commentBody.value && !els.commentBody.value.endsWith('\n') ? '\n' : '';
      els.commentBody.value = `${els.commentBody.value}${spacer}${quote}\n`;
      els.commentBody.focus();
      return;
    }

    const ref = event.target.closest('.ref-link');
    if (ref) {
      await showReference(ref.dataset.ref, event);
      return;
    }
    if (!event.target.closest('.ref-preview')) {
      els.refPreview.classList.add('hidden');
    }

    const suggestion = event.target.closest('[data-suggestion]');
    if (suggestion) {
      els.commentBody.value = decodeURIComponent(suggestion.dataset.suggestion);
      els.commentBody.focus();
      return;
    }

    const reportButton = event.target.closest('[data-report]');
    if (reportButton) {
      const reason = window.prompt(`Lý do báo cáo No.${reportButton.dataset.report}:`, '');
      if (!reason) {
        return;
      }
      try {
        await api(`/api/posts/${reportButton.dataset.report}`, {
          method: 'POST',
          body: JSON.stringify({ reason, posterToken: state.posterToken })
        });
        showToast('Đã gửi báo cáo.');
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const pendingButton = event.target.closest('[data-action]');
    if (pendingButton) {
      const item = pendingButton.closest('.pending-item');
      const action = pendingButton.dataset.action;
      const ok = window.confirm(action === 'approve' ? 'Duyệt bài này?' : 'Xóa bài này?');
      if (!ok) {
        return;
      }
      const reason =
        window.prompt(action === 'approve' ? 'Lý do duyệt (tùy chọn):' : 'Lý do xóa (tùy chọn):', '') || '';
      try {
        await api(
          action === 'approve'
            ? `/api/admin/pending/${item.dataset.id}/approve`
            : `/api/admin/pending/${item.dataset.id}`,
          {
            method: action === 'approve' ? 'POST' : 'DELETE',
            body: JSON.stringify({ reason })
          }
        );
        showToast(action === 'approve' ? 'Đã duyệt.' : 'Đã xóa.');
        await loadAdmin();
      } catch (error) {
        showToast(error.message);
      }
    }
  });

  document.body.addEventListener('change', (event) => {
    const autoUpdate = event.target.closest('[data-auto-update]');
    if (autoUpdate) {
      setAutoUpdate(autoUpdate.checked);
    }
  });

  els.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          username: els.adminUsername.value,
          password: els.adminPassword.value
        })
      });
      state.token = result.token;
      localStorage.setItem('adminToken', state.token);
      els.adminPassword.value = '';
      await loadAdmin();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.logoutButton.addEventListener('click', () => {
    state.token = '';
    localStorage.removeItem('adminToken');
    loadAdmin();
  });
}

async function init() {
  bindEvents();
  setupRealtime();
  const config = await api('/api/config');
  state.boards = config.boards;
  state.boardGroups = config.boardGroups || [];
  route();
}

init().catch((error) => showToast(error.message));
