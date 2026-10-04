const { db } = require('../db');

module.exports = (router) => {
  router.get('/api/bookings', (req, res, params, ctx) => {
    const { from, to } = ctx.query;
    let rows;
    if (from && to) {
      rows = db
        .prepare(
          `SELECT b.*, u.name AS staff_name FROM bookings b
           LEFT JOIN users u ON u.id = b.user_id
           WHERE b.booking_date BETWEEN ? AND ?
           ORDER BY b.booking_date, b.start_time`
        )
        .all(from, to);
    } else {
      rows = db
        .prepare(
          `SELECT b.*, u.name AS staff_name FROM bookings b LEFT JOIN users u ON u.id = b.user_id
           ORDER BY b.booking_date DESC, b.start_time DESC LIMIT 200`
        )
        .all();
    }
    ctx.json(200, rows);
  });

  router.get('/api/bookings/:id', (req, res, params, ctx) => {
    const row = db.prepare('SELECT b.*, u.name AS staff_name FROM bookings b LEFT JOIN users u ON u.id=b.user_id WHERE b.id = ?').get(params.id);
    if (!row) return ctx.json(404, { error: 'غير موجود' });
    ctx.json(200, row);
  });

  router.post('/api/bookings', (req, res, params, ctx) => {
    const b = ctx.body || {};
    if (!b.customer_name || !b.booking_date || !b.start_time || !b.service_name) {
      return ctx.json(400, { error: 'بيانات الحجز ناقصة' });
    }

    let customerId = b.customer_id || null;
    if (!customerId) {
      let existing = db.prepare('SELECT * FROM customers WHERE name = ?').get(b.customer_name.trim());
      if (!existing) {
        const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(b.customer_name.trim(), b.phone || '');
        existing = { id: info.lastInsertRowid };
      }
      customerId = existing.id;
    }

    const info = db
      .prepare(
        `INSERT INTO bookings (customer_id, customer_name, user_id, catalog_item_id, service_name, booking_date, start_time, duration_minutes, price, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        customerId,
        b.customer_name.trim(),
        b.user_id || null,
        b.catalog_item_id || null,
        b.service_name,
        b.booking_date,
        b.start_time,
        Number(b.duration_minutes) || 30,
        Number(b.price) || 0,
        b.status || 'مؤكد',
        b.notes || ''
      );

    ctx.json(201, db.prepare('SELECT b.*, u.name AS staff_name FROM bookings b LEFT JOIN users u ON u.id=b.user_id WHERE b.id = ?').get(info.lastInsertRowid));
  }, { perm: 'bookings' });

  router.put('/api/bookings/:id', (req, res, params, ctx) => {
    const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(params.id);
    if (!existing) return ctx.json(404, { error: 'غير موجود' });
    if (existing.status === 'ملغى' && !(ctx.body && ctx.body.status && ctx.body.status !== 'ملغى')) {
      return ctx.json(400, { error: 'لا يمكن تعديل حجز ملغى — يمكن حذفه فقط' });
    }
    const b = ctx.body || {};
    db.prepare(
      `UPDATE bookings SET status=?, notes=?, booking_date=?, start_time=?, user_id=?, catalog_item_id=?, service_name=?, duration_minutes=?, price=?, payment_method=?, customer_name=? WHERE id=?`
    ).run(
      b.status ?? existing.status,
      b.notes ?? existing.notes,
      b.booking_date ?? existing.booking_date,
      b.start_time ?? existing.start_time,
      b.user_id ?? existing.user_id,
      b.catalog_item_id ?? existing.catalog_item_id,
      b.service_name ?? existing.service_name,
      b.duration_minutes != null ? Number(b.duration_minutes) : existing.duration_minutes,
      b.price != null ? Number(b.price) : existing.price,
      b.payment_method ?? existing.payment_method,
      b.customer_name ?? existing.customer_name,
      params.id
    );
    ctx.json(200, db.prepare('SELECT b.*, u.name AS staff_name FROM bookings b LEFT JOIN users u ON u.id=b.user_id WHERE b.id = ?').get(params.id));
  }, { perm: 'bookings' });

  router.del('/api/bookings/:id', (req, res, params, ctx) => {
    const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(params.id);
    if (!existing) return ctx.json(404, { error: 'غير موجود' });
    if (existing.status !== 'ملغى') return ctx.json(400, { error: 'يجب إلغاء الحجز أولاً قبل حذفه' });
    db.prepare('DELETE FROM bookings WHERE id = ?').run(params.id);
    ctx.json(200, { ok: true });
  }, { role: 'owner' });
};
