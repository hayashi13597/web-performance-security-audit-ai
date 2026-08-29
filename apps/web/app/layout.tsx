import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WPSA — Web Performance & Security Audit AI',
  description:
    'Quét URL hoặc source code: phát hiện lãng phí re-render, bundle quá lớn, rò rỉ bộ nhớ, vi phạm security/SEO — và sinh PR sửa lỗi 1 click.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
