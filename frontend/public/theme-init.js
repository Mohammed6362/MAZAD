/**
 * يسترجع المظهر قبل رسم الصفحة لتقليل ومضة الألوان، ويدعم منع الوصول للتخزين المحلي.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
// Apply the saved appearance before the page paints. Keep the legacy storage key.
(() => {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('mazad-theme');
    if (['light', 'dark', 'system'].includes(saved)) preference = saved;
  } catch {
    // Appearance still works when browser storage is unavailable.
  }
  const dark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = preference;
  document.documentElement.dataset.colorScheme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#101b17' : '#f5f6f2';
})();
