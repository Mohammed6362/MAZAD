/**
 * كتالوج الماركات وتسمياتها العربية والبدائل؛ يوحد كتابة الماركة ويجهز خيارات البحث.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
// Shared by the listing filter and the seller form. Keep stored values canonical.
const entries = [
  ['Abarth', 'أبارث'],
  ['Acura', 'أكيورا'],
  ['Alfa Romeo', 'ألفا روميو'],
  ['Aston Martin', 'أستون مارتن'],
  ['Audi', 'أودي'],
  ['BAIC', 'بايك'],
  ['Bentley', 'بنتلي'],
  ['Bestune', 'بيستون'],
  ['BMW', 'بي إم دبليو', 'بي ام دبليو'],
  ['Borgward', 'بورجوارد'],
  ['Brilliance', 'بريليانس'],
  ['Bugatti', 'بوغاتي'],
  ['Buick', 'بويك'],
  ['BYD', 'بي واي دي'],
  ['Cadillac', 'كاديلاك'],
  ['Changan', 'شانجان', 'شانغان'],
  ['Chery', 'شيري'],
  ['Chevrolet', 'شيفروليه', 'شفروليه', 'Chevy'],
  ['Chrysler', 'كرايسلر'],
  ['Citroën', 'سيتروين', 'Citroen'],
  ['Cupra', 'كوبرا'],
  ['Dacia', 'داسيا'],
  ['Daewoo', 'دايو'],
  ['Daihatsu', 'دايهاتسو'],
  ['Datsun', 'داتسون'],
  ['Dodge', 'دودج'],
  ['Dongfeng', 'دونغ فينغ'],
  ['DS', 'دي إس'],
  ['Exeed', 'إكسيد'],
  ['FAW', 'فاو'],
  ['Ferrari', 'فيراري'],
  ['Fiat', 'فيات'],
  ['Ford', 'فورد'],
  ['Forthing', 'فورثينغ'],
  ['Foton', 'فوتون'],
  ['GAC', 'جي إيه سي', 'جي ايه سي'],
  ['Geely', 'جيلي'],
  ['Genesis', 'جينيسيس'],
  ['GMC', 'جي إم سي', 'جي ام سي'],
  ['Great Wall', 'جريت وول', 'GWM'],
  ['Haval', 'هافال'],
  ['Honda', 'هوندا'],
  ['Hongqi', 'هونشي'],
  ['Hummer', 'هامر'],
  ['Hyundai', 'هيونداي', 'هونداي'],
  ['Infiniti', 'إنفينيتي', 'انفينيتي'],
  ['Isuzu', 'إيسوزو', 'ايسوزو'],
  ['Iveco', 'إيفيكو', 'ايفيكو'],
  ['JAC', 'جاك'],
  ['Jaecoo', 'جايكو'],
  ['Jaguar', 'جاكوار'],
  ['Jeep', 'جيب'],
  ['Jetour', 'جيتور'],
  ['Jetta', 'جيتا'],
  ['JMC', 'جي إم سي الصينية'],
  ['Kia', 'كيا'],
  ['Lada', 'لادا'],
  ['Lamborghini', 'لامبورغيني'],
  ['Lancia', 'لانسيا'],
  ['Land Rover', 'لاند روفر', 'لاندروفر'],
  ['Leapmotor', 'ليب موتور'],
  ['Lexus', 'لكزس'],
  ['Lincoln', 'لينكولن'],
  ['Lotus', 'لوتس'],
  ['Lucid', 'لوسيد'],
  ['Lynk & Co', 'لينك آند كو', 'Lynk Co'],
  ['Mahindra', 'ماهيندرا'],
  ['Maserati', 'مازيراتي'],
  ['Maxus', 'ماكسوس'],
  ['Mazda', 'مازدا'],
  ['McLaren', 'ماكلارين'],
  ['Mercedes-Benz', 'مرسيدس بنز', 'مرسيدس', 'Mercedes', 'Mercedes Benz'],
  ['Mercury', 'ميركوري'],
  ['MG', 'إم جي', 'ام جي'],
  ['MINI', 'ميني'],
  ['Mitsubishi', 'ميتسوبيشي', 'متسوبيشي'],
  ['Neta', 'نيتا'],
  ['NIO', 'نيو'],
  ['Nissan', 'نيسان'],
  ['Oldsmobile', 'أولدزموبيل'],
  ['Omoda', 'أومودا'],
  ['Opel', 'أوبل', 'اوبل'],
  ['Peugeot', 'بيجو'],
  ['Polestar', 'بولستار'],
  ['Pontiac', 'بونتياك'],
  ['Porsche', 'بورشه'],
  ['Proton', 'بروتون'],
  ['Ram', 'رام'],
  ['Renault', 'رينو'],
  ['Rivian', 'ريفيان'],
  ['Rolls-Royce', 'رولز رويس', 'Rolls Royce'],
  ['Rover', 'روفر'],
  ['Saab', 'ساب'],
  ['Saipa', 'سايبا'],
  ['Samsung', 'سامسونج'],
  ['Saturn', 'ساتورن'],
  ['Scion', 'سايون'],
  ['SEAT', 'سيات'],
  ['Škoda', 'سكودا', 'Skoda'],
  ['Smart', 'سمارت'],
  ['Soueast', 'ساو إيست'],
  ['SsangYong', 'سانج يونج', 'سانغ يونغ', 'KGM'],
  ['Subaru', 'سوبارو'],
  ['Suzuki', 'سوزوكي'],
  ['Tank', 'تانك'],
  ['Tata', 'تاتا'],
  ['Tesla', 'تسلا'],
  ['Toyota', 'تويوتا', 'تيوتا', 'Toyta'],
  ['Vauxhall', 'فوكسهول'],
  ['Volkswagen', 'فولكس فاجن', 'فولكس واجن', 'VW'],
  ['Volvo', 'فولفو'],
  ['Wuling', 'وولينغ'],
  ['XPeng', 'إكس بينغ'],
  ['Zeekr', 'زيكر'],
  ['Zotye', 'زوتي'],
];

export const carMakes = entries.map(([name, arabic, ...aliases]) => ({ name, arabic, aliases }));

// يوحد أحرف الاسم والمسافات قبل استخدامه مفتاحًا لمطابقة الماركات والبدائل.
const key = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const lookup = new Map();
carMakes.forEach(({ name, arabic, aliases }) => {
  [name, arabic, ...aliases].forEach((alias) => lookup.set(key(alias), name));
});

export const normalizeMake = (value) => lookup.get(key(value)) || String(value ?? '').trim();
export const makeLabel = (value) => {
  const name = normalizeMake(value);
  const item = carMakes.find((make) => make.name === name);
  return item ? `${item.name} — ${item.arabic}` : name;
};

// يجهز خيارات الماركات من الكتالوج والقيم الموجودة في الإعلانات بعد توحيد الأسماء وإزالة التكرار.
export function getMakeOptions(values = []) {
  const unique = new Map();
  [...carMakes.map((item) => item.name), ...values].forEach((value) => {
    const name = normalizeMake(value);
    if (name && !unique.has(key(name))) unique.set(key(name), name);
  });
  return [...unique.values()].sort((a, b) => a.localeCompare(b, 'en'));
}

// يجمع الاسم القياسي والاسم العربي والبدائل في نص واحد يسهل البحث فيه.
export function makeSearchText(value) {
  const name = normalizeMake(value);
  const item = carMakes.find((make) => make.name === name);
  return item ? [item.name, item.arabic, ...item.aliases].join(' ') : name;
}
