const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const { spawn } = require('node:child_process');

const config = require('./config');
const { db } = require('./db');
const router = require('./router');
const license = require('./license');
const branding = require('./branding');

const PORT = process.env.PORT || 5173;
const PUBLIC_DIR = config.PUBLIC_DIR;

const serverCtx = {
  restartAfterResponse() {
    setTimeout(() => {
      if (config.supervised) { // the Windows service restarts us
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000);
        return;
      }
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

['auth', 'items', 'products', 'customers', 'bookings', 'sales', 'settings', 'staff', 'dashboard', 'reports', 'upload', 'backup', 'finance', 'license', 'setup', 'branding'].forEach((name) => {
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
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
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

function inside(base, target) {
  return target === base || target.startsWith(base + path.sep);
}

let setupDone = !config.freshInstall;
function setupNeeded() {
  if (setupDone) return false;
  const c = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (c > 0) setupDone = true;
  return c === 0;
}

const OPEN_PAGES = new Set(['activate.html', 'setup.html']);

function redirect(res, to) {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
  res.end();
}

function serveStatic(req, res, pathname) {
  // dynamic web-app manifest + branding icons (custom logo falls back to the Nova default)
  if (pathname === '/manifest.webmanifest') {
    let shop = '';
    try { const r = db.prepare("SELECT value FROM settings WHERE key = 'shop_name'").get(); shop = r ? r.value : ''; } catch (e) { /* ignore */ }
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(branding.manifest(shop)));
  }

  let filePath;
  const isHtml = pathname === '/' || pathname === '' || path.extname(pathname).toLowerCase() === '.html';
  if (isHtml) {
    const page = pathname === '/' || pathname === '' ? 'login.html' : pathname.slice(1);
    if (config.enforceLicense && !license.status().allowed && page !== 'activate.html') return redirect(res, '/activate.html');
    if (!OPEN_PAGES.has(page) && setupNeeded()) return redirect(res, '/setup.html');
    if (page === 'setup.html' && !setupNeeded()) return redirect(res, '/login.html');
  }

  if (pathname.startsWith('/branding/')) {
    const name = path.basename(pathname);
    const m = /^icon-(\d+)\.png$/.exec(name);
    filePath = m ? branding.iconFile(Number(m[1])) : name === 'app.ico' ? branding.icoFile() : path.join(config.BRANDING_DIR, name);
  } else if (pathname.startsWith('/uploads/')) {
    filePath = path.join(config.UPLOAD_DIR, pathname.slice('/uploads/'.length));
    if (!inside(config.UPLOAD_DIR, filePath)) { res.writeHead(403); return res.end('Forbidden'); }
  } else {
    filePath = path.join(PUBLIC_DIR, pathname);
    if (pathname === '/' || pathname === '') filePath = path.join(PUBLIC_DIR, 'login.html');
    if (!inside(PUBLIC_DIR, filePath)) { res.writeHead(403); return res.end('Forbidden'); }
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - غير موجود');
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (pathname.startsWith('/branding/')) headers['Cache-Control'] = 'no-cache';
    else if (ext === '.woff2') headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    res.writeHead(200, headers);
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

  if (config.enforceLicense && !pathname.startsWith('/api/license/') && !(pathname === '/api/settings' && req.method === 'GET') && !license.status().allowed) {
    res.writeHead(402, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'يلزم تفعيل النظام بمفتاح ترخيص', code: 'license' }));
  }

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

const onListening = () => console.log(config.productNameEn + ' running at http://localhost:' + PORT + (config.isDev ? ' (dev mode)' : ''));
if (config.host) server.listen(PORT, config.host, onListening); else server.listen(PORT, onListening);

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
