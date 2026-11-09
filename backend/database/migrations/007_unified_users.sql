-- دمج صلاحيات المشتري والبائع في user وتحديث الجلسات ودوال التحقق دون تغيير معرفات البيانات.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
BEGIN;
-- Preserve identities, vehicles, bids and administrator grants; merge capabilities only.
INSERT INTO user_roles(user_id,role)
  SELECT DISTINCT user_id,'user'::user_role FROM user_roles WHERE role::text IN ('buyer','seller')
  ON CONFLICT DO NOTHING;
DELETE FROM user_roles WHERE role::text IN ('buyer','seller');
UPDATE user_sessions SET sess=jsonb_set(sess,'{role}','"user"'::jsonb)
  WHERE sess->>'role' IN ('buyer','seller');

-- يسند الدور الافتراضي للحساب الجديد؛ التحديث 007 يستقر على user بدل أدوار المشتري والبائع القديمة.

CREATE OR REPLACE FUNCTION fn_default_roles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO user_roles (user_id, role)
    VALUES (NEW.id, 'user');

    RETURN NEW;
END;
$$;

-- يرفض ربط السيارة بحساب غير نشط أو لا يملك الدور المطلوب في إصدار المخطط المعني.

CREATE OR REPLACE FUNCTION fn_validate_car_seller()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM users u
        JOIN user_roles r ON r.user_id = u.id
        WHERE u.id = NEW.seller_id
          AND u.status = 'active'
          AND r.role = 'user'
    ) THEN
        RAISE EXCEPTION 'Seller account is inactive or lacks seller role';
    END IF;

    RETURN NEW;
END;
$$;

-- يفحص شروط المزاد وصاحب العرض والحد الأدنى تحت قفل؛ التعريف النهائي للمحفظة والتمديد في التحديث 009.

CREATE OR REPLACE FUNCTION fn_validate_bid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    a auctions%ROWTYPE;
    v_seller BIGINT;
    v_min NUMERIC(14,3);
BEGIN
    SELECT * INTO a
    FROM auctions
    WHERE id = NEW.auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Auction not found';
    END IF;

    IF a.status NOT IN ('scheduled', 'active')
       OR now() < a.start_time
       OR now() >= a.end_time THEN
        RAISE EXCEPTION 'Auction is not open for bidding';
    END IF;

    SELECT c.seller_id INTO v_seller
    FROM cars c JOIN users seller ON seller.id=c.seller_id AND seller.status='active'
    WHERE c.id = a.car_id
      AND c.status = 'approved';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Car is not approved for auction';
    END IF;

    IF v_seller = NEW.bidder_id THEN
        RAISE EXCEPTION 'Seller cannot bid on their own car';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM users u
        JOIN user_roles r ON r.user_id = u.id
        WHERE u.id = NEW.bidder_id
          AND u.status = 'active'
          AND r.role = 'user'
    ) THEN
        RAISE EXCEPTION 'Bidder account is inactive or lacks buyer role';
    END IF;

    v_min := CASE
        WHEN a.bid_count = 0 THEN a.starting_price
        ELSE a.current_price + a.min_increment
    END;

    IF NEW.amount < v_min THEN
        RAISE EXCEPTION 'Minimum bid amount is %', v_min;
    END IF;

    NEW.placed_at := now();

    UPDATE auctions
    SET current_price = NEW.amount,
        bid_count = bid_count + 1,
        status = 'active'
    WHERE id = a.id;

    RETURN NEW;
END;
$$;
COMMIT;
