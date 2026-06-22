/* ============================================================
   ActivatePro — Database layer (SQLite via better-sqlite3)
   ------------------------------------------------------------
   Single-file SQLite DB at server/data/activatepro.db.
   For production you can swap this module for PostgreSQL (pg) —
   keep the same exported function names and the rest of the app
   won't change. */
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'activatepro.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  password_hash TEXT NOT NULL,
  verified      INTEGER NOT NULL DEFAULT 0,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  device      TEXT,
  service     TEXT,
  imei        TEXT,
  status      TEXT NOT NULL DEFAULT 'Pending',
  amount      INTEGER NOT NULL DEFAULT 0,
  eta         TEXT,
  payment_ref TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

// ---- Lightweight migrations (safe to run every boot) ----
try {
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!cols.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  if (!cols.includes('whatsapp')) db.exec("ALTER TABLE users ADD COLUMN whatsapp TEXT");
  if (!cols.includes('status')) db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'");
} catch (e) { console.warn('users migration skipped:', e.message); }

/* ---------- Users ---------- */
const _insertUser = db.prepare('INSERT INTO users (email, name, password_hash, verified) VALUES (?, ?, ?, 0)');
const _getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const _getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const _setVerified = db.prepare('UPDATE users SET verified = 1 WHERE email = ?');
const _updatePassword = db.prepare('UPDATE users SET password_hash = ? WHERE email = ?');

function createUser({ email, name, passwordHash }) {
  const info = _insertUser.run(email, name || null, passwordHash);
  return _getUserById.get(info.lastInsertRowid);
}
function getUserByEmail(email) { return _getUserByEmail.get(email); }
function getUserById(id) { return _getUserById.get(id); }
function markVerified(email) { _setVerified.run(email); }
function updatePassword(email, passwordHash) { _updatePassword.run(passwordHash, email); }

/* ---------- Orders ---------- */
const _insertOrder = db.prepare(`INSERT INTO orders (id, user_id, device, service, imei, status, amount, eta, payment_ref)
  VALUES (@id, @user_id, @device, @service, @imei, @status, @amount, @eta, @payment_ref)`);
const _getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
const _listOrders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC');
const _setOrderStatus = db.prepare('UPDATE orders SET status = ?, payment_ref = COALESCE(?, payment_ref) WHERE id = ?');

function nextOrderId() {
  const row = db.prepare("SELECT COUNT(*) AS c FROM orders").get();
  return 'AP-' + (10429 + row.c); // continues the demo numbering
}
function createOrder(o) {
  const id = o.id || nextOrderId();
  _insertOrder.run({
    id, user_id: o.user_id, device: o.device || null, service: o.service || null,
    imei: o.imei || null, status: o.status || 'Pending', amount: o.amount || 0,
    eta: o.eta || null, payment_ref: o.payment_ref || null,
  });
  return _getOrder.get(id);
}
function getOrder(id) { return _getOrder.get(id); }
function listOrders(userId) { return _listOrders.all(userId); }
function setOrderStatus(id, status, paymentRef) { _setOrderStatus.run(status, paymentRef || null, id); }


/* ---------- Profile & role ---------- */
const _updateName = db.prepare('UPDATE users SET name = ? WHERE id = ?');
const _updateWhatsapp = db.prepare('UPDATE users SET whatsapp = ? WHERE id = ?');
const _setRole = db.prepare('UPDATE users SET role = ? WHERE email = ?');
function updateName(id, name) { _updateName.run(name, id); return _getUserById.get(id); }
function updateWhatsapp(id, whatsapp) { _updateWhatsapp.run(whatsapp || null, id); return _getUserById.get(id); }
function setRole(email, role) { _setRole.run(role, email); }

/* ---------- Admin queries ---------- */
const _allUsers = db.prepare('SELECT id, email, name, verified, role, status, created_at FROM users ORDER BY created_at DESC');
const _allOrders = db.prepare(`SELECT o.*, u.email AS user_email, u.name AS user_name
  FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC`);
function listAllUsers() { return _allUsers.all(); }
function listAllOrders() { return _allOrders.all(); }
function adminStats() {
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const orders = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM orders WHERE status IN ('Processing','Completed')").get().s;
  const byStatus = db.prepare('SELECT status, COUNT(*) AS c FROM orders GROUP BY status').all();
  const byService = db.prepare('SELECT service, COUNT(*) AS c FROM orders GROUP BY service ORDER BY c DESC').all();
  return { users, orders, revenue, byStatus, byService };
}

module.exports = {
  db, createUser, getUserByEmail, getUserById, markVerified, updatePassword,
  createOrder, getOrder, listOrders, setOrderStatus, nextOrderId,
  updateName, updateWhatsapp, setRole, listAllUsers, listAllOrders, adminStats,
};
