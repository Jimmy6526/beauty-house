// Procedural brand art for Nova Al-Jamal (no image libraries): circular flower mark in PNG/ICO + installer BMPs.
//   node tools/build/make-art.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..', '..');
const IMG_DIR = path.join(ROOT, 'public', 'img');
const ASSETS = path.join(ROOT, 'installer', 'assets');
fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (t) => Math.max(0, Math.min(1, t));

const GOLD_L = hex('#F3D58B'), GOLD_D = hex('#B98A2E'), CREAM = hex('#FFF8F2'), BLUSH = hex('#F6DCE6');
const PLUM = hex('#6E2A55'), ROSE = hex('#D6558A'), ROSE_D = hex('#A93268');
const PETALS = 6;

// Returns [r,g,b,a(0..1)] of the logo mark at normalized coords u,v in [-1,1].
function mark(u, v) {
  const r = Math.hypot(u, v);
  if (r > 1) return [0, 0, 0, 0];
  if (r > 0.9) return [...mix(GOLD_L, GOLD_D, clamp01((v + 1) / 2)), 1];
  if (r > 0.865) return [...mix(GOLD_D, GOLD_L, clamp01((v + 1) / 2)), 1];
  let col = mix(CREAM, BLUSH, clamp01(r / 0.865));
  // petals
  for (let k = 0; k < PETALS; k++) {
    const th = (k * 2 * Math.PI) / PETALS - Math.PI / 2;
    const dx = Math.cos(th), dy = Math.sin(th);
    const along = u * dx + v * dy, perp = -u * dy + v * dx;
    const e = ((along - 0.40) / 0.36) ** 2 + (perp / 0.18) ** 2;
    if (e <= 1) {
      const t = clamp01((along - 0.05) / 0.7);
      let c = mix(k % 2 ? ROSE_D : PLUM, ROSE, t);
      c = mix(c, [255, 255, 255], 0.20 * (1 - e) * clamp01(0.5 + perp * 2.4)); // soft highlight
      col = c;
    }
  }
  if (r < 0.17) col = mix(GOLD_L, GOLD_D, clamp01(r / 0.17));
  else if (r < 0.20) col = [255, 247, 232];
  return [...col, 1];
}

function renderMark(size, ss = 3) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let R = 0, G = 0, B = 0, A = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1, v = ((y + (sy + 0.5) / ss) / size) * 2 - 1;
      const c = mark(u, v);
      R += c[0] * c[3]; G += c[1] * c[3]; B += c[2] * c[3]; A += c[3];
    }
    const i = (y * size + x) * 4, n = ss * ss;
    if (A > 0) { out[i] = R / A; out[i + 1] = G / A; out[i + 2] = B / A; out[i + 3] = Math.round((A / n) * 255); }
  }
  return out;
}

function pngEncode(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function icoEncode(pngs) { // pngs: {size: Buffer}
  const sizes = Object.keys(pngs).map(Number).filter((s) => s <= 256).sort((a, b) => a - b);
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = 6 + sizes.length * 16; const dir = [], blobs = [];
  sizes.forEach((s) => {
    const e = Buffer.alloc(16); e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[s].length, 8); e.writeUInt32LE(off, 12); off += pngs[s].length; dir.push(e); blobs.push(pngs[s]);
  });
  return Buffer.concat([head, ...dir, ...blobs]);
}

function bmpEncode(rgb, w, h) { // rgb: Buffer w*h*3 (top-down RGB)
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pix = Buffer.alloc(rowSize * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 3, d = (h - 1 - y) * rowSize + x * 3;
    pix[d] = rgb[s + 2]; pix[d + 1] = rgb[s + 1]; pix[d + 2] = rgb[s];
  }
  const head = Buffer.alloc(54);
  head.write('BM', 0); head.writeUInt32LE(54 + pix.length, 2); head.writeUInt32LE(54, 10);
  head.writeUInt32LE(40, 14); head.writeInt32LE(w, 18); head.writeInt32LE(h, 22); head.writeUInt16LE(1, 26); head.writeUInt16LE(24, 28);
  head.writeUInt32LE(pix.length, 34); head.writeInt32LE(2835, 38); head.writeInt32LE(2835, 42);
  return Buffer.concat([head, pix]);
}

/* ---------- icons ---------- */
const SIZES = [16, 32, 48, 64, 128, 192, 256, 512];
const pngs = {};
SIZES.forEach((s) => {
  pngs[s] = pngEncode(renderMark(s, s <= 64 ? 5 : 3), s, s);
  fs.writeFileSync(path.join(IMG_DIR, 'nova-icon-' + s + '.png'), pngs[s]);
});
const ico = icoEncode(pngs);
fs.writeFileSync(path.join(IMG_DIR, 'nova.ico'), ico);
fs.writeFileSync(path.join(ASSETS, 'nova.ico'), ico);

