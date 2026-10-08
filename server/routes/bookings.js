const { db } = require('../db');
const { normalizePayments, summaryMethod, savePayments, getPayments, round2 } = require('../payments');

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
    ctx.json(200, { ...row, payments: getPayments({ bookingId: row.id }) });
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

    if (b.status === 'مكتمل') {
      const pay = normalizePayments(b.payments, Number(b.price) || 0, b.payment_method);
      if (!pay.error) {
        savePayments({ bookingId: info.lastInsertRowid }, pay.list);
        db.prepare('UPDATE bookings SET payment_method = ? WHERE id = ?').run(summaryMethod(pay.list), info.lastInsertRowid);
      }
    }

    ctx.json(201, db.prepare('SELECT b.*, u.name AS staff_name FROM bookings b LEFT JOIN users u ON u.id=b.user_id WHERE b.id = ?').get(info.lastInsertRowid));
  }, { perm: 'bookings' });

  router.put('/api/bookings/:id', (req, res, params, ctx) => {
    const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(params.id);
    if (!existing) return ctx.json(404, { error: 'غير موجود' });
    if (existing.status === 'ملغى' && !(ctx.body && ctx.body.status && ctx.body.status !== 'ملغى')) {
      return ctx.json(400, { error: 'لا يمكن تعديل حجز ملغى — يمكن حذفه فقط' });
    }
    const b = ctx.body || {};
    const finalStatus = b.status ?? existing.status;
    const finalPrice = b.price != null ? Number(b.price) : existing.price;
    let finalMethod = b.payment_method ?? existing.payment_method;
    let payList = null;

    if (finalStatus === 'مكتمل') {
      const oldPays = getPayments({ bookingId: existing.id });
      const oldSum = round2(oldPays.reduce((s, p) => s + p.amount, 0));
      if (b.payments) {
        const pay = normalizePayments(b.payments, finalPrice, finalMethod);
        if (pay.error) return ctx.json(400, { error: pay.error });
        payList = pay.list;
      } else if (!oldPays.length || (oldPays.length === 1 && (oldSum !== round2(finalPrice) || (b.payment_method && b.payment_method !== oldPays[0].method)))) {
        const pay = normalizePayments(null, finalPrice, finalMethod || (oldPays[0] && oldPays[0].method));
        payList = pay.list;
      } else if (oldPays.length > 1 && oldSum !== round2(finalPrice)) {
        return ctx.json(400, { error: 'الدفع مقسّم — أعيدي تحديد وسائل الدفع بعد تغيير السعر' });
      }
      if (payList) finalMethod = summaryMethod(payList);
      else if (oldPays.length > 1) finalMethod = 'split';
    }

    db.prepare(
      `UPDATE bookings SET status=?, notes=?, booking_date=?, start_time=?, user_id=?, catalog_item_id=?, service_name=?, duration_minutes=?, price=?, payment_method=?, customer_name=? WHERE id=?`
    ).run(
      finalStatus,
      b.notes ?? existing.notes,
      b.booking_date ?? existing.booking_date,
      b.start_time ?? existing.start_time,
      b.user_id ?? existing.user_id,
      b.catalog_item_id ?? existing.catalog_item_id,
      b.service_name ?? existing.service_name,
      b.duration_minutes != null ? Number(b.duration_minutes) : existing.duration_minutes,
      finalPrice,
      finalMethod,
      b.customer_name ?? existing.customer_name,
      params.id
    );
    if (payList) savePayments({ bookingId: existing.id }, payList);
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
