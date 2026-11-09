/**
 * تجربة متصفح كاملة للتسجيل بالجواز ورسوم العرض مرة واحدة وتعديل السيارة وتغيير الصلاحيات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { test, expect, login, noOverflow, openActionTab } from './application.js';
import { fileURLToPath } from 'node:url';
const fixture = fileURLToPath(new URL('../../backend/fixtures/car.png', import.meta.url));

test('register with private passport, pay approval fee once, edit own car and update permissions', async ({
  browser,
  application: app,
}, testInfo) => {
  test.setTimeout(120000);
  await app.command('enable-fees');
  const ownerContext = await browser.newContext();
  const adminContext = await browser.newContext();
  let owner = await ownerContext.newPage();
  const admin = await adminContext.newPage();
  try {
    await owner.goto(app.url + '/register');
    await owner.getByLabel('الاسم الكامل', { exact: true }).fill('مستخدم السياسات');
    await owner.getByLabel('رقم الهاتف', { exact: true }).fill('0900000014');
    await owner
      .getByLabel('كلمة المرور (8 أحرف على الأقل)', { exact: true })
      .fill('PreviewOnly2026!');
    await owner.getByLabel('تأكيد كلمة المرور', { exact: true }).fill('PreviewOnly2026!');
    await owner.getByLabel('صورة جواز السفر').setInputFiles(fixture);
    await owner.setViewportSize({ width: 320, height: 900 });
    await noOverflow(owner);
    await owner.getByRole('button', { name: 'إنشاء الحساب', exact: true }).click();
    await expect(owner).toHaveURL(app.url + '/account');
    const me = await (await owner.request.get(app.url + '/api/me')).json();
    expect(me.user.has_passport).toBe(true);
    const passportUrl = app.url + `/api/admin/users/${me.user.id}/passport`;
    expect((await owner.request.get(passportUrl)).status()).toBe(403);
    await owner.goto(app.url + '/account/wallet');
    await owner.getByLabel('المبلغ بالدينار الليبي').fill('50');
    await owner.getByRole('button', { name: 'شحن تجريبي — بدون دفع حقيقي' }).click();
    await expect(owner.getByText('تم شحن رصيد المحفظة. لا توجد أموال حقيقية.')).toBeVisible();
    await owner.goto(app.url + '/account/cars/new');
    await expect(owner.getByText('رسوم عرض السيارة:', { exact: false })).toContainText('10');
    await owner.locator('[name=make]').fill('Hyundai');
    await owner.locator('[name=model]').fill('Azera');
    await owner.locator('[name=year]').fill('2022');
    await owner.locator('[name=vin]').fill('1HGCM82633A009991');
    await owner.locator('[name=location]').selectOption('طرابلس');
    await owner.locator('input[type=file]').nth(0).setInputFiles(fixture);
    await owner.locator('input[type=file]').nth(1).setInputFiles(fixture);
    const sent = owner.waitForResponse(
      (r) => r.url().endsWith('/api/cars') && r.request().method() === 'POST',
    );
    await owner.getByRole('button', { name: 'إرسال للمراجعة' }).click();
    expect((await sent).status()).toBe(201);
    await login(admin, app.url, '0900000011', true);
    expect((await admin.request.get(passportUrl)).status()).toBe(200);
    async function approve() {
      await admin.goto(app.url + '/admin/review');
      const record = admin
        .locator('article')
        .filter({ has: admin.getByRole('heading', { name: 'Hyundai Azera 2022' }) });
      await record.getByRole('button', { name: 'التفاصيل والصور وأوراق الملكية' }).click();
      await record.getByRole('checkbox').check();
      await record.getByRole('button', { name: 'اعتماد السيارة' }).click();
      await expect(record).toHaveCount(0);
    }
    await approve();
    await owner.goto(app.url + '/account/cars');
    owner = await openActionTab(
      owner,
      owner.getByRole('link', { name: 'تعديل بيانات السيارة', exact: true }),
    );
    await owner.locator('[name=location]').selectOption('مصراتة');
    await owner.getByRole('button', { name: 'إرسال للمراجعة' }).click();
    await expect(owner).toHaveURL(app.url + '/account/cars');
    await expect(owner.getByText('قيد المراجعة', { exact: true })).toBeVisible();
    await approve();
    const wallet = await (await owner.request.get(app.url + '/api/account/wallet')).json();
    expect(wallet.wallet.balance).toBe('40.000');
    expect(wallet.transactions.filter((tx) => tx.kind === 'listing_fee')).toHaveLength(1);
    await admin.goto(app.url + '/admin/users');
    const record = admin
      .locator('article')
      .filter({ has: admin.getByRole('heading', { name: 'مستخدم السياسات', exact: true }) });
    await expect(record.getByRole('link', { name: 'فتح الصورة الخاصة' })).toBeVisible();
    await record.getByLabel('عرض وتعديل السيارات', { exact: true }).uncheck();
    await record.getByLabel('المزايدة', { exact: true }).uncheck();
    await admin.setViewportSize({ width: 320, height: 900 });
    await noOverflow(admin);
    await admin.screenshot({
      path: testInfo.outputPath('mobile-user-permissions.png'),
      fullPage: true,
    });
    await record.getByRole('button', { name: 'حفظ الصلاحيات', exact: true }).click();
    await expect(admin.getByText('حُفظت الصلاحيات.', { exact: false })).toBeVisible();
    await login(owner, app.url, '0900000014');
    await owner.goto(app.url + '/account/settings');
    await expect(owner.getByRole('region', { name: 'صلاحيات حسابك' })).toContainText('غير مسموح');
    await owner.goto(app.url + '/account/cars/new');
    await expect(owner.getByRole('alert')).toContainText('أوقفت الإدارة صلاحية');
    await owner.goto(app.url + '/auctions/1');
    await expect(owner.getByRole('alert')).toContainText('أوقفت الإدارة صلاحية المزايدة');
    await expect(owner.getByRole('button', { name: 'تأكيد المزايدة' })).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await adminContext.close();
  }
});
