/**
 * سياسة رسوم العرض وقراءة المحفظة وشحنها وسداد فاتورة الفوز؛ يتحقق من قيمة المبلغ ومرجع العملية.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { requireRole } = require('../middleware/auth');
const { respondError } = require('../utils/http');
const { parseAmount } = require('../utils/money');
const { topUp, payInvoice, walletSnapshot } = require('../services/wallet');
module.exports = function registerWalletRoutes(app) {
  // إرجاع رسم العرض الحالي وتوقيت خصمه حتى تظهر السياسة قبل إرسال السيارة أو اعتمادها.
  app.get('/api/listing-policy', async (_req, res, next) => {
    try {
      const {
        rows: [policy],
      } = await require('../db').query('SELECT listing_fee FROM platform_settings WHERE id=1');
      res.json({
        success: true,
        listing_fee: policy.listing_fee,
        currency: 'LYD',
        charged_at: 'first_approval',
      });
    } catch (error) {
      next(error);
    }
  });
  // لقطة المحفظة والحجوزات والضمان؛ يمكن طلب ملخص خفيف للوحة المزايدة.
  app.get('/api/account/wallet', requireRole('user'), async (req, res, next) => {
    try {
      res.json(await walletSnapshot(req.session.userId, req.query.summary === '1'));
    } catch (error) {
      next(error);
    }
  });
  // شحن المحفظة التجريبية بعد فحص المبلغ وUUID؛ الخدمة تمنع تكرار الشحن عند إعادة الطلب.
  app.post('/api/account/wallet/top-up', requireRole('user'), async (req, res, next) => {
    const amount = parseAmount(req.body?.amount, '1000000');
    const key = req.body?.request_key;
    if (
      !amount ||
      typeof key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
    )
      return respondError(
        res,
        400,
        'أدخل مبلغًا تجريبيًا من 0.001 إلى مليون دينار ومرجع عملية صالحًا.',
      );
    try {
      const result = await topUp(req.session.userId, amount, key);
      res.json({
        success: true,
        demo: true,
        message: 'تم شحن رصيد المحفظة. لا توجد أموال حقيقية.',
        ...result,
      });
    } catch (error) {
      next(error);
    }
  });
  // سداد فاتورة الفوز من الحجز إلى ضمان المعاملة، مع رفض السداد المتأخر وعدم تكرار الخصم.
  app.post('/api/invoices/:id/pay-wallet', requireRole('user'), async (req, res, next) => {
    try {
      const result = await payInvoice(req.session.userId, req.params.id);
      res.status(result.expired ? 409 : 200).json({
        success: true,
        demo: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  });
};
