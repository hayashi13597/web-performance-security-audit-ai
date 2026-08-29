import lighthouse from 'lighthouse';
import { killAll, launch } from 'chrome-launcher';
import type { CWVMetrics, Finding } from '../types.js';

export interface LighthouseScanOptions {
  formFactor: 'mobile' | 'desktop';
  /** Giới hạn category; mặc định performance + seo + best-practices. */
  onlyCategories?: string[];
}

export interface LighthouseScanResult {
  cwv: CWVMetrics;
  findings: Finding[];
  /** URL Lighthouse thực sự quét (sau redirect). */
  finalUrl?: string;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `lh-${Date.now().toString(36)}-${counter}`;
}

/** Audit Lighthouse được map thành finding (khi score < 0.9). */
const AUDIT_TITLES: Record<string, { title: string; detail: string; fixHint?: string }> = {
  'render-blocking-resources': {
    title: 'Resources chặn render lần đầu',
    detail: 'CSS/JS trong <head> chưa có async/defer khiến trình duyệt phải chờ tải xong mới được paint.',
    fixHint: 'Thêm defer/async cho script, preconnect cho origin quan trọng, inline CSS critical.',
  },
  'unused-javascript': {
    title: 'JavaScript không được dùng',
    detail: 'Phần lớn JS tải về nhưng không được thực thi trong lúc interactive — lãng phí băng thông và CPU parse.',
    fixHint: 'Code-split theo route, dynamic import component ít dùng, bỏ dependency chết.',
  },
  'unused-css-rules': {
    title: 'CSS không được dùng',
    detail: 'Stylesheet tải về nhưng selector không match element nào trên trang.',
    fixHint: 'Tách CSS theo component/route, xoá CSS chết, dùng PurgeCSS cho utility framework.',
  },
  'uses-text-compression': {
    title: 'Chưa bật nén text (gzip/brotli)',
    detail: 'Response text trả về không nén, đội thêm nhiều lần dung lượng truyền.',
    fixHint: 'Bật brotli/gzip ở server hoặc CDN cho text/html, js, css, svg, json.',
  },
  'uses-responsive-images': {
    title: 'Ảnh kích thước lớn hơn hiển thị',
    detail: 'Ảnh decode ở kích thước lớn hơn nhiều so với vùng hiển thị trên màn hình.',
    fixHint: 'Dùng srcset/sizes hoặc dịch vụ resize ảnh theo viewport.',
  },
  'modern-image-formats': {
    title: 'Ảnh chưa dùng định dạng thế hệ mới',
    detail: 'JPEG/PNG thay vì WebP/AVIF làm nặng ảnh đáng kể ở cùng chất lượng.',
    fixHint: 'Chuyển ảnh sang WebP/AVIF, giữ fallback định dạng cũ.',
  },
  'offscreen-images': {
    title: 'Ảnh ngoài màn hình được lazy-load',
    detail: 'Ảnh dưới fold vẫn tải ngay từ đầu, cạnh tranh băng thông với nội dung trên fold.',
    fixHint: 'Thêm loading="lazy" cho ảnh ngoài viewport đầu tiên.',
  },
  'uses-long-cache-ttl': {
    title: 'Cache ttl ngắn hoặc thiếu',
    detail: 'Static asset không có Cache-Control dài hạn, người dùng quay lại phải tải lại toàn bộ.',
    fixHint: 'Cache-Control: max-age=31536000, immutable cho asset có hash trong tên file.',
  },
  'bootup-time': {
    title: 'Thời gian thực thi JS trên main thread cao',
    detail: 'Phân tích + thực thi JS chiếm nhiều thời gian, kéo dài thời gian tới interactive.',
    fixHint: 'Giảm dung lượng JS, tách tác vụ dài, dùng web worker cho tính toán nặng.',
  },
  'mainthread-work-breakdown': {
    title: 'Main thread bận quá lâu',
    detail: 'Tổng thời gian main thread xử lý vượt ngưỡng, ảnh hưởng trực tiếp tới INP/TBT.',
    fixHint: 'Giảm work JS đồng bộ, ưu tiên code-split và defer script không critical.',
  },
  'third-party-summary': {
    title: 'Third-party code chiếm nhiều thời gian',
    detail: 'Script bên thứ ba (analytics, ads, chat…) chặn hoặc cạnh tranh main thread.',
    fixHint: 'Load third-party bằng worker/defer, đánh giá lại script không thật sự cần.',
  },
  'font-display': {
    title: 'Font chưa khai báo font-display',
    detail: 'Text có thể bị ẩn trong lúc chờ font tải (FOIT).',
    fixHint: 'Dùng font-display: swap (hoặc optional) trong @font-face.',
  },
  'dom-size': {
    title: 'DOM quá lớn',
    detail: 'Số node DOM lớn làm chậm mọi thao tác style/layout và tăng memory.',
    fixHint: 'Virtualize list dài, giảm node wrapper không cần thiết.',
  },
  'total-byte-weight': {
    title: 'Tổng dung lượng trang quá lớn',
    detail: 'Network payload vượt mốc, đặc biệt tốn kém trên mạng di động.',
    fixHint: 'Nén ảnh, lazy-load, tách payload theo hành vi người dùng.',
  },
  'largest-contentful-paint-element': {
    title: 'Phần tử LCP được tối ưu chưa tốt',
    detail: 'Chi tiết breakdown cho thấy phần tử LCP bị delay bởi tài nguyên hoặc render-blocking.',
    fixHint: 'Preload ảnh hero, ưu tiên tải phần tử LCP, giảm render-blocking resources.',
  },
};

