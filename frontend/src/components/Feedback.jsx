/**
 * عناصر مشتركة لرسائل النجاح والخطأ والتحميل والقوائم الفارغة بدل تكرارها في الصفحات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';

// رسالة نجاح أو خطأ قابلة للوصول؛ تختار نمط العرض والدور المناسب لمحتواها.
export function Notice({ children, type = 'error' }) {
  const Icon = type === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div className={`notice notice-${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon size={18} />
      <span>{children}</span>
    </div>
  );
}

// مؤشر انتظار مشترك مع عنوان يمكن تخصيصه حسب البيانات الجاري تحميلها.
export function Loading({ label = 'جارٍ التحميل…' }) {
  return (
    <div className="loading-box" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}

// يبين خلو القائمة بعنوان وشرح بدل ترك مساحة خالية قد تبدو كفشل تحميل.
export function EmptyState({ title, description }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <AlertCircle size={22} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
