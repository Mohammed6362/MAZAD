/**
 * تجارب الواجهة لدورة البيع والخصوصية وأحجام الشاشة والمظهر وانقطاع الاتصال والاعتراض وانتهاء المهلة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { test, expect, login, noOverflow, bidAndClose, openActionTab } from './application.js';
import { fileURLToPath } from 'node:url';
const fixture = fileURLToPath(new URL('../../backend/fixtures/car.png', import.meta.url));

test('visitors can view approved auction ownership papers on desktop and mobile', async ({
  browser,
  application: app,
}, testInfo) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(app.url + '/auctions/1');
    const papers = page.getByRole('region', { name: 'أوراق ملكية السيارة' });
    await expect(papers.getByRole('heading', { name: 'أوراق ملكية السيارة' })).toBeVisible();
    const image = papers.getByRole('img', { name: 'ورقة ملكية السيارة 1' });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    const imageUrl = await papers.getByRole('link').getAttribute('href');
    expect((await page.request.get(app.url + imageUrl)).status()).toBe(200);
    for (const width of [320, 390, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath('mobile-auction-ownership.png'),
      fullPage: true,
    });
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      papers.getByRole('link').click(),
    ]);
    await popup.waitForLoadState();
    await expect(popup.getByRole('img')).toBeVisible();
    await popup.close();
    await page.goto(app.url + '/cars/2');
    await expect(
      page.getByRole('region', { name: 'أوراق ملكية السيارة' }).getByRole('img'),
    ).toBeVisible();
    await noOverflow(page);
    expect((await page.request.get(app.url + '/api/admin/users/2/passport')).status()).toBe(401);
  } finally {
    await context.close();
  }
});

test('responsive upload, private admin review, themes and connection recovery', async ({
  browser,
  application: app,
}, testInfo) => {
  test.setTimeout(120000);
  const ownerContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const page = await ownerContext.newPage();
  const admin = await adminContext.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  admin.on('pageerror', (error) => errors.push(error.message));
  try {
    await login(page, app.url, '0900000012');
    await page.goto(app.url + '/account/cars/new');
    await page.locator('[name=make]').fill('Hyundai');
    await page.locator('[name=model]').fill('Azera');
    await expect(page.locator('#car-models option[value="Accent"]')).toHaveCount(1);
    await page.locator('[name=make]').fill('Toyota');
    await expect(page.locator('[name=model]')).toHaveValue('');
    await expect(page.locator('#car-models option[value="Azera"]')).toHaveCount(0);
    await page.locator('[name=make]').fill('Hyundai');
    await page.locator('[name=model]').fill('Azera');
    await page.locator('[name=year]').fill('2022');
    await page.locator('[name=vin]').fill('1HGCM82633A004359');
    await page.locator('[name=location]').selectOption('طرابلس');
    await page.locator('input[type=file]').nth(0).setInputFiles(fixture);
    await page.locator('input[type=file]').nth(1).setInputFiles(fixture);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await page.getByRole('combobox', { name: 'مظهر الموقع' }).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
    await page.screenshot({ path: testInfo.outputPath('mobile-upload-dark.png'), fullPage: true });
    const posted = page.waitForResponse(
      (response) => response.url().endsWith('/api/cars') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'إرسال للمراجعة' }).click();
    const created = await posted;
    expect(created.status()).toBe(201);
    const { car } = await created.json();
    await expect(
      page.getByText('وصل طلبك بنجاح، وهو الآن قيد المراجعة.', { exact: false }),
    ).toBeVisible();
    await login(admin, app.url, '0900000011', true);
    await admin.goto(app.url + '/admin/review');
    const article = admin
      .locator('article')
      .filter({ has: admin.getByRole('heading', { name: 'Hyundai Azera 2022' }) });
    await expect(article.getByRole('button', { name: 'اعتماد السيارة' })).toBeDisabled();
    await article.getByRole('button', { name: 'التفاصيل والصور وأوراق الملكية' }).click();
    const image = article.locator('.ownership-gallery img');
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    const docUrl = await article.locator('.ownership-gallery a').getAttribute('href');
    expect((await page.request.get(app.url + docUrl)).status()).toBe(403);
    expect((await page.request.get(app.url + `/api/admin/cars/${car.id}/ownership`)).status()).toBe(
      403,
    );
    await article.getByRole('checkbox').check();
    await article.getByRole('button', { name: 'اعتماد السيارة' }).click();
    await expect(article).toHaveCount(0);
    const publicCar = await (await page.request.get(app.url + `/api/cars/${car.id}`)).json();
    expect(JSON.stringify(publicCar)).not.toContain('ownership');
    for (const width of [320, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(app.url + '/account/wallet');
      await expect(page.getByRole('heading', { name: 'محفظتي التجريبية' })).toBeVisible();
      await noOverflow(page);
      await admin.setViewportSize({ width, height: 900 });
      await admin.goto(app.url + '/admin/review');
      await expect(admin.getByRole('heading', { name: 'مراجعة السيارات' })).toBeVisible();
      await noOverflow(admin);
    }
    await page.setViewportSize({ width: 320, height: 900 });
    for (const route of [
      '/',
      '/account',
      '/account/cars',
      '/account/cars/new',
      '/account/bids',
      '/account/invoices',
      '/account/settings',
      '/account/notifications',
      '/cars/2',
      '/auctions/1',
      '/auction-rules',
    ]) {
      await page.goto(app.url + route);
      await expect(page.locator('.loading-box')).toHaveCount(0);
      await expect(page.locator('h1').first()).toBeVisible();
      await noOverflow(page);
    }
    await admin.setViewportSize({ width: 320, height: 900 });
    for (const route of [
      '/admin/dashboard',
      '/admin/auctions',
      '/admin/invoices',
      '/admin/users',
    ]) {
      await admin.goto(app.url + route);
      await expect(admin.locator('.loading-box')).toHaveCount(0);
      await expect(admin.locator('h1').first()).toBeVisible();
      await noOverflow(admin);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(app.url + '/account/wallet');
    await expect(page.getByRole('heading', { name: 'محفظتي التجريبية' })).toBeVisible();
    await page.getByRole('combobox', { name: 'مظهر الموقع' }).selectOption('light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
    await page.getByRole('combobox', { name: 'مظهر الموقع' }).selectOption('system');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
    await ownerContext.setOffline(true);
    // Firefox can retain loopback access while offline. Abort the API request as well
    // so each engine exercises the same transport failure and recovery path.
    await page.route('**/api/account/wallet', (route) => route.abort('internetdisconnected'));
    await page.getByRole('button', { name: 'تحديث', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('تعذّر الاتصال');
    await ownerContext.setOffline(false);
    await page.unroute('**/api/account/wallet');
    const recovered = page.waitForResponse((response) =>
      response.url().endsWith('/api/account/wallet'),
    );
    await page.getByRole('button', { name: 'تحديث', exact: true }).click();
    expect((await recovered).status()).toBe(200);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await ownerContext.close();
    await adminContext.close();
  }
});

