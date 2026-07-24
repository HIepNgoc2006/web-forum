import { api } from './api';
import { AI_ERROR_MESSAGE, publicAiErrorMessage } from './ai-errors';
import { escapeHtml, threadTitle } from './format';
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

type ChatSource = {
  kind?: unknown;
  label?: unknown;
  href?: unknown;
  threadId?: unknown;
  globalNumber?: unknown;
};

type ChatResponse = {
  answer?: unknown;
  context?: {
    scope?: unknown;
    label?: unknown;
  };
  sources?: unknown;
  followUps?: unknown;
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

const MAX_HISTORY_MESSAGES = 8;
const CHAT_TIMEOUT_MS = 35_000;
const CHAT_HISTORY_STORAGE_PREFIX = '36chan.aiChat.history.v1:';
const FLOATING_STACK_BREAKPOINT = 900;
const FLOATING_WINDOW_GAP = 12;
let aiConfigurationProbe: Promise<boolean> | null = null;

function historyStorageKey(contextKey: string): string {
  return `${CHAT_HISTORY_STORAGE_PREFIX}${contextKey}`;
}

function loadStoredHistory(contextKey: string): ChatTurn[] {
  try {
    const raw = sessionStorage.getItem(historyStorageKey(contextKey));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is ChatTurn => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const role = (item as ChatTurn).role;
        const content = cleanString((item as ChatTurn).content);
        return (role === 'user' || role === 'assistant') && Boolean(content);
      })
      .map((item) => ({ role: item.role, content: cleanString(item.content).slice(0, 4_000) }))
      .slice(-MAX_HISTORY_MESSAGES);
  } catch {
    return [];
  }
}

function saveStoredHistory(contextKey: string, history: ChatTurn[]): void {
  try {
    if (!history.length) {
      sessionStorage.removeItem(historyStorageKey(contextKey));
      return;
    }
    sessionStorage.setItem(historyStorageKey(contextKey), JSON.stringify(history.slice(-MAX_HISTORY_MESSAGES)));
  } catch {
    // Private mode / quota: ignore.
  }
}

function clearStoredHistory(contextKey: string): void {
  try {
    sessionStorage.removeItem(historyStorageKey(contextKey));
  } catch {
    // ignore
  }
}

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
    // Prefer display title (subject, else body preview) — same as the rest of the UI.
    const title = detailMatches ? cleanString(threadTitle(detailThread, '')) : '';
    const globalNumber = detailMatches
      ? cleanString(detailThread?.globalNumber)
      : cleanString(state.threadId) === threadId
        ? cleanString(state.threadGlobalNumber)
        : '';
    const titleLabel = title
      ? title.length > 48
        ? `${title.slice(0, 45).trimEnd()}...`
        : title
      : '';
    const threadLabel = titleLabel
      ? `Chủ đề "${titleLabel}"`
      : globalNumber
        ? `Chủ đề No.${globalNumber}`
        : `Chủ đề ${threadId.slice(0, 12)}`;
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
      'Tóm tắt chủ đề này bằng 3–5 ý chính.',
      'Tìm chủ đề tương tự.',
      'Những ý kiến chính và điểm còn tranh luận?',
      'Có file đính kèm hoặc link ngoài đáng chú ý không?',
      'Bài này trích dẫn (>>No.) những bài nào?'
    ];
  }
  if (context.scope === 'board') {
    return [
      `Bảng /${context.boardSlug}/ dành cho nội dung gì?`,
      'Chủ đề nào đáng đọc nhất lúc này?',
      'Tóm tắt các chủ đề đang hiển thị.',
      'Chủ đề nào có đính kèm hoặc trích dẫn đáng chú ý?'
    ];
  }
  return [
    '36chan hoạt động như thế nào?',
    'Tôi nên bắt đầu từ bảng nào?',
    'Gợi ý vài chủ đề gần đây để đọc.',
    'Trang hiện tại dùng để làm gì?'
  ];
}

