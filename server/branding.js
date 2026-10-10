// Dynamic branding: the shop logo becomes (circular) favicon, web-app icon, and Windows shortcut icon.
// The browser draws the circular PNGs on a canvas; we only wrap them into an .ico container
// (ICO supports embedded PNG), so no image-decoding library is needed.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('./config');

const SIZES = [16, 32, 48, 64, 128, 192, 256, 512];
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function iconFile(size) {
  const custom = path.join(config.BRANDING_DIR, 'icon-' + size + '.png');
  if (fs.existsSync(custom)) return custom;
  return path.join(config.DEFAULT_IMG_DIR, 'nova-icon-' + size + '.png');
}
function icoFile() {
  const custom = path.join(config.BRANDING_DIR, 'app.ico');
  return fs.existsSync(custom) ? custom : path.join(config.DEFAULT_IMG_DIR, 'nova.ico');
}

function buildIco(pngs) {
  const entries = ICO_SIZES.filter((s) => pngs[s]);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = [], blobs = [];
  entries.forEach((s) => {
    const png = pngs[s];
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    offset += png.length; dir.push(e); blobs.push(png);
  });
  return Buffer.concat([header, ...dir, ...blobs]);
}

function decodePng(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 100 || buf.length > 2 * 1024 * 1024 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  return buf;
}

// icons: { "256": "data:image/png;base64,...", ... }
function saveIcons(icons) {
  const pngs = {};
  for (const size of SIZES) {
    if (icons && icons[size]) {
      const buf = decodePng(icons[size]);
      if (!buf) throw new Error('صورة الأيقونة ' + size + ' غير صالحة');
      pngs[size] = buf;
    }
  }
  if (!pngs[256] || !pngs[32]) throw new Error('الأيقونات المطلوبة ناقصة');
  fs.mkdirSync(config.BRANDING_DIR, { recursive: true });
  for (const size of Object.keys(pngs)) fs.writeFileSync(path.join(config.BRANDING_DIR, 'icon-' + size + '.png'), pngs[size]);
  fs.writeFileSync(path.join(config.BRANDING_DIR, 'app.ico'), buildIco(pngs));
  applyShortcutIcons();
}

function resetIcons() {
  SIZES.forEach((s) => { try { fs.unlinkSync(path.join(config.BRANDING_DIR, 'icon-' + s + '.png')); } catch (e) { /* none */ } });
  try { fs.copyFileSync(path.join(config.DEFAULT_IMG_DIR, 'nova.ico'), path.join(config.BRANDING_DIR, 'app.ico')); } catch (e) { /* ignore */ }
  applyShortcutIcons();
}

// Point every Nova shortcut (desktop, start menu, pinned taskbar) at the current .ico. Best-effort, async.
function applyShortcutIcons() {
  if (process.platform !== 'win32') return;
  const ico = icoFile();
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$ico = '${ico.replace(/'/g, "''")}'
$dirs = @()
$dirs += [Environment]::GetFolderPath('CommonDesktopDirectory')
$dirs += (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Nova Beauty')
Get-ChildItem 'C:\\Users' -Directory | ForEach-Object {
  $dirs += (Join-Path $_.FullName 'Desktop')
  $dirs += (Join-Path $_.FullName 'OneDrive\\Desktop')
  $dirs += (Join-Path $_.FullName 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Nova Beauty')
  $dirs += (Join-Path $_.FullName 'AppData\\Roaming\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar')
}
$sh = New-Object -ComObject WScript.Shell
foreach ($d in $dirs) {
  if (-not (Test-Path $d)) { continue }
  Get-ChildItem $d -Filter *.lnk | ForEach-Object {
    $l = $sh.CreateShortcut($_.FullName)
    if ($_.BaseName -like '*نوفا للتجميل*' -or $_.BaseName -like '*Nova Beauty*') { $l.IconLocation = "$ico,0"; $l.Save() }
  }
}
& "$env:SystemRoot\\System32\\ie4uinit.exe" -show
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { windowsHide: true, stdio: 'ignore' });
    p.unref();
  } catch (e) { /* ignore */ }
}

function manifest(shopName) {
  const name = shopName || config.productName;
  return {
    name: name + ' — ' + config.productName,
    short_name: name,
    start_url: '/dashboard.html',
    display: 'standalone',
    dir: 'rtl',
    lang: 'ar',
    background_color: '#FAF5F7',
    theme_color: '#6E2A55',
    icons: [192, 256, 512].map((s) => ({ src: '/branding/icon-' + s + '.png', sizes: s + 'x' + s, type: 'image/png', purpose: 'any' }))
  };
}

module.exports = { iconFile, icoFile, saveIcons, resetIcons, applyShortcutIcons, manifest, SIZES };
