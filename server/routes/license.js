const license = require('../license');
const { db } = require('../db');

module.exports = (router) => {
  router.get('/api/license/status', (req, res, params, ctx) => {
    ctx.json(200, license.status());
  }, { auth: false });

  router.post('/api/license/activate', (req, res, params, ctx) => {
    const b = ctx.body || {};
    if (!b.key) return ctx.json(400, { error: 'أدخلي مفتاح الترخيص' });
    const r = license.activate(b.key, b.customer);
    if (!r.ok) return ctx.json(400, { error: r.error });
    try {
      if (r.status && r.status.customer) {
        db.prepare("INSERT INTO settings (key, value) VALUES ('shop_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(r.status.customer);
      }
    } catch (e) { /* settings table missing is impossible after boot; ignore */ }
    ctx.json(200, r.status);
  }, { auth: false });
};
