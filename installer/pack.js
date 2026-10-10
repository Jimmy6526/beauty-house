// Builds installer/output/payload.zip from installer/stage (+ uninstall.exe + nova.ico) with a tiny zip writer (no dependencies).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const STAGE = path.join(__dirname, 'stage');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

const files = [];
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(p, r);
    else files.push({ rel: r, abs: p });
  }
})(STAGE, '');
files.push({ rel: 'nova.ico', abs: path.join(__dirname, 'assets', 'nova.ico') });

const need = ['node/node.exe', 'server/server.js', 'public/login.html', 'NovaService.exe', 'NovaUser.exe', 'uninstall.exe', 'server/license-public.pem'];
for (const n of need) if (!files.some((f) => f.rel === n)) throw new Error('payload is missing ' + n);
if (files.some((f) => /private\.pem|issued\.json|\.dev$|beautyhouse\.db$|keygen/i.test(f.rel))) throw new Error('sensitive file in payload');

function dosTime(d) { return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff; }
function dosDate(d) { return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff; }

const parts = [], central = [];
let offset = 0;
const now = new Date();
for (const f of files) {
  const data = fs.readFileSync(f.abs);
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const useStore = comp.length >= data.length;
  const body = useStore ? data : comp;
  const method = useStore ? 0 : 8;
  const crc = zlib.crc32(data) >>> 0;
  const name = Buffer.from(f.rel, 'utf8');
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(dosTime(now), 10); lh.writeUInt16LE(dosDate(now), 12); lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
  parts.push(lh, name, body);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(dosTime(now), 12); ch.writeUInt16LE(dosDate(now), 14); ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, name);
  offset += 30 + name.length + body.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
fs.writeFileSync(path.join(OUT, 'payload.zip'), Buffer.concat([...parts, cd, end]));
console.log('payload.zip: ' + files.length + ' files, ' + (fs.statSync(path.join(OUT, 'payload.zip')).size / 1048576).toFixed(1) + ' MB');
