import '../src/core/env-init.ts';

import { createForumService } from '../src/core/forum-service.ts';
import { createJsonStore } from '../src/core/forum-store.ts';
import { createMongoStore } from '../src/core/mongo-store.ts';

type SeedThreadData = {
  boardSlug: string;
  subject: string;
  body: string;
  comments: string[];
};

const SEED_THREADS: SeedThreadData[] = [
  {
    boardSlug: 'hoc-tap',
    subject: 'Chia sẻ bộ đề ôn thi Cấu trúc Dữ liệu & Giải thuật + SQL kỳ này',
    body: 'Chào anh em, kỳ này mình vừa tổng hợp xong bộ 50 câu tự luận + trắc nghiệm Cấu trúc dữ liệu & SQL kèm đáp án chi tiết. Bác nào cần inbox hoặc comment mình gửi qua nhé.',
    comments: [
      'Xịn quá bác ơi, cho xin slot qua telegram với.',
      'Môn này học thầy H. khó vãi, kỳ trước tạch mất 2 credit.',
      'Cho mình hỏi phần Cây AVL với B-Tree có trong đề thi kỳ này không bác?',
      'Có chứ, AVL tree ra tầm 2 câu bài tập dựng cây đấy.',
      'Cảm ơn thớt nhiều nhé, chúc thớt kỳ này GPA 4.0!',
      'Đã nhận được file, uy tín luôn nhé anh em!'
    ]
  },
  {
    boardSlug: 'confession',
    subject: 'Thầm thích bạn nữ ngồi bàn 3 dãy bên phải thư viện tầng 4',
    body: 'Tuần nào mình cũng lên thư viện tầng 4 ôn thi, thấy bạn nữ tóc ngắn ngang vai hay đeo tai nghe màu trắng, ngồi đọc sách chuyên ngành Kinh tế. Không biết bạn có dùng 36chan không, ước gì có can đảm ra làm quen.',
    comments: [
      'Mạnh dạn lên bro, mang chai nước hoặc cái kẹo ra mời là xong.',
      'Tóc ngắn đeo tai nghe trắng? Hình như là bạn H. lớp Marketing K65 đấy thớt.',
      'Thôi đừng ngần ngại nữa, thời sinh viên qua nhanh lắm không làm quen sau này tiếc đấy.',
      'Mai cứ viết vào tờ note dán lên bàn bạn ấy là xong, tao thử rồi hiệu quả lắm.',
      'Ủng hộ thớt tiến lên! Có tin vui nhớ update nhé.'
    ]
  },
  {
    boardSlug: 'thi-cuoi-ky',
    subject: 'Còn 3 tiếng nữa nộp bài tập lớn mà nhóm 4 người 3 người mất tích...',
    body: 'Áp lực quá anh em ơi. Bài tập lớn 30% điểm môn Kiến trúc phần mềm mà 3 đứa cùng nhóm nhắn tin không rep, gọi không nghe. Giờ một mình gánh code backend + làm slide presentation.',
    comments: [
      'Chia buồn với ông, chụp màn hình tin nhắn lại rồi gửi mail thẳng cho giảng viên đi.',
      'Trường hợp này cứ xóa tên 3 đứa kia khỏi bìa slide luôn, không phải nể.',
      'Cố lên ông ơi, sắp xong rồi. Cần gánh phần slide không tôi hỗ trợ cho.',
      'Kinh nghiệm của tôi: Báo thầy ngay trước giờ nộp bài để thầy biết mình làm 1 mình.',
      'Gặp nhóm rùa là khổ nhất, kỳ sau chọn nhóm uy tín mà chơi.',
      'Ghi tên tụi nó 0% đóng góp vào biên bản làm việc nhóm nha thớt.'
    ]
  },
  {
    boardSlug: 'tam-su',
    subject: 'Có nên nghỉ làm thêm để tập trung học kỳ cuối không?',
    body: 'Hiện tại mình đang làm Part-time Dev lương 6tr/tháng, nhưng kỳ này đồ án tốt nghiệp nặng quá. Làm cả ngày tối về mệt không thức viết báo cáo được. Mọi người cho lời khuyên có nên xin nghỉ 3 tháng làm đồ án không?',
    comments: [
      'Nên nghỉ hoặc xin làm bớt giờ lại thớt ơi, Báo cáo đồ án mà trễ là chậm bằng cả năm đấy.',
      'Thương lượng với sếp xin nghỉ không lương 2 tháng làm đồ án, bảo làm xong quay lại.',
      'Bằng đại học chỉ lấy 1 lần, công việc thì ra trường làm cả đời lo gì.',
      'Tôi ngày trước vừa gánh đồ án vừa làm fulltime suýt nữa trượt tốt nghiệp, khuyên thật nên ưu tiên học.',
      'Đúng rồi, xin sếp tạm hoãn 2-3 tháng đi, công ty tử tế họ hỗ trợ ngay.'
    ]
  },
  {
    boardSlug: 'hoi-dap',
    subject: 'Thủ tục xin đăng ký học lại/học cải thiện môn Chủ nghĩa Xã hội khoa học?',
    body: 'Mọi người cho mình hỏi xin đăng ký học lại môn này thì đăng ký trên cổng thông tin sinh viên hay phải lên phòng Đào tạo nộp đơn ạ? Cảm ơn mọi người.',
    comments: [
      'Đăng ký trực tuyến trên trang tín chỉ đợt bổ sung nhé bạn.',
      'Đợi đợt 2 đăng ký tín chỉ mở là có lớp học lại đấy, không cần lên phòng đào tạo đâu.',
      'Môn này học cô T. cho điểm dễ thở lắm, canh đợt mở lớp mà đăng ký.',
      'Lưu ý nhớ đóng tiền học phí cải thiện đúng hạn không bị hủy môn nhé.',
      'Cảm ơn các bác nhiều nhé!'
    ]
  },
  {
    boardSlug: 'meme',
    subject: 'Biểu cảm của tôi khi đọc đề thi giữa kỳ môn Xác suất Thống kê',
    body: 'Học trên lớp 1 + 1 = 2, Đề thi giữa kỳ: Tính xác suất con mèo nhảy qua rào vào lúc 3h sáng...',
    comments: [
      'Kkk chuẩn vãi, đọc đề tưởng đọc tiếng Nguồn.',
      'Thầy bảo đề dễ lắm, đề dễ với thầy chứ sinh viên khóc thầm.',
      'Vừa thi xong sáng nay, 4 câu làm được đúng câu tên sinh viên.',
      'Cười trong nước mắt =)))',
      'Ai rồi cũng phải qua ngọn núi Xác suất Thống kê thôi.',
      'Lại hẹn gặp lại thầy ở kỳ hè rồi kkk.'
    ]
  },
  {
    boardSlug: 'viec-lam',
    subject: 'Sinh viên năm 2 nên chọn theo Java Spring Boot hay Node.js/TypeScript?',
    body: 'Em chào các anh chị, em đang học năm 2 ngành CNTT. Em muốn định hướng theo Backend nhưng đang phân vân giữa Java Spring Boot và Node.js/TypeScript. Nhờ mọi người tư vấn giúp em xu hướng tuyển dụng sắp tới với ạ.',
    comments: [
      'Java Spring Boot: Nhiều job doanh nghiệp lớn, ngân hàng, bảo mật cao, lương ổn định.',
      'Node.js (NestJS/Express): Nhanh, linh hoạt, rất hợp với Startup và làm Fullstack Javascript.',
      'Khuyên em học vững OOP và Data Structure trước, ngôn ngữ chỉ là công cụ thôi.',
      'Năm 2 thì cày Java cho chắc gốc kiến thức backend, sau chuyển sang Node.js cũng cực dễ.',
      'Cảm ơn các anh nhiều, em sẽ chọn Java Spring Boot để làm nền tảng trước!'
    ]
  },
  {
    boardSlug: 'su-kien',
    subject: 'Review Ngày hội Việc làm & TechDay 2026 tại hội trường A2',
    body: 'Hôm nay thớt đi TechDay ở A2 săn được bao nhiêu quà rồi anh em? Thấy mấy gian hàng FPT, Viettel, VNG đông dã dãn. Anh em nào nộp CV đợt này không?',
    comments: [
      'Săn được 3 cái áo phông + 2 bình giữ nhiệt xịn phết thớt ạ.',
      'VNG phỏng vấn nhanh tại chỗ luôn, hỏi thuật toán hơi gắt nhưng vui.',
      'Các bạn năm 3-4 nhớ mang theo nhiều bản cứng CV nhé, nộp trực tiếp cơ hội gọi cao hơn.',
      'Chiều nay 2h còn buổi workshop AI Engineering nữa đấy, anh em tranh thủ qua nghe.',
      'Tiếc quá sáng nay vướng ca học không đi được.'
    ]
  },
  {
    boardSlug: 'tuyen-clb',
    subject: 'CLB Lập trình & Sáng tạo tuyển thành viên Gen 10 kỳ này',
    body: 'CLB Lập trình chính thức mở đơn đăng ký Gen 10! Dành cho tất cả sinh viên đam mê Web, Mobile, AI, Game Dev. Không yêu cầu kinh nghiệm, được training từ A-Z bởi các cựu thành viên xịn xò.',
    comments: [
      'Cho em hỏi hạn chót nộp đơn là khi nào ạ?',
      'Hạn nộp đến hết chủ nhật tuần này 23h59 nhé em.',
      'Thành viên cũ Gen 8 vote CLB siêu nhiệt tình, học hỏi được rất nhiều dự án thực tế.',
      'Có vòng phỏng vấn test thuật toán không ad?',
      'Chỉ phỏng vấn trao đổi định hướng và đam mê thôi em, không áp lực đâu!',
      'Đã nộp đơn, hóng mail hẹn phỏng vấn ạ!'
    ]
  },
  {
    boardSlug: 'an-uong',
    subject: 'Góc quán ăn ngon giá sinh viên quanh khu vực cổng phụ trường',
    body: 'Tổng hợp danh sách các quán cơm tấm, bún chả, mì cay giá 25k-40k ngon bổ rẻ quanh cổng phụ cho tân sinh viên. Anh em có quán ruột nào đóng góp thêm dưới comment nhé!',
    comments: [
      'Quán bún đậu chị H. ngõ 12 ngon xuất sắc, mắm tôm pha cực đỉnh.',
      'Cơm gà xối mỡ ngõ 45 giá 30k mà đĩa cơm to bự, ăn no tới chiều.',
      'Thêm quán bánh mì chảo 25k đầu hẻm nữa thớt ơi, bao ngon rẻ.',
      'Save bài liền, cảm ơn thớt đã tổng hợp địa chỉ ăn uống chất lượng!',
      'Quán chè dừa dầm đối diện cổng phụ cũng ngon lắm nhé mọi người.',
      'Tối nay phải rủ đám bạn qua ăn thử đĩa cơm gà xối mỡ mới được.'
    ]
  }
];

