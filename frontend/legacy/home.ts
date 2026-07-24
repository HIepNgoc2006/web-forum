import { api } from './api';
import { boardPostCount } from './board';
import { takePreloadedBoardThreads } from './board-preload';
import { els } from './dom';
import {
  escapeHtml,
  formatPostDate,
  mediaThumbnailSrc,
  plainPreview
} from './format';
import { state } from './state';
import { filterHiddenBoards, isHiddenBoardSlug } from './board-visibility';
import { latestPostHref, mediaItemsFromPost } from './thread';
import type { AnyRecord } from './types';
import {
  hiddenBoardSlugs,
  myPosts,
  subscribedBoardSlugs,
  writeHiddenBoardSlugs,
  writeSubscribedBoardSlugs
} from './storage';

export function isBoardHidden(slug = state.boardSlug) {
  return isHiddenBoardSlug(slug, hiddenBoardSlugs());
}

export function visibleBoards(boards = state.boards) {
  const list = Array.isArray(boards) ? boards : [];
  const hidden = hiddenBoardSlugs();
  return filterHiddenBoards(list, hidden);
}

export function createHomeController(dependencies: AnyRecord = {}) {
  const {
    isPostFiltered,
    writeBoardThreadsCache,
    persistAccountSettings = () => null,
    syncAdminBoardFilter,
    showToast
  } = dependencies;

  return {
    loadHomeThreadsByBoard() {
      return loadHomeThreadsByBoard({ writeBoardThreadsCache });
    },
    renderPopularThreads(threads) {
      return renderPopularThreads(threads, { isPostFiltered });
    },
    renderLatestPosts(posts) {
      return renderLatestPosts(posts, { isPostFiltered });
    },
    renderBoards,
    refreshPublicBoards,
    isBoardSubscribed,
    toggleBoardSubscription,
    syncBoardSubscriptionButtons,
    isBoardHidden,
    toggleBoardHidden,
    syncBoardHiddenButtons
  };

  function renderBoards() {
    // Short board codes keep the topbar compact (classic imageboard style).
    // Full display name stays in the title tooltip.
    const boards = visibleBoards(state.boards);
    if (!boards.length && state.boards?.length) {
      els.boardNav.innerHTML =
        '<span class="muted board-nav-empty" title="Không có bảng hiển thị. Bỏ ẩn trong Cài đặt tài khoản.">—</span>';
      return;
    }
    els.boardNav.innerHTML = boards
      .map((board) => {
        const slug = String(board.slug || '');
        const label = escapeHtml(slug);
        const title = escapeHtml(board.name ? `${board.name} (/${slug}/)` : `/${slug}/`);
        const active = board.slug === state.boardSlug ? 'active' : '';
        return `<a class="${active}" href="#board/${encodeURIComponent(slug)}" title="${title}">${label}</a>`;
      })
      .join('');
  }

  async function refreshPublicBoards({ fallbackBoards = state.boards }: AnyRecord = {}) {
    try {
      state.boards = await api('/api/boards');
    } catch {
      state.boards = fallbackBoards;
    }
    renderBoards();
    if (syncAdminBoardFilter) {
      syncAdminBoardFilter();
    }
    return state.boards;
  }

  function isBoardSubscribed(slug = state.boardSlug) {
    return subscribedBoardSlugs().has(String(slug));
  }

  async function toggleBoardSubscription(slug = state.boardSlug) {
    const items = subscribedBoardSlugs();
    const safeSlug = String(slug);
    if (items.has(safeSlug)) {
      items.delete(safeSlug);
      if (showToast) {
        showToast('Đã bỏ theo dõi bảng.');
      }
    } else {
      items.add(safeSlug);
      if (showToast) {
        showToast('Đã theo dõi bảng.');
      }
    }
    writeSubscribedBoardSlugs([...items]);
    await persistAccountSettings({ silent: true });
  }

  function syncBoardSubscriptionButtons() {
    const label = isBoardSubscribed(state.boardSlug) ? 'Bỏ theo dõi bảng' : 'Theo dõi bảng';
    document.querySelectorAll('[data-toggle-board-subscription]').forEach((button) => {
      button.textContent = label;
    });
  }

  async function toggleBoardHidden(slug = state.boardSlug) {
    const items = hiddenBoardSlugs();
    const safeSlug = String(slug);
    if (items.has(safeSlug)) {
      items.delete(safeSlug);
      if (showToast) {
        showToast('Đã hiện lại bảng trên trang chủ.');
      }
    } else {
      items.add(safeSlug);
      if (showToast) {
        showToast('Đã ẩn bảng khỏi trang chủ.');
      }
    }
    writeHiddenBoardSlugs([...items]);
    syncBoardHiddenButtons();
    renderBoards();
    await persistAccountSettings({ silent: true });
  }

  function syncBoardHiddenButtons() {
    const label = isBoardHidden(state.boardSlug) ? 'Hiện bảng' : 'Ẩn bảng';
    document.querySelectorAll('[data-toggle-board-hidden]').forEach((button) => {
      button.textContent = label;
    });
  }
}



