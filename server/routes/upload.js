const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

module.exports = (router) => {
  router.post('/api/upload', (req, res, params, ctx) => {
    const { dataUrl } = ctx.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') return ctx.json(400, { error: 'لا توجد صورة' });
    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
    if (!match) return ctx.json(400, { error: 'صيغة الصورة غير مدعومة' });
    const mime = match[1];
    const ext = EXT_BY_MIME[mime];
    if (!ext) return ctx.json(400, { error: 'صيغة الصورة غير مدعومة' });
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 6 * 1024 * 1024) return ctx.json(400, { error: 'حجم الصورة كبير جداً' });
    const filename = crypto.randomBytes(12).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
    ctx.json(201, { url: '/uploads/' + filename });
  });
};
