const { db } = require('../db');
const { normalizePayments, summaryMethod, savePayments, getPayments } = require('../payments');

module.exports = (router) => {
  router.get('/api/sales', (req, res, params, ctx) => {
    const limit = Number(ctx.query.limit) || 50;
    const rows = db
      .prepare(
        `SELECT s.*, u.name AS staff_name FROM sales s LEFT JOIN users u ON u.id = s.user_id
         ORDER BY s.created_at DESC LIMIT ?`
      )
      .all(limit);
    ctx.json(200, rows);
  });

  router.get('/api/sales/:id', (req, res, params, ctx) => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(params.id);
    if (!sale) return ctx.json(404, { error: 'غير موجودة' });
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(params.id);
    ctx.json(200, { ...sale, items, payments: getPayments({ saleId: sale.id }) });
  });

  router.post('/api/sales', (req, res, params, ctx) => {
    const b = ctx.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length === 0) return ctx.json(400, { error: 'السلة فارغة' });

    const subtotal = items.reduce((sum, it) => sum + Number(it.unit_price) * Number(it.qty), 0);
    const discountPct = Number(b.discount_pct) || 0;
    const taxPct = Number(b.tax_pct) || 0;
    const discount = Math.round((subtotal * discountPct) / 100 * 100) / 100;
    const taxable = subtotal - discount;
    const tax = Math.round((taxable * taxPct) / 100 * 100) / 100;
    const total = Math.round((taxable + tax) * 100) / 100;

    let customerId = b.customer_id || null;
    let customerName = b.customer_name || 'عميلة نقدية';
    if (!customerId && b.customer_name) {
      let existing = db.prepare('SELECT * FROM customers WHERE name = ?').get(b.customer_name.trim());
      if (!existing && b.save_customer) {
        const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(b.customer_name.trim(), b.customer_phone || '');
        existing = { id: info.lastInsertRowid };
      }
      if (existing) customerId = existing.id;
    }

    const pay = normalizePayments(b.payments, total, b.payment_method);
    if (pay.error) return ctx.json(400, { error: pay.error });

    db.exec('BEGIN');
    try {
      const saleInfo = db
        .prepare(
          `INSERT INTO sales (customer_id, customer_name, user_id, subtotal, discount, tax, total, payment_method)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(customerId, customerName, ctx.user.id, subtotal, discount, tax, total, summaryMethod(pay.list));

      const saleId = saleInfo.lastInsertRowid;
      savePayments({ saleId }, pay.list);
      const insertItem = db.prepare(
        'INSERT INTO sale_items (sale_id, catalog_item_id, product_id, name, unit_price, qty, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const decrementStock = db.prepare('UPDATE products SET quantity = MAX(0, quantity - ?) WHERE id = ?');

      for (const it of items) {
        const lineTotal = Number(it.unit_price) * Number(it.qty);
        insertItem.run(saleId, it.catalog_item_id || null, it.product_id || null, it.name, Number(it.unit_price), Number(it.qty), lineTotal);
        if (it.product_id) decrementStock.run(Number(it.qty), it.product_id);
      }

      db.exec('COMMIT');
      ctx.json(201, db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId));
    } catch (err) {
      db.exec('ROLLBACK');
      ctx.json(500, { error: 'فشل حفظ عملية البيع', detail: err.message });
    }
  }, { perm: 'pos' });

  router.put('/api/sales/:id', (req, res, params, ctx) => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(params.id);
    if (!sale) return ctx.json(404, { error: 'غير موجودة' });
    const b = ctx.body || {};

    if (b.status === 'ملغاة') {
      if (sale.status === 'ملغاة') return ctx.json(200, sale);
      db.exec('BEGIN');
      try {
        const oldItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(params.id);
        const restoreStock = db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?');
        oldItems.forEach((it) => { if (it.product_id) restoreStock.run(it.qty, it.product_id); });
        db.prepare('UPDATE sales SET status = ? WHERE id = ?').run('ملغاة', params.id);
        db.exec('COMMIT');
        ctx.json(200, db.prepare('SELECT * FROM sales WHERE id = ?').get(params.id));
      } catch (err) {
        db.exec('ROLLBACK');
        ctx.json(500, { error: 'فشل إلغاء الفاتورة', detail: err.message });
      }
      return;
    }

    if (sale.status === 'ملغاة') return ctx.json(400, { error: 'لا يمكن تعديل فاتورة ملغاة' });

    if (Array.isArray(b.items)) {
      const items = b.items;
      if (items.length === 0) return ctx.json(400, { error: 'السلة فارغة' });
      const subtotal = items.reduce((sum, it) => sum + Number(it.unit_price) * Number(it.qty), 0);
      const discountPct = Number(b.discount_pct) || 0;
      const taxPct = Number(b.tax_pct) || 0;
      const discount = Math.round((subtotal * discountPct) / 100 * 100) / 100;
      const taxable = subtotal - discount;
      const tax = Math.round((taxable * taxPct) / 100 * 100) / 100;
      const total = Math.round((taxable + tax) * 100) / 100;

      const oldPays = getPayments({ saleId: sale.id });
      if (!b.payments && !b.payment_method && oldPays.length > 1) {
        return ctx.json(400, { error: 'الدفع مقسّم — أعيدي تحديد وسائل الدفع بعد تعديل الأصناف' });
      }
      const pay = normalizePayments(b.payments, total, b.payment_method || (oldPays[0] && oldPays[0].method) || sale.payment_method);
      if (pay.error) return ctx.json(400, { error: pay.error });

      db.exec('BEGIN');
      try {
        const oldItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(params.id);
        const restoreStock = db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?');
        oldItems.forEach((it) => { if (it.product_id) restoreStock.run(it.qty, it.product_id); });
        db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(params.id);
        savePayments({ saleId: sale.id }, pay.list);

        const insertItem = db.prepare(
          'INSERT INTO sale_items (sale_id, catalog_item_id, product_id, name, unit_price, qty, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        const decrementStock = db.prepare('UPDATE products SET quantity = MAX(0, quantity - ?) WHERE id = ?');
        for (const it of items) {
          const lineTotal = Number(it.unit_price) * Number(it.qty);
          insertItem.run(params.id, it.catalog_item_id || null, it.product_id || null, it.name, Number(it.unit_price), Number(it.qty), lineTotal);
          if (it.product_id) decrementStock.run(Number(it.qty), it.product_id);
        }

        db.prepare(
          'UPDATE sales SET subtotal=?, discount=?, tax=?, total=?, payment_method=?, customer_name=?, notes=? WHERE id=?'
        ).run(
          subtotal, discount, tax, total,
          summaryMethod(pay.list),
          b.customer_name ?? sale.customer_name,
          b.notes ?? sale.notes,
          params.id
        );

        db.exec('COMMIT');
        ctx.json(200, db.prepare('SELECT * FROM sales WHERE id = ?').get(params.id));
      } catch (err) {
        db.exec('ROLLBACK');
        ctx.json(500, { error: 'فشل تعديل الفاتورة', detail: err.message });
      }
      return;
    }

    let method = sale.payment_method;
    if (b.payments || b.payment_method) {
      const pay = normalizePayments(b.payments, sale.total, b.payment_method);
      if (pay.error) return ctx.json(400, { error: pay.error });
      savePayments({ saleId: sale.id }, pay.list);
      method = summaryMethod(pay.list);
    }
    db.prepare('UPDATE sales SET payment_method=?, customer_name=?, notes=? WHERE id=?').run(
      method,
      b.customer_name ?? sale.customer_name,
      b.notes ?? sale.notes,
      params.id
    );
    ctx.json(200, db.prepare('SELECT * FROM sales WHERE id = ?').get(params.id));
  }, { perm: 'pos' });

  router.del('/api/sales/:id', (req, res, params, ctx) => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(params.id);
    if (!sale) return ctx.json(404, { error: 'غير موجودة' });
    if (sale.status !== 'ملغاة') return ctx.json(400, { error: 'يجب إلغاء الفاتورة أولاً قبل حذفها' });
    db.prepare('DELETE FROM sales WHERE id = ?').run(params.id);
    ctx.json(200, { ok: true });
  }, { role: 'owner' });
};
