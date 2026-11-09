-- هوية واحدة للمركبة، وإعلان مستقل لكل إعادة بيع دون تغيير سجل الإعلانات السابقة.
BEGIN;
CREATE TABLE IF NOT EXISTS vehicles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vin VARCHAR(17) NOT NULL UNIQUE CHECK(vin ~ '^[A-HJ-NPR-Z0-9]{11,17}$'),
  make VARCHAR(60) NOT NULL,
  model VARCHAR(60) NOT NULL,
  year SMALLINT NOT NULL CHECK(year BETWEEN 1950 AND 2100),
  current_owner_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE RESTRICT;
INSERT INTO vehicles(vin,make,model,year,current_owner_id)
SELECT DISTINCT ON(c.vin) c.vin,c.make,c.model,c.year,
  COALESCE((SELECT i.buyer_id FROM invoices i JOIN auctions a ON a.id=i.auction_id
    WHERE a.car_id=c.id AND i.sale_status='completed' ORDER BY i.id DESC LIMIT 1),c.seller_id)
FROM cars c WHERE c.vehicle_id IS NULL ORDER BY c.vin,c.id DESC
ON CONFLICT(vin) DO NOTHING;
UPDATE cars c SET vehicle_id=v.id FROM vehicles v WHERE v.vin=c.vin AND c.vehicle_id IS NULL;
ALTER TABLE cars ALTER COLUMN vehicle_id SET NOT NULL;
DROP INDEX IF EXISTS ux_cars_vin;
CREATE INDEX IF NOT EXISTS ix_cars_vehicle ON cars(vehicle_id,id);
-- طلب أو إعلان قائم واحد للمركبة، مهما اختلف حساب العارض.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cars_one_live_vehicle ON cars(vehicle_id)
  WHERE status IN ('pending_review','approved');
CREATE TABLE IF NOT EXISTS vehicle_ownership_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  from_owner_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  to_owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  car_id BIGINT NOT NULL REFERENCES cars(id) ON DELETE RESTRICT,
  invoice_id BIGINT UNIQUE REFERENCES invoices(id) ON DELETE RESTRICT,
  verified_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK(source IN ('legacy','document_review','completed_sale')),
  event_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_vehicle_ownership_history ON vehicle_ownership_history(vehicle_id,id);
DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_cars_link_vehicle' AND tgrelid='cars'::regclass) THEN
INSERT INTO vehicle_ownership_history(vehicle_id,to_owner_id,car_id,source,event_key,created_at)
SELECT vehicle_id,seller_id,id,'legacy','legacy:'||id,created_at FROM cars
ON CONFLICT(event_key) DO NOTHING;
INSERT INTO vehicle_ownership_history(vehicle_id,from_owner_id,to_owner_id,car_id,invoice_id,source,event_key,created_at)
SELECT c.vehicle_id,i.seller_id,i.buyer_id,c.id,i.id,'completed_sale','sale:'||i.id,
  COALESCE(i.completed_at,i.paid_at,i.issued_at)
FROM invoices i JOIN auctions a ON a.id=i.auction_id JOIN cars c ON c.id=a.car_id
WHERE i.sale_status='completed' ON CONFLICT(event_key) DO NOTHING;
END IF;
END; $$;
-- يشمل أدوات الاستيراد القديمة أيضًا؛ رقم الهيكل المنسوخ في الإعلان يرتبط دائمًا بهوية المركبة.
CREATE OR REPLACE FUNCTION fn_link_listing_vehicle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.vin IS DISTINCT FROM OLD.vin
     AND EXISTS(SELECT 1 FROM auctions WHERE car_id=OLD.id) THEN
    RAISE EXCEPTION 'Cannot change VIN after an auction';
  END IF;
  INSERT INTO vehicles(vin,make,model,year) VALUES(NEW.vin,NEW.make,NEW.model,NEW.year)
    ON CONFLICT(vin) DO UPDATE SET vin=EXCLUDED.vin RETURNING id INTO NEW.vehicle_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_cars_link_vehicle ON cars;
CREATE TRIGGER trg_cars_link_vehicle BEFORE INSERT OR UPDATE OF vin,vehicle_id ON cars
  FOR EACH ROW EXECUTE FUNCTION fn_link_listing_vehicle();
DROP TRIGGER IF EXISTS trg_vehicle_ownership_immutable ON vehicle_ownership_history;
CREATE TRIGGER trg_vehicle_ownership_immutable BEFORE UPDATE OR DELETE ON vehicle_ownership_history
  FOR EACH ROW EXECUTE FUNCTION fn_wallet_ledger_immutable();
COMMIT;
