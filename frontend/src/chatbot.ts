import { api } from './api';
import { state } from './state';

type ChatRole = 'user' | 'assistant';
type ChatScope = 'site' | 'board' | 'thread';

type ChatTurn = {
  role: ChatRole;
  content: string;
};

type ChatContext = {
  key: string;
  scope: ChatScope;
  page: string;
  label: string;
  boardSlug?: string;
  threadId?: string;
};

type ChatResponse = {
  answer?: unknown;
  context?: {
    scope?: unknown;
    label?: unknown;
  };
};

type PublicAiConfig = {
  ai?: {
    configured?: unknown;
  };
};

type ChatElements = {
  widget: HTMLElement;
  launcher: HTMLButtonElement;
  panel: HTMLElement;
  context: HTMLElement;
  prompts: HTMLElement;
  messages: HTMLElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  status: HTMLElement;
  send: HTMLButtonElement;
  clear: HTMLButtonElement;
  close: HTMLButtonElement;
};

const MAX_HISTORY_MESSAGES = 6;
const CHAT_TIMEOUT_MS = 30_000;
const AI_NOT_CONFIGURED_MESSAGE = 'Trợ lý AI chưa được cấu hình trên máy chủ.';
const FLOATING_STACK_BREAKPOINT = 900;
const FLOATING_WINDOW_GAP = 12;
let aiConfigurationProbe: Promise<boolean> | null = null;

async function ensureAiConfigured(): Promise<boolean> {
  if (state.aiConfigured) {
    return true;
  }

  if (!aiConfigurationProbe) {
    aiConfigurationProbe = api('/api/config', { auth: 'none' })
      .then((config: PublicAiConfig) => {
        const configured = Boolean(config.ai?.configured);
        state.aiConfigured = configured;
        return configured;
      })
      .catch(() => false)
      .finally(() => {
        aiConfigurationProbe = null;
      });
  }

  return aiConfigurationProbe;
}

function getChatElements(): ChatElements | null {
  const widget = document.querySelector<HTMLElement>('#aiChatWidget');
  const launcher = document.querySelector<HTMLButtonElement>('#aiChatLauncher');
  const panel = document.querySelector<HTMLElement>('#aiChatPanel');
  const context = document.querySelector<HTMLElement>('#aiChatContext');
  const prompts = document.querySelector<HTMLElement>('#aiChatPrompts');
  const messages = document.querySelector<HTMLElement>('#aiChatMessages');
  const form = document.querySelector<HTMLFormElement>('#aiChatForm');
  const input = document.querySelector<HTMLTextAreaElement>('#aiChatInput');
  const status = document.querySelector<HTMLElement>('#aiChatStatus');
  const send = document.querySelector<HTMLButtonElement>('#aiChatSend');
  const clear = document.querySelector<HTMLButtonElement>('#aiChatClear');
  const close = document.querySelector<HTMLButtonElement>('#aiChatClose');

  if (
    !widget ||
    !launcher ||
    !panel ||
    !context ||
    !prompts ||
    !messages ||
    !form ||
    !input ||
    !status ||
    !send ||
    !clear ||
    !close
  ) {
    return null;
  }

  return { widget, launcher, panel, context, prompts, messages, form, input, status, send, clear, close };
}

