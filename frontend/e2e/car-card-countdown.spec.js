import { test, expect, noOverflow } from './application.js';

test('each car card counts down with server time, changes at auction boundaries and refreshes extensions', async ({
  page,
  application: app,
}) => {
  const response = await page.request.get(app.url + '/api/cars');
  const realData = await response.json();
  expect(Number.isFinite(Date.parse(realData.cars[0].server_time))).toBe(true);
  const now = Date.now();
  const browserTime = now + 86400000;
  await page.clock.install({ time: new Date(browserTime) });
  await page.clock.pauseAt(new Date(browserTime));
  let serverTime = now;
  let activeEnd = now + 8000;
  await page.route('**/api/cars', (route) =>
    route.fulfill({
      json: {
        success: true,
        cars: [
          {
            id: 1,
            model: 'Active',
            auction_status: 'active',
            start_time: new Date(now - 10000),
            end_time: new Date(activeEnd),
          },
          {
            id: 2,
            model: 'Scheduled',
            auction_status: 'scheduled',
            start_time: new Date(now + 4000),
            end_time: new Date(now + 10000),
          },
          { id: 3, model: 'Unscheduled', auction_status: null },
          {
            id: 4,
            model: 'Cancelled',
            auction_status: 'cancelled',
            start_time: new Date(now - 10000),
            end_time: new Date(now + 60000),
          },
          {
            id: 5,
            model: 'Closed',
            auction_status: 'closed',
            start_time: new Date(now - 10000),
            end_time: new Date(now - 1000),
          },
        ].map((car) => ({
          ...car,
          make: 'Kia',
          year: 2023,
          status: 'approved',
          server_time: new Date(serverTime),
          image_url: '/uploads/cars/fixture.png',
        })),
      },
    }),
  );
  await page.goto(app.url);
  const active = page
    .locator('.car-card')
    .filter({ has: page.getByRole('heading', { name: 'Kia Active 2023', exact: true }) });
  const scheduled = page
    .locator('.car-card')
    .filter({ has: page.getByRole('heading', { name: 'Kia Scheduled 2023', exact: true }) });
  await expect(active.getByRole('timer')).toContainText('متبقي على نهاية المزاد');
  await expect(active.getByRole('timer').locator('b')).toHaveText('00:00:08');
  await expect(scheduled.getByRole('timer')).toContainText('يبدأ المزاد بعد');
  await page.clock.runFor(1000);
  await expect(active.getByRole('timer').locator('b')).toHaveText('00:00:07');
  await page.clock.runFor(3500);
  await expect(scheduled.getByRole('timer')).toContainText('متبقي على نهاية المزاد');
  await page.clock.runFor(6000);
  await expect(active.getByRole('timer')).toHaveText('انتهى المزاد');
  await expect(scheduled.getByRole('timer')).toHaveText('انتهى المزاد');
  await expect(
    page
      .locator('.car-card')
      .filter({ hasText: 'Kia Unscheduled 2023' })
      .locator('.car-card-timer'),
  ).toContainText('بانتظار تحديد موعد المزاد');
  await expect(
    page.locator('.car-card').filter({ hasText: 'Kia Cancelled 2023' }).locator('.car-card-timer'),
  ).toContainText('المزاد ملغي');
  await expect(
    page.locator('.car-card').filter({ hasText: 'Kia Closed 2023' }).locator('.car-card-timer'),
  ).toContainText('انتهى المزاد');
  serverTime = now + 10500;
  activeEnd = now + 40000;
  const refreshed = page.waitForResponse((res) => res.url() === app.url + '/api/cars');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  await expect(active.getByRole('timer')).toContainText('متبقي على نهاية المزاد');
  await expect(active.getByRole('timer').locator('b')).toHaveText('00:00:30');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
  }
});
