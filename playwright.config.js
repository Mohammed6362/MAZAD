/**
 * إعداد اختبارات المتصفحات الثلاثة والتقارير ولقطات الفشل؛ تستخدم الاختبارات خادمًا مؤقتًا مستقلًا.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './frontend/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: true,
    viewport: { width: 1366, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
