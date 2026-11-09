const API_BASE = import.meta.env.VITE_API_URL || '';

// اتصال واحد لكل تبويب. إشارات التحديث لا تحمل بيانات حسابات أو مستندات.
export function connectRealtime() {
  const source = new EventSource(`${API_BASE}/api/realtime/events`, { withCredentials: true });
  let timer;
  source.addEventListener('market', () => {
    clearTimeout(timer);
    timer = setTimeout(() => window.dispatchEvent(new Event('mazad:market')), 150);
  });
  return () => {
    clearTimeout(timer);
    source.close();
  };
}
