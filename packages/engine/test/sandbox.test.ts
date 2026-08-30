import { afterEach, describe, expect, it } from 'vitest';
import { containerChromiumArgs } from '../src/detectors/sandbox.js';

const KEY = 'WPSA_CHROME_NO_SANDBOX';

afterEach(() => {
  delete process.env[KEY];
});

describe('containerChromiumArgs', () => {
  it('mặc định không thêm flag nào — máy host giữ hành vi cũ', () => {
    expect(containerChromiumArgs()).toEqual([]);
  });

  it('WPSA_CHROME_NO_SANDBOX=1 thêm --no-sandbox và --disable-dev-shm-usage', () => {
    process.env[KEY] = '1';
    expect(containerChromiumArgs()).toEqual(['--no-sandbox', '--disable-dev-shm-usage']);
  });

  it('giá trị khác "1" bị bỏ qua', () => {
    process.env[KEY] = 'true';
    expect(containerChromiumArgs()).toEqual([]);
  });
});
