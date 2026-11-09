/**
 * تنظيف بيانات السيارة وتوحيد الماركة والموديل والتحقق من الهيكل والسنة والمسافة والحالة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const models = require('../../../shared/car-models.json');
const { trimField, optionalInteger } = require('./http');
module.exports = function parseCarInput(body = {}) {
  const currentYear = Number(
    new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Africa/Tripoli' }).format(
      new Date(),
    ),
  );
  const vin = trimField(body.vin, 100).toUpperCase();
  const enteredMake = trimField(body.make, 60);
  const make =
    Object.keys(models).find((name) => name.toLowerCase() === enteredMake.toLowerCase()) ||
    enteredMake;
  const enteredModel = trimField(body.model, 60);
  const model =
    (models[make] || []).find((name) => name.toLowerCase() === enteredModel.toLowerCase()) ||
    enteredModel;
  const location = trimField(body.location, 100);
  const year = optionalInteger(body.year);
  const mileage = optionalInteger(body.mileage_km);
  const transmission = body.transmission || null;
  const condition = body.condition;
  const notes = trimField(body.defects_notes, 5000) || null;
  const invalidMessage = !/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)
    ? 'رقم الهيكل يجب أن يتكون من 11 إلى 17 خانة صالحة.'
    : !make || !model || !location
      ? 'أكمل الماركة والموديل والموقع.'
      : !Number.isInteger(year) || year < 1950 || year > currentYear
        ? `أدخل سنة صنع بين 1950 و${currentYear}.`
        : Number.isNaN(mileage) || (mileage !== null && (mileage < 0 || mileage > 2147483647))
          ? 'المسافة المقطوعة غير صالحة.'
          : transmission && !['manual', 'automatic'].includes(transmission)
            ? 'اختر ناقل حركة صالحًا.'
            : !['excellent', 'good', 'fair', 'needs_repair'].includes(condition)
              ? 'اختر حالة السيارة من الخيارات المتاحة.'
              : null;

  return {
    vin,
    make,
    model,
    location,
    year,
    mileage,
    transmission,
    condition,
    notes,
    invalidMessage,
  };
};
