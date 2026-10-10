const { db } = require('../db');
const license = require('../license');

// Applies the identity lock: a licensed install always shows (and keeps) the name from the signed license.
function readSettings() {
  const obj = {};
  db.prepare('SELECT key, value FROM settings').all().forEach((r) => { obj[r.key] = r.value; });
  const locked = license.licensedName();
  if (locked) { obj.shop_name = locked; obj.shop_name_locked = '1'; }
  return obj;
}

module.exports = (router) => {
  router.get('/api/settings', (req, res, params, ctx) => {
    ctx.json(200, readSettings());
  }, { auth: false });

  router.put('/api/settings', (req, res, params, ctx) => {
    const b = Object.assign({}, ctx.body || {});
    const locked = license.licensedName();
    if (locked) {
      if (b.shop_name !== undefined && license.normName(b.shop_name) !== license.normName(locked)) {
        return ctx.json(400, { error: 'اسم المنشأة مرتبط بالترخيص ولا يمكن تعديله. لتغييره اطلبي ترخيصاً جديداً من مزوّد النظام.' });
      }
      delete b.shop_name;
      delete b.shop_name_locked;
    }
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    for (const [k, v] of Object.entries(b)) {
      upsert.run(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    ctx.json(200, readSettings());
  }, { role: 'owner' });
};
