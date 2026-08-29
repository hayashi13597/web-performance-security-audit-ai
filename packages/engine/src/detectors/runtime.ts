import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import { chromium } from 'playwright';

export interface RuntimeSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  close: () => Promise<void>;
}

export interface LaunchOptions {
  formFactor: 'mobile' | 'desktop';
  /** Đăng ký init script chạy trước mọi script của trang. */
  initScript?: string;
}

/** Launch Chromium (Playwright) + mở page với CDP session sẵn sàng. */
export async function launchSession(options: LaunchOptions): Promise<RuntimeSession> {
  const browser = await chromium.launch({ headless: true });
  const contextOptions =
    options.formFactor === 'mobile'
      ? {
          viewport: { width: 412, height: 823 },
          userAgent:
            'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
          isMobile: true as const,
          hasTouch: true,
          deviceScaleFactor: 1.75,
        }
      : { viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1 };

  const context = await browser.newContext(contextOptions);
  if (options.initScript) await context.addInitScript(options.initScript);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  return {
    browser,
    context,
    page,
    cdp,
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

/**
 * Phiên tương tác trung tính: scroll lên/xuống, bấm tối đa 2 button, gõ vào input đầu tiên.
 * Dùng chung cho detector re-render và memory để kích hoạt hành vi app một cách giống người dùng.
 */
export async function interactLikeUser(page: Page): Promise<void> {
  try {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);
    await page.mouse.wheel(0, -600);
  } catch {
    // trang có thể không scroll được
  }

  const buttons = page.locator('button:visible, [role="button"]:visible');
  const buttonCount = Math.min(await buttons.count(), 2);
  for (let i = 0; i < buttonCount; i++) {
    try {
      await buttons.nth(i).click({ timeout: 700 });
      await page.waitForTimeout(120);
    } catch {
      // nút có thể bị che/di chuyển — bỏ qua
    }
  }

  const input = page.locator('input:visible, textarea:visible').first();
  try {
    if ((await input.count()) > 0) {
      await input.click({ timeout: 700 });
      await input.fill('audit');
      await page.waitForTimeout(120);
    }
  } catch {
    // không có input hoặc không focus được
  }
}
