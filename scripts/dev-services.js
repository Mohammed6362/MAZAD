/**
 * يفحص المنفذ وهوية خدمة التطوير لتمييز المشروع العامل عن تطبيق آخر قبل محاولة تشغيل نسخة إضافية.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const net = require('node:net');

// يفحص المنفذ أولًا ثم مسار هوية الخدمة؛ النتيجة تحدد إعادة الاستخدام أو التشغيل أو إظهار تعارض.
async function inspectService({ port, statusPath, service }) {
  const listening = await new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(true));
  });
  if (!listening) return 'available';
  try {
    const response = await fetch(`http://127.0.0.1:${port}${statusPath}`, {
      signal: AbortSignal.timeout(2000),
    });
    const data = await response.json();
    if (response.ok && data.service === service) return 'running';
  } catch {
    /* A different application, or an unresponsive service, owns this port. */
  }
  return 'occupied';
}

module.exports = { inspectService };
