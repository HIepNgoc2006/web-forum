export type UiLocale = 'vi' | 'en';

const LOCALE_STORAGE_KEY = 'uiLocale';
const TRANSLATABLE_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt', 'data-label'] as const;
const SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'textarea',
  'pre',
  'code',
  '[data-i18n-ignore]',
  '.post-body',
  '.thread-subject',
  '[data-poll-option]',
  '.latest-post-preview',
  '.watch-preview',
  '.popular-item > span:last-child',
  '.catalog-thread > strong',
  '.catalog-thread > p',
  '.archive-title'
].join(', ');
const ATTRIBUTE_SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  '[data-i18n-ignore]',
  '.post-body',
  '.thread-subject',
  '.latest-post-preview',
  '.watch-preview',
  '.popular-item > span:last-child',
  '.catalog-thread > strong',
  '.catalog-thread > p',
  '.archive-title'
].join(', ');

const TRANSLATION_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['Đang tải…', 'Loading...'],
  ['đang kết nối', 'connecting'],
  ['trực tiếp', 'live'],
  ['mất kết nối', 'offline'],
  ['cần cập nhật', 'refresh needed'],
  ['Trang chủ 36chan', '36chan home'],
  ['Trang chủ', 'Home'],
  ['Bảng', 'Boards'],
  ['Nội quy', 'Rules'],
  ['Nội quy & riêng tư', 'Rules & privacy'],
  ['Đăng nhập', 'Log in'],
  ['Đăng ký', 'Register'],
  ['Cài đặt', 'Settings'],
  ['Đăng xuất', 'Log out'],
  ['Quản trị', 'Admin'],
  ['Quay lại', 'Back'],
  ['Lên đầu', 'Top'],
  ['Cập nhật', 'Refresh'],
  ['Lưu', 'Save'],
  ['Hủy', 'Cancel'],
  ['Xóa', 'Delete'],
  ['Sửa', 'Edit'],
  ['Đóng', 'Close'],
  ['Gửi', 'Post'],
  ['Sao chép', 'Copy'],
  ['Chưa có dữ liệu', 'No data'],
  ['Không có dữ liệu', 'No data'],
  ['Không có', 'None'],
  ['Không có nội dung', 'No content'],
  ['Chưa có nội dung', 'No content yet'],
  ['không rõ', 'unknown'],
  ['Có', 'Yes'],
  ['Không', 'No'],
  ['Bật', 'On'],
  ['Tắt', 'Off'],
  ['36chan là gì?', 'What is 36chan?'],
  [
    '36chan là bảng tin ảnh ẩn danh đơn giản cho sinh viên. Ai cũng có thể đăng bài tâm sự ẩn danh, bình luận và hình ảnh mà không cần tạo tài khoản. Mỗi bảng dành cho một mảng riêng như đời sống trường lớp, học tập, ảnh chế, sự kiện, việc làm, ký túc xá và thảo luận linh tinh.',
    '36chan is a simple anonymous imageboard for students. Anyone can post anonymous stories, comments, and images without creating an account. Each board covers a different area such as campus life, study, memes, events, jobs, dorm life, and off-topic discussion.'
  ],
  [
    'AI kiểm duyệt sẽ giữ nội dung độc hại, nội dung rác, thù ghét và tin giả khỏi bảng công khai cho đến khi quản trị viên xem xét. Chọn bảng bạn quan tâm và tham gia ngay.',
    'AI moderation keeps toxic content, spam, hate, and misinformation off public boards until an administrator reviews it. Choose a board that interests you and join in.'
  ],
  ['lọc ▼', 'filter ▼'],
  ['Tìm bảng', 'Find a board'],
  ['confession, học tập, ăn uống...', 'confession, study, food...'],
  ['Đi', 'Go'],
  ['Chủ đề nổi bật', 'Popular threads'],
  ['tùy chọn ▼', 'options ▼'],
  ['Bài mới nhất', 'Latest posts'],
  ['Chủ đề đang theo dõi', 'Watched threads'],
  ['Sắp xếp watchlist', 'Sort watchlist'],
  ['chưa đọc trước', 'unread first'],
  ['mới cập nhật', 'recently updated'],
  ['theo bảng', 'by board'],
  ['chưa đọc', 'unread'],
  ['đã đọc hết', 'mark all read'],
  ['Bài của tôi', 'My posts'],
  ['Bảng đang theo dõi', 'Watched boards'],
  ['Đang nóng', 'Trending'],
  ['Nhịp campus', 'Campus pulse'],
  ['Thống kê', 'Statistics'],
  ['Thống Kê Máy Chủ', 'Server statistics'],
  ['Chân trang', 'Footer'],
  ['Thú nhận', 'Confessions'],
  ['Học tập', 'Study'],
  ['Ngẫu nhiên', 'Random'],
  ['Nội quy & riêng tư', 'Rules & privacy'],
  ['Góp ý', 'Feedback'],
  ['Cách báo cáo', 'How to report'],
  ['Liên hệ', 'Contact'],
  ['Bản quyền © 2026 dự án sinh viên 36chan. Không liên kết với 4chan.', 'Copyright © 2026 36chan student project. Not affiliated with 4chan.'],
  ['Mô Tả', 'Description'],
  ['Mô tả', 'Description'],
  ['Người Dùng', 'Users'],
  ['Người dùng', 'Users'],
  ['Bài Viết', 'Posts'],
  ['Bài viết', 'Posts'],
  ['Mở', 'Open'],
  ['Bài 24h', 'Posts 24h'],
  ['Chủ đề', 'Threads'],
  ['Phản hồi', 'Replies'],
  ['Hoạt động cuối', 'Last activity'],
  ['Từ khóa', 'Keyword'],
  ['Lần nhắc', 'Mentions'],
  ['Mới nhất', 'Latest'],
  ['Tổng bài viết:', 'Total posts:'],
  ['Người dùng hiện tại:', 'Current users:'],
  ['Dung lượng nội dung:', 'Content size:'],
  ['Bảng đang hoạt động:', 'Active boards:'],
  ['Chưa có chủ đề nổi bật. Chủ đề công khai sẽ xuất hiện ở đây sau khi có người đăng bài.', 'No popular threads yet. Public threads will appear here after someone posts.'],
  ['Chưa có bài công khai.', 'No public posts yet.'],
  ['Chưa có bài nào được ghi nhớ trên trình duyệt này.', 'No posts have been saved in this browser.'],
  ['Chưa theo dõi bảng nào. Vào board và bấm [Theo dõi bảng].', 'No watched boards yet. Open a board and select [Watch board].'],
  ['Chưa có bảng nào nóng trong 24 giờ qua.', 'No boards have been trending in the past 24 hours.'],
  ['Chưa đủ dữ liệu công khai trong 24 giờ qua.', 'Not enough public data from the past 24 hours.'],
  ['Chưa theo dõi chủ đề nào. Vào một thread và bấm [Theo dõi].', 'No watched threads yet. Open a thread and select [Watch].'],
  ['Không có chủ đề chưa đọc', 'No unread threads'],
  ['Không tải được ảnh', 'Image failed to load'],
  ['Hiện có', 'There are'],
  ['bảng công khai, tổng cộng', 'public boards, out of'],
  ['. Trên toàn hệ thống,', '. Across the system,'],
  ['bài viết đã được đăng trong ngày qua,', 'posts were published in the past day,'],
  ['bài trong giờ qua, tổng cộng', 'in the past hour, for a total of'],
  ['tệp đang được phục vụ, tổng cộng', 'files are being served, totaling'],
  ['Đăng bài ẩn danh về trường, lớp, người thầm thích, hạn nộp bài và những chuyện khó nói.', 'Post anonymously about campus, classes, crushes, deadlines, and things that are hard to say.'],
  ['Hỏi bài, tài liệu, hạn nộp bài và kinh nghiệm qua môn.', 'Ask about coursework, materials, deadlines, and how to pass classes.'],
  ['Tâm sự', 'Personal stories'],
  ['Tâm sự ẩn danh về trường lớp, bạn bè và những ngày khó nói.', 'Share anonymous stories about campus, friends, and difficult days.'],
  ['Hỏi đáp', 'Q&A'],
  ['Hỏi nhanh đáp gọn về học vụ, môn học, giảng viên, phòng ban và thủ tục.', 'Quick questions and answers about academics, courses, lecturers, departments, and procedures.'],
  ['Ảnh chế', 'Memes'],
  ['Ảnh chế, đoạn nhại lặp và những thứ vô tri có tính giáo dục vừa đủ.', 'Memes, copypasta, and just enough educational nonsense.'],
  ['Sự kiện', 'Events'],
  ['Bàn luận về sự kiện, buổi chia sẻ, ngày hội câu lạc bộ và chuyện trong trường.', 'Discuss events, talks, club fairs, and campus happenings.'],
  ['Câu lạc bộ', 'Clubs'],
  ['Tìm nhóm, rao tuyển thành viên, đánh giá câu lạc bộ và hoạt động ngoại khóa.', 'Find groups, recruit members, review clubs, and discuss extracurricular activities.'],
  ['Tuần deadline', 'Deadline week'],
  ['Board tạm thời cho mùa nộp bài, chạy deadline và cứu nhau qua tuần căng nhất.', 'Temporary board for assignment season, deadline crunches, and helping each other through the toughest week.'],
  ['Thi cuối kỳ', 'Final exams'],
  ['Board tạm thời cho lịch thi, đề cương, phòng thi và kinh nghiệm sống sót mùa cuối kỳ.', 'Temporary board for exam schedules, study guides, exam rooms, and surviving finals.'],
  ['Tuyển CLB', 'Club recruitment'],
  ['Board tạm thời cho mùa tuyển câu lạc bộ, hỏi đáp vòng đơn, phỏng vấn và review hoạt động.', 'Temporary board for club recruitment, applications, interviews, and activity reviews.'],
  ['Việc làm', 'Jobs'],
  ['Thực tập, việc làm thêm, hồ sơ ứng tuyển, phỏng vấn và kinh nghiệm đi làm sớm.', 'Internships, part-time jobs, applications, interviews, and early work experience.'],
  ['Mua bán', 'Marketplace'],
  ['Sách cũ, đồ học tập, vé sự kiện và trao đổi đồ dùng sinh viên.', 'Used books, study supplies, event tickets, and student exchanges.'],
  ['Ăn uống', 'Food'],
  ['Đánh giá nhà ăn, quán gần trường, món rẻ, món cứu đói mùa hạn nộp bài.', 'Reviews of cafeterias, nearby places, cheap meals, and deadline-season food.'],
  ['Ký túc xá', 'Dorms'],
  ['Phòng ở, bạn cùng phòng, nội quy, đồ thất lạc và những câu chuyện ký túc xá.', 'Rooms, roommates, rules, lost items, and dorm stories.'],
  ['Chuyện linh tinh không hợp bảng nào khác, vẫn phải qua kiểm duyệt.', 'Off-topic discussion that fits nowhere else, still subject to moderation.'],
  ['Tóm tắt AI', 'AI summary'],
  ['Nội quy bảng', 'Board rules'],
  ['Không đăng thông tin cá nhân, doxxing, hoặc nội dung nhận diện người khác.', 'Do not post personal information, doxxing, or content that identifies other people.'],
  ['Tin đồn, tố cáo và câu chuyện nhạy cảm cần viết trung lập, không kích động quấy rối.', 'Write rumors, accusations, and sensitive stories neutrally without encouraging harassment.'],
  ['Bài sai chủ đề hoặc spam có thể bị ẩn, xóa, hoặc chuyển sang hàng chờ kiểm duyệt.', 'Off-topic posts or spam may be hidden, deleted, or moved to the moderation queue.'],
  ['Tìm OP...', 'Search OP...'],
  ['Tìm OP', 'Search OP'],
  ['Danh mục', 'Catalog'],
  ['Kho lưu trữ', 'Archive'],
  ['Lưu tìm kiếm', 'Save search'],
  ['Theo dõi bảng', 'Watch board'],
  ['Bỏ theo dõi bảng', 'Unwatch board'],
  ['Sắp xếp chủ đề', 'Sort threads'],
  ['Sắp xếp', 'Sort'],
  ['Sắp xếp theo:', 'Sort by:'],
  ['Thứ tự đẩy lên', 'Bump order'],
  ['Ngày tạo', 'Created'],
  ['Số trả lời', 'Reply count'],
  ['Lọc', 'Filter'],
  ['Lọc:', 'Filter:'],
  ['Tất cả', 'All'],
  ['Có tệp', 'Has files'],
  ['Có video', 'Has video'],
  ['Có thăm dò', 'Has poll'],
  ['Chưa trả lời', 'Unanswered'],
  ['Tạo chủ đề mới', 'Create new thread'],
  ['Đăng ẩn danh · đính kèm ảnh/video tùy chọn', 'Post anonymously · optional image/video attachment'],
  ['Tên', 'Name'],
  ['TK', 'Account'],
  ['Dùng username tài khoản', 'Use account username'],
  ['Tùy chọn', 'Options'],
  ['sage = không bump; noko = ở lại thread sau khi gửi', 'sage = do not bump; noko = stay in the thread after posting'],
  ['Tiêu đề ngắn gọn...', 'Short subject...'],
  ['Bình luận', 'Comment'],
  ['Nội dung bài viết...', 'Post content...'],
  ['Emoji và sticker cho chủ đề', 'Emoji and stickers for the thread'],
  ['Chèn emoji vui', 'Insert happy emoji'],
  ['Chèn emoji cười', 'Insert laughing emoji'],
  ['Chèn emoji buồn', 'Insert sad emoji'],
  ['Chèn emoji nóng', 'Insert fire emoji'],
  ['Chèn emoji cảm ơn', 'Insert thanks emoji'],
  ['Cổ vũ', 'Cheer'],
  ['Hoảng', 'Panic'],
  ['Học', 'Study'],
  ['Cảm ơn', 'Thanks'],
  ['Chọn sticker hoặc GIF', 'Choose a sticker or GIF'],
  ['Sticker riêng của 36chan và GIF do KLIPY cung cấp.', '36chan stickers and GIFs powered by KLIPY.'],
  ['Đóng bộ chọn sticker và GIF', 'Close the sticker and GIF picker'],
  ['Loại media', 'Media type'],
  ['Bộ Pepe vàng vẩu · 34 sticker', 'Pepe vàng vẩu set · 34 stickers'],
  ['Xem trước', 'Preview'],
  ['Xem trước sticker đã chọn', 'Selected sticker preview'],
  ['Đã bỏ tất cả sticker đã chọn.', 'Removed all selected stickers.'],
  ['Sticker tùy chỉnh', 'Custom stickers'],
  ['Sticker không tải được', 'Sticker could not be loaded'],
  ['Danh sách sticker phản hồi quá lâu, vui lòng thử lại.', 'The sticker list took too long to respond. Please try again.'],
  ['Tên sticker (không bắt buộc)', 'Sticker name (optional)'],
  ['Liên kết Imgur', 'Imgur link'],
  ['Thêm sticker', 'Add sticker'],
  ['Đang hiện', 'Visible'],
  ['Đã ẩn', 'Hidden'],
  ['Ẩn khỏi bộ chọn', 'Hide from picker'],
  ['Hiện lại', 'Show again'],
  ['Chưa có sticker tùy chỉnh.', 'No custom stickers yet.'],
  ['Nguồn Imgur', 'Imgur source'],
  ['Danh sách sticker', 'Sticker list'],
  ['Kết quả GIF', 'GIF results'],
  ['Đóng bộ chọn Sticker và GIF', 'Close the Sticker and GIF picker'],
  ['Tìm GIF', 'Search GIFs'],
  ['Tìm', 'Search'],
  ['Tìm kiếm hoặc xem GIF thịnh hành.', 'Search or browse trending GIFs.'],
  ['Tải thêm', 'Load more'],
  ['Nguồn sticker trên Imgur', 'Sticker source on Imgur'],
  [
    'Từ khóa tìm kiếm được gửi đến KLIPY để tìm GIF. Không nhập thông tin cá nhân.',
    'Search terms are sent to KLIPY to find GIFs. Do not enter personal information.'
  ],
  ['Đang tải GIF thịnh hành…', 'Loading trending GIFs...'],
  ['Đang tải GIF...', 'Loading GIFs...'],
  ['Không tìm thấy GIF.', 'No GIFs found.'],
  ['Không tìm thấy GIF phù hợp.', 'No matching GIFs found.'],
  ['Không thể tải GIF lúc này.', 'GIFs could not be loaded right now.'],
  ['Không tải được GIF.', 'Could not load GIFs.'],
  ['GIF không tải được', 'GIF could not be loaded'],
  ['GIF từ KLIPY', 'GIF from KLIPY'],
  ['KLIPY phản hồi quá lâu, vui lòng thử lại.', 'KLIPY took too long to respond. Please try again.'],
  [
    'Tìm kiếm đi qua máy chủ 36chan; khi xem GIF, trình duyệt tải media trực tiếp từ KLIPY.',
    'Searches pass through the 36chan server; when viewing a GIF, your browser loads media directly from KLIPY.'
  ],
  ['Mẫu trả lời đã lưu', 'Saved reply templates'],
  ['Mẫu đã lưu', 'Saved templates'],
  ['Chưa có mẫu', 'No templates'],
  ['Chèn', 'Insert'],
  ['Lưu mẫu', 'Save template'],
  ['Mẫu bài ẩn danh', 'Anonymous post templates'],
  ['Mẫu', 'Template'],
  ['Tình cảm', 'Relationships'],
  ['Bỏ', 'Dismiss'],
  ['Tệp', 'File'],
  ['Tệp:', 'File:'],
  ['Tệp lỗi', 'File error'],
  ['Đăng với chức danh quản trị', 'Post with an admin title'],
  ['Tuỳ chọn nâng cao · thăm dò, ghi âm', 'Advanced options · poll, recording'],
  ['Thăm dò', 'Poll'],
  ['Mỗi dòng một lựa chọn, bỏ trống nếu không cần', 'One option per line; leave blank if not needed'],
  ['Thăm dò phải là danh sách lựa chọn', 'Poll choices must be provided as a list.'],
  ['Lựa chọn thăm dò phải là văn bản', 'Poll choices must be text.'],
  ['Lựa chọn thăm dò không được để trống', 'Poll choices cannot be blank.'],
  ['Mỗi lựa chọn thăm dò tối đa 120 ký tự', 'Each poll choice can contain at most 120 characters.'],
  ['Các lựa chọn thăm dò không được trùng nhau', 'Poll choices must be unique.'],
  ['Thăm dò có tối đa 6 lựa chọn', 'A poll can have at most 6 choices.'],
  ['Thăm dò cần ít nhất 2 lựa chọn', 'A poll needs at least 2 choices.'],
  ['Không tìm thấy thăm dò', 'Poll not found.'],
  ['Lựa chọn không hợp lệ', 'Invalid poll choice.'],
  ['Bạn đã vote thăm dò này', 'You have already voted in this poll.'],
  ['Thăm dò đã đóng', 'This poll is closed.'],
  ['Đã vote thăm dò.', 'Poll vote recorded.'],
  ['Âm thanh', 'Audio'],
  ['Ngôn ngữ nhận dạng giọng nói', 'Speech recognition language'],
  ['Nói', 'Speak'],
  ['Xác minh', 'Verification'],
  ['Mã xác minh', 'Verification code'],
  ['Mã dev: dev-pass (khi không dùng hCaptcha)', 'Dev code: dev-pass (when hCaptcha is disabled)'],
  ['Công cụ AI', 'AI tools'],
  ['Tông giọng', 'Tone'],
  ['Trung lập', 'Neutral'],
  ['Bớt gay gắt', 'Less aggressive'],
  ['An toàn riêng tư', 'Privacy safer'],
  ['An toàn', 'Safe'],
  ['Sửa an toàn', 'Rewrite safely'],
  ['Mô tả ảnh', 'Describe image'],
  ['Trích chữ', 'Extract text'],
  ['Ngôn ngữ dịch', 'Translation language'],
  ['Đã sửa bằng AI', 'Rewritten by AI'],
  ['Gửi chủ đề', 'Post thread'],
  ['Bảng thú nhận sinh viên chính thức', 'Official student confessions board'],
  ['Đề xuất', 'Recommended'],
  ['Trả lời mới nhất', 'Latest reply'],
  ['Số tệp', 'File count'],
  ['Chưa đọc', 'Unread'],
  ['Cỡ ảnh:', 'Image size:'],
  ['Nhỏ', 'Small'],
  ['Lớn', 'Large'],
  ['Chủ đề đã rời khỏi bảng đang hoạt động.', 'Threads that have left the active board.'],
  ['Diễn đàn ảnh sinh viên ẩn danh có AI kiểm duyệt', 'Anonymous student imageboard with AI moderation'],
  ['Đăng trả lời', 'Post a reply'],
  ['Trả lời', 'Reply'],
  ['Sửa bài', 'Edit post'],
  ['Thu', 'Collapse'],
  ['Ẩn', 'Hide'],
  ['Hiện lại', 'Restore'],
  ['Ẩn chủ đề', 'Hide thread'],
  ['Xem chủ đề', 'View thread'],
  ['Theo dõi', 'Watch'],
  ['Mở media', 'Expand media'],
  ['Thu media', 'Collapse media'],
  ['Mở bài', 'Expand posts'],
  ['Thu bài', 'Collapse posts'],
  ['Lọc ID', 'Filter ID'],
  ['Ghi chú ID', 'Note ID'],
  ['Phản hồi:', 'Replies:'],
  ['Tìm trong thread', 'Search thread'],
  ['Tìm', 'Search'],
  ['Tìm theo nội dung, số bài hoặc ID poster', 'Search by content, post number, or poster ID'],
  ['từ khóa, No. hoặc ID', 'keyword, No., or ID'],
  ['Sắp xếp bình luận', 'Sort comments'],
  ['Đang đếm từ và ký tự. Tối đa 5000 ký tự.', 'Counting words and characters. Maximum 5000 characters.'],
  ['Mở toàn bộ ảnh và video trong thread', 'Expand all images and videos in the thread'],
  ['Thu gọn toàn bộ bài trong thread', 'Collapse all posts in the thread'],
  ['Trả lời bài này', 'Reply to this post'],
  ['Điểm', 'Score'],
  ['Cảm xúc bài viết', 'Post reactions'],
  ['Thích', 'Like'],
  ['Cười', 'Laugh'],
  ['Ngạc nhiên', 'Surprised'],
  ['Buồn', 'Sad'],
  ['Bực', 'Angry'],
  ['Tiếng Việt', 'Vietnamese'],
  ['sắp xếp theo:', 'sort by:'],
  ['tốt nhất', 'best'],
  ['nhiều điểm', 'top rated'],
  ['mới nhất', 'newest'],
  ['gây tranh cãi', 'controversial'],
  ['cũ nhất', 'oldest'],
  ['AI gợi ý', 'AI suggestions'],
  ['AI sửa an toàn', 'AI safe rewrite'],
  ['Ngôn ngữ dịch nháp', 'Draft translation language'],
  ['Dịch nháp', 'Translate draft'],
  ['AI mô tả ảnh', 'AI describe image'],
  ['AI trích chữ', 'AI extract text'],
  ['Tên hiển thị', 'Display name'],
  ['Anonymous (dùng tên#mã để tạo tripcode)', 'Anonymous (use name#code to create a tripcode)'],
  ['Tài khoản', 'Account'],
  ['sage = không bump thread; noko = quay lại thread sau khi đăng', 'sage = do not bump the thread; noko = return to the thread after posting'],
  ['Viết bình luận...', 'Write a comment...'],
  ['Độ dài', 'Length'],
  ['Emoji và sticker cho trả lời', 'Emoji and stickers for the reply'],
  ['Ẩn ảnh', 'Hide image'],
  ['Đánh dấu ảnh là spoiler', 'Mark image as spoiler'],
  ['Âm thanh → chữ', 'Audio to text'],
  ['Vui lòng đọc', 'Please read'],
  ['trước khi đăng.', 'before posting.'],
  ['Có thể giữ định dạng code bằng thẻ [code].', 'You can preserve code formatting with [code] tags.'],
  ['Giao diện', 'Theme'],
  ['Trả lời chủ đề No.', 'Reply to thread No.'],
  ['Đóng trả lời nhanh', 'Close quick reply'],
  ['Emoji và sticker cho trả lời nhanh', 'Emoji and stickers for quick reply'],
  ['Công cụ nhanh', 'Quick tools'],
  ['Gợi ý câu trả lời từ AI', 'Get reply suggestions from AI'],
  ['Gợi ý AI', 'AI suggestions'],
  ['Chọn tông giọng rồi sửa nháp', 'Choose a tone, then rewrite the draft'],
  ['Tông giọng sửa AI', 'AI rewrite tone'],
  ['Sửa AI', 'AI rewrite'],
  ['Chọn ngôn ngữ rồi dịch nháp', 'Choose a language, then translate the draft'],
  ['Dịch', 'Translate'],
  ['Thêm công cụ · ảnh · âm thanh', 'More tools · image · audio'],
  ['Công cụ ảnh AI', 'AI image tools'],
  ['Mô tả ảnh đính kèm', 'Describe attached image'],
  ['Trích chữ từ ảnh', 'Extract text from image'],
  ['Âm thanh sang chữ', 'Audio to text'],
  ['Chọn file âm thanh để chép', 'Choose an audio file to transcribe'],
  ['Chọn tệp', 'Choose files'],
  ['Chưa chọn tệp', 'No files selected'],
  ['Đăng ký tài khoản', 'Create account'],
  ['Tài khoản là tùy chọn để đồng bộ cài đặt và tiện ích riêng. Đăng bài ẩn danh vẫn dùng được khi chưa đăng nhập.', 'An account is optional and lets you sync settings and private tools. Anonymous posting still works while logged out.'],
  ['Mật khẩu', 'Password'],
  ['Xác nhận mật khẩu','Confirm password'],
  ['Mật khẩu cần ít nhất 10 ký tự, không trùng tên tài khoản và không dùng mật khẩu quá phổ biến hoặc quá đơn giản.', 'The password must be at least 10 characters, must not match the username, and must not be overly common or simple.'],
  ['Đã có tài khoản', 'Already have an account'],
  ['Username tài khoản không tự động hiện trên bài public. Tên hiển thị khi đăng bài vẫn là trường riêng và mặc định là Anonymous.', 'Your account username is not automatically shown on public posts. The posting display name remains separate and defaults to Anonymous.'],
  ['Lưu mã khôi phục của bạn', 'Save your recovery code'],
  ['Đây là cách duy nhất để đặt lại mật khẩu nếu bạn quên. Mã chỉ hiển thị một lần — hãy lưu ở nơi an toàn.', 'This is the only way to reset your password if you forget it. The code is shown once, so store it somewhere safe.'],
  ['Bạn có thể dùng tài khoản ngay. Hãy xác nhận email trong cài đặt trong vòng 15 phút.', 'You can use the account immediately. Confirm your email in settings within 15 minutes.'],
  ['Tôi đã lưu mã, tiếp tục', 'I saved the code, continue'],
  ['Đăng nhập tài khoản', 'Account login'],
  ['Bỏ qua bước này nếu chỉ muốn đọc hoặc đăng bài ẩn danh trên các bảng public.', 'Skip this step if you only want to read or post anonymously on public boards.'],
  ['Đăng nhập Passkey', 'Log in with passkey'],
  ['Tạo tài khoản', 'Create account'],
  ['Quên mật khẩu', 'Forgot password'],
  ['Tài khoản này đã kích hoạt bảo mật 2 lớp. Vui lòng nhập mã xác thực từ ứng dụng của bạn.', 'This account has two-factor authentication enabled. Enter the code from your authenticator app.'],
  ['Mã 2FA (6 chữ số)', '2FA code (6 digits)'],
  ['Mã 6 chữ số', '6-digit code'],
  ['Xác thực', 'Verify'],
  ['Dùng mã dự phòng', 'Use backup code'],
  ['Mã dự phòng (8 ký tự)', 'Backup code (8 characters)'],
  ['Mã dự phòng', 'Backup code'],
  ['Xác thực bằng mã dự phòng', 'Verify with backup code'],
  ['Quay lại nhập mã 2FA', 'Return to 2FA code'],
  ['Dùng mã khôi phục', 'Use recovery code'],
  ['Dùng email đã xác nhận', 'Use verified email'],
  ['Dùng mã khôi phục đã lưu hoặc mã OTP gửi tới email đã xác nhận. Sau khi đặt lại, bạn sẽ nhận một mã khôi phục mới.', 'Use your saved recovery code or an OTP sent to your verified email. You will receive a new recovery code after the reset.'],
  ['Mã khôi phục', 'Recovery code'],
  ['Mật khẩu mới', 'New password'],
  ['Đặt lại mật khẩu', 'Reset password'],
  ['Quay lại đăng nhập', 'Back to login'],
  ['Tài khoản hoặc email', 'Username or email'],
  ['Gửi mã OTP', 'Send OTP'],
  ['Nhập mã OTP', 'Enter OTP'],
  ['Mã OTP', 'OTP code'],
  ['Gửi mã khác', 'Send another code'],
  ['Đã đặt lại mật khẩu', 'Password reset'],
  ['Mã cũ đã hết hiệu lực. Đây là mã khôi phục mới — lưu lại nơi an toàn:', 'The old code is no longer valid. This is your new recovery code; store it somewhere safe:'],
  ['Cài đặt tài khoản', 'Account settings'],
  ['Tài khoản tùy chọn cho dữ liệu riêng.', 'Optional account for private data.'],
  ['Chưa đăng nhập. Cài đặt bên dưới chỉ lưu trên trình duyệt này.', 'Not logged in. The settings below are stored only in this browser.'],
  ['Bạn chưa đăng nhập tài khoản. Vẫn có thể đọc và đăng bài ẩn danh bình thường.', 'You are not logged in. You can still read and post anonymously.'],
  ['Bảng nhà', 'Home board'],
  ['Đồng bộ', 'Sync'],
  ['Bản nháp riêng tư', 'Private drafts'],
  ['bản nháp riêng tư', 'private drafts'],
  ['Hiển thị', 'Display'],
  ['Chế độ gọn', 'Compact mode'],
  ['Ẩn thumbnail', 'Hide thumbnails'],
  ['Watchlist chỉ chưa đọc', 'Unread-only watchlist'],
  ['Khung bình luận', 'Comment box'],
  ['Cửa sổ nổi', 'Floating window'],
  ['Bình thường (trong trang)', 'Normal (inline)'],
  ['Áp dụng cho nút Trả lời, số bài, thanh công cụ và phím tắt R.', 'Applies to Reply buttons, post numbers, toolbars, and the R shortcut.'],
  ['Chưa đọc trước', 'Unread first'],
  ['Mới cập nhật', 'Recently updated'],
  ['Theo bảng', 'By board'],
  ['Thông báo', 'Notifications'],
  ['Thông báo email', 'Email notifications'],
  ['Thread đang theo dõi', 'Watched threads'],
  ['Trình duyệt: thread đang theo dõi', 'Browser: watched threads'],
  ['Xác nhận email để bật thông báo email.', 'Verify your email to enable email notifications.'],
  ['Thông báo email chỉ hoạt động với tài khoản đã xác nhận email.', 'Email notifications only work with verified accounts.'],
  ['Tắt thông báo trình duyệt cho thread đang theo dõi.', 'Browser notifications for watched threads are off.'],
  ['Tắt browser notifications cho thread đang theo dõi.', 'Browser notifications for watched threads are off.'],
  ['Bảng theo dõi', 'Watched boards'],
  ['Bảng:', 'Board:'],
  ['Lưu cài đặt', 'Save settings'],
  ['Cài đặt này không đổi tên hiển thị khi đăng bài và không được đưa vào post public.', 'These settings do not change your posting display name and are not included in public posts.'],
  ['Nội dung đã ẩn', 'Hidden content'],
  ['Ẩn bài/chủ đề chỉ lưu trên trình duyệt này (không cần tài khoản). Sau khi ẩn, vẫn còn dòng stub đỏ [Hiện lại] trên bảng/thread. Danh sách bên dưới cũng có nút khôi phục.', 'Hidden posts and threads are stored only in this browser (no account required). A red [Restore] stub remains on boards and threads, and the list below also provides restore controls.'],
  ['Ẩn bài/chủ đề chỉ lưu trên', 'Hidden posts and threads are stored only in'],
  ['trình duyệt này', 'this browser'],
  ['(không cần tài khoản). Sau khi ẩn, vẫn còn dòng stub đỏ', '(no account required). After hiding, a red stub remains'],
  ['trên bảng/thread. Danh sách bên dưới cũng có nút khôi phục.', 'on the board/thread. The list below also has restore controls.'],
  ['Chỉ lưu trên trình duyệt này. Đăng nhập để đồng bộ ẩn bài/chủ đề giữa các thiết bị.', 'Stored only in this browser. Log in to sync hidden posts and threads across devices.'],
  ['Chưa ẩn bài nào. Khi ẩn trong thread, bài vẫn còn dòng stub [Hiện lại].', 'No hidden posts. When you hide one in a thread, a [Restore] stub remains.'],
  ['Chưa ẩn chủ đề nào. Ẩn từ bảng bằng [Ẩn chủ đề] — dòng stub vẫn hiện trên bảng.', 'No hidden threads. Hide one from a board with [Hide thread]; its stub remains visible on the board.'],
  ['Hiện lại hết bài ẩn', 'Restore all hidden posts'],
  ['Hiện lại hết chủ đề ẩn', 'Restore all hidden threads'],
  ['Thiết bị xác thực (Passkey)', 'Authenticators (passkeys)'],
  ['Thêm Passkey mới', 'Add new passkey'],
  ['Email tài khoản', 'Account email'],
  ['Xác nhận email', 'Verify email'],
  ['Gửi lại mã', 'Resend code'],
  ['Email mới', 'New email'],
  ['Mật khẩu hiện tại', 'Current password'],
  ['Gửi mã tới email mới', 'Send code to new email'],
  ['Mã OTP email mới', 'New email OTP'],
  ['Xác nhận đổi email', 'Confirm email change'],
  ['Mã khôi phục dùng để đặt lại mật khẩu khi bạn quên. Tạo mã mới sẽ vô hiệu hóa mã cũ. Nhập mật khẩu hiện tại để tạo mã mới.', 'A recovery code resets your password if you forget it. Creating a new code invalidates the old one. Enter your current password to create a new code.'],
  ['Tạo mã khôi phục mới', 'Create new recovery code'],
  ['Mã khôi phục mới (chỉ hiển thị một lần):', 'New recovery code (shown once):'],
  ['Tạo lại bằng email đã xác nhận', 'Regenerate with verified email'],
  ['Gửi OTP qua email', 'Send OTP by email'],
  ['Dữ liệu đồng bộ', 'Synced data'],
  ['Xóa watchlist', 'Clear watchlist'],
  ['Xóa tìm kiếm', 'Clear searches'],
  ['Xóa drafts', 'Clear drafts'],
  ['Xóa bộ lọc', 'Clear filters'],
  ['Xóa mẫu', 'Clear templates'],
  ['Xóa ghi chú ID', 'Clear ID notes'],
  ['Xóa bài ẩn', 'Clear hidden posts'],
  ['Xóa chủ đề ẩn', 'Clear hidden threads'],
  ['Xóa tất cả', 'Clear all'],
  ['Bảo mật 2 lớp (TOTP 2FA)', 'Two-factor authentication (TOTP 2FA)'],
  ['2FA hiện tại đang TẮT. Bật 2FA giúp bảo vệ tài khoản của bạn khỏi truy cập trái phép.', '2FA is currently OFF. Enabling 2FA helps protect your account from unauthorized access.'],
  ['Bắt đầu thiết lập 2FA', 'Start 2FA setup'],
  ['Quét mã QR bằng ứng dụng xác thực (Google Authenticator, Microsoft Authenticator, v.v.):', 'Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, etc.):'],
  ['Hoặc nhập mã khóa thủ công:', 'Or enter the setup key manually:'],
  ['LƯU Ý: LƯU TRỮ MÃ DỰ PHÒNG', 'IMPORTANT: SAVE YOUR BACKUP CODES'],
  ['Lưu lại các mã dự phòng sau. Mỗi mã chỉ sử dụng được một lần để khôi phục tài khoản nếu bạn mất thiết bị 2FA.', 'Save the following backup codes. Each code can be used once to recover your account if you lose your 2FA device.'],
  ['Nhập mã 2FA xác nhận', 'Enter the 2FA confirmation code'],
  ['Xác nhận và kích hoạt', 'Confirm and enable'],
  ['✔ 2FA hiện tại đang BẬT trên tài khoản của bạn.', '✔ 2FA is currently ON for your account.'],
  ['Nếu muốn tắt 2FA, nhập mật khẩu xác nhận bên dưới:', 'To disable 2FA, enter your password below:'],
  ['Nhập mật khẩu', 'Enter password'],
  ['Mật khẩu tài khoản', 'Account password'],
  ['Hủy kích hoạt 2FA', 'Disable 2FA'],
  ['Tóm tắt cài đặt', 'Settings summary'],
  ['Gọn:', 'Compact:'],
  ['Trình duyệt:', 'Browser:'],
  ['Biểu mẫu bên dưới vẫn là nguồn ghi cài đặt. Tóm tắt này chỉ hiển thị trạng thái hiện tại.', 'The form below remains the source of saved settings. This summary only shows the current state.'],
  ['Nội quy, riêng tư và báo cáo', 'Rules, privacy, and reporting'],
  ['Bản ngắn cho người dùng public trước khi đăng hoặc báo cáo bài viết.', 'A short guide for public users before posting or reporting content.'],
  ['Mục chính sách', 'Policy sections'],
  ['Kháng nghị', 'Appeals'],
  ['Ẩn danh & riêng tư', 'Anonymity & privacy'],
  ['AI kiểm duyệt', 'AI moderation'],
  ['Không đăng đe dọa, quấy rối, kích động thù ghét, spam hoặc nội dung bất hợp pháp.', 'Do not post threats, harassment, hate speech, spam, or illegal content.'],
  ['Không doxxing, không tố cáo cá nhân chưa kiểm chứng, không đăng ảnh riêng tư của người khác.', 'Do not dox people, make unverified personal accusations, or post private images of others.'],
  ['Giữ bài đúng bảng; bài sai bảng, lặp lại hoặc cố tình né kiểm duyệt có thể bị xóa.', 'Keep posts on the correct board; off-topic, duplicate, or moderation-evasion posts may be deleted.'],
  ['Không cần tài khoản. Public chỉ thấy tên mặc định, số bài và mã poster ẩn danh trong ngữ cảnh thread.', 'No account is required. Public users only see the default name, post number, and anonymous poster ID within a thread.'],
  ['Trình duyệt giữ poster token cục bộ để nhận diện OP/xóa bài; server chỉ dùng hash cho chống lạm dụng.', 'The browser stores a local poster token for OP recognition and deletion; the server only uses a hash for abuse prevention.'],
  ['Raw IP, captcha token, poster token và admin token không được trả về public và không gửi lên AI.', 'Raw IPs, captcha tokens, poster tokens, and admin tokens are not exposed publicly or sent to AI.'],
  ['AI quét bài trước khi public để phát hiện độc hại, spam, thù ghét, tin giả và rủi ro PII.', 'AI scans posts before publication for toxicity, spam, hate, misinformation, and personal-information risk.'],
  ['Bài bị gắn cờ sẽ bị giữ khỏi public cho đến khi quản trị viên xem xét.', 'Flagged posts remain hidden from the public until an administrator reviews them.'],
  ['AI hỗ trợ kiểm duyệt, không phải quyết định cuối cùng; admin có quyền duyệt hoặc xóa.', 'AI assists moderation but does not make the final decision; admins can approve or delete content.'],
  ['Bấm [Báo cáo] dưới bài viết và nhập lý do ngắn, ví dụ: lộ số điện thoại, quấy rối, spam.', 'Select [Report] below a post and enter a short reason, such as an exposed phone number, harassment, or spam.'],
  ['Báo cáo đi vào hàng đợi admin; người báo cáo chỉ được lưu dưới dạng hash, không lộ poster token.', 'Reports enter the admin queue; reporters are stored only as hashes and their poster tokens are not exposed.'],
  ['Nếu có nguy cơ khẩn cấp ngoài đời thật, hãy liên hệ nhà trường hoặc cơ quan chức năng trước.', 'For an urgent real-world danger, contact the school or relevant authorities first.'],
  ['Kháng nghị bài bị xóa', 'Appeal a deleted post'],
  ['Dán mã kháng nghị đã nhận khi đăng bài và viết lý do ngắn để admin xem lại quyết định xóa.', 'Paste the appeal code received when posting and provide a short reason for an admin to review the deletion.'],
  ['Mã kháng nghị', 'Appeal code'],
  ['Lý do', 'Reason'],
  ['Vì sao bài nên được xem lại?', 'Why should this post be reviewed?'],
  ['Gửi kháng nghị', 'Submit appeal'],
  ['Dùng bảng Hỏi đáp cho góp ý public về tính năng, nội quy, lỗi hiển thị hoặc trải nghiệm sử dụng.', 'Use the Q&A board for public feedback about features, rules, display problems, or the user experience.'],
  ['Viết góp ý cụ thể: vấn đề gặp phải, nơi xảy ra, ảnh hưởng và gợi ý cải thiện nếu có.', 'Make feedback specific: describe the problem, where it occurred, its impact, and any suggested improvement.'],
  ['Không đưa thông tin riêng tư của người khác vào bài góp ý; hãy dùng báo cáo nếu nội dung cần xử lý kín.', 'Do not include another person’s private information in feedback; use a report when content needs private handling.'],
  ['Vấn đề public hoặc câu hỏi chung: đăng tại Hỏi đáp để admin và cộng đồng cùng phản hồi.', 'For public issues or general questions, post on Q&A so admins and the community can respond.'],
  ['Vấn đề liên quan bài viết cụ thể, riêng tư hoặc vi phạm: dùng nút [Báo cáo] ngay dưới bài đó.', 'For a specific post, privacy concern, or violation, use [Report] directly below that post.'],
  ['Yêu cầu khẩn cấp ngoài phạm vi diễn đàn nên gửi trực tiếp tới nhà trường, đơn vị quản lý hoặc cơ quan chức năng phù hợp.', 'Urgent requests outside the forum’s scope should go directly to the school, responsible organization, or appropriate authorities.'],
  ['PII cần tránh', 'Personal information to avoid'],
  ['PII là thông tin cá nhân có thể nhận diện. Không đăng tên thật kèm ngữ cảnh nhận diện, số điện thoại, email cá nhân, mã sinh viên, lớp học cụ thể, phòng ký túc xá, lịch trình riêng, giấy tờ hoặc ảnh có thể nhận ra người khác. Nếu thấy thông tin này, hãy báo cáo để admin xử lý.', 'PII is personally identifiable information. Do not post real names with identifying context, phone numbers, personal email addresses, student IDs, specific classes, dorm rooms, private schedules, documents, or images that identify others. Report this information so an admin can handle it.'],
  ['Điều hướng chính sách', 'Policy navigation'],
  ['Về trang chủ', 'Return home'],
  ['Vào bảng thú nhận', 'Open confessions board'],
  ['Bảng quản trị', 'Admin dashboard'],
  ['Quản lý kiểm duyệt, báo cáo và hệ thống.', 'Manage moderation, reports, and system operations.'],
  ['Tài khoản quản trị đã kích hoạt bảo mật 2 lớp. Vui lòng nhập mã xác thực từ ứng dụng của bạn.', 'This admin account has two-factor authentication enabled. Enter the code from your authenticator app.'],
  ['Thiết lập bảo mật 2 lớp (2FA)', 'Set up two-factor authentication (2FA)'],
  ['Tài khoản quản trị yêu cầu bảo mật 2 lớp để sử dụng. Vui lòng thiết lập 2FA để tiếp tục.', 'Admin accounts require two-factor authentication. Set up 2FA to continue.'],
  ['Mã QR thiết lập 2FA', '2FA setup QR code'],
  ['Chọn hàng đợi quản trị', 'Choose admin queue'],
  ['AI chờ duyệt', 'AI pending review'],
  ['Báo cáo', 'Reports'],
  ['Đã duyệt', 'Approved'],
  ['Đã xóa', 'Deleted'],
  ['Làm chậm/Tạm khóa', 'Cooldown/Bans'],
  ['Nội dung', 'Content'],
  ['Quyền', 'Permissions'],
  ['Nhật ký', 'Audit log'],
  ['Sức khỏe', 'Health'],
  ['Nhãn', 'Label'],
  ['Độc hại', 'Toxic'],
  ['Nội dung rác', 'Spam'],
  ['Thù ghét', 'Hate speech'],
  ['Tin giả', 'Misinformation'],
  ['Rủi ro thông tin cá nhân', 'Personal information risk'],
  ['Admin duyệt', 'Admin approved'],
  ['Loại báo cáo', 'Report category'],
  ['Thông tin cá nhân', 'Personal information'],
  ['Bất hợp pháp', 'Illegal'],
  ['Khác', 'Other'],
  ['Thời gian', 'Time'],
  ['24 giờ', '24 hours'],
  ['7 ngày', '7 days'],
  ['Ưu tiên', 'Priority'],
  ['Cao', 'High'],
  ['Trung bình', 'Medium'],
  ['Thấp', 'Low'],
  ['Tin cậy ≥', 'Confidence ≥'],
  ['Ưu tiên trước', 'Priority first'],
  ['Tin cậy cao trước', 'Highest confidence'],
  ['Tin cậy thấp trước', 'Lowest confidence'],
  ['Cũ nhất', 'Oldest'],
  ['Ngưỡng hàng đợi', 'Queue threshold'],
  ['Xuất CSV', 'Export CSV'],
  ['Chọn tất cả', 'Select all'],
  ['Duyệt đã chọn', 'Approve selected'],
  ['Xóa đã chọn', 'Delete selected'],
  ['Passkey · thiết bị xác thực', 'Passkeys · authenticators'],
  ['Đăng ký Passkey để đăng nhập quản trị bằng vân tay/khuôn mặt, không cần mật khẩu hay mã 2FA.', 'Register a passkey to access admin tools with a fingerprint or face, without a password or 2FA code.'],
  ['Báo cáo từ người dùng', 'User reports'],
  ['Nhật ký kiểm duyệt', 'Moderation log'],
  ['Hàng đợi kiểm duyệt', 'Moderation queue'],
  ['Thời gian chờ lâu nhất', 'Longest wait'],
  ['Tuổi của bài viết chờ duyệt lâu nhất', 'Age of the oldest pending post'],
  ['Thời gian giải quyết TB', 'Average resolution time'],
  ['Tổng lượt gọi AI', 'Total AI calls'],
  ['Tóm tắt, gợi ý bình luận và viết lại nháp', 'Summaries, comment suggestions, and draft rewrites'],
  ['Hệ thống hoạt động bình thường', 'System operating normally'],
  ['Hệ thống đang gặp sự cố', 'System issue detected'],
  ['Cơ sở dữ liệu', 'Database'],
  ['Loại', 'Type'],
  ['Trạng thái', 'Status'],
  ['Sẵn sàng', 'Ready'],
  ['Không sẵn sàng', 'Not ready'],
  ['Lệnh chế tài', 'Sanctions'],
  ['Kiểm duyệt', 'Moderation'],
  ['Số bài kế tiếp', 'Next post number'],
  ['Đã cấu hình', 'Configured'],
  ['Chưa cấu hình', 'Not configured'],
  ['Lưu trữ ảnh', 'Image storage'],
  ['Lỗi', 'Error'],
  ['Kết nối thời gian thực', 'Realtime connections'],
  ['Bảo mật', 'Security'],
  ['Cảnh báo', 'Warnings'],
  ['Không có cảnh báo', 'No warnings'],
  ['Tiến trình', 'Process'],
  ['React island: sẵn sàng', 'React island: ready'],
  ['Đang tải chủ đề...', 'Loading threads...'],
  ['Đang tải chi tiết...', 'Loading details...'],
  ['Đang tóm tắt...', 'Summarizing...'],
  ['Đang gợi ý...', 'Generating suggestions...'],
  ['Không tìm thấy bảng', 'Board not found'],
  ['Bảng này không tồn tại hoặc đã bị ẩn.', 'This board does not exist or has been hidden.'],
  ['Hãy chọn một bảng khác từ thanh điều hướng.', 'Choose another board from the navigation bar.'],
  ['Chưa có chủ đề công khai.', 'No public threads yet.'],
  ['Không có kho lưu trữ để hiển thị.', 'No archive is available.'],
  ['Kho lưu trữ không công khai.', 'This archive is not public.'],
  ['Kho lưu trữ chưa có chủ đề.', 'The archive has no threads yet.'],
  ['Không có OP khớp tìm kiếm.', 'No OP matches the search.'],
  ['Không tìm thấy bảng phù hợp.', 'No matching board found.'],
  ['Đã theo dõi bảng.', 'Board added to watchlist.'],
  ['Đã bỏ theo dõi bảng.', 'Board removed from watchlist.'],
  ['Đã theo dõi chủ đề.', 'Thread added to watchlist.'],
  ['Đã bỏ theo dõi chủ đề.', 'Thread removed from watchlist.'],
  ['Đã sao chép link bài viết.', 'Post link copied.'],
  ['Đã sao chép vào clipboard.', 'Copied to clipboard.'],
  ['Không thể sao chép tự động, vui lòng copy thủ công.', 'Could not copy automatically; copy it manually.'],
  ['Vui lòng hoàn tất hCaptcha trước khi gửi.', 'Complete hCaptcha before posting.'],
  ['Đã dừng gửi để bạn chỉnh sửa nội dung.', 'Posting stopped so you can edit the content.'],
  ['Chủ đề đã bị khóa, không thể trả lời.', 'This thread is locked and cannot receive replies.'],
  ['Chủ đề đã lưu trữ, không thể trả lời.', 'This thread is archived and cannot receive replies.'],
  ['Không xác định được chủ đề để trả lời.', 'Could not determine which thread to reply to.'],
  ['Chỉ hỗ trợ ảnh, MP4 hoặc WebM.', 'Only images, MP4, and WebM are supported.'],
  ['Chưa có nội dung để AI sửa.', 'There is no content for AI to rewrite.'],
  ['Chưa có nội dung để dịch.', 'There is no content to translate.'],
  ['Không nhận được bản dịch.', 'No translation was returned.'],
  ['Chưa có ảnh đính kèm để AI mô tả.', 'Attach an image before asking AI to describe it.'],
  ['Đã chèn mô tả ảnh vào nháp. Kiểm tra trước khi gửi.', 'The image description was inserted into the draft. Review it before posting.'],
  ['Đã điền bản viết lại vào nháp. Kiểm tra trước khi gửi.', 'The rewrite was inserted into the draft. Review it before posting.'],
  ['Đã chèn lời thoại vào nháp. Kiểm tra trước khi gửi.', 'The transcript was inserted into the draft. Review it before posting.'],
  ['Trình duyệt này chưa hỗ trợ Web Speech API (Chrome/Edge khuyến nghị).', 'This browser does not support the Web Speech API (Chrome or Edge recommended).']
];

