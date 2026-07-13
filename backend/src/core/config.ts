export type ThreadLifecycle = {
  maxActiveThreadsPerBoard: number;
  bumpLimit: number;
  replyLimit: number;
};

export type RetentionPolicy = ThreadLifecycle & {
  publicArchive: boolean;
};

export type BoardBanner = {
  text?: string;
  imageUrl?: string;
  altText?: string;
};

export type BoardConfig = {
  slug: string;
  path: string;
  name: string;
  category: string;
  description: string;
  temporary?: boolean;
  eventEndsAt?: string;
  rules?: string[];
  retentionPolicy?: Partial<RetentionPolicy>;
  banner?: BoardBanner;
};

export type BoardGroup = {
  name: string;
  slugs: string[];
};

export type AiProvider = 'google-ai-studio' | 'openai-compatible';

export type AiConfigStatus = {
  provider: AiProvider;
  configured: boolean;
  model: string;
  moderationConfidenceThreshold: number;
};

export type PublicBoardConfig = Omit<BoardConfig, 'rules' | 'retentionPolicy' | 'banner'> & {
  rules: string[];
  retentionPolicy: RetentionPolicy;
  banner: {
    text: string;
    imageUrl?: string;
    altText?: string;
  };
};

export type PublicConfig = {
  boards: PublicBoardConfig[];
  boardGroups: Array<{
    name: string;
    boards: PublicBoardConfig[];
  }>;
  lifecycle: ThreadLifecycle;
  hcaptchaSiteKey: string;
  maxImageBytes: number;
  ai: AiConfigStatus;
};

/** Owner-editable public site copy (policy page and related text). */
export type SiteContent = {
  policyTitle: string;
  policySubtitle: string;
  rules: string[];
  privacy: string[];
  ai: string[];
  report: string[];
  appealIntro: string;
  feedback: string[];
  contact: string[];
  pii: string;
};

export const DEFAULT_SITE_CONTENT: SiteContent = {
  policyTitle: 'Nội quy, riêng tư và báo cáo',
  policySubtitle: 'Bản ngắn cho người dùng public trước khi đăng hoặc báo cáo bài viết.',
  rules: [
    'Không đăng đe dọa, quấy rối, kích động thù ghét, spam hoặc nội dung bất hợp pháp.',
    'Không doxxing, không tố cáo cá nhân chưa kiểm chứng, không đăng ảnh riêng tư của người khác.',
    'Giữ bài đúng bảng; bài sai bảng, lặp lại hoặc cố tình né kiểm duyệt có thể bị xóa.'
  ],
  privacy: [
    'Không cần tài khoản. Public chỉ thấy tên mặc định, số bài và mã poster ẩn danh trong ngữ cảnh thread.',
    'Trình duyệt giữ poster token cục bộ để nhận diện OP/xóa bài; server chỉ dùng hash cho chống lạm dụng.',
    'Raw IP, captcha token, poster token và admin token không được trả về public và không gửi lên AI.'
  ],
  ai: [
    'AI quét bài trước khi public để phát hiện độc hại, spam, thù ghét, tin giả và rủi ro PII.',
    'Bài bị gắn cờ sẽ bị giữ khỏi public cho đến khi quản trị viên xem xét.',
    'AI hỗ trợ kiểm duyệt, không phải quyết định cuối cùng; admin có quyền duyệt hoặc xóa.'
  ],
  report: [
    'Bấm [Báo cáo] dưới bài viết và nhập lý do ngắn, ví dụ: lộ số điện thoại, quấy rối, spam.',
    'Báo cáo đi vào hàng đợi admin; người báo cáo chỉ được lưu dưới dạng hash, không lộ poster token.',
    'Nếu có nguy cơ khẩn cấp ngoài đời thật, hãy liên hệ nhà trường hoặc cơ quan chức năng trước.'
  ],
  appealIntro: 'Dán mã kháng nghị đã nhận khi đăng bài và viết lý do ngắn để admin xem lại quyết định xóa.',
  feedback: [
    'Dùng bảng Hỏi đáp cho góp ý public về tính năng, nội quy, lỗi hiển thị hoặc trải nghiệm sử dụng.',
    'Viết góp ý cụ thể: vấn đề gặp phải, nơi xảy ra, ảnh hưởng và gợi ý cải thiện nếu có.',
    'Không đưa thông tin riêng tư của người khác vào bài góp ý; hãy dùng báo cáo nếu nội dung cần xử lý kín.'
  ],
  contact: [
    'Vấn đề public hoặc câu hỏi chung: đăng tại Hỏi đáp để admin và cộng đồng cùng phản hồi.',
    'Vấn đề liên quan bài viết cụ thể, riêng tư hoặc vi phạm: dùng nút [Báo cáo] ngay dưới bài đó.',
    'Yêu cầu khẩn cấp ngoài phạm vi diễn đàn nên gửi trực tiếp tới nhà trường, đơn vị quản lý hoặc cơ quan chức năng phù hợp.'
  ],
  pii: 'PII là thông tin cá nhân có thể nhận diện. Không đăng tên thật kèm ngữ cảnh nhận diện, số điện thoại, email cá nhân, mã sinh viên, lớp học cụ thể, phòng ký túc xá, lịch trình riêng, giấy tờ hoặc ảnh có thể nhận ra người khác. Nếu thấy thông tin này, hãy báo cáo để admin xử lý.'
};

