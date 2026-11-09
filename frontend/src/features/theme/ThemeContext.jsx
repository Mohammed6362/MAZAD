/**
 * يربط مخزن المظهر بمكونات React عبر useSyncExternalStore حتى تتحدث كل الأزرار معًا.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { createContext, useContext, useState, useSyncExternalStore } from 'react';
import { createThemeStore } from './theme.js';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [store] = useState(() => createThemeStore(window, document));
  const theme = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <ThemeContext.Provider value={{ theme, setTheme: store.setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
