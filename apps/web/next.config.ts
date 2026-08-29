import path from 'node:path';
import dotenv from 'dotenv';
import type { NextConfig } from 'next';

// Load .env từ thư mục gốc workspace (ngoài apps/web/.env mặc định của Next)
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const nextConfig: NextConfig = {
  // Lighthouse/Playwright/Octokit là native-heavy deps — bắt buộc external để không bị bundle
  serverExternalPackages: ['@wpsa/engine', 'lighthouse', 'chrome-launcher', 'playwright', 'octokit', 'diff'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
