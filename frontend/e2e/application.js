/**
 * تجهيز Playwright؛ يشغّل خادم المعاينة المؤقت ويقدم أدوات الدخول والمزايدة وفحص العرض والتنظيف.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));

export const test = base.extend({
  application: async ({}, use) => {
    const child = spawn(process.execPath, [path.join(root, 'backend/tests/ui-preview.js')], {
      cwd: root,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let failure = '';
    const watchers = new Set();
    child.stdout.on('data', (data) => {
      output += data.toString();
      watchers.forEach((listener) => listener());
    });
    child.stderr.on('data', (data) => {
      failure += data.toString();
    });
    async function waitFor(pattern) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          watchers.delete(check);
          reject(new Error('Fixture startup/command timeout: ' + output + failure));
        }, 20000);
        function check() {
          const match = output.match(pattern);
          if (match) {
            clearTimeout(timer);
            watchers.delete(check);
            resolve(match);
          }
        }
        watchers.add(check);
        check();
      });
    }
    try {
      const match = await waitFor(/Preview: (http:\/\/127\.0\.0\.1:\d+)/);
      await use({
        url: match[1],
        command: async (command) => {
          output = '';
          child.stdin.write(command + '\n');
          return waitFor(
            command === 'finish'
              ? /Closed fixture auctions: \d+/
              : command === 'enable-fees'
                ? /Listing fee enabled: 10/
                : /Expired fixture invoices: \d+/,
          );
        },
      });
    } finally {
      if (child.exitCode === null) {
        const exit = new Promise((resolve) => child.once('exit', resolve));
        child.stdin.write('stop\n');
        await exit;
      }
      if (!output.includes('Preview fixtures removed.'))
        throw new Error('Preview did not confirm cleanup: ' + output + failure);
    }
  },
});
export { expect };
export async function openActionTab(page, link) {
  const opened = page.context().waitForEvent('page');
  await link.click();
  const tab = await opened;
  await tab.waitForLoadState('domcontentloaded');
  return tab;
}
// ينفذ خطوات الدخول من الواجهة باستخدام حسابات المعاينة الاصطناعية ويتحقق من الوجهة النهائية.
export async function login(page, url, phone, admin = false) {
  await page.goto(url + (admin ? '/admin/login' : '/login'));
  await page.getByLabel('الهاتف أو البريد الإلكتروني').fill(phone);
  await page.getByLabel('كلمة المرور', { exact: true }).fill('PreviewOnly2026!');
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(admin ? '/admin/dashboard$' : '/account$'));
}
// يتحقق من أن عرض المحتوى لا يتجاوز نافذة المتصفح، لاكتشاف مشاكل تخطيط الهاتف.
export async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
}
// يشحن حساب الاختبار ويقدم عرضًا ثم يغلق المزاد بأمر المعاينة لبدء سيناريو الفاتورة.
export async function bidAndClose(page, app) {
  await page.goto(app.url + '/account/wallet');
  await page.getByRole('button', { name: 'شحن تجريبي — بدون دفع حقيقي' }).click();
  await expect(page.getByText('تم شحن رصيد المحفظة. لا توجد أموال حقيقية.')).toBeVisible();
  await page.goto(app.url + '/auctions/1');
  await page.locator('.bid-form input').fill('20000');
  const placed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auctions/1/bids') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'تأكيد المزايدة' }).click();
  expect((await placed).status()).toBe(201);
  await app.command('finish');
  await page.goto(app.url + '/account/invoices');
  await expect(page.getByText('آخر موعد للسداد:', { exact: false })).toBeVisible();
}
