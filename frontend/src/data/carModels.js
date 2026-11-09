/**
 * يربط كتالوج الموديلات المشترك بالماركة المختارة، مع تسميات وبدائل عربية وإدخال يدوي.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import catalog from '../../../shared/car-models.json' with { type: 'json' };
import { normalizeMake } from './carMakes.js';
const arabic = {
  Hyundai: {
    Accent: ['أكسنت', 'اكسنت'],
    Azera: ['أزيرا', 'ازيرا'],
    Elantra: ['إلنترا', 'النترا'],
    Sonata: ['سوناتا'],
    Tucson: ['توسان'],
    'Santa Fe': ['سانتا في', 'سانتافي'],
    Creta: ['كريتا'],
    Getz: ['جيتز'],
    Atos: ['أتوس', 'اتوس'],
    Palisade: ['باليسيد'],
    Verna: ['فيرنا'],
    Avante: ['أفانتي', 'افانتي'],
    Grandeur: ['جراندور'],
  },
  Toyota: {
    Camry: ['كامري'],
    Corolla: ['كورولا'],
    Avalon: ['أفالون', 'افالون'],
    Yaris: ['يارس'],
    Hilux: ['هايلوكس'],
    'Land Cruiser': ['لاند كروزر', 'لاندكروزر'],
    'Land Cruiser Prado': ['برادو'],
    RAV4: ['راف فور', 'راف4'],
    'FJ Cruiser': ['اف جي'],
    Fortuner: ['فورتشنر'],
    Prius: ['بريوس'],
    Highlander: ['هايلاندر'],
  },
  Kia: {
    Sportage: ['سبورتاج'],
    Sorento: ['سورينتو'],
    Rio: ['ريو'],
    Optima: ['أوبتيما', 'اوبتيما'],
    Cerato: ['سيراتو'],
    Picanto: ['بيكانتو'],
    Carnival: ['كرنفال'],
    Soul: ['سول'],
    Pride: ['برايد'],
    Morning: ['مورنينج'],
    Cadenza: ['كادينزا'],
  },
  Nissan: {
    Sunny: ['صني'],
    Altima: ['ألتيما', 'التيما'],
    Maxima: ['ماكسيما'],
    Patrol: ['باترول'],
    Sentra: ['سنترا'],
    Tiida: ['تيدا'],
    Qashqai: ['قشقاي'],
    'X-Trail': ['إكس', 'تريل', 'اكس'],
    Juke: ['جوك'],
    Pathfinder: ['باثفايندر'],
    Murano: ['مورانو'],
  },
  Chevrolet: {
    Optra: ['أوبترا', 'اوبترا'],
    Aveo: ['أفيو', 'افيو'],
    Cruze: ['كروز'],
    Captiva: ['كابتيفا'],
    Tahoe: ['تاهو'],
    Malibu: ['ماليبو'],
    Spark: ['سبارك'],
    Silverado: ['سيلفرادو'],
  },
  Ford: {
    Focus: ['فوكس'],
    Fiesta: ['فيستا'],
    Fusion: ['فيوجن'],
    Explorer: ['إكسبلورر', 'اكسبلورر'],
    Expedition: ['إكسبيديشن', 'اكسبيديشن'],
    Edge: ['إيدج', 'ايدج'],
    Escape: ['إسكيب', 'اسكيب'],
    Mustang: ['موستانج'],
  },
  'Mercedes-Benz': {
    'C-Class': ['سي كلاس'],
    'E-Class': ['إي كلاس', 'اي كلاس'],
    'S-Class': ['إس كلاس', 'اس كلاس'],
    'G-Class': ['جي كلاس'],
  },
  BMW: {
    '3 Series': ['الفئة الثالثة'],
    '5 Series': ['الفئة الخامسة'],
    '7 Series': ['الفئة السابعة'],
  },
  Volkswagen: {
    Golf: ['جولف'],
    Passat: ['باسات'],
    Jetta: ['جيتا'],
    Tiguan: ['تيجوان'],
    Touareg: ['طوارق'],
    Polo: ['بولو'],
  },
  Mitsubishi: {
    Lancer: ['لانسر'],
    Pajero: ['باجيرو'],
    Outlander: ['أوتلاندر', 'اوتلاندر'],
    Galant: ['جالانت'],
    L200: ['إل200', 'ال200'],
  },
  Honda: {
    Civic: ['سيفيك'],
    Accord: ['أكورد', 'اكورد'],
    'CR-V': ['سي آر في', 'سي ار في'],
    City: ['سيتي'],
  },
};
// يوحد نص الموديل للمطابقة دون تغيير الاسم الأصلي المعروض في القائمة.
const key = (value) =>
  String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]/g, '');
// يجمع موديلات الماركة المختارة والخيارات الإضافية دون تكرار، مع إبقاء الموديل المدخل يدويًا.
export function getModelsForMake(make, extra = []) {
  const values = [...(catalog[normalizeMake(make)] || []), ...extra].filter(Boolean);
  return [
    ...new Map(
      values.map((value) => [key(normalizeModel(make, value)), normalizeModel(make, value)]),
    ).values(),
  ].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}
// يحاول مطابقة الموديل مع الكتالوج أو بديله العربي؛ يحتفظ بالإدخال اليدوي إذا لم توجد مطابقة.
export function normalizeModel(make, value) {
  const brand = normalizeMake(make);
  const text = String(value ?? '').trim();
  const direct = (catalog[brand] || []).find((name) => key(name) === key(text));
  if (direct) return direct;
  for (const [name, aliases] of Object.entries(arabic[brand] || {}))
    if (key(name) === key(text) || aliases.some((alias) => key(alias) === key(text))) return name;
  return text;
}
export const modelLabel = (make, model) => {
  const label = arabic[normalizeMake(make)]?.[model];
  return label ? `${model} — ${label[0]}` : model;
};
export const modelSearchText = (make, model) =>
  `${model} ${normalizeModel(make, model)} ${(arabic[normalizeMake(make)]?.[normalizeModel(make, model)] || []).join(' ')}`;
