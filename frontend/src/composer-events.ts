import { confirmPrivacyBeforeSubmit, updatePrivacyWarning } from './composer';
import { clearDisplayName, capcodeValue, displayNameValue, formValue, hasOption, withImageSpoiler } from './post-form';
import type { AnyRecord } from './types';

type ComposerControllerDependencies = {
  state: AnyRecord;
  els: AnyRecord;
  api: (url: string, options?: AnyRecord) => Promise<any>;
  showToast: (message: string) => void;
  setButtonLoading: (button: AnyRecord, text?: string) => () => void;
  setFormError: (element: AnyRecord, message?: string) => void;
  resetHcaptcha: (element: AnyRecord) => void;
  draftKey: (scope: string, boardId: string) => string;
  readDraft: (key: string) => string;
  writeDraft: (key: string, value: string) => void;
  removeDraft: (key: string) => void;
  rememberMyPost: (post: AnyRecord, type: string) => void;
  myPostDeletePassword: (globalNumber: string | number) => string;
  refreshCurrentScreen: () => Promise<any>;
  loadThread: (options?: AnyRecord) => Promise<any>;
  loadBoard: () => Promise<any>;
  isCapcodeEligible: () => boolean;
  deletePasswordValue: (form: AnyRecord) => string;
  clamp: (value: number, min: number, max: number) => number;
  showPostEditModal: (globalNumber: string | number, currentBody: string, options?: AnyRecord) => Promise<any>;
  postSubmitToast: (result: AnyRecord, successMessage: string, pendingMessage: string) => string;
};

