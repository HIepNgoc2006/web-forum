import { api } from './api';
import { els } from './dom';
import { updatePrivacyWarning } from './composer';
import {
  AI_SPEAK_TIMEOUT_MS,
  AI_TRANSCRIBE_TIMEOUT_MS,
  AI_TTS_PROVIDER_COOLDOWN_MS,
  AUDIO_RECORDING_TYPES,
  aiNotConfiguredMessage
} from './constants';
import { audioExtension, escapeHtml, mediaKind, mediaList } from './format';
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
      box.innerHTML = `<strong>${defaultHeading}</strong><p>${aiNotConfiguredMessage}</p>`;
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
      box.innerHTML = `<strong>${heading}</strong><p>${error.message}</p>`;
    } finally {
      button.disabled = false;
    }
  }

  async function loadSuggestions() {
    if (!state.aiConfigured) {
      els.suggestions.classList.remove('hidden');
      els.suggestions.textContent = aiNotConfiguredMessage;
      return;
    }
    els.suggestButton.disabled = true;
    els.suggestions.classList.remove('hidden');
    els.suggestions.textContent = 'Đang gợi ý...';
    try {
      const result = await api(`/api/threads/${state.threadId}/suggestions`, {
        method: 'POST',
        body: JSON.stringify({ posterToken: state.posterToken })
      });
      els.suggestions.innerHTML = result.suggestions
        .map((text) => `<button type="button" data-suggestion="${encodeURIComponent(text)}">${escapeHtml(text)}</button>`)
        .join('');
    } catch (error) {
      els.suggestions.textContent = error.message;
    } finally {
      els.suggestButton.disabled = false;
    }
  }

  async function rewriteDraft(target) {
    if (!state.aiConfigured) {
      showToast(aiNotConfiguredMessage);
      return;
    }
    const isThread = target === 'thread';
    const textarea = isThread ? els.threadBody : els.commentBody;
    const warningBox = isThread ? els.threadPrivacyWarning : els.commentPrivacyWarning;
    const button = isThread ? els.threadRewriteButton : els.rewriteButton;
    const toneSelect = isThread ? els.threadRewriteTone : els.rewriteTone;
    const label = isThread ? els.threadAiRewriteLabel : els.commentAiRewriteLabel;
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
      updatePrivacyWarning(textarea.value, warningBox);
      if (label) {
        label.classList.remove('hidden');
      }
      textarea.focus();
      showToast('Đã điền bản viết lại vào nháp. Kiểm tra trước khi gửi.');
    } catch (error) {
      showToast(error.message);
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
    if (!state.aiConfigured) {
      showToast(aiNotConfiguredMessage);
      return;
    }
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
      box.textContent = `[${result.targetLang}] ${result.text}`;
    } catch (error) {
      showToast(error.message);
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
      showToast(error.message);
    } finally {
      restore();
    }
  }

  // Caption (describe/OCR) the image already attached to a composer, inserting the result into the draft.
  async function captionAttachedImage({ stateKey, textarea, mode = 'describe' }: AnyRecord = {}) {
    if (!state.aiConfigured) {
      showToast(aiNotConfiguredMessage);
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
      const prefix = textarea.value.trim() ? `${textarea.value.trim()}\n` : '';
      textarea.value = `${prefix}${result.text}`;
      textarea.focus();
      showToast('Đã chèn mô tả ảnh vào nháp. Kiểm tra trước khi gửi.');
    } catch (error) {
      showToast(error.message);
    }
  }

  function appendDraftText(textarea, text) {
    const prefix = textarea.value.trim() ? `${textarea.value.trim()}\n` : '';
    textarea.value = `${prefix}${text}`;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }

  function preferredAudioRecordingType() {
    if (!window.MediaRecorder?.isTypeSupported) {
      return '';
    }
    return AUDIO_RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function stopAudioStream(stream) {
    for (const track of stream?.getTracks?.() || []) {
      track.stop();
    }
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

  // Reads an audio File as base64 and transcribes it into the given draft textarea.
  async function transcribeAudioFile(file, textarea, { activityKey = '' }: AnyRecord = {}) {
    if (!state.aiConfigured) {
      showToast(aiNotConfiguredMessage);
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
      showToast(error.message);
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
      stateName === 'recording' ? '[Dừng ghi âm]' : stateName === 'transcribing' ? '[Dừng chép]' : '[Ghi âm]';
  }

  function stopActiveAudioRecording(key) {
    const active = state.audioRecorders[key];
    if (active?.recorder?.state === 'recording') {
      active.recorder.stop();
    }
  }

  async function toggleAudioRecording({ key, button, textarea }) {
    if (state.audioTranscribing.has(key)) {
      if (!cancelAudioTranscription(key)) {
        showToast('Đang dừng chép audio...');
      }
      return;
    }
    if (state.audioRecorders[key]?.recorder?.state === 'recording') {
      stopActiveAudioRecording(key);
      return;
    }
    if (!state.aiConfigured) {
      showToast(aiNotConfiguredMessage);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast('Trình duyệt này chưa hỗ trợ ghi âm trực tiếp.');
      return;
    }
    if (audioWorkInProgress()) {
      showToast('Đang xử lý audio ở form khác. Dừng hoặc đợi bản ghi đó trước.');
      return;
    }

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredAudioRecordingType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size > 0) {
          chunks.push(event.data);
        }
      });
      recorder.addEventListener('stop', async () => {
        stopAudioStream(stream);
        setRecordButtonState(button, 'transcribing');
        try {
          if (!chunks.length) {
            showToast('Không nhận được audio từ microphone.');
            return;
          }
          const type = recorder.mimeType || chunks[0]?.type || mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type });
          const file = new File([blob], `recording-${Date.now()}.${audioExtension(type)}`, { type });
          await transcribeAudioFile(file, textarea, { activityKey: key });
        } finally {
          state.audioRecorders[key] = null;
          setRecordButtonState(button, 'idle');
        }
      });
      recorder.addEventListener('error', () => {
        stopAudioStream(stream);
        state.audioRecorders[key] = null;
        setAudioTranscribing(key, false);
        setRecordButtonState(button, 'idle');
        showToast('Ghi âm thất bại.');
      });
      state.audioRecorders[key] = { recorder, stream };
      recorder.start();
      postponeAutoUpdateForAudio();
      setRecordButtonState(button, 'recording');
    } catch (error) {
      stopAudioStream(stream);
      state.audioRecorders[key] = null;
      setAudioTranscribing(key, false);
      setRecordButtonState(button, 'idle');
      showToast(error?.name === 'NotAllowedError' ? 'Bạn chưa cấp quyền microphone.' : 'Không thể bắt đầu ghi âm.');
    }
  }

  return {
    captionAttachedImage,
    loadSuggestions,
    rewriteDraft,
    setRecordButtonState,
    showSummary,
    speakPost,
    toggleAudioRecording,
    transcribeAudioFile,
    translatePost
  };
}
