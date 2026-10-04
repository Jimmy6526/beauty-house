const { db } = require('../db');

module.exports = (router) => {
  router.get('/api/items', (req, res, params, ctx) => {
    const type = ctx.query.type;
    let rows;
    if (type) rows = db.prepare('SELECT * FROM catalog_items WHERE type = ? ORDER BY category, name').all(type);
    else rows = db.prepare('SELECT * FROM catalog_items ORDER BY type, category, name').all();
    ctx.json(200, rows);
  });

  router.post('/api/items', (req, res, params, ctx) => {
    const { name, type, category, duration_minutes, price, image_url } = ctx.body || {};
    if (!name || !type || !category) return ctx.json(400, { error: 'الاسم والنوع والفئة مطلوبة' });
    const info = db
      .prepare('INSERT INTO catalog_items (name, type, category, duration_minutes, price, image_url) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name.trim(), type, category, duration_minutes || null, Number(price) || 0, image_url || null);
    ctx.json(201, db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/api/items/:id', (req, res, params, ctx) => {
    const existing = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(params.id);
    if (!existing) return ctx.json(404, { error: 'غير موجود' });
    const b = ctx.body || {};
    db.prepare(
      'UPDATE catalog_items SET name=?, category=?, duration_minutes=?, price=?, image_url=?, active=? WHERE id=?'
    ).run(
      b.name ?? existing.name,
      b.category ?? existing.category,
      b.duration_minutes ?? existing.duration_minutes,
      b.price != null ? Number(b.price) : existing.price,
      b.image_url !== undefined ? b.image_url : existing.image_url,
      b.active != null ? (b.active ? 1 : 0) : existing.active,
      params.id
    );
    ctx.json(200, db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(params.id));
  });

  router.del('/api/items/:id', (req, res, params, ctx) => {
    db.prepare('DELETE FROM catalog_items WHERE id = ?').run(params.id);
    ctx.json(200, { ok: true });
  });
};
