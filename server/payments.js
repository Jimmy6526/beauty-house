const { db } = require('./db');

const METHODS = ['cash', 'bankak', 'ocash'];

function round2(n) { return Math.round(Number(n) * 100) / 100; }

// Returns { list, error }. `payments` may be undefined (falls back to a single payment of `total`).
function normalizePayments(payments, total, fallbackMethod) {
  total = round2(total);
  let list;
  if (Array.isArray(payments) && payments.length) {
    const merged = {};
    for (const p of payments) {
      const amount = round2(p && p.amount);
      if (!p || !METHODS.includes(p.method)) return { error: 'وسيلة دفع غير صالحة' };
      if (!(amount > 0)) continue;
      merged[p.method] = round2((merged[p.method] || 0) + amount);
    }
    list = Object.keys(merged).map((m) => ({ method: m, amount: merged[m] }));
    const sum = round2(list.reduce((s, p) => s + p.amount, 0));
    if (Math.abs(sum - total) > 0.01) {
      return { error: 'مجموع مبالغ وسائل الدفع (' + sum + ') لا يساوي الإجمالي (' + total + ')' };
    }
  } else {
    const method = METHODS.includes(fallbackMethod) ? fallbackMethod : 'cash';
    list = [{ method, amount: total }];
  }
  return { list };
}

function summaryMethod(list) {
  return list.length > 1 ? 'split' : list[0].method;
}

function savePayments(ref, list) {
  const col = ref.saleId ? 'sale_id' : 'booking_id';
  const id = ref.saleId || ref.bookingId;
  db.prepare('DELETE FROM payments WHERE ' + col + ' = ?').run(id);
  const ins = db.prepare('INSERT INTO payments (' + col + ', method, amount) VALUES (?, ?, ?)');
  for (const p of list) ins.run(id, p.method, p.amount);
}

function getPayments(ref) {
  const col = ref.saleId ? 'sale_id' : 'booking_id';
  const id = ref.saleId || ref.bookingId;
  return db.prepare('SELECT method, amount FROM payments WHERE ' + col + ' = ? ORDER BY id').all(id);
}

module.exports = { METHODS, normalizePayments, summaryMethod, savePayments, getPayments, round2 };