function welcomeMessageFor(context: ChatContext): string {
  if (context.scope === 'thread') {
    return `Đang bám ngữ cảnh **${context.label}**. Bạn có thể nhờ tóm tắt, tìm thread tương tự, kiểm tra trích dẫn/đính kèm, hoặc hỏi một ý cụ thể. AI có thể sai — bấm link nguồn để mở bài gốc.`;
  }
  if (context.scope === 'board') {
    return `Đang bám **${context.label}**. Hỏi về nội dung bảng, chủ đề nổi bật, hoặc nhờ gợi ý thread đáng đọc. AI chỉ thấy bài công khai và có thể sai.`;
  }
  return `Bạn có thể hỏi về **${context.label.toLowerCase()}**, các bảng và chủ đề công khai. AI có thể sai; hãy kiểm tra bài gốc khi cần. Muốn chi tiết hơn, bấm link No./#thread trong câu trả lời.`;
}

function normalizeFollowUps(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = cleanString(item).slice(0, 160);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    out.push(text);
    if (out.length >= 4) {
      break;
    }
  }
  return out;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'true');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function normalizeChatSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: ChatSource[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const href = cleanString((item as ChatSource).href);
    if (!href.startsWith('#thread/') || seen.has(href)) {
      continue;
    }
    seen.add(href);
    out.push({
      kind: cleanString((item as ChatSource).kind) || 'post',
      label: cleanString((item as ChatSource).label) || href,
      href,
      threadId: cleanString((item as ChatSource).threadId),
      globalNumber: (item as ChatSource).globalNumber
    });
    if (out.length >= 24) {
      break;
    }
  }
  return out;
}