type PatternTranslation = {
  pattern: RegExp;
  render: (match: RegExpMatchArray) => string;
};

const PATTERN_TRANSLATIONS: PatternTranslation[] = [
  {
    pattern: /^Đã chọn (\d+) sticker\.$/,
    render: (match) => `${match[1]} sticker${match[1] === '1' ? '' : 's'} selected.`
  },
  {
    pattern: /^Thăm dò ẩn danh · (\d+) vote$/,
    render: (match) => 'Anonymous poll · ' + match[1] + (match[1] === '1' ? ' vote' : ' votes')
  },
  {
    pattern: /^Đang tìm “(.+)”…$/,
    render: (match) => `Searching for “${match[1]}”...`
  },
  {
    pattern: /^Đã tải (\d[\d.,]*) GIF\.$/,
    render: (match) => `Loaded ${match[1]} GIFs.`
  },
  {
    pattern: /^Chèn GIF (.+)$/,
    render: (match) => `Insert GIF ${match[1]}`
  },
  {
    pattern: /^Chèn (.+)$/,
    render: (match) => `Insert ${match[1]}`
  },
  {
    pattern: /^\[(.+)\]$/,
    render: (match) => `[${translateNormalizedText(match[1])}]`
  },
  {
    pattern: /^- (.+)$/,
    render: (match) => `- ${englishTranslations.get(normalizeLookup(match[1])) || match[1]}`
  },
  {
    pattern: /^(\/[^/]+\/) (.+)$/,
    render: (match) => `${match[1]} ${englishTranslations.get(normalizeLookup(match[2])) || match[2]}`
  },
  {
    pattern: /^Bảng (.+) sinh viên · (.+)$/,
    render: (match) => `${translateNormalizedText(match[1])} student board · ${translateNormalizedText(match[2])}`
  },
  {
    pattern: /^Đã viết (\d+) từ · (\d+)\/(\d+) ký tự$/,
    render: (match) => `Written ${match[1]} words · ${match[2]}/${match[3]} characters`
  },
  {
    pattern: /^Trang (\d+)\/(\d+)$/,
    render: (match) => `Page ${match[1]}/${match[2]}`
  },
  {
    pattern: /^(\d[\d.,]*) mục$/,
    render: (match) => `${match[1]} items`
  },
  {
    pattern: /^(\d[\d.,]*) trả lời$/,
    render: (match) => `${match[1]} replies`
  },
  {
    pattern: /^(\d[\d.,]*) tệp$/,
    render: (match) => `${match[1]} files`
  },
  {
    pattern: /^Trả lời chủ đề No\.(.+)$/,
    render: (match) => `Reply to thread No.${match[1]}`
  },
  {
    pattern: /^Trước No\.(.+)$/,
    render: (match) => `Previous No.${match[1]}`
  },
  {
    pattern: /^Sau No\.(.+)$/,
    render: (match) => `Next No.${match[1]}`
  },
  {
    pattern: /^Bảng (.+) sinh viên$/,
    render: (match) => `${match[1]} student board`
  },
  {
    pattern: /^đẩy lúc (.+)$/,
    render: (match) => `bumped at ${match[1]}`
  },
  {
    pattern: /^Chế độ chậm (\d+)s$/,
    render: (match) => `Slow mode ${match[1]}s`
  },
  {
    pattern: /^Phóng to (ảnh|video) (.+)$/,
    render: (match) => `Expand ${match[1] === 'video' ? 'video' : 'image'} ${match[2]}`
  },
  {
    pattern: /^Chọn bài (.+)$/,
    render: (match) => `Select post ${match[1]}`
  },
  {
    pattern: /^Trả lời bài này \(No\.(.+)\)$/,
    render: (match) => `Reply to this post (No.${match[1]})`
  },
  {
    pattern: /^(.+) Danh mục$/,
    render: (match) => `${match[1]} Catalog`
  },
  {
    pattern: /^(.+) Kho lưu trữ$/,
    render: (match) => `${match[1]} Archive`
  },
  {
    pattern: /^Đang tải (.+)\.\.\.$/,
    render: (match) => `Loading ${match[1]}...`
  },
  {
    pattern: /^chưa đọc (\d+)$/,
    render: (match) => `${match[1]} unread`
  },
  {
    pattern: /^Bài đã ẩn \((\d+)\)$/,
    render: (match) => `Hidden posts (${match[1]})`
  },
  {
    pattern: /^Chủ đề đã ẩn \((\d+)\)$/,
    render: (match) => `Hidden threads (${match[1]})`
  }
];

