/**
 * مصدر جلسة المستخدم داخل React؛ يجلب الحساب الحالي ويحدّثه بعد الدخول والخروج وتغير الصلاحيات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';

const AuthContext = createContext(null);
const authChangeKey = 'mazad-auth-changed';
function notifyAuthChange() {
  try {
    window.localStorage.setItem(authChangeKey, String(Date.now()));
  } catch {
    // التحديث عند عودة التركيز يعمل أيضًا عندما يمنع المتصفح التخزين.
  }
}
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const revision = useRef(0);
  // رقم المراجعة يمنع رد طلب أقدم من استبدال جلسة أحدث؛ 401 يعني انتهاء الجلسة لا تعطل الشبكة.
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    setError('');
    try {
      const data = await api('/api/me');
      if (request === revision.current) setUser(data.user);
      return data.user;
    } catch (err) {
      if (err.status === 401) {
        if (request === revision.current) setUser(null);
        return null;
      }
      if (request === revision.current) setError(err.message);
      throw err;
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh().catch(() => {});
    const retry = () => refresh().catch(() => {});
    const onVisible = () => {
      if (!document.hidden) retry();
    };
    const onStorage = (event) => {
      if (event.key === authChangeKey) retry();
    };
    window.addEventListener('focus', retry);
    window.addEventListener('mazad:unauthorized', retry);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', retry);
      window.removeEventListener('mazad:unauthorized', retry);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);
  // ينشئ الجلسة في الخلفية ثم يقرأ الحساب الفعلي وصلاحياته بدل افتراضها من النموذج.
  async function login(credentials) {
    await api('/api/login', { method: 'POST', body: JSON.stringify(credentials) });
    const account = await refresh();
    notifyAuthChange();
    return account;
  }
  // ينهي الجلسة في الخلفية ويبطل أي طلب قديم ثم يفرغ بيانات الحساب من الواجهة.
  async function logout() {
    await api('/api/logout', { method: 'POST' });
    revision.current += 1;
    setError('');
    setLoading(false);
    setUser(null);
    notifyAuthChange();
  }
  return (
    <AuthContext.Provider value={{ user, loading, error, refresh, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
