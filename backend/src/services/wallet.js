/**
 * قراءة متسقة للرصيد والحجوزات والضمان وسجل الحركات، وتنفيذ الشحن مرة واحدة لكل مرجع عملية.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const pool = require('../db');
const error = require('../utils/httpError');

// يقرأ الرصيد والحجوزات والضمان والحركات ضمن لقطة قاعدة بيانات واحدة حتى لا تختلط قيم من أوقات مختلفة.
async function walletSnapshot(userId, summaryOnly = false) {
  const client = await pool.connect();
  try {
    // العزل يمنع أن تجمع اللقطة رصيدًا من قبل دفع مع حجوزات من بعده في استجابة واحدة.
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {
      rows: [wallet],
    } = await client.query(
      `SELECT w.balance,COALESCE(SUM(h.amount),0)::numeric(14,3) AS reserved,(w.balance-COALESCE(SUM(h.amount),0))::numeric(14,3) AS available FROM wallets w LEFT JOIN wallet_holds h ON h.user_id=w.user_id WHERE w.user_id=$1 GROUP BY w.user_id`,
      [userId],
    );
    if (!wallet) throw error(409, 'المحفظة غير متاحة لهذا الحساب.');
    const {
      rows: [settlements],
    } = await client.query(
      'SELECT COALESCE(SUM(e.amount) FILTER(WHERE i.buyer_id=$1),0)::numeric(14,3) AS escrowed_payments,COALESCE(SUM(e.amount) FILTER(WHERE i.seller_id=$1),0)::numeric(14,3) AS pending_proceeds FROM invoice_escrows e JOIN invoices i ON i.id=e.invoice_id WHERE i.buyer_id=$1 OR i.seller_id=$1',
      [userId],
    );
    Object.assign(wallet, settlements);
    let holds = [],
      transactions = [];
    if (!summaryOnly) {
      holds = (
        await client.query(
          `SELECT h.auction_id,h.amount,a.status,c.make,c.model,c.year,i.id AS invoice_id FROM wallet_holds h JOIN auctions a ON a.id=h.auction_id JOIN cars c ON c.id=a.car_id LEFT JOIN invoices i ON i.auction_id=a.id WHERE h.user_id=$1 ORDER BY h.updated_at DESC`,
          [userId],
        )
      ).rows;
      transactions = (
        await client.query(
          'SELECT id,kind,amount,(balance_after-amount)::numeric(14,3) AS balance_before,balance_after,invoice_id,car_id,created_at FROM wallet_transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 100',
          [userId],
        )
      ).rows;
    }
    await client.query('COMMIT');
    return {
      success: true,
      demo: true,
      currency: 'LYD',
      wallet,
      ...(summaryOnly ? {} : { holds, transactions }),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// يقفل المحفظة ويفحص مرجع الشحن قبل الزيادة؛ الرصيد وحركة السجل يثبتان معًا، وإعادة الطلب لا تكرر الشحن.
async function topUp(userId, amount, requestKey) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // قفل المحفظة يجعل فحص مرجع الشحن وزيادة الرصيد متسلسلين حتى مع طلبين متزامنين.
    await client.query('SELECT user_id FROM wallets WHERE user_id=$1 FOR UPDATE', [userId]);
    const existing = await client.query(
      'SELECT id,amount FROM wallet_transactions WHERE user_id=$1 AND request_key=$2',
      [userId, requestKey],
    );
    // المرجع نفسه للمبلغ نفسه يعامل كإعادة محاولة؛ تغييره لمبلغ مختلف يُرفض بدل تعديل حركة سابقة.
    if (existing.rowCount) {
      if (existing.rows[0].amount !== amount) throw error(409, 'استُخدم مرجع العملية لمبلغ مختلف.');
      await client.query('COMMIT');
      return { already_completed: true };
    }
    const updated = await client.query(
      'UPDATE wallets SET balance=balance+$2::numeric,updated_at=clock_timestamp() WHERE user_id=$1 RETURNING balance',
      [userId, amount],
    );
    if (!updated.rowCount) throw error(409, 'المحفظة غير متاحة لهذا الحساب.');
    await client.query(
      "INSERT INTO wallet_transactions(user_id,kind,amount,balance_after,request_key) VALUES($1,'demo_top_up',$2,$3,$4)",
      [userId, amount, updated.rows[0].balance, requestKey],
    );
    await client.query('COMMIT');
    return { already_completed: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// يمرر سداد المحفظة إلى آلة حالات البيع الموحدة لتطبق المهلة والضمان ومنع التكرار في مكان واحد.
async function payInvoice(userId, invoiceId) {
  return require('./sales').processSale(invoiceId, userId, 'pay');
}
module.exports = { topUp, payInvoice, walletSnapshot };
