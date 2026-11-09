/**
 * توحيد buyer وseller القديمين إلى user، واختيار الدور الرئيسي مع الحفاظ على صلاحية admin المنفصلة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
// Legacy clients may still send buyer/seller; both now refer to one user account.
// يترجم أسماء المشتري والبائع القديمة إلى دور المستخدم الموحد ويرفض أي دور غير معروف.
function normalizeRole(role = 'user') {
  if (['user', 'buyer', 'seller'].includes(role)) return 'user';
  return role === 'admin' ? 'admin' : null;
}
// يعطي الإدارة أولوية كدور رئيسي للعرض مع بقاء صلاحيات المستخدم الموحد محفوظة.
function primaryRole(roles) {
  return roles.includes('admin') ? 'admin' : 'user';
}
module.exports = { normalizeRole, primaryRole };
