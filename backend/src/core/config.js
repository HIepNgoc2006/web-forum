export const BOARDS = [
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

export const BOARD_GROUPS = [
  { name: 'Trường học', slugs: ['confession', 'hoc-tap', 'tam-su', 'hoi-dap'] },
  { name: 'Đời sống', slugs: ['su-kien', 'clb', 'an-uong', 'ktx'] },
  { name: 'Sự kiện tạm thời', slugs: ['deadline-week', 'thi-cuoi-ky', 'tuyen-clb'] },
  { name: 'Sáng tạo', slugs: ['meme'] },
  { name: 'Tiện ích', slugs: ['viec-lam', 'mua-ban'] },
  { name: 'Khác', slugs: ['random'] }
];

export const MODERATION_LABELS = ['Toxic', 'Spam', 'Hate Speech', 'Fake News', 'PII Risk'];
export const DEFAULT_MAX_IMAGE_BYTES = 1_500_000;
export const DEFAULT_MAX_THUMBNAIL_BYTES = 120_000;

export function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

const bumpLimit = readPositiveInteger(process.env.THREAD_BUMP_LIMIT, 300);

export const THREAD_LIFECYCLE = {
  maxActiveThreadsPerBoard: readPositiveInteger(process.env.MAX_ACTIVE_THREADS_PER_BOARD, 150),
  bumpLimit,
  replyLimit: Math.max(readPositiveInteger(process.env.THREAD_REPLY_LIMIT, 500), bumpLimit)
};

export function getBoard(slug) {
  return BOARDS.find((board) => board.slug === slug);
}

export function publicConfig() {
  return {
    boards: BOARDS,
    boardGroups: BOARD_GROUPS.map((group) => ({
      name: group.name,
      boards: group.slugs.map((slug) => getBoard(slug)).filter(Boolean)
    })),
    lifecycle: THREAD_LIFECYCLE,
    hcaptchaSiteKey: process.env.HCAPTCHA_SITE_KEY ?? '',
    maxImageBytes: readPositiveInteger(process.env.MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES),
    ai: {
      provider: 'google-ai-studio',
      configured: Boolean(process.env.GOOGLE_AI_API_KEY),
      model: process.env.GOOGLE_AI_MODEL ?? 'gemini-1.5-flash'
    }
  };
}
