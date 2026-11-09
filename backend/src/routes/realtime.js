const supabase = require('../services/supabase');

// Supabase يبث إلى الخادم فقط؛ المتصفح يستقبل إشارة تحديث ويطلب البيانات بصلاحياته المعتادة.
module.exports = function registerRealtime(app) {
  const responses = new Set();
  let channel;
  let client;
  function refreshClients() {
    for (const res of responses) {
      if (res.writableLength > 65536) res.destroy();
      else res.write('event: market\ndata: {}\n\n');
    }
  }
  app.get('/api/realtime/events', (req, res, next) => {
    try {
      client = supabase.getSupabase();
      if (!client || process.env.SUPABASE_REALTIME_ENABLED === 'false')
        return res.status(204).end();
      if (responses.size >= 1000) return res.status(503).end();
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      res.write('retry: 5000\n\n');
      responses.add(res);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
      heartbeat.unref();
      res.on('close', () => {
        clearInterval(heartbeat);
        responses.delete(res);
      });
      if (!channel) {
        channel = client
          .channel('mazad:market', { config: { private: true } })
          .on('broadcast', { event: 'refresh' }, refreshClients)
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') refreshClients();
            if (status === 'CHANNEL_ERROR')
              console.error('Supabase Realtime connection unavailable.');
          });
      }
    } catch (error) {
      next(error);
    }
  });
  app.locals.stopRealtime = async () => {
    for (const res of responses) res.end();
    if (channel) await client.removeChannel(channel);
    channel = null;
  };
};
