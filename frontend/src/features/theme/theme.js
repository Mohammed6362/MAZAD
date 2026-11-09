/**
 * مخزن المظهر المستقل عن React؛ يطبق الألوان ويتابع إعداد الجهاز وتغييرات التخزين بين التبويبات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
// أي اختيار غير معروف يعود إلى مظهر الجهاز، بما في ذلك قيم التخزين القديمة أو المحذوفة.
const normalize = (value) => (['light', 'dark', 'system'].includes(value) ? value : 'system');

// ينشئ مخزنًا واحدًا لاختيار المظهر واشتراكات تغييره؛ لا يعتمد على حالة مكوّن React معين.
export function createThemeStore(browserWindow, doc) {
  let theme = normalize(doc.documentElement.dataset.theme);
  const media = browserWindow.matchMedia('(prefers-color-scheme: dark)');
  const listeners = new Set();
  // يحوّل اختيار النظام إلى لون فعلي، ويحدث سمات الصفحة ولون المتصفح ثم يبلغ المشتركين.
  function apply() {
    const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    doc.documentElement.dataset.theme = theme;
    doc.documentElement.dataset.colorScheme = resolved;
    doc.documentElement.style.colorScheme = resolved;
    doc
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#101b17' : '#f5f6f2');
    listeners.forEach((listener) => listener());
  }
  // يتابع تغيير اختيار المظهر في تبويب آخر ويطبقه دون الحاجة إلى إعادة تحميل الصفحة.
  function sync(event) {
    if (event.key === 'mazad-theme' || event.key === null) {
      theme = normalize(event.newValue);
      apply();
    }
  }
  return {
    getSnapshot: () => theme,
    // الاشتراك الأول يثبت مستمعي النظام والتخزين، وإلغاء الأخير يزيلهما لمنع التسرب وتكرار الأحداث.
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        media.addEventListener('change', apply);
        browserWindow.addEventListener('storage', sync);
        apply();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          media.removeEventListener('change', apply);
          browserWindow.removeEventListener('storage', sync);
        }
      };
    },
    // يحفظ الاختيار بين الزيارات إن سمح التخزين؛ إذا مُنع يبقى الاختيار الحالي مطبقًا لهذه الزيارة.
    setTheme(value) {
      theme = normalize(value);
      try {
        browserWindow.localStorage.setItem('mazad-theme', theme);
      } catch {
        // The selection remains usable for this visit without storage.
      }
      apply();
    },
  };
}
