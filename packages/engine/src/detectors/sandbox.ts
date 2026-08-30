/**
 * Flags Chromium bổ sung khi chạy trong container (Docker).
 * Đặt WPSA_CHROME_NO_SANDBOX=1 để bật: Chrome từ chối chạy dạng root
 * trong container nếu thiếu --no-sandbox, còn /dev/shm mặc định 64MB
 * khiến tab crash khi thiếu --disable-dev-shm-usage.
 */
export function containerChromiumArgs(): string[] {
  return process.env.WPSA_CHROME_NO_SANDBOX === '1'
    ? ['--no-sandbox', '--disable-dev-shm-usage']
    : [];
}
