/**
 * مراجعة السيارات وجدولة المزادات وإغلاقها وقراءة بيانات الإدارة؛ يربط أول اعتماد بخصم رسوم العرض.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const pool = require('../db');
const { closeAuction } = require('../services/auctions');
const { requireRole } = require('../middleware/auth');
const { trimField, respondError } = require('../utils/http');
const { chargeListingFee } = require('../services/listingFees');
const { recordOwnership } = require('../services/vehicles');
const httpError = require('../utils/httpError');
const deleteListing = require('../services/deleteListing');
module.exports = function registerRoutes(app) {
  app.get('/api/admin/cars/:id/history', requireRole('admin'), async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT h.id,h.source,h.created_at,h.car_id,h.invoice_id,i.invoice_number,a.id AS auction_id,
          previous.full_name AS from_owner_name,owner.full_name AS to_owner_name
         FROM vehicle_ownership_history h JOIN cars c ON c.vehicle_id=h.vehicle_id
         JOIN users owner ON owner.id=h.to_owner_id LEFT JOIN users previous ON previous.id=h.from_owner_id
         LEFT JOIN invoices i ON i.id=h.invoice_id LEFT JOIN auctions a ON a.id=i.auction_id
         WHERE c.id=$1 ORDER BY h.created_at,h.id`,
        [req.params.id],
      );
      res.json({ success: true, history: result.rows });
    } catch (error) {
      next(error);
    }
  });
  // قائمة الفواتير وبيانات أطراف البيع للإدارة فقط.
  app.get('/api/admin/invoices', requireRole('admin'), async (_req, res, next) => {
    try {
      const result = await pool.query(`SELECT i.*, a.payment_mode, c.make,c.model,c.year,
      buyer.full_name AS buyer_name, seller.full_name AS seller_name
      FROM invoices i JOIN auctions a ON a.id=i.auction_id JOIN cars c ON c.id=a.car_id
      JOIN users buyer ON buyer.id=i.buyer_id JOIN users seller ON seller.id=i.seller_id
      ORDER BY i.issued_at DESC`);
      res.json({ success: true, invoices: result.rows });
    } catch (error) {
      next(error);
    }
  });
  // سيارات الإدارة مع المالك والمزاد المفتوح لتحديد ما يمكن جدولته.
  app.get('/api/admin/cars', requireRole('admin'), async (_req, res, next) => {
    try {
      const result = await pool.query(`SELECT c.*, u.full_name AS seller_name,
      (SELECT url FROM car_images WHERE car_id=c.id ORDER BY sort_order,id LIMIT 1) AS image_url,
      (SELECT id FROM auctions WHERE car_id=c.id AND status IN ('active','scheduled') LIMIT 1) AS open_auction_id
      FROM cars c JOIN users u ON u.id=c.seller_id WHERE c.status<>'deleted' ORDER BY c.created_at DESC`);
      res.json({ success: true, cars: result.rows });
    } catch (error) {
      next(error);
    }
  });
  // قائمة المزادات وحالاتها والفاتورة المرتبطة عند وجود فائز.
  app.get('/api/admin/auctions', requireRole('admin'), async (_req, res, next) => {
    try {
      const result = await pool.query(`SELECT a.*, c.make,c.model,c.year,c.status AS car_status,
      i.invoice_number, i.status AS invoice_status
      FROM auctions a JOIN cars c ON c.id=a.car_id LEFT JOIN invoices i ON i.auction_id=a.id
      ORDER BY a.created_at DESC`);
      res.json({ success: true, auctions: result.rows });
    } catch (error) {
      next(error);
    }
  });
  // طلبات المراجعة مع صور الإعلان ونسخة أوراق الملكية وبيانات التواصل اللازمة للمدير.
  app.get('/api/admin/cars/pending', requireRole('admin'), async (_req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT c.id, c.vin, c.make, c.model, c.year, c.mileage_km, c.transmission,
              c.condition, c.defects_notes, c.location, c.status, c.created_at,c.ownership_status,c.ownership_revision,
              (SELECT count(*)::int FROM car_ownership_documents d WHERE d.car_id=c.id) AS ownership_document_count,
              u.id AS seller_id, u.full_name AS seller_name, u.phone AS seller_phone,
              img.image_url, img.images, v.current_owner_id, previous_owner.full_name AS current_owner_name,
              (SELECT count(*)::int FROM vehicle_ownership_history h WHERE h.vehicle_id=v.id AND h.source='completed_sale') AS previous_sale_count
       FROM cars c JOIN users u ON u.id = c.seller_id
       JOIN vehicles v ON v.id=c.vehicle_id LEFT JOIN users previous_owner ON previous_owner.id=v.current_owner_id
       LEFT JOIN LATERAL (
         SELECT (SELECT ci.url FROM car_images ci WHERE ci.car_id = c.id ORDER BY ci.sort_order, ci.id LIMIT 1) AS image_url,
                COALESCE(json_agg(json_build_object('url', ci.url, 'sort_order', ci.sort_order)
                  ORDER BY ci.sort_order, ci.id) FILTER (WHERE ci.id IS NOT NULL), '[]'::json) AS images
         FROM car_images ci WHERE ci.car_id = c.id
       ) img ON TRUE
       WHERE c.status = 'pending_review' ORDER BY c.created_at ASC, c.id ASC`,
      );
      return res.json({ success: true, count: result.rowCount, cars: result.rows });
    } catch (error) {
      next(error);
    }
  });

  // يقفل طلب السيارة ويفحص رقم نسخة المستندات؛ الاعتماد والرسوم والإشعارات تنجح أو تتراجع معًا.
  async function reviewCar(req, res, next, status) {
    let client;
    try {
      if (
        status === 'approved' &&
        (req.body?.ownership_verified !== true || !Number.isInteger(req.body?.ownership_revision))
      )
        return respondError(res, 400, 'افتح تفاصيل الطلب وأكّد قرار اعتماد الملكية قبل الاعتماد.');
      const notes =
        trimField(req.body?.review_notes || req.body?.reason, 1000) ||
        (status === 'rejected' ? 'يرجى التواصل مع الإدارة لمعرفة تفاصيل الرفض.' : null);
      client = await pool.connect();
      await client.query('BEGIN');
      const {
        rows: [car],
      } = await client.query(
        'SELECT id,vehicle_id,make,model,year,seller_id,status,ownership_revision,listing_fee_amount FROM cars WHERE id=$1 FOR UPDATE',
        [req.params.id],
      );
      if (
        !car ||
        car.status !== 'pending_review' ||
        (status === 'approved' && car.ownership_revision !== req.body.ownership_revision)
      ) {
        await client.query('ROLLBACK');
        return respondError(
          res,
          car ? 409 : 404,
          car ? 'تغيّر الطلب. حدّث المراجعة وأكّد قرار اعتماد الملكية.' : 'السيارة غير موجودة.',
        );
      }
      if (status === 'approved') {
        const {
          rows: [vehicle],
        } = await client.query('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [car.vehicle_id]);
        if (
          vehicle.current_owner_id &&
          String(vehicle.current_owner_id) !== String(car.seller_id) &&
          (req.body.ownership_transfer_confirmed !== true ||
            String(req.body.expected_owner_id) !== String(vehicle.current_owner_id))
        )
          throw httpError(
            409,
            'العارض يختلف عن المالك المسجل. راجع انتقال الملكية وأكّده صراحة قبل الاعتماد.',
          );
        await chargeListingFee(client, car);
        await recordOwnership(client, {
          vehicleId: car.vehicle_id,
          ownerId: car.seller_id,
          carId: car.id,
          adminId: req.session.userId,
          revision: car.ownership_revision,
        });
        // تثبيت آخر تصحيح للبيانات الأساسية قبل أي بيع؛ الإعلانات المباعة تبقى مستقلة.
        await client.query('UPDATE vehicles SET make=$2,model=$3,year=$4 WHERE id=$1', [
          car.vehicle_id,
          car.make,
          car.model,
          car.year,
        ]);
      }
      const result = await client.query(
        `UPDATE cars SET status = $2::car_status, reviewed_by = $3, reviewed_at = NOW(), review_notes = $4,ownership_status=CASE WHEN $2::text='approved' THEN 'verified' WHEN EXISTS(SELECT 1 FROM car_ownership_documents d WHERE d.car_id=cars.id) THEN 'pending' ELSE 'missing' END
       WHERE id = $1 AND status = 'pending_review' AND ($2::text<>'approved' OR ownership_revision=$5)
       RETURNING id, status, reviewed_at, review_notes`,
        [req.params.id, status, req.session.userId, notes, req.body?.ownership_revision || 0],
      );
      await client.query('COMMIT');
      if (!result.rowCount) {
        const exists = await pool.query('SELECT 1 FROM cars WHERE id = $1', [req.params.id]);
        return respondError(
          res,
          exists.rowCount ? 409 : 404,
          exists.rowCount
            ? 'تغيّر الطلب. حدّث المراجعة وأكّد قرار اعتماد الملكية.'
            : 'السيارة غير موجودة.',
        );
      }
      return res.json({
        success: true,
        message: status === 'approved' ? 'تم اعتماد السيارة.' : 'تم رفض الطلب.',
        car: result.rows[0],
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return next(error);
    } finally {
      client?.release();
    }
  }
  // يمرر الاعتماد إلى خدمة المراجعة التي تتحقق من المستندات وتخصم رسم العرض مرة واحدة.
  app.patch('/api/admin/cars/:id/approve', requireRole('admin'), (req, res, next) =>
    reviewCar(req, res, next, 'approved'),
  );
  // يحفظ رفض الطلب وسبب المراجعة دون خصم رسوم اعتماد جديدة.
  app.patch('/api/admin/cars/:id/reject', requireRole('admin'), (req, res, next) =>
    reviewCar(req, res, next, 'rejected'),
  );

  // المدير يستطيع حذف أي حالة؛ الخدمة تلغي المزادات المفتوحة وتحفظ سجلات المعاملات.
  app.delete('/api/admin/cars/:id', requireRole('admin'), async (req, res, next) => {
    try {
      res.json(await deleteListing(req.params.id, req.session.userId));
    } catch (error) {
      next(error);
    }
  });

  // جدولة مزاد بعد قرار المدير باعتماد الملكية، سواء أُرفقت أوراق أم لم تُرفق.
  app.post('/api/admin/cars/:id/auction', requireRole('admin'), async (req, res, next) => {
    const startingPrice = Number(req.body?.starting_price);
    const minIncrement =
      req.body?.min_increment === undefined ? 100 : Number(req.body.min_increment);
    const reservePrice = req.body?.reserve_price ? Number(req.body.reserve_price) : null;
    const paymentMode = req.body?.payment_mode || 'demo_wallet';
    const paymentHours =
      req.body?.payment_due_hours === undefined ? 48 : Number(req.body.payment_due_hours);
    const start = new Date(req.body?.start_time);
    const end = new Date(req.body?.end_time);
    if (
      !['manual', 'demo_wallet'].includes(paymentMode) ||
      !Number.isInteger(paymentHours) ||
      paymentHours < 1 ||
      paymentHours > 168 ||
      (reservePrice !== null && (!Number.isFinite(reservePrice) || reservePrice < startingPrice)) ||
      startingPrice > 99999999999 ||
      minIncrement > 99999999999 ||
      !Number.isFinite(startingPrice) ||
      startingPrice <= 0 ||
      !Number.isFinite(minIncrement) ||
      minIncrement <= 0 ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start ||
      start <= new Date()
    ) {
      return respondError(res, 400, 'تحقق من السعر والزيادة وموعدي بداية ونهاية المزاد.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const car = await client.query(
        "SELECT id FROM cars WHERE id=$1 AND status='approved' AND ownership_status='verified' FOR UPDATE",
        [req.params.id],
      );
      if (!car.rowCount) {
        await client.query('ROLLBACK');
        return respondError(
          res,
          409,
          'يلزم قرار المدير باعتماد السيارة والملكية أولًا، سواء أُرفقت أوراق الملكية أم لم تُرفق.',
        );
      }
      const result = await client.query(
        `INSERT INTO auctions (car_id, starting_price, min_increment, start_time, end_time, status, created_by, reserve_price, payment_mode,payment_due_hours)
       SELECT id, $2, $3, $4, $5, 'scheduled', $6, $7, $8,$9 FROM cars WHERE id = $1 AND status = 'approved'
       RETURNING id, car_id, starting_price, min_increment, start_time, end_time, status`,
        [
          req.params.id,
          startingPrice,
          minIncrement,
          start,
          end,
          req.session.userId,
          reservePrice,
          paymentMode,
          paymentHours,
        ],
      );
      await client.query('COMMIT');
      if (!result.rowCount) return respondError(res, 404, 'السيارة غير موجودة أو لم تعتمد بعد.');
      return res.status(201).json({ success: true, auction: result.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505')
        return respondError(res, 409, 'يوجد مزاد مجدول أو نشط لهذه السيارة.');
      return next(error);
    } finally {
      client.release();
    }
  });

  // إغلاق إداري احتياطي يستخدم منطق الإغلاق نفسه الذي يستخدمه العامل الدوري.
  app.post('/api/admin/auctions/:id/close', requireRole('admin'), async (req, res, next) => {
    try {
      res.json(await closeAuction(req.params.id));
    } catch (error) {
      next(error);
    }
  });
};
