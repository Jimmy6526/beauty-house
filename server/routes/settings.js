const { db } = require('../db');

module.exports = (router) => {
  router.get('/api/settings', (req, res, params, ctx) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const obj = {};
    rows.forEach((r) => { obj[r.key] = r.value; });
    ctx.json(200, obj);
  }, { auth: false });

  router.put('/api/settings', (req, res, params, ctx) => {
    const b = ctx.body || {};
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    for (const [k, v] of Object.entries(b)) {
      upsert.run(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const obj = {};
    rows.forEach((r) => { obj[r.key] = r.value; });
    ctx.json(200, obj);
  }, { role: 'owner' });
};
