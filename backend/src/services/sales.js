/**
 * آلة حالات البيع؛ تحفظ السداد في الضمان وتنفذ التسليم والاستلام والاعتراض والاسترداد وانتهاء المهلة ذريًا.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const pool = require('../db');
const error = require('../utils/httpError');
const { recordOwnership } = require('./vehicles');

// يحفظ حدث البيع داخل المعاملة نفسها؛ تجهز دوال قاعدة البيانات إشعارات الأطراف انطلاقًا منه.
async function recordEvent(client, invoice, actorId, kind, note = '') {
  await client.query(
    'INSERT INTO invoice_events(invoice_id,actor_id,kind,note) VALUES($1,$2,$3,$4)',
    [invoice.id, actorId, kind, note],
  );
}

// يلغي المعاملة قبل التسوية النهائية، ويرد الضمان أو يفك الحجز ويعيد السيارة للمراجعة مع حفظ السبب.
async function cancelSale(client, invoice, actorId, kind, note, manualRefundConfirmed = false) {
  if (invoice.settlement_state === 'released')
    throw error(409, 'اكتملت التسوية سابقًا؛ لا يمكن استرجاع رصيد صُرف للبائع بهذه العملية.');
  if (invoice.settlement_state === 'manual' && !manualRefundConfirmed)
    throw error(409, 'أكّد معالجة رد السداد اليدوي خارج المنصة قبل إلغاء المعاملة.');
  if (invoice.settlement_state === 'escrow') {
    const escrow = await client.query(
      'DELETE FROM invoice_escrows WHERE invoice_id=$1 RETURNING amount',
      [invoice.id],
    );
    if (escrow.rows[0]?.amount !== invoice.winning_amount)
      throw error(409, 'رصيد ضمان المعاملة غير مطابق.');
    const {
      rows: [wallet],
    } = await client.query(
      'UPDATE wallets SET balance=balance+$2::numeric,updated_at=clock_timestamp() WHERE user_id=$1 RETURNING balance',
      [invoice.buyer_id, invoice.winning_amount],
    );
    await client.query(
      "INSERT INTO wallet_transactions(user_id,kind,amount,balance_after,invoice_id) VALUES($1,'auction_refund',$2,$3,$4)",
      [invoice.buyer_id, invoice.winning_amount, wallet.balance, invoice.id],
    );
  }
  await client.query('DELETE FROM wallet_holds WHERE auction_id=$1', [invoice.auction_id]);
  await client.query(
    "UPDATE invoices SET status='cancelled',sale_status=$2,settlement_state=CASE WHEN settlement_state='escrow' THEN 'refunded' ELSE settlement_state END,closed_at=clock_timestamp() WHERE id=$1",
    [invoice.id, kind === 'expired' ? 'expired' : 'cancelled'],
  );
  // Return the car to review; relisting requires an explicit fresh approval and auction.
  await client.query(
    "UPDATE cars SET status='pending_review',reviewed_at=NULL,reviewed_by=NULL,review_notes=$2 WHERE id=(SELECT car_id FROM auctions WHERE id=$1) AND status<>'deleted'",
    [
      invoice.auction_id,
      kind === 'expired'
        ? 'انتهت مهلة سداد الفائز؛ راجع السيارة قبل إعادة عرضها.'
        : 'أُلغيت المعاملة؛ راجع السيارة قبل إعادة عرضها.',
    ],
  );
  await recordEvent(
    client,
    invoice,
    actorId,
    kind,
    invoice.settlement_state === 'manual'
      ? note + ' · أكدت الإدارة معالجة رد السداد اليدوي خارج المنصة.'
      : note,
  );
}

// المدخل الموحد لإجراءات الفاتورة؛ يتحقق من الطرف والحالة والمهلة ويعتمد كل أثر مالي وإجرائي معًا.
async function processSale(invoiceId, actorId, action, body = {}, isAdmin = false) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // قراءة المعرفات أولًا لتحديد المزاد والطرفين؛ القيم المالية النهائية ستُقرأ مجددًا تحت الأقفال.
    const found = await client.query(
      'SELECT auction_id,buyer_id,seller_id FROM invoices WHERE id=$1',
      [invoiceId],
    );
    if (
      !found.rowCount ||
      (!isAdmin &&
        action !== 'expire' &&
        ![found.rows[0].buyer_id, found.rows[0].seller_id].some(
          (id) => String(id) === String(actorId),
        ))
    )
      throw error(404, 'المعاملة غير موجودة في حسابك.');
    // ترتيب الأقفال موحد: المزاد ثم الفاتورة ثم محافظ الطرفين حسب المعرف لتقليل فرص التعارض.
    const {
      rows: [auction],
    } = await client.query('SELECT * FROM auctions WHERE id=$1 FOR UPDATE', [
      found.rows[0].auction_id,
    ]);
    const {
      rows: [invoice],
    } = await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [invoiceId]);
    const buyer = String(invoice.buyer_id) === String(actorId);
    const seller = String(invoice.seller_id) === String(actorId);
    if (action === 'pay' && !buyer) throw error(404, 'الفاتورة غير موجودة في مشترياتك.');
    if (['manual_pay', 'cancel', 'resume'].includes(action) && !isAdmin)
      throw error(403, 'هذا الإجراء للإدارة فقط.');
    if (action === 'handover' && !seller) throw error(403, 'البائع وحده يسجّل التسليم.');
    if (action === 'receive' && !buyer) throw error(403, 'المشتري وحده يؤكد الاستلام.');
    await client.query(
      'SELECT user_id FROM wallets WHERE user_id IN ($1,$2) ORDER BY user_id FOR UPDATE',
      [invoice.buyer_id, invoice.seller_id],
    );
    const {
      rows: [clock],
    } = await client.query('SELECT clock_timestamp() AS now');
    // فحص المهلة يأتي بعد انتظار الأقفال ويستخدم ساعة قاعدة البيانات، لا ساعة المتصفح أو بدء الطلب.
    const pastDue =
      invoice.sale_status === 'awaiting_payment' &&
      invoice.due_at &&
      new Date(invoice.due_at) <= new Date(clock.now);
    if (action === 'expire' || (['pay', 'manual_pay'].includes(action) && pastDue)) {
      if (!pastDue) {
        await client.query('COMMIT');
        return { success: true, changed: false };
      }
      await cancelSale(
        client,
        invoice,
        null,
        'expired',
        'انتهت مهلة السداد دون دفع. فُك حجز العرض دون غرامة.',
      );
      await client.query('COMMIT');
      return {
        success: action === 'expire',
        changed: true,
        expired: true,
        message: 'انتهت مهلة السداد وأُلغي الفوز وفُك الحجز.',
      };
    }
    let alreadyPaid = false;
    let message = 'تم تحديث المعاملة.';
    if (action === 'pay' || action === 'manual_pay') {
      const demo = action === 'pay';
      if ((auction.payment_mode === 'demo_wallet') !== demo)
        throw error(409, 'طريقة السداد لا تطابق هذه الفاتورة.');
      // إعادة طلب الدفع بعد نجاحه ترجع النتيجة السابقة دون خصم جديد أو إنشاء ضمان آخر.
      if (
        invoice.paid_at &&
        ['awaiting_handover', 'handed_over', 'completed', 'disputed'].includes(invoice.sale_status)
      )
        alreadyPaid = true;
      else {
        if (
          invoice.status !== 'pending' ||
          invoice.sale_status !== 'awaiting_payment' ||
          auction.status !== 'closed'
        )
          throw error(409, 'الفاتورة غير قابلة للدفع.');
        if (demo) {
          if (Number(invoice.commission_amount) !== 0)
            throw error(409, 'الدفع التجريبي مهيّأ لفواتير دون عمولة فقط.');
          // يجب أن يطابق حجز الفائز صاحب الفاتورة وقيمتها قبل تحويل الحجز إلى مبلغ مدفوع في الضمان.
          const {
            rows: [hold],
          } = await client.query('SELECT * FROM wallet_holds WHERE auction_id=$1', [
            invoice.auction_id,
          ]);
          if (
            !hold ||
            String(hold.user_id) !== String(actorId) ||
            hold.amount !== invoice.winning_amount
          )
            throw error(409, 'حجز المحفظة لا يطابق الفاتورة.');
          const {
            rows: [wallet],
          } = await client.query(
            'UPDATE wallets SET balance=balance-$2::numeric,updated_at=clock_timestamp() WHERE user_id=$1 AND balance >= $2::numeric RETURNING balance',
            [actorId, invoice.winning_amount],
          );
          if (!wallet) throw error(409, 'رصيد المحفظة غير كافٍ.');
          await client.query(
            "INSERT INTO wallet_transactions(user_id,kind,amount,balance_after,invoice_id) VALUES($1,'auction_payment',-$2::numeric,$3,$4)",
            [actorId, invoice.winning_amount, wallet.balance, invoiceId],
          );
          await client.query('DELETE FROM wallet_holds WHERE auction_id=$1', [invoice.auction_id]);
          // الخصم لا يذهب للبائع الآن؛ يبقى في ضمان الفاتورة حتى يكتمل التسليم ويؤكد المشتري الاستلام.
          await client.query('INSERT INTO invoice_escrows(invoice_id,amount) VALUES($1,$2)', [
            invoiceId,
            invoice.winning_amount,
          ]);
        }
        await client.query(
          "UPDATE invoices SET status='paid',paid_at=clock_timestamp(),payment_method=$2,sale_status='awaiting_handover',settlement_state=$3 WHERE id=$1",
          [invoiceId, demo ? 'demo_wallet' : 'manual', demo ? 'escrow' : 'manual'],
        );
        await recordEvent(
          client,
          invoice,
          actorId,
          demo ? 'payment_escrow' : 'manual_payment',
          demo
            ? 'الرصيد تجريبي ومحفوظ للمعاملة حتى يؤكد المشتري الاستلام.'
            : 'أكدت الإدارة استلام السداد خارج المحفظة التجريبية.',
        );
      }
      message = alreadyPaid
        ? 'سبق سداد الفاتورة.'
        : action === 'pay'
          ? 'تم السداد التجريبي وحفظ الرصيد حتى تأكيد الاستلام.'
          : 'تم تسجيل السداد اليدوي.';
    } else if (action === 'handover') {
      if (invoice.sale_status !== 'handed_over') {
        if (invoice.sale_status !== 'awaiting_handover')
          throw error(409, 'يمكن تسجيل التسليم بعد السداد وقبل الاعتراض فقط.');
        await client.query(
          "UPDATE invoices SET sale_status='handed_over',handover_at=clock_timestamp() WHERE id=$1",
          [invoiceId],
        );
        await recordEvent(
          client,
          invoice,
          actorId,
          'handover',
          'سجّل البائع تسليم السيارة؛ بانتظار تأكيد المشتري.',
        );
      }
      message = 'سُجّل التسليم، بانتظار تأكيد المشتري.';
    } else if (action === 'receive') {
      if (invoice.sale_status !== 'completed') {
        if (invoice.sale_status !== 'handed_over')
          throw error(409, 'سجّل البائع التسليم أولًا، وعالج أي اعتراض قبل تأكيد الاستلام.');
        // عند تأكيد الاستلام فقط يُزال ضمان الفاتورة وتُضاف الحصيلة لمحفظة البائع في المعاملة نفسها.
        if (invoice.settlement_state === 'escrow') {
          const escrow = await client.query(
            'DELETE FROM invoice_escrows WHERE invoice_id=$1 RETURNING amount',
            [invoiceId],
          );
          if (escrow.rows[0]?.amount !== invoice.winning_amount)
            throw error(409, 'رصيد ضمان المعاملة غير مطابق.');
          const {
            rows: [wallet],
          } = await client.query(
            'UPDATE wallets SET balance=balance+$2::numeric,updated_at=clock_timestamp() WHERE user_id=$1 RETURNING balance',
            [invoice.seller_id, invoice.winning_amount],
          );
          await client.query(
            "INSERT INTO wallet_transactions(user_id,kind,amount,balance_after,invoice_id) VALUES($1,'sale_credit',$2,$3,$4)",
            [invoice.seller_id, invoice.winning_amount, wallet.balance, invoiceId],
          );
        }
        await client.query(
          "UPDATE invoices SET sale_status='completed',completed_at=clock_timestamp(),settlement_state=CASE WHEN settlement_state='escrow' THEN 'released' ELSE settlement_state END WHERE id=$1",
          [invoiceId],
        );
        const {
          rows: [listing],
        } = await client.query('SELECT vehicle_id FROM cars WHERE id=$1', [auction.car_id]);
        await recordOwnership(client, {
          vehicleId: listing.vehicle_id,
          ownerId: invoice.buyer_id,
          carId: auction.car_id,
          invoiceId,
        });
        await recordEvent(
          client,
          invoice,
          actorId,
          'completed',
          'أكد المشتري استلام السيارة واكتمال المعاملة.',
        );
      }
      message = 'تم تأكيد الاستلام وإتمام البيع.';
    } else if (action === 'dispute') {
      if (!buyer && !seller) throw error(403, 'الاعتراض لطرفي المعاملة فقط.');
      // الاعتراض يحتاج سببًا محفوظًا؛ تغيير الحالة يوقف إجراءات الإتمام وصرف الضمان حتى قرار الإدارة.
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (reason.length < 10 || reason.length > 2000)
        throw error(400, 'اكتب سبب الاعتراض من 10 إلى 2000 حرف.');
      if (!['awaiting_handover', 'handed_over'].includes(invoice.sale_status))
        throw error(409, 'يمكن الاعتراض على معاملة مسددة قبل إتمامها فقط.');
      await client.query(
        "UPDATE invoices SET sale_status='disputed',status='disputed',dispute_reason=$2 WHERE id=$1",
        [invoiceId, reason],
      );
      await recordEvent(client, invoice, actorId, 'dispute', reason);
      message = 'وصل الاعتراض للإدارة؛ أُوقف إتمام المعاملة وصرف الضمان حتى المعالجة.';
    } else if (action === 'cancel' || action === 'resume') {
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (reason.length < 10 || reason.length > 2000)
        throw error(400, 'اكتب سبب قرار الإدارة من 10 إلى 2000 حرف.');
      if (action === 'resume') {
        if (invoice.sale_status !== 'disputed') throw error(409, 'لا يوجد اعتراض مفتوح.');
        if (!invoice.paid_at)
          throw error(
            409,
            'هذه فاتورة اعتراض قديمة دون سداد مسجل؛ عالجها بالإلغاء والمراجعة، ولا تسجلها كمدفوعة.',
          );
        await client.query(
          "UPDATE invoices SET status='paid',sale_status=CASE WHEN handover_at IS NULL THEN 'awaiting_handover' ELSE 'handed_over' END WHERE id=$1",
          [invoiceId],
        );
        await recordEvent(client, invoice, actorId, 'resume', reason);
        message = 'تمت معالجة الاعتراض وإعادة المعاملة للتسليم والاستلام.';
      } else {
        if (['completed', 'cancelled', 'expired'].includes(invoice.sale_status))
          throw error(409, 'المعاملة مكتملة أو مغلقة مسبقًا.');
        await cancelSale(
          client,
          invoice,
          actorId,
          'cancelled',
          reason,
          body.manual_refund_confirmed === true,
        );
        message =
          invoice.settlement_state === 'escrow'
            ? 'أُلغيت المعاملة وأُعيد الرصيد التجريبي للمشتري.'
            : invoice.settlement_state === 'manual'
              ? 'أُلغيت المعاملة وسُجل تأكيد معالجة الرد اليدوي خارج المنصة.'
              : 'أُلغيت المعاملة وفُك حجز العرض.';
      }
    } else throw error(400, 'إجراء غير صالح.');
    // لا تبلغ الواجهة بنجاح الإجراء إلا بعد اعتماد الحالة والأموال وسجل الأحداث معًا.
    await client.query('COMMIT');
    return { success: true, message, already_paid: alreadyPaid };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// يلتقط دفعة فواتير تجاوزت مهلة السداد ثم يمررها إلى مسار الإلغاء نفسه بدل تكرار قواعد الاسترداد.
async function expireUnpaidInvoices() {
  const { rows } = await pool.query(
    "SELECT id FROM invoices WHERE sale_status='awaiting_payment' AND due_at<=clock_timestamp() ORDER BY due_at LIMIT 25",
  );
  let expired = 0;
  for (const { id } of rows) if ((await processSale(id, null, 'expire')).changed) expired++;
  return expired;
}
module.exports = { processSale, expireUnpaidInvoices };
