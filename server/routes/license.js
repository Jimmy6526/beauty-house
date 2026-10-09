const license = require('../license');

module.exports = (router) => {
  router.get('/api/license/status', (req, res, params, ctx) => {
    ctx.json(200, license.status());
  }, { auth: false });

  router.post('/api/license/activate', (req, res, params, ctx) => {
    const b = ctx.body || {};
    if (!b.key) return ctx.json(400, { error: 'أدخلي مفتاح الترخيص' });
    const r = license.activate(b.key, b.customer);
    if (!r.ok) return ctx.json(400, { error: r.error });
    ctx.json(200, r.status);
  }, { auth: false });
};