async function seedData() {
  const storeDriver = String(process.env.STORE_DRIVER ?? 'mongo').toLowerCase();
  console.log(`Bắt đầu tạo dữ liệu với STORE_DRIVER=${storeDriver}...`);

  const store = storeDriver === 'mongo' ? createMongoStore() : createJsonStore();
  const aiMock = {
    moderate: async () => ({ status: 'Safe' as const, labels: [] }),
    moderateImage: async () => ({ status: 'Safe' as const, labels: [] }),
    checkDuplicateThread: async () => ({ isDuplicate: false, matchedThreadId: null, reason: null })
  };

  const service = createForumService({
    store,
    ai: aiMock,
    now: () => new Date()
  } as Parameters<typeof createForumService>[0]);

  let totalThreadsCreated = 0;
  let totalCommentsCreated = 0;

  for (const item of SEED_THREADS) {
    try {
      const createdThread = await service.createThread({
        boardSlug: item.boardSlug,
        subject: item.subject,
        body: item.body,
        captchaToken: 'dev-pass',
        ip: '127.0.0.1',
        posterToken: `op-${Math.random().toString(36).substring(2, 9)}`
      } as Parameters<typeof service.createThread>[0]);

      totalThreadsCreated++;
      console.log(`[Thread ${totalThreadsCreated}/10] Đã tạo trên /${item.boardSlug}/: "${item.subject}" (ID: ${createdThread.thread.id})`);

      for (let i = 0; i < item.comments.length; i++) {
        const commentBody = item.comments[i];
        await service.createComment({
          threadId: createdThread.thread.id,
          body: commentBody,
          captchaToken: 'dev-pass',
          ip: '127.0.0.1',
          posterToken: `commenter-${i}-${Math.random().toString(36).substring(2, 9)}`
        } as Parameters<typeof service.createComment>[0]);
        totalCommentsCreated++;
      }
    } catch (err: any) {
      console.error(`Lỗi khi tạo thread "${item.subject}":`, err?.message || err);
    }
  }

  console.log(`\nHoàn thành! Đã tạo thành công ${totalThreadsCreated} threads và ${totalCommentsCreated} bình luận.`);

  if (typeof store.close === 'function') {
    await store.close();
  }
}

seedData().catch((err) => {
  console.error('Lỗi khởi chạy seed data script:', err);
  process.exit(1);
});
