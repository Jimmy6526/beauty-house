const { db } = require('../db');
const { verifyPassword, hashPassword, newToken } = require('../auth');

const SESSION_DAYS = 30;

function createSession(userId) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

module.exports = (router) => {
  router.post('/api/auth/login', (req, res, params, ctx) => {
    const { username, password } = ctx.body || {};
    if (!username || !password) return ctx.json(400, { error: 'أدخلي اسم المستخدم وكلمة المرور' });

    const user = db
      .prepare('SELECT * FROM users WHERE username = ? AND active = 1 AND can_login = 1')
      .get(username.trim());

    if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
      return ctx.json(401, { error: 'بيانات الدخول غير صحيحة' });
    }

    const { token, expires } = createSession(user.id);
    ctx.setCookie('sid', token, expires);
    ctx.json(200, { id: user.id, name: user.name, role: user.role, email: user.email, username: user.username });
  }, { auth: false });

  router.get('/api/auth/security-question', (req, res, params, ctx) => {
    const username = (ctx.query.username || '').trim();
    if (!username) return ctx.json(400, { error: 'أدخلي اسم المستخدم' });
    const user = db.prepare('SELECT security_question FROM users WHERE username = ? AND active = 1').get(username);
    if (!user || !user.security_question) {
      return ctx.json(404, { error: 'لا يوجد سؤال أمان مسجل لهذا الحساب — تواصلي مع المديرة' });
    }
    ctx.json(200, { question: user.security_question });
  }, { auth: false });

  router.post('/api/auth/reset-password', (req, res, params, ctx) => {
    const { username, answer, newPassword } = ctx.body || {};
    if (!username || !answer || !newPassword) return ctx.json(400, { error: 'جميع الحقول مطلوبة' });
    if (newPassword.length < 6) return ctx.json(400, { error: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف' });

    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username.trim());
    if (!user || !user.security_answer_hash || !verifyPassword(answer.trim().toLowerCase(), user.security_answer_hash, user.security_answer_salt)) {
      return ctx.json(400, { error: 'الإجابة غير صحيحة' });
    }
    const { hash, salt } = hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    ctx.json(200, { ok: true });
  }, { auth: false });

  router.put('/api/auth/profile', (req, res, params, ctx) => {
    const b = ctx.body || {};
    db.prepare('UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?').run(
      b.name ?? ctx.user.name,
      b.email ?? ctx.user.email,
      b.phone ?? ctx.user.phone,
      ctx.user.id
    );
    const updated = db.prepare('SELECT id, name, role, email, phone, username FROM users WHERE id = ?').get(ctx.user.id);
    ctx.json(200, updated);
  });

  router.put('/api/auth/security-question', (req, res, params, ctx) => {
    const { question, answer } = ctx.body || {};
    if (!question || !answer) return ctx.json(400, { error: 'السؤال والإجابة مطلوبان' });
    const { hash, salt } = hashPassword(answer.trim().toLowerCase());
    db.prepare('UPDATE users SET security_question = ?, security_answer_hash = ?, security_answer_salt = ? WHERE id = ?')
      .run(question.trim(), hash, salt, ctx.user.id);
    ctx.json(200, { ok: true });
  });

  router.post('/api/auth/logout', (req, res, params, ctx) => {
    const token = ctx.cookies.sid;
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    ctx.setCookie('sid', '', new Date(0).toISOString());
    ctx.json(200, { ok: true });
  }, { auth: false });

  router.get('/api/auth/me', (req, res, params, ctx) => {
    let permissions = null;
    try { permissions = ctx.user.permissions ? JSON.parse(ctx.user.permissions) : null; } catch (e) { permissions = null; }
    ctx.json(200, {
      id: ctx.user.id, name: ctx.user.name, role: ctx.user.role, email: ctx.user.email,
      username: ctx.user.username, hasSecurityQuestion: !!ctx.user.security_question, permissions: permissions
    });
  });

  router.post('/api/auth/change-password', (req, res, params, ctx) => {
    const { currentPassword, newPassword } = ctx.body || {};
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
    if (!verifyPassword(currentPassword || '', user.password_hash, user.password_salt)) {
      return ctx.json(400, { error: 'كلمة المرور الحالية غير صحيحة' });
    }
    if (!newPassword || newPassword.length < 6) {
      return ctx.json(400, { error: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف' });
    }
    const { hash, salt } = hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, user.id);
    ctx.json(200, { ok: true });
  });
};
