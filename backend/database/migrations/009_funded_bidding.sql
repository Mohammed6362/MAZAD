-- قواعد المزايدة الممولة الذرية: قفل المزاد والمحافظ وفحص المتاح وتبديل الحجز وإعادة فحص الوقت والتمديد.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
BEGIN;
-- يفحص شروط المزاد وصاحب العرض والحد الأدنى تحت قفل؛ التعريف النهائي للمحفظة والتمديد في التحديث 009.
CREATE OR REPLACE FUNCTION fn_validate_bid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  a auctions%ROWTYPE;
  v_seller BIGINT;
  v_min NUMERIC(14,3);
  v_previous BIGINT;
  v_available NUMERIC(14,3);
  v_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO a FROM auctions WHERE id=NEW.auction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Auction not found'; END IF;
  v_now:=clock_timestamp();
  IF a.status NOT IN ('scheduled','active') OR v_now<a.start_time OR v_now>=a.end_time THEN
    RAISE EXCEPTION 'Auction is not open for bidding';
  END IF;
  SELECT c.seller_id INTO v_seller FROM cars c JOIN users u ON u.id=c.seller_id
    WHERE c.id=a.car_id AND c.status='approved' AND u.status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Car is not approved for auction'; END IF;
  IF v_seller=NEW.bidder_id THEN RAISE EXCEPTION 'Seller cannot bid on their own car'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.id=NEW.bidder_id AND u.status='active' AND r.role::text='user') THEN
    RAISE EXCEPTION 'Bidder account is inactive or lacks user role';
  END IF;
  v_min:=CASE WHEN a.bid_count=0 THEN a.starting_price ELSE a.current_price+a.min_increment END;
  IF NEW.amount<v_min THEN RAISE EXCEPTION 'Minimum bid amount is %',v_min; END IF;

  IF a.payment_mode='demo_wallet' THEN
    SELECT user_id INTO v_previous FROM wallet_holds WHERE auction_id=a.id;
    -- All wallet-changing operations lock wallet rows by user ID to avoid cross-auction deadlocks.
    PERFORM user_id FROM wallets WHERE user_id IN (NEW.bidder_id,v_previous) ORDER BY user_id FOR UPDATE;
    SELECT w.balance-COALESCE((SELECT SUM(h.amount) FROM wallet_holds h WHERE h.user_id=w.user_id AND h.auction_id<>a.id),0)
      INTO v_available FROM wallets w WHERE w.user_id=NEW.bidder_id;
    IF v_available IS NULL OR v_available<NEW.amount THEN RAISE EXCEPTION 'Insufficient available wallet balance'; END IF;
    INSERT INTO wallet_holds(auction_id,user_id,amount) VALUES(a.id,NEW.bidder_id,NEW.amount)
      ON CONFLICT(auction_id) DO UPDATE SET user_id=EXCLUDED.user_id,amount=EXCLUDED.amount,updated_at=clock_timestamp();
  END IF;
  -- Check the clock again after waiting for wallet locks. Client time is never authoritative.
  v_now:=clock_timestamp();
  IF v_now>=a.end_time THEN RAISE EXCEPTION 'Auction is not open for bidding'; END IF;
  NEW.placed_at:=v_now;
  UPDATE auctions SET current_price=NEW.amount,bid_count=bid_count+1,status='active',
    end_time=CASE WHEN soft_close_seconds>0 AND end_time-v_now<=make_interval(secs=>soft_close_seconds)
      THEN v_now+make_interval(secs=>soft_close_seconds) ELSE end_time END
    WHERE id=a.id;
  RETURN NEW;
END; $$;
COMMIT;
