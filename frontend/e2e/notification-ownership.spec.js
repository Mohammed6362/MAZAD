import { test, expect, login, noOverflow, openActionTab } from './application.js';
import { fileURLToPath } from 'node:url';
const fixture = fileURLToPath(new URL('../../backend/fixtures/car.png', import.meta.url));

test('members cannot see administration and the admin can approve a listing without ownership uploads', async ({
  browser,
  application: app,
}) => {
  const ownerContext = await browser.newContext(),
    adminContext = await browser.newContext();
  let owner = await ownerContext.newPage();
  const admin = await adminContext.newPage();
  try {
    await login(owner, app.url, '0900000012');
    await expect(owner.locator('a[href^="/admin"]')).toHaveCount(0);
    await owner.goto(app.url + '/admin/notifications');
    await expect(owner.getByRole('alert')).toContainText('لا يملك صلاحية');
    await expect(owner.getByRole('heading', { name: 'إشعارات الإدارة' })).toHaveCount(0);
    await owner.goto(app.url + '/account/cars/new');
    await expect(
      owner.getByRole('heading', { name: 'أوراق ملكية السيارة (اختياري)' }),
    ).toBeVisible();
    await owner.locator('[name=make]').fill('Hyundai');
    await owner.locator('[name=model]').fill('Azera');
    await owner.locator('[name=year]').fill('2022');
    await owner.locator('[name=vin]').fill('1HGCM82633A009992');
    await owner.locator('[name=location]').selectOption('طرابلس');
    // Only attach the public car image; ownership papers are optional.
    await owner.locator('input[type=file]').nth(1).setInputFiles(fixture);
    await owner.getByRole('button', { name: 'إرسال للمراجعة' }).click();
    await expect(
      owner.getByText('وصل طلبك بنجاح، وهو الآن قيد المراجعة.', { exact: false }),
    ).toBeVisible();
    owner = await openActionTab(owner, owner.getByRole('link', { name: 'تابع حالة سيارتك' }));
    await expect(owner).toHaveURL(app.url + '/account/cars');
    await expect(owner.locator('a[href^="/admin"]')).toHaveCount(0);

    await login(admin, app.url, '0900000011', true);
    await admin.goto(app.url + '/account/notifications');
    await expect(admin.getByRole('heading', { name: 'طلب سيارة جديد' })).toHaveCount(0);
    await admin.goto(app.url + '/admin/notifications');
    await expect(
      admin.getByRole('heading', { name: 'إشعارات الإدارة', exact: true }),
    ).toBeVisible();
    await expect(admin.getByRole('heading', { name: 'طلب سيارة جديد' })).toHaveCount(3);
    await admin.getByRole('button', { name: 'تحديد الكل كمقروء' }).click();
    await expect(admin.getByText('0 إشعار غير مقروء', { exact: false })).toBeVisible();
    await admin.setViewportSize({ width: 390, height: 844 });
    await noOverflow(admin);

    await admin.goto(app.url + '/admin/review');
    const record = admin
      .locator('article')
      .filter({ has: admin.getByRole('heading', { name: 'Hyundai Azera 2022' }) });
    await expect(record.getByRole('button', { name: 'اعتماد السيارة' })).toBeDisabled();
    await record.getByRole('button', { name: 'التفاصيل والصور وأوراق الملكية' }).click();
    await expect(record.getByRole('alert')).toContainText('لم تُرفق أوراق ملكية');
    await record
      .getByLabel('راجعت بيانات السيارة والبائع وأوافق على اعتماد الملكية دون أوراق مرفقة.')
      .check();
    await record.getByRole('button', { name: 'اعتماد السيارة' }).click();
    await expect(record).toHaveCount(0);
    await owner.goto(app.url + '/account/notifications');
    await expect(owner.getByRole('heading', { name: 'تم اعتماد سيارتك' })).toBeVisible();
    await expect(owner.getByRole('heading', { name: 'طلب سيارة جديد' })).toHaveCount(0);
    await expect(owner.locator('a[href^="/admin"]')).toHaveCount(0);

    await admin.setViewportSize({ width: 1366, height: 900 });
    await admin.getByRole('button', { name: 'خروج', exact: true }).click();
    await login(admin, app.url, '0900000012');
    await expect(admin.locator('a[href^="/admin"]')).toHaveCount(0);
    await admin.goto(app.url + '/account/notifications');
    await expect(admin.getByRole('heading', { name: 'طلب سيارة جديد' })).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await adminContext.close();
  }
});
