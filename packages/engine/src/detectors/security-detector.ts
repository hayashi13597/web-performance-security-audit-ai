import type { Finding, Severity } from '../types.js';

interface HeaderRule {
  header: string;
  severity: Severity;
  title: string;
  detail: string;
  fixHint: string;
  /** Giá trị hiện tại bị coi là yếu (ví dụ CSP chứa unsafe-inline). */
  weakValues?: RegExp;
  weakDetail?: string;
}

const HEADER_RULES: HeaderRule[] = [
  {
    header: 'content-security-policy',
    severity: 'warning',
    title: 'Thiếu Content-Security-Policy',
    detail:
      'Không có CSP, trình duyệt không giới hạn được nguồn script/style mà trang được phép tải — điều kiện thuận lợi cho XSS.',
    fixHint:
      'Thêm header Content-Security-Policy với directive script-src/style-src tối thiểu (ví dụ: default-src \'self\'; script-src \'self\'), tránh dùng unsafe-inline.',
    weakValues: /unsafe-inline|unsafe-eval/i,
    weakDetail:
      'CSP đang chứa unsafe-inline hoặc unsafe-eval — gần như vô hiệu hoá khả năng chặn XSS của CSP.',
  },
  {
    header: 'strict-transport-security',
    severity: 'warning',
    title: 'Thiếu HSTS (Strict-Transport-Security)',
    detail:
      'Trang chạy HTTPS nhưng không có HSTS, trình duyệt vẫn có thể bị dụ truy cập lần đầu qua HTTP (downgrade attack).',
    fixHint: 'Thêm header: Strict-Transport-Security: max-age=31536000; includeSubDomains',
  },
  {
    header: 'x-content-type-options',
    severity: 'info',
    title: 'Thiếu X-Content-Type-Options: nosniff',
    detail:
      'Không có nosniff, trình duyệt có thể tự "đoán" MIME type và thực thi file không phải script như script (MIME sniffing).',
    fixHint: 'Thêm header: X-Content-Type-Options: nosniff',
  },
  {
    header: 'x-frame-options',
    severity: 'info',
    title: 'Thiếu X-Frame-Options / frame-ancestors',
    detail:
      'Trang cho phép bị nhúng vào iframe từ origin bất kỳ → nguy cơ clickjacking.',
    fixHint:
      'Thêm header X-Frame-Options: DENY (hoặc SAMEORIGIN), hoặc CSP directive frame-ancestors \'none\'.',
  },
  {
    header: 'referrer-policy',
    severity: 'info',
    title: 'Thiếu Referrer-Policy',
    detail: 'URL đầy đủ (kể cả query nhạy cảm) có thể bị gửi sang site khác qua header Referer.',
    fixHint: 'Thêm header: Referrer-Policy: strict-origin-when-cross-origin',
  },
  {
    header: 'permissions-policy',
    severity: 'info',
    title: 'Thiếu Permissions-Policy',
    detail:
      'Không khai báoPermissions-Policy, các API mạnh (camera, microphone, geolocation…) không bị chặn mặc định với iframe thứ ba.',
    fixHint: 'Ví dụ: Permissions-Policy: camera=(), microphone=(), geolocation=()',
  },
  {
    header: 'cross-origin-opener-policy',
    severity: 'info',
    title: 'Thiếu Cross-Origin-Opener-Policy',
    detail:
      'Thiếu COOP khiến trang mở window.opener cho các popup cross-origin (nguy cơ tabnabbing).',
    fixHint: 'Thêm header: Cross-Origin-Opener-Policy: same-origin',
  },
];

interface SeoCheckResult {
  findings: Finding[];
}

