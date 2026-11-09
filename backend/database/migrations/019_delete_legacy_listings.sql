-- يسمح بأرشفة إعلان قديم ذي سنة غير صالحة دون تغيير بياناته أو تخفيف فحص العروض الجديدة.
BEGIN;
ALTER TABLE cars DROP CONSTRAINT IF EXISTS ck_cars_year;
ALTER TABLE cars ADD CONSTRAINT ck_cars_year CHECK (
  (status::text='deleted' AND deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
  OR year BETWEEN 1950 AND EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Tripoli')
) NOT VALID;
COMMIT;
