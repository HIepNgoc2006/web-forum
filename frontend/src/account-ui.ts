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
      return '<p class="latest-empty">Chưa lưu tìm kiếm nào.</p>';
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
      : '<p class="latest-empty">Chưa có bộ lọc nội dung nào.</p>';

    return `
      <div class="content-filter-manager">
        ${list}
        <div class="content-filter-form">
          <select data-content-filter-type aria-label="Loại bộ lọc">
            <option value="keyword">Từ khóa</option>
            <option value="poster">Poster ID</option>
          </select>
          <input data-content-filter-value maxlength="160" placeholder="từ khóa hoặc ID" />
          <select data-content-filter-board aria-label="Phạm vi bảng">${privateBoardOptions()}</select>
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
      : '<p class="latest-empty">Chưa có mẫu trả lời nào.</p>';

    return `
      <div class="reply-template-manager">
        ${list}
        <div class="reply-template-form">
          <input data-reply-template-title maxlength="120" placeholder="tên mẫu" />
          <select data-reply-template-board aria-label="Phạm vi bảng">${privateBoardOptions()}</select>
          <textarea data-reply-template-body maxlength="5000" rows="3" placeholder="nội dung mẫu"></textarea>
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
      : '<p class="latest-empty">Chưa có ghi chú Poster ID nào.</p>';

    return `
      <div class="poster-note-manager">
        ${list}
        <div class="poster-note-form">
          <input data-poster-note-id maxlength="80" placeholder="ID:ABCD1234" />
          <input data-poster-note-label maxlength="120" placeholder="nhãn ngắn" />
          <select data-poster-note-board aria-label="Phạm vi bảng">${privateBoardOptions()}</select>
          <input data-poster-note-text maxlength="500" placeholder="ghi chú" />
          <button class="ghost-button" data-add-poster-note type="button">[Thêm]</button>
        </div>
      </div>
    `;
  }

  function renderAccountPrivateData() {
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
      <section>
        <h3>Watchlist</h3>
        <p>${Number(data.watchlist?.length || 0).toLocaleString()} chủ đề đang theo dõi.</p>
      </section>
      <section>
        <h3>Saved searches</h3>
        ${renderSavedSearches()}
      </section>
      <section>
        <h3>Drafts</h3>
        <p>${Number(data.drafts?.length || 0).toLocaleString()} draft đang lưu.</p>
      </section>
      <section>
        <h3>Bộ lọc nội dung</h3>
        ${renderContentFilters()}
      </section>
      <section>
        <h3>Mẫu trả lời</h3>
        ${renderReplyTemplates()}
      </section>
      <section>
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
    if (!state.accountToken) {
      return null;
    }
    try {
      const account = await api('/api/account/me', { auth: 'account' });
      state.account = account;
      applyAccountSyncedSettings(account);
      updateAccountNav();
      await loadAccountPrivateData({ mergeLocal: true });
      await refreshAccountPostNumbers();
      return account;
    } catch {
      setAccountSession();
      return null;
    }
  }

  async function loadAccountSettings() {
    setScreen('account');
    setFormError(els.accountSettingsError);
    syncAccountHomeBoardOptions();
    if (!state.account && state.accountToken) {
      await loadAccountSession();
    }
    if (state.account && state.accountToken && !state.accountPrivateData) {
      await loadAccountPrivateData({ mergeLocal: true });
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
    setFormError(els.recoveryCodeError);
  }

  return {
    renderSavedSearches,
    renderContentFilters,
    renderReplyTemplates,
    renderPosterNotes,
    renderAccountPrivateData,
    renderAccountRecoveryPanel,
    saveCurrentBoardSearch,
    removeSavedSearch,
    loadAccountSession,
    loadAccountSettings
  };
}
