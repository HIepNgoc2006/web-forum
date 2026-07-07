import type { AnyRecord } from './types';

export function bindAiActionEvents({ els, ai }: AnyRecord) {
  els.boardSummaryButton.addEventListener('click', () => ai.showSummary('board'));
  els.threadSummaryButton.addEventListener('click', () => ai.showSummary('thread'));
  els.suggestButton.addEventListener('click', ai.loadSuggestions);
  els.threadRewriteButton.addEventListener('click', () => ai.rewriteDraft('thread'));
  els.rewriteButton.addEventListener('click', () => ai.rewriteDraft('comment'));
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
  els.threadRecordButton?.addEventListener('click', () =>
    ai.toggleAudioRecording({ key: 'thread', button: els.threadRecordButton, textarea: els.threadBody })
  );
  els.commentRecordButton?.addEventListener('click', () =>
    ai.toggleAudioRecording({ key: 'comment', button: els.commentRecordButton, textarea: els.commentBody })
  );
}