export const BOARDS: BoardConfig[] = [
  {
    slug: 'confession',
    path: '/confession/',
    name: 'Thú nhận',
    category: 'Trường học',
    description: 'Đăng bài ẩn danh về trường, lớp, người thầm thích, hạn nộp bài và những chuyện khó nói.'
  },
  {
    slug: 'hoc-tap',
    path: '/hoc-tap/',
    name: 'Học tập',
    category: 'Trường học',
    description: 'Hỏi bài, tài liệu, hạn nộp bài và kinh nghiệm qua môn.'
  },
  {
    slug: 'tam-su',
    path: '/tam-su/',
    name: 'Tâm sự',
    category: 'Trường học',
    description: 'Tâm sự ẩn danh về trường lớp, bạn bè và những ngày khó nói.'
  },
  {
    slug: 'hoi-dap',
    path: '/hoi-dap/',
    name: 'Hỏi đáp',
    category: 'Trường học',
    description: 'Hỏi nhanh đáp gọn về học vụ, môn học, giảng viên, phòng ban và thủ tục.'
  },
  {
    slug: 'meme',
    path: '/meme/',
    name: 'Ảnh chế',
    category: 'Sáng tạo',
    description: 'Ảnh chế, đoạn nhại lặp và những thứ vô tri có tính giáo dục vừa đủ.'
  },
  {
    slug: 'su-kien',
    path: '/su-kien/',
    name: 'Sự kiện',
    category: 'Đời sống',
    description: 'Bàn luận về sự kiện, buổi chia sẻ, ngày hội câu lạc bộ và chuyện trong trường.'
  },
  {
    slug: 'clb',
    path: '/clb/',
    name: 'Câu lạc bộ',
    category: 'Đời sống',
    description: 'Tìm nhóm, rao tuyển thành viên, đánh giá câu lạc bộ và hoạt động ngoại khóa.'
  },
  {
    slug: 'deadline-week',
    path: '/deadline/',
    name: 'Tuần deadline',
    category: 'Sự kiện tạm thời',
    description: 'Board tạm thời cho mùa nộp bài, chạy deadline và cứu nhau qua tuần căng nhất.',
    temporary: true,
    eventEndsAt: '2026-06-15T23:59:59.000Z'
  },
  {
    slug: 'thi-cuoi-ky',
    path: '/thi/',
    name: 'Thi cuối kỳ',
    category: 'Sự kiện tạm thời',
    description: 'Board tạm thời cho lịch thi, đề cương, phòng thi và kinh nghiệm sống sót mùa cuối kỳ.',
    temporary: true,
    eventEndsAt: '2026-07-31T23:59:59.000Z'
  },
  {
    slug: 'tuyen-clb',
    path: '/tuyen-clb/',
    name: 'Tuyển CLB',
    category: 'Sự kiện tạm thời',
    description: 'Board tạm thời cho mùa tuyển câu lạc bộ, hỏi đáp vòng đơn, phỏng vấn và review hoạt động.',
    temporary: true,
    eventEndsAt: '2026-09-30T23:59:59.000Z'
  },
  {
    slug: 'viec-lam',
    path: '/viec-lam/',
    name: 'Việc làm',
    category: 'Tiện ích',
    description: 'Thực tập, việc làm thêm, hồ sơ ứng tuyển, phỏng vấn và kinh nghiệm đi làm sớm.'
  },
  {
    slug: 'mua-ban',
    path: '/mua-ban/',
    name: 'Mua bán',
    category: 'Tiện ích',
    description: 'Sách cũ, đồ học tập, vé sự kiện và trao đổi đồ dùng sinh viên.'
  },
  {
    slug: 'an-uong',
    path: '/an-uong/',
    name: 'Ăn uống',
    category: 'Đời sống',
    description: 'Đánh giá nhà ăn, quán gần trường, món rẻ, món cứu đói mùa hạn nộp bài.'
  },
  {
    slug: 'ktx',
    path: '/ktx/',
    name: 'Ký túc xá',
    category: 'Đời sống',
    description: 'Phòng ở, bạn cùng phòng, nội quy, đồ thất lạc và những câu chuyện ký túc xá.'
  },
  {
    slug: 'random',
    path: '/random/',
    name: 'Ngẫu nhiên',
    category: 'Khác',
    description: 'Chuyện linh tinh không hợp bảng nào khác, vẫn phải qua kiểm duyệt.'
  }
];