/* ---------- installer wizard images ---------- */
function composeWizardLarge(w, h) {
  const top = hex('#4A1B3F'), bottom = hex('#1B0C1C');
  const buf = Buffer.alloc(w * h * 3);
  const cx = w / 2, cy = 112, R = 58;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = mix(top, bottom, y / h);
    // rose glow behind the mark
    const gd = Math.hypot(x - cx, y - cy) / 120;
    if (gd < 1) c = mix(c, hex('#B8467F'), (1 - gd) ** 2 * 0.55);
    // faint giant petals at the bottom
    for (let k = 0; k < PETALS; k++) {
      const th = (k * 2 * Math.PI) / PETALS - Math.PI / 2;
      const bx = x - cx, by = y - (h + 40);
      const dx = Math.cos(th), dy = Math.sin(th);
      const along = bx * dx + by * dy, perp = -bx * dy + by * dx;
      if (((along - 150) / 120) ** 2 + (perp / 60) ** 2 <= 1) c = mix(c, hex('#E7C278'), 0.07);
    }
    // the mark
    const u = (x - cx) / R, v = (y - cy) / R;
    if (Math.hypot(u, v) <= 1.02) {
      let a = 0, rr = 0, gg = 0, bb = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const m = mark((x + (sx + 0.5) / 3 - cx) / R, (y + (sy + 0.5) / 3 - cy) / R);
        rr += m[0] * m[3]; gg += m[1] * m[3]; bb += m[2] * m[3]; a += m[3];
      }
      if (a > 0) c = mix(c, [rr / a, gg / a, bb / a], a / 9);
    }
    // gold ornament lines under the mark
    if (y >= 196 && y <= 197 && Math.abs(x - cx) < 52 && Math.abs(x - cx) > 8) c = mix(c, hex('#E7C278'), 0.85);
    if (Math.abs(x - cx) + Math.abs(y - 196.5) < 5) c = hex('#E7C278');
    const i = (y * w + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
  return buf;
}
function composeWizardSmall(w, h) {
  const buf = Buffer.alloc(w * h * 3);
  const R = 24, cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = [255, 255, 255];
    let a = 0, rr = 0, gg = 0, bb = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const m = mark((x + (sx + 0.5) / 3 - cx) / R, (y + (sy + 0.5) / 3 - cy) / R);
      rr += m[0] * m[3]; gg += m[1] * m[3]; bb += m[2] * m[3]; a += m[3];
    }
    if (a > 0) c = mix(c, [rr / a, gg / a, bb / a], a / 9);
    const i = (y * w + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
  return buf;
}
fs.writeFileSync(path.join(ASSETS, 'wizard-large.bmp'), bmpEncode(composeWizardLarge(164, 314), 164, 314));
fs.writeFileSync(path.join(ASSETS, 'wizard-small.bmp'), bmpEncode(composeWizardSmall(55, 58), 55, 58));
/* ---------- License-tool icon: the flower mark + a gold key badge (bottom-right) ---------- */
const BADGE_CX = 0.44, BADGE_CY = 0.44, BADGE_R = 0.52;
function keyBadge(u, v) {
  const bu = (u - BADGE_CX) / BADGE_R, bv = (v - BADGE_CY) / BADGE_R;
  const r = Math.hypot(bu, bv);
  if (r > 1) return null;
  if (r > 0.86) return [...mix(GOLD_L, GOLD_D, clamp01((bv + 1) / 2)), 1];
  let col = mix(hex('#4A1B3F'), hex('#1B0C1C'), clamp01((bv + 1) / 2));
  const s = (bu + bv) / Math.SQRT2, p = (bu - bv) / Math.SQRT2; // along / across the key (45 degrees)
  const hr = Math.hypot(bu + 0.38, bv + 0.38);
  let inKey = hr < 0.27 && hr > 0.12;                               // bow (ring)
  if (Math.abs(p) < 0.075 && s > -0.30 && s < 0.62) inKey = true;   // shaft
  if (p > 0.05 && p < 0.25 && ((s > 0.26 && s < 0.34) || (s > 0.44 && s < 0.52))) inKey = true; // teeth
  if (inKey) col = mix(GOLD_L, GOLD_D, clamp01((bu + bv + 1.2) / 2.4));
  return [...col, 1];
}
function renderKeyIcon(size, ss) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let R = 0, G = 0, B = 0, A = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1, v = ((y + (sy + 0.5) / ss) / size) * 2 - 1;
      const c = keyBadge(u, v) || mark(u, v);
      R += c[0] * c[3]; G += c[1] * c[3]; B += c[2] * c[3]; A += c[3];
    }
    const i = (y * size + x) * 4, n = ss * ss;
    if (A > 0) { out[i] = R / A; out[i + 1] = G / A; out[i + 2] = B / A; out[i + 3] = Math.round((A / n) * 255); }
  }
  return out;
}
const KEYGEN_DIR = path.join(ROOT, 'tools', 'keygen');
const keyPngs = {};
[16, 32, 48, 64, 128, 256].forEach((sz) => { keyPngs[sz] = pngEncode(renderKeyIcon(sz, sz <= 64 ? 5 : 3), sz, sz); });
fs.writeFileSync(path.join(KEYGEN_DIR, 'keygen.ico'), icoEncode(keyPngs));
fs.writeFileSync(path.join(KEYGEN_DIR, 'keygen-256.png'), keyPngs[256]);

console.log('art generated: public/img/nova-icon-*.png, nova.ico, installer/assets/wizard-*.bmp, tools/keygen/keygen.ico');
