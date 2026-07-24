import { api } from './api';
import { els } from './dom';
import {
  scrollComposerDraft,
  updateDraftMeter,
  updatePrivacyWarning
} from './composer';
import {
  AI_SPEAK_TIMEOUT_MS,
  AI_TRANSCRIBE_TIMEOUT_MS,
  AI_TTS_PROVIDER_COOLDOWN_MS,
  DEFAULT_SPEECH_STT_LANG,
  DRAFT_MAX_CHARS,
  SPEECH_STT_LANGUAGES,
  SPEECH_STT_LANG_KEY
} from './constants';
import { AI_ERROR_MESSAGE, publicAiErrorMessage } from './ai-errors';
import { escapeHtml, mediaKind, mediaList } from './format';
import { state } from './state';
import type { AnyRecord } from './types';

export function createAiActions({
  showToast,
  setButtonLoading,
  postponeAutoUpdateForAudio,
  syncAutoUpdateControls,
  audioWorkInProgress
}: AnyRecord) {
  async function showSummary(target) {
    const box = target === 'board' ? els.boardSummary : els.threadSummary;
    const button = target === 'board' ? els.boardSummaryButton : els.threadSummaryButton;
    const defaultHeading = 'Nội dung do AI tổng hợp';
    if (!state.aiConfigured) {
      box.classList.remove('hidden');
      box.innerHTML = `<strong>${defaultHeading}</strong><p>${AI_ERROR_MESSAGE}</p>`;
      return;
    }
    const requestBody: AnyRecord = { posterToken: state.posterToken };
    const summarizeSinceLastRead =
      target === 'thread' &&
      state.threadLastSeenBefore > 0 &&
      state.threadCurrentMaxNumber > state.threadLastSeenBefore;
    if (summarizeSinceLastRead) {
      requestBody.sinceGlobalNumber = state.threadLastSeenBefore;
    }
    const heading = summarizeSinceLastRead
      ? 'Nội dung do AI tổng hợp từ lần đọc trước'
      : defaultHeading;
    button.disabled = true;
    box.classList.remove('hidden');
    box.innerHTML = `<strong>${heading}</strong><p class="muted">Đang tóm tắt...</p>`;
    try {
      const path =
        target === 'board'
          ? `/api/boards/${state.boardSlug}/summary`
          : `/api/threads/${state.threadId}/summary`;
      const result = await api(path, { method: 'POST', body: JSON.stringify(requestBody) });
      box.innerHTML = `
      <strong>${heading}</strong>
      ${
        summarizeSinceLastRead
          ? `<p class="muted">Chỉ gồm bài mới sau No.${escapeHtml(state.threadLastSeenBefore)}.</p>`
          : ''
      }
      <ul>${result.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>
    `;
    } catch (error) {
      box.innerHTML = `<strong>${heading}</strong><p>${publicAiErrorMessage(error)}</p>`;
    } finally {
      button.disabled = false;
    }
  }

  async function loadSuggestions({ button = els.suggestButton, box = els.suggestions }: AnyRecord = {}) {
    const suggestButton = button || els.suggestButton;
    const suggestionsBox = box || els.suggestions;
    if (!suggestionsBox) {
      return;
    }
    if (!state.aiConfigured) {
      suggestionsBox.classList.remove('hidden');
      suggestionsBox.textContent = AI_ERROR_MESSAGE;
      return;
    }
    if (suggestButton) {
      suggestButton.disabled = true;
    }
    suggestionsBox.classList.remove('hidden');
    suggestionsBox.textContent = 'Đang gợi ý...';
    try {
      const result = await api(`/api/threads/${state.threadId}/suggestions`, {
        method: 'POST',
        body: JSON.stringify({ posterToken: state.posterToken })
      });
      suggestionsBox.innerHTML = result.suggestions
        .map((text) => `<button type="button" data-suggestion="${encodeURIComponent(text)}">${escapeHtml(text)}</button>`)
        .join('');
    } catch (error) {
      suggestionsBox.textContent = publicAiErrorMessage(error);
    } finally {
      if (suggestButton) {
        suggestButton.disabled = false;
      }
    }
  }

  function draftMeterFor(textarea) {
    if (textarea === els.quickReplyBody) {
      return els.quickReplyDraftMeter;
    }
    if (textarea === els.commentBody) {
      return els.commentDraftMeter;
    }
    return null;
  }

  function refreshDraftChrome(textarea) {
    if (!textarea) {
      return;
    }
    updateDraftMeter(textarea, draftMeterFor(textarea));
    scrollComposerDraft(textarea);
  }

  async function rewriteDraft(target) {
    if (!state.aiConfigured) {
      showToast(AI_ERROR_MESSAGE);
      return;
    }
    const rewriteTargets: AnyRecord = {
      thread: {
        textarea: els.threadBody,
        warningBox: els.threadPrivacyWarning,
        button: els.threadRewriteButton,
        toneSelect: els.threadRewriteTone,
        label: els.threadAiRewriteLabel
      },
      comment: {
        textarea: els.commentBody,
        warningBox: els.commentPrivacyWarning,
        button: els.rewriteButton,
        toneSelect: els.rewriteTone,
        label: els.commentAiRewriteLabel
      },
      quickReply: {
        textarea: els.quickReplyBody,
        warningBox: els.quickReplyPrivacyWarning,
        button: els.quickReplyRewriteButton,
        toneSelect: els.quickReplyRewriteTone,
        label: els.quickReplyAiRewriteLabel
      }
    };
    const config = rewriteTargets[target] || rewriteTargets.comment;
    const { textarea, warningBox, button, toneSelect, label } = config;
    if (!textarea) {
      return;
    }
    const body = textarea.value.trim();
    if (!body) {
      showToast('Chưa có nội dung để AI sửa.');
      return;
    }

    const restoreButton = setButtonLoading(button, 'Đang sửa...');
    try {
      const tone = toneSelect ? toneSelect.value : 'neutral';
      const result = await api('/api/ai/rewrite', {
        method: 'POST',
        body: JSON.stringify({ body, posterToken: state.posterToken, tone })
      });
      textarea.value = result.text || body;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      updatePrivacyWarning(textarea.value, warningBox);
      if (label) {
        label.classList.remove('hidden');
      }
      refreshDraftChrome(textarea);
      textarea.focus();
      showToast('Đã điền bản viết lại vào nháp. Kiểm tra trước khi gửi.');
    } catch (error) {
      showToast(publicAiErrorMessage(error));
    } finally {
      restoreButton();
    }
  }

  async function translateDraft(target) {
    const translateTargets: AnyRecord = {
      comment: {
        textarea: els.commentBody,
        warningBox: els.commentPrivacyWarning,
        button: els.commentTranslateButton,
        langSelect: els.commentTranslateTarget
      },
      quickReply: {
        textarea: els.quickReplyBody,
        warningBox: els.quickReplyPrivacyWarning,
        button: els.quickReplyTranslateButton,
        langSelect: els.quickReplyTranslateTarget
      }
    };
    const config = translateTargets[target] || translateTargets.quickReply;
    const { textarea, warningBox, button, langSelect } = config;
    if (!textarea) {
      return;
    }
    const text = textarea.value.trim();
    if (!text) {
      showToast('Chưa có nội dung để dịch.');
      return;
    }
    const targetLang =
      langSelect?.value ||
      els.translateTarget?.value ||
      (target === 'comment' ? 'en' : 'en');
    const restoreButton = setButtonLoading(button, 'Đang dịch...');
    try {
      const result = await api('/api/ai/translate', {
        method: 'POST',
        body: JSON.stringify({ text, targetLang, posterToken: state.posterToken })
      });
      const next = String(result.text || '').trim();
      if (!next) {
        showToast('Không nhận được bản dịch.');
        return;
      }
      const original = String(textarea.value || '');
      const separator = original.endsWith('\n\n') ? '' : original.endsWith('\n') ? '\n' : '\n\n';
      const availableChars = DRAFT_MAX_CHARS - original.length - separator.length;
      if (availableChars <= 0) {
        showToast(`Nháp đã đạt giới hạn ${DRAFT_MAX_CHARS} ký tự, không thể thêm bản dịch.`);
        return;
      }
      const appendedTranslation = next.slice(0, availableChars);
      textarea.value = `${original}${separator}${appendedTranslation}`;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      updatePrivacyWarning(textarea.value, warningBox);
      refreshDraftChrome(textarea);
      textarea.focus();
      const translatedLang = result.targetLang || targetLang;
      showToast(
        appendedTranslation.length < next.length
          ? `Đã thêm một phần bản dịch ${translatedLang} bên dưới do giới hạn ký tự.`
          : `Đã thêm bản dịch ${translatedLang} bên dưới nháp. Kiểm tra trước khi gửi.`
      );
    } catch (error) {
      showToast(publicAiErrorMessage(error));
    } finally {
      restoreButton();
    }
  }

  // Reads the rendered text of a post body from the DOM so AI actions never need the raw payload.
  function postBodyText(globalNumber) {
    const article = document.getElementById(`p${globalNumber}`);
    const body = article?.querySelector('.post-body');
    return body ? body.textContent.trim() : '';
  }

  async function translatePost(button) {
    const number = button.dataset.translatePost;
    const text = postBodyText(number);
    if (!text) {
      showToast('Bài này không có nội dung để dịch.');
      return;
    }
    const article = document.getElementById(`p${number}`);
    const restore = setButtonLoading(button, '...');
    try {
      const targetLang = els.translateTarget ? els.translateTarget.value : 'en';
      const result = await api('/api/ai/translate', {
        method: 'POST',
        body: JSON.stringify({ text, targetLang, posterToken: state.posterToken })
      });
      let box = article.querySelector('.post-translation');
      if (!box) {
        box = document.createElement('div');
        box.className = 'post-translation';
        article.querySelector('.post-body').after(box);
      }
      // Free Google fallback when AI is off; AI path when configured — same response shape.
      box.textContent = `[${result.targetLang}] ${result.text}`;
    } catch (error) {
      showToast(publicAiErrorMessage(error));
    } finally {
      restore();
    }
  }

  let aiAudioPlayer = null;
  let aiTtsUnavailableUntil = 0;
  let browserSpeechUtterance = null;

  function browserSpeechSupported() {
    return Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  }

  function vietnameseSpeechVoice() {
    if (!browserSpeechSupported()) {
      return null;
    }
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((voice) => /^vi([-_]|$)/i.test(voice.lang)) ||
      voices.find((voice) => /vietnam|việt|tieng viet|tiếng việt/i.test(`${voice.name} ${voice.lang}`)) ||
      null
    );
  }

  function stopCurrentSpeech() {
    if (aiAudioPlayer) {
      aiAudioPlayer.pause();
      aiAudioPlayer.currentTime = 0;
      aiAudioPlayer = null;
    }
    if (browserSpeechSupported()) {
      window.speechSynthesis.cancel();
    }
    browserSpeechUtterance = null;
  }

  function speakWithBrowser(text) {
    if (!browserSpeechSupported()) {
      throw new Error('Trình duyệt này chưa hỗ trợ đọc bài viết.');
    }

    stopCurrentSpeech();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 2000));
    utterance.lang = 'vi-VN';
    utterance.rate = 1;
    utterance.pitch = 1;
    const voice = vietnameseSpeechVoice();
    if (voice) {
      utterance.voice = voice;
    }
    browserSpeechUtterance = utterance;

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        callback();
      };
      const timer = window.setTimeout(() => settle(resolve), 300);
      utterance.onstart = () => settle(resolve);
      utterance.onend = () => {
        if (browserSpeechUtterance === utterance) {
          browserSpeechUtterance = null;
        }
      };
      utterance.onerror = (event) => {
        if (event.error === 'canceled' || event.error === 'interrupted') {
          settle(resolve);
          return;
        }
        if (browserSpeechUtterance === utterance) {
          browserSpeechUtterance = null;
        }
        settle(() => reject(new Error('Trình duyệt không đọc được bài này.')));
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  function canFallbackToBrowserSpeech(error) {
    return [429, 502, 503, 504].includes(error?.statusCode);
  }

  async function speakPost(button) {
    const text = postBodyText(button.dataset.ttsPost);
    if (!text) {
      showToast('Bài này không có nội dung để đọc.');
      return;
    }
    const restore = setButtonLoading(button, '...');
    try {
      if (!state.aiConfigured || Date.now() < aiTtsUnavailableUntil) {
        await speakWithBrowser(text);
        showToast(state.aiConfigured ? 'Đang đọc bằng giọng trình duyệt do TTS đang giới hạn.' : 'Đang đọc bằng giọng trình duyệt.');
        return;
      }

      const result = await api('/api/ai/speak', {
        method: 'POST',
        timeoutMs: AI_SPEAK_TIMEOUT_MS,
        body: JSON.stringify({ text: text.slice(0, 2000), posterToken: state.posterToken })
      });
      stopCurrentSpeech();
      aiAudioPlayer = new Audio(`data:${result.mimeType};base64,${result.audio}`);
      await aiAudioPlayer.play();
    } catch (error) {
      if (canFallbackToBrowserSpeech(error) && browserSpeechSupported()) {
        aiTtsUnavailableUntil = Date.now() + AI_TTS_PROVIDER_COOLDOWN_MS;
        try {
          await speakWithBrowser(text);
          showToast('TTS đang bị giới hạn; đang đọc bằng giọng trình duyệt.');
          return;
        } catch {
          // Fall through and show the provider error if local speech cannot start.
        }
      }
      showToast(publicAiErrorMessage(error));
    } finally {
      restore();
    }
  }

  // Caption (describe/OCR) the image already attached to a composer, inserting the result into the draft.
  async function captionAttachedImage({ stateKey, textarea, mode = 'describe' }: AnyRecord = {}) {
    if (!state.aiConfigured) {
      showToast(AI_ERROR_MESSAGE);
      return;
    }
    const image = mediaList(state[stateKey]).find((item) => mediaKind(item) === 'image');
    if (!image || !image.dataUrl) {
      showToast('Chưa có ảnh đính kèm để AI mô tả.');
      return;
    }
    try {
      const result = await api('/api/ai/caption', {
        method: 'POST',
        body: JSON.stringify({ data: image.dataUrl, mimeType: image.type, mode, posterToken: state.posterToken })
      });
      if (!result.text) {
        showToast(mode === 'ocr' ? 'Không tìm thấy chữ trong ảnh.' : 'AI chưa mô tả được ảnh.');
        return;
      }
      appendDraftText(textarea, result.text);
      showToast('Đã chèn mô tả ảnh vào nháp. Kiểm tra trước khi gửi.');
    } catch (error) {
      showToast(publicAiErrorMessage(error));
    }
  }

  function appendDraftText(textarea, text) {
    const prefix = textarea.value.trim() ? `${textarea.value.trim()}\n` : '';
    const next = `${prefix}${text}`;
    textarea.value = next.slice(0, DRAFT_MAX_CHARS);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    refreshDraftChrome(textarea);
    textarea.focus();
  }

  function setAudioTranscribing(key, active) {
    if (!key) {
      return;
    }
    if (active) {
      state.audioTranscribing.add(key);
      postponeAutoUpdateForAudio();
    } else {
      state.audioTranscribing.delete(key);
      syncAutoUpdateControls();
    }
  }

  function cancelAudioTranscription(key) {
    const controller = key ? state.audioTranscriptionControllers.get(key) : null;
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
  type SpeechRecognitionLike = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    start: () => void;
    stop: () => void;
    abort: () => void;
    onstart: ((event: Event) => void) | null;
    onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
    onend: ((event: Event) => void) | null;
  };
  type SpeechRecognitionResultEventLike = {
    resultIndex: number;
    results: ArrayLike<{
      isFinal: boolean;
      0: { transcript: string };
    }>;
  };
  type SpeechRecognitionErrorEventLike = {
    error: string;
  };

  function speechRecognitionConstructor(): SpeechRecognitionCtor | null {
    const win = window as Window & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    return win.SpeechRecognition || win.webkitSpeechRecognition || null;
  }

  function browserSpeechRecognitionSupported() {
    return Boolean(speechRecognitionConstructor());
  }

  function allowedSpeechSttLang(value: unknown) {
    const code = String(value || '').trim();
    return SPEECH_STT_LANGUAGES.some((lang) => lang.value === code) ? code : DEFAULT_SPEECH_STT_LANG;
  }

  function readStoredSpeechSttLang() {
    try {
      return allowedSpeechSttLang(localStorage.getItem(SPEECH_STT_LANG_KEY));
    } catch {
      return DEFAULT_SPEECH_STT_LANG;
    }
  }

  function writeStoredSpeechSttLang(lang: string) {
    const safe = allowedSpeechSttLang(lang);
    try {
      localStorage.setItem(SPEECH_STT_LANG_KEY, safe);
    } catch {
      // Ignore quota / private mode failures.
    }
    return safe;
  }

  function speechLangSelects() {
    return [...document.querySelectorAll<HTMLSelectElement>('[data-speech-lang]')];
  }

  function syncSpeechLangSelects(lang = readStoredSpeechSttLang()) {
    const safe = allowedSpeechSttLang(lang);
    for (const select of speechLangSelects()) {
      if (select.value !== safe) {
        select.value = safe;
      }
    }
    return safe;
  }

  function speechLangOptionsHtml(selected = readStoredSpeechSttLang()) {
    const safe = allowedSpeechSttLang(selected);
    return SPEECH_STT_LANGUAGES.map(
      (lang) =>
        `<option value="${escapeHtml(lang.value)}" title="${escapeHtml(lang.title)}"${
          lang.value === safe ? ' selected' : ''
        }>${escapeHtml(lang.label)}</option>`
    ).join('');
  }

  function initSpeechLangSelects() {
    const selected = readStoredSpeechSttLang();
    for (const select of speechLangSelects()) {
      if (!select.options.length) {
        select.innerHTML = speechLangOptionsHtml(selected);
      } else {
        select.value = selected;
      }
      select.disabled = !browserSpeechRecognitionSupported();
      if (!select.dataset.speechLangBound) {
        select.dataset.speechLangBound = '1';
        select.addEventListener('change', () => {
          const next = writeStoredSpeechSttLang(select.value);
          syncSpeechLangSelects(next);
        });
      }
    }
    syncSpeechLangSelects(selected);
  }

  // Reads an audio File as base64 and transcribes it into the given draft textarea (server AI).
  async function transcribeAudioFile(file, textarea, { activityKey = '' }: AnyRecord = {}) {
    if (!state.aiConfigured) {
      showToast(AI_ERROR_MESSAGE);
      return;
    }
    if (!file) {
      return;
    }
    const controller = window.AbortController ? new AbortController() : null;
    if (activityKey && controller) {
      state.audioTranscriptionControllers.set(activityKey, controller);
    }
    setAudioTranscribing(activityKey, true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Không đọc được tệp audio.'));
        reader.readAsDataURL(file);
      });
      const result = await api('/api/ai/transcribe', {
        method: 'POST',
        timeoutMs: AI_TRANSCRIBE_TIMEOUT_MS,
        signal: controller?.signal,
        body: JSON.stringify({ data: dataUrl, mimeType: file.type, filename: file.name, posterToken: state.posterToken })
      });
      if (!result.text) {
        showToast('Không nhận được nội dung từ audio.');
        return;
      }
      appendDraftText(textarea, result.text);
      showToast('Đã chèn lời thoại vào nháp. Kiểm tra trước khi gửi.');
    } catch (error) {
      if (error?.name === 'AbortError') {
        showToast('Đã dừng chép audio.');
        return;
      }
      showToast(publicAiErrorMessage(error));
    } finally {
      if (activityKey) {
        state.audioTranscriptionControllers.delete(activityKey);
      }
      setAudioTranscribing(activityKey, false);
    }
  }

  function setRecordButtonState(button, stateName) {
    if (!button) {
      return;
    }
    const recording = stateName === 'recording';
    const transcribing = stateName === 'transcribing';
    button.classList.toggle('is-recording', recording);
    button.classList.toggle('is-transcribing', transcribing);
    button.setAttribute('aria-pressed', recording || transcribing ? 'true' : 'false');
    button.disabled = false;
    button.textContent =
      stateName === 'recording' ? 'Dừng nói' : stateName === 'transcribing' ? 'Dừng chép' : 'Nói';
  }

  function stopActiveSpeechRecognition(key, { abort = false } = {}) {
    const active = state.audioRecorders[key];
    if (!active?.recognition) {
      return false;
    }
    active.intentionallyStopped = true;
    try {
      if (abort) {
        active.recognition.abort();
      } else {
        active.recognition.stop();
      }
    } catch {
      // Recognition may already be ending.
    }
    return true;
  }

  function speechErrorMessage(code: string) {
    if (code === 'not-allowed') {
      return 'Trình duyệt chặn microphone trên site này (kiểm tra quyền site + Permissions-Policy).';
    }
    if (code === 'service-not-allowed') {
      return 'Trình duyệt chặn dịch vụ nhận dạng giọng nói. Dùng Chrome/Edge (HTTPS) hoặc tải file audio để chép.';
    }
    if (code === 'audio-capture') {
      return 'Không tìm thấy microphone.';
    }
    if (code === 'network') {
      return 'Nhận dạng giọng nói cần mạng (dịch vụ trình duyệt).';
    }
    if (code === 'language-not-supported') {
      return 'Trình duyệt không hỗ trợ ngôn ngữ nhận dạng này.';
    }
    if (code === 'no-speech') {
      return 'Không nghe thấy giọng nói. Thử nói lại.';
    }
    return code ? `Nhận dạng giọng nói thất bại (${code}).` : 'Nhận dạng giọng nói thất bại.';
  }

  function toggleAudioRecording({ key, button, textarea, langSelect }: AnyRecord = {}) {
    if (state.audioTranscribing.has(key)) {
      if (!cancelAudioTranscription(key)) {
        showToast('Đang dừng chép audio...');
      }
      return;
    }
    if (state.audioRecorders[key]?.recognition) {
      stopActiveSpeechRecognition(key);
      return;
    }

    const SpeechRecognition = speechRecognitionConstructor();
    if (!SpeechRecognition) {
      showToast('Trình duyệt này chưa hỗ trợ Web Speech API (Chrome/Edge khuyến nghị).');
      return;
    }
    if (audioWorkInProgress()) {
      showToast('Đang xử lý audio ở form khác. Dừng hoặc đợi bản ghi đó trước.');
      return;
    }

    const lang = allowedSpeechSttLang(
      (langSelect as HTMLSelectElement | null | undefined)?.value || readStoredSpeechSttLang()
    );
    writeStoredSpeechSttLang(lang);
    syncSpeechLangSelects(lang);

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const session: AnyRecord = {
      recognition,
      intentionallyStopped: false,
      committed: String(textarea?.value || ''),
      finals: '',
      interim: '',
      charLimitNotified: false
    };

    const paintDraft = () => {
      if (!textarea) {
        return;
      }
      const base = session.committed;
      const spoken = `${session.finals}${session.interim}`;
      let next = !spoken
        ? base
        : !base.trim()
          ? spoken.trimStart()
          : `${base}${/\s$/.test(base) || /^\s/.test(spoken) ? '' : ' '}${spoken}`;
      if (next.length > DRAFT_MAX_CHARS) {
        next = next.slice(0, DRAFT_MAX_CHARS);
        session.intentionallyStopped = true;
        if (!session.charLimitNotified) {
          session.charLimitNotified = true;
          showToast(`Đã đạt ${DRAFT_MAX_CHARS} ký tự — dừng nhận dạng.`);
          try {
            recognition.stop();
          } catch {
            // Recognition may already be ending.
          }
        }
      }
      textarea.value = next;
      try {
        const end = next.length;
        textarea.setSelectionRange(end, end);
      } catch {
        // Ignore selection errors.
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      refreshDraftChrome(textarea);
    };

    recognition.onstart = () => {
      postponeAutoUpdateForAudio();
      setRecordButtonState(button, 'recording');
      refreshDraftChrome(textarea);
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const piece = result?.[0]?.transcript || '';
        if (!piece) {
          continue;
        }
        if (result.isFinal) {
          session.finals = `${session.finals}${piece}`;
        } else {
          interim += piece;
        }
      }
      session.interim = interim;
      paintDraft();
      postponeAutoUpdateForAudio();
    };

    recognition.onerror = (event) => {
      const code = String(event?.error || '');
      if (code === 'aborted') {
        return;
      }
      if (code === 'no-speech') {
        // Continuous sessions often emit no-speech; keep listening until user stops.
        return;
      }
      session.intentionallyStopped = true;
      showToast(speechErrorMessage(code));
    };

    recognition.onend = () => {
      // Chrome may end continuous recognition after a pause; restart while still active.
      if (!session.intentionallyStopped && state.audioRecorders[key] === session) {
        try {
          recognition.start();
          return;
        } catch {
          // Fall through to cleanup if restart is not allowed.
        }
      }
      if (state.audioRecorders[key] === session) {
        state.audioRecorders[key] = null;
      }
      if (textarea && session.interim) {
        // Drop trailing interim if the session ends without a final chunk.
        session.interim = '';
        paintDraft();
      }
      setRecordButtonState(button, 'idle');
      syncAutoUpdateControls();
    };

    state.audioRecorders[key] = session;
    try {
      recognition.start();
      setRecordButtonState(button, 'recording');
      postponeAutoUpdateForAudio();
      showToast(`Đang nghe (${lang})… Nói vào microphone.`);
    } catch {
      state.audioRecorders[key] = null;
      setRecordButtonState(button, 'idle');
      showToast('Không thể bắt đầu nhận dạng giọng nói.');
    }
  }

  initSpeechLangSelects();

  return {
    captionAttachedImage,
    initSpeechLangSelects,
    loadSuggestions,
    refreshDraftChrome,
    rewriteDraft,
    setRecordButtonState,
    showSummary,
    speakPost,
    syncSpeechLangSelects,
    toggleAudioRecording,
    transcribeAudioFile,
    translateDraft,
    translatePost
  };
}
