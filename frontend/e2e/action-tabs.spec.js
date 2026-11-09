import { test, expect, openActionTab } from './application.js';

test('car, auction and account actions open separate tabs while the homepage and search remain open', async ({
  page,
  application: app,
}) => {
  await page.goto(app.url);
  await page.getByRole('textbox', { name: 'البحث عن سيارة' }).fill('Kia');
  const carLink = page.getByRole('link', { name: 'تفاصيل Kia Sportage 2023', exact: true });
  await expect(carLink).toHaveAttribute('target', '_blank');
  const details = await openActionTab(page, carLink);
  await expect(details).toHaveURL(app.url + '/cars/2');
  await expect(page).toHaveURL(app.url + '/');
  await expect(page.getByRole('textbox', { name: 'البحث عن سيارة' })).toHaveValue('Kia');
  expect(await details.evaluate(() => window.opener)).toBeNull();
  const auction = await openActionTab(
    details,
    details.getByRole('link', { name: 'عرض المزاد والمزايدة' }),
  );
  await expect(auction).toHaveURL(app.url + '/auctions/1');
  await expect(details).toHaveURL(app.url + '/cars/2');
  await auction.close();
  await details.close();
  await page.bringToFront();
  await expect(page.getByRole('textbox', { name: 'البحث عن سيارة' })).toHaveValue('Kia');
  const account = await openActionTab(
    page,
    page
      .getByRole('navigation', { name: 'التنقل الرئيسي' })
      .getByRole('link', { name: 'تسجيل الدخول', exact: true }),
  );
  await account.getByLabel('الهاتف أو البريد الإلكتروني').fill('0900000013');
  await account.getByLabel('كلمة المرور', { exact: true }).fill('PreviewOnly2026!');
  await account.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(account).toHaveURL(app.url + '/account');
  const settings = await openActionTab(
    account,
    account
      .locator('.account-card')
      .filter({ has: account.getByRole('heading', { name: 'إعدادات الحساب', exact: true }) }),
  );
  await expect(settings).toHaveURL(app.url + '/account/settings');
  await expect(account).toHaveURL(app.url + '/account');
  await settings.close();
  await account.close();
  await page.bringToFront();
  const wallet = await openActionTab(
    page,
    page
      .getByRole('navigation', { name: 'التنقل الرئيسي' })
      .getByRole('link', { name: 'محفظتي', exact: true }),
  );
  await expect(
    wallet.getByRole('heading', { name: 'محفظتي التجريبية', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(app.url + '/');
  await wallet.getByRole('button', { name: 'خروج', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'التنقل الرئيسي' })
      .getByRole('link', { name: 'تسجيل الدخول', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'البحث عن سيارة' })).toHaveValue('Kia');
  await wallet.close();
});

test('admin actions open independent authenticated tabs from the sidebar and summary cards', async ({
  page,
  application: app,
}) => {
  await page.goto(app.url);
  const admin = await openActionTab(
    page,
    page
      .getByRole('navigation', { name: 'التنقل الرئيسي' })
      .getByRole('link', { name: 'تسجيل الدخول', exact: true }),
  );
  await admin.getByLabel('الهاتف أو البريد الإلكتروني').fill('0900000011');
  await admin.getByLabel('كلمة المرور', { exact: true }).fill('PreviewOnly2026!');
  await admin.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(admin).toHaveURL(app.url + '/admin/dashboard');
  const review = await openActionTab(
    admin,
    admin.getByRole('link', { name: 'مراجعة السيارات', exact: true }),
  );
  await expect(review.getByRole('heading', { name: 'مراجعة السيارات', exact: true })).toBeVisible();
  await expect(admin).toHaveURL(app.url + '/admin/dashboard');
  const management = await openActionTab(
    review,
    review.getByRole('link', { name: 'السيارات والحذف', exact: true }).first(),
  );
  await expect(
    management.getByRole('heading', { name: 'جميع السيارات', exact: true }),
  ).toBeVisible();
  await expect(review).toHaveURL(app.url + '/admin/review');
  const invoices = await openActionTab(
    admin,
    admin.locator('.stat-card').filter({ hasText: 'فواتير بانتظار السداد' }),
  );
  await expect(invoices).toHaveURL(app.url + '/admin/invoices');
  await expect(page).toHaveURL(app.url + '/');
  await invoices.close();
  await management.close();
  await review.close();
  await admin.close();
});
