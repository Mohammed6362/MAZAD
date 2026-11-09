import { test, expect, login, noOverflow, bidAndClose, openActionTab } from './application.js';

test('rejected listings can be corrected and sold cars leave public pages while sale records remain', async ({
  browser,
  application: app,
}, testInfo) => {
  const ownerContext = await browser.newContext(),
    buyerContext = await browser.newContext(),
    adminContext = await browser.newContext(),
    guestContext = await browser.newContext();
  let owner = await ownerContext.newPage();
  const buyer = await buyerContext.newPage(),
    admin = await adminContext.newPage();
  const showroom = await guestContext.newPage(),
    details = await guestContext.newPage(),
    auction = await guestContext.newPage();
  try {
    await login(admin, app.url, '0900000011', true);
    await admin.goto(app.url + '/admin/review');
    const review = admin
      .locator('article')
      .filter({ has: admin.getByRole('heading', { name: 'Toyota Camry 2022' }) });
    await review.getByRole('button', { name: 'التفاصيل والصور وأوراق الملكية' }).click();
    await review
      .getByLabel('ملاحظات المراجعة / سبب الرفض')
      .fill('يرجى تحديث المسافة المقطوعة وموقع السيارة');
    await review.getByRole('button', { name: 'رفض الطلب', exact: true }).click();
    await expect(review).toHaveCount(0);
    await login(owner, app.url, '0900000012');
    await owner.goto(app.url + '/account/cars');
    await expect(owner.getByText('سبب الرفض:', { exact: false })).toContainText('تحديث المسافة');
    owner = await openActionTab(
      owner,
      owner.getByRole('link', { name: 'تعديل العرض وإعادة إرساله', exact: true }),
    );
    await expect(owner.getByRole('heading', { name: 'تعديل العرض المرفوض' })).toBeVisible();
    await expect(owner.getByRole('alert')).toContainText('سبب رفض الإدارة');
    await owner.locator('[name=mileage_km]').fill('65000');
    await owner.locator('[name=location]').selectOption('بنغازي');
    await owner.setViewportSize({ width: 390, height: 844 });
    await noOverflow(owner);
    await owner.screenshot({
      path: testInfo.outputPath('rejected-listing-edit.png'),
      fullPage: true,
    });
    await owner.getByRole('button', { name: 'إعادة إرسال العرض للمراجعة', exact: true }).click();
    await expect(owner).toHaveURL(app.url + '/account/cars');
    await expect(owner.getByText('قيد المراجعة', { exact: true })).toBeVisible();
    await expect(
      owner.getByRole('link', { name: 'تعديل العرض وإعادة إرساله', exact: true }),
    ).toHaveCount(0);
    await admin.reload();
    await expect(review).toContainText('65000');
    await expect(review).toContainText('بنغازي');

    await showroom.goto(app.url);
    await expect(showroom.locator('a[href="/cars/2"]').first()).toBeVisible();
    await details.goto(app.url + '/cars/2');
    await expect(details.getByRole('heading', { name: 'Kia Sportage 2023' })).toBeVisible();
    await auction.goto(app.url + '/auctions/1');
    await expect(auction.getByRole('heading', { name: 'Kia Sportage 2023' })).toBeVisible();
    const docs = await (await showroom.request.get(app.url + '/api/auctions/1/ownership')).json();
    await login(buyer, app.url, '0900000013');
    await bidAndClose(buyer, app);
    await showroom.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(showroom.locator('a[href="/cars/2"]')).toHaveCount(0);
    await details.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(details.getByRole('alert')).toContainText('السيارة غير متاحة');
    // Auction pages refresh automatically even while a visitor keeps the old page open.
    await auction.bringToFront();
    await expect(auction.getByRole('alert')).toContainText('المزاد غير موجود');
    for (const url of [
      '/api/cars/2',
      '/api/auctions/1',
      '/api/auctions/1/bids',
      '/api/auctions/1/ownership',
      docs.documents[0].url,
    ])
      expect((await showroom.request.get(app.url + url)).status()).toBe(404);
    expect((await buyer.request.get(app.url + '/api/cars/2')).status()).toBe(200);
    expect((await owner.request.get(app.url + '/api/cars/2')).status()).toBe(200);
    await owner.goto(app.url + '/account/cars');
    await expect(owner.getByText('تم البيع', { exact: true })).toBeVisible();
    await expect(owner.getByRole('link', { name: 'سجل المزاد المباع' })).toBeVisible();
    expect(
      (await (await buyer.request.get(app.url + '/api/invoices')).json()).invoices,
    ).toHaveLength(1);
  } finally {
    await ownerContext.close();
    await buyerContext.close();
    await adminContext.close();
    await guestContext.close();
  }
});
