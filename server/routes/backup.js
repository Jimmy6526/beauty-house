const fs = require('node:fs');
const path = require('node:path');
const { db } = require('../db');

const { BACKUP_DIR, DB_PATH } = require('../config');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function makeBackupFilename(tag) {
  const d = new Date();
  const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' +
    pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
  return 'beautyhouse-backup-' + stamp + (tag ? '-' + tag : '') + '.db';
}

function createBackup(tag) {
  const filename = makeBackupFilename(tag);
  const dest = path.join(BACKUP_DIR, filename);
  const escaped = dest.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return filename;
}

function pruneOldBackups(keep) {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  files.slice(keep).forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f.name)));
}

function isSafeFilename(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9._-]+\.db$/.test(name) && !name.includes('..');
}

module.exports = (router, ctxServer) => {
  router.get('/api/backup/list', (req, res, params, ctx) => {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, created_at: st.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    ctx.json(200, files);
  }, { role: 'owner' });

  router.post('/api/backup/create', (req, res, params, ctx) => {
    try {
      const filename = createBackup('manual');
      pruneOldBackups(30);
      ctx.json(201, { ok: true, filename });
    } catch (err) {
      ctx.json(500, { error: 'فشل إنشاء النسخة الاحتياطية', detail: err.message });
    }
  }, { role: 'owner' });

  router.get('/api/backup/download/:filename', (req, res, params, ctx) => {
    if (!isSafeFilename(params.filename)) return ctx.json(400, { error: 'اسم ملف غير صالح' });
    const filePath = path.join(BACKUP_DIR, params.filename);
    if (!fs.existsSync(filePath)) return ctx.json(404, { error: 'الملف غير موجود' });
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="' + params.filename + '"'
    });
    fs.createReadStream(filePath).pipe(res);
  }, { role: 'owner' });

  router.del('/api/backup/:filename', (req, res, params, ctx) => {
    if (!isSafeFilename(params.filename)) return ctx.json(400, { error: 'اسم ملف غير صالح' });
    const filePath = path.join(BACKUP_DIR, params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    ctx.json(200, { ok: true });
  }, { role: 'owner' });

  router.post('/api/backup/restore', (req, res, params, ctx) => {
    const { filename } = ctx.body || {};
    if (!isSafeFilename(filename)) return ctx.json(400, { error: 'اسم ملف غير صالح' });
    const src = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(src)) return ctx.json(404, { error: 'النسخة الاحتياطية غير موجودة' });

    try {
      createBackup('before-restore');
    } catch (e) { /* best-effort safety snapshot before overwrite */ }

    try {
      fs.copyFileSync(src, DB_PATH);
    } catch (err) {
      return ctx.json(500, { error: 'فشلت استعادة النسخة الاحتياطية', detail: err.message });
    }

    ctx.json(200, { ok: true, message: 'تم استعادة النسخة الاحتياطية بنجاح — سيُعاد تشغيل النظام تلقائياً خلال ثوانٍ' });
    ctxServer.restartAfterResponse();
  }, { role: 'owner' });
};

module.exports.createBackup = createBackup;
module.exports.pruneOldBackups = pruneOldBackups;
module.exports.BACKUP_DIR = BACKUP_DIR;
