// تبقى الإعلانات المباعة في أرشيف طرفي البيع والإدارة، ولا تظهر للزوار أو لحسابات أخرى.
// تُقرأ الصلاحية من قاعدة البيانات مع إصدار الجلسة لمنع استخدام جلسة قديمة بعد سحب الدور.
function carVisibilitySql(userId = '$2', authVersion = '$3') {
  return `(c.status='approved' OR (c.status='sold' AND EXISTS(
    SELECT 1 FROM users viewer WHERE viewer.id=${userId} AND viewer.status='active'
      AND viewer.auth_version=${authVersion} AND (
        viewer.id=c.seller_id OR EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=viewer.id AND r.role='admin') OR
        EXISTS(SELECT 1 FROM invoices i JOIN auctions sale ON sale.id=i.auction_id
          WHERE sale.car_id=c.id AND i.buyer_id=viewer.id AND i.sale_status NOT IN ('cancelled','expired'))
      )
  )))`;
}

const viewerParameters = (req) => [req.session.userId || null, req.session.authVersion || 1];
module.exports = { carVisibilitySql, viewerParameters };