let findingCounter = 0;
function nextId(prefix: string): string {
  findingCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${findingCounter}`;
}

function checkHeaders(headers: Record<string, string>, https: boolean): Finding[] {
  const get = (name: string): string | null => {
    const lower = name.toLowerCase();
    const key = Object.keys(headers).find((k) => k.toLowerCase() === lower);
    return key ? headers[key] : null;
  };
  const findings: Finding[] = [];
  for (const rule of HEADER_RULES) {
    const value = get(rule.header);
    if (!value) {
      if (rule.header === 'strict-transport-security' && !https) continue;
      if (rule.header === 'x-frame-options') {
        // Có CSP frame-ancestors thì coi như đã thoả
        const csp = get('content-security-policy') ?? '';
        if (/frame-ancestors/i.test(csp)) continue;
      }
      findings.push({
        id: nextId('sec'),
        category: 'security',
        detector: 'security-headers',
        title: rule.title,
        detail: rule.detail,
        severity: rule.severity,
        metrics: { header: rule.header, status: 'missing' },
        fixHint: rule.fixHint,
        aiFixable: true,
      });
    } else if (rule.weakValues?.test(value)) {
      findings.push({
        id: nextId('sec'),
        category: 'security',
        detector: 'security-headers',
        title: `${rule.title.split('Thiếu ').join('')}: cấu hình yếu`,
        detail: rule.weakDetail ?? `Giá trị hiện tại của ${rule.header} được coi là không an toàn.`,
        severity: 'warning',
        metrics: { header: rule.header, value },
        fixHint: rule.fixHint,
        aiFixable: true,
      });
    }
  }

  const server = get('server');
  if (server && /\d+\.\d+/.test(server)) {
    findings.push({
      id: nextId('sec'),
      category: 'security',
      detector: 'security-headers',
      title: `Header Server lộ version: ${server}`,
      detail:
        'Header Server/ X-Powered-By chứa số version giúp kẻ tấn công dò nhanh lỗ hổng đã biết của phiên bản đó.',
      severity: 'info',
      metrics: { server },
      fixHint: 'Cấu hình server ẩn/bỏ version trong header Server và xoá X-Powered-By.',
      aiFixable: false,
    });
  }
  return findings;
}

function attrValue(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tag.match(re);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? '';
}

/** Phân tích SEO cơ bản từ HTML. Trả về findings + số liệu phụ trợ. */
export function analyzeHtmlSeo(html: string): SeoCheckResult {
  const findings: Finding[] = [];
  const lower = html.toLowerCase();

  const titleMatch = lower.match(/<title[^>]*>([\s\S]*?)<\/title>/);
  const title = titleMatch?.[1]?.trim() ?? '';
  if (!title) {
    findings.push({
      id: nextId('seo'),
      category: 'seo',
      detector: 'seo-html',
      title: 'Thiếu thẻ <title>',
      detail: 'Title là tín hiệu xếp hạng quan trọng nhất và là nội dung hiển thị trên kết quả tìm kiếm.',
      severity: 'warning',
      fixHint: 'Thêm <title> mô tả 15-60 ký tự, chứa từ khoá chính của trang.',
      aiFixable: true,
    });
  } else if (title.length < 15 || title.length > 60) {
    findings.push({
      id: nextId('seo'),
      category: 'seo',
      detector: 'seo-html',
      title: `Độ dài title không tối ưu (${title.length} ký tự)`,
      detail: 'Google thường hiển thị khoảng 50-60 ký tự; title quá ngắn/gần rỗng hoặc quá dài sẽ bị cắt.',
      severity: 'info',
      metrics: { length: title.length },
      fixHint: 'Điều chỉnh title trong khoảng 15-60 ký tự.',
      aiFixable: true,
    });
  }

  const descMatch = lower.match(/<meta[^>]+name=["']description["'][^>]*>/);
  const description = descMatch ? attrValue(descMatch[0], 'content') ?? '' : '';
  if (!descMatch || !description.trim()) {
    findings.push({
      id: nextId('seo'),
      category: 'seo',
      detector: 'seo-html',
      title: 'Thiếu meta description',
      detail: 'Meta description không quyết định thứ hạng trực tiếp nhưng ảnh hưởng lớn tới CTR trên SERP.',
      severity: 'warning',
      fixHint: 'Thêm <meta name="description" content="..."> dài 70-160 ký tự, tóm tắt nội dung trang.',
      aiFixable: true,
    });
  } else if (description.length < 70 || description.length > 160) {
    findings.push({
      id: nextId('seo'),
      category: 'seo',
      detector: 'seo-html',
      title: `Độ dài meta description không tối ưu (${description.length} ký tự)`,
      detail: 'Nên giữ trong khoảng 70-160 ký tự để không bị cắt trên SERP.',
      severity: 'info',
      metrics: { length: description.length },
      fixHint: 'Điều chỉnh meta description trong khoảng 70-160 ký tự.',
      aiFixable: true,
    });
  }

  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    findings.push({
      id: nextId('seo'),
      category: 'seo',
      detector: 'seo-html',
      title: 'Thiếu meta viewport',
      detail: 'Không có viewport, trang sẽ render sai trên mobile và bị Google đánh giá kém về mobile-friendliness.',
      severity: 'warning',
      fixHint: 'Thêm <meta name="viewport" content="width=device-width, initial-scale=1">.',
      aiFixable: true,
    });
  }

  if (!/<link[^>]+rel=["']canonical["']/i.test(html)) {
    findings.push({
      id: nextId('seo'),
      category: 'seo',
      detector: 'seo-html',
      title: 'Thiếu canonical link',
      detail: 'Thiếu canonical khiến các URL trùng nội dung (query string, http/https…) bị coi là nội dung trùng lặp.',
      severity: 'info',
      fixHint: 'Thêm <link rel="canonical" href="https://domain/duong-dan-chuan">.',
      aiFixable: true,
    });
  }

  const ogTags = ['og:title', 'og:description'].filter((t) => new RegExp(`property=["']${t}`).test(lower));
  if (ogTags.length < 2) {
    findings.push({
      id: nextId('seo'),
      category: 'seo',
      detector: 'seo-html',
      title: `Thiếu Open Graph tags (${ogTags.join(', ') || 'toàn bộ'})`,
      detail: 'Thiếu og:title/og:description khiến link chia sẻ trên mạng xã hội không có preview đẹp.',
      severity: 'info',
      fixHint: 'Thêm <meta property="og:title">, <meta property="og:description">, <meta property="og:image">.',
      aiFixable: true,
    });
  }

  if (!/<html[^>]+lang=/i.test(html)) {
    findings.push({
      id: nextId('seo'),
      category: 'seo',
      detector: 'seo-html',
      title: 'Thiếu thuộc tính lang trên <html>',
      detail: 'lang giúp công cụ tìm kiếm và screen reader xác định ngôn ngữ nội dung.',
      severity: 'info',
      fixHint: 'Ví dụ: <html lang="vi">.',
      aiFixable: true,
    });
  }

  const h1Count = (lower.match(/<h1[\s>]/g) ?? []).length;
  if (h1Count !== 1) {
    findings.push({
      id: nextId('seo'),
      category: 'seo',
      detector: 'seo-html',
      title: h1Count === 0 ? 'Không có thẻ <h1>' : `Có ${h1Count} thẻ <h1>`,
      detail: 'Mỗi trang nên có đúng một <h1> mô tả chủ đề chính để hệ thống hierarchize nội dung.',
      severity: 'info',
      metrics: { h1Count },
      fixHint: 'Giữ đúng một <h1> trên trang, chuyển các <h1> còn lại thành <h2>/<h3>.',
      aiFixable: true,
    });
  }

  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const noAlt = imgTags.filter((t) => attrValue(t, 'alt') === null);
  if (noAlt.length > 0) {
    findings.push({
      id: nextId('seo'),
      category: 'seo',
      detector: 'seo-html',
      title: `${noAlt.length} thẻ <img> thiếu thuộc tính alt`,
      detail: 'Ảnh không có alt vừa mất tín hiệu image-SEO vừa vi phạm WCAG về khả năng tiếp cận.',
      severity: 'warning',
      metrics: { imagesWithoutAlt: noAlt.length, totalImages: imgTags.length },
      fixHint: 'Bổ sung alt mô tả cho mọi thẻ img (alt="" với ảnh trang trí).',
      aiFixable: true,
    });
  }

  return { findings };
}

/** Kiểm tra response headers (dùng trực tiếp hoặc từ test). */
export function checkResponseHeaders(headers: Record<string, string>, https = true): Finding[] {
  return checkHeaders(headers, https);
}

export interface SecurityScanOptions {
  /** Kiểm tra thêm robots.txt/sitemap.xml. */
  checkRobots?: boolean;
  fetchTimeoutMs?: number;
}

/** Quét security headers + SEO cơ bản của một URL. */
export async function runSecuritySeoScan(
  url: string,
  options: SecurityScanOptions = {},
): Promise<Finding[]> {
  const { checkRobots = true, fetchTimeoutMs = 15000 } = options;
  const findings: Finding[] = [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; WPSA-Audit/0.1)' },
    });
  } finally {
    clearTimeout(timer);
  }

  const finalUrl = res.url || url;
  const isHttps = finalUrl.startsWith('https://');
  const headerRecord: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headerRecord[key] = value;
  });
  findings.push(...checkHeaders(headerRecord, isHttps));

  const html = await res.text();
  findings.push(...analyzeHtmlSeo(html).findings);

  if (checkRobots) {
    const robotsUrl = new URL('/robots.txt', finalUrl).toString();
    try {
      const robotsRes = await fetch(robotsUrl, { signal: AbortSignal.timeout(fetchTimeoutMs) });
      if (!robotsRes.ok) {
        findings.push({
          id: nextId('seo'),
          category: 'seo',
          detector: 'seo-html',
          title: 'Thiếu robots.txt',
          detail: 'robots.txt không tồn tại hoặc trả lỗi; bot có thể crawl những trang không mong muốn.',
          severity: 'info',
          metrics: { robotsUrl, status: robotsRes.status },
          fixHint: 'Thêm robots.txt ở thư mục gốc, khai báo Sitemap và Disallow các path nội bộ.',
          aiFixable: true,
        });
      }
    } catch {
      // bỏ qua lỗi mạng khi kiểm robots.txt
    }
  }

  return findings;
}
