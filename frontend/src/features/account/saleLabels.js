/**
 * ترجمة حالات البيع والضمان إلى عبارات عربية موحدة بين واجهتي المستخدم والإدارة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
export const saleLabels = {
  awaiting_payment: 'بانتظار السداد',
  awaiting_handover: 'مسددة — بانتظار التسليم',
  handed_over: 'سجّل البائع التسليم — بانتظار تأكيد المشتري',
  disputed: 'اعتراض قيد المعالجة',
  completed: 'اكتملت المعاملة',
  cancelled: 'ألغتها الإدارة',
  expired: 'انتهت مهلة السداد',
};
export const settlementLabels = {
  unpaid: 'لم تُسدّد',
  escrow: 'رصيد محفوظ لضمان المعاملة',
  released: 'صُرفت حصيلة البيع التجريبية للبائع',
  refunded: 'أُعيد الرصيد للمشتري',
  manual: 'سداد يدوي خارج المحفظة',
};
