/**
 * يثبت أن إدخال موعد المزاد بتوقيت ليبيا يعطي التوقيت الصحيح حتى عندما يختلف توقيت جهاز المتصفح.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { test, expect, login, noOverflow } from './application.js';

test('schedule a future auction in Libya time from a device in another time zone', async ({
  browser,
  application: app,
}) => {
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  const page = await context.newPage();
  try {
    await login(page, app.url, '0900000011', true);
    const approved = await page.request.patch(app.url + '/api/admin/cars/1/approve', {
      data: { ownership_verified: true, ownership_revision: 1 },
    });
    expect(approved.status()).toBe(200);
    await page.goto(app.url + '/admin/auctions');
    await page.getByLabel('السيارة المعتمدة').selectOption('1');
    await page.getByLabel('السعر الابتدائي (د.ل)').fill('10000');
    const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel('تاريخ بداية المزايدة').fill(day);
    await page.getByLabel('وقت بداية المزايدة').fill('18:30');
    await page.getByLabel('تاريخ نهاية المزايدة').fill(day);
    await page.getByLabel('وقت نهاية المزايدة').fill('18:30');
    await page.getByRole('button', { name: 'جدولة المزاد', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('نهاية المزاد يجب أن يكون بعد');
    await page.getByLabel('وقت نهاية المزايدة').fill('20:00');
    await expect(page.getByRole('region', { name: 'ملخص موعد المزاد' })).toContainText(
      'مدة المزاد: 1 ساعة و30 دقيقة',
    );
    await page.setViewportSize({ width: 320, height: 900 });
    await noOverflow(page);
    const scheduled = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/cars/1/auction') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'جدولة المزاد', exact: true }).click();
    const result = await scheduled;
    expect(result.status()).toBe(201);
    const { auction } = await result.json();
    expect(new Date(auction.start_time).toISOString()).toBe(`${day}T16:30:00.000Z`);
    expect(new Date(auction.end_time).toISOString()).toBe(`${day}T18:00:00.000Z`);
    await expect(
      page.getByText('تمت جدولة المزاد، وسيُفتح للمزايدة تلقائيًا في موعد البداية.'),
    ).toBeVisible();
    await page.reload();
    const record = page.locator('article').filter({ hasText: 'Toyota Camry 2022' });
    await expect(record.getByText('مجدول', { exact: true })).toBeVisible();
    await noOverflow(page);
    await page.goto(app.url + `/auctions/${auction.id}`);
    await expect(page.getByText('جميع المواعيد بتوقيت ليبيا.', { exact: true })).toBeVisible();
    await expect(page.locator('.auction-countdown')).toContainText('يبدأ بعد');
    await expect(page.getByRole('button', { name: 'تأكيد المزايدة' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
