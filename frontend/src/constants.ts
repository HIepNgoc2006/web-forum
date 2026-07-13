export const REASON_MACROS = {
  approve: [
    'Nội dung hợp lệ',
    'Đã xác minh an toàn',
    'Nội dung không vi phạm'
  ],
  delete: [
    'Vi phạm nội quy',
    'Nội dung rác/spam',
    'Chứa thông tin cá nhân',
    'Nội dung thù ghét',
    'Tin giả/chưa xác minh'
  ],
  ban: [
    'Spam nhiều lần',
    'Vi phạm nghiêm trọng',
    'Quấy rối người khác',
    'Đăng nội dung bất hợp pháp'
  ],
  cooldown: [
    'Spam nhiều lần',
    'Đăng quá nhanh',
    'Quấy rối người khác'
  ],
  revoke: [
    'Hết hạn xử lý',
    'Xem xét lại, không vi phạm',
    'Yêu cầu gỡ bỏ'
  ],
  restore: [
    'Khôi phục sau khi xem xét lại',
    'Xóa nhầm',
    'Kháng nghị hợp lệ'
  ],
  'bulk-approve': [
    'Nội dung hợp lệ',
    'Đã xác minh an toàn',
    'Duyệt hàng loạt theo đợt'
  ],
  'bulk-delete': [
    'Vi phạm nội quy',
    'Nội dung rác/spam',
    'Xóa hàng loạt theo đợt'
  ]
};

export const REPORT_CATEGORIES = [
  { value: 'Spam', label: 'Spam' },
  { value: 'Toxic', label: 'Độc hại' },
  { value: 'PII', label: 'Thông tin cá nhân' },
  { value: 'Fake News', label: 'Tin giả' },
  { value: 'Illegal', label: 'Bất hợp pháp' },
  { value: 'Other', label: 'Khác' }
];

export const THREAD_TEMPLATES = [
  {
    key: 'study',
    label: 'Học tập',
    body: 'Mình muốn chia sẻ chuyện học tập:\n- Môn hoặc bối cảnh liên quan: ...\n- Điều đang vướng: ...\n- Mình đã thử: ...\nMong mọi người góp ý theo hướng tôn trọng và không nêu tên thật.'
  },
  {
    key: 'relationship',
    label: 'Tình cảm',
    body: 'Mình muốn kể một chuyện tình cảm ẩn danh:\n- Bối cảnh chung: ...\n- Điều mình đang phân vân: ...\n- Mình cần lời khuyên về: ...\nMong mọi người góp ý nhẹ nhàng, không đoán danh tính.'
  },
  {
    key: 'feedback',
    label: 'Góp ý',
    body: 'Mình muốn góp ý:\n- Vấn đề: ...\n- Ảnh hưởng: ...\n- Gợi ý cải thiện: ...\nMình viết để xây dựng, không nhắm vào cá nhân cụ thể.'
  }
];

export const WATCHED_THREAD_SORTS = new Set(['unread', 'recent', 'board']);

export const STICKERS = {
  cheer: { icon: '🎉', label: 'Cổ vũ' },
  panic: { icon: '😱', label: 'Hoảng' },
  study: { icon: '📚', label: 'Học' },
  thanks: { icon: '🙏', label: 'Cảm ơn' }
};

export const POST_REACTIONS = [
  { type: 'like', icon: '👍', label: 'Thích' },
  { type: 'laugh', icon: '😂', label: 'Cười' },
  { type: 'surprise', icon: '😮', label: 'Ngạc nhiên' },
  { type: 'sad', icon: '😢', label: 'Buồn' },
  { type: 'angry', icon: '😠', label: 'Bực' },
  { type: 'thanks', icon: '🙏', label: 'Cảm ơn' }
];

export const AUDIO_RECORDING_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

/** Browser Web Speech API STT languages (BCP-47). */
export const SPEECH_STT_LANGUAGES = [
  { value: 'vi-VN', label: 'VI', title: 'Tiếng Việt' },
  { value: 'en-US', label: 'EN', title: 'English (US)' },
  { value: 'en-GB', label: 'EN-GB', title: 'English (UK)' },
  { value: 'ja-JP', label: 'JA', title: '日本語' },
  { value: 'ko-KR', label: 'KO', title: '한국어' },
  { value: 'zh-CN', label: 'ZH', title: '中文 (简体)' },
  { value: 'zh-TW', label: 'ZH-TW', title: '中文 (繁體)' },
  { value: 'fr-FR', label: 'FR', title: 'Français' },
  { value: 'es-ES', label: 'ES', title: 'Español' },
  { value: 'de-DE', label: 'DE', title: 'Deutsch' },
  { value: 'th-TH', label: 'TH', title: 'ไทย' },
  { value: 'id-ID', label: 'ID', title: 'Bahasa Indonesia' },
  { value: 'pt-BR', label: 'PT', title: 'Português (Brasil)' },
  { value: 'ru-RU', label: 'RU', title: 'Русский' }
] as const;

