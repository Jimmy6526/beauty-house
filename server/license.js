// Nova Beauty licensing: hardware-bound, offline, asymmetric (Ed25519).
// The developer signs a license with a PRIVATE key (never shipped); the app only holds the PUBLIC key
// and can verify but never forge a license. Honest limitation: any local check can be patched out by a
// determined attacker with full machine access; this stops casual copying and key sharing.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const config = require('./config');

const PRODUCT = 'nova-aljamal';
const TRIAL_DAYS = 14;
const DAY = 86400000;
const KEY_PREFIX = 'NOVA1.';

let PUBLIC_KEY = null;
try { PUBLIC_KEY = crypto.createPublicKey(fs.readFileSync(path.join(__dirname, 'license-public.pem'))); } catch (e) { PUBLIC_KEY = null; }

/* ---------------- Machine fingerprint ---------------- */
const JUNK = /^(|0+|none|default string|to be filled by o\.?e\.?m\.?|system serial number|not specified|n\/a|unknown|ffffffff-ffff-ffff-ffff-ffffffffffff|00000000-0000-0000-0000-000000000000)$/i;
let cachedMachineId = null;

function psValue(cmd) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
  } catch (e) { return ''; }
}

function getMachineId() {
  if (cachedMachineId) return cachedMachineId;
  const parts = [];
  if (process.platform === 'win32') {
    const uuid = psValue('(Get-CimInstance Win32_ComputerSystemProduct).UUID');
    const board = psValue('(Get-CimInstance Win32_BaseBoard).SerialNumber');
    const cpu = psValue('(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId');
    [uuid, board, cpu].forEach((v) => { if (!JUNK.test(v || '')) parts.push(v.toUpperCase()); });
    if (parts.length < 2) {
      const guid = psValue("(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid");
      if (!JUNK.test(guid)) parts.push(guid.toUpperCase());
    }
  }
  if (!parts.length) parts.push(require('node:os').hostname().toUpperCase());
  const hex = crypto.createHash('sha256').update('nova-machine-v1|' + parts.join('|')).digest('hex').toUpperCase().slice(0, 20);
  cachedMachineId = hex.match(/.{5}/g).join('-');
  return cachedMachineId;
}

/* ---------------- Key verification ---------------- */
const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64url'),
  dec: (s) => Buffer.from(s, 'base64url')
};

function normName(s) {
  return String(s || '').normalize('NFKC').replace(/[ً-ٟـ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function todayStr() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function verifyKey(text) {
  if (!PUBLIC_KEY) return { ok: false, error: 'مفتاح التحقق العام غير موجود — النسخة تالفة' };
  const raw = String(text || '').replace(/\s+/g, '');
  if (!raw.startsWith(KEY_PREFIX)) return { ok: false, error: 'صيغة المفتاح غير صحيحة' };
  const [p64, s64] = raw.slice(KEY_PREFIX.length).split('.');
  if (!p64 || !s64) return { ok: false, error: 'صيغة المفتاح غير صحيحة' };
  let payload;
  try {
    const data = b64u.dec(p64);
    if (!crypto.verify(null, data, PUBLIC_KEY, b64u.dec(s64))) return { ok: false, error: 'المفتاح غير صالح (التوقيع لا يطابق)' };
    payload = JSON.parse(data.toString('utf8'));
  } catch (e) { return { ok: false, error: 'المفتاح تالف أو غير مكتمل' }; }
  if (payload.v !== 1 || payload.product !== PRODUCT) return { ok: false, error: 'هذا المفتاح لا يخص هذا المنتج' };
  if (String(payload.machine || '').toUpperCase() !== getMachineId()) return { ok: false, error: 'هذا المفتاح مخصص لجهاز آخر' };
  if (payload.expires && payload.expires < todayStr()) return { ok: false, error: 'انتهت صلاحية هذا الترخيص بتاريخ ' + payload.expires, expired: true, payload };
  return { ok: true, payload };
}

/* ---------------- Local state (trial + clock guard), HMAC-signed ---------------- */
const STATE_FILES = [path.join(config.HOME_DIR, '.nova-state'), path.join(config.DATA_DIR, '.nova-state')];
const KEY_FILE = path.join(config.HOME_DIR, 'license.key');

function stateMac(trialStart, lastSeen) {
  const k = crypto.createHash('sha256').update('nova-state-v1|' + getMachineId()).digest();
  return crypto.createHmac('sha256', k).update(trialStart + '|' + lastSeen).digest('hex');
}

function loadState() {
  let best = null, tampered = false;
  for (const f of STATE_FILES) {
    try {
      const st = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (st.sig !== stateMac(st.trial_start, st.last_seen)) { tampered = true; continue; }
      if (!best) best = { trial_start: st.trial_start, last_seen: st.last_seen };
      else { best.trial_start = Math.min(best.trial_start, st.trial_start); best.last_seen = Math.max(best.last_seen, st.last_seen); }
    } catch (e) { /* missing file */ }
  }
  return { state: best, tampered };
}

function saveState(st) {
  const body = JSON.stringify({ trial_start: st.trial_start, last_seen: st.last_seen, sig: stateMac(st.trial_start, st.last_seen) });
  STATE_FILES.forEach((f) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); } catch (e) { /* ignore */ } });
}