const DAY_TRANSLATIONS = new Map([
  ['CN', 'Sun'],
  ['T2', 'Mon'],
  ['T3', 'Tue'],
  ['T4', 'Wed'],
  ['T5', 'Thu'],
  ['T6', 'Fri'],
  ['T7', 'Sat']
]);

const englishTranslations = new Map(
  TRANSLATION_PAIRS.map(([source, translated]) => [normalizeLookup(source), translated])
);
const textSources = new WeakMap<Text, string>();
const attributeSources = new WeakMap<Element, Map<string, string>>();
let activeLocale: UiLocale = 'vi';
let observer: MutationObserver | null = null;
let initialized = false;

function normalizeLookup(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeLocale(value: string | null | undefined): UiLocale {
  return value === 'en' ? 'en' : 'vi';
}

function translateNormalizedText(value: string): string {
  const exact = englishTranslations.get(value);
  if (exact) {
    return exact;
  }
  const translatedDays = value.replace(/\((CN|T2|T3|T4|T5|T6|T7)\)/g, (_full, day) => `(${DAY_TRANSLATIONS.get(day) || day})`);
  if (translatedDays !== value) {
    return translatedDays;
  }
  for (const translation of PATTERN_TRANSLATIONS) {
    const match = value.match(translation.pattern);
    if (match) {
      return translation.render(match);
    }
  }
  return value;
}

export function translateUiText(value: string, locale: UiLocale = activeLocale): string {
  const source = String(value ?? '');
  if (locale === 'vi' || !source.trim()) {
    return source;
  }
  const leading = source.match(/^\s*/)?.[0] || '';
  const trailing = source.match(/\s*$/)?.[0] || '';
  const core = source.slice(leading.length, source.length - trailing.length);
  return `${leading}${translateNormalizedText(normalizeLookup(core))}${trailing}`;
}

export function getUiLocale(): UiLocale {
  return activeLocale;
}

function shouldSkip(element: Element | null): boolean {
  return !element || Boolean(element.closest(SKIP_SELECTOR));
}

function shouldSkipAttribute(element: Element | null): boolean {
  return !element || Boolean(element.closest(ATTRIBUTE_SKIP_SELECTOR));
}

function applyTextNode(node: Text): void {
  if (shouldSkip(node.parentElement)) {
    return;
  }
  const source = textSources.get(node) ?? node.data;
  textSources.set(node, source);
  const next = translateUiText(source);
  if (node.data !== next) {
    node.data = next;
  }
}

function attributeSourceMap(element: Element): Map<string, string> {
  const current = attributeSources.get(element);
  if (current) {
    return current;
  }
  const next = new Map<string, string>();
  attributeSources.set(element, next);
  return next;
}

function applyAttribute(element: Element, attribute: string): void {
  if (shouldSkipAttribute(element) || !element.hasAttribute(attribute)) {
    return;
  }
  const sources = attributeSourceMap(element);
  const source = sources.get(attribute) ?? element.getAttribute(attribute) ?? '';
  sources.set(attribute, source);
  const next = translateUiText(source);
  if (element.getAttribute(attribute) !== next) {
    element.setAttribute(attribute, next);
  }
}

function applySubtree(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    applyTextNode(node as Text);
    return;
  }
  if (!(node instanceof Element)) {
    return;
  }
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    applyAttribute(node, attribute);
  }
  node.querySelectorAll('*').forEach((element) => {
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      applyAttribute(element, attribute);
    }
  });
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    applyTextNode(current as Text);
    current = walker.nextNode();
  }
}

