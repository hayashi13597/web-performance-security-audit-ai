import { describe, expect, it } from 'vitest';
import { analyzeHtmlSeo, checkResponseHeaders } from '../src/detectors/security-detector.js';

describe('checkResponseHeaders', () => {
  it('phát hiện thiếu toàn bộ security headers', () => {
    const findings = checkResponseHeaders({}, true);
    const headers = findings.map((f) => f.metrics?.['header']);
    expect(headers).toContain('content-security-policy');
    expect(headers).toContain('strict-transport-security');
    expect(headers).toContain('x-content-type-options');
    expect(headers).toContain('x-frame-options');
    expect(headers).toContain('referrer-policy');
  });

  it('bỏ qua HSTS khi site chạy HTTP', () => {
    const findings = checkResponseHeaders({}, false);
    const headers = findings.map((f) => f.metrics?.['header']);
    expect(headers).not.toContain('strict-transport-security');
  });

  it('CSP chứa unsafe-inline bị coi là yếu', () => {
    const findings = checkResponseHeaders(
      { 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'" },
      true,
    );
    const cspFindings = findings.filter((f) => f.metrics?.['header'] === 'content-security-policy');
    expect(cspFindings).toHaveLength(1);
    expect(cspFindings[0].severity).toBe('warning');
  });

  it('X-Frame-Options được bỏ qua khi CSP có frame-ancestors', () => {
    const findings = checkResponseHeaders(
      { 'content-security-policy': "frame-ancestors 'none'" },
      true,
    );
    const headers = findings.map((f) => f.metrics?.['header']);
    expect(headers).not.toContain('x-frame-options');
  });

  it('Server header lộ version bị cảnh báo', () => {
    const findings = checkResponseHeaders({ server: 'nginx/1.24.0' }, true);
    expect(findings.some((f) => f.title.includes('nginx/1.24.0'))).toBe(true);
  });
});

describe('analyzeHtmlSeo', () => {
  const badHtml = `
    <html>
      <body>
        <h1>A</h1><h1>B</h1>
        <img src="a.png"><img src="b.png" alt="ok">
      </body>
    </html>`;

  it('phát hiện đủ lỗi SEO trên HTML kém', () => {
    const { findings } = analyzeHtmlSeo(badHtml);
    const titles = findings.map((f) => f.title);
    expect(titles.some((t) => t.includes('<title>'))).toBe(true);
    expect(titles.some((t) => t.includes('meta description'))).toBe(true);
    expect(titles.some((t) => t.includes('viewport'))).toBe(true);
    expect(titles.some((t) => t.includes('canonical'))).toBe(true);
    expect(titles.some((t) => t.includes('Open Graph'))).toBe(true);
    expect(titles.some((t) => t.includes('lang'))).toBe(true);
    expect(titles.some((t) => t.includes('2 thẻ <h1>'))).toBe(true);
    expect(titles.some((t) => t.includes('thiếu thuộc tính alt'))).toBe(true);
  });

  it('HTML tốt ít finding hơn', () => {
    const goodHtml = `
      <html lang="vi">
        <head>
          <title>Hướng dẫn tối ưu hiệu năng web chi tiết</title>
          <meta name="description" content="Bài viết dài mô tả đủ 70-160 ký tự về cách tối ưu hiệu năng website một cách bài bản.">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <link rel="canonical" href="https://example.com/a">
          <meta property="og:title" content="x">
          <meta property="og:description" content="y">
        </head>
        <body><h1>Một</h1><img src="a.png" alt="ảnh"></body>
      </html>`;
    const { findings } = analyzeHtmlSeo(goodHtml);
    expect(findings).toHaveLength(0);
  });
});
