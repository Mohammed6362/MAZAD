/**
 * حاجز أخطاء العرض في React؛ يعرض وسيلة للتعافي إذا فشل رسم جزء من التطبيق.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { Component } from 'react';
export default class AppErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="page-main" role="alert">
          <h1>تعذّر عرض الصفحة</h1>
          <p>أعد تحميل الموقع للمتابعة.</p>
          <button className="button button-dark" onClick={() => window.location.reload()}>
            إعادة التحميل
          </button>
        </main>
      );
    return this.props.children;
  }
}
