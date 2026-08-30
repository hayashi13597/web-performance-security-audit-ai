[English](README.md) | **Tiếng Việt**

<div align="center">

# WPSA — Web Performance & Security Audit AI

**Quét URL / repo GitHub / thư mục local → phát hiện lãng phí re-render, bundle quá lớn, memory leak, vi phạm bảo mật & SEO → AI sinh bản fix → tạo Pull Request chỉ với 1 click.**

[![Node](https://img.shields.io/badge/node-%E2%89%A522.13-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A59-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Lighthouse](https://img.shields.io/badge/Lighthouse-12-F44B21?logo=lighthouse&logoColor=white)](https://developer.chrome.com/docs/lighthouse)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![Báo cáo scan WPSA: điểm Lighthouse, Core Web Vitals và biểu đồ render theo component](docs/screenshots/scan-report.png)

</div>

---

## Mục lục

- [Tại sao có dự án này](#tại-sao-có-dự-án-này)
- [Tính năng](#tính-năng)
- [Các nhóm phát hiện](#các-nhóm-phát-hiện)
- [Kiến trúc](#kiến-trúc)
- [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
- [Cài đặt và chạy nhanh](#cài-đặt-và-chạy-nhanh)
- [Demo với fixture cố tình mắc lỗi](#demo-với-fixture-cố-tình-mắc-lỗi)
- [Ba chế độ quét](#ba-chế-độ-quét)
- [Cấu hình AI](#cấu-hình-ai)
- [Luồng fix 1-click (tạo Pull Request)](#luồng-fix-1-click-tạo-pull-request)
- [API](#api)
- [Kiểm thử](#kiểm-thử)
- [Khắc phục sự cố](#khắc-phục-sự-cố)
- [Lộ trình](#lộ-trình)
- [Đóng góp](#đóng-góp)
- [Giấy phép](#giấy-phép)

## Tại sao có dự án này

Công cụ audit frontend hiện tại (Lighthouse, bundle analyzer…) chỉ *chỉ ra* vấn đề — việc sửa vẫn nằm hoàn toàn với bạn. WPSA đi thêm một bước: **tự sinh code fix cho từng vấn đề và mở Pull Request sẵn sàng merge**.

Paste một URL, một repo GitHub hoặc trỏ tới thư mục source trên máy — WPSA chạy Lighthouse đo Core Web Vitals, dùng Playwright probe re-render và memory leak, phân tích tĩnh bundle, kiểm tra security headers và SEO, rồi dashboard hiển thị tất cả findings kèm bản fix do AI sinh ra (chọn từng finding, xem diff, bấm tạo PR).

## Tính năng

- 🔍 **3 chế độ quét** — URL trực tiếp, repo GitHub (tải tarball, hỗ trợ repo private), hoặc thư mục source local (có trình duyệt thư mục tích hợp, không cần gõ tay đường dẫn).
- ⚡ **Runtime audit thật** — Lighthouse 13 chạy trên Chrome hệ thống (mobile throttling 4G / desktop), đo đủ Core Web Vitals: LCP, CLS, TBT, FCP, TTFB, Speed Index.
- 🔁 **Phát hiện lãng phí re-render** — shim React DevTools hook qua Playwright, đếm render theo từng component, bắt cả **render loop xảy ra khi trang idle**.
- 🧠 **Phát hiện memory leak** — đo DOM Nodes / JSEventListeners / Heap qua CDP, nhiều vòng tương tác có force GC giữa các vòng; tăng đơn điệu = leak.
- 📦 **Phân tích tĩnh bundle** — parse config Vite/Webpack/Next, phát hiện import nặng nguyên khối (lodash, moment…), thư viện nặng chưa lazy-load, barrel file, đo kích thước gzip của `dist/`.
- 🔐 **Security headers + SEO** — CSP, HSTS, X-Frame-Options, nosniff, Referrer/Permissions-Policy, COOP; title/description/viewport/canonical/OG/lang/h1/img-alt + robots.txt.
- 🤖 **AI sinh fix** — endpoint nào **OpenAI-compatible** cũng chạy được: GLM, OpenAI, DeepSeek, Ollama local… Sinh fix plan dạng full-file + diff xem trước.
- 🚀 **1-click Pull Request** — tạo branch, commit mọi fix đã chọn, mở PR có tóm tắt qua GitHub REST. Đăng nhập bằng GitHub (OAuth) thay vì dán PAT — access token chỉ nằm trong RAM của server, không lưu xuống đĩa.
- 🇻🇳 **Dashboard tiếng Việt** — dark theme, theo dõi tiến độ scan theo stage, báo cáo với gauge điểm, thẻ CWV theo ngưỡng màu, biểu đồ render/component.

<details>
<summary><b>Ảnh dashboard</b></summary>

| Trang chủ | Findings kèm badge độ nghiêm trọng |
|---|---|
| ![Trang chủ WPSA](docs/screenshots/dashboard-landing.png) | ![Danh sách findings](docs/screenshots/scan-findings.png) |

</details>

## Các nhóm phát hiện

| Nhóm | Cách đo | Fix mẫu |
|------|---------|---------|
| **Bundle size** | Parse vite/webpack/next config, quét import (lodash/moment nguyên khối, thư viện nặng chưa lazy-load), barrel file, `sideEffects`, đo file trong `dist/` (gzip) | manualChunks, dynamic import, subpath import |
| **Re-render lãng phí** | Shim `__REACT_DEVTOOLS_GLOBAL_HOOK__` trước app code, đếm fiber `PerformedWork` qua các phiên tương tác giả lập + pha idle (bắt render loop) | `React.memo`, `useMemo`/`useCallback`, sửa `useEffect` deps |
| **Memory leak** | CDP `Performance.getMetrics` (Nodes, JSEventListeners, Documents, Heap) qua 3–6 vòng tương tác, force GC giữa các vòng — tăng đơn điệu = leak | `removeEventListener` trong cleanup, huỷ timer/subscription |
| **Security/SEO** | Headers: CSP, HSTS, X-Frame-Options, nosniff, Referrer/Permissions-Policy, COOP. HTML: title/description/viewport/canonical/OG/lang/h1/img-alt + robots.txt | Thêm header, bổ sung meta tags |

> ℹ️ Lighthouse đo **TBT** làm proxy lab cho FID/INP (FID là field metric, không đo được trong headless).

## Kiến trúc

pnpm monorepo, TypeScript toàn bộ.

```
├── packages/engine/        @wpsa/engine — scanner engine độc lập
│   ├── detectors/
│   │   ├── lighthouse-detector.ts   Lighthouse 13 (Chrome hệ thống): CWV, perf/SEO/best-practices
│   │   ├── rerender-detector.ts     React DevTools hook qua Playwright: đếm render/component
│   │   ├── memory-detector.ts       CDP metrics + force GC nhiều vòng: phát hiện leak
│   │   ├── security-detector.ts     Security headers (CSP/HSTS/...) + SEO meta từ HTML
│   │   └── bundle-detector.ts       Phân tích tĩnh: build config, import nặng, barrel, dist/
│   ├── ai/                  Client OpenAI-compatible + sinh fix plan (full file + diff)
│   ├── github/              Tạo branch → commit → PR qua GitHub REST (octokit)
│   └── scanners/            Orchestrator runScan + tải repo (tarball API ≤ 200MB / local path)
├── apps/web/               Next.js 15 dashboard (App Router, React 19, Tailwind 4)
│   ├── app/page.tsx                 Form quét 3 tab: URL | repo GitHub | thư mục local
│   ├── app/scan/[id]/page.tsx       Báo cáo: gauge, CWV, biểu đồ, findings, diff view
│   ├── components/FolderPickerDialog.tsx  Dialog duyệt thư mục cho chế độ local
│   ├── lib/job-store.ts             Job store lưu SQLite (lịch sử sống qua restart)
│   ├── lib/github-session.ts        Phiên GitHub OAuth (access token chỉ trong RAM)
│   └── API routes:
│       ├── POST /api/scans                    Tạo job scan (chạy background)
│       ├── GET  /api/scans                    Lịch sử các lần scan gần đây
│       ├── GET  /api/scans/[id]               Trạng thái + báo cáo (poll ~1.5s)
│       ├── POST /api/scans/[id]/fix-preview   AI sinh preview fix (có diff)
│       ├── POST /api/scans/[id]/fix-prompt    Tạo prompt copy cho AI của bạn (mọi chế độ quét)
│       ├── POST /api/scans/[id]/pull-request  Tạo PR với các fix đã chọn (phiên OAuth hoặc PAT)
│       ├── GET  /api/auth/github/start        OAuth: redirect sang GitHub uỷ quyền
│       ├── GET  /api/auth/github/callback     OAuth callback: code → token (session RAM)
│       ├── POST /api/auth/github/logout       Đăng xuất GitHub
│       ├── GET  /api/auth/session             Trạng thái đăng nhập cho UI (không trả token)
│       └── GET  /api/fs                       Liệt kê ổ đĩa/thư mục cho FolderPicker
└── examples/leaky-app/     App Vite+React cố tình mắc lỗi (demo + test E2E)
```

## Yêu cầu hệ thống

| Thành phần | Yêu cầu |
|---|---|
| Node.js | ≥ 22.13 (`node:sqlite` built-in dùng để lưu lịch sử scan) |
| pnpm | ≥ 9 |
| Trình duyệt | Chrome hoặc Edge đã cài (Lighthouse dùng Chrome hệ thống, không tải Chrome riêng) |
| Hệ điều hành | Đã phát triển và kiểm thử trên Windows 10; engine thuần Node nên chạy được trên macOS/Linux |

Lần chạy đầu, Playwright cần browser cache — nếu bị thiếu:

```bash
pnpm --filter @wpsa/engine exec playwright install chromium
```

## Cài đặt và chạy nhanh

```bash
git clone https://github.com/<your-username>/WebPerformance_SecurityAuditAI.git
cd WebPerformance_SecurityAuditAI

pnpm install
pnpm build          # build @wpsa/engine + apps/web
pnpm dev            # web app ở http://localhost:3000
```

Mở [http://localhost:3000](http://localhost:3000), chọn một trong 3 tab quét và bấm **Bắt đầu quét**. Scan runtime mất khoảng 1–3 phút tuỳ target; tiến độ hiển thị theo từng stage.

### Tuỳ chọn: đăng nhập bằng GitHub (OAuth)

Quét repo private và tạo PR không cần dán PAT. Cấu hình một lần:

1. Vào [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**
2. Homepage URL: `http://localhost:3000` — Authorization callback URL: `http://localhost:3000/api/auth/github/callback`
3. Copy Client ID / Client Secret vào `.env` ở thư mục gốc:
   ```env
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```
4. Restart app, rồi bấm **Đăng nhập với GitHub** ở đầu dashboard.

Access token chỉ nằm trong RAM của server trong 8 tiếng (hoặc tới khi restart) và không bao giờ ghi xuống đĩa hay database. Không cấu hình thì ô dán PAT tay vẫn hoạt động như cũ.

## Demo với fixture cố tình mắc lỗi

Repo kèm sẵn `examples/leaky-app` — một app Vite + React **cố tình mắc đủ loại lỗi** (lodash/moment nguyên khối, barrel file, listener không gỡ, state update loop…) để bạn thấy WPSA hoạt động mà không cần target ngoài:

```bash
pnpm fixture:build && pnpm fixture:preview   # chạy ở http://localhost:4173
```

Trên dashboard, chọn tab **Thư mục local** (hoặc bấm **Chọn thư mục…** để duyệt tới):

- Đường dẫn: `<thư-mục-repo>/examples/leaky-app`
- URL live: `http://localhost:4173` — có URL live thì chạy thêm runtime audit (Lighthouse + re-render + memory)

Kết quả tham chiếu (đã verify E2E, ~25 giây): điểm Lighthouse + CWV, render loop **critical (+22 render khi trang idle)**, memory leak critical, ~7 bundle findings và ~14 security/SEO findings.

## Ba chế độ quét

| Chế độ | Input | Phân tích tĩnh | Runtime (Lighthouse + re-render + memory) |
|---|---|---|---|
| **URL** | URL bất kỳ | Security headers + SEO | ✅ |
| **GitHub repo** | `https://github.com/owner/repo[/tree/branch]` (tải tarball ≤ 200MB; repo private cần phiên GitHub đã đăng nhập hoặc token) | ✅ | Chỉ khi có thêm `liveUrl` |
| **Thư mục local** | Đường dẫn tuyệt đối (hoặc chọn qua dialog) | ✅ | Chỉ khi có thêm `liveUrl` |

Tham số chung: `formFactor` (`mobile` mặc định / `desktop`), `memoryRounds` (3–6, mặc định 3).

## Cấu hình AI

Copy `.env.example` → `.env` ở thư mục gốc rồi điền key:

```env
AI_BASE_URL=https://open.bigmodel.cn/api/paas/v4   # GLM; đổi thành api.openai.com/v1, DeepSeek, Ollama...
AI_API_KEY=...
AI_MODEL=glm-4.6
PORT=3000

# Tuỳ chọn — job store:
#WPSA_DB_PATH=D:\duong\dan\wpsa-jobs.db   # mặc định: apps/web/.data/wpsa-jobs.db
#WPSA_JOB_TTL_HOURS=6                     # số giờ giữ job (mặc định 6)
```

Bất kỳ endpoint **OpenAI-compatible** nào (`/chat/completions` + Bearer key) đều chạy được.

> **Không có AI key thì sao?** Scan vẫn hoạt động đầy đủ 100% — chỉ tắt phần "sinh fix bằng AI" và "tạo PR".

## Luồng fix 1-click (tạo Pull Request)

1. Scan xong → report hiển thị CWV, điểm Lighthouse, bảng render/component, findings theo nhóm.
2. Tick chọn findings muốn fix (mặc định chọn sẵn critical + warning) → **🤖 Sinh preview fix bằng AI**.
3. Xem diff từng file, bỏ chọn phần không muốn.
4. **Tạo Pull Request** → nhập repo (`owner/name`) → tool dùng phiên GitHub đã đăng nhập (OAuth) hoặc **GitHub PAT** dán tay → tạo branch `wpsa/audit-fix-YYYYMMDD`, 1 commit chứa mọi fix, mở PR có tóm tắt.
5. Review diff trên GitHub → merge.

Quyền PAT cần thiết:

| Loại token | Quyền |
|---|---|
| **Fine-grained** (khuyến nghị) | *Contents: Read and write* + *Pull requests: Read and write*; repo phải nằm trong *Repository access* |
| Classic | scope `repo` |

🔒 Access token OAuth chỉ nằm trong RAM của server (8 tiếng, mất khi restart); PAT dán tay chỉ sống trong đúng 1 request. Cả hai đều không bao giờ được ghi vào file, log hay database nào.

## API

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/api/scans` | Tạo job scan (chạy background) |
| `GET` | `/api/scans` | Lịch sử các lần scan gần đây (20 job mới nhất) |
| `GET` | `/api/scans/[id]` | Trạng thái + báo cáo (poll ~1.5s) |
| `POST` | `/api/scans/[id]/fix-preview` | AI sinh preview fix kèm diff (cần AI key) |
| `POST` | `/api/scans/[id]/fix-prompt` | Tạo prompt copy cho AI của bạn — mọi chế độ quét (quét repo/thư mục có thể kèm file nguồn) |
| `POST` | `/api/scans/[id]/pull-request` | Tạo PR từ các fix đã chọn (phiên OAuth hoặc PAT trong body) |
| `GET` | `/api/auth/github/start` | OAuth: redirect sang trang uỷ quyền GitHub |
| `GET` | `/api/auth/github/callback` | OAuth callback: đổi `code` → token, tạo session RAM |
| `POST` | `/api/auth/github/logout` | Đăng xuất GitHub |
| `GET` | `/api/auth/session` | Trạng thái đăng nhập cho UI (`{ configured, authenticated, login, avatarUrl }` — không trả token) |
| `GET` | `/api/fs?path=` | Liệt kê ổ đĩa / thư mục (dùng cho FolderPicker) |

```bash
# Quét URL
curl -X POST localhost:3000/api/scans -H 'content-type: application/json' \
  -d '{"mode":"url","url":"https://example.com","formFactor":"mobile","memoryRounds":3}'

# Quét repo GitHub (+ URL live tuỳ chọn)
curl -X POST localhost:3000/api/scans -H 'content-type: application/json' \
  -d '{"mode":"repo","repoUrl":"https://github.com/owner/repo","liveUrl":"https://deploy.vercel.app"}'

# Quét thư mục local
curl -X POST localhost:3000/api/scans -H 'content-type: application/json' \
  -d '{"mode":"local","localPath":"D:/projects/my-app"}'

# Poll trạng thái / lấy báo cáo
curl localhost:3000/api/scans/<id>

# Sinh preview fix (cần AI key)
curl -X POST localhost:3000/api/scans/<id>/fix-preview -H 'content-type: application/json' -d '{}'

# Tạo PR
curl -X POST localhost:3000/api/scans/<id>/pull-request \
  -H 'content-type: application/json' \
  -d '{"repo":"owner/repo","token":"github_pat_...","findingIds":["<finding-id>"]}'
```

## Kiểm thử

```bash
pnpm test           # vitest: security/SEO + bundle detector + prompt builder + OAuth session (23 engine + 24 web test)
pnpm build          # typecheck toàn workspace
```

E2E đã verify: scan `examples/leaky-app` (local + live) bắt đủ 4 nhóm lỗi — render loop `+22 render khi idle`, memory leak critical, 7 bundle findings, 14 security/SEO findings — trong ~23s.

## Khắc phục sự cố

| Hiện tượng | Nguyên nhân & cách xử lý |
|---|---|
| Lighthouse không chạy | Cần Chrome/Edge đã cài trên máy — engine dùng Chrome hệ thống qua `chrome-launcher`, không tự tải browser. |
| Playwright báo thiếu browser | Chạy `pnpm --filter @wpsa/engine exec playwright install chromium`. |
| Tạo PR trả **404 Not Found** | Hai nguyên nhân thường gặp: (1) branch gốc gõ sai / không tồn tại; (2) PAT fine-grained thiếu quyền *Contents* hoặc *Pull requests* read/write, hoặc repo không nằm trong *Repository access* — GitHub trả 404 thay vì 403. |
| Tải repo lỗi giải nén | Tarball vượt giới hạn 200MB hoặc URL repo sai định dạng. |
| Tên component trên biểu đồ bị rút gọn (`nZ`, `C`) | Target là **production build** — React xoá tên function ở bản prod. Quét bản dev build sẽ có tên đầy đủ. |
| Lịch sử scan biến mất / job cũ báo lỗi "Server đã restart giữa chừng scan" | Job lưu trong SQLite (`apps/web/.data/wpsa-jobs.db`) nên sống qua restart — job đang chạy khi server tắt sẽ bị đánh dấu lỗi. Job đã xong được dọn sau 6 tiếng (chỉnh bằng `WPSA_JOB_TTL_HOURS`). |
| Không thấy nút sinh fix AI | Chưa cấu hình `AI_API_KEY` trong `.env` — thêm xong nhớ restart app. |
| Không thấy nút "Đăng nhập với GitHub" | Chưa có `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` trong `.env` — thêm xong nhớ restart app. |
| Đăng nhập GitHub báo "Đổi authorization code thất bại" | Client Secret sai, hoặc callback URL đăng ký trên GitHub OAuth App không khớp với thực tế (`http://localhost:3000/api/auth/github/callback` — chạy port khác? đặt `WPSA_PUBLIC_URL` trong `.env`). |
| Tạo PR trả **401** sau khi đăng nhập OAuth | Token của phiên đã bị thu hồi trên GitHub hoặc phiên hết hạn (8 tiếng / server restart) — đăng nhập lại. |

## Lộ trình

- [x] Lưu job vào SQLite thay vì in-memory (giữ lịch sử qua restart)
- [x] GitHub App / OAuth thay cho việc dán PAT tay (đăng nhập OAuth App; access token chỉ trong RAM)
- [ ] Docker image chạy 1 lệnh
- [ ] CLI độc lập (scan không cần dashboard)
- [ ] Xuất báo cáo PDF/HTML
- [ ] Re-render detector cho Vue/Svelte (hiện chỉ hỗ trợ React)
- [ ] Tích hợp CI (GitHub Action) chạy audit tự động trên mỗi PR

## Đóng góp

Mọi contribution đều được chào đón!

1. Fork repo và tạo branch từ `main`: `git checkout -b feat/ten-tinh-nang`
2. Cài đặt: `pnpm install`
3. Code, rồi đảm bảo sạch: `pnpm build && pnpm test`
4. Commit theo [Conventional Commits](https://www.conventionalcommits.org/vi/) (`feat:`, `fix:`, `docs:`, …)
5. Mở Pull Request, mô tả rõ thay đổi và cách test

## Giấy phép

[MIT](LICENSE) © 2026 WPSA contributors

## Ghi nhận

Dự án đứng trên vai các thư viện tuyệt vời này:

- [Lighthouse](https://github.com/GoogleChrome/lighthouse) — audit hiệu năng & CWV
- [Playwright](https://playwright.dev) — trình duyệt tự động cho probe re-render/memory
- [Octokit](https://github.com/octokit/octokit.js) — GitHub REST cho luồng tạo PR
- [Next.js](https://nextjs.org) / [React](https://react.dev) / [Tailwind CSS](https://tailwindcss.com) — dashboard
- [GLM](https://open.bigmodel.cn) — mô hình AI mặc định cho việc sinh fix
