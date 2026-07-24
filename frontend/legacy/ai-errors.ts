export const AI_ERROR_MESSAGE = 'AI đang gặp lỗi. Vui lòng thử lại sau.';

export function publicAiErrorMessage(_error?: unknown): string {
  return AI_ERROR_MESSAGE;
}
