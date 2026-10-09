// Prepares installer/stage with exactly what ships to customers (and nothing else).
//   node installer/stage.js            (set NODE_EXE to bundle a specific node.exe)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(__dirname, 'stage');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dest, skip) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (skip && skip(s, e)) continue;
    if (e.isDirectory()) copyDir(s, d, skip); else fs.copyFileSync(s, d);
  }
}

['node', 'server', 'public'].forEach((d) => rmrf(path.join(STAGE, d)));
fs.mkdirSync(STAGE, { recursive: true });

copyDir(path.join(ROOT, 'server'), path.join(STAGE, 'server'));
// customer data (uploads), internal docs and anything dev-only never ships
copyDir(path.join(ROOT, 'public'), path.join(STAGE, 'public'), (s, e) => {
  const rel = path.relative(path.join(ROOT, 'public'), s).replace(/\\/g, '/');
  return rel === 'uploads' || rel === 'design-system.html';
});
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(STAGE, 'package.json'));

const nodeExe = process.env.NODE_EXE || process.execPath;
fs.mkdirSync(path.join(STAGE, 'node'), { recursive: true });
fs.copyFileSync(nodeExe, path.join(STAGE, 'node', 'node.exe'));
const nodeLicense = path.join(path.dirname(nodeExe), 'LICENSE');
if (fs.existsSync(nodeLicense)) fs.copyFileSync(nodeLicense, path.join(STAGE, 'node', 'LICENSE'));

if (!fs.existsSync(path.join(STAGE, 'NovaService.exe'))) throw new Error('NovaService.exe is missing — run installer\\build-service.bat first');
if (!fs.existsSync(path.join(STAGE, 'server', 'license-public.pem'))) throw new Error('server/license-public.pem is missing — run: node tools/keygen/keygen.js init');

// safety net: nothing sensitive in the package
const bad = [];
(function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (/private\.pem$|issued\.json$|\.dev$|beautyhouse\.db$|keygen/i.test(e.name)) bad.push(p);
  }
})(STAGE);
if (bad.length) throw new Error('Sensitive files found in stage:\n' + bad.join('\n'));

console.log('Stage ready: ' + STAGE + '\n  node ' + (fs.statSync(path.join(STAGE, 'node', 'node.exe')).size / 1048576).toFixed(0) + ' MB');
