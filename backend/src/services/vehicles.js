const error = require('../utils/httpError');

// قفل الهوية يجمع طلبات الرقم نفسه؛ لا يُنشأ سجل مركبة ثان عند إعادة البيع.
async function prepareListing(client, data, listingId = null) {
  const {
    rows: [vehicle],
  } = await client.query(
    `INSERT INTO vehicles(vin,make,model,year) VALUES($1,$2,$3,$4)
     ON CONFLICT(vin) DO UPDATE SET vin=EXCLUDED.vin RETURNING *`,
    [data.vin, data.make, data.model, data.year],
  );
  const blocked = await client.query(
    `SELECT 1 FROM cars c WHERE c.vehicle_id=$1 AND ($2::bigint IS NULL OR c.id<>$2)
      AND (c.status IN ('pending_review','approved') OR EXISTS(
        SELECT 1 FROM auctions a JOIN invoices i ON i.auction_id=a.id WHERE a.car_id=c.id
          AND i.sale_status NOT IN ('completed','cancelled','expired')) OR
        (c.status='sold' AND NOT EXISTS(SELECT 1 FROM auctions a JOIN invoices i ON i.auction_id=a.id
          WHERE a.car_id=c.id AND i.sale_status='completed'))) LIMIT 1`,
    [vehicle.id, listingId],
  );
  if (blocked.rowCount)
    throw error(
      409,
      'لهذه السيارة طلب أو إعلان قائم، أو عملية بيع لم تكتمل. أكمل المعاملة أو عدّل الطلب الموجود.',
    );
  const sold = await client.query(
    `SELECT 1 FROM vehicle_ownership_history WHERE vehicle_id=$1 AND source='completed_sale' LIMIT 1`,
    [vehicle.id],
  );
  if (
    sold.rowCount &&
    (vehicle.make !== data.make ||
      vehicle.model !== data.model ||
      Number(vehicle.year) !== data.year)
  )
    throw error(
      409,
      'رقم الهيكل مرتبط بسيارة مسجلة؛ يجب مطابقة الماركة والموديل وسنة الصنع مع بياناتها الأصلية.',
    );
  return vehicle;
}

async function recordOwnership(
  client,
  { vehicleId, ownerId, carId, invoiceId = null, adminId = null, revision = 1 },
) {
  const {
    rows: [vehicle],
  } = await client.query('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [vehicleId]);
  if (String(vehicle.current_owner_id) === String(ownerId)) return;
  await client.query(
    `INSERT INTO vehicle_ownership_history(vehicle_id,from_owner_id,to_owner_id,car_id,invoice_id,verified_by,source,event_key)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      vehicleId,
      vehicle.current_owner_id,
      ownerId,
      carId,
      invoiceId,
      adminId,
      invoiceId ? 'completed_sale' : 'document_review',
      invoiceId ? 'sale:' + invoiceId : 'approval:' + carId + ':' + revision,
    ],
  );
  await client.query('UPDATE vehicles SET current_owner_id=$2 WHERE id=$1', [vehicleId, ownerId]);
}

module.exports = { prepareListing, recordOwnership };
