-- الحد الأعلى يتغير تلقائيًا مع السنة حسب توقيت ليبيا، دون تعديل بيانات قديمة.
BEGIN;
ALTER TABLE cars DROP CONSTRAINT IF EXISTS ck_cars_year;
ALTER TABLE cars ADD CONSTRAINT ck_cars_year
  CHECK(year BETWEEN 1950 AND EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Tripoli')) NOT VALID;
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_year_check;
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS ck_vehicles_year;
ALTER TABLE vehicles ADD CONSTRAINT ck_vehicles_year
  CHECK(year BETWEEN 1950 AND EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Tripoli')) NOT VALID;
-- تبقى السجلات القديمة كما هي إن احتوت سنة مستقبلية؛ القيد يطبق على كل إدخال أو تعديل جديد.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM cars WHERE year > EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Tripoli') OR year < 1950) THEN
    ALTER TABLE cars VALIDATE CONSTRAINT ck_cars_year;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM vehicles WHERE year > EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Tripoli') OR year < 1950) THEN
    ALTER TABLE vehicles VALIDATE CONSTRAINT ck_vehicles_year;
  END IF;
END; $$;
COMMIT;
