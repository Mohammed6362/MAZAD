/**
 * مخزن إشعارات المستخدم وعدد غير المقروء؛ يجددها دوريًا ويمنع تسرب رد حساب سابق بعد تبديل الجلسة.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
const Context = createContext(null);
export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('admin') === true;
  const identity = user ? `${user.id}:${isAdmin}` : '';
  const currentUser = useRef({ identity, version: 0 });
  if (currentUser.current.identity !== identity)
    currentUser.current = { identity, version: currentUser.current.version + 1 };
  const version = currentUser.current.version;
  const [feeds, setFeeds] = useState({});
  // يجلب إشعارات الجلسة ويتجاهل الرد إذا تبدل الحساب أثناء انتظار الشبكة.
  const refresh = useCallback(
    async (audience = 'user') => {
      if (!user) return;
      if (audience === 'admin' && !isAdmin) return;
      try {
        const data = await api(
          audience === 'admin' ? '/api/admin/notifications' : '/api/notifications',
        );
        if (currentUser.current.version !== version) return;
        setFeeds((current) => ({
          ...current,
          [audience]: {
            version,
            items: data.notifications,
            unread: data.unread,
            error: '',
          },
        }));
      } catch (err) {
        if (currentUser.current.version !== version) return;
        setFeeds((current) => ({
          ...current,
          [audience]: {
            ...(err.status !== 403 && current[audience]?.version === version
              ? current[audience]
              : {}),
            version,
            error: err.message,
          },
        }));
      }
    },
    [identity, version],
  );
  useEffect(() => {
    if (!user) return;
    const reload = () => {
      refresh();
      if (isAdmin) refresh('admin');
    };
    reload();
    const timer = setInterval(() => {
      if (!document.hidden) reload();
    }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  // يحدد إشعارًا أو كل الإشعارات كمقروءة ثم يجدد القائمة والعداد.
  async function read(audience, id) {
    if (currentUser.current.version !== version || !user || (audience === 'admin' && !isAdmin))
      return;
    const base = audience === 'admin' ? '/api/admin/notifications' : '/api/notifications';
    await api(id ? `${base}/${id}/read` : `${base}/read`, { method: 'POST' });
    if (currentUser.current.version === version) await refresh(audience);
  }
  const value = {};
  for (const audience of ['user', 'admin']) {
    const feed =
      user && (audience !== 'admin' || isAdmin) && feeds[audience]?.version === version
        ? feeds[audience]
        : {};
    value[audience] = {
      items: feed.items || [],
      unread: feed.unread || 0,
      error: feed.error || '',
      refresh: () => refresh(audience),
      read: (id) => read(audience, id),
    };
  }
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useNotifications = (audience = 'user') => useContext(Context)[audience];