/** Escape text then apply light formatting + safe in-app hash links. */
function renderAssistantMessageHtml(content: string, sources: ChatSource[] = []): string {
  const threadHashRe = /#thread\/[A-Za-z0-9._~\-%]+(?:\?p=\d{1,12})?/g;
  let html = escapeHtml(content);

  // Markdown-style links whose target is an in-app thread hash only.
  html = html.replace(
    /\[([^\]]{1,120})\]\((#thread\/[A-Za-z0-9._~\-%]+(?:\?p=\d{1,12})?)\)/g,
    (_match, label: string, href: string) =>
      `<a class="ai-chat-link" href="${escapeHtml(href)}" data-ai-chat-link="true">${label}</a>`
  );

  // Light emphasis: **bold** and `code` (after escape, asterisks remain).
  html = html.replace(/\*\*([^*\n]{1,120})\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`\n]{1,120})`/g, '<code class="ai-chat-inline-code">$1</code>');

  // Bullet-ish lines for scanability.
  html = html.replace(/(^|\n)(?:[-•*]\s+)([^\n]+)/g, '$1<span class="ai-chat-bullet">• $2</span>');

  // Bare #thread/... links — skip segments already inside an anchor/code tag.
  html = html
    .split(/(<a\b[^>]*>.*?<\/a>|<code\b[^>]*>.*?<\/code>)/gi)
    .map((part) => {
      if (part.startsWith('<a') || part.startsWith('<code')) {
        return part;
      }
      return part.replace(
        threadHashRe,
        (href) =>
          `<a class="ai-chat-link" href="${escapeHtml(href)}" data-ai-chat-link="true">${escapeHtml(href)}</a>`
      );
    })
    .join('');

  // >>No. quote refs — link when we know the current/source thread.
  const numberToHref = new Map<string, string>();
  for (const source of sources) {
    const number = cleanString(source.globalNumber);
    const href = cleanString(source.href);
    if (number && href.includes('?p=')) {
      numberToHref.set(number, href);
    }
  }
  if (numberToHref.size) {
    html = html.replace(/&gt;&gt;(\d{1,12})\b/g, (full, number: string) => {
      const href = numberToHref.get(number);
      if (!href) {
        return full;
      }
      return `<a class="ai-chat-link" href="${escapeHtml(href)}" data-ai-chat-link="true">&gt;&gt;${number}</a>`;
    });
  }

  return html;
}

function sourceKindLabel(kind: unknown): string {
  const value = cleanString(kind);
  if (value === 'similar') {
    return 'Tương tự';
  }
  if (value === 'thread') {
    return 'Chủ đề';
  }
  return 'Bài';
}

function mountChatbot(elements: ChatElements): void {
  const history: ChatTurn[] = [];
  const quickReply = document.querySelector<HTMLElement>('#quickReply');
  let activeContext = currentChatContext();
  let pendingController: AbortController | null = null;
  let quickReplyWasOpen = Boolean(quickReply && !quickReply.classList.contains('hidden'));
  let floatingLayoutFrame = 0;
  let typingNode: HTMLElement | null = null;

  // Character counter next to the status line.
  const counter = document.createElement('span');
  counter.className = 'ai-chat-char-count';
  counter.setAttribute('aria-live', 'polite');
  elements.send.before(counter);

  document.body.classList.add('ai-chat-ready');

  function updateCharCount(): void {
    const max = Number(elements.input.maxLength) || 1000;
    const length = elements.input.value.length;
    counter.textContent = `${length}/${max}`;
    counter.classList.toggle('is-near-limit', length >= max * 0.9);
  }

  function restoreHistoryForContext(context: ChatContext): void {
    history.length = 0;
    history.push(...loadStoredHistory(context.key));
    elements.messages.replaceChildren();
    if (!history.length) {
      appendMessage('assistant', welcomeMessageFor(context));
      return;
    }
    for (const turn of history) {
      appendMessage(turn.role, turn.content, 'neutral', [], { skipActions: turn.role === 'user' });
    }
  }

  function persistHistory(): void {
    saveStoredHistory(activeContext.key, history);
  }

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
    elements.messages.querySelectorAll<HTMLButtonElement>('[data-chat-follow-up], [data-chat-retry]').forEach((button) => {
      button.disabled = busy;
    });
  }

  function clearTyping(): void {
    typingNode?.remove();
    typingNode = null;
  }

  function showTyping(): void {
    clearTyping();
    const message = document.createElement('article');
    message.className = 'ai-chat-message ai-chat-message-assistant ai-chat-typing';
    message.setAttribute('aria-label', 'AI đang soạn trả lời');
    message.innerHTML =
      '<strong class="ai-chat-message-label">AI</strong><div class="ai-chat-typing-dots" aria-hidden="true"><span></span><span></span><span></span></div>';
    typingNode = message;
    elements.messages.append(message);
    window.requestAnimationFrame(() => {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    });
  }

  function appendMessage(
    role: ChatRole,
    content: string,
    tone: 'neutral' | 'error' = 'neutral',
    sources: ChatSource[] = [],
    options: { followUps?: string[]; skipActions?: boolean; retryQuestion?: string } = {}
  ): void {
    const message = document.createElement('article');
    message.className = `ai-chat-message ai-chat-message-${role}`;
    message.classList.toggle('is-error', tone === 'error');

    const label = document.createElement('strong');
    label.className = 'ai-chat-message-label';
    label.textContent = role === 'user' ? 'Bạn' : 'AI';

    const body = document.createElement('div');
    body.className = 'ai-chat-message-body';
    if (role === 'assistant' && tone !== 'error') {
      body.innerHTML = renderAssistantMessageHtml(content, sources);
    } else {
      body.textContent = content;
    }

    message.append(label, body);

    if (role === 'assistant' && !options.skipActions) {
      const actions = document.createElement('div');
      actions.className = 'ai-chat-message-actions';

      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'ai-chat-action-button';
      copyButton.textContent = 'Sao chép';
      copyButton.addEventListener('click', async () => {
        const ok = await copyTextToClipboard(content);
        copyButton.textContent = ok ? 'Đã chép' : 'Không chép được';
        window.setTimeout(() => {
          copyButton.textContent = 'Sao chép';
        }, 1_400);
      });
      actions.append(copyButton);

      if (tone === 'error' && options.retryQuestion) {
        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.className = 'ai-chat-action-button';
        retryButton.dataset.chatRetry = 'true';
        retryButton.textContent = 'Thử lại';
        retryButton.addEventListener('click', () => {
          void submitQuestion(options.retryQuestion || '');
        });
        actions.append(retryButton);
      }

      message.append(actions);
    }

    if (role === 'assistant' && tone !== 'error' && sources.length) {
      const sourcesBlock = document.createElement('div');
      sourcesBlock.className = 'ai-chat-sources';
      const heading = document.createElement('p');
      heading.className = 'ai-chat-sources-heading';
      heading.textContent = 'Xem chi tiết hơn:';
      sourcesBlock.append(heading);

      const list = document.createElement('ul');
      list.className = 'ai-chat-sources-list';
      for (const source of sources.slice(0, 10)) {
        const href = cleanString(source.href);
        if (!href.startsWith('#thread/')) {
          continue;
        }
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'ai-chat-link';
        link.href = href;
        link.dataset.aiChatLink = 'true';
        const kind = sourceKindLabel(source.kind);
        const labelText = cleanString(source.label) || href;
        link.textContent = `${kind}: ${labelText}`;
        item.append(link);
        list.append(item);
      }
      if (list.childElementCount) {
        sourcesBlock.append(list);
        const hint = document.createElement('p');
        hint.className = 'ai-chat-sources-hint';
        hint.textContent = 'Bấm link để mở bài/chủ đề gốc trên diễn đàn.';
        sourcesBlock.append(hint);
        message.append(sourcesBlock);
      }
    }

    if (role === 'assistant' && tone !== 'error' && options.followUps?.length) {
      const followUps = document.createElement('div');
      followUps.className = 'ai-chat-follow-ups';
      followUps.setAttribute('aria-label', 'Câu hỏi tiếp theo');
      for (const prompt of options.followUps) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ai-chat-follow-up';
        button.dataset.chatFollowUp = 'true';
        button.textContent = prompt;
        button.addEventListener('click', () => {
          void submitQuestion(prompt);
        });
        followUps.append(button);
      }
      message.append(followUps);
    }

    elements.messages.append(message);
    window.requestAnimationFrame(() => {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    });
  }

  function renderWelcome(context: ChatContext): void {
    elements.messages.replaceChildren();
    appendMessage('assistant', welcomeMessageFor(context), 'neutral', [], { skipActions: true });
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
    clearTyping();
    setBusy(false);
  }

  function syncContext(): ChatContext {
    const nextContext = currentChatContext();
    const changed = nextContext.key !== activeContext.key;
    const labelChanged = nextContext.label !== activeContext.label;
    const previousKey = activeContext.key;
    activeContext = nextContext;
    elements.context.textContent = `Ngữ cảnh: ${activeContext.label}`;
    renderPrompts(activeContext);
    if (changed) {
      abortPendingRequest();
      saveStoredHistory(previousKey, history);
      setStatus();
      restoreHistoryForContext(activeContext);
    } else if (labelChanged && history.length === 0) {
      // Thread title/number may load after the first paint; refresh empty welcome.
      renderWelcome(activeContext);
    }
    return activeContext;
  }

  function openChat(): void {
    syncContext();
    if (!elements.messages.childElementCount) {
      restoreHistoryForContext(activeContext);
    }
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
    clearStoredHistory(activeContext.key);
    elements.input.value = '';
    updateCharCount();
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
        setStatus(AI_ERROR_MESSAGE, 'error');
        appendMessage('assistant', AI_ERROR_MESSAGE, 'error', [], {
          retryQuestion: question
        });
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
    updateCharCount();
    appendMessage('user', question);
    setBusy(true);
    showTyping();
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

      clearTyping();
      const answer = cleanString(result.answer) || 'AI chưa trả về câu trả lời.';
      const sources = normalizeChatSources(result.sources);
      const followUps = normalizeFollowUps(result.followUps);
      const responseLabel = cleanString(result.context?.label);
      if (responseLabel) {
        elements.context.textContent = `Ngữ cảnh: ${responseLabel}`;
      }
      appendMessage('assistant', answer, 'neutral', sources, { followUps });
      history.push(
        { role: 'user', content: question },
        { role: 'assistant', content: answer }
      );
      if (history.length > MAX_HISTORY_MESSAGES) {
        history.splice(0, history.length - MAX_HISTORY_MESSAGES);
      }
      persistHistory();
      setStatus(sources.length ? `Đã trả lời · ${sources.length} nguồn` : 'Đã trả lời');
    } catch (error: unknown) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return;
      }
      clearTyping();
      const message = publicAiErrorMessage(error);
      appendMessage('assistant', message, 'error', [], {
        retryQuestion: question
      });
      setStatus(message, 'error');
    } finally {
      if (pendingController === controller) {
        pendingController = null;
        clearTyping();
        setBusy(false);
        if (isOpen()) {
          elements.input.focus();
        }
      }
    }
  }

  // Seed in-memory history for the first page context; UI renders on first open.
  history.push(...loadStoredHistory(activeContext.key));

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
  elements.input.addEventListener('input', updateCharCount);
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
    updateCharCount();
    void submitQuestion(question);
  });
  updateCharCount();

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
