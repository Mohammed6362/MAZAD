/**
 * يمنح كل طلب معرّفًا ويسجل النتيجة والمدة دون طباعة كلمات المرور أو أجسام الطلبات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const { randomUUID } = require('node:crypto');
module.exports = function requestLog(req, res, next) {
  req.requestId = randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  const start = process.hrtime.bigint();
  res.once('finish', () => {
    if (
      process.env.NODE_ENV === 'test' ||
      !req.path.startsWith('/api/') ||
      ['/api/health', '/api/dev/status'].includes(req.path)
    )
      return;
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        event: 'http_request',
        request_id: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
      }),
    );
  });
  next();
};
