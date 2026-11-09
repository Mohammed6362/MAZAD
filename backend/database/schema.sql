-- المخطط الأساسي لقاعدة جديدة فقط؛ ينشئ الأنواع والجداول والقيود والدوال، ثم تُطبق عليه التحديثات بالترتيب.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.

BEGIN;

-- =========================================================
-- 1. ENUM types
-- =========================================================

CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'suspended');
CREATE TYPE car_condition AS ENUM ('excellent', 'good', 'fair', 'needs_repair');
CREATE TYPE car_status AS ENUM ('pending_review', 'approved', 'rejected', 'sold');
CREATE TYPE transmission_t AS ENUM ('manual', 'automatic');
CREATE TYPE auction_status AS ENUM ('scheduled', 'active', 'closed', 'cancelled');
CREATE TYPE invoice_status AS ENUM ('pending', 'paid', 'cancelled', 'disputed');

-- =========================================================
-- 2. Users and roles
-- =========================================================

-- الهوية وبيانات التواصل وحالة الحساب؛ كلمة المرور تخزن كتجزئة وليست كنص قابل للقراءة.


CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    password_hash TEXT NOT NULL,
    status user_status NOT NULL DEFAULT 'active',
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_users_phone ON users (phone);
CREATE UNIQUE INDEX ux_users_email
    ON users (lower(email)) WHERE email IS NOT NULL;

-- الأدوار المسندة لكل حساب؛ user للبيع والمزايدة، وadmin إضافة مستقلة للإدارة.


CREATE TABLE user_roles (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role user_role NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role)
);

CREATE INDEX ix_user_roles_role ON user_roles (role, user_id);

-- يسند الدور الافتراضي للحساب الجديد؛ التحديث 007 يستقر على user بدل أدوار المشتري والبائع القديمة.


CREATE FUNCTION fn_default_roles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO user_roles (user_id, role)
    VALUES (NEW.id, 'user');

    RETURN NEW;
END;
$$;

-- ربط trg_users_default_roles بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_users_default_roles
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION fn_default_roles();

-- =========================================================
-- 3. Cars and images
-- =========================================================

-- بيانات السيارة ومالكها وحالة مراجعتها؛ تغييرات الاعتماد والملكية تربطها ملفات التحديث اللاحقة.


CREATE TABLE cars (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    seller_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    vin VARCHAR(17) NOT NULL,
    make VARCHAR(60) NOT NULL,
    model VARCHAR(60) NOT NULL,
    year SMALLINT NOT NULL,
    mileage_km INTEGER CHECK (mileage_km >= 0),
    transmission transmission_t,
    condition car_condition NOT NULL,
    defects_notes TEXT,
    inspection_report_url TEXT,
    location VARCHAR(100) NOT NULL,
    status car_status NOT NULL DEFAULT 'pending_review',
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_cars_year CHECK (year BETWEEN 1950 AND EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Tripoli')),
    CONSTRAINT ck_cars_vin
        CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{11,17}$')
);

CREATE UNIQUE INDEX ux_cars_vin ON cars (vin);
CREATE INDEX ix_cars_seller ON cars (seller_id);
CREATE INDEX ix_cars_make_model_year ON cars (make, model, year);
CREATE INDEX ix_cars_location ON cars (location);
CREATE INDEX ix_cars_status ON cars (status);

-- صور الإعلان العامة بترتيبها؛ مفتاح التخزين يربط السجل بملف القرص دون استخدام اسم المستخدم.


CREATE TABLE car_images (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    car_id BIGINT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    storage_key TEXT
);

CREATE INDEX ix_car_images_car ON car_images (car_id, sort_order);

-- يرفض ربط السيارة بحساب غير نشط أو لا يملك الدور المطلوب في إصدار المخطط المعني.


CREATE FUNCTION fn_validate_car_seller()
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

-- ربط trg_cars_validate_seller بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_cars_validate_seller
BEFORE INSERT OR UPDATE OF seller_id ON cars
FOR EACH ROW EXECUTE FUNCTION fn_validate_car_seller();

-- =========================================================
-- 4. Auctions
-- =========================================================

-- موعد المزاد وأسعاره وحالته والفائز؛ القفل على هذا السجل ينسق قبول العروض والإغلاق.


CREATE TABLE auctions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    car_id BIGINT NOT NULL REFERENCES cars(id) ON DELETE RESTRICT,
    starting_price NUMERIC(14,3) NOT NULL CHECK (starting_price > 0),
    reserve_price NUMERIC(14,3),
    min_increment NUMERIC(14,3) NOT NULL DEFAULT 100
        CHECK (min_increment > 0),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status auction_status NOT NULL DEFAULT 'scheduled',
    current_price NUMERIC(14,3),
    bid_count INTEGER NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
    winner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_auctions_time CHECK (end_time > start_time),
    CONSTRAINT ck_auctions_reserve
        CHECK (reserve_price IS NULL OR reserve_price >= starting_price),
    CONSTRAINT ck_auctions_current_price
        CHECK (current_price IS NULL OR current_price >= starting_price)
);

