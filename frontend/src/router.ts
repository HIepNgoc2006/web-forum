import { type AnyRecord } from './types';

export function createRouterController(dependencies: AnyRecord) {
  const {
    els,
    state,
    showToast,
    hideReferencePreview,
    setFormError,
    setScreen,
    loadHome,
    loadThread,
    loadCatalog,
    loadArchive,
    loadBoard,
    loadAccountSettings,
    loadAdmin,
    resetForgotPasswordForm,
    loadPolicy: loadPolicyFromRoute,
    normalizeBoardSort,
    normalizeBoardFilter,
    setupRealtime,
    moveKeyboardNavigation,
    eventInTextInput,
    openReplyComposer
  } = dependencies;

  function loadPolicy(section = '') {
    setScreen('policy');
    const sectionId = {
      rules: 'policy-rules',
      privacy: 'policy-rules',
      feedback: 'policy-feedback',
      report: 'policy-report',
      appeal: 'policy-appeal',
      contact: 'policy-contact'
    }[section];
    if (sectionId) {
      document.querySelector(`#${sectionId}`)?.scrollIntoView({ block: 'start' });
    } else {
      window.scrollTo({ top: 0 });
    }
    if (loadPolicyFromRoute) {
      return loadPolicyFromRoute(section);
    }
  }

  function route() {
    hideReferencePreview();
    const hash = window.location.hash || '#home';
    const [hashPath, hashQuery = ''] = hash.split('?');
    const [, name, id] = hashPath.match(/^#([^/]+)\/?(.+)?$/) || [];
    if (name === 'home' || !name) {
      loadHome().catch((error) => showToast(error.message));
    } else if (name === 'policy') {
      loadPolicy(id || '');
    } else if (name === 'register') {
      els.registerForm.classList.remove('hidden');
      els.registerRecoveryNotice.classList.add('hidden');
      setScreen('register');
      setFormError(els.registerError);
      window.scrollTo({ top: 0 });
    } else if (name === 'login') {
      setScreen('login');
      setFormError(els.accountLoginError);
      window.scrollTo({ top: 0 });
    } else if (name === 'forgot') {
      resetForgotPasswordForm();
      setScreen('forgot');
      setFormError(els.forgotError);
      window.scrollTo({ top: 0 });
    } else if (name === 'account') {
      loadAccountSettings().catch((error) => showToast(error.message));
    } else if (name === 'thread' && id) {
      const params = new URLSearchParams(hashQuery);
      const nextThreadId = decodeURIComponent(id);
      if (state.threadId !== nextThreadId) {
        state.threadSearchTerm = '';
      }
      state.threadId = nextThreadId;
      state.threadCommentPage = Math.max(1, Number(params.get('cp')) || 1);
      loadThread({ resetReply: true, focusPost: params.get('p') || '' }).catch((error) => showToast(error.message));
    } else if (name === 'catalog') {
      state.boardSlug = id || 'confession';
      state.boardSearchTerm = '';
      state.boardPage = 1;
      loadCatalog().catch((error) => showToast(error.message));
    } else if (name === 'archive') {
      state.boardSlug = id || 'confession';
      state.boardSearchTerm = '';
      state.boardPage = 1;
      loadArchive().catch((error) => showToast(error.message));
    } else if (name === 'admin') {
      loadAdmin().catch((error) => showToast(error.message));
    } else {
      const params = new URLSearchParams(hashQuery);
      state.boardSlug = id || 'confession';
      state.boardSearchTerm = params.get('q') || '';
      state.boardSort = normalizeBoardSort(params.get('sort') || state.boardSort);
      state.boardFilter = normalizeBoardFilter(params.get('filter') || 'all');
      state.boardPage = 1;
      loadBoard().catch((error) => showToast(error.message));
    }
    setupRealtime();
  }

  function refreshCurrentScreen() {
    const hash = window.location.hash || '#home';
    if (hash.startsWith('#thread/')) {
      return loadThread();
    }
    if (hash.startsWith('#catalog/')) {
      return loadCatalog();
    }
    if (hash.startsWith('#archive/')) {
      return loadArchive();
    }
    if (hash.startsWith('#board/')) {
      return loadBoard();
    }
    return loadHome();
  }

  function handleKeyboardShortcut(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || eventInTextInput(event)) {
      return;
    }
    if (event.key === 't') {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (event.key === 'u') {
      event.preventDefault();
      refreshCurrentScreen().catch((error) => showToast(error.message));
    } else if (event.key === 'r' && (window.location.hash || '').startsWith('#thread/')) {
      event.preventDefault();
      openReplyComposer();
    } else if (event.key === 'n') {
      if (moveKeyboardNavigation(1)) {
        event.preventDefault();
      }
    } else if (event.key === 'p') {
      if (moveKeyboardNavigation(-1)) {
        event.preventDefault();
      }
    } else if (event.key === 'b' && state.boardSlug) {
      event.preventDefault();
      window.location.hash = `#board/${state.boardSlug}`;
    }
  }

  return {
    route,
    refreshCurrentScreen,
    handleKeyboardShortcut
  };
}
