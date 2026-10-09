#!/usr/bin/env node
// Nova Al-Jamal — License Key Generator (DEVELOPER ONLY, never ship this folder to customers).
//   node keygen.js            -> opens the local web UI on http://127.0.0.1:5199
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

function loadIssued() { try { return JSON.parse(fs.readFileSync(ISSUED_PATH, 'utf8')); } catch (e) { return []; } }

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

function issue(opts) {
  if (!fs.existsSync(PRIVATE_PATH)) throw new Error('لم يتم إنشاء مفاتيح التوقيع بعد. شغّل: node keygen.js init');
  const machine = String(opts.machine || '').trim().toUpperCase();
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
  log.unshift({ ...payload, created_at: new Date().toISOString() });
  fs.writeFileSync(ISSUED_PATH, JSON.stringify(log, null, 2));
  return { key, payload };
}

/* ---------------- Web UI ---------------- */
const UI = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>أداة ترخيص محلات التجميل</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--plum:#6E2A55;--rose:#C03A72;--gold:#E7C278;--ink:#2B1B26;--mut:#77626F;--bd:#E8D6DF}
*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",Tahoma,sans-serif;background:linear-gradient(160deg,#3C1838,#1B0C1C);min-height:100vh;color:var(--ink);padding:28px 16px}
.wrap{max-width:860px;margin:0 auto}
.head{display:flex;align-items:center;gap:14px;color:#fff;margin-bottom:20px}
.logo{width:54px;height:54px;border-radius:50%;background:radial-gradient(circle,#FFF7F1,#F6E4D6);box-shadow:0 0 0 3px var(--gold);display:flex;align-items:center;justify-content:center}
.head h1{margin:0;font-size:22px}.head p{margin:2px 0 0;color:#E3C3D6;font-size:13px}
.card{background:#fff;border-radius:18px;padding:22px;box-shadow:0 20px 50px -20px rgba(0,0,0,.6);margin-bottom:18px}
h2{margin:0 0 14px;font-size:16px;border-inline-start:4px solid var(--gold);padding-inline-start:10px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:block;font-size:12.5px;font-weight:700;margin:12px 0 6px}
input,select,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--bd);border-radius:10px;background:#fff}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--rose);box-shadow:0 0 0 3px rgba(192,58,114,.18)}
.mono{font-family:Consolas,monospace;direction:ltr;text-align:left}
button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:11px 20px;cursor:pointer;color:#fff;background:linear-gradient(135deg,#D4528A,var(--rose));box-shadow:0 10px 20px -10px var(--rose)}
button.sec{background:#fff;color:var(--plum);border:1px solid var(--bd);box-shadow:none}
.err{background:#FCE8E6;color:#C0362C;padding:10px 12px;border-radius:10px;margin-top:12px;display:none;font-weight:600}
.ok{display:none;margin-top:14px}.ok textarea{height:120px;font-family:Consolas,monospace;direction:ltr;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:12.5px}th{text-align:right;color:var(--mut);padding:8px 6px;border-bottom:2px solid var(--bd)}td{padding:8px 6px;border-bottom:1px solid var(--bd)}
.badge{display:inline-block;padding:2px 10px;border-radius:99px;background:#F6E8F0;color:var(--plum);font-weight:700;font-size:11.5px}
@media(max-width:640px){.row{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<div class="head"><div class="logo"><svg width="34" height="34" viewBox="0 0 48 48"><g transform="translate(24,24)" fill="#C03A72"><ellipse cy="-13" rx="6" ry="10"/><ellipse cy="-13" rx="6" ry="10" transform="rotate(72)" fill="#A93268"/><ellipse cy="-13" rx="6" ry="10" transform="rotate(144)" fill="#8E2C5C"/><ellipse cy="-13" rx="6" ry="10" transform="rotate(216)" fill="#8E2C5C"/><ellipse cy="-13" rx="6" ry="10" transform="rotate(288)" fill="#A93268"/><circle r="5" fill="#C99A2E"/></g></svg></div>
<div><h1>أداة ترخيص محلات التجميل</h1><p>أداة المطوّر فقط · توقيع غير متناظر (Ed25519) · لا تُرسل هذا المجلد للعملاء</p></div></div>
<div class="card"><h2>إصدار ترخيص جديد</h2>
<div class="row"><div><label>معرّف جهاز العميل (Machine ID)</label><input id="machine" class="mono" placeholder="XXXXX-XXXXX-XXXXX-XXXXX"></div>
<div><label>اسم المنشأة</label><input id="customer" placeholder="مثال: صالون بيت الجمال"></div></div>
<div class="row"><div><label>نوع الترخيص</label><select id="type"><option value="full">دائم (Full)</option><option value="annual">سنوي (Annual)</option><option value="trial">تجريبي مؤقت (Trial)</option></select></div>
<div><label>مدة الصلاحية بالأيام (للسنوي/التجريبي)</label><input id="days" type="number" min="1" placeholder="365 سنوي · 30 تجريبي"></div></div>
<div class="err" id="err"></div>
<div style="margin-top:16px"><button id="go">توليد مفتاح الترخيص</button></div>
<div class="ok" id="ok"><label>مفتاح الترخيص (انسخه وأرسله للعميل)</label><textarea id="key" readonly></textarea><div style="margin-top:10px"><button class="sec" id="copy">نسخ المفتاح</button></div></div></div>
<div class="card"><h2>التراخيص الصادرة</h2><table><thead><tr><th>الرقم</th><th>المنشأة</th><th>النوع</th><th>الجهاز</th><th>ينتهي</th><th>أُصدر</th></tr></thead><tbody id="list"></tbody></table></div>
</div><script>
const $=id=>document.getElementById(id);const T={full:'دائم',annual:'سنوي',trial:'تجريبي'};
async function load(){const r=await (await fetch('/api/issued')).json();$('list').innerHTML=r.map(x=>'<tr><td>'+x.id+'</td><td>'+esc(x.customer)+'</td><td><span class="badge">'+T[x.type]+'</span></td><td dir="ltr">'+x.machine+'</td><td>'+(x.expires||'—')+'</td><td>'+x.issued+'</td></tr>').join('')||'<tr><td colspan="6" style="color:#999;text-align:center;padding:18px">لا توجد تراخيص بعد</td></tr>'}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
$('go').onclick=async()=>{$('err').style.display='none';$('ok').style.display='none';
const r=await fetch('/api/issue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({machine:$('machine').value,customer:$('customer').value,type:$('type').value,days:$('days').value})});
const j=await r.json();if(!r.ok){$('err').textContent=j.error;$('err').style.display='block';return}
$('key').value=j.key;$('ok').style.display='block';load()};
$('copy').onclick=async()=>{await navigator.clipboard.writeText($('key').value);$('copy').textContent='تم النسخ ✓'};
load();setInterval(()=>fetch('/api/ping').catch(()=>{}),5000);fetch('/api/ping').catch(()=>{});</script></body></html>`;

function startUi(autoExit) {
  let lastPing = 0;
  const server = http.createServer((req, res) => {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(UI); }
    if (req.url === '/api/ping') { lastPing = Date.now(); res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && req.url === '/api/issued') return json(200, loadIssued());
    if (req.method === 'POST' && req.url === '/api/issue') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
      req.on('end', () => {
        try { json(200, issue(JSON.parse(body || '{}'))); } catch (e) { json(400, { error: e.message }); }
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  server.on('error', (e) => { if (e.code === 'EADDRINUSE') { console.log('الأداة تعمل بالفعل على المنفذ 5199'); process.exit(0); } throw e; });
  server.listen(5199, '127.0.0.1', () => console.log('أداة ترخيص محلات التجميل تعمل على: http://127.0.0.1:5199'));
  // launched from the desktop icon: close the background process once the window is closed
  if (autoExit) setInterval(() => { if (lastPing && Date.now() - lastPing > 180000) process.exit(0); }, 5000);
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