function severityOf(score: number): Finding['severity'] {
  if (score <= 0.05) return 'critical';
  if (score < 0.65) return 'warning';
  return 'info';
}

function impactOf(audit: { details?: { overallSavingsMs?: number; overallSavingsBytes?: number } }): string | undefined {
  const ms = audit.details?.overallSavingsMs;
  const bytes = audit.details?.overallSavingsBytes;
  const parts: string[] = [];
  if (ms && ms > 0) parts.push(`tiết kiệm ~${Math.round(ms / 100) / 10}s`);
  if (bytes && bytes > 1024) parts.push(`~${Math.round(bytes / 1024)}KB`);
  return parts.length ? parts.join(', ') : undefined;
}

function cwvFindings(cwv: CWVMetrics): Finding[] {
  const out: Finding[] = [];
  const push = (
    ok: boolean,
    severe: boolean,
    title: string,
    detail: string,
    fixHint: string,
    metrics: Record<string, number | string>,
  ) => {
    if (ok) return;
    out.push({
      id: nextId(),
      category: 'performance',
      detector: 'lighthouse-cwv',
      title,
      detail,
      severity: severe ? 'critical' : 'warning',
      metrics,
      fixHint,
      aiFixable: false,
    });
  };

  if (cwv.lcp !== undefined) {
    push(
      cwv.lcp <= 2500,
      cwv.lcp > 4000,
      `LCP = ${(cwv.lcp / 1000).toFixed(2)}s (ngưỡng tốt ≤ 2.5s)`,
      'LCP đo thời gian hiển thị phần tử nội dung lớn nhất — chậm nghĩa là người dùng phải chờ lâu mới thấy nội dung chính.',
      'Tối ưu TTFB, preload ảnh hero, xoá render-blocking resources, ưu tiên tải nội dung trên fold.',
      { lcpMs: Math.round(cwv.lcp) },
    );
  }
  if (cwv.cls !== undefined) {
    push(
      cwv.cls <= 0.1,
      cwv.cls > 0.25,
      `CLS = ${cwv.cls.toFixed(3)} (ngưỡng tốt ≤ 0.1)`,
      'CLS cao nghĩa là layout bị xê dịch mạnh sau khi render — gây bấm nhầm và cảm giác "nhảy" trang.',
      'Khai báo width/height cho ảnh/embed, reserve chỗ cho nội dung async, tránh chèn DOM trên fold.',
      { cls: cwv.cls },
    );
  }
  if (cwv.tbt !== undefined) {
    push(
      cwv.tbt <= 200,
      cwv.tbt > 600,
      `TBT = ${Math.round(cwv.tbt)}ms (ngưỡng tốt ≤ 200ms)`,
      'TBT là proxy lab cho FID/INP: tổng thời gian main thread bị chặn giữa FCP và interactive.',
      'Code-splitting, giảm JS đồng bộ lúc khởi động, tách long task.',
      { tbtMs: Math.round(cwv.tbt) },
    );
  }
  if (cwv.fcp !== undefined) {
    push(
      cwv.fcp <= 1800,
      cwv.fcp > 3000,
      `FCP = ${(cwv.fcp / 1000).toFixed(2)}s (ngưỡng tốt ≤ 1.8s)`,
      'FCP chậm nghĩa là màn hình trống lâu trước khi hiển thị nội dung đầu tiên.',
      'Inline CSS critical, giảm render-blocking, tối ưu TTFB.',
      { fcpMs: Math.round(cwv.fcp) },
    );
  }
  if (cwv.ttfb !== undefined) {
    push(
      cwv.ttfb <= 800,
      cwv.ttfb > 1800,
      `TTFB = ${Math.round(cwv.ttfb)}ms (ngưỡng tốt ≤ 800ms)`,
      'Server phản hồi chậm, mọi giai đoạn sau đều bị đội theo.',
      'Thêm cache CDN, tối ưu query backend, edge rendering nếu cần.',
      { ttfbMs: Math.round(cwv.ttfb) },
    );
  }
  return out;
}

