const branding = require('../branding');

module.exports = (router) => {
  router.post('/api/branding/icon', (req, res, params, ctx) => {
    const b = ctx.body || {};
    try {
      if (b.reset) branding.resetIcons();
      else branding.saveIcons(b.icons);
      ctx.json(200, { ok: true, v: Date.now() });
    } catch (err) {
      ctx.json(400, { error: err.message });
    }
  }, { role: 'owner' });
};