function observeBody(): void {
  if (!observer || !document.body) {
    return;
  }
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES]
  });
}

function withObserverPaused(work: () => void): void {
  observer?.disconnect();
  work();
  observeBody();
}

function syncLocaleControls(): void {
  document.querySelectorAll<HTMLButtonElement>('button[data-locale]').forEach((button) => {
    const selected = button.dataset.locale === activeLocale;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function persistLocale(locale: UiLocale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable in private browsing; the active page still updates.
  }
}

function readSavedLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setUiLocale(locale: UiLocale, { persist = true } = {}): void {
  activeLocale = normalizeLocale(locale);
  if (persist) {
    persistLocale(activeLocale);
  }
  withObserverPaused(() => {
    document.documentElement.lang = activeLocale;
    document.documentElement.dataset.locale = activeLocale;
    syncLocaleControls();
    if (document.body) {
      applySubtree(document.body);
    }
  });
  window.dispatchEvent(new CustomEvent('36chan:localechange', { detail: { locale: activeLocale } }));
}

function handleMutations(mutations: MutationRecord[]): void {
  withObserverPaused(() => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const node = mutation.target as Text;
        textSources.set(node, node.data);
        applyTextNode(node);
        continue;
      }
      if (mutation.type === 'attributes' && mutation.target instanceof Element && mutation.attributeName) {
        const value = mutation.target.getAttribute(mutation.attributeName);
        if (value !== null) {
          attributeSourceMap(mutation.target).set(mutation.attributeName, value);
          applyAttribute(mutation.target, mutation.attributeName);
        }
        continue;
      }
      mutation.addedNodes.forEach(applySubtree);
    }
  });
}

export function setupI18n(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  observer = new MutationObserver(handleMutations);
  document.querySelectorAll<HTMLButtonElement>('button[data-locale]').forEach((button) => {
    button.addEventListener('click', () => setUiLocale(normalizeLocale(button.dataset.locale)));
  });
  setUiLocale(normalizeLocale(readSavedLocale()), { persist: false });
}
