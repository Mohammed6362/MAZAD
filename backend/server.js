/**
 * يشغّل Express والعامل الدوري على المنفذ المحدد، ويغلق اتصالات HTTP وقاعدة البيانات عند إيقاف الخادم.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { startAuctionCloser } = require('./src/jobs/closeAuctions');
const { port } = require('./src/config');
const app = require('./src/app');
const pool = require('./src/db');
let stopCloser = async () => {};
const server = app.listen(port, () => console.log('Mazad Libya: http://localhost:' + port));
server.on('listening', () => {
  stopCloser = startAuctionCloser();
});
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? 'Port ' + port + ' is already in use. Stop the previous server first.'
      : error.message,
  );
  pool.end().finally(() => process.exit(1));
});
// ينتظر العامل الجاري ثم يغلق HTTP ومجموعة الاتصالات، مع مهلة أخيرة تمنع تعليق الإيقاف.
function shutdown() {
  stopCloser().finally(() => server.close(() => pool.end().finally(() => process.exit(0))));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