/** Chạy Lighthouse qua Chrome hệ thống (chrome-launcher). */
export async function runLighthouseScan(
  url: string,
  options: LighthouseScanOptions,
): Promise<LighthouseScanResult> {
  const { formFactor } = options;
  const chrome = await launch({ chromeFlags: ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check'] });
  try {
    const flags: Record<string, unknown> = {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: options.onlyCategories ?? ['performance', 'seo', 'best-practices'],
    };
    if (formFactor === 'desktop') {
      flags.formFactor = 'desktop';
      flags.screenEmulation = { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false };
      flags.throttling = {
        rttMs: 40,
        throughputKbps: 10240,
        requestLatencyMs: 0,
        downloadThroughputKbps: 10240,
        uploadThroughputKbps: 10240,
        cpuSlowdownMultiplier: 1,
      };
    }

    const result = await lighthouse(url, flags as never);
    const lhr = result?.lhr;
    if (!lhr) throw new Error('Lighthouse không trả về kết quả');

    const audits = lhr.audits as Record<
      string,
      { score: number | null; numericValue?: number; displayValue?: string; details?: { overallSavingsMs?: number; overallSavingsBytes?: number; items?: unknown[] } } | undefined
    >;

    const num = (id: string): number | undefined => audits[id]?.numericValue;
    const cwv: CWVMetrics = {
      ttfb: num('server-response-time'),
      fcp: num('first-contentful-paint'),
      lcp: num('largest-contentful-paint'),
      cls: num('cumulative-layout-shift'),
      tbt: num('total-blocking-time'),
      speedIndex: num('speed-index'),
      performanceScore: Math.round((lhr.categories.performance?.score ?? 0) * 100),
      seoScore: Math.round((lhr.categories.seo?.score ?? 0) * 100),
      bestPracticesScore: Math.round((lhr.categories['best-practices']?.score ?? 0) * 100),
    };

    const findings: Finding[] = [...cwvFindings(cwv)];

    for (const [auditId, meta] of Object.entries(AUDIT_TITLES)) {
      const audit = audits[auditId];
      if (!audit || audit.score === null || audit.score === undefined) continue;
      if (audit.score >= 0.9) continue;
      findings.push({
        id: nextId(),
        category: 'performance',
        detector: `lighthouse:${auditId}`,
        title: meta.title,
        detail: `${meta.detail}${audit.displayValue ? ` Số liệu đo được: ${audit.displayValue}.` : ''}`,
        severity: severityOf(audit.score),
        impact: impactOf(audit),
        metrics: { audit: auditId, score: Math.round(audit.score * 100) },
        fixHint: meta.fixHint,
        aiFixable: false,
      });
    }

    return { cwv, findings, finalUrl: lhr.finalDisplayedUrl ?? url };
  } finally {
    await killAll();
  }
}
