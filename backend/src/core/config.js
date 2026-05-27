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
  { name: 'Sáng tạo', slugs: ['meme'] },
  { name: 'Tiện ích', slugs: ['viec-lam', 'mua-ban'] },
  { name: 'Khác', slugs: ['random'] }
];

export const MODERATION_LABELS = ['Toxic', 'Spam', 'Hate Speech', 'Fake News'];

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
    hcaptchaSiteKey: process.env.HCAPTCHA_SITE_KEY ?? '',
    maxImageBytes: Number(process.env.MAX_IMAGE_BYTES ?? 1_500_000)
  };
}