export const BOARD_GROUPS: BoardGroup[] = [
  { name: 'Trường học', slugs: ['confession', 'hoc-tap', 'tam-su', 'hoi-dap'] },
  { name: 'Đời sống', slugs: ['su-kien', 'clb', 'an-uong', 'ktx'] },
  { name: 'Sự kiện tạm thời', slugs: ['deadline-week', 'thi-cuoi-ky', 'tuyen-clb'] },
  { name: 'Sáng tạo', slugs: ['meme'] },
  { name: 'Tiện ích', slugs: ['viec-lam', 'mua-ban'] },
  { name: 'Khác', slugs: ['random'] }
];

export const MODERATION_LABELS: string[] = ['Toxic', 'Spam', 'Hate Speech', 'Fake News', 'PII Risk'];
/** Max decoded media payload size per file (images/videos). Default 50 MiB. */
export const DEFAULT_MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_THUMBNAIL_BYTES = 120_000;
const DEFAULT_BOARD_DESCRIPTION = 'Diễn đàn ảnh sinh viên ẩn danh có AI kiểm duyệt.';
const DEFAULT_BOARD_RULES = [
  'Không đăng thông tin cá nhân, doxxing, hoặc nội dung nhận diện người khác.',
  'Tin đồn, tố cáo và câu chuyện nhạy cảm cần viết trung lập, không kích động quấy rối.',
  'Bài sai chủ đề hoặc spam có thể bị ẩn, xóa, hoặc chuyển sang hàng chờ kiểm duyệt.'
];
const SAFE_BANNER_URL_PATTERN = /^(?:\/(?!\/)|https:\/\/)/i;

export function readPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

export function readModerationConfidenceThreshold(
  value: unknown = process.env.AI_MODERATION_QUEUE_CONFIDENCE_THRESHOLD
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(1, Math.max(0, parsed > 1 ? parsed / 100 : parsed));
}

const bumpLimit = readPositiveInteger(process.env.THREAD_BUMP_LIMIT, 300);

export const THREAD_LIFECYCLE = {
  maxActiveThreadsPerBoard: readPositiveInteger(process.env.MAX_ACTIVE_THREADS_PER_BOARD, 150),
  bumpLimit,
  replyLimit: Math.max(readPositiveInteger(process.env.THREAD_REPLY_LIMIT, 500), bumpLimit)
} satisfies ThreadLifecycle;

export function normalizeRetentionPolicy(
  value: unknown = {},
  defaults: ThreadLifecycle = THREAD_LIFECYCLE
): RetentionPolicy {
  const policy = value && typeof value === 'object' ? (value as Partial<RetentionPolicy>) : {};
  const normalized = {
    maxActiveThreadsPerBoard: readPositiveInteger(policy.maxActiveThreadsPerBoard, defaults.maxActiveThreadsPerBoard),
    bumpLimit: readPositiveInteger(policy.bumpLimit, defaults.bumpLimit),
    replyLimit: readPositiveInteger(policy.replyLimit, defaults.replyLimit),
    publicArchive: typeof policy.publicArchive === 'boolean' ? policy.publicArchive : true
  };
  return normalized;
}

export function getBoard(slug: string): BoardConfig | undefined {
  return BOARDS.find((board) => board.slug === slug);
}

function sanitizePlainText(value: unknown = '', fallback: unknown = '', maxLength = 400): string {
  const text = String(value || fallback)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLength);
}