export function homeBoardList() {
  const publicBoardsBySlug = new Map(state.boards.map((board) => [board.slug, board]));
  const groupedBoards = state.boardGroups
    .flatMap((group) => group.boards || [])
    .map((board) => publicBoardsBySlug.get(board.slug))
    .filter(Boolean);
  const source = groupedBoards.length ? [...groupedBoards, ...state.boards] : state.boards;
  const seen = new Set();
  return visibleBoards(
    source.filter((board) => {
      if (!board || seen.has(board.slug)) {
        return false;
      }
      seen.add(board.slug);
      return true;
    })
  );
}

export async function loadHomeThreadsByBoard({ writeBoardThreadsCache }: AnyRecord) {
  const entries = await Promise.all(
    state.boards.map(async (board) => {
      try {
        const preloaded = takePreloadedBoardThreads(board.slug);
        const threads = preloaded || (await api(`/api/boards/${board.slug}/threads`));
        writeBoardThreadsCache(board.slug, threads, {
          page: 1,
          pageSize: state.boardPageSize,
          sort: state.boardSort,
          filter: state.boardFilter,
          q: ''
        });
        return [board.slug, threads];
      } catch {
        return [board.slug, []];
      }
    })
  );
  return Object.fromEntries(entries);
}

export function renderHomeBoards(
  threadsByBoard: AnyRecord = {},
  stats: AnyRecord = {},
  boardPostCounts: AnyRecord = {}
) {
  const boards = homeBoardList();
  if (!boards.length) {
    els.homeBoards.innerHTML =
      '<p class="muted">Không có bảng hiển thị. Bỏ ẩn trong Cài đặt tài khoản.</p>';
    return;
  }
  const rows = boards
    .map((board) => {
      const postCount = Object.hasOwn(boardPostCounts, board.slug)
        ? Number(boardPostCounts[board.slug] || 0)
        : boardPostCount(threadsByBoard[board.slug]);
      const boardUsers = Number(stats.boardUsers?.[board.slug] || 0);
      return `
        <tr>
          <td class="portal-board-icon-cell"><span class="board-row-icon" aria-hidden="true"></span></td>
          <td class="portal-board-name-cell" data-label="Bảng">
            <a class="portal-board-link" href="#board/${board.slug}" title="${escapeHtml(board.description)}">
              <span class="board-path">${escapeHtml(board.path)}</span> - ${escapeHtml(board.name)}
            </a>
          </td>
          <td class="portal-board-desc-cell" data-label="Mô tả">${escapeHtml(board.description)}</td>
          <td class="portal-board-number-cell portal-board-users-cell" data-label="Người dùng">${boardUsers.toLocaleString()}</td>
          <td class="portal-board-number-cell portal-board-posts-cell" data-label="Bài viết">${postCount.toLocaleString()}</td>
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

export function spoilerSummaryLabelHtml() {
  return '<span class="summary-spoiler-label">Spoiler</span>';
}

export function popularThumbnailHtml(firstMedia, initials) {
  const thumbnailSrc = mediaThumbnailSrc(firstMedia);
  if (!firstMedia || !thumbnailSrc) {
    return `<span class="popular-placeholder">${escapeHtml(initials)}</span>`;
  }
  const spoiler = Boolean(firstMedia.spoiler);
  return `
    <span class="popular-thumb${spoiler ? ' spoiler-summary-thumb' : ''}">
      <img src="${escapeHtml(thumbnailSrc)}" alt="${escapeHtml(firstMedia.name)}">
      ${spoiler ? spoilerSummaryLabelHtml() : ''}
    </span>
  `;
}

export function renderPopularThreads(threads, { isPostFiltered }: AnyRecord) {
  const visibleThreads = threads.filter(
    (thread) => !isPostFiltered(thread) && !isBoardHidden(thread.boardSlug)
  );
  if (!visibleThreads.length) {
    els.popularThreads.classList.add('popular-empty');
    els.popularThreads.innerHTML = `
      <p>
        Chưa có chủ đề nổi bật. Chủ đề công khai sẽ xuất hiện ở đây sau khi có người đăng bài.
      </p>
    `;
    return;
  }

  els.popularThreads.classList.remove('popular-empty');
  els.popularThreads.innerHTML = visibleThreads
    .map((thread) => {
      const board = state.boards.find((item) => item.slug === thread.boardSlug);
      const href = `#thread/${thread.id}`;
      const title = plainPreview(thread.bodyLines, board?.description).slice(0, 120);
      const initials = (board?.name || thread.boardSlug).slice(0, 2).toUpperCase();
      const firstMedia = mediaItemsFromPost(thread)[0];

      return `
        <a class="popular-item" href="${href}">
          <strong>${escapeHtml(board?.name || thread.boardSlug)}</strong>
          ${popularThumbnailHtml(firstMedia, initials)}
          <span>${escapeHtml(title)}${title.length >= 120 ? '...' : ''}</span>
        </a>
      `;
    })
    .join('');
}

