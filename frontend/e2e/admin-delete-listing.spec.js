import { test, expect, login, noOverflow, openActionTab } from './application.js';
import { readFile } from 'node:fs/promises';

test('admin can delete accepted listings and active auctions from all cars management', async ({
  browser,
  application: app,
}) => {
  const adminContext = await browser.newContext(),
    ownerContext = await browser.newContext();
  let admin = await adminContext.newPage();
  const owner = await ownerContext.newPage();
  try {
    await login(admin, app.url, '0900000011', true);
    await admin.goto(app.url + '/admin/review');
    const review = admin
      .locator('article')
      .filter({ has: admin.getByRole('heading', { name: 'Toyota Camry 2022' }) });
    await review.getByRole('button', { name: 'التفاصيل والصور وأوراق الملكية' }).click();
    await review.getByRole('checkbox').check();
    await review.getByRole('button', { name: 'اعتماد السيارة' }).click();
    await expect(review).toHaveCount(0);
    admin = await openActionTab(
      admin,
      admin.getByRole('link', { name: 'السيارات والحذف', exact: true }).first(),
    );
    await expect(admin).toHaveURL(app.url + '/admin/auctions#approved-listings');
    const listings = admin.getByRole('region', { name: 'جميع السيارات', exact: true });
    const accepted = listings
      .locator('article')
      .filter({ has: admin.getByRole('heading', { name: 'Toyota Camry 2022' }) });
    const active = listings
      .locator('article')
      .filter({ has: admin.getByRole('heading', { name: 'Kia Sportage 2023' }) });
    await expect(active.getByRole('button', { name: 'حذف العرض' })).toBeEnabled();
    await admin.setViewportSize({ width: 390, height: 844 });
    await noOverflow(admin);
    admin.once('dialog', (dialog) => dialog.dismiss());
    await accepted.getByRole('button', { name: 'حذف العرض' }).click();
    await expect(accepted).toBeVisible();
    admin.once('dialog', (dialog) => dialog.accept());
    await accepted.getByRole('button', { name: 'حذف العرض' }).click();
    await expect(accepted).toHaveCount(0);
    await expect(admin.getByRole('status')).toContainText('تم حذف السيارة.');
    admin.once('dialog', (dialog) => dialog.accept());
    await active.getByRole('button', { name: 'حذف العرض' }).click();
    await expect(active).toHaveCount(0);
    expect((await admin.request.get(app.url + '/api/auctions/1')).status()).toBe(404);
    await login(owner, app.url, '0900000012');
    await owner.goto(app.url + '/account/cars');
    await expect(owner.getByRole('heading', { name: 'Toyota Camry 2022' })).toHaveCount(0);
    await expect(owner.getByRole('button', { name: 'حذف العرض' })).toHaveCount(0);
    expect((await owner.request.get(app.url + '/api/cars/1')).status()).toBe(404);
    expect((await owner.request.delete(app.url + '/api/admin/cars/2')).status()).toBe(403);
  } finally {
    await adminContext.close();
    await ownerContext.close();
  }
});

test('admin deletion is visible on car details and own listings while members cannot see it', async ({
  browser,
  application: app,
}) => {
  const adminContext = await browser.newContext(),
    memberContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    member = await memberContext.newPage();
  try {
    await login(admin, app.url, '0900000011', true);
    const submitted = await admin.request.post(app.url + '/api/cars', {
      multipart: {
        vin: '1HGCM82633A006661',
        make: 'Hyundai',
        model: 'Azera',
        year: '2022',
        condition: 'good',
        location: 'طرابلس',
        images: {
          name: 'car.png',
          mimeType: 'image/png',
          buffer: await readFile(new URL('../../backend/fixtures/car.png', import.meta.url)),
        },
      },
    });
    expect(submitted.status()).toBe(201);
    const { car } = await submitted.json();
    expect(
      (
        await admin.request.patch(app.url + `/api/admin/cars/${car.id}/approve`, {
          data: { ownership_verified: true, ownership_revision: 1 },
        })
      ).status(),
    ).toBe(200);
    await admin.goto(app.url + '/account/cars');
    const ownListing = admin.locator('article').filter({ hasText: 'Hyundai Azera 2022' });
    await expect(ownListing.getByRole('button', { name: 'حذف العرض', exact: true })).toBeEnabled();
    await login(member, app.url, '0900000012');
    await member.goto(app.url + `/cars/${car.id}`);
    await expect(member.getByRole('heading', { name: 'Hyundai Azera 2022' })).toBeVisible();
    await expect(member.getByRole('button', { name: 'حذف العرض', exact: true })).toHaveCount(0);
    await expect(member.getByRole('region', { name: 'إجراءات المدير على العرض' })).toHaveCount(0);
    await admin.goto(app.url + '/cars/2');
    await expect(admin.getByRole('button', { name: 'حذف العرض', exact: true })).toBeEnabled();
    await admin.goto(app.url + `/cars/${car.id}`);
    const controls = admin.getByRole('region', { name: 'إجراءات المدير على العرض' });
    await expect(controls.getByRole('button', { name: 'حذف العرض', exact: true })).toBeEnabled();
    await admin.setViewportSize({ width: 390, height: 844 });
    await noOverflow(admin);
    admin.once('dialog', (dialog) => dialog.accept());
    await controls.getByRole('button', { name: 'حذف العرض', exact: true }).click();
    await expect(admin).toHaveURL(app.url + '/admin/auctions#approved-listings');
    expect((await admin.request.get(app.url + `/api/cars/${car.id}`)).status()).toBe(404);
  } finally {
    await adminContext.close();
    await memberContext.close();
  }
});