function sanitizeSiteLines(
  value: unknown,
  fallback: string[],
  { maxItems = 12, maxLength = 500 }: { maxItems?: number; maxLength?: number } = {}
): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n/)
      : fallback;
  const lines = source
    .map((line) => sanitizePlainText(line, '', maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
  return lines.length ? lines : fallback.map((line) => sanitizePlainText(line, '', maxLength)).filter(Boolean);
}

export function normalizeSiteContent(value: unknown = {}): SiteContent {
  const input = value && typeof value === 'object' ? (value as Partial<SiteContent>) : {};
  const defaults = DEFAULT_SITE_CONTENT;
  return {
    policyTitle: sanitizePlainText(input.policyTitle, defaults.policyTitle, 120) || defaults.policyTitle,
    policySubtitle:
      sanitizePlainText(input.policySubtitle, defaults.policySubtitle, 300) || defaults.policySubtitle,
    rules: sanitizeSiteLines(input.rules, defaults.rules),
    privacy: sanitizeSiteLines(input.privacy, defaults.privacy),
    ai: sanitizeSiteLines(input.ai, defaults.ai),
    report: sanitizeSiteLines(input.report, defaults.report),
    appealIntro: sanitizePlainText(input.appealIntro, defaults.appealIntro, 500) || defaults.appealIntro,
    feedback: sanitizeSiteLines(input.feedback, defaults.feedback),
    contact: sanitizeSiteLines(input.contact, defaults.contact),
    pii: sanitizePlainText(input.pii, defaults.pii, 1000) || defaults.pii
  };
}

function sanitizeBoardRules(board: BoardConfig, description: string): string[] {
  const configuredRules = Array.isArray(board.rules) ? board.rules : [];
  const fallbackRules = [description, ...DEFAULT_BOARD_RULES];
  const rules = configuredRules.length ? configuredRules : fallbackRules;
  return rules
    .map((rule) => sanitizePlainText(rule, '', 240))
    .filter(Boolean)
    .slice(0, 8);
}

function sanitizeBannerUrl(value: unknown = ''): string {
  const url = String(value || '').trim();
  return SAFE_BANNER_URL_PATTERN.test(url) ? url : '';
}

export function publicBoardConfig(board: BoardConfig): PublicBoardConfig {
  const name = sanitizePlainText(board.name, board.slug || '36chan', 80);
  const description = sanitizePlainText(board.description, DEFAULT_BOARD_DESCRIPTION, 500);
  const bannerText = sanitizePlainText(
    board.banner?.text,
    `Bảng ${name.toLowerCase()} sinh viên · ${description}`,
    180
  );
  const bannerImageUrl = sanitizeBannerUrl(board.banner?.imageUrl);
  const bannerAltText = sanitizePlainText(board.banner?.altText, bannerText, 140);

  return {
    ...board,
    name,
    category: sanitizePlainText(board.category, 'Khác', 80),
    description,
    rules: sanitizeBoardRules(board, description),
    retentionPolicy: normalizeRetentionPolicy(board.retentionPolicy),
    banner: {
      text: bannerText,
      ...(bannerImageUrl ? { imageUrl: bannerImageUrl, altText: bannerAltText } : {})
    }
  };
}

export function aiConfigStatus(): AiConfigStatus {
  const explicitAiProvider = process.env.AI_PROVIDER;
  const hasGoogleAi = Boolean(process.env.GOOGLE_AI_API_KEY);
  const hasOpenAiCompatible = Boolean(
    (process.env.OPENAI_COMPATIBLE_API_KEY && process.env.OPENAI_COMPATIBLE_BASE_URL) ||
      (process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL)
  );
  const aiProvider: AiProvider =
    explicitAiProvider === 'openai-compatible'
      ? 'openai-compatible'
      : explicitAiProvider === 'google' || explicitAiProvider === 'google-ai-studio' || hasGoogleAi || !hasOpenAiCompatible
        ? 'google-ai-studio'
        : 'openai-compatible';

  return {
    provider: aiProvider,
    configured: aiProvider === 'openai-compatible' ? hasOpenAiCompatible : hasGoogleAi,
    model:
      aiProvider === 'openai-compatible'
        ? process.env.OPENAI_COMPATIBLE_MODEL ?? 'gpt-4-turbo'
        : process.env.GOOGLE_AI_MODEL ?? 'gemini-1.5-flash',
    moderationConfidenceThreshold: readModerationConfidenceThreshold()
  };
}

export function publicConfig(): PublicConfig {
  const boards = BOARDS.map((board) => publicBoardConfig(board));
  const boardBySlug = new Map(boards.map((board) => [board.slug, board]));

  return {
    boards,
    boardGroups: BOARD_GROUPS.map((group) => ({
      name: group.name,
      boards: group.slugs.map((slug) => boardBySlug.get(slug)).filter(Boolean)
    })),
    lifecycle: THREAD_LIFECYCLE,
    hcaptchaSiteKey: process.env.HCAPTCHA_SITE_KEY ?? '',
    maxImageBytes: readPositiveInteger(process.env.MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES),
    ai: aiConfigStatus()
  };
}
