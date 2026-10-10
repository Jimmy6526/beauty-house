const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Dev/legacy mode: run from the source folder with data next to the code and no license check.
// Triggered by NOVA_DEV=1, a ".dev" marker file, or an existing data/beautyhouse.db beside the code
// (so working copies created before the installer existed keep working untouched).
const legacyDb = fs.existsSync(path.join(ROOT, 'data', 'beautyhouse.db'));
const isDev = process.env.NOVA_MODE ? process.env.NOVA_MODE === 'dev' : (process.env.NOVA_DEV === '1' || fs.existsSync(path.join(ROOT, '.dev')) || legacyDb);

function defaultInstalledDir() {
  const base = process.env.ProgramData || process.env.PROGRAMDATA;
  return base ? path.join(base, 'NovaBeauty') : path.join(ROOT, 'data');
}

const HOME_DIR = process.env.NOVA_HOME_DIR || (isDev ? ROOT : defaultInstalledDir());
const DATA_DIR = process.env.NOVA_DATA_DIR || (isDev ? path.join(ROOT, 'data') : path.join(HOME_DIR, 'data'));
const UPLOAD_DIR = isDev && !process.env.NOVA_DATA_DIR ? path.join(ROOT, 'public', 'uploads') : path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = isDev && !process.env.NOVA_DATA_DIR ? path.join(ROOT, 'backups') : path.join(DATA_DIR, 'backups');
const BRANDING_DIR = path.join(DATA_DIR, 'branding');
const DB_PATH = path.join(DATA_DIR, 'beautyhouse.db');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_IMG_DIR = path.join(PUBLIC_DIR, 'img');

[DATA_DIR, UPLOAD_DIR, BACKUP_DIR, BRANDING_DIR].forEach((d) => {
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* surfaced later when used */ }
});

module.exports = {
  ROOT, isDev, HOME_DIR, DATA_DIR, UPLOAD_DIR, BACKUP_DIR, BRANDING_DIR, DB_PATH, PUBLIC_DIR, DEFAULT_IMG_DIR,
  // A brand-new installed copy starts empty (no demo catalog, no default admin) and shows the setup wizard.
  freshInstall: !isDev,
  enforceLicense: !isDev,
  host: process.env.NOVA_HOST || (isDev ? '' : '127.0.0.1'),
  supervised: process.env.NOVA_SUPERVISED === '1',
  productName: 'نوفا للتجميل',
  productNameEn: 'Nova Beauty',
  version: '1.0.0'
};
