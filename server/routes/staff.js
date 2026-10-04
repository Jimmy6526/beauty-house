const { db } = require('../db');
const { hashPassword } = require('../auth');

module.exports = (router) => {
  router.get('/api/staff', (req, res, params, ctx) => {
    const rows = db
      .prepare('SELECT id, name, role, phone, email, username, can_login, active, permissions, created_at FROM users ORDER BY created_at')
      .all();
    ctx.json(200, rows);
  });

  router.post('/api/staff', (req, res, params, ctx) => {
    const b = ctx.body || {};
    if (!b.name || !b.username || !b.password) return ctx.json(400, { error: 'الاسم واسم المستخدم وكلمة المرور مطلوبة' });
    if (b.password.length < 6) return ctx.json(400, { error: 'كلمة المرور يجب ألا تقل عن 6 أحرف' });
    const usernameTaken = db.prepare('SELECT id FROM users WHERE username = ?').get(b.username.trim());
    if (usernameTaken) return ctx.json(400, { error: 'اسم المستخدم مستخدم بالفعل' });
    const { hash, salt } = hashPassword(b.password);
    const permissions = Array.isArray(b.permissions) ? JSON.stringify(b.permissions) : null;
    try {
      const info = db
        .prepare(
          'INSERT INTO users (name, role, phone, email, username, password_hash, password_salt, can_login, permissions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(b.name.trim(), b.role || 'staff', b.phone || '', (b.email && b.email.trim()) || null, b.username.trim(), hash, salt, b.can_login === false ? 0 : 1, permissions);
      ctx.json(201, db.prepare('SELECT id, name, role, phone, email, username, can_login, active, permissions FROM users WHERE id = ?').get(info.lastInsertRowid));
    } catch (err) {
      if (String(err.message).indexOf('email') !== -1) return ctx.json(400, { error: 'البريد الإلكتروني مستخدم بالفعل' });
      ctx.json(500, { error: 'فشل إنشاء الحساب', detail: err.message });
    }
  }, { role: 'owner' });

  router.put('/api/staff/:id', (req, res, params, ctx) => {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
    if (!existing) return ctx.json(404, { error: 'غير موجودة' });
    const b = ctx.body || {};

    const willDeactivate = (b.active != null && !b.active) || (b.can_login != null && !b.can_login);
    if (willDeactivate && Number(params.id) === ctx.user.id) {
      return ctx.json(400, { error: 'لا يمكنك إلغاء تفعيل حسابك الحالي بنفسك' });
    }
    if (existing.role === 'owner' && (b.role && b.role !== 'owner' || willDeactivate)) {
      const otherActiveOwners = db
        .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'owner' AND active = 1 AND can_login = 1 AND id != ?")
        .get(params.id).c;
      if (otherActiveOwners === 0) {
        return ctx.json(400, { error: 'لا يمكن إلغاء تفعيل أو تنزيل آخر مديرة نشطة في النظام' });
      }
    }

    if (b.username && b.username.trim() !== existing.username) {
      const usernameTaken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(b.username.trim(), params.id);
      if (usernameTaken) return ctx.json(400, { error: 'اسم المستخدم مستخدم بالفعل' });
    }

    const permissions = b.permissions !== undefined
      ? (Array.isArray(b.permissions) ? JSON.stringify(b.permissions) : null)
      : existing.permissions;

    db.prepare('UPDATE users SET name=?, role=?, phone=?, email=?, username=?, can_login=?, active=?, permissions=? WHERE id=?').run(
      b.name ?? existing.name,
      b.role ?? existing.role,
      b.phone ?? existing.phone,
      b.email !== undefined ? ((b.email && b.email.trim()) || null) : existing.email,
      b.username ?? existing.username,
      b.can_login != null ? (b.can_login ? 1 : 0) : existing.can_login,
      b.active != null ? (b.active ? 1 : 0) : existing.active,
      permissions,
      params.id
    );
    if (b.password) {
      const { hash, salt } = hashPassword(b.password);
      db.prepare('UPDATE users SET password_hash=?, password_salt=? WHERE id=?').run(hash, salt, params.id);
    }
    ctx.json(200, db.prepare('SELECT id, name, role, phone, email, username, can_login, active, permissions FROM users WHERE id = ?').get(params.id));
  }, { role: 'owner' });

  router.del('/api/staff/:id', (req, res, params, ctx) => {
    if (Number(params.id) === ctx.user.id) return ctx.json(400, { error: 'لا يمكن حذف حسابك الحالي' });
    db.prepare('DELETE FROM users WHERE id = ?').run(params.id);
    ctx.json(200, { ok: true });
  }, { role: 'owner' });
};