test('buyer escrow payment, receipt and resale preserve the vehicle and original invoice', async ({
  browser,
  application: app,
}, testInfo) => {
  const buyerContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  let buyer = await buyerContext.newPage();
  const owner = await ownerContext.newPage();
  buyer.on('dialog', (dialog) => dialog.accept());
  owner.on('dialog', (dialog) => dialog.accept());
  try {
    await login(buyer, app.url, '0900000013');
    await bidAndClose(buyer, app);
    await buyer.getByRole('button', { name: 'دفع تجريبي من المحفظة' }).click();
    await expect(buyer.getByText('رصيد محفوظ لضمان المعاملة', { exact: true })).toBeVisible();
    await login(owner, app.url, '0900000012');
    await owner.goto(app.url + '/account/invoices');
    await owner.getByRole('button', { name: 'تسجيل تسليم السيارة' }).click();
    await expect(
      owner.getByText('سجّل البائع التسليم — بانتظار تأكيد المشتري', { exact: true }),
    ).toBeVisible();
    await buyer.getByRole('button', { name: 'تحديث الفواتير' }).click();
    await buyer.getByRole('button', { name: 'تأكيد الاستلام وإتمام البيع' }).click();
    await expect(buyer.getByText('اكتملت المعاملة', { exact: true })).toBeVisible();
    await owner.goto(app.url + '/account/wallet');
    const wallet = await (await owner.request.get(app.url + '/api/account/wallet')).json();
    expect(wallet.wallet.balance).toBe('20000.000');
    expect(wallet.wallet.pending_proceeds).toBe('0.000');
    await buyer.getByRole('button', { name: 'عرض / تحديث سجل المعاملة' }).click();
    await expect(
      buyer.getByText('أكد المشتري استلام السيارة واكتمال المعاملة.', { exact: true }),
    ).toBeVisible();
    await buyer.setViewportSize({ width: 390, height: 844 });
    await noOverflow(buyer);
    await buyer.screenshot({
      path: testInfo.outputPath('mobile-completed-invoice.png'),
      fullPage: true,
    });
    await buyer.goto(app.url + '/account/cars');
    buyer = await openActionTab(
      buyer,
      buyer.getByRole('link', { name: 'إعادة عرض السيارة', exact: true }),
    );
    await expect(buyer.getByRole('heading', { name: 'إعادة عرض السيارة للبيع' })).toBeVisible();
    await expect(buyer.locator('[name=vin]')).toHaveValue('1HGCM82633A004352');
    await expect(buyer.locator('[name=make]')).toHaveValue('Kia');
    await expect(buyer.locator('[name=model]')).toHaveValue('Sportage');
    await expect(buyer.locator('.editable-image')).toHaveCount(0);
    await buyer.locator('[name=mileage_km]').fill('45000');
    await buyer.locator('[name=location]').selectOption('طرابلس');
    await buyer.locator('input[type=file]').nth(0).setInputFiles(fixture);
    await buyer.locator('input[type=file]').nth(1).setInputFiles(fixture);
    await noOverflow(buyer);
    const posted = buyer.waitForResponse(
      (response) => response.url().endsWith('/api/cars') && response.request().method() === 'POST',
    );
    await buyer.getByRole('button', { name: 'إرسال للمراجعة' }).click();
    const created = await posted;
    expect(created.status()).toBe(201);
    const { car: resale } = await created.json();
    expect(String(resale.id)).not.toBe('2');
    await buyer.goto(app.url + '/account/cars');
    await expect(buyer.getByText('يوجد طلب أو إعلان قائم لهذه السيارة.')).toBeVisible();
    await noOverflow(buyer);
    const adminContext = await browser.newContext();
    try {
      const admin = await adminContext.newPage();
      await login(admin, app.url, '0900000011', true);
      await admin.goto(app.url + '/admin/review');
      const record = admin
        .locator('article')
        .filter({ has: admin.getByRole('heading', { name: 'Kia Sportage 2023' }) });
      await record.getByRole('button', { name: 'التفاصيل والصور وأوراق الملكية' }).click();
      await expect(record.getByText('عدد المبيعات المكتملة السابقة: 1')).toBeVisible();
      await expect(
        record.getByRole('heading', { name: 'سجل الملكية والمبيعات السابقة' }),
      ).toBeVisible();
      await record.getByRole('checkbox').check();
      await record.getByRole('button', { name: 'اعتماد السيارة' }).click();
      await expect(record).toHaveCount(0);
    } finally {
      await adminContext.close();
    }
    const original = await (await buyer.request.get(app.url + '/api/invoices')).json();
    expect(original.invoices).toHaveLength(1);
    expect(original.invoices[0].sale_status).toBe('completed');
    expect(
      (await (await buyer.request.get(app.url + '/api/cars/2')).json()).car.mileage_km,
    ).toBeNull();
  } finally {
    await buyerContext.close();
    await ownerContext.close();
  }
});

