const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const { spawn } = require('node:child_process');

const { db } = require('./db');
const router = require('./router');

const PORT = process.env.PORT || 5173;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const serverCtx = {
  restartAfterResponse() {
    setTimeout(() => {
      server.close(() => {
        const child = spawn(process.execPath, [__filename], {
          detached: true,
          stdio: 'ignore',
          cwd: __dirname
        });
        child.unref();
        process.exit(0);
      });
    }, 400);
  }
};

['auth', 'items', 'products', 'customers', 'bookings', 'sales', 'settings', 'staff', 'dashboard', 'reports', 'upload', 'backup'].forEach((name) => {
  require('./routes/' + name)(router, serverCtx);
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 9 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve(null);
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

function getUserFromSession(token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(session.user_id);
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname);
  if (pathname === '/' || pathname === '') filePath = path.join(PUBLIC_DIR, 'login.html');
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - غير موجود');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  if (!pathname.startsWith('/api/')) {
    return serveStatic(req, res, pathname);
  }

  const cookies = parseCookies(req.headers.cookie);
  const matched = router.match(req.method, pathname);

  if (!matched) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'المسار غير موجود' }));
  }

  const user = getUserFromSession(cookies.sid);
  if (matched.auth && !user) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'يجب تسجيل الدخول' }));
  }
  if (matched.role && (!user || user.role !== matched.role)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'هذا الإجراء متاح للمديرة فقط' }));
  }
  if (matched.perm && user && user.role !== 'owner') {
    let allowed;
    try { allowed = user.permissions ? JSON.parse(user.permissions) : null; } catch (e) { allowed = null; }
    if (allowed !== null && allowed.indexOf(matched.perm) === -1) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'ليست لديكِ صلاحية للقيام بهذا الإجراء' }));
    }
  }

  let body = null;
  if (req.method === 'POST' || req.method === 'PUT') {
    body = await readBody(req);
  }

  const cookiesToSet = [];
  const ctx = {
    body,
    query: parsed.query,
    cookies,
    user,
    setCookie(name, value, expiresISO) {
      cookiesToSet.push(`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresISO).toUTCString()}`);
    },
    json(status, obj) {
      const headers = { 'Content-Type': 'application/json; charset=utf-8' };
      if (cookiesToSet.length) headers['Set-Cookie'] = cookiesToSet;
      res.writeHead(status, headers);
      res.end(JSON.stringify(obj));
    }
  };

  try {
    matched.handler(req, res, matched.params, ctx);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'خطأ في الخادم', detail: err.message }));
  }
});

server.listen(PORT, () => {
  console.log('Beauty House server running at http://localhost:' + PORT);
});

/* ---------------- Automatic daily backup ---------------- */
(function scheduleAutoBackup() {
  const backup = require('./routes/backup');
  const DAY_MS = 24 * 60 * 60 * 1000;

  function hasBackupToday() {
    if (!fs.existsSync(backup.BACKUP_DIR)) return false;
    const today = new Date().toISOString().slice(0, 10);
    return fs.readdirSync(backup.BACKUP_DIR).some((f) => f.includes('-auto') && f.startsWith('beautyhouse-backup-' + today));
  }

  function runAutoBackup() {
    try {
      if (!hasBackupToday()) {
        backup.createBackup('auto');
        backup.pruneOldBackups(30);
        console.log('Automatic daily backup created.');
      }
    } catch (err) {
      console.error('Automatic backup failed:', err.message);
    }
  }

  runAutoBackup();
  setInterval(runAutoBackup, DAY_MS);
})();
