const { db } = require('../db');
const config = require('../config');
const { hashPassword } = require('../auth');

function needed() {
  if (!config.freshInstall) return false;
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
}

module.exports = (router) => {
  router.get('/api/setup/status', (req, res, params, ctx) => {
    ctx.json(200, { needed: needed() });
  }, { auth: false });

  router.post('/api/setup', (req, res, params, ctx) => {
    if (!needed()) return ctx.json(403, { error: 'تم إعداد النظام مسبقاً' });
    const b = ctx.body || {};
    const shop = String(b.shop_name || '').trim();
    const name = String(b.name || '').trim();
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    if (!shop || !name || !username) return ctx.json(400, { error: 'اسم المنشأة واسم المديرة واسم المستخدم مطلوبة' });
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) return ctx.json(400, { error: 'اسم المستخدم: 3 إلى 30 حرفاً إنجليزياً أو أرقاماً (يُسمح بـ _ . -)' });
    if (password.length < 8) return ctx.json(400, { error: 'كلمة المرور يجب ألا تقل عن 8 أحرف' });

    const { hash, salt } = hashPassword(password);
    db.exec('BEGIN');
    try {
      const info = db.prepare(
        "INSERT INTO users (name, role, username, password_hash, password_salt, can_login, active) VALUES (?, 'owner', ?, ?, ?, 1, 1)"
      ).run(name, username, hash, salt);
      if (b.security_question && b.security_answer) {
        const a = hashPassword(String(b.security_answer).trim().toLowerCase());
        db.prepare('UPDATE users SET security_question = ?, security_answer_hash = ?, security_answer_salt = ? WHERE id = ?')
          .run(String(b.security_question).trim(), a.hash, a.salt, info.lastInsertRowid);
      }
      const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      up.run('shop_name', shop);
      if (b.phone) up.run('phone', String(b.phone).trim());
      if (b.currency_label) up.run('currency_label', String(b.currency_label).trim().slice(0, 12));
      if (b.currency_code) up.run('currency_code', String(b.currency_code).trim().slice(0, 6));
      db.exec('COMMIT');
      ctx.json(201, { ok: true });
    } catch (err) {
      db.exec('ROLLBACK');
      ctx.json(500, { error: 'فشل الإعداد', detail: err.message });
    }
  }, { auth: false });
};
