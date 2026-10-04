const { db } = require('../db');

module.exports = (router) => {
  router.get('/api/products', (req, res, params, ctx) => {
    ctx.json(200, db.prepare('SELECT * FROM products ORDER BY name').all());
  });

  router.post('/api/products', (req, res, params, ctx) => {
    const b = ctx.body || {};
    if (!b.name) return ctx.json(400, { error: 'اسم المنتج مطلوب' });
    const info = db
      .prepare(
        'INSERT INTO products (name, category, sku, quantity, reorder_threshold, cost_price, sell_price, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        b.name.trim(),
        b.category || '',
        b.sku || '',
        Number(b.quantity) || 0,
        Number(b.reorder_threshold) || 0,
        Number(b.cost_price) || 0,
        Number(b.sell_price) || 0,
        b.image_url || null
      );
    ctx.json(201, db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
  }, { perm: 'inventory' });

  router.put('/api/products/:id', (req, res, params, ctx) => {
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(params.id);
    if (!existing) return ctx.json(404, { error: 'غير موجود' });
    const b = ctx.body || {};
    db.prepare(
      'UPDATE products SET name=?, category=?, sku=?, quantity=?, reorder_threshold=?, cost_price=?, sell_price=?, image_url=?, active=? WHERE id=?'
    ).run(
      b.name ?? existing.name,
      b.category ?? existing.category,
      b.sku ?? existing.sku,
      b.quantity != null ? Number(b.quantity) : existing.quantity,
      b.reorder_threshold != null ? Number(b.reorder_threshold) : existing.reorder_threshold,
      b.cost_price != null ? Number(b.cost_price) : existing.cost_price,
      b.sell_price != null ? Number(b.sell_price) : existing.sell_price,
      b.image_url !== undefined ? b.image_url : existing.image_url,
      b.active != null ? (b.active ? 1 : 0) : existing.active,
      params.id
    );
    ctx.json(200, db.prepare('SELECT * FROM products WHERE id = ?').get(params.id));
  }, { perm: 'inventory' });

  router.del('/api/products/:id', (req, res, params, ctx) => {
    db.prepare('DELETE FROM products WHERE id = ?').run(params.id);
    ctx.json(200, { ok: true });
  }, { perm: 'inventory' });
};