export const SPEECH_STT_LANG_KEY = 'speechSttLang';

export const DEFAULT_SPEECH_STT_LANG = 'vi-VN';

export const AI_TRANSCRIBE_TIMEOUT_MS = 60_000;

export const AI_SPEAK_TIMEOUT_MS = 60_000;

export const AI_TTS_PROVIDER_COOLDOWN_MS = 60_000;

export const ADMIN_LOAD_TIMEOUT_MS = 60_000;

export const ADMIN_SETTINGS_REFRESH_MS = 60_000;

export const watchedThreadsKey = 'watchedThreads';

export const savedSearchesKey = 'savedSearches';

export const contentFiltersKey = 'contentFilters';

export const replyTemplatesKey = 'replyTemplates';

export const posterNotesKey = 'posterNotes';

export const myPostsKey = 'myPosts';

export const hiddenThreadsKey = 'hiddenThreads';

export const hiddenPostsKey = 'hiddenPosts';

export const deletePasswordKey = 'deletePassword';

export const subscribedBoardsKey = 'subscribedBoards';

export const themeKey = 'theme';

export const homeBoardKey = 'homeBoard';

export const displayPreferencesKey = 'displayPreferences';

export const notificationPreferencesKey = 'notificationPreferences';

export const boardThreadsCachePrefix = 'boardThreadsCache:';

export const aiNotConfiguredMessage =
  'Chưa cấu hình Google AI Studio. Thêm GOOGLE_AI_API_KEY vào backend/.env để dùng tính năng AI này.';

export const MAX_MEDIA_PER_POST = 4;

/** Max decoded media file size (images/videos). Keep in sync with backend DEFAULT_MAX_IMAGE_BYTES. */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export const SUPPORTED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

export const SUPPORTED_THEMES = ['yotsuba-b', 'yotsuba', 'tomorrow', 'burichan'];

export const API_BASE_URL = String(import.meta.env?.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export const REALTIME_URL = String(import.meta.env?.VITE_SOCKET_URL || '/events').trim() || '/events';

export const privacyRiskRules = [
  {
    label: 'email',
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  },
  {
    label: 'số điện thoại',
    pattern: /(?:^|[^\d])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?=$|[^\d])/
  },
  {
    label: 'mã sinh viên',
    pattern: /(?:^|\s)(?:mssv|mã sinh viên|ma sinh vien|student id)\s*[:#-]?\s*[A-Z0-9]{5,}(?=$|\s|[.,;!?])/i
  },
  {
    label: 'lớp học',
    pattern: /(?:^|\s)(?:lớp|lop|class)\s*[:#-]?\s*[A-Z0-9._-]{3,}(?=$|\s|[.,;!?])/i
  },
  {
    label: 'tên thật',
    pattern:
      /(?:^|\s)(?:tên\s+(?:mình|tôi|bạn ấy|nó)\s+là|mình\s+tên\s+là|bạn ấy\s+tên\s+là|người đó\s+tên\s+là)\s+[\p{L}]+(?:\s+[\p{L}]+){1,3}/iu
  }
];

export const rumorFrictionRules = [
  {
    label: 'thông tin chưa kiểm chứng',
    pattern: /(?:tin đồn|tin don|nghe nói|nghe noi|đồn là|don la|chưa kiểm chứng|chua kiem chung|bóc phốt|boc phot)/i
  },
  {
    label: 'cáo buộc cá nhân',
    pattern: /(?:lừa đảo|lua dao|ăn cắp|an cap|quấy rối|quay roi|ngoại tình|ngoai tinh|đánh người|danh nguoi|scam|biến thái|bien thai)/i
  }
];

export const COMMENT_SORT_LABELS = [
  ['best', 'tốt nhất'],
  ['top', 'nhiều điểm'],
  ['new', 'mới nhất'],
  ['controversial', 'gây tranh cãi'],
  ['old', 'cũ nhất']
];

export const CAPCODE_LABELS = {
  admin: '## Quản trị viên',
  moderator: '## Điều hành viên'
};
