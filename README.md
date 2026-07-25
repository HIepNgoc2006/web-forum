# 🍀 36chan (36chan-web)

> **Hệ thống Bảng tin Sinh viên Ẩn danh Realtime, AI Moderation & Multi-Cloud Architecture**

[![CI Status](https://github.com/HIepNgoc2006/web-forum/actions/workflows/ci.yml/badge.svg)](https://github.com/HIepNgoc2006/web-forum/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16.2.11-black)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.2.6-blue)](https://react.dev/)
[![Express 5](https://img.shields.io/badge/Express-5.0.0-green)](https://expressjs.com/)
[![Google Gemini AI](https://img.shields.io/badge/AI-Gemini%203.1%20Flash-orange)](https://ai.google.dev/)

**36chan-web** là một diễn đàn thảo luận và bảng tin ảnh (Imageboard) ẩn danh hiện đại dành cho sinh viên đại học. Ứng dụng kết hợp giữa trải nghiệm di động **Progressive Web App (PWA)**, **Socket.IO Realtime Engine**, trí tuệ nhân tạo **Google Gemini 3.1 Flash AI Moderation** và hạ tầng triển khai **Multi-Cloud (Vercel Frontend + Render Backend)**.

---

## 🚀 Môi trường Sản xuất (Production Live URLs)

- **Frontend App (Vercel Edge Network)**: [https://frontend-one-livid-12.vercel.app](https://frontend-one-livid-12.vercel.app)
- **Backend API (Render Container Service)**: [https://three6chan.onrender.com/api/config](https://three6chan.onrender.com/api/config)
- **GitHub Repository**: [https://github.com/HIepNgoc2006/web-forum](https://github.com/HIepNgoc2006/web-forum)

---

## ✨ Tính Năng Nổi Bật

### 🌐 1. Trải nghiệm Di động PWA & Realtime WebSockets
- **Standalone PWA**: Cài đặt trực tiếp trên iOS, Android và Desktop; giao diện responsive 100%.
- **Realtime Updates**: Socket.IO v4 cập nhật bài viết, bình luận, thông báo theo từng room (`board:slug`, `thread:id`) với độ trễ `<10ms`.
- **Direct Messaging (DMs)**: Truyền tin nhắn riêng tư thời gian thực giữa các tài khoản, hỗ trợ báo đã đọc và trạng thái đang gõ.

### 🛡️ 2. Bảo mật Ẩn danh & AI Moderation
- **Guest Poster Security**: Khách không cần đăng ký tài khoản. Token ẩn danh (`posterToken`) lưu cục bộ tại trình duyệt, máy chủ chỉ lưu bản băm SHA-256 (`hashedPosterId`) để kiểm soát quyền xóa bài và chống lạm dụng.
- **Google Gemini 3.1 Flash AI**: Tự động phân tích an toàn nội dung, phát hiện ngôn từ thù ghét (Toxicity), rác mạng (Spam) và lộ thông tin cá nhân (PII Doxxing) trước khi xuất bản.
- **WebAuthn Passkeys 2FA**: Xác thực sinh trắc học (Fingerprint / FaceID / YubiKey) không cần mật khẩu cho tài khoản Admin.
- **Content Security Policy (CSP)**: Gán mã `nonce` ngẫu nhiên cho từng HTTP request, ngăn chặn triệt để tấn công XSS và Clickjacking.

### 📊 3. Tính Năng Bảng tin & Đa phương tiện
- **15 Bảng tin Chuyên mục**: Confession, Học tập, Tâm sự, Việc làm, Ký túc xá, Tuần deadline, Thi cuối kỳ...
- **Auto Pruning & Retention**: Giới hạn tối đa 150 active threads mỗi bảng; tự động lưu trữ (Archive) thread cũ khi hết lượt thảo luận.
- **Tích hợp Đa phương tiện**: Upload Ảnh/Video (Local/S3 Storage), đính kèm Sticker, GIF (KLIPY API Integration), nhúng xem trước liên kết (Link Preview).

---

## 🏗️ Kiến Trúc Hệ Thống (System Architecture)

```
36chan-web/
├── backend/                  # Máy chủ Node.js Express 5 API & Socket.IO
│   ├── src/
│   │   ├── core/             # ForumService, AI Moderation, MongoStore, Security, DMs
│   │   ├── server/           # HTTP App, Socket Router, Front-Proxy Gateway
│   │   └── types/            # DTOs, Mongo Interfaces & Event Contracts
│   ├── test/                 # 419 Automated Integration & Unit Tests
│   └── package.json
├── frontend/                 # Ứng dụng Next.js 16 App Router (React 19 PWA)
│   ├── app/                  # Next.js App Router Shell (/legacy dynamic route)
│   ├── legacy/               # SPA Engine Modules, Controllers, DOM Binding
│   ├── public/               # PWA Icons, Service Worker (sw.js), Manifest
│   ├── test/                 # 52 Frontend & Browser Smoke Tests
│   └── next.config.mjs       # Build configuration & Vercel Rewrites
├── docker-compose.yml        # Orchestration cho MongoDB, Redis & Backend
└── vercel.json               # Cấu hình Deploy Serverless Edge cho Frontend
```

---

## 💻 Hướng Dẫn Khởi Chạy Local (Local Development)

### 1. Cài đặt Phụ thuộc (Dependencies)
```bash
# Cài đặt root dependencies
npm install

# Cài đặt frontend dependencies
npm --prefix frontend install
```

### 2. Khởi chạy Môi trường Phát triển (Dev Mode)
Chạy song song cả Backend (cổng `3000`) và Frontend Next.js (cổng `3001`):
```bash
npm run dev
```

Hoặc khởi chạy từng thành phần riêng biệt:
```bash
# Chạy Backend API (cổng 3000)
npm run dev:backend

# Chạy Frontend Next.js (cổng 3001)
npm run dev:frontend
```

---

## 🧪 Quy Trình Kiểm Thử Tự Động (Automated Testing)

Dự án duy trì bộ kiểm thử tự động với tỉ lệ vượt qua **100% (471/471 Tests Pass)**:

```bash
# Chạy toàn bộ Unit & Integration Tests (Backend + Frontend)
npm test

# Chạy E2E Browser Smoke Tests
npm run test:e2e

# Chạy kiểm tra quy trình Release hoàn chỉnh
npm run release:verify
```

---

## ⚙️ Biến Môi Trường (Environment Variables)

Sao chép file `.env.example` thành `.env` tại thư mục `backend/` và `frontend/`:

### Backend Environment Variables (`backend/.env`)
| Tên Biến | Mô tả | Giá trị Mặc định |
| :--- | :--- | :--- |
| `STORE_DRIVER` | Driver lưu trữ cơ sở dữ liệu (`mongo` cho Production) | `mongo` |
| `MONGODB_URI` | Chuỗi kết nối MongoDB Cloud Atlas | `mongodb+srv://...` |
| `GOOGLE_AI_API_KEY` | API Key kết nối Google Gemini 3.1 Flash AI | `<your-gemini-key>` |
| `ADMIN_USERNAME` | Tên đăng nhập Admin | `admin` |
| `ADMIN_PASSWORD` | Mật khẩu Admin | `<secure-password>` |
| `JWT_SECRET` | Secret mã hóa Token Admin JWT | `<random-secret>` |
| `APP_BASE_URL` | Domain chính thức của ứng dụng (dùng cho WebAuthn & Links) | `https://frontend-one-livid-12.vercel.app` |
| `IMAGE_STORAGE_DRIVER` | Driver lưu trữ ảnh (`local` hoặc `s3`) | `local` |

### Frontend Environment Variables (`frontend/.env.local`)
| Tên Biến | Mô tả | Giá trị Mặc định |
| :--- | :--- | :--- |
| `BACKEND_ORIGIN` | URL gốc của Backend Server (để Next.js Proxy rewrite `/api/*`) | `https://three6chan.onrender.com` |

---

## 🚢 Quy Trình Triển Khai (Multi-Cloud Deployment Guide)

### 1. Triển khai Frontend lên Vercel Edge Serverless
1. Thêm `VERCEL_TOKEN` vào môi trường CI hoặc CLI.
2. Chạy lệnh deploy tự động:
   ```bash
   npx vercel --cwd frontend --token $VERCEL_TOKEN --yes --prod
   ```
3. Cấu hình biến môi trường trên Vercel Dashboard:
   - `BACKEND_ORIGIN` = `https://three6chan.onrender.com`

### 2. Triển khai Backend lên Render Container Service
1. Tạo Web Service mới chọn **Docker Runtime**.
2. Trỏ Repository tới `https://github.com/HIepNgoc2006/web-forum`.
3. Đặt `Dockerfile` path = `./Dockerfile`.
4. Điền các biến môi trường: `MONGO_URI`, `GOOGLE_AI_API_KEY`, `APP_BASE_URL`.

---

## 📄 Giấy Phép (License)

Được phát hành dưới giấy phép **[MIT License](LICENSE)**. Bản quyền © 2026 Dự án Sinh viên 36chan.
