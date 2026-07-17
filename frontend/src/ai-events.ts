import type { AnyRecord } from './types';

export function bindAiActionEvents({ els, ai }: AnyRecord) {
  els.boardSummaryButton.addEventListener('click', () => ai.showSummary('board'));
  els.threadSummaryButton.addEventListener('click', () => ai.showSummary('thread'));
  els.suggestButton.addEventListener('click', () =>
    ai.loadSuggestions({ button: els.suggestButton, box: els.suggestions })
  );
  els.quickReplySuggestButton?.addEventListener('click', () =>
    ai.loadSuggestions({ button: els.quickReplySuggestButton, box: els.quickReplySuggestions })
  );
  els.threadRewriteButton.addEventListener('click', () => ai.rewriteDraft('thread'));
  els.rewriteButton.addEventListener('click', () => ai.rewriteDraft('comment'));
  els.quickReplyRewriteButton?.addEventListener('click', () => ai.rewriteDraft('quickReply'));
  els.commentTranslateButton?.addEventListener('click', () => ai.translateDraft('comment'));
  els.quickReplyTranslateButton?.addEventListener('click', () => ai.translateDraft('quickReply'));
  els.threadCaptionButton?.addEventListener('click', () =>
    ai.captionAttachedImage({ stateKey: 'selectedImage', textarea: els.threadBody, mode: 'describe' })
  );
  els.threadOcrButton?.addEventListener('click', () =>
    ai.captionAttachedImage({ stateKey: 'selectedImage', textarea: els.threadBody, mode: 'ocr' })
  );
  els.commentCaptionButton?.addEventListener('click', () =>
    ai.captionAttachedImage({ stateKey: 'commentImage', textarea: els.commentBody, mode: 'describe' })
  );
  els.commentOcrButton?.addEventListener('click', () =>
    ai.captionAttachedImage({ stateKey: 'commentImage', textarea: els.commentBody, mode: 'ocr' })
  );
  els.quickReplyCaptionButton?.addEventListener('click', () =>
    ai.captionAttachedImage({ stateKey: 'quickReplyImage', textarea: els.quickReplyBody, mode: 'describe' })
  );
  els.quickReplyOcrButton?.addEventListener('click', () =>
    ai.captionAttachedImage({ stateKey: 'quickReplyImage', textarea: els.quickReplyBody, mode: 'ocr' })
  );
  els.threadAudio?.addEventListener('change', async () => {
    els.threadAudio.disabled = true;
    ai.setRecordButtonState(els.threadRecordButton, 'transcribing');
    try {
      await ai.transcribeAudioFile(els.threadAudio.files?.[0], els.threadBody, { activityKey: 'thread' });
    } finally {
      els.threadAudio.disabled = false;
      ai.setRecordButtonState(els.threadRecordButton, 'idle');
    }
    els.threadAudio.value = '';
  });
  els.commentAudio?.addEventListener('change', async () => {
    els.commentAudio.disabled = true;
    ai.setRecordButtonState(els.commentRecordButton, 'transcribing');
    try {
      await ai.transcribeAudioFile(els.commentAudio.files?.[0], els.commentBody, { activityKey: 'comment' });
    } finally {
      els.commentAudio.disabled = false;
      ai.setRecordButtonState(els.commentRecordButton, 'idle');
    }
    els.commentAudio.value = '';
  });
  els.quickReplyAudio?.addEventListener('change', async () => {
    els.quickReplyAudio.disabled = true;
    ai.setRecordButtonState(els.quickReplyRecordButton, 'transcribing');
    try {
      await ai.transcribeAudioFile(els.quickReplyAudio.files?.[0], els.quickReplyBody, {
        activityKey: 'quickReply'
      });
    } finally {
      els.quickReplyAudio.disabled = false;
      ai.setRecordButtonState(els.quickReplyRecordButton, 'idle');
    }
    els.quickReplyAudio.value = '';
  });
  els.threadRecordButton?.addEventListener('click', () =>
    ai.toggleAudioRecording({
      key: 'thread',
      button: els.threadRecordButton,
      textarea: els.threadBody,
      langSelect: els.threadSpeechLang
    })
  );
  els.commentRecordButton?.addEventListener('click', () =>
    ai.toggleAudioRecording({
      key: 'comment',
      button: els.commentRecordButton,
      textarea: els.commentBody,
      langSelect: els.commentSpeechLang
    })
  );
  els.quickReplyRecordButton?.addEventListener('click', () =>
    ai.toggleAudioRecording({
      key: 'quickReply',
      button: els.quickReplyRecordButton,
      textarea: els.quickReplyBody,
      langSelect: els.quickReplySpeechLang
    })
  );
}