export function createComposerController({
  state,
  els,
  api,
  showToast,
  setButtonLoading,
  setFormError,
  resetHcaptcha,
  draftKey,
  readDraft,
  writeDraft,
  removeDraft,
  rememberMyPost,
  myPostDeletePassword,
  refreshCurrentScreen,
  loadThread,
  loadBoard,
  isCapcodeEligible,
  deletePasswordValue,
  clamp,
  showPostEditModal,
  postSubmitToast
}: ComposerControllerDependencies) {
  function confirmDuplicateThreadIfNeeded(body: string) {
    return api(`/api/boards/${state.boardSlug}/threads/check-duplicate`, {
      method: 'POST',
      body: JSON.stringify({
        body,
        posterToken: state.posterToken
      })
    })
      .then((result: AnyRecord) => {
        if (!result?.isDuplicate) {
          return true;
        }
        return window.confirm(
          `Cảnh báo: bài viết này có vẻ trùng chủ đề với một chủ đề trước đó.\n\n${result.reason || 'AI phát hiện nội dung tương tự.'}\n\nBạn vẫn muốn đăng?`
        );
      })
      .catch((error) => {
        console.warn('Bỏ qua lỗi kiểm tra trùng lặp:', error);
        return true;
      });
  }

  function createComment(body: string, captchaToken: string) {
    const useQuickReply = !els.quickReply.classList.contains('hidden');
    const form = useQuickReply ? els.quickReplyForm : els.commentForm;
    const image = useQuickReply ? state.quickReplyImage : state.commentImage;
    return api(`/api/threads/${state.threadId}/comments`, {
      auth: 'account',
      method: 'POST',
      body: JSON.stringify({
        body,
        images: withImageSpoiler(image, form),
        captchaToken,
        posterToken: state.posterToken,
        displayName: displayNameValue(form, state.account),
        options: formValue(form, 'options'),
        deletePassword: deletePasswordValue(form),
        capcode: capcodeValue(form, { isCapcodeEligible })
      })
    });
  }

  async function submitThread(event: SubmitEvent) {
    event.preventDefault();
    const body = els.threadBody.value;
    const captchaToken = els.threadCaptcha.value.trim();
    if (!confirmPrivacyBeforeSubmit(body, els.threadPrivacyWarning)) {
      showToast('Đã dừng gửi để bạn chỉnh sửa nội dung.');
      return;
    }
    if (state.hcaptchaSiteKey && !captchaToken) {
      showToast('Vui lòng hoàn tất hCaptcha trước khi gửi.');
      return;
    }
    const button = event.submitter;
    const restoreButton = setButtonLoading(button);
    try {
      if (!(await confirmDuplicateThreadIfNeeded(body))) {
        showToast('Đã dừng gửi để bạn chỉnh sửa nội dung.');
        return;
      }
      const options = formValue(els.threadForm, 'options');
      const payload = {
        subject: formValue(els.threadForm, 'subject'),
        body,
        pollOptions: els.threadPollOptions.value
          .split('\n')
          .map((option) => option.trim())
          .filter(Boolean),
        options,
        displayName: displayNameValue(els.threadForm, state.account),
        deletePassword: deletePasswordValue(els.threadForm),
        captchaToken,
        posterToken: state.posterToken,
        capcode: capcodeValue(els.threadForm, { isCapcodeEligible }),
        images: withImageSpoiler(state.selectedImage, els.threadForm)
      };
      const result = await api(`/api/boards/${state.boardSlug}/threads`, {
        auth: 'account',
        method: 'POST',
        body: JSON.stringify(payload)
      });
      rememberMyPost(result.thread, 'thread');
      els.threadBody.value = '';
      els.threadPollOptions.value = '';
      if (els.threadForm.elements.subject) {
        els.threadForm.elements.subject.value = '';
      }
      clearDisplayName(els.threadForm);
      removeDraft(draftKey('thread', state.boardSlug));
      updatePrivacyWarning('', els.threadPrivacyWarning);
      if (els.threadAiRewriteLabel) {
        els.threadAiRewriteLabel.classList.add('hidden');
      }
      els.threadImage.value = '';
      state.selectedImage = [];
      if (els.threadForm.elements.imageSpoiler) {
        els.threadForm.elements.imageSpoiler.checked = false;
      }
      if (els.threadForm.elements.capcode) {
        els.threadForm.elements.capcode.checked = false;
      }
      els.imagePreview.classList.add('hidden');
      resetHcaptcha(els.threadCaptcha);
      closeThreadComposer();
      showToast(postSubmitToast(result, 'Chủ đề đã công khai.', 'Đã vào hàng đợi chờ quản trị viên duyệt.'));
      if (hasOption(options, 'noko') && result.thread?.id) {
        window.location.hash = `#thread/${result.thread.id}`;
      } else {
        await loadBoard();
      }
    } catch (error) {
      showToast(error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitAppeal(event: SubmitEvent) {
    event.preventDefault();
    setFormError(els.appealError);
    els.appealResult?.classList.add('hidden');
    const token = els.appealToken?.value.trim() || '';
    const reason = els.appealReason?.value.trim() || '';
    if (!token || !reason) {
      setFormError(els.appealError, 'Nhập mã kháng nghị và lý do.');
      return;
    }
    const button = event.submitter || els.appealForm?.querySelector('[type="submit"]');
    const restoreButton = setButtonLoading(button, 'Đang gửi...');
    try {
      const result = await api('/api/appeals', {
        method: 'POST',
        body: JSON.stringify({ token, reason, posterToken: state.posterToken })
      });
      if (els.appealResult) {
        els.appealResult.textContent = `Đã gửi kháng nghị No.${result.globalNumber}. Trạng thái: ${result.status}.`;
        els.appealResult.classList.remove('hidden');
      }
      els.appealToken.value = '';
      els.appealReason.value = '';
      showToast('Đã gửi kháng nghị.');
    } catch (error) {
      setFormError(els.appealError, error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitComment(event: SubmitEvent) {
    event.preventDefault();
    if (state.threadIsArchived || state.threadIsLocked) {
      showToast(state.threadIsLocked ? 'Chủ đề đã bị khóa, không thể trả lời.' : 'Chủ đề đã lưu trữ, không thể trả lời.');
      return;
    }
    const button = event.submitter || els.commentForm.querySelector('[type="submit"]');
    const body = els.commentBody.value;
    const captchaToken = els.commentCaptcha.value.trim();
    if (!confirmPrivacyBeforeSubmit(body, els.commentPrivacyWarning)) {
      showToast('Đã dừng gửi để bạn chỉnh sửa nội dung.');
      return;
    }
    if (state.hcaptchaSiteKey && !captchaToken) {
      showToast('Vui lòng hoàn tất hCaptcha trước khi gửi.');
      return;
    }
    const restoreButton = setButtonLoading(button);
    try {
      const result = await createComment(body, captchaToken);
      rememberMyPost(result.comment, 'comment');
      els.commentBody.value = '';
      clearDisplayName(els.commentForm);
      removeDraft(draftKey('comment', state.threadId));
      updatePrivacyWarning('', els.commentPrivacyWarning);
      if (els.commentAiRewriteLabel) {
        els.commentAiRewriteLabel.classList.add('hidden');
      }
      els.commentImage.value = '';
      state.commentImage = [];
      if (els.commentForm.elements.imageSpoiler) {
        els.commentForm.elements.imageSpoiler.checked = false;
      }
      if (els.quickReplyForm?.elements?.imageSpoiler) {
        els.quickReplyForm.elements.imageSpoiler.checked = false;
      }
      if (els.commentForm.elements.capcode) {
        els.commentForm.elements.capcode.checked = false;
      }
      if (els.quickReplyForm?.elements?.capcode) {
        els.quickReplyForm.elements.capcode.checked = false;
      }
      els.commentImagePreview.innerHTML = '';
      els.commentImagePreview.classList.add('hidden');
      resetHcaptcha(els.commentCaptcha);
      showToast(postSubmitToast(result, 'Đã gửi.', 'Bình luận đang chờ duyệt.'));
      closeReplyComposer();
      await loadThread();
    } catch (error) {
      showToast(error.message);
    } finally {
      restoreButton();
    }
  }

  async function submitQuickReply(event: SubmitEvent) {
    event.preventDefault();
    if (state.threadIsArchived || state.threadIsLocked) {
      showToast(state.threadIsLocked ? 'Chủ đề đã bị khóa, không thể trả lời.' : 'Chủ đề đã lưu trữ, không thể trả lời.');
      closeQuickReply();
      return;
    }
    const button = event.submitter;
    const body = els.quickReplyBody.value;
    const captchaToken = els.quickReplyCaptcha.value.trim();
    if (!confirmPrivacyBeforeSubmit(body, els.quickReplyPrivacyWarning)) {
      showToast('Đã dừng gửi để bạn chỉnh sửa nội dung.');
      return;
    }
    if (state.hcaptchaSiteKey && !captchaToken) {
      showToast('Vui lòng hoàn tất hCaptcha trước khi gửi.');
      return;
    }
    const restoreButton = setButtonLoading(button);
    try {
      const result = await createComment(body, captchaToken);
      rememberMyPost(result.comment, 'comment');
      clearDisplayName(els.quickReplyForm);
      removeDraft(draftKey('quickReply', state.threadId));
      els.quickReplyFile.value = '';
      state.quickReplyImage = [];
      els.quickReplyFileName.textContent = 'Chưa chọn tệp';
      resetHcaptcha(els.quickReplyCaptcha);
      showToast(postSubmitToast(result, 'Đã gửi.', 'Bình luận đang chờ duyệt.'));
      closeQuickReply();
      await loadThread();
    } catch (error) {
      showToast(error.message);
    } finally {
      restoreButton();
    }
  }

  async function selfEditPost(globalNumber: string | number, currentBody = '') {
    const edit = await showPostEditModal(globalNumber, currentBody, { showReason: false });
    if (!edit) {
      return;
    }
    const password = window.prompt(`Mật khẩu để sửa bài No.${globalNumber}:`, myPostDeletePassword(globalNumber));
    if (password === null) {
      return;
    }
    const result = await api(`/api/posts/${encodeURIComponent(String(globalNumber))}`, {
      auth: 'none',
      method: 'PUT',
      body: JSON.stringify({
        body: edit.body,
        password
      })
    });
    rememberMyPost(result.post, result.type || 'thread');
    showToast(result.status === 'pending' ? 'Đã sửa bài. Nội dung đang chờ duyệt lại.' : 'Đã sửa bài.');
    await refreshCurrentScreen();
  }

  async function selfDeletePost(globalNumber: string | number, { fileOnly = false, sourceElement = null }: AnyRecord = {}) {
    const label = fileOnly ? 'xóa tệp khỏi bài' : 'xóa bài';
    const password = window.prompt(`Mật khẩu để ${label} No.${globalNumber}:`, myPostDeletePassword(globalNumber));
    if (password === null) {
      return;
    }
    const ok = window.confirm(fileOnly ? `Chỉ xóa tệp đính kèm khỏi No.${globalNumber}?` : `Xóa toàn bộ bài No.${globalNumber}?`);
    if (!ok) {
      return;
    }
    await api(`/api/posts/${encodeURIComponent(String(globalNumber))}`, {
      auth: 'none',
      method: 'DELETE',
      body: JSON.stringify({
        password,
        fileOnly
      })
    });
    showToast(fileOnly ? 'Đã xóa tệp đính kèm.' : 'Đã xóa bài.');
    const deletingCurrentThread =
      !fileOnly &&
      state.threadId &&
      String(globalNumber) === String(state.threadGlobalNumber) &&
      (window.location.hash || '').startsWith('#thread/');
    if (deletingCurrentThread) {
      window.location.hash = `#board/${state.boardSlug}`;
      return;
    }
    if ((window.location.hash || '').startsWith('#thread/') || sourceElement?.closest('#threadDetail')) {
      await loadThread();
    } else {
      await refreshCurrentScreen();
    }
  }

  function openThreadComposer({ focus = true }: AnyRecord = {}) {
    els.threadComposer.classList.remove('hidden');
    els.startThreadButton.classList.add('hidden');
    const savedDraft = readDraft(draftKey('thread', state.boardSlug));
    if (savedDraft && !els.threadBody.value) {
      els.threadBody.value = savedDraft;
      updatePrivacyWarning(els.threadBody.value, els.threadPrivacyWarning);
    }
    if (focus) {
      window.setTimeout(() => els.threadBody.focus(), 0);
    }
  }

  function closeThreadComposer() {
    els.threadComposer.classList.add('hidden');
    els.startThreadButton.classList.remove('hidden');
  }

  function syncReplyComposer() {
    const canReply = !state.threadIsArchived && !state.threadIsLocked;
    els.replyComposer.classList.toggle('hidden', !state.replyComposerOpen || !canReply);
    els.postReplyToggle.classList.toggle('hidden', state.replyComposerOpen || !canReply);
    if (!state.replyComposerOpen || !canReply) {
      els.suggestions.classList.add('hidden');
    }
  }

  function openReplyComposer({ focus = true }: AnyRecord = {}) {
    if (state.threadIsArchived || state.threadIsLocked) {
      showToast(state.threadIsLocked ? 'Chủ đề đã bị khóa, không thể trả lời.' : 'Chủ đề đã lưu trữ, không thể trả lời.');
      return;
    }
    state.replyComposerOpen = true;
    syncReplyComposer();
    const savedDraft = readDraft(draftKey('comment', state.threadId));
    if (savedDraft && !els.commentBody.value) {
      els.commentBody.value = savedDraft;
      updatePrivacyWarning(els.commentBody.value, els.commentPrivacyWarning);
    }
    if (focus) {
      window.setTimeout(() => els.commentBody.focus(), 0);
    }
  }

  function closeReplyComposer({ clear = false }: AnyRecord = {}) {
    state.replyComposerOpen = false;
    if (clear) {
      els.commentBody.value = '';
      els.suggestions.classList.add('hidden');
    }
    syncReplyComposer();
  }

  function positionQuickReply(event: PointerEvent) {
    const width = Math.min(332, window.innerWidth - 8);
    const height = Math.min(334, window.innerHeight - 8);
    const left = clamp(event.clientX - 20, 6, window.innerWidth - width - 6);
    const top = clamp(event.clientY + 10, 6, window.innerHeight - height - 6);
    els.quickReply.style.left = `${left}px`;
    els.quickReply.style.top = `${top}px`;
  }

  function addQuoteToQuickReply(number: string | number) {
    const quote = `>>${number}`;
    const lines = els.quickReplyBody.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.includes(quote)) {
      lines.push(quote);
    }
    els.quickReplyBody.value = `${lines.join('\n')}\n`;
    updatePrivacyWarning(els.quickReplyBody.value, els.quickReplyPrivacyWarning);
  }

  function openQuickReply(number, event: PointerEvent) {
    if (state.threadIsArchived || state.threadIsLocked) {
      showToast(state.threadIsLocked ? 'Chủ đề đã bị khóa, không thể trả lời.' : 'Chủ đề đã lưu trữ, không thể trả lời.');
      return;
    }
    const wasHidden = els.quickReply.classList.contains('hidden');
    const threadNumber = state.threadGlobalNumber || number;
    els.quickReplyTitle.textContent = `Trả lời chủ đề No.${threadNumber}`;
    if (wasHidden) {
      els.quickReplyBody.value = readDraft(draftKey('quickReply', state.threadId));
    }
    addQuoteToQuickReply(number);
    els.quickReplyCaptcha.value = state.hcaptchaSiteKey ? '' : els.commentCaptcha.value || 'dev-pass';
    els.quickReplyFile.value = '';
    state.quickReplyImage = [];
    els.quickReplyFileName.textContent = 'Chưa chọn tệp';
    if (wasHidden) {
      positionQuickReply(event);
    }
    els.quickReply.classList.remove('hidden');
    els.refPreview.classList.add('hidden');
    window.setTimeout(() => els.quickReplyBody.focus(), 0);
  }

  function closeQuickReply() {
    els.quickReply.classList.add('hidden');
    updatePrivacyWarning('', els.quickReplyPrivacyWarning);
    state.quickReplyDrag = null;
  }

  function bindComposerInputEvents() {
    els.threadBody.addEventListener('input', () => {
      writeDraft(draftKey('thread', state.boardSlug), els.threadBody.value);
      updatePrivacyWarning(els.threadBody.value, els.threadPrivacyWarning);
      if (els.threadAiRewriteLabel) {
        els.threadAiRewriteLabel.classList.add('hidden');
      }
    });
    els.commentBody.addEventListener('input', () => {
      writeDraft(draftKey('comment', state.threadId), els.commentBody.value);
      updatePrivacyWarning(els.commentBody.value, els.commentPrivacyWarning);
      if (els.commentAiRewriteLabel) {
        els.commentAiRewriteLabel.classList.add('hidden');
      }
    });
    els.quickReplyBody.addEventListener('input', () => {
      writeDraft(draftKey('quickReply', state.threadId), els.quickReplyBody.value);
      updatePrivacyWarning(els.quickReplyBody.value, els.quickReplyPrivacyWarning);
    });
  }

  return {
    submitThread,
    submitAppeal,
    submitComment,
    submitQuickReply,
    selfEditPost,
    selfDeletePost,
    openThreadComposer,
    closeThreadComposer,
    syncReplyComposer,
    openReplyComposer,
    closeReplyComposer,
    openQuickReply,
    closeQuickReply,
    bindComposerInputEvents,
    confirmDuplicateThreadIfNeeded
  };
}

