import { defaultAccountPrivateData } from './account';
import { filterTypeLabel, escapeHtml } from './format';
import type { AnyRecord } from './types';

export function createAccountUiController({
  state,
  els,
  api,
  showToast,
  setScreen,
  setFormError,
  syncAccountHomeBoardOptions,
  applyAccountSyncedSettings,
  fillAccountSettings,
  updateAccountNav,
  readSavedSearches,
  writeSavedSearches,
  readContentFilters,
  readReplyTemplates,
  readPosterNotes,
  readHiddenPosts,
  readHiddenThreads,
  renderReplyTemplatePickers,
  setAccountSession,
  refreshAccountPostNumbers,
  loadAccountPrivateData,
  loadCurrentBoard,
  render2FAState
}: AnyRecord) {
  function privateBoardOptions() {
    return ['<option value="">Tất cả bảng</option>', ...state.boards.map((board) => `<option value="${escapeHtml(board.slug)}">${escapeHtml(board.path)} ${escapeHtml(board.name)}</option>`)]
      .join('');
  }

  function renderSavedSearches() {
    const searches = readSavedSearches();
    if (!searches.length) {
      return '<p class="latest-empty account-private-empty">Chưa lưu tìm kiếm nào.</p>';
    }
    return searches
      .slice(0, 10)
      .map((item) => {
        const board = state.boards.find((entry) => entry.slug === item.boardSlug);
        const label = item.label || `${board?.path || `/${item.boardSlug}/`} ${item.query}`;
        return `
        <div class="watch-item">
          <a class="watch-thread-link" href="#board/${encodeURIComponent(item.boardSlug)}?q=${encodeURIComponent(item.query)}">
            <span class="watch-board">${escapeHtml(board?.path || `/${item.boardSlug}/`)}</span>
            <span class="watch-preview">${escapeHtml(label)}</span>
          </a>
          <button class="link-button watch-remove" data-remove-saved-search="${escapeHtml(`${item.boardSlug}:${item.query}`)}" type="button">[Xóa]</button>
        </div>
      `;
      })
      .join('');
  }

  function renderContentFilters() {
    const filters = readContentFilters();
    const list = filters.length
      ? filters
          .map((filter) => {
            const board = filter.boardSlug ? `/${filter.boardSlug}/` : 'Tất cả';
            const label = filter.label || filter.value;
            return `
            <div class="watch-item">
              <div class="watch-thread-link">
                <span class="watch-board">${escapeHtml(filterTypeLabel(filter.type))}</span>
                <span class="watch-preview">${escapeHtml(label)}</span>
                <span class="watch-stats">${escapeHtml(board)}</span>
              </div>
              <button class="link-button watch-remove" data-remove-content-filter="${escapeHtml(filter.id)}" type="button">[Xóa]</button>
            </div>
          `;
          })
          .join('')
      : '<p class="latest-empty account-private-empty">Chưa có bộ lọc nội dung nào.</p>';

    return `
      <div class="content-filter-manager">
        ${list}
        <div class="content-filter-form">
          <select id="accountContentFilterType" name="contentFilterType" data-content-filter-type aria-label="Loại bộ lọc">
            <option value="keyword">Từ khóa</option>
            <option value="poster">Poster ID</option>
          </select>
          <input id="accountContentFilterValue" name="contentFilterValue" data-content-filter-value maxlength="160" placeholder="từ khóa hoặc ID" aria-label="Giá trị bộ lọc" />
          <select id="accountContentFilterBoard" name="contentFilterBoard" data-content-filter-board aria-label="Phạm vi bảng">${privateBoardOptions()}</select>
          <button class="ghost-button" data-add-content-filter type="button">[Thêm]</button>
        </div>
      </div>
    `;
  }

  function renderReplyTemplates() {
    const templates = readReplyTemplates();
    const list = templates.length
      ? templates
          .map((template) => {
            const board = template.boardSlug ? `/${template.boardSlug}/` : 'Tất cả';
            const preview = template.body.length > 140 ? `${template.body.slice(0, 140)}...` : template.body;
            return `
            <div class="watch-item">
              <div class="watch-thread-link">
                <span class="watch-board">${escapeHtml(template.title)}</span>
                <span class="watch-preview">${escapeHtml(preview)}</span>
                <span class="watch-stats">${escapeHtml(board)}</span>
              </div>
              <button class="link-button watch-remove" data-remove-reply-template="${escapeHtml(template.id)}" type="button">[Xóa]</button>
            </div>
          `;
          })
          .join('')
      : '<p class="latest-empty account-private-empty">Chưa có mẫu trả lời nào.</p>';

    return `
      <div class="reply-template-manager">
        ${list}
        <div class="reply-template-form">
          <input id="accountReplyTemplateTitle" name="replyTemplateTitle" data-reply-template-title maxlength="120" placeholder="tên mẫu" aria-label="Tên mẫu trả lời" />
          <select id="accountReplyTemplateBoard" name="replyTemplateBoard" data-reply-template-board aria-label="Phạm vi bảng">${privateBoardOptions()}</select>
          <textarea id="accountReplyTemplateBody" name="replyTemplateBody" data-reply-template-body maxlength="5000" rows="3" placeholder="nội dung mẫu" aria-label="Nội dung mẫu trả lời"></textarea>
          <button class="ghost-button" data-add-reply-template type="button">[Thêm]</button>
        </div>
      </div>
    `;
  }

  function renderPosterNotes() {
    const notes = readPosterNotes();
    const list = notes.length
      ? notes
          .map((note) => {
            const board = note.boardSlug ? `/${note.boardSlug}/` : 'Tất cả';
            const label = note.label || note.note || note.posterId;
            return `
            <div class="watch-item">
              <div class="watch-thread-link">
                <span class="watch-board">${escapeHtml(note.posterId)}</span>
                <span class="watch-preview">${escapeHtml(label)}</span>
                <span class="watch-stats">${escapeHtml(board)}</span>
              </div>
              <button class="link-button watch-remove" data-remove-poster-note="${escapeHtml(note.id)}" type="button">[Xóa]</button>
            </div>
          `;
          })
          .join('')
      : '<p class="latest-empty account-private-empty">Chưa có ghi chú Poster ID nào.</p>';

    return `
      <div class="poster-note-manager">
        ${list}
        <div class="poster-note-form">
          <input id="accountPosterNoteId" name="posterNoteId" data-poster-note-id maxlength="80" placeholder="ID:ABCD1234" aria-label="Poster ID" />
          <input id="accountPosterNoteLabel" name="posterNoteLabel" data-poster-note-label maxlength="120" placeholder="nhãn ngắn" aria-label="Nhãn ghi chú Poster ID" />
          <select id="accountPosterNoteBoard" name="posterNoteBoard" data-poster-note-board aria-label="Phạm vi bảng">${privateBoardOptions()}</select>
          <input id="accountPosterNoteText" name="posterNoteText" data-poster-note-text maxlength="500" placeholder="ghi chú" aria-label="Ghi chú Poster ID" />
          <button class="ghost-button" data-add-poster-note type="button">[Thêm]</button>
        </div>
      </div>
    `;
  }

  function renderBrowserHiddenData() {
    const posts = (typeof readHiddenPosts === 'function' ? readHiddenPosts() : []).sort(
      (a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b))
    );
    const threads = (typeof readHiddenThreads === 'function' ? readHiddenThreads() : []).sort((a, b) =>
      String(a).localeCompare(String(b))
    );
    const knownThreads = Array.isArray(state.boardThreads) ? state.boardThreads : [];
    const threadMetaById = new Map<string, AnyRecord>(
      knownThreads.map((thread: AnyRecord) => [String(thread.id || ''), thread])
    );
    const loggedIn = Boolean(state.accountToken && state.account);
    const syncNote = loggedIn
      ? 'Đang đồng bộ với tài khoản — dùng được trên nhiều thiết bị khi đăng nhập.'
      : 'Chỉ lưu trên trình duyệt này. Đăng nhập để đồng bộ ẩn bài/chủ đề giữa các thiết bị.';
    const postList = posts.length
      ? posts
          .map(
            (number) => `
            <div class="watch-item hidden-item">
              <div class="watch-thread-link">
                <span class="watch-board">Bài</span>
                <span class="watch-preview">No.${escapeHtml(number)}</span>
              </div>
              <button class="primary-button watch-remove unhide-action" data-unhide-post="${escapeHtml(number)}" type="button">[Hiện lại]</button>
            </div>
          `
          )
          .join('')
      : '<p class="latest-empty">Chưa ẩn bài nào. Khi ẩn trong thread, bài vẫn còn dòng stub [Hiện lại].</p>';
    const threadList = threads.length
      ? threads
          .map((id) => {
            const meta = threadMetaById.get(String(id));
            const number = meta?.globalNumber ? `No.${meta.globalNumber}` : '';
            const shortId = String(id).length > 12 ? `${String(id).slice(0, 8)}…` : String(id);
            const label = number || shortId;
            return `
            <div class="watch-item hidden-item">
              <div class="watch-thread-link">
                <span class="watch-board">Chủ đề</span>
                <span class="watch-preview" title="${escapeHtml(id)}">${escapeHtml(label)}</span>
                ${number ? `<a class="link-button" href="#thread/${escapeHtml(id)}">[Mở]</a>` : ''}
              </div>
              <button class="primary-button watch-remove unhide-action" data-unhide-thread="${escapeHtml(id)}" type="button">[Hiện lại]</button>
            </div>
          `;
          })
          .join('')
      : '<p class="latest-empty">Chưa ẩn chủ đề nào. Ẩn từ bảng bằng [Ẩn chủ đề] — dòng stub vẫn hiện trên bảng.</p>';

    if (els.topbarHiddenThreadsCount) {
      els.topbarHiddenThreadsCount.textContent = `(${threads.length})`;
      els.topbarHiddenThreadsCount.setAttribute('aria-label', `${threads.length} chủ đề đã ẩn`);
    }
    if (els.topbarHiddenThreadsList) {
      els.topbarHiddenThreadsList.innerHTML = threads.length
        ? threads
            .map((id) => {
              const meta = threadMetaById.get(String(id));
              const number = meta?.globalNumber ? `No.${meta.globalNumber}` : '';
              const shortId = String(id).length > 12 ? `${String(id).slice(0, 8)}…` : String(id);
              const label = number || shortId;
              return `
                <div class="topbar-hidden-item">
                  <a data-topbar-hidden-menu-close data-topbar-hidden-thread-link href="#thread/${encodeURIComponent(String(id))}" title="${escapeHtml(id)}">${escapeHtml(label)}</a>
                  <button class="link-button" data-unhide-thread="${escapeHtml(id)}" type="button">[Hiện lại]</button>
                </div>
              `;
            })
            .join('')
        : '<p class="topbar-hidden-empty">Chưa ẩn chủ đề nào.</p>';
    }

    if (!els.browserHiddenSummary) {
      return;
    }

    els.browserHiddenSummary.innerHTML = `
      <p class="muted">${syncNote}</p>
      <section class="hidden-section">
        <h3>Bài đã ẩn (${posts.length})</h3>
        <div class="hidden-item-list">${postList}</div>
      </section>
      <section class="hidden-section">
        <h3>Chủ đề đã ẩn (${threads.length})</h3>
        <div class="hidden-item-list">${threadList}</div>
      </section>
    `;
  }

  function renderAccountPrivateData() {
    renderBrowserHiddenData();
    if (!els.accountPrivateDataPanel || !els.accountPrivateDataSummary) {
      renderReplyTemplatePickers();
      return;
    }
    const loggedIn = Boolean(state.accountToken && state.account);
    els.accountPrivateDataPanel.classList.toggle('hidden', !loggedIn);
    if (!loggedIn) {
      els.accountPrivateDataSummary.innerHTML = '';
      renderReplyTemplatePickers();
      return;
    }

    const data = state.accountPrivateData || defaultAccountPrivateData();
    els.accountPrivateDataSummary.innerHTML = `
      <section class="account-private-section">
        <h3>Watchlist</h3>
        <p class="account-private-meta">${Number(data.watchlist?.length || 0).toLocaleString()} chủ đề đang theo dõi.</p>
      </section>
      <section class="account-private-section">
        <h3>Saved searches</h3>
        ${renderSavedSearches()}
      </section>
      <section class="account-private-section">
        <h3>Drafts</h3>
        <p class="account-private-meta">${Number(data.drafts?.length || 0).toLocaleString()} draft đang lưu.</p>
      </section>
      <section class="account-private-section">
        <h3>Bộ lọc nội dung</h3>
        ${renderContentFilters()}
      </section>
      <section class="account-private-section">
        <h3>Mẫu trả lời</h3>
        ${renderReplyTemplates()}
      </section>
      <section class="account-private-section">
        <h3>Ghi chú Poster ID</h3>
        ${renderPosterNotes()}
      </section>
    `;
    renderReplyTemplatePickers();
  }

  function saveCurrentBoardSearch() {
    const query = (els.boardSearchInput.value || state.boardSearchTerm || '').trim();
    if (!query) {
      showToast('Nhập từ khóa trước khi lưu tìm kiếm.');
      return;
    }
    const board = loadCurrentBoard();
    if (!board) {
      showToast('Không tìm thấy bảng để lưu tìm kiếm.');
      return;
    }
    const key = `${board.slug}:${query}`;
    const searches = readSavedSearches().filter((item) => `${item.boardSlug}:${item.query}` !== key);
    searches.unshift({
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      boardSlug: board.slug,
      query,
      label: `${board.path} ${query}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    writeSavedSearches(searches);
    renderAccountPrivateData();
    showToast(state.accountToken ? 'Đã lưu tìm kiếm vào tài khoản.' : 'Đã lưu tìm kiếm trên trình duyệt.');
  }

  function removeSavedSearch(key) {
    const searches = readSavedSearches().filter((item) => `${item.boardSlug}:${item.query}` !== key);
    writeSavedSearches(searches);
    renderAccountPrivateData();
    showToast('Đã xóa tìm kiếm đã lưu.');
  }

  async function loadAccountSession() {
    updateAccountNav();
    renderBrowserHiddenData();
    if (!state.accountToken) {
      return null;
    }
    try {
      const account = await api('/api/account/me', { auth: 'account' });
      state.account = account;
      applyAccountSyncedSettings(account);
      updateAccountNav();
      await loadAccountPrivateData();
      await refreshAccountPostNumbers();
      return account;
    } catch {
      setAccountSession();
      return null;
    }
  }

  async function loadAccountSettings() {
    setScreen('account');
    // Show settings immediately so anonymous users always see hide-list + local prefs,
    // even if board option sync or account session refresh is slow/fails.
    if (els.accountSettingsForm) {
      els.accountSettingsForm.classList.remove('hidden');
    }
    setFormError(els.accountSettingsError);
    try {
      syncAccountHomeBoardOptions();
    } catch {
      // Boards may not be loaded yet; fillAccountSettings still works with local prefs.
    }
    if (!state.account && state.accountToken) {
      await loadAccountSession();
    }
    if (state.account && state.accountToken && !state.accountPrivateData) {
      await loadAccountPrivateData();
    }
    fillAccountSettings();
    window.scrollTo({ top: 0 });
  }

  function renderAccountRecoveryPanel() {
    if (!els.accountRecoveryPanel) {
      return;
    }
    const loggedIn = Boolean(state.accountToken && state.account);
    els.accountRecoveryPanel.classList.toggle('hidden', !loggedIn);
    els.recoveryCodeResult.classList.add('hidden');
    els.recoveryCodeResultValue.textContent = '';
    els.recoveryEmailRequestForm?.classList.toggle('hidden', !loggedIn || !state.account?.emailVerified);
    els.recoveryEmailConfirmForm?.classList.add('hidden');
    if (els.recoveryEmailCode) {
      els.recoveryEmailCode.value = '';
    }
    setFormError(els.recoveryCodeError);
    setFormError(els.recoveryEmailRequestError);
    setFormError(els.recoveryEmailConfirmError);
  }

  return {
    renderSavedSearches,
    renderContentFilters,
    renderReplyTemplates,
    renderPosterNotes,
    renderBrowserHiddenData,
    renderAccountPrivateData,
    renderAccountRecoveryPanel,
    saveCurrentBoardSearch,
    removeSavedSearch,
    loadAccountSession,
    loadAccountSettings
  };
}
