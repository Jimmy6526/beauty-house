const { db } = require('../db');
const { METHODS, round2 } = require('../payments');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isMonth(s) { return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s); }

function advanceBalance(userId) {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='advance' THEN amount WHEN type='advance_repay' THEN -amount ELSE 0 END),0) AS bal
       FROM employee_transactions WHERE user_id = ?`
    )
    .get(userId);
  return round2(r.bal);
}

function monthSums(userId, month) {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='bonus' THEN amount ELSE 0 END),0) AS bonuses,
              COALESCE(SUM(CASE WHEN type='deduction' THEN amount ELSE 0 END),0) AS deductions
       FROM employee_transactions WHERE user_id = ? AND month = ?`
    )
    .get(userId, month);
  return { bonuses: round2(r.bonuses), deductions: round2(r.deductions) };
}

function salaryRow(userId, month) {
  return db.prepare("SELECT * FROM employee_transactions WHERE user_id = ? AND month = ? AND type = 'salary'").get(userId, month) || null;
}

module.exports = (router) => {
  /* ---------------- Expenses ---------------- */
  router.get('/api/expenses', (req, res, params, ctx) => {
    const { from, to, category } = ctx.query;
    const where = [];
    const args = [];
    if (isDate(from)) { where.push('expense_date >= ?'); args.push(from); }
    if (isDate(to)) { where.push('expense_date <= ?'); args.push(to); }
    if (category) { where.push('category = ?'); args.push(category); }
    const rows = db
      .prepare(
        `SELECT e.*, u.name AS user_name FROM expenses e LEFT JOIN users u ON u.id = e.user_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.expense_date DESC, e.id DESC LIMIT 1000`
      )
      .all(...args);
    const categories = db.prepare('SELECT DISTINCT category FROM expenses ORDER BY category').all().map((r) => r.category);
    ctx.json(200, { rows, total: round2(rows.reduce((s, r) => s + r.amount, 0)), categories });
  }, { role: 'owner' });

  function readExpense(b) {
    const category = String(b.category || '').trim();
    const amount = round2(b.amount);
    const date = isDate(b.expense_date) ? b.expense_date : todayLocal();
    const method = METHODS.includes(b.method) ? b.method : 'cash';
    if (!category) return { error: 'اختاري تصنيف المصروف' };
    if (!(amount > 0)) return { error: 'أدخلي مبلغاً صحيحاً أكبر من صفر' };
    return { category, amount, date, method, description: String(b.description || '').trim(), notes: String(b.notes || '').trim() };
  }

  router.post('/api/expenses', (req, res, params, ctx) => {
    const e = readExpense(ctx.body || {});
    if (e.error) return ctx.json(400, { error: e.error });
    const info = db
      .prepare('INSERT INTO expenses (category, description, amount, expense_date, method, notes, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(e.category, e.description, e.amount, e.date, e.method, e.notes, ctx.user.id);
    ctx.json(201, db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid));
  }, { role: 'owner' });

  router.put('/api/expenses/:id', (req, res, params, ctx) => {
    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(params.id);
    if (!existing) return ctx.json(404, { error: 'غير موجود' });
    const e = readExpense({ ...existing, ...(ctx.body || {}) });
    if (e.error) return ctx.json(400, { error: e.error });
    db.prepare('UPDATE expenses SET category=?, description=?, amount=?, expense_date=?, method=?, notes=? WHERE id=?')
      .run(e.category, e.description, e.amount, e.date, e.method, e.notes, params.id);
    ctx.json(200, db.prepare('SELECT * FROM expenses WHERE id = ?').get(params.id));
  }, { role: 'owner' });

  router.del('/api/expenses/:id', (req, res, params, ctx) => {
    db.prepare('DELETE FROM expenses WHERE id = ?').run(params.id);
    ctx.json(200, { ok: true });
  }, { role: 'owner' });

  /* ---------------- Payroll ---------------- */
  router.get('/api/payroll/employees', (req, res, params, ctx) => {
    const month = isMonth(ctx.query.month) ? ctx.query.month : todayLocal().slice(0, 7);
    const users = db.prepare('SELECT id, name, role, username, base_salary, active FROM users WHERE active = 1 ORDER BY name').all();
    const rows = users.map((u) => {
      const sums = monthSums(u.id, month);
      const paid = salaryRow(u.id, month);
      const balance = advanceBalance(u.id);
      const gross = round2(u.base_salary + sums.bonuses - sums.deductions);
      return {
        ...u,
        advance_balance: balance,
        bonuses: sums.bonuses,
        deductions: sums.deductions,
        gross,
        suggested_repay: round2(Math.max(0, Math.min(balance, gross))),
        paid: paid ? { id: paid.id, amount: paid.amount, tx_date: paid.tx_date, method: paid.method, advance_repaid: paid.advance_repaid } : null
      };
    });
    ctx.json(200, { month, rows });
  }, { role: 'owner' });

  router.put('/api/payroll/employees/:id/salary', (req, res, params, ctx) => {
    const salary = round2((ctx.body || {}).base_salary);
    if (!(salary >= 0)) return ctx.json(400, { error: 'راتب غير صالح' });
    const info = db.prepare('UPDATE users SET base_salary = ? WHERE id = ?').run(salary, params.id);
    if (!info.changes) return ctx.json(404, { error: 'غير موجودة' });
    ctx.json(200, { ok: true, base_salary: salary });
  }, { role: 'owner' });

  router.get('/api/payroll/transactions', (req, res, params, ctx) => {
    const { user_id, month } = ctx.query;
    const where = [];
    const args = [];
    if (user_id) { where.push('t.user_id = ?'); args.push(Number(user_id)); }
    if (isMonth(month)) { where.push('t.month = ?'); args.push(month); }
    const rows = db
      .prepare(
        `SELECT t.*, u.name AS user_name FROM employee_transactions t JOIN users u ON u.id = t.user_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.tx_date DESC, t.id DESC LIMIT 500`
      )
      .all(...args);
    ctx.json(200, rows);
  }, { role: 'owner' });

  router.post('/api/payroll/transactions', (req, res, params, ctx) => {
    const b = ctx.body || {};
    const type = b.type;
    if (!['advance', 'bonus', 'deduction'].includes(type)) return ctx.json(400, { error: 'نوع العملية غير صالح' });
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(b.user_id));
    if (!user) return ctx.json(400, { error: 'اختاري الموظفة' });
    const amount = round2(b.amount);
    if (!(amount > 0)) return ctx.json(400, { error: 'أدخلي مبلغاً صحيحاً أكبر من صفر' });
    const date = isDate(b.tx_date) ? b.tx_date : todayLocal();
    const month = isMonth(b.month) ? b.month : date.slice(0, 7);
    if (type !== 'advance' && salaryRow(user.id, month)) {
      return ctx.json(400, { error: 'تم صرف راتب هذا الشهر بالفعل — اختاري شهراً آخر أو تراجعي عن صرف الراتب أولاً' });
    }
    const method = type === 'advance' ? (METHODS.includes(b.method) ? b.method : 'cash') : null;
    const info = db
      .prepare('INSERT INTO employee_transactions (user_id, type, amount, month, tx_date, method, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, type, amount, month, date, method, String(b.notes || '').trim(), ctx.user.id);
    ctx.json(201, db.prepare('SELECT * FROM employee_transactions WHERE id = ?').get(info.lastInsertRowid));
  }, { role: 'owner' });

  router.del('/api/payroll/transactions/:id', (req, res, params, ctx) => {
    const t = db.prepare('SELECT * FROM employee_transactions WHERE id = ?').get(params.id);
    if (!t) return ctx.json(404, { error: 'غير موجود' });
    if (t.type === 'salary' || t.type === 'advance_repay') {
      return ctx.json(400, { error: 'لا يمكن حذف هذه العملية مباشرة — استخدمي "التراجع عن صرف الراتب"' });
    }
    if (t.type !== 'advance' && salaryRow(t.user_id, t.month)) {
      return ctx.json(400, { error: 'تم صرف راتب هذا الشهر — تراجعي عن صرف الراتب أولاً' });
    }
    if (t.type === 'advance' && advanceBalance(t.user_id) - t.amount < -0.001) {
      return ctx.json(400, { error: 'لا يمكن حذف هذه السلفة لأنه تم خصم جزء منها من راتب سابق' });
    }
    db.prepare('DELETE FROM employee_transactions WHERE id = ?').run(params.id);
    ctx.json(200, { ok: true });
  }, { role: 'owner' });

  router.post('/api/payroll/pay-salary', (req, res, params, ctx) => {
    const b = ctx.body || {};
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(b.user_id));
    if (!user) return ctx.json(400, { error: 'اختاري الموظفة' });
    const month = isMonth(b.month) ? b.month : null;
    if (!month) return ctx.json(400, { error: 'شهر غير صالح' });
    if (salaryRow(user.id, month)) return ctx.json(400, { error: 'تم صرف راتب هذا الشهر مسبقاً' });

    const sums = monthSums(user.id, month);
    const gross = round2(user.base_salary + sums.bonuses - sums.deductions);
    const balance = advanceBalance(user.id);
    let repay = b.advance_repay == null ? Math.min(balance, Math.max(0, gross)) : round2(b.advance_repay);
    if (repay < 0) repay = 0;
    if (repay > balance + 0.001) return ctx.json(400, { error: 'مبلغ الخصم أكبر من رصيد السلف (' + balance + ')' });
    if (repay > gross + 0.001) return ctx.json(400, { error: 'مبلغ خصم السلفة أكبر من الراتب المستحق' });
    const net = round2(gross - repay);
    if (net < 0) return ctx.json(400, { error: 'الخصومات تتجاوز الراتب المستحق' });
    if (gross <= 0 && net <= 0 && repay <= 0) return ctx.json(400, { error: 'لا يوجد راتب مستحق لهذا الشهر — حددي الراتب الأساسي أولاً' });

    const method = METHODS.includes(b.method) ? b.method : 'cash';
    const date = isDate(b.tx_date) ? b.tx_date : todayLocal();
    db.exec('BEGIN');
    try {
      const info = db
        .prepare(
          `INSERT INTO employee_transactions (user_id, type, amount, month, tx_date, method, notes, base, bonuses, deductions, advance_repaid, created_by)
           VALUES (?, 'salary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(user.id, net, month, date, method, String(b.notes || '').trim(), user.base_salary, sums.bonuses, sums.deductions, repay, ctx.user.id);
      if (repay > 0) {
        db.prepare(
          `INSERT INTO employee_transactions (user_id, type, amount, month, tx_date, notes, salary_id, created_by)
           VALUES (?, 'advance_repay', ?, ?, ?, ?, ?, ?)`
        ).run(user.id, repay, month, date, 'خصم سلفة من راتب ' + month, info.lastInsertRowid, ctx.user.id);
      }
      db.exec('COMMIT');
      ctx.json(201, db.prepare('SELECT * FROM employee_transactions WHERE id = ?').get(info.lastInsertRowid));
    } catch (err) {
      db.exec('ROLLBACK');
      ctx.json(500, { error: 'فشل صرف الراتب', detail: err.message });
    }
  }, { role: 'owner' });

  router.del('/api/payroll/salary/:id', (req, res, params, ctx) => {
    const t = db.prepare("SELECT * FROM employee_transactions WHERE id = ? AND type = 'salary'").get(params.id);
    if (!t) return ctx.json(404, { error: 'غير موجود' });
    db.exec('BEGIN');
    try {
      db.prepare("DELETE FROM employee_transactions WHERE type = 'advance_repay' AND salary_id = ?").run(t.id);
      db.prepare('DELETE FROM employee_transactions WHERE id = ?').run(t.id);
      db.exec('COMMIT');
      ctx.json(200, { ok: true });
    } catch (err) {
      db.exec('ROLLBACK');
      ctx.json(500, { error: 'فشل التراجع', detail: err.message });
    }
  }, { role: 'owner' });

  /* ---------------- Finance overview ---------------- */
  router.get('/api/finance/summary', (req, res, params, ctx) => {
    const today = todayLocal();
    const from = isDate(ctx.query.from) ? ctx.query.from : today.slice(0, 8) + '01';
    const to = isDate(ctx.query.to) ? ctx.query.to : today;

    const incomeSales = round2(db.prepare("SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE status='مكتملة' AND date(created_at) BETWEEN ? AND ?").get(from, to).v);
    const incomeServices = round2(db.prepare("SELECT COALESCE(SUM(price),0) AS v FROM bookings WHERE status='مكتمل' AND booking_date BETWEEN ? AND ?").get(from, to).v);

    const byMethod = {};
    METHODS.forEach((m) => { byMethod[m] = { method: m, in: 0, out: 0, net: 0 }; });
    const addIn = (rows) => rows.forEach((r) => { if (byMethod[r.method]) byMethod[r.method].in += r.amt; });
    const addOut = (rows) => rows.forEach((r) => { if (byMethod[r.method]) byMethod[r.method].out += r.amt; });

    addIn(db.prepare(
      `SELECT p.method AS method, SUM(p.amount) AS amt FROM payments p JOIN sales s ON s.id = p.sale_id
       WHERE s.status='مكتملة' AND date(s.created_at) BETWEEN ? AND ? GROUP BY p.method`).all(from, to));
    addIn(db.prepare(
      `SELECT p.method AS method, SUM(p.amount) AS amt FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE b.status='مكتمل' AND b.booking_date BETWEEN ? AND ? GROUP BY p.method`).all(from, to));

    const expRows = db.prepare('SELECT method, SUM(amount) AS amt FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY method').all(from, to);
    addOut(expRows);
    const expenses = round2(expRows.reduce((s, r) => s + r.amt, 0));

    const salRows = db.prepare("SELECT method, SUM(amount) AS amt FROM employee_transactions WHERE type='salary' AND tx_date BETWEEN ? AND ? GROUP BY method").all(from, to);
    const advRows = db.prepare("SELECT method, SUM(amount) AS amt FROM employee_transactions WHERE type='advance' AND tx_date BETWEEN ? AND ? GROUP BY method").all(from, to);
    addOut(salRows);
    addOut(advRows);
    const payrollSalaries = round2(salRows.reduce((s, r) => s + r.amt, 0));
    const payrollAdvances = round2(advRows.reduce((s, r) => s + r.amt, 0));
    const payroll = round2(payrollSalaries + payrollAdvances);

    const income = round2(incomeSales + incomeServices);
    const methods = Object.values(byMethod).map((m) => ({
      method: m.method, in: round2(m.in), out: round2(m.out), net: round2(m.in - m.out)
    }));

    const expensesByCategory = db
      .prepare('SELECT category, SUM(amount) AS total, COUNT(*) AS cnt FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC')
      .all(from, to);

    const trend = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = d.getFullYear() + '-' + pad(d.getMonth() + 1);
      const inc = db.prepare(
        `SELECT COALESCE(SUM(amount),0) AS v FROM revenue_events WHERE strftime('%Y-%m', event_at) = ?`).get(ym).v;
      const exp = db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE strftime('%Y-%m', expense_date) = ?").get(ym).v;
      const pay = db.prepare(
        "SELECT COALESCE(SUM(amount),0) AS v FROM employee_transactions WHERE type IN ('salary','advance') AND strftime('%Y-%m', tx_date) = ?").get(ym).v;
      trend.push({ ym, income: round2(inc), expenses: round2(exp), payroll: round2(pay) });
    }

    const advancesOutstanding = round2(db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='advance' THEN amount WHEN type='advance_repay' THEN -amount ELSE 0 END),0) AS v FROM employee_transactions`).get().v);

    ctx.json(200, {
      from, to,
      income, income_sales: incomeSales, income_services: incomeServices,
      expenses, payroll, payroll_salaries: payrollSalaries, payroll_advances: payrollAdvances,
      net: round2(income - expenses - payroll),
      by_method: methods,
      expenses_by_category: expensesByCategory.map((r) => ({ category: r.category, total: round2(r.total), cnt: r.cnt })),
      trend,
      advances_outstanding: advancesOutstanding
    });
  }, { role: 'owner' });
};
