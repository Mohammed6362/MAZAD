import { test, expect, login, noOverflow, openActionTab } from './application.js';

test('unified login hides admin links from members and only the primary can manage permissions', async ({
  browser,
  application: app,
}, testInfo) => {
  const memberContext = await browser.newContext(),
    primaryContext = await browser.newContext();
  const member = await memberContext.newPage();
  let primary = await primaryContext.newPage();
  try {
    await member.goto(app.url + '/login');
    await expect(member.getByRole('navigation', { name: 'نوع الدخول' })).toHaveCount(0);
    await expect(member.getByRole('link', { name: 'المستخدم', exact: true })).toHaveCount(0);
    await expect(member.getByRole('link', { name: 'الإدارة', exact: true })).toHaveCount(0);
    await member.setViewportSize({ width: 390, height: 844 });
    await noOverflow(member);
    await member.screenshot({
      path: testInfo.outputPath('unified-login-mobile.png'),
      fullPage: true,
    });
    await member.goto(app.url);
    await expect(member.locator('a[href^="/admin"]')).toHaveCount(0);
    await login(member, app.url, '0900000012');
    await expect(member.locator('a[href^="/admin"]')).toHaveCount(0);
    const memberId = (await (await member.request.get(app.url + '/api/me')).json()).user.id;
    await primary.goto(app.url + '/login');
    await primary.getByLabel('الهاتف أو البريد الإلكتروني').fill('0900000011');
    await primary.getByLabel('كلمة المرور', { exact: true }).fill('PreviewOnly2026!');
    await primary.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
    await expect(primary).toHaveURL(app.url + '/admin/dashboard');
    primary = await openActionTab(
      primary,
      primary.getByRole('link', { name: 'الحسابات والصلاحيات', exact: true }).first(),
    );
    await expect(primary.getByRole('heading', { name: 'الحسابات والصلاحيات' })).toBeVisible();
    const record = primary
      .locator('article')
      .filter({ has: primary.getByRole('heading', { name: 'بائع المعاينة' }) });
    await record.getByLabel('مساعد إداري (دون منح الصلاحيات)', { exact: true }).check();
    await record.getByRole('button', { name: 'حفظ الصلاحيات', exact: true }).click();
    await expect(primary.getByText('حُفظت الصلاحيات.', { exact: false })).toBeVisible();
    await login(member, app.url, '0900000012', true);
    await expect(member.getByRole('link', { name: 'مراجعة السيارات', exact: true })).toBeVisible();
    await expect(
      member.getByRole('link', { name: 'الحسابات والصلاحيات', exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await member.request.patch(app.url + `/api/admin/users/${memberId}/permissions`, {
          data: { can_list: true, can_bid: true, admin: true },
        })
      ).status(),
    ).toBe(403);
    await member.goto(app.url + '/admin/users');
    await expect(member.getByRole('alert')).toContainText('للمدير الرئيسي فقط');
  } finally {
    await memberContext.close();
    await primaryContext.close();
  }
});