export function renderLatestPosts(posts, { isPostFiltered }: AnyRecord) {
  const visiblePosts = posts.filter((post) => !isPostFiltered(post) && !isBoardHidden(post.boardSlug));
  if (!visiblePosts.length) {
    els.latestPosts.innerHTML = '<p class="latest-empty">Chưa có bài công khai.</p>';
    return;
  }

  els.latestPosts.innerHTML = visiblePosts
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

export function renderMyPosts() {
  const items = myPosts();
  if (!items.length) {
    els.myPosts.innerHTML = '<p class="latest-empty">Chưa có bài nào được ghi nhớ trên trình duyệt này.</p>';
    return;
  }

  els.myPosts.innerHTML = items
    .slice(0, 10)
    .map((item) => {
      const href = `#thread/${encodeURIComponent(item.threadId)}?p=${encodeURIComponent(item.globalNumber)}`;
      const type = item.type === 'comment' ? 'Phản hồi' : 'Chủ đề';
      const preview = item.preview || 'Không có nội dung';
      return `
        <div class="watch-item">
          <a class="watch-thread-link" href="${href}">
            <span class="watch-board">/${escapeHtml(item.boardSlug || '?')}/</span>
            <span class="watch-number">No.${escapeHtml(item.globalNumber)}</span>
            <span class="watch-seen">${type}</span>
            <span class="watch-preview">${escapeHtml(preview)}${preview.length >= 160 ? '...' : ''}</span>
            <span class="watch-stats">${formatPostDate(item.createdAt)}</span>
          </a>
        </div>
      `;
    })
    .join('');
}

export function renderSubscribedBoards() {
  const slugs = subscribedBoardSlugs();
  const boards = state.boards.filter((board) => slugs.has(board.slug));
  if (!boards.length) {
    els.subscribedBoards.innerHTML = '<p class="latest-empty">Chưa theo dõi bảng nào. Vào board và bấm [Theo dõi bảng].</p>';
    return;
  }

  els.subscribedBoards.innerHTML = `
    <table class="hot-board-table">
      <thead>
        <tr>
          <th scope="col">Bảng</th>
          <th scope="col">Mô tả</th>
          <th scope="col">Mở</th>
        </tr>
      </thead>
      <tbody>
        ${boards
          .map(
            (board) => `
              <tr>
                <td><a href="#board/${board.slug}">${escapeHtml(board.path)} ${escapeHtml(board.name)}</a></td>
                <td>${escapeHtml(board.description)}</td>
                <td><a href="#catalog/${board.slug}">Danh mục</a></td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

export function renderHotBoards(boards) {
  const visible = (Array.isArray(boards) ? boards : []).filter((item) => !isBoardHidden(item.boardSlug));
  if (!visible.length) {
    els.hotBoards.innerHTML = boards?.length
      ? '<p class="latest-empty">Không có bảng hiển thị. Bỏ ẩn trong Cài đặt tài khoản.</p>'
      : '<p class="latest-empty">Chưa có bảng nào nóng trong 24 giờ qua.</p>';
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
        ${visible
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

export function renderCampusPulse(items) {
  if (!items.length) {
    els.campusPulse.innerHTML = '<p class="latest-empty">Chưa đủ dữ liệu công khai trong 24 giờ qua.</p>';
    return;
  }
  els.campusPulse.innerHTML = `
    <table class="hot-board-table">
      <thead>
        <tr>
          <th scope="col">Từ khóa</th>
          <th scope="col">Lần nhắc</th>
          <th scope="col">Bảng</th>
          <th scope="col">Mới nhất</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${escapeHtml(item.keyword)}</td>
                <td>${item.count}</td>
                <td>${item.boardCount}</td>
                <td>${escapeHtml(item.latestActivityAt ? formatPostDate(item.latestActivityAt) : '-')}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

export function renderStats(stats) {
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

