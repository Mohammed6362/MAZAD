/**
 * يتحقق من ربط الموديلات بالماركات وعدم فقد الخيارات المهمة مثل Hyundai Azera وAccent.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('all makes have model choices; Hyundai Azera and Accent stay associated with Hyundai', async () => {
  const { carMakes } = await import('../../frontend/src/data/carMakes.js');
  const { getModelsForMake, normalizeModel, modelSearchText, modelLabel } = await import(
    '../../frontend/src/data/carModels.js'
  );
  const catalog = require('../../shared/car-models.json');
  for (const { name } of carMakes)
    assert(getModelsForMake(name).length > 0, 'Missing models for ' + name);
  const hyundai = getModelsForMake('Hyundai');
  assert(hyundai.includes('Azera'));
  assert(hyundai.includes('Accent'));
  assert(!getModelsForMake('Toyota').includes('Azera'));
  assert.equal(normalizeModel('هيونداي', 'ازيرا'), 'Azera');
  assert.equal(normalizeModel('Hyundai', 'أكسنت'), 'Accent');
  assert.equal(normalizeModel('Mercedes-Benz', 'اي كلاس'), 'E-Class');
  assert.equal(modelLabel('Hyundai', 'Accent'), 'Accent — أكسنت');
  assert(modelSearchText('Hyundai', 'Azera').includes('أزيرا'));
  assert.equal(
    getModelsForMake('Toyota', ['camry', 'Camry']).filter((name) => name === 'Camry').length,
    1,
  );
  assert(getModelsForMake('Toyota', ['Special Import']).includes('Special Import'));
  console.log(
    'Catalog:',
    carMakes.length,
    'makes,',
    Object.values(catalog).reduce((sum, models) => sum + models.length, 0),
    'model choices',
  );
});
