const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'beautyhouse.db');

const isNewDb = !fs.existsSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  phone TEXT,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  can_login INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('service','cafe')),
  category TEXT NOT NULL,
  duration_minutes INTEGER,
  price REAL NOT NULL DEFAULT 0,
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  reorder_threshold INTEGER NOT NULL DEFAULT 0,
  cost_price REAL NOT NULL DEFAULT 0,
  sell_price REAL NOT NULL DEFAULT 0,
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  catalog_item_id INTEGER REFERENCES catalog_items(id) ON DELETE SET NULL,
  service_name TEXT,
  booking_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'مؤكد',
  payment_method TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'مكتملة',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  catalog_item_id INTEGER REFERENCES catalog_items(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit_price REAL NOT NULL,
  qty INTEGER NOT NULL,
  line_total REAL NOT NULL
);
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('catalog_items', 'image_url', 'TEXT');
ensureColumn('products', 'image_url', 'TEXT');
ensureColumn('sales', 'notes', 'TEXT');
ensureColumn('bookings', 'payment_method', 'TEXT');
ensureColumn('users', 'username', 'TEXT');
ensureColumn('users', 'security_question', 'TEXT');
ensureColumn('users', 'security_answer_hash', 'TEXT');
ensureColumn('users', 'security_answer_salt', 'TEXT');
ensureColumn('users', 'permissions', 'TEXT');

ensureColumn('users', 'base_salary', 'REAL NOT NULL DEFAULT 0');

db.prepare("UPDATE users SET username = 'admin' WHERE username IS NULL AND email = 'admin@beautyhouse.local'").run();

db.exec(`
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  expense_date TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  notes TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('advance','advance_repay','bonus','deduction','salary')),
  amount REAL NOT NULL,
  month TEXT NOT NULL,
  tx_date TEXT NOT NULL,
  method TEXT,
  notes TEXT,
  base REAL,
  bonuses REAL,
  deductions REAL,
  advance_repaid REAL,
  salary_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_emp_tx_user ON employee_transactions(user_id, month);
`);

// Backfill: older sales/bookings only had a single payment_method column.
db.exec(`
INSERT INTO payments (sale_id, method, amount, created_at)
  SELECT s.id, CASE WHEN s.payment_method IN ('cash','bankak','ocash') THEN s.payment_method ELSE 'cash' END, s.total, s.created_at
  FROM sales s WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id);
INSERT INTO payments (booking_id, method, amount, created_at)
  SELECT b.id, CASE WHEN b.payment_method IN ('cash','bankak','ocash') THEN b.payment_method ELSE 'cash' END, b.price, b.created_at
  FROM bookings b WHERE b.status = 'مكتمل' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id);
`);

db.exec(`
DROP VIEW IF EXISTS revenue_events;
CREATE VIEW revenue_events AS
  SELECT id, created_at AS event_at, customer_id, customer_name, user_id, total AS amount, payment_method, 'sale' AS source, id AS sale_id, NULL AS booking_id
  FROM sales WHERE status = 'مكتملة'
  UNION ALL
  SELECT id, booking_date || ' ' || start_time AS event_at, customer_id, customer_name, user_id, price AS amount, payment_method, 'booking' AS source, NULL AS sale_id, id AS booking_id
  FROM bookings WHERE status = 'مكتمل';
`);