function safeDecode(value = ''): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function routeDetails(): { hashPath: string; name: string; id: string } {
  const rawHash = window.location.hash || '#home';
  const [hashPath] = rawHash.split('?');
  const match = hashPath.match(/^#([^/]+)\/?(.+)?$/);
  return {
    hashPath: hashPath.slice(0, 300),
    name: match?.[1] || 'home',
    id: safeDecode(match?.[2] || '')
  };
}

function sitePageLabel(name: string): string {
  const labels: Record<string, string> = {
    home: 'Trang chủ',
    policy: 'Nội quy',
    register: 'Đăng ký',
    login: 'Đăng nhập',
    forgot: 'Khôi phục tài khoản',
    account: 'Cài đặt tài khoản',
    admin: 'Quản trị'
  };
  return labels[name] || 'Toàn trang';
}

function currentChatContext(): ChatContext {
  const { hashPath, name, id } = routeDetails();

  if (name === 'thread' && id) {
    const detailThread = state.threadDetail?.thread;
    const detailMatches = cleanString(detailThread?.id) === id;
    const threadId = id;
    const boardSlug = detailMatches ? cleanString(detailThread?.boardSlug) : '';
    const globalNumber = detailMatches
      ? cleanString(detailThread?.globalNumber)
      : cleanString(state.threadId) === threadId
        ? cleanString(state.threadGlobalNumber)
        : '';
    const threadLabel = globalNumber ? `Chủ đề No.${globalNumber}` : `Chủ đề ${threadId.slice(0, 12)}`;
    return {
      key: `thread:${threadId}`,
      scope: 'thread',
      page: name,
      label: boardSlug ? `${threadLabel} · /${boardSlug}/` : threadLabel,
      boardSlug: boardSlug || undefined,
      threadId
    };
  }

  if (['board', 'catalog', 'archive'].includes(name)) {
    const boardSlug = id || cleanString(state.boardSlug) || 'confession';
    const prefix = name === 'catalog' ? 'Danh mục' : name === 'archive' ? 'Kho lưu trữ' : 'Bảng';
    return {
      key: `board:${boardSlug}`,
      scope: 'board',
      page: name,
      label: `${prefix} /${boardSlug}/`,
      boardSlug
    };
  }

  return {
    key: `site:${hashPath}`,
    scope: 'site',
    page: name,
    label: sitePageLabel(name)
  };
}

function promptsFor(context: ChatContext): string[] {
  if (context.scope === 'thread') {
    return [
      'Tóm tắt chủ đề này.',
      'Những ý kiến chính trong chủ đề là gì?',
      'Điểm nào còn tranh luận hoặc chưa rõ?'
    ];
  }
  if (context.scope === 'board') {
    return [
      `Bảng /${context.boardSlug}/ dành cho nội dung gì?`,
      'Những chủ đề nổi bật trên trang này là gì?',
      'Tóm tắt các chủ đề đang hiển thị.'
    ];
  }
  return [
    '36chan hoạt động như thế nào?',
    'Tôi nên bắt đầu từ bảng nào?',
    'Trang hiện tại dùng để làm gì?'
  ];
}

function mountChatbot(elements: ChatElements): void {
  const history: ChatTurn[] = [];
  const quickReply = document.querySelector<HTMLElement>('#quickReply');
  let activeContext = currentChatContext();
  let pendingController: AbortController | null = null;
  let quickReplyWasOpen = Boolean(quickReply && !quickReply.classList.contains('hidden'));
  let floatingLayoutFrame = 0;

  document.body.classList.add('ai-chat-ready');

  function isOpen(): boolean {
    return !elements.panel.hidden;
  }

  function quickReplyIsOpen(): boolean {
    return Boolean(quickReply && !quickReply.classList.contains('hidden'));
  }

  function setFloatingSurface(surface: 'chat' | 'quick-reply' | null): void {
    document.body.classList.toggle('ai-chat-front', surface === 'chat');
    document.body.classList.toggle('quick-reply-front', surface === 'quick-reply');
  }

  function floatingWindowsOverlap(first: DOMRect, second: DOMRect): boolean {
    return !(
      first.right + FLOATING_WINDOW_GAP <= second.left ||
      second.right + FLOATING_WINDOW_GAP <= first.left ||
      first.bottom + FLOATING_WINDOW_GAP <= second.top ||
      second.bottom + FLOATING_WINDOW_GAP <= first.top
    );
  }

  function separateFloatingWindows(): void {
    if (
      !isOpen() ||
      !quickReplyIsOpen() ||
      !quickReply ||
      window.innerWidth <= FLOATING_STACK_BREAKPOINT
    ) {
      return;
    }

    const chatRect = elements.panel.getBoundingClientRect();
    const replyRect = quickReply.getBoundingClientRect();
    if (!floatingWindowsOverlap(chatRect, replyRect)) {
      return;
    }

    const maxTop = Math.max(
      FLOATING_WINDOW_GAP,
      window.innerHeight - replyRect.height - FLOATING_WINDOW_GAP
    );
    quickReply.style.right = '';
    quickReply.style.bottom = '';
    quickReply.style.left =
      String(
        Math.max(
          FLOATING_WINDOW_GAP,
          chatRect.left - replyRect.width - FLOATING_WINDOW_GAP
        )
      ) + 'px';
    quickReply.style.top =
      String(Math.min(Math.max(FLOATING_WINDOW_GAP, replyRect.top), maxTop)) + 'px';
  }

  function scheduleFloatingWindowLayout(): void {
    window.cancelAnimationFrame(floatingLayoutFrame);
    floatingLayoutFrame = window.requestAnimationFrame(separateFloatingWindows);
  }

  function setStatus(message = '', tone: 'neutral' | 'error' = 'neutral'): void {
    elements.status.textContent = message;
    elements.status.classList.toggle('is-error', tone === 'error');
  }

  function setBusy(busy: boolean): void {
    elements.panel.setAttribute('aria-busy', busy ? 'true' : 'false');
    elements.input.disabled = busy;
    elements.send.disabled = busy;
    elements.prompts.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.disabled = busy;
    });
  }

  function appendMessage(role: ChatRole, content: string, tone: 'neutral' | 'error' = 'neutral'): void {
    const message = document.createElement('article');
    message.className = `ai-chat-message ai-chat-message-${role}`;
    message.classList.toggle('is-error', tone === 'error');

    const label = document.createElement('strong');
    label.className = 'ai-chat-message-label';
    label.textContent = role === 'user' ? 'Bạn' : 'AI';

    const body = document.createElement('p');
    body.className = 'ai-chat-message-body';
    body.textContent = content;

    message.append(label, body);
    elements.messages.append(message);
    window.requestAnimationFrame(() => {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    });
  }

  function renderWelcome(context: ChatContext): void {
    elements.messages.replaceChildren();
    appendMessage(
      'assistant',
      `Bạn có thể hỏi về ${context.label.toLowerCase()}, các bảng và chủ đề công khai. AI có thể sai; hãy kiểm tra bài gốc khi cần.`
    );
  }

  function renderPrompts(context: ChatContext): void {
    elements.prompts.replaceChildren();
    for (const prompt of promptsFor(context)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.chatPrompt = 'true';
      button.textContent = prompt;
      elements.prompts.append(button);
    }
  }

  function abortPendingRequest(): void {
    pendingController?.abort();
    pendingController = null;
    setBusy(false);
  }

  function syncContext(): ChatContext {
    const nextContext = currentChatContext();
    const changed = nextContext.key !== activeContext.key;
    activeContext = nextContext;
    elements.context.textContent = `Ngữ cảnh: ${activeContext.label}`;
    renderPrompts(activeContext);
    if (changed) {
      abortPendingRequest();
      history.length = 0;
      setStatus();
      renderWelcome(activeContext);
    }
    return activeContext;
  }

  function openChat(): void {
    syncContext();
    elements.panel.hidden = false;
    elements.launcher.setAttribute('aria-expanded', 'true');
    document.body.classList.add('ai-chat-open');
    setFloatingSurface('chat');
    scheduleFloatingWindowLayout();
    window.setTimeout(() => elements.input.focus(), 0);
  }

  function closeChat({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
    elements.panel.hidden = true;
    elements.launcher.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('ai-chat-open');
    setFloatingSurface(quickReplyIsOpen() ? 'quick-reply' : null);
    if (restoreFocus) {
      elements.launcher.focus();
    }
  }

  function clearConversation(): void {
    abortPendingRequest();
    history.length = 0;
    elements.input.value = '';
    activeContext = currentChatContext();
    elements.context.textContent = `Ngữ cảnh: ${activeContext.label}`;
    renderPrompts(activeContext);
    renderWelcome(activeContext);
    setStatus('Đã xóa cuộc trò chuyện.');
    elements.input.focus();
  }

  async function submitQuestion(questionValue: string): Promise<void> {
    const question = questionValue.trim();
    if (!question || pendingController) {
      if (!question) {
        setStatus('Nhập câu hỏi trước khi gửi.', 'error');
      }
      return;
    }

    const requestContext = syncContext();
    if (!state.aiConfigured) {
      setBusy(true);
      setStatus('Đang kiểm tra cấu hình AI…');
      const configured = await ensureAiConfigured();
      setBusy(false);

      if (currentChatContext().key !== requestContext.key) {
        setStatus();
        return;
      }
      if (!configured) {
        setStatus(AI_NOT_CONFIGURED_MESSAGE, 'error');
        appendMessage('assistant', AI_NOT_CONFIGURED_MESSAGE, 'error');
        if (isOpen()) {
          elements.input.focus();
        }
        return;
      }
    }

    const requestHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const controller = new AbortController();
    pendingController = controller;
    elements.input.value = '';
    appendMessage('user', question);
    setBusy(true);
    setStatus('AI đang đọc ngữ cảnh và trả lời…');

    try {
      const result = (await api('/api/ai/chat', {
        auth: 'none',
        method: 'POST',
        timeoutMs: CHAT_TIMEOUT_MS,
        timeoutMessage: 'AI phản hồi quá lâu, vui lòng thử lại.',
        signal: controller.signal,
        body: JSON.stringify({
          question,
          scope: requestContext.scope,
          page: requestContext.page,
          boardSlug: requestContext.boardSlug,
          threadId: requestContext.threadId,
          history: requestHistory,
          posterToken: cleanString(state.posterToken)
        })
      })) as ChatResponse;

      if (currentChatContext().key !== requestContext.key) {
        return;
      }

      const answer = cleanString(result.answer) || 'AI chưa trả về câu trả lời.';
      const responseLabel = cleanString(result.context?.label);
      if (responseLabel) {
        elements.context.textContent = `Ngữ cảnh: ${responseLabel}`;
      }
      appendMessage('assistant', answer);
      history.push(
        { role: 'user', content: question },
        { role: 'assistant', content: answer }
      );
      if (history.length > MAX_HISTORY_MESSAGES) {
        history.splice(0, history.length - MAX_HISTORY_MESSAGES);
      }
      setStatus();
    } catch (error: unknown) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Không thể kết nối tới trợ lý AI.';
      appendMessage('assistant', `Tôi chưa thể trả lời: ${message}`, 'error');
      setStatus(message, 'error');
    } finally {
      if (pendingController === controller) {
        pendingController = null;
        setBusy(false);
        if (isOpen()) {
          elements.input.focus();
        }
      }
    }
  }

  elements.launcher.addEventListener('click', () => {
    if (isOpen()) {
      closeChat();
    } else {
      openChat();
    }
  });
  elements.close.addEventListener('click', () => closeChat());
  elements.clear.addEventListener('click', clearConversation);
  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitQuestion(elements.input.value);
  });
  elements.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });
  elements.prompts.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-chat-prompt]')
      : null;
    if (!target || target.disabled) {
      return;
    }
    const question = target.textContent?.trim() || '';
    elements.input.value = question;
    void submitQuestion(question);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen() || document.querySelector('.reason-modal-overlay')) {
      return;
    }
    if (quickReplyIsOpen() && document.body.classList.contains('quick-reply-front')) {
      return;
    }
    event.preventDefault();
    closeChat();
  });

  window.addEventListener('hashchange', () => {
    window.setTimeout(() => syncContext(), 0);
  });

  elements.widget.addEventListener('pointerdown', () => {
    if (isOpen()) {
      setFloatingSurface('chat');
    }
  });
  elements.widget.addEventListener('focusin', () => {
    if (isOpen()) {
      setFloatingSurface('chat');
    }
  });

  quickReply?.addEventListener('pointerdown', () => setFloatingSurface('quick-reply'));
  quickReply?.addEventListener('focusin', () => setFloatingSurface('quick-reply'));

  const quickReplyObserver = quickReply
    ? new MutationObserver(() => {
        const quickReplyOpen = quickReplyIsOpen();
        if (quickReplyOpen === quickReplyWasOpen) {
          return;
        }
        quickReplyWasOpen = quickReplyOpen;
        if (quickReplyOpen) {
          setFloatingSurface('quick-reply');
          scheduleFloatingWindowLayout();
        } else {
          setFloatingSurface(isOpen() ? 'chat' : null);
        }
      })
    : null;
  quickReplyObserver?.observe(quickReply as HTMLElement, {
    attributes: true,
    attributeFilter: ['class']
  });
  window.addEventListener('resize', scheduleFloatingWindowLayout);

  renderPrompts(activeContext);
  elements.context.textContent = `Ngữ cảnh: ${activeContext.label}`;
  renderWelcome(activeContext);
  setFloatingSurface(quickReplyWasOpen ? 'quick-reply' : null);
}

const elements = getChatElements();
if (elements) {
  mountChatbot(elements);
}
