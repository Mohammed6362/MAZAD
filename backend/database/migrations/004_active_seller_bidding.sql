-- تشديد قبول المزايدات على سيارة معتمدة لمالك نشط، مع منع مزايدة البائع على سيارته.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
BEGIN;
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
          AND r.role = 'buyer'
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