test('dispute freezes settlement and admin cancellation refunds escrow', async ({
  browser,
  application: app,
}) => {
  const buyerContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const buyer = await buyerContext.newPage();
  const admin = await adminContext.newPage();
  buyer.on('dialog', (dialog) => dialog.accept());
  try {
    await login(buyer, app.url, '0900000013');
    await bidAndClose(buyer, app);
    await buyer.getByRole('button', { name: 'دفع تجريبي من المحفظة' }).click();
    await buyer.getByRole('button', { name: 'فتح اعتراض للإدارة' }).click();
    await buyer.getByLabel('سبب الاعتراض').fill('السيارة لا تطابق الوصف وأطلب مراجعة الإدارة');
    await buyer.getByRole('button', { name: 'إرسال الاعتراض' }).click();
    await expect(buyer.getByText('اعتراض قيد المعالجة', { exact: true })).toBeVisible();
    await login(admin, app.url, '0900000011', true);
    await admin.goto(app.url + '/admin/invoices');
    await expect(admin.getByText('اعتراض قيد المعالجة', { exact: true })).toBeVisible();
    await admin.getByRole('button', { name: 'إلغاء المعاملة ومعالجة الرصيد' }).click();
    await admin
      .getByLabel('سبب القرار (يظهر للطرفين)')
      .fill('تم التحقق من الاعتراض وإلغاء المعاملة وإرجاع الرصيد');
    await admin.getByRole('button', { name: 'تأكيد القرار' }).click();
    await expect(admin.getByText('أُعيد الرصيد للمشتري', { exact: true })).toBeVisible();
    await buyer.getByRole('button', { name: 'تحديث الفواتير' }).click();
    await expect(buyer.getByText('ألغتها الإدارة', { exact: true })).toBeVisible();
    const wallet = await (await buyer.request.get(app.url + '/api/account/wallet')).json();
    expect(wallet.wallet.balance).toBe('50000.000');
    expect(wallet.wallet.escrowed_payments).toBe('0.000');
    expect(wallet.transactions.filter((row) => row.kind === 'auction_refund')).toHaveLength(1);
  } finally {
    await buyerContext.close();
    await adminContext.close();
  }
});

test('expired winner cannot pay and the hold returns to available balance', async ({
  browser,
  application: app,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, app.url, '0900000013');
    await bidAndClose(page, app);
    await app.command('expire');
    await page.getByRole('button', { name: 'تحديث الفواتير' }).click();
    await expect(page.getByText('انتهت مهلة السداد', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'دفع تجريبي من المحفظة' })).toHaveCount(0);
    const wallet = await (await page.request.get(app.url + '/api/account/wallet')).json();
    expect(wallet.wallet.available).toBe('50000.000');
    expect(wallet.wallet.reserved).toBe('0.000');
  } finally {
    await context.close();
  }
});
