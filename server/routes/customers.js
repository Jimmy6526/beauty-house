const { db } = require('../db');

module.exports = (router) => {
  router.get('/api/customers', (req, res, params, ctx) => {
    const rows = db
      .prepare(
        `SELECT c.*,
                COALESCE(SUM(re.amount), 0) AS total_spent,
                COUNT(re.id) AS visits,
                MAX(re.event_at) AS last_sale_at
         FROM customers c
         LEFT JOIN revenue_events re ON re.customer_id = c.id
         GROUP BY c.id
         ORDER BY c.name`
      )
      .all();
    ctx.json(200, rows);
  });

  router.get('/api/customers/:id', (req, res, params, ctx) => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(params.id);
    if (!customer) return ctx.json(404, { error: 'غير موجودة' });

    const stats = db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS total_spent, COUNT(*) AS visits, MAX(event_at) AS last_sale_at
         FROM revenue_events WHERE customer_id = ?`
      )
      .get(params.id);

    const favorites = db
      .prepare(
        `SELECT name, COUNT(*) AS cnt FROM (
           SELECT si.name AS name FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.customer_id = ? AND s.status = 'مكتملة'
           UNION ALL
           SELECT service_name AS name FROM bookings WHERE customer_id = ? AND status = 'مكتمل'
         )
         GROUP BY name ORDER BY cnt DESC LIMIT 5`
      )
      .all(params.id, params.id);

    const history = db
      .prepare(
        `SELECT COALESCE(sale_id, booking_id) AS id, amount AS total, event_at AS created_at, source FROM revenue_events WHERE customer_id = ? ORDER BY event_at DESC LIMIT 5`
      )
      .all(params.id);

    const upcoming = db
      .prepare(
        `SELECT b.*, u.name AS staff_name FROM bookings b LEFT JOIN users u ON u.id = b.user_id
         WHERE b.customer_id = ? AND b.status IN ('مؤكد','قيد الانتظار')
         AND (b.booking_date > date('now') OR (b.booking_date = date('now') AND b.start_time >= strftime('%H:%M','now')))
         ORDER BY b.booking_date ASC, b.start_time ASC LIMIT 1`
      )
      .get(params.id);

    ctx.json(200, { ...customer, ...stats, favorites, history, upcoming: upcoming || null });
  });

  router.post('/api/customers', (req, res, params, ctx) => {
    const b = ctx.body || {};
    if (!b.name) return ctx.json(400, { error: 'اسم العميلة مطلوب' });
    const info = db
      .prepare('INSERT INTO customers (name, phone, notes) VALUES (?, ?, ?)')
      .run(b.name.trim(), b.phone || '', b.notes || '');
    ctx.json(201, db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
  }, { perm: 'customers' });

  router.put('/api/customers/:id', (req, res, params, ctx) => {
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(params.id);
    if (!existing) return ctx.json(404, { error: 'غير موجودة' });
    const b = ctx.body || {};
    db.prepare('UPDATE customers SET name=?, phone=?, notes=? WHERE id=?').run(
      b.name ?? existing.name,
      b.phone ?? existing.phone,
      b.notes ?? existing.notes,
      params.id
    );
    ctx.json(200, db.prepare('SELECT * FROM customers WHERE id = ?').get(params.id));
  }, { perm: 'customers' });

  router.del('/api/customers/:id', (req, res, params, ctx) => {
    db.prepare('DELETE FROM customers WHERE id = ?').run(params.id);
    ctx.json(200, { ok: true });
  }, { perm: 'customers' });

  // find-or-create by name+phone, used by POS/booking quick-create
  router.post('/api/customers/find-or-create', (req, res, params, ctx) => {
    const b = ctx.body || {};
    if (!b.name) return ctx.json(400, { error: 'اسم العميلة مطلوب' });
    let existing = null;
    if (b.phone) existing = db.prepare('SELECT * FROM customers WHERE phone = ? AND phone != ""').get(b.phone);
    if (!existing) existing = db.prepare('SELECT * FROM customers WHERE name = ?').get(b.name.trim());
    if (existing) return ctx.json(200, existing);
    const info = db
      .prepare('INSERT INTO customers (name, phone) VALUES (?, ?)')
      .run(b.name.trim(), b.phone || '');
    ctx.json(201, db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
  });
};
