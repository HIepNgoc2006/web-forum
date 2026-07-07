import type { AnyRecord } from './types';
import {
  defaultAccountPrivateData,
  mergeByKey,
  normalizeAccountPrivateData,
  normalizeContentFilters,
  normalizePosterNotes,
  normalizeReplyTemplates,
  privateItemId,
  safePrivateText
} from './account';
import {
  contentFiltersKey,
  myPostsKey,
  posterNotesKey,
  replyTemplatesKey,
  savedSearchesKey,
  watchedThreadsKey
} from './constants';
import { normalizeSearchValue, posterId, plainPreview, postDisplayName } from './format';
import {
  defaultDeletePassword,
  normalizeDeletePassword,
  localDraftEntries,
  parseDraftKey,
  readJsonLocal,
  readLocalList,
  myPosts,
  writeJsonLocal
} from './storage';
import { api as defaultApi } from './api';
import { state } from './state';

export function createAccountStateController({
  api = defaultApi,
  showToast,
  setAccountSession,
  renderAccountPrivateData,
  renderReplyTemplatePickers
}: AnyRecord = {}) {
  const apiCall = api || defaultApi;

  function accountDraftSyncEnabled() {
    return state.account?.settings?.syncDrafts !== false;
  }

  function readSavedSearches() {
    if (state.accountToken && state.accountPrivateData) {
      return Array.isArray(state.accountPrivateData.savedSearches) ? state.accountPrivateData.savedSearches : [];
    }
    return readLocalList(savedSearchesKey).filter((item) => item && typeof item === 'object');
  }

  function writeSavedSearches(savedSearches) {
    const items = savedSearches.filter((item) => item?.boardSlug && item?.query).slice(0, 50);
    writeJsonLocal(savedSearchesKey, items);
    if (state.accountToken && state.accountPrivateData) {
      state.accountPrivateData.savedSearches = items;
      scheduleAccountPrivateDataSave();
    }
  }

  function readContentFilters() {
    if (state.accountToken && state.accountPrivateData) {
      return normalizeContentFilters(state.accountPrivateData.contentFilters);
    }
    return normalizeContentFilters(readLocalList(contentFiltersKey));
  }

  function writeContentFilters(filters) {
    const items = normalizeContentFilters(filters);
    writeJsonLocal(contentFiltersKey, items);
    if (state.accountToken && state.accountPrivateData) {
      state.accountPrivateData.contentFilters = items;
      scheduleAccountPrivateDataSave();
    }
    return items;
  }

  function addContentFilter(filter) {
    const next = writeContentFilters([{ id: privateItemId(), createdAt: new Date().toISOString(), ...filter }, ...readContentFilters()]);
    renderAccountPrivateData?.();
    return next;
  }

  function removeContentFilter(id) {
    const next = writeContentFilters(readContentFilters().filter((filter) => filter.id !== id));
    renderAccountPrivateData?.();
    return next;
  }

  function readReplyTemplates() {
    if (state.accountToken && state.accountPrivateData) {
      return normalizeReplyTemplates(state.accountPrivateData.replyTemplates);
    }
    return normalizeReplyTemplates(readLocalList(replyTemplatesKey));
  }

  function writeReplyTemplates(templates) {
    const items = normalizeReplyTemplates(templates);
    writeJsonLocal(replyTemplatesKey, items);
    if (state.accountToken && state.accountPrivateData) {
      state.accountPrivateData.replyTemplates = items;
      scheduleAccountPrivateDataSave();
    }
    return items;
  }

  function addReplyTemplate(template) {
    const next = writeReplyTemplates([
      { id: privateItemId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...template },
      ...readReplyTemplates()
    ]);
    renderAccountPrivateData?.();
    renderReplyTemplatePickers?.();
    return next;
  }

  function removeReplyTemplate(id) {
    const next = writeReplyTemplates(readReplyTemplates().filter((template) => template.id !== id));
    renderAccountPrivateData?.();
    renderReplyTemplatePickers?.();
    return next;
  }

  function readPosterNotes() {
    if (state.accountToken && state.accountPrivateData) {
      return normalizePosterNotes(state.accountPrivateData.posterNotes);
    }
    return normalizePosterNotes(readLocalList(posterNotesKey));
  }

  function writePosterNotes(notes) {
    const items = normalizePosterNotes(notes);
    writeJsonLocal(posterNotesKey, items);
    if (state.accountToken && state.accountPrivateData) {
      state.accountPrivateData.posterNotes = items;
      scheduleAccountPrivateDataSave();
    }
    return items;
  }

  function addPosterNote(note) {
    const posterIdValue = safePrivateText(note?.posterId, 80);
    const boardSlug = safePrivateText(note?.boardSlug, 80);
    const next = writePosterNotes([
      {
        id: privateItemId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...note,
        posterId: posterIdValue,
        boardSlug
      },
      ...readPosterNotes().filter(
        (item) => item.boardSlug !== boardSlug || normalizeSearchValue(item.posterId) !== normalizeSearchValue(posterIdValue)
      )
    ]);
    renderAccountPrivateData?.();
    return next;
  }

  function removePosterNote(id) {
    const next = writePosterNotes(readPosterNotes().filter((note) => note.id !== id));
    renderAccountPrivateData?.();
    return next;
  }

  function posterNoteForPost(post: AnyRecord = {}) {
    const poster = normalizeSearchValue(posterId(post));
    const posterHash = normalizeSearchValue(post.posterHash || '');
    if (!poster || poster === 'id:????') {
      return null;
    }
    const boardSlug = String(post.boardSlug || state.boardSlug || '');
    const notes = readPosterNotes();
    const matchesPoster = (note) => {
      const notePoster = normalizeSearchValue(note.posterId);
      return notePoster === poster || (posterHash && notePoster === posterHash);
    };
    return (
      notes.find((note) => matchesPoster(note) && note.boardSlug === boardSlug) ||
      notes.find((note) => matchesPoster(note) && !note.boardSlug) ||
      null
    );
  }

  function postPlainText(post: AnyRecord = {}) {
    return [
      post.subject,
      post.body,
      post.preview,
      plainPreview(post.bodyLines, ''),
      postDisplayName(post),
      post.tripcode,
      post.capcode,
      posterId(post),
      post.globalNumber ? 'No.' + post.globalNumber : ''
    ]
      .filter(Boolean)
      .join(' ');
  }

  function contentFilterMatch(post: AnyRecord = {}) {
    const filters = readContentFilters();
    if (!filters.length || !post) {
      return null;
    }
    const boardSlug = String(post.boardSlug || state.boardSlug || '');
    const haystack = normalizeSearchValue(postPlainText(post));
    const poster = normalizeSearchValue(posterId(post));
    const threadId = String(post.threadId || post.id || '');
    const globalNumber = String(post.globalNumber || '');
    return (
      filters.find((filter) => {
        if (filter.boardSlug && filter.boardSlug !== boardSlug) {
          return false;
        }
        const value = normalizeSearchValue(filter.value);
        if (!value) {
          return false;
        }
        if (filter.type === 'keyword') {
          return haystack.includes(value);
        }
        if (filter.type === 'poster') {
          return poster === value || poster.includes(value);
        }
        if (filter.type === 'thread') {
          return threadId === filter.value || globalNumber === filter.value;
        }
        if (filter.type === 'post') {
          return globalNumber === filter.value;
        }
        return false;
      }) || null
    );
  }

  function isPostFiltered(post) {
    return Boolean(contentFilterMatch(post));
  }

  function readDraft(key) {
    if (state.accountToken && state.accountPrivateData && accountDraftSyncEnabled()) {
      const draft = (state.accountPrivateData.drafts || []).find((item) => item.key === key);
      if (draft) {
        return draft.body || '';
      }
    }
    return localStorage.getItem(key) || '';
  }

  function writeDraft(key, body) {
    localStorage.setItem(key, body);
    if (!state.accountToken || !state.accountPrivateData || !accountDraftSyncEnabled()) {
      return;
    }
    const { kind, id } = parseDraftKey(key);
    const drafts = (state.accountPrivateData.drafts || []).filter((item) => item.key !== key);
    if (body) {
      drafts.unshift({
        key,
        kind,
        id,
        boardSlug: kind === 'thread' ? id : state.boardSlug,
        threadId: kind === 'comment' || kind === 'quickReply' ? id : '',
        body,
        updatedAt: new Date().toISOString()
      });
    }
    state.accountPrivateData.drafts = drafts.slice(0, 40);
    scheduleAccountPrivateDataSave();
  }

  function removeDraft(key) {
    localStorage.removeItem(key);
    if (state.accountToken && state.accountPrivateData && accountDraftSyncEnabled()) {
      state.accountPrivateData.drafts = (state.accountPrivateData.drafts || []).filter((item) => item.key !== key);
      scheduleAccountPrivateDataSave();
    }
  }

  let myPostNumberCache = null;

  function myPostNumberSet() {
    if (!myPostNumberCache) {
      myPostNumberCache = new Set(myPosts().map((item) => Number(item.globalNumber)));
    }
    return myPostNumberCache;
  }

  function isMyPost(post) {
    const number = Number(post?.globalNumber);
    return Number.isFinite(number) && myPostNumberSet().has(number);
  }

  function myPostEntry(globalNumber) {
    const number = Number(globalNumber);
    if (!Number.isFinite(number)) {
      return null;
    }
    return myPosts().find((item) => Number(item.globalNumber) === number) || null;
  }

  function myPostDeletePassword(globalNumber) {
    const entry = myPostEntry(globalNumber);
    return normalizeDeletePassword(entry?.deletePassword) || defaultDeletePassword();
  }

  function isAccountPost(post) {
    const number = Number(post?.globalNumber);
    return Boolean(state.accountToken && state.account && Number.isFinite(number) && state.accountPostNumbers.has(number));
  }

  async function refreshAccountPostNumbers() {
    if (!state.accountToken || !state.account) {
      state.accountPostNumbers = new Set();
      return;
    }
    try {
      const items = await apiCall('/api/account/posts', { auth: 'account' });
      state.accountPostNumbers = new Set(
        (items || [])
          .map((item) => Number((item.post || item)?.globalNumber))
          .filter(Number.isFinite)
      );
    } catch (error) {
      if (/đăng nhập|Phiên/.test(error.message)) {
        setAccountSession?.();
        return;
      }
      console.warn('Không tải được danh sách bài của tài khoản:', error);
    }
  }

  function rememberMyPost(post, type) {
    if (!post?.globalNumber) {
      return;
    }
    const accountOwned = Boolean(state.accountToken && state.account);
    const items = myPosts().filter((item) => Number(item.globalNumber) !== Number(post.globalNumber));
    items.unshift({
      type,
      owner: accountOwned ? 'account' : 'anonymous',
      deletePassword: accountOwned ? undefined : defaultDeletePassword(),
      threadId: post.threadId || post.id || state.threadId,
      boardSlug: post.boardSlug || state.boardSlug,
      globalNumber: post.globalNumber,
      preview: plainPreview(post.bodyLines, post.body || 'Không có nội dung').slice(0, 160),
      createdAt: post.createdAt || new Date().toISOString()
    });
    writeJsonLocal(myPostsKey, items.slice(0, 50));
    myPostNumberCache = null;
    if (state.accountToken && state.account) {
      state.accountPostNumbers.add(Number(post.globalNumber));
    }
  }

  function mergeAccountPrivateData(serverData = defaultAccountPrivateData()) {
    const localWatchlist = Object.values(readJsonLocal(watchedThreadsKey, {}) as AnyRecord).filter((item) => item?.threadId);
    const localSearches = readLocalList(savedSearchesKey).filter((item) => item?.boardSlug && item?.query);
    const localFilters = normalizeContentFilters(readLocalList(contentFiltersKey));
    const localTemplates = normalizeReplyTemplates(readLocalList(replyTemplatesKey));
    const localPosterNotes = normalizePosterNotes(readLocalList(posterNotesKey));
    const drafts = accountDraftSyncEnabled()
      ? mergeByKey([...(serverData.drafts || []), ...localDraftEntries()], (item) => item.key)
      : serverData.drafts || [];
    return normalizeAccountPrivateData({
      watchlist: mergeByKey([...(serverData.watchlist || []), ...localWatchlist], (item) => item.threadId),
      drafts,
      savedSearches: mergeByKey(
        [...(serverData.savedSearches || []), ...localSearches],
        (item) => `${item.boardSlug}:${item.query}`
      ),
      contentFilters: mergeByKey(
        [...(serverData.contentFilters || []), ...localFilters],
        (item) => `${item.type}:${item.boardSlug || ''}:${item.value}`
      ),
      replyTemplates: mergeByKey(
        [...(serverData.replyTemplates || []), ...localTemplates],
        (item) => `${item.boardSlug || ''}:${item.title}:${item.body}`
      ),
      posterNotes: mergeByKey(
        [...(serverData.posterNotes || []), ...localPosterNotes],
        (item) => `${item.boardSlug || ''}:${item.posterId}`
      )
    });
  }

  async function saveAccountPrivateData() {
    if (!state.accountToken || !state.accountPrivateData) {
      return null;
    }
    const data = await apiCall('/api/account/private-data', {
      auth: 'account',
      method: 'PUT',
      body: JSON.stringify(state.accountPrivateData)
    });
    state.accountPrivateData = normalizeAccountPrivateData(data);
    return state.accountPrivateData;
  }

  function scheduleAccountPrivateDataSave() {
    if (!state.accountToken || !state.accountPrivateData) {
      return;
    }
    window.clearTimeout(state.accountPrivateSaveTimer);
    state.accountPrivateSaveTimer = window.setTimeout(() => {
      saveAccountPrivateData().catch((error) => {
        if (/đăng nhập|Phiên/.test(error.message)) {
          setAccountSession?.();
        }
      });
    }, 600);
  }

  async function loadAccountPrivateData({ mergeLocal = false }: AnyRecord = {}) {
    if (!state.accountToken) {
      state.accountPrivateData = null;
      return null;
    }
    const data = await apiCall('/api/account/private-data', { auth: 'account' });
    state.accountPrivateData = mergeLocal ? mergeAccountPrivateData(data) : normalizeAccountPrivateData(data);
    if (mergeLocal) {
      await saveAccountPrivateData();
    }
    renderAccountPrivateData?.();
    return state.accountPrivateData;
  }

  async function finishAccountLogin(result, { mergeLocal = true }: AnyRecord = {}) {
    setAccountSession?.({ token: result.token, account: result.account });
    state.accountPrivateData = mergeLocal ? mergeAccountPrivateData() : normalizeAccountPrivateData();
    renderAccountPrivateData?.();
    try {
      await loadAccountPrivateData({ mergeLocal });
      await refreshAccountPostNumbers();
    } catch (error) {
      console.warn('Unable to sync account data after login', error);
      showToast?.('Đã đăng nhập, nhưng chưa đồng bộ được dữ liệu cá nhân. Vui lòng thử lại sau.');
    }
  }

  async function clearAccountPrivateData(section = '') {
    if (!state.accountToken) {
      return;
    }
    const data = await apiCall(`/api/account/private-data${section ? `?section=${encodeURIComponent(section)}` : ''}`, {
      auth: 'account',
      method: 'DELETE'
    });
    state.accountPrivateData = normalizeAccountPrivateData(data);
    if (!section || section === 'watchlist') {
      writeJsonLocal(watchedThreadsKey, {});
    }
    if (!section || section === 'savedSearches') {
      writeJsonLocal(savedSearchesKey, []);
    }
    if (!section || section === 'drafts') {
      localDraftEntries().forEach((draft) => localStorage.removeItem(draft.key));
    }
    if (!section || section === 'contentFilters') {
      writeJsonLocal(contentFiltersKey, []);
    }
    if (!section || section === 'replyTemplates') {
      writeJsonLocal(replyTemplatesKey, []);
    }
    if (!section || section === 'posterNotes') {
      writeJsonLocal(posterNotesKey, []);
    }
    renderAccountPrivateData?.();
  }

  return {
    accountDraftSyncEnabled,
    readSavedSearches,
    writeSavedSearches,
    readContentFilters,
    writeContentFilters,
    addContentFilter,
    removeContentFilter,
    readReplyTemplates,
    writeReplyTemplates,
    addReplyTemplate,
    removeReplyTemplate,
    readPosterNotes,
    writePosterNotes,
    addPosterNote,
    removePosterNote,
    posterNoteForPost,
    postPlainText,
    contentFilterMatch,
    isPostFiltered,
    readDraft,
    writeDraft,
    removeDraft,
    isMyPost,
    myPostDeletePassword,
    isAccountPost,
    refreshAccountPostNumbers,
    rememberMyPost,
    mergeAccountPrivateData,
    saveAccountPrivateData,
    scheduleAccountPrivateDataSave,
    loadAccountPrivateData,
    finishAccountLogin,
    clearAccountPrivateData
  };
}

