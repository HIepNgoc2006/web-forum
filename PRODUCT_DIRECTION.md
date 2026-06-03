# Định Hướng Sản Phẩm: 36chan

## 1. Tóm tắt

36chan là imageboard/confession ẩn danh cho sinh viên Việt Nam. Sản phẩm lấy cảm hứng từ mô hình board/thread/reply của 4chan, nhưng định hướng hiện tại là một MVP tập trung vào cộng đồng học đường, kiểm duyệt có người kiểm soát và quyền riêng tư ngay từ thiết kế.

36chan không phải bản P2P/decentralized như 5chan. MVP hiện tại là hệ thống centralized để dễ triển khai, kiểm duyệt, đo lường và phát triển tính năng AI trước khi mở rộng kiến trúc.

## 2. Đối tượng người dùng

- Sinh viên muốn đăng confession, hỏi đáp, chia sẻ meme, tài liệu, chuyện ký túc xá, ăn uống, câu lạc bộ, việc làm và các chủ đề trong trường.
- Người đọc chỉ muốn vào xem board/thread mà không cần tạo tài khoản.
- Admin cần kiểm duyệt nội dung nhanh, có AI hỗ trợ nhưng vẫn giữ quyền quyết định cuối cùng.

## 3. Nguyên tắc sản phẩm

- Không yêu cầu đăng ký hoặc đăng nhập với người dùng public.
- Giao diện public giữ phong cách imageboard cổ điển: board table, thread list, catalog, greentext, `>>ID`, reply popup, post permalink.
- Mặc định ẩn danh, nhưng trong mỗi thread vẫn có `Poster Hash ID` để người đọc nhận biết người viết lặp lại mà không biết danh tính thật.
- AI chỉ hỗ trợ kiểm duyệt, tóm tắt và gợi ý; AI không tự đăng bài và không thay admin quyết định nội dung bị flag.
- Không gửi IP thật, admin token, captcha token hoặc poster token lên AI provider.
- Dữ liệu pending/deleted không được xuất hiện ở public API, public UI hoặc realtime public events.

## 4. Phạm vi MVP hiện tại

- Homepage kiểu portal: danh sách board, thống kê server, bài mới nhất, thread nổi bật.
- Board cố định cho nhu cầu sinh viên: thú nhận, học tập, tâm sự, hỏi đáp, meme, sự kiện, câu lạc bộ, việc làm, mua bán, ăn uống, ký túc xá, ngẫu nhiên.
- Thread/comment ẩn danh kèm ảnh tùy chọn, chỉ hỗ trợ image upload.
- Global post number, poster hash theo thread/ngày/poster token, OP badge.
- Realtime update qua Server-Sent Events.
- Catalog, archive, update/top controls, permalink tới post.
- Admin dashboard với JWT, pending queue, approve/delete.
- AI moderation trước khi public, AI summary và AI reply suggestion theo yêu cầu.

## 5. Ngoài phạm vi MVP

- Tài khoản public, profile, follow, direct message.
- Board động do người dùng tạo.
- Video/audio upload.
- P2P/decentralized board ownership.
- GraphQL hoặc Socket.io nếu REST + SSE vẫn đáp ứng đủ.
- Copy thương hiệu, logo, asset hoặc wording độc quyền của 4chan.

## 6. Hướng khác biệt dài hạn

- Privacy Scanner cảnh báo thông tin cá nhân trước khi đăng.
- Tóm tắt từ lần đọc trước, chỉ dựa trên comment public mới.
- Safe Rewrite Draft để AI giúp viết lại nội dung giảm PII/harassment nhưng user vẫn tự quyết định submit.
- Slow Mode theo thread khi có dấu hiệu spam/toxic.
- Board sự kiện theo mùa thi, tuyển câu lạc bộ, deadline week và tự archive.
