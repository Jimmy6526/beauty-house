const { db } = require('../db');

module.exports = (router) => {
  router.get('/api/reports/summary', (req, res, params, ctx) => {
    const { from, to } = ctx.query;
    const totals = db
      .prepare(`SELECT COALESCE(SUM(amount),0) AS revenue, COUNT(*) AS invoices FROM revenue_events WHERE date(event_at) BETWEEN ? AND ?`)
      .get(from, to);
    const activeCustomers = db
      .prepare(`SELECT COUNT(DISTINCT customer_id) AS c FROM revenue_events WHERE date(event_at) BETWEEN ? AND ? AND customer_id IS NOT NULL`)
      .get(from, to);

    const serviceRevenue = db
      .prepare(`SELECT COALESCE(SUM(price),0) AS r FROM bookings WHERE status = 'مكتمل' AND booking_date BETWEEN ? AND ?`)
      .get(from, to).r;
    const otherRevenue = db
      .prepare(`SELECT COALESCE(SUM(total),0) AS r FROM sales WHERE status = 'مكتملة' AND date(created_at) BETWEEN ? AND ?`)
      .get(from, to).r;

    ctx.json(200, {
      revenue: totals.revenue,
      invoices: totals.invoices,
      avgTicket: totals.invoices ? Math.round((totals.revenue / totals.invoices) * 100) / 100 : 0,
      activeCustomers: activeCustomers.c,
      serviceRevenue,
      otherRevenue
    });
  }, { role: 'owner' });

  router.get('/api/reports/revenue-trend', (req, res, params, ctx) => {
    const rows = db
      .prepare(
        `SELECT strftime('%Y-%m', event_at) AS ym, COALESCE(SUM(amount),0) AS revenue
         FROM revenue_events WHERE event_at >= datetime('now','-6 months')
         GROUP BY ym ORDER BY ym`
      )
      .all();
    ctx.json(200, rows);
  }, { role: 'owner' });

  router.get('/api/reports/top-services', (req, res, params, ctx) => {
    const { from, to } = ctx.query;
    const limit = Number(ctx.query.limit) || 5;
    const rows = db
      .prepare(
        `SELECT name, COUNT(*) AS cnt, SUM(revenue) AS revenue FROM (
           SELECT si.name AS name, si.line_total AS revenue FROM sale_items si JOIN sales s ON s.id = si.sale_id
             WHERE s.status = 'مكتملة' AND date(s.created_at) BETWEEN ? AND ?
           UNION ALL
           SELECT service_name AS name, price AS revenue FROM bookings
             WHERE status = 'مكتمل' AND booking_date BETWEEN ? AND ?
         )
         GROUP BY name ORDER BY revenue DESC LIMIT ?`
      )
      .all(from, to, from, to, limit);
    ctx.json(200, rows);
  }, { role: 'owner' });

  router.get('/api/reports/staff-performance', (req, res, params, ctx) => {
    const { from, to } = ctx.query;
    const rows = db
      .prepare(
        `SELECT u.id, u.name, COALESCE(SUM(re.amount),0) AS revenue, COUNT(*) AS invoices
         FROM revenue_events re JOIN users u ON u.id = re.user_id
         WHERE date(re.event_at) BETWEEN ? AND ?
         GROUP BY u.id ORDER BY revenue DESC`
      )
      .all(from, to);
    ctx.json(200, rows);
  }, { role: 'owner' });

  router.get('/api/reports/peak-hours', (req, res, params, ctx) => {
    const rows = db
      .prepare(
        `SELECT strftime('%w', booking_date) AS dow, CAST(substr(start_time,1,2) AS INTEGER) AS hour, COUNT(*) AS cnt
         FROM bookings WHERE booking_date >= date('now','-30 day') AND status != 'ملغى'
         GROUP BY dow, hour`
      )
      .all();
    ctx.json(200, rows);
  }, { role: 'owner' });
};