/* ---------------- Status ---------------- */
let cache = null, cacheAt = 0, lastSaved = 0;

function readKeyFile() { try { return fs.readFileSync(KEY_FILE, 'utf8'); } catch (e) { return ''; } }

function computeStatus() {
  const base = { product: PRODUCT, version: config.version, machine_id: getMachineId(), trial_days: TRIAL_DAYS };
  if (!config.enforceLicense) return { ...base, state: 'dev', allowed: true, message: 'وضع التطوير — لا يوجد فحص ترخيص' };

  const now = Date.now();
  let { state, tampered } = loadState();
  if (!state) { state = { trial_start: now, last_seen: now }; if (!tampered) saveState(state); }
  const rolledBack = now < state.last_seen - DAY;
  if (!rolledBack && now - lastSaved > 600000) { state.last_seen = Math.max(state.last_seen, now); saveState(state); lastSaved = now; }

  const keyText = readKeyFile();
  let keyError = null;
  if (keyText) {
    const v = verifyKey(keyText);
    if (v.ok && !(v.payload.expires && rolledBack)) {
      const p = v.payload;
      let daysLeft = null;
      if (p.expires) daysLeft = Math.max(0, Math.ceil((new Date(p.expires + 'T23:59:59').getTime() - now) / DAY));
      return { ...base, state: 'licensed', allowed: true, customer: p.customer, type: p.type, expires: p.expires || null, days_left: daysLeft, license_id: p.id };
    }
    keyError = v.ok ? 'تم اكتشاف تغيير في تاريخ الجهاز — أعيدي ضبط التاريخ الصحيح' : v.error;
  }

  if (tampered || rolledBack) {
    return { ...base, state: 'expired', allowed: false, key_error: keyError, message: 'تم اكتشاف تلاعب بالتاريخ أو بملفات التجربة — يلزم تفعيل النظام' };
  }
  const daysUsed = Math.floor((now - state.trial_start) / DAY);
  const left = TRIAL_DAYS - daysUsed;
  if (left > 0) return { ...base, state: 'trial', allowed: true, days_left: left, key_error: keyError };
  return { ...base, state: 'expired', allowed: false, key_error: keyError, message: 'انتهت الفترة التجريبية — يلزم تفعيل النظام' };
}

function status(force) {
  const now = Date.now();
  if (!cache || force || now - cacheAt > 30000) { cache = computeStatus(); cacheAt = now; }
  return cache;
}

// Identity lock: when a valid license is active the business name is the one printed inside the signed key.
function licensedName() {
  const st = status();
  return st.state === 'licensed' && st.customer ? st.customer : null;
}

function activate(keyText, customerName) {
  const v = verifyKey(keyText);
  if (!v.ok) return { ok: false, error: v.error };
  if (customerName != null && normName(customerName) !== normName(v.payload.customer)) {
    return { ok: false, error: 'اسم المنشأة لا يطابق الاسم المسجّل في الترخيص' };
  }
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, String(keyText).replace(/\s+/g, ''));
  return { ok: true, status: status(true) };
}

module.exports = { status, activate, licensedName, verifyKey, getMachineId, normName, PRODUCT, TRIAL_DAYS, KEY_PREFIX };
