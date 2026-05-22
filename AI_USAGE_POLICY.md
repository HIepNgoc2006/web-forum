# Chính Sách Sử Dụng Trí Tuệ Nhân Tạo (AI Usage Policy)

[cite_start]Nhóm cam kết tuân thủ nghiêm ngặt các quy định an toàn và đạo đức sử dụng AI trong suốt vòng đời phát triển dự án 36chan[cite: 425, 426]:

1. **Trách nhiệm tối cao:** Toàn bộ mã nguồn và tài liệu nộp lên đều là trách nhiệm cuối cùng của các thành viên trong nhóm. [cite_start]Sinh viên phải hiểu rõ và giải thích được mọi đoạn code do AI tạo ra khi bảo vệ dự án[cite: 426, 430].
2. **An toàn bảo mật thông tin:** Tuyệt đối không commit các khóa bảo mật, Paid API Keys, hay mật khẩu kết nối cơ sở dữ liệu MongoDB lên repository. [cite_start]Sử dụng file `.env.example` để làm mẫu cấu hình môi trường[cite: 177, 178].
3. [cite_start]**Minh chứng minh bạch:** Ghi lại nhật ký sử dụng công cụ AI theo từng tuần, lưu trữ các prompt quan trọng và ảnh chụp màn hình kiểm chứng vào thư mục `ai-logs/`.
4. [cite_start]**Kiểm soát mã nguồn:** Đọc kỹ sự thay đổi (diff) của mã nguồn do AI chỉnh sửa trước khi tiến hành tạo Pull Request hoặc gộp (merge) mã nguồn[cite: 412, 427].
5. [cite_start]**Nguyên tắc đối với tính năng AI của sản phẩm:** Tính năng AI tích hợp trên web 36chan không tự động thu thập thông tin cá nhân nhạy cảm, thông báo hiển thị rõ ràng nội dung do AI tạo ra cho người dùng, và luôn cung cấp tùy chọn cho con người chỉnh sửa hoặc từ bỏ kết quả của AI[cite: 203, 204, 205].