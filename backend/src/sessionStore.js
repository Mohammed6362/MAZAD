/**
 * مخزن جلسات express-session في PostgreSQL بدل الذاكرة، مع انتهاء الصلاحية والتنظيف الدوري.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const session = require('express-session');
const { sessionTtl: SESSION_TTL_MS } = require('./config');
class PostgresSessionStore extends session.Store {
  constructor(databasePool) {
    super();
    this.pool = databasePool;
    this.cleanupTimer = setInterval(
      () => {
        this.pool
          .query('DELETE FROM user_sessions WHERE expires_at <= NOW()')
          .catch((error) => console.error('Session cleanup error:', error.message));
      },
      15 * 60 * 1000,
    );
    this.cleanupTimer.unref();
  }
  get(sid, callback) {
    this.pool
      .query('SELECT sess FROM user_sessions WHERE sid = $1 AND expires_at > NOW()', [sid])
      .then((result) => callback(null, result.rows[0]?.sess || null))
      .catch(callback);
  }
  set(sid, sess, callback = () => {}) {
    const expiresAt = sess.cookie?.expires
      ? new Date(sess.cookie.expires)
      : new Date(Date.now() + SESSION_TTL_MS);
    this.pool
      .query(
        `INSERT INTO user_sessions (sid, sess, expires_at) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expires_at = EXCLUDED.expires_at`,
        [sid, JSON.stringify(sess), expiresAt],
      )
      .then(() => callback(null))
      .catch(callback);
  }
  destroy(sid, callback = () => {}) {
    this.pool
      .query('DELETE FROM user_sessions WHERE sid = $1', [sid])
      .then(() => callback(null))
      .catch(callback);
  }
  touch(sid, sess, callback = () => {}) {
    const expiresAt = sess.cookie?.expires
      ? new Date(sess.cookie.expires)
      : new Date(Date.now() + SESSION_TTL_MS);
    this.pool
      .query('UPDATE user_sessions SET expires_at = $2 WHERE sid = $1', [sid, expiresAt])
      .then(() => callback(null))
      .catch(callback);
  }
}

module.exports = PostgresSessionStore;
