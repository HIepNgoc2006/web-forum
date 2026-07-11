import { type AnyRecord } from './types';

/**
 * Map a location hash to the screen name used by setScreen().
 * Mirrors route() so reloads can show the correct shell before data loads.
 */
export function screenNameFromHash(hash = ''): string {
  const raw = hash || '#home';
  const [hashPath] = raw.split('?');
  const match = hashPath.match(/^#([^/]+)\/?(.+)?$/);
  const name = match?.[1];
  const id = match?.[2];
  if (!name || name === 'home') {
    return 'home';
  }
  if (name === 'policy') {
    return 'policy';
  }
  if (name === 'register') {
    return 'register';
  }
  if (name === 'login') {
    return 'login';
  }
  if (name === 'forgot') {
    return 'forgot';
  }
  if (name === 'account') {
    return 'account';
  }
  if (name === 'thread' && id) {
    return 'thread';
  }
  if (name === 'catalog') {
    return 'catalog';
  }
  if (name === 'archive') {
    return 'archive';
  }
  if (name === 'admin') {
    return 'admin';
  }
  // #board/... and unknown hashes use the board screen (see route()).
  return 'board';
}

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

  function route(): Promise<void> {
    hideReferencePreview();
    const hash = window.location.hash || '#home';
    const [hashPath, hashQuery = ''] = hash.split('?');
    const [, name, id] = hashPath.match(/^#([^/]+)\/?(.+)?$/) || [];
    let navigation: Promise<unknown> = Promise.resolve();
    if (name === 'home' || !name) {
      navigation = loadHome();
    } else if (name === 'policy') {
      navigation = Promise.resolve(loadPolicy(id || ''));
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
      navigation = loadAccountSettings();
    } else if (name === 'thread' && id) {
      const params = new URLSearchParams(hashQuery);
      const nextThreadId = decodeURIComponent(id);
      if (state.threadId !== nextThreadId) {
        state.threadSearchTerm = '';
      }
      state.threadId = nextThreadId;
      state.threadCommentPage = Math.max(1, Number(params.get('cp')) || 1);
      navigation = loadThread({ resetReply: true, focusPost: params.get('p') || '' });
    } else if (name === 'catalog') {
      state.boardSlug = id || 'confession';
      state.boardSearchTerm = '';
      state.boardPage = 1;
      navigation = loadCatalog();
    } else if (name === 'archive') {
      state.boardSlug = id || 'confession';
      state.boardSearchTerm = '';
      state.boardPage = 1;
      navigation = loadArchive();
    } else if (name === 'admin') {
      navigation = loadAdmin();
    } else {
      const params = new URLSearchParams(hashQuery);
      state.boardSlug = id || 'confession';
      state.boardSearchTerm = params.get('q') || '';
      state.boardSort = normalizeBoardSort(params.get('sort') || state.boardSort);
      state.boardFilter = normalizeBoardFilter(params.get('filter') || 'all');
      state.boardPage = 1;
      navigation = loadBoard();
    }
    setupRealtime();
    return Promise.resolve(navigation).then(
      () => undefined,
      (error: { message?: string }) => {
        showToast(error?.message || String(error));
      }
    );
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
