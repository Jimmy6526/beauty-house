#!/usr/bin/env node
// Nova Beauty — License Key Generator (DEVELOPER ONLY, never ship this folder to customers).
//   node keygen.js            -> opens the local web UI on http://127.0.0.1:47199
//   node keygen.js init       -> create the signing key pair (once)
//   node keygen.js issue --machine XXXXX-XXXXX-XXXXX-XXXXX --customer "اسم المنشأة" --type full|annual|trial [--days 365 | --expires 2027-01-31]
//   node keygen.js list       -> show issued licenses
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const KEYS_DIR = path.join(__dirname, 'keys');
const PRIVATE_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_PATH = path.join(KEYS_DIR, 'public.pem');
const APP_PUBLIC_PATH = path.join(__dirname, '..', '..', 'server', 'license-public.pem');
const ISSUED_PATH = path.join(__dirname, 'issued.json');
const PRODUCT = 'nova-aljamal';
const KEY_PREFIX = 'NOVA1.';
const MACHINE_RE = /^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/;

function initKeys(force) {
  if (fs.existsSync(PRIVATE_PATH) && !force) throw new Error('المفتاح الخاص موجود مسبقاً. استخدم --force فقط إن كنت تريد إبطال كل التراخيص السابقة!');
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(PRIVATE_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(PUBLIC_PATH, pub);
  fs.writeFileSync(APP_PUBLIC_PATH, pub);
  return PUBLIC_PATH;
}

function normMachine(v) {
  const raw = String(v || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return raw.length === 20 ? raw.match(/.{5}/g).join('-') : String(v || '').trim().toUpperCase();
}
function saveIssued(list) { fs.writeFileSync(ISSUED_PATH, JSON.stringify(list, null, 2)); }
function loadIssued() { try { return JSON.parse(fs.readFileSync(ISSUED_PATH, 'utf8')); } catch (e) { return []; } }

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

function issue(opts) {
  if (!fs.existsSync(PRIVATE_PATH)) throw new Error('لم يتم إنشاء مفاتيح التوقيع بعد. شغّل: node keygen.js init');
  const machine = normMachine(opts.machine);
  const customer = String(opts.customer || '').trim().replace(/\s+/g, ' ');
  const type = opts.type || 'full';
  if (!MACHINE_RE.test(machine)) throw new Error('معرّف الجهاز غير صحيح — يجب أن يكون بالشكل XXXXX-XXXXX-XXXXX-XXXXX');
  if (!customer) throw new Error('اسم المنشأة مطلوب');
  if (!['full', 'annual', 'trial'].includes(type)) throw new Error('نوع الترخيص غير صالح');
  let expires = null;
  if (opts.expires) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.expires)) throw new Error('تاريخ الانتهاء يجب أن يكون YYYY-MM-DD');
    expires = opts.expires;
  } else if (type !== 'full') {
    const days = Number(opts.days) || (type === 'annual' ? 365 : 30);
    const d = new Date(); d.setDate(d.getDate() + days); expires = ymd(d);
  }
  const payload = {
    v: 1, product: PRODUCT, id: 'LIC-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    customer, machine, type, issued: ymd(new Date()), expires
  };
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, data, crypto.createPrivateKey(fs.readFileSync(PRIVATE_PATH)));
  const key = KEY_PREFIX + data.toString('base64url') + '.' + sig.toString('base64url');
  const log = loadIssued();
  log.unshift({ ...payload, key, phone: String(opts.phone || '').trim(), note: String(opts.note || '').trim().slice(0, 500), created_at: new Date().toISOString() });
  saveIssued(log);
  return { key, payload };
}

/* ---------------- Verify an existing key (developer side) ---------------- */
function verifyAny(text) {
  const raw = String(text || '').replace(/\s+/g, '');
  if (!raw.startsWith(KEY_PREFIX)) throw new Error('صيغة المفتاح غير صحيحة (يجب أن يبدأ بـ NOVA1.)');
  const [p64, s64] = raw.slice(KEY_PREFIX.length).split('.');
  if (!p64 || !s64) throw new Error('المفتاح غير مكتمل');
  const data = Buffer.from(p64, 'base64url');
  const pub = crypto.createPublicKey(fs.readFileSync(PUBLIC_PATH));
  const valid = crypto.verify(null, data, pub, Buffer.from(s64, 'base64url'));
  return { valid, payload: JSON.parse(data.toString('utf8')) };
}

/* ---------------- Web UI ---------------- */
const UI_PATH = path.join(__dirname, 'ui.html');
const PORT = 47199;

