/**
 * اختيار المظهر الفاتح أو الداكن أو مظهر الجهاز من مخزن المظهر المشترك.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../features/theme/ThemeContext.jsx';

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <label className="theme-switcher" title="مظهر الموقع">
      <Icon size={18} aria-hidden="true" />
      <select
        aria-label="مظهر الموقع"
        value={theme}
        onChange={(event) => setTheme(event.target.value)}
      >
        <option value="light">فاتح</option>
        <option value="dark">داكن</option>
        <option value="system">حسب الجهاز</option>
      </select>
    </label>
  );
}
