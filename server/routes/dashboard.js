const { db } = require('../db');

module.exports = (router) => {
  router.get('/api/dashboard/summary', (req, res, params, ctx) => {
    const today = db.prepare(`SELECT COALESCE(SUM(amount),0) AS revenue, COUNT(*) AS count FROM revenue_events WHERE date(event_at) = date('now')`).get();
    const yesterday = db.prepare(`SELECT COALESCE(SUM(amount),0) AS revenue FROM revenue_events WHERE date(event_at) = date('now','-1 day')`).get();
    const bookingsToday = db.prepare(`SELECT COUNT(*) AS c FROM bookings WHERE booking_date = date('now') AND status != 'ملغى'`).get();
    const newCustomersWeek = db.prepare(`SELECT COUNT(*) AS c FROM customers WHERE created_at >= datetime('now','-7 day')`).get();
    const lowStock = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE active = 1 AND quantity <= reorder_threshold`).get();
    const lowStockList = db
      .prepare(`SELECT * FROM products WHERE active = 1 AND quantity <= reorder_threshold ORDER BY quantity ASC LIMIT 6`)
      .all();

    const agenda = db
      .prepare(
        `SELECT b.*, u.name AS staff_name FROM bookings b LEFT JOIN users u ON u.id = b.user_id
         WHERE b.booking_date = date('now') ORDER BY b.start_time`
      )
      .all();

    const topServices = db
      .prepare(
        `SELECT name, COUNT(*) AS cnt FROM (
           SELECT si.name AS name FROM sale_items si JOIN sales s ON s.id = si.sale_id
             WHERE s.status = 'مكتملة' AND s.created_at >= datetime('now','-7 day')
           UNION ALL
           SELECT service_name AS name FROM bookings
             WHERE status = 'مكتمل' AND booking_date >= date('now','-7 day')
         )
         GROUP BY name ORDER BY cnt DESC LIMIT 5`
      )
      .all();

    const recentSales = db
      .prepare(
        `SELECT s.*, u.name AS staff_name FROM sales s LEFT JOIN users u ON u.id = s.user_id
         ORDER BY s.created_at DESC LIMIT 6`
      )
      .all();

    const recentSaleItems = {};
    if (recentSales.length) {
      const ids = recentSales.map((s) => s.id);
      const placeholders = ids.map(() => '?').join(',');
      const itemRows = db.prepare('SELECT sale_id, name FROM sale_items WHERE sale_id IN (' + placeholders + ')').all(...ids);
      itemRows.forEach((r) => { (recentSaleItems[r.sale_id] = recentSaleItems[r.sale_id] || []).push(r.name); });
    }
    recentSales.forEach((s) => { s.item_names = (recentSaleItems[s.id] || []).join(' + '); });

    const trendRows = db
      .prepare(
        `SELECT date(event_at) AS d, COALESCE(SUM(amount),0) AS revenue
         FROM revenue_events WHERE event_at >= datetime('now','-6 days','start of day')
         GROUP BY d ORDER BY d`
      )
      .all();
    const trendMap = {};
    trendRows.forEach((r) => { trendMap[r.d] = r.revenue; });
    const salesTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      salesTrend.push({ date: iso, revenue: trendMap[iso] || 0 });
    }

    ctx.json(200, {
      revenueToday: today.revenue,
      salesCountToday: today.count,
      revenueYesterday: yesterday.revenue,
      bookingsToday: bookingsToday.c,
      newCustomersWeek: newCustomersWeek.c,
      lowStockCount: lowStock.c,
      lowStockList,
      agenda,
      topServices,
      recentSales,
      salesTrend
    });
  });
};