function startUi(autoExit) {
  let lastPing = 0;
  const server = http.createServer((req, res) => {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    const host = String(req.headers.host || '');
    // local-only tool: refuse DNS-rebinding and cross-site requests
    if (host !== '127.0.0.1:' + PORT && host !== 'localhost:' + PORT) { res.writeHead(403); return res.end(); }
    if (req.method === 'POST') {
      const o = req.headers.origin;
      if (o && o !== 'http://' + host) { res.writeHead(403); return res.end(); }
    }
    const url = req.url.split('?')[0];
    if (req.method === 'GET') {
      if (url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(UI_PATH)); }
      const fm = /^\/fonts\/(cairo-(?:arabic|latin)-\d{3}\.woff2)$/.exec(url);
      if (fm) { res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=86400' }); return res.end(fs.readFileSync(path.join(__dirname, 'fonts', fm[1]))); }
      if (url === '/favicon.png' || url === '/icon.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(fs.readFileSync(path.join(__dirname, 'keygen-256.png'))); }
      if (url === '/favicon.ico') { res.writeHead(200, { 'Content-Type': 'image/x-icon' }); return res.end(fs.readFileSync(path.join(__dirname, 'keygen.ico'))); }
      if (url === '/api/state') return json(200, { hasKeys: fs.existsSync(PRIVATE_PATH), fingerprint: fingerprint() });
      if (url === '/api/issued') return json(200, loadIssued());
      if (url === '/api/export.csv') {
        const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const rows = [['الرقم', 'المنشأة', 'الهاتف', 'النوع', 'الجهاز', 'تاريخ الإصدار', 'ينتهي', 'ملاحظات']].concat(
          loadIssued().map((x) => [x.id, x.customer, x.phone, x.type, x.machine, x.issued, x.expires || 'دائم', x.note]));
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="licenses-' + ymd(new Date()) + '.csv"' });
        return res.end('\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n'));
      }
      if (url === '/api/backup-keys') {
        if (!fs.existsSync(PRIVATE_PATH)) return json(404, { error: 'لا توجد مفاتيح' });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="nova-license-keys-backup-' + ymd(new Date()) + '.json"' });
        return res.end(JSON.stringify({ app: 'nova-aljamal', created: new Date().toISOString(), private: fs.readFileSync(PRIVATE_PATH, 'utf8'), public: fs.readFileSync(PUBLIC_PATH, 'utf8'), issued: loadIssued() }, null, 2));
      }
      res.writeHead(404); return res.end();
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
      req.on('end', () => {
        try {
          const b = JSON.parse(body || '{}');
          if (url === '/api/ping') { lastPing = Date.now(); return json(200, { ok: true }); }
          if (url === '/api/issue') return json(200, issue(b));
          if (url === '/api/verify') return json(200, verifyAny(b.key));
          if (url === '/api/update') {
            const list = loadIssued(); const x = list.find((r) => r.id === b.id);
            if (!x) throw new Error('السجل غير موجود');
            if (b.note !== undefined) x.note = String(b.note).slice(0, 500);
            if (b.phone !== undefined) x.phone = String(b.phone).slice(0, 40);
            saveIssued(list); return json(200, { ok: true });
          }
          if (url === '/api/delete') { saveIssued(loadIssued().filter((r) => r.id !== b.id)); return json(200, { ok: true }); }
          if (url === '/api/shutdown') { json(200, { ok: true }); return setTimeout(() => process.exit(0), 200); }
          res.writeHead(404); res.end();
        } catch (e) { json(400, { error: e.message }); }
      });
      return;
    }
    res.writeHead(405); res.end();
  });
  server.on('error', (e) => { if (e.code === 'EADDRINUSE') { console.log('الأداة تعمل بالفعل على المنفذ ' + PORT); process.exit(0); } throw e; });
  server.listen(PORT, '127.0.0.1', () => console.log('أداة ترخيص محلات التجميل تعمل على: http://127.0.0.1:' + PORT));
  // launched from the desktop icon: close the background process once the window is closed
  if (autoExit) setInterval(() => { if (lastPing && Date.now() - lastPing > 180000) process.exit(0); }, 5000);
}

function fingerprint() {
  try { return crypto.createHash('sha256').update(fs.readFileSync(PUBLIC_PATH, 'utf8')).digest('hex').slice(0, 16).toUpperCase().match(/.{4}/g).join('-'); } catch (e) { return ''; }
}

/* ---------------- CLI ---------------- */
function arg(name) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : undefined; }
const cmd = process.argv[2];
try {
  if (cmd === 'init') { initKeys(process.argv.includes('--force')); console.log('تم إنشاء المفاتيح.\nالمفتاح الخاص: ' + PRIVATE_PATH + '\n(احتفظ بنسخة احتياطية آمنة منه — بدونه لا يمكنك إصدار تراخيص جديدة، ولا ترفعه إلى GitHub)\nتم تحديث المفتاح العام داخل التطبيق: ' + APP_PUBLIC_PATH); }
  else if (cmd === 'issue') { const r = issue({ machine: arg('machine'), customer: arg('customer'), type: arg('type'), days: arg('days'), expires: arg('expires') }); console.log(r.key); }
  else if (cmd === 'list') { console.table(loadIssued().map((x) => ({ id: x.id, customer: x.customer, type: x.type, machine: x.machine, expires: x.expires, issued: x.issued }))); }
  else if (!cmd || cmd === 'ui') { if (!fs.existsSync(PRIVATE_PATH)) console.log('تنبيه: لا توجد مفاتيح توقيع بعد. شغّل أولاً: node keygen.js init'); startUi(process.argv.includes('--auto-exit')); }
  else console.log('الأوامر: init | issue | list | ui');
} catch (e) { console.error('خطأ: ' + e.message); process.exit(1); }