CREATE INDEX ix_auctions_car ON auctions (car_id);
CREATE INDEX ix_auctions_status_end ON auctions (status, end_time);
CREATE INDEX ix_auctions_winner ON auctions (winner_id);

CREATE UNIQUE INDEX ux_auctions_one_open_per_car
    ON auctions (car_id)
    WHERE status IN ('scheduled', 'active');

-- يفحص اعتماد السيارة وصحة مواعيد المزاد قبل إدخاله أو تعديل بياناته.


CREATE FUNCTION fn_validate_auction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM cars c
        JOIN users u ON u.id = c.seller_id
        WHERE c.id = NEW.car_id
          AND c.status = 'approved'
          AND u.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Auction requires an approved car and active seller';
    END IF;

    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = NEW.created_by AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Auction creator account is inactive';
    END IF;

    RETURN NEW;
END;
$$;

-- ربط trg_auctions_validate بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_auctions_validate
BEFORE INSERT OR UPDATE OF car_id, created_by ON auctions
FOR EACH ROW EXECUTE FUNCTION fn_validate_auction();

-- =========================================================
-- 5. Bids
-- =========================================================

-- العروض المقبولة بترتيب قيمتها ووقت قبولها؛ لا تعدل العروض السابقة بعد تسجيلها.


CREATE TABLE bids (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    auction_id BIGINT NOT NULL REFERENCES auctions(id) ON DELETE RESTRICT,
    bidder_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount NUMERIC(14,3) NOT NULL CHECK (amount > 0),
    placed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_bids_auction_amount
    ON bids (auction_id, amount DESC);

CREATE INDEX ix_bids_bidder_time
    ON bids (bidder_id, placed_at DESC);

CREATE UNIQUE INDEX ux_bids_auction_amount
    ON bids (auction_id, amount);

-- يفحص شروط المزاد وصاحب العرض والحد الأدنى تحت قفل؛ التعريف النهائي للمحفظة والتمديد في التحديث 009.


CREATE FUNCTION fn_validate_bid()
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

-- ربط trg_bids_validate بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_bids_validate
BEFORE INSERT ON bids
FOR EACH ROW EXECUTE FUNCTION fn_validate_bid();

-- يمنع تعديل العرض المسجل أو حذفه حتى يبقى سجل المنافسة ثابتًا.


CREATE FUNCTION fn_bids_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Bid records cannot be updated or deleted';
END;
$$;

-- ربط trg_bids_immutable بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_bids_immutable
BEFORE UPDATE OR DELETE ON bids
FOR EACH ROW EXECUTE FUNCTION fn_bids_immutable();

-- =========================================================
-- 6. Invoices
-- =========================================================

-- فاتورة الفوز المرتبطة بمزاد واحد، مع طرفي المعاملة وقيمة البيع وحالة السداد.


CREATE TABLE invoices (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_number VARCHAR(30) NOT NULL,
    auction_id BIGINT NOT NULL REFERENCES auctions(id) ON DELETE RESTRICT,
    buyer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    seller_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    winning_amount NUMERIC(14,3) NOT NULL CHECK (winning_amount > 0),
    commission_amount NUMERIC(14,3) NOT NULL DEFAULT 0
        CHECK (commission_amount >= 0),
    status invoice_status NOT NULL DEFAULT 'pending',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,

    CONSTRAINT ck_invoices_parties CHECK (buyer_id <> seller_id),
    CONSTRAINT ck_invoices_paid
        CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

CREATE UNIQUE INDEX ux_invoices_number ON invoices (invoice_number);
CREATE UNIQUE INDEX ux_invoices_auction ON invoices (auction_id);
CREATE INDEX ix_invoices_buyer ON invoices (buyer_id, status);
CREATE INDEX ix_invoices_seller ON invoices (seller_id, status);

-- PostgreSQL-backed session store used by Express.
-- جلسات Express مع بيانات JSON وتاريخ انتهاء؛ معرّف الجلسة هو ما يحمله ملف الارتباط.

CREATE TABLE user_sessions (
    sid TEXT PRIMARY KEY,
    sess JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_user_sessions_expires ON user_sessions (expires_at);

COMMIT;