function seedIfEmpty() {
  const itemCount = db.prepare('SELECT COUNT(*) AS c FROM catalog_items').get().c;
  if (itemCount === 0) {
    const insert = db.prepare(
      'INSERT INTO catalog_items (name, type, category, duration_minutes, price) VALUES (?, ?, ?, ?, ?)'
    );
    const services = [
      ['هيدرافيشل علاجي', 'البشرة', 60, 12000],
      ['بلازما وجه', 'البشرة', 45, 20000],
      ['ديرمابن', 'البشرة', 45, 15000],
      ['دياثيرمي', 'البشرة', 30, 9000],
      ['جلسات ليزر', 'البشرة', 30, 11000],
      ['استشوار', 'الشعر', 30, 3000],
      ['بروتين', 'الشعر', 120, 18000],
      ['كافيار', 'الشعر', 90, 16000],
      ['بلازما شعر', 'الشعر', 60, 17000],
      ['حمام زيت', 'الشعر', 30, 4000],
      ['مكوى شعر', 'الشعر', 30, 3500],
      ['مكوى ويفي', 'الشعر', 30, 4000],
      ['كيرلي استايل', 'الشعر', 40, 4500],
      ['اكستينشن', 'الشعر', 120, 25000],
      ['ضفائر أفريقية', 'الشعر', 180, 11000],
      ['تسريح شعر', 'الشعر', 45, 5500],
      ['بدكير أيادي', 'الجسم', 45, 4000],
      ['بدكير أرجل', 'الجسم', 45, 4500],
      ['جاكوزي', 'الجسم', 30, 5000],
      ['منكير جل بولش', 'الجسم', 45, 5000],
      ['منكير عادية', 'الجسم', 30, 2500],
      ['حمام مغربي', 'الجسم', 60, 8000],
      ['ساونا', 'الجسم', 30, 4500],
      ['جلسات مساج', 'الجسم', 60, 11000],
      ['حنة (رسم)', 'الجسم', 30, 3000],
      ['Sweet', 'الجسم', 45, 6500],
      ['عرايس', 'ميك آب', 120, 35000],
      ['شباين', 'ميك آب', 60, 13000],
      ['مدامات', 'ميك آب', 60, 9500],
      ['اجتماعات', 'ميك آب', 45, 6500],
      ['تخاريج', 'ميك آب', 60, 9000]
    ];
    const cafe = [
      ['ايس كوفي', 'مشروبات باردة', 800],
      ['ايس كارميل', 'مشروبات باردة', 900],
      ['ايس موكا', 'مشروبات باردة', 1000],
      ['موهيتو كلاسيك', 'مشروبات باردة', 700],
      ['موهيتو توت', 'مشروبات باردة', 800],
      ['موهيتو فراولة', 'مشروبات باردة', 800],
      ['موهيتو كيوي', 'مشروبات باردة', 800],
      ['موهيتو مانجو', 'مشروبات باردة', 800],
      ['فراولة بالأوريو', 'عصائر', 1000],
      ['فراولة بالحليب', 'عصائر', 900],
      ['منقة بالحليب', 'عصائر', 900],
      ['ليمون بالنعناع', 'عصائر', 700],
      ['أندومي الجمال', 'سناكس', 1200],
      ['أندومي ميكس', 'سناكس', 1300],
      ['أندومي خضار', 'سناكس', 1000],
      ['أندومي عادي', 'سناكس', 800]
    ];
    for (const [name, category, duration, price] of services) {
      insert.run(name, 'service', category, duration, price);
    }
    for (const [name, category, price] of cafe) {
      insert.run(name, 'cafe', category, null, price);
    }
  }

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const { hash, salt } = hashPassword('BeautyHouse@2026');
    db.prepare(
      'INSERT INTO users (name, role, phone, email, password_hash, password_salt, can_login, active) VALUES (?, ?, ?, ?, ?, ?, 1, 1)'
    ).run('المديرة', 'owner', '', 'admin@beautyhouse.local', hash, salt);
  }

  const defaults = {
    shop_name: 'Beauty House',
    branch_name: '',
    phone: '',
    email: '',
    address: '',
    logo: '',
    open_time: '09:00',
    close_time: '21:00',
    working_days: JSON.stringify(['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']),
    currency_code: 'SDG',
    currency_label: 'ج.س',
    vat_rate: '0',
    pay_cash: '1',
    pay_bankak: '1',
    pay_ocash: '1',
    notif_whatsapp: '1',
    notif_sms: '0',
    notif_low_stock: '1',
    notif_daily_report: '1',
    notif_new_booking: '1',
    theme: 'system'
  };
  const insertIfMissing = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) insertIfMissing.run(k, v);

  db.prepare("DELETE FROM settings WHERE key IN ('pay_card','pay_wallet')").run();
}

seedIfEmpty();

module.exports = { db, isNewDb };
