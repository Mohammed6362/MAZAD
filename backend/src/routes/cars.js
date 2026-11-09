/**
 * مسارات السيارات العامة والخاصة؛ إضافة الصور والمستندات وتعديل سيارة المالك وإعادتها للمراجعة بشكل ذري.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const path = require('node:path');
const { uploadsRoot } = require('../config');
const parseCarInput = require('../utils/carInput');
const pool = require('../db');
const { prepareListing } = require('../services/vehicles');
const httpError = require('../utils/httpError');
const { carVisibilitySql, viewerParameters } = require('../utils/carVisibility');
const { requireRole } = require('../middleware/auth');
const {
  carUpload,
  removeFiles,
  validateImage,
  removeStoredImages,
} = require('../middleware/uploads');
const { respondError } = require('../utils/http');
// هذا الإسقاط العام يتعمد استبعاد أوراق الملكية والجواز وبيانات التواصل الخاصة من الإعلان.
const publicCarsSelect = `
  SELECT c.id, c.make, c.model, c.year, c.mileage_km, c.transmission,
         c.condition, c.defects_notes, c.inspection_report_url, c.location,
         c.status, c.created_at, img.image_url, img.image_count,
         a.id AS auction_id, a.starting_price, a.current_price, a.min_increment,
         a.bid_count, a.start_time, a.end_time, clock_timestamp() AS server_time,
         CASE WHEN a.id IS NULL THEN NULL WHEN a.status NOT IN ('active','scheduled') THEN a.status::text WHEN a.end_time <= NOW() THEN 'ended' WHEN a.start_time <= NOW() THEN 'active' ELSE 'scheduled' END AS auction_status
  FROM cars c
  LEFT JOIN LATERAL (
    SELECT (SELECT ci.url FROM car_images ci WHERE ci.car_id = c.id ORDER BY ci.sort_order, ci.id LIMIT 1) AS image_url,
           COUNT(*)::int AS image_count
    FROM car_images ci WHERE ci.car_id = c.id
  ) img ON TRUE
  LEFT JOIN LATERAL (
    SELECT au.id, au.starting_price, au.current_price, au.min_increment, au.bid_count, au.start_time, au.end_time, au.status
    FROM auctions au WHERE au.car_id = c.id
    ORDER BY au.created_at DESC, au.id DESC LIMIT 1
  ) a ON TRUE
`;

module.exports = function registerRoutes(app) {
  // المركبات التي انتقلت ملكيتها للحساب بعد إتمام البيع، دون مستندات المالك السابق.
  app.get('/api/account/vehicles', requireRole('user'), async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT v.id,v.vin,v.make,v.model,v.year,
          EXISTS(SELECT 1 FROM cars c WHERE c.vehicle_id=v.id AND c.status IN ('pending_review','approved')) AS has_live_listing
         FROM vehicles v WHERE v.current_owner_id=$1 AND EXISTS(
           SELECT 1 FROM vehicle_ownership_history h WHERE h.vehicle_id=v.id AND h.source='completed_sale')
         ORDER BY v.id DESC`,
        [req.session.userId],
      );
      res.json({ success: true, vehicles: result.rows });
    } catch (error) {
      next(error);
    }
  });
  app.get(
    '/api/account/vehicles/:id/resale',
    requireRole('user', 'can_list'),
    async (req, res, next) => {
      try {
        const result = await pool.query(
          'SELECT id,vin,make,model,year FROM vehicles WHERE id=$1 AND current_owner_id=$2',
          [req.params.id, req.session.userId],
        );
        if (!result.rowCount)
          return respondError(res, 404, 'السيارة غير موجودة ضمن ملكيتك الحالية.');
        res.json({ success: true, vehicle: result.rows[0] });
      } catch (error) {
        next(error);
      }
    },
  );
  // قراءة سيارة يملكها صاحب الجلسة وصورها وعدد أوراقها، دون إرجاع روابط المستندات الخاصة. المسار القديم يبقى اسمًا بديلًا للتوافق.
  app.get(
    ['/api/account/cars/:id', '/api/seller/cars/:id'],
    requireRole('user'),
    async (req, res, next) => {
      try {
        const result = await pool.query(
          "SELECT c.*,NOT EXISTS(SELECT 1 FROM auctions a WHERE a.car_id=c.id AND a.status IN ('active','scheduled')) AS no_open_auction,(SELECT count(*)::int FROM car_ownership_documents d WHERE d.car_id=c.id) AS ownership_document_count FROM cars c WHERE id=$1 AND seller_id=$2 AND c.status<>'deleted'",
          [req.params.id, req.session.userId],
        );
        if (!result.rowCount) return respondError(res, 404, 'السيارة غير موجودة في حسابك.');
        const images = await pool.query(
          'SELECT id,url FROM car_images WHERE car_id=$1 ORDER BY sort_order,id',
          [req.params.id],
        );
        res.json({ success: true, car: { ...result.rows[0], images: images.rows } });
      } catch (error) {
        next(error);
      }
    },
  );
  // تعديل سيارة المالك قبل البيع ودون مزاد مفتوح؛ التغيير يعيد المراجعة ويحفظ الصور والمستندات ذريًا. المسار القديم يبقى اسمًا بديلًا للتوافق.
  app.patch(
    ['/api/account/cars/:id', '/api/seller/cars/:id'],
    requireRole('user', 'can_list'),
    carUpload,
    async (req, res, next) => {
      const files = req.files?.images || [];
      const documents = req.files?.ownership_documents || [];
      const allFiles = [...files, ...documents];
      let client;
      let committed = false;
      let removed = [];
      try {
        const data = parseCarInput(req.body);
        if (data.invalidMessage) {
          await removeFiles(allFiles);
          return respondError(res, 400, data.invalidMessage);
        }
        client = await pool.connect();
        await client.query('BEGIN');
        // قفل السيارة ينسق التعديل مع اعتماد الإدارة أو جدولة مزاد حتى لا تتداخل العمليات.
        const owner = await client.query(
          "SELECT id,vin FROM cars WHERE id=$1 AND seller_id=$2 AND status IN ('pending_review','rejected','approved') FOR UPDATE",
          [req.params.id, req.session.userId],
        );
        const openAuction = owner.rowCount
          ? await client.query(
              "SELECT 1 FROM auctions WHERE car_id=$1 AND status IN ('active','scheduled')",
              [req.params.id],
            )
          : { rowCount: 0 };
        if (!owner.rowCount || openAuction.rowCount) {
          await client.query('ROLLBACK');
          await removeFiles(allFiles);
          return respondError(res, 409, 'السيارة غير قابلة للتعديل أو غير موجودة في حسابك.');
        }
        if (
          data.vin !== owner.rows[0].vin &&
          (await client.query('SELECT 1 FROM auctions WHERE car_id=$1 LIMIT 1', [req.params.id]))
            .rowCount
        )
          throw httpError(409, 'لا يمكن تغيير رقم الهيكل بعد إنشاء مزاد للسيارة.');
        await prepareListing(client, data, req.params.id);
        const { rows: images } = await client.query(
          'SELECT id,url,storage_key FROM car_images WHERE car_id=$1 ORDER BY sort_order,id',
          [req.params.id],
        );
        // قائمة الصور المحتفظ بها يجب أن تكون جزءًا من صور هذه السيارة، وليس معرفات من إعلان آخر.
        let keep = images.map((image) => String(image.id));
        if (req.body.keep_image_ids !== undefined) {
          try {
            keep = JSON.parse(req.body.keep_image_ids);
          } catch {
            keep = null;
          }
          if (
            !Array.isArray(keep) ||
            keep.some((id) => !images.some((image) => String(image.id) === String(id))) ||
            new Set(keep.map(String)).size !== keep.length
          ) {
            await client.query('ROLLBACK');
            await removeFiles(allFiles);
            return respondError(res, 400, 'قائمة الصور غير صالحة.');
          }
          keep = keep.map(String);
        }
        if (keep.length + files.length < 1 || keep.length + files.length > 10) {
          await client.query('ROLLBACK');
          await removeFiles(allFiles);
          return respondError(res, 400, 'يجب الاحتفاظ بصورة واحدة على الأقل وبحد أقصى 10 صور.');
        }
        const documentCount = Number(
          (
            await client.query('SELECT count(*) FROM car_ownership_documents WHERE car_id=$1', [
              req.params.id,
            ])
          ).rows[0].count,
        );
        // يعالج كل صور الإعلان والمستندات قبل الإدخال، ويرفض الطلب كله عند وجود صورة غير صالحة.
        for (const file of allFiles) await validateImage(file);
        const { vin, make, model, year, mileage, transmission, condition, notes, location } = data;
        const result = await client.query(
          "UPDATE cars SET vin=$3,make=$4,model=$5,year=$6,mileage_km=$7,transmission=$8,condition=$9,defects_notes=$10,location=$11,status='pending_review',ownership_status=$12,ownership_revision=ownership_revision+1,reviewed_by=NULL,reviewed_at=NULL,review_notes=NULL WHERE id=$1 AND seller_id=$2 RETURNING id,status",
          [
            req.params.id,
            req.session.userId,
            vin,
            make,
            model,
            year,
            mileage,
            transmission,
            condition,
            notes,
            location,
            documents.length || documentCount ? 'pending' : 'missing',
          ],
        );
        removed = images.filter((image) => !keep.includes(String(image.id)));
        await client.query('DELETE FROM car_images WHERE car_id=$1 AND NOT(id=ANY($2::bigint[]))', [
          req.params.id,
          keep,
        ]);
        for (const [index, id] of keep.entries())
          await client.query('UPDATE car_images SET sort_order=$2 WHERE id=$1', [id, index]);
        for (const [index, file] of files.entries())
          await client.query(
            'INSERT INTO car_images(car_id,url,storage_key,sort_order) VALUES($1,$2,$3,$4)',
            [
              req.params.id,
              '/uploads/cars/' + file.filename,
              'cars/' + file.filename,
              keep.length + index,
            ],
          );
        // المجموعة القديمة تبقى ما لم تصل بدائل؛ لا تُحذف ملفاتها من القرص إلا بعد اعتماد التغيير.
        const replacedDocuments = documents.length
          ? (
              await client.query(
                'DELETE FROM car_ownership_documents WHERE car_id=$1 RETURNING storage_key',
                [req.params.id],
              )
            ).rows
          : [];
        for (const doc of documents)
          await client.query(
            'INSERT INTO car_ownership_documents(car_id,storage_key,mime_type) VALUES($1,$2,$3)',
            [req.params.id, 'private/ownership/' + doc.filename, doc.mimetype],
          );
        await client.query('COMMIT');
        // من هذه النقطة أصبحت الملفات الجديدة مرتبطة بالسجل؛ فشل تنظيف قديم لا يبرر حذف الجديد.
        committed = true;
        await removeFiles(
          replacedDocuments.map((doc) => ({ path: path.join(uploadsRoot, doc.storage_key) })),
        );
        await removeStoredImages(removed);
        res.json({ success: true, car: result.rows[0] });
      } catch (error) {
        if (client && !committed) await client.query('ROLLBACK').catch(() => {});
        if (!committed) await removeFiles(allFiles);
        if (error.code === '23505')
          return respondError(res, 409, 'يوجد طلب أو إعلان قائم لهذه السيارة.');
        next(error);
      } finally {
        client?.release();
      }
    },
  );
  // إعلانات السيارات المعتمدة العامة فقط، مع صورة ملخصة وآخر مزاد دون بيانات الملكية الخاصة.
  app.get('/api/cars', async (_req, res, next) => {
    try {
      const result = await pool.query(
        `${publicCarsSelect} WHERE c.status = 'approved' ORDER BY c.id DESC`,
      );
      return res.json({ success: true, count: result.rowCount, cars: result.rows });
    } catch (error) {
      next(error);
    }
  });
  // تفاصيل إعلان معتمد أو مباع وصوره العامة، أو 404 إذا لم يكن متاحًا للزوار.
  app.get('/api/cars/:id', async (req, res, next) => {
    try {
      const result = await pool.query(
        `${publicCarsSelect} WHERE ${carVisibilitySql()} AND c.id = $1 LIMIT 1`,
        [req.params.id, ...viewerParameters(req)],
      );
      if (!result.rowCount) return respondError(res, 404, 'السيارة غير متاحة.');
      const images = await pool.query(
        'SELECT url, sort_order FROM car_images WHERE car_id=$1 ORDER BY sort_order,id',
        [req.params.id],
      );
      return res.json({ success: true, car: { ...result.rows[0], images: images.rows } });
    } catch (error) {
      next(error);
    }
  });

  // إرسال سيارة جديدة للمراجعة بصور الإعلان وأوراق الملكية، مع حذف المرفقات الجديدة إذا فشلت المعاملة.
  app.post('/api/cars', requireRole('user', 'can_list'), carUpload, async (req, res, next) => {
    const files = req.files?.images || [];
    const documents = req.files?.ownership_documents || [];
    const allFiles = [...files, ...documents];
    let client;
    try {
      client = await pool.connect();
      if (!files.length) {
        await removeFiles(allFiles);
        return respondError(res, 400, 'أرفق صورة للسيارة.');
      }
      for (const file of allFiles) await validateImage(file);

      const {
        vin,
        make,
        model,
        location,
        year,
        mileage,
        transmission,
        condition,
        notes,
        invalidMessage,
      } = parseCarInput(req.body);
      if (invalidMessage) {
        await removeFiles(allFiles);
        return respondError(res, 400, invalidMessage);
      }

      await client.query('BEGIN');
      await prepareListing(client, { vin, make, model, year });
      const inserted = await client.query(
        `INSERT INTO cars (seller_id, vin, make, model, year, mileage_km, transmission,
                         condition, defects_notes, location, status,ownership_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_review',$11)
       RETURNING id, status, created_at`,
        [
          req.session.userId,
          vin,
          make,
          model,
          year,
          mileage,
          transmission,
          condition,
          notes,
          location,
          documents.length ? 'pending' : 'missing',
        ],
      );
      const car = inserted.rows[0];
      for (const [index, file] of files.entries()) {
        await client.query(
          'INSERT INTO car_images (car_id, url, storage_key, sort_order) VALUES ($1,$2,$3,$4)',
          [car.id, `/uploads/cars/${file.filename}`, `cars/${file.filename}`, index],
        );
      }
      for (const doc of documents)
        await client.query(
          'INSERT INTO car_ownership_documents(car_id,storage_key,mime_type) VALUES($1,$2,$3)',
          [car.id, 'private/ownership/' + doc.filename, doc.mimetype],
        );
      await client.query('COMMIT');
      return res.status(201).json({ success: true, message: 'تم إرسال السيارة للمراجعة.', car });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      await removeFiles(allFiles);
      if (error.code === '23505')
        return respondError(res, 409, 'يوجد طلب أو إعلان قائم لهذه السيارة.');
      if (error.message?.includes('صورة صالحة')) return respondError(res, 400, error.message);
      return next(error);
    } finally {
      client?.release();
    }
  });

  // قائمة سيارات صاحب الحساب وحالة مراجعتها والرسوم وإمكان التعديل وروابط المزادات. المسار القديم يبقى اسمًا بديلًا للتوافق.
  app.get(
    ['/api/account/cars', '/api/seller/cars'],
    requireRole('user'),
    async (req, res, next) => {
      try {
        const result = await pool.query(
          `SELECT c.id, c.vin, c.make, c.model, c.year, c.mileage_km, c.location,
              c.status,c.ownership_status,c.listing_fee_amount, c.review_notes AS rejection_reason, c.reviewed_at, c.created_at,
              NOT EXISTS(SELECT 1 FROM auctions a WHERE a.car_id=c.id AND a.status IN ('active','scheduled')) AS no_open_auction,
              img.image_url,
              (SELECT id FROM auctions WHERE car_id=c.id ORDER BY created_at DESC LIMIT 1) AS auction_id
       FROM cars c LEFT JOIN LATERAL (
         SELECT ci.url AS image_url FROM car_images ci WHERE ci.car_id = c.id ORDER BY ci.sort_order, ci.id LIMIT 1
       ) img ON TRUE
       WHERE c.seller_id = $1 AND c.status<>'deleted' ORDER BY c.created_at DESC, c.id DESC`,
          [req.session.userId],
        );
        return res.json({ success: true, count: result.rowCount, cars: result.rows });
      } catch (error) {
        next(error);
      }
    },
  );
};
