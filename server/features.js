/* ============================================================
   ActivatePro — Feature backend (real persistence for the
   pieces that used to be front-end-only mocks):
     • Support tickets + replies
     • Pricing management (admin)
     • API keys (create / list / revoke)
     • Webhook endpoint config + REAL test delivery + delivery logs
     • Activity log
     • Notifications
     • User settings (preferences) persistence
     • Billing: wallet, payment methods, invoices
     • Public runtime config (Midtrans client key from env)

   All tables live in the same SQLite DB as db.js. Mount with:
     require('./features').mount(app, { authRequired, adminRequired });
   server.js also calls logActivity() / emitWebhook() on order events.
   ============================================================ */
'use strict';

const crypto = require('crypto');
const dbi = require('./db');
const db = dbi.db;

/* ---------- Schema ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  label      TEXT NOT NULL,
  env        TEXT NOT NULL DEFAULT 'Live',
  key        TEXT NOT NULL,
  last_used  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tickets (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  subject    TEXT NOT NULL,
  category   TEXT,
  order_ref  TEXT,
  status     TEXT NOT NULL DEFAULT 'Open',
  tone       TEXT NOT NULL DEFAULT 'warning',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  TEXT NOT NULL,
  sender     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pricing (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  service_key TEXT NOT NULL,
  item_label  TEXT NOT NULL,
  price       INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  user_id     INTEGER PRIMARY KEY,
  url         TEXT,
  secret      TEXT,
  events_json TEXT NOT NULL DEFAULT '[]',
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS webhook_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  event_id   TEXT,
  event      TEXT,
  url        TEXT,
  status     INTEGER,
  ms         INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT,
  action     TEXT,
  target     TEXT,
  level      TEXT DEFAULT 'info',
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  icon       TEXT,
  title      TEXT,
  body       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS wallet (
  user_id INTEGER PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payment_methods (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  brand      TEXT,
  last4      TEXT,
  exp        TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS invoices (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  number     TEXT,
  date       TEXT,
  amount     INTEGER,
  status     TEXT DEFAULT 'Paid',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* ---------- Default pricing seed (mirrors the front-end tables) ---------- */
const DEFAULT_PRICING = {
  icloud: [
    ['iPhone 6 / 6s Series', 150000], ['iPhone 7 / 8 Series', 200000],
    ['iPhone X / XR / XS Series', 275000], ['iPhone 11 Series', 350000],
    ['iPhone 12 Series', 425000], ['iPhone 13 Series', 525000],
    ['iPhone 14 Series', 650000], ['iPhone 15 Series', 800000],
    ['iPhone 16 Series', 950000], ['iPhone 17 Series', 1150000],
  ],
  carrier: [
    ['iPhone 6 – 8 Series', 250000], ['iPhone X – 11 Series', 400000],
    ['iPhone 12 – 13 Series', 600000], ['iPhone 14 – 15 Series', 850000],
    ['iPhone 16 – 17 Series', 1100000],
  ],
  fmi: [
    ['Basic (FMI + blacklist)', 25000], ['Premium (FMI + GSX + warranty)', 75000],
    ['Full GSX report', 120000],
  ],
  mdm: [
    ['iPhone 6 – 8 Series', 180000], ['iPhone X – 11 Series', 300000],
    ['iPhone 12 – 13 Series', 450000], ['iPhone 14 – 17 Series', 650000],
  ],
};
function seedPricing() {
  const c = db.prepare('SELECT COUNT(*) AS c FROM pricing').get().c;
  if (c > 0) return;
  const ins = db.prepare('INSERT INTO pricing (service_key, item_label, price, sort) VALUES (?,?,?,?)');
  const tx = db.transaction(() => {
    Object.entries(DEFAULT_PRICING).forEach(([k, rows]) => rows.forEach((r, i) => ins.run(k, r[0], r[1], i)));
  });
  tx();
}
seedPricing();

/* ---------- Helpers ---------- */
const nowIso = () => new Date().toISOString();
function genApiKey(env) {
  return (env === 'Test' ? 'ap_test_' : 'ap_live_') + crypto.randomBytes(20).toString('hex');
}
function rid(prefix) { return prefix + '_' + crypto.randomBytes(8).toString('hex'); }
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '—';
}

/* ---------- Shared exports used by server.js order hooks ---------- */
function logActivity({ actor, action, target, level, ip }) {
  try {
    db.prepare('INSERT INTO activity (actor, action, target, level, ip) VALUES (?,?,?,?,?)')
      .run(actor || 'System', action || '', target || '', level || 'info', ip || '—');
  } catch (e) { /* non-fatal */ }
}
function pushNotification(userId, icon, title, body) {
  try {
    db.prepare('INSERT INTO notifications (user_id, icon, title, body) VALUES (?,?,?,?)')
      .run(userId, icon || 'bell', title || '', body || '');
  } catch (e) { /* non-fatal */ }
}
// Deliver a webhook to the user's configured endpoint (best-effort, logged).
async function emitWebhook(userId, event, payload) {
  let ep;
  try { ep = db.prepare('SELECT * FROM webhook_endpoints WHERE user_id = ?').get(userId); } catch (e) { return; }
  if (!ep || !ep.url || !ep.active) return;
  let events = [];
  try { events = JSON.parse(ep.events_json || '[]'); } catch (e) {}
  if (events.length && !events.includes(event)) return;
  const eventId = 'evt_' + crypto.randomBytes(6).toString('hex');
  const bodyStr = JSON.stringify({ id: eventId, event, created_at: nowIso(), data: payload || {} });
  const sig = ep.secret ? crypto.createHmac('sha256', ep.secret).update(bodyStr).digest('hex') : '';
  const started = Date.now();
  let status = 0;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(ep.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ActivatePro-Event': event, 'X-ActivatePro-Signature': sig },
      body: bodyStr, signal: ctrl.signal,
    });
    clearTimeout(t);
    status = r.status;
  } catch (e) { status = 0; }
  const ms = Date.now() - started;
  try {
    db.prepare('INSERT INTO webhook_logs (user_id, event_id, event, url, status, ms) VALUES (?,?,?,?,?,?)')
      .run(userId, eventId, event, ep.url, status, ms);
  } catch (e) {}
  return { eventId, status, ms };
}

/* ============================================================
   Route mounting
   ============================================================ */
function mount(app, { authRequired, adminRequired }) {
  const uid = (req) => req.user.uid;

  /* ---------- Public runtime config (safe values only) ---------- */
  app.get('/api/config', (_req, res) => {
    res.json({
      midtransClientKey: process.env.MIDTRANS_CLIENT_KEY || '',
      midtransProduction: process.env.MIDTRANS_IS_PRODUCTION === '1',
      paymentsEnabled: !!process.env.MIDTRANS_SERVER_KEY,
      imeiProvider: process.env.IMEI_PROVIDER || 'mock',
    });
  });

  /* ---------- Pricing ---------- */
  function groupedPricing() {
    const rows = db.prepare('SELECT * FROM pricing ORDER BY service_key, sort').all();
    const out = {};
    rows.forEach(r => { (out[r.service_key] = out[r.service_key] || []).push({ label: r.item_label, price: r.price }); });
    return out;
  }
  app.get('/api/pricing', (_req, res) => res.json({ pricing: groupedPricing() }));
  app.get('/api/admin/pricing', authRequired, adminRequired, (_req, res) => res.json({ pricing: groupedPricing() }));
  app.put('/api/admin/pricing', authRequired, adminRequired, (req, res) => {
    const { service_key, items } = req.body || {};
    if (!service_key || !Array.isArray(items)) return res.status(400).json({ error: 'service_key and items[] required' });
    const del = db.prepare('DELETE FROM pricing WHERE service_key = ?');
    const ins = db.prepare('INSERT INTO pricing (service_key, item_label, price, sort) VALUES (?,?,?,?)');
    db.transaction(() => {
      del.run(service_key);
      items.forEach((it, i) => ins.run(service_key, String(it.label || ''), parseInt(it.price, 10) || 0, i));
    })();
    logActivity({ actor: req.user.email, action: 'updated pricing for', target: service_key, level: 'info', ip: clientIp(req) });
    res.json({ ok: true, pricing: groupedPricing() });
  });

  /* ---------- API keys ---------- */
  app.get('/api/keys', authRequired, (req, res) => {
    const keys = db.prepare('SELECT id, label, env, key, last_used, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(uid(req));
    res.json({ keys });
  });
  app.post('/api/keys', authRequired, (req, res) => {
    const label = String((req.body && req.body.label) || '').trim() || 'Untitled key';
    const env = (req.body && req.body.env) === 'Test' ? 'Test' : 'Live';
    const id = rid('k');
    const key = genApiKey(env);
    db.prepare('INSERT INTO api_keys (id, user_id, label, env, key) VALUES (?,?,?,?,?)').run(id, uid(req), label, env, key);
    pushNotification(uid(req), 'key', 'New API key created', label + ' (' + env + ')');
    res.json({ ok: true, key: { id, label, env, key } });
  });
  app.delete('/api/keys/:id', authRequired, (req, res) => {
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(req.params.id, uid(req));
    if (!row) return res.status(404).json({ error: 'Key not found' });
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  /* ---------- Support tickets ---------- */
  function seedTickets(userId, email) {
    const c = db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE user_id = ?').get(userId).c;
    if (c > 0) return;
    const insT = db.prepare('INSERT INTO tickets (id, user_id, subject, category, order_ref, status, tone) VALUES (?,?,?,?,?,?,?)');
    const insM = db.prepare('INSERT INTO ticket_messages (ticket_id, sender, body) VALUES (?,?,?)');
    const seed = [
      ['#4821', 'iCloud removal stuck at 50%', 'iCloud removal', 'AP-10428', 'Open', 'warning',
        [['them', 'Hi 👋 Thanks for reaching out. Can you confirm the order ID affected?'],
         ['me', 'It is AP-10428 — the iCloud removal has been at 50% for a while.'],
         ['them', "Thanks! I can see it's actively processing on GSX. Estimated completion is ~6 hrs — flagged as priority."]]],
      ['#4790', 'Refund for failed order AP-10424', 'Billing & refunds', 'AP-10424', 'Resolved', 'success',
        [['them', 'Your refund for AP-10424 has been approved.'],
         ['me', 'Great, thank you. How long until it reflects?'],
         ['them', 'Refunds typically post within 3–5 business days to your original payment method.']]],
    ];
    db.transaction(() => {
      seed.forEach(t => { insT.run(t[0], userId, t[1], t[2], t[3], t[4], t[5]); t[6].forEach(m => insM.run(t[0], m[0], m[1])); });
    })();
  }
  app.get('/api/tickets', authRequired, (req, res) => {
    seedTickets(uid(req), req.user.email);
    const tickets = db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY updated_at DESC').all(uid(req));
    res.json({ tickets });
  });
  app.get('/api/tickets/:id', authRequired, (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?').get(req.params.id, uid(req));
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    t.msgs = db.prepare('SELECT sender, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id').all(t.id);
    res.json({ ticket: t });
  });
  app.post('/api/tickets', authRequired, (req, res) => {
    const subject = String((req.body && req.body.subject) || '').trim() || 'New support request';
    const category = (req.body && req.body.category) || 'Other';
    const order_ref = (req.body && req.body.order) || null;
    const id = '#' + (4822 + Math.floor(Math.random() * 900));
    db.prepare('INSERT INTO tickets (id, user_id, subject, category, order_ref, status, tone) VALUES (?,?,?,?,?,?,?)')
      .run(id, uid(req), subject, category, order_ref, 'Open', 'warning');
    if (req.body && req.body.message) db.prepare('INSERT INTO ticket_messages (ticket_id, sender, body) VALUES (?,?,?)').run(id, 'me', String(req.body.message));
    pushNotification(uid(req), 'headset', 'Ticket ' + id + ' created', subject);
    logActivity({ actor: req.user.email, action: 'opened', target: 'ticket ' + id, level: 'info', ip: clientIp(req) });
    res.json({ ok: true, ticket: { id, subject, status: 'Open', tone: 'warning' } });
  });
  app.post('/api/tickets/:id/messages', authRequired, (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?').get(req.params.id, uid(req));
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const body = String((req.body && req.body.body) || '').trim();
    if (!body) return res.status(400).json({ error: 'Message body required' });
    db.prepare('INSERT INTO ticket_messages (ticket_id, sender, body) VALUES (?,?,?)').run(t.id, 'me', body);
    const reply = 'Got it — a specialist will follow up shortly. Is there anything else I can help with?';
    db.prepare('INSERT INTO ticket_messages (ticket_id, sender, body) VALUES (?,?,?)').run(t.id, 'them', reply);
    db.prepare("UPDATE tickets SET updated_at = datetime('now'), status = CASE WHEN status='Resolved' THEN 'Open' ELSE status END WHERE id = ?").run(t.id);
    res.json({ ok: true, reply });
  });

  /* ---------- Webhooks ---------- */
  app.get('/api/webhooks/endpoint', authRequired, (req, res) => {
    let ep = db.prepare('SELECT * FROM webhook_endpoints WHERE user_id = ?').get(uid(req));
    if (!ep) {
      db.prepare("INSERT INTO webhook_endpoints (user_id, url, secret, events_json, active) VALUES (?,?,?,?,1)")
        .run(uid(req), '', 'whsec_' + crypto.randomBytes(12).toString('hex'), JSON.stringify(['order.created', 'order.completed', 'order.failed']));
      ep = db.prepare('SELECT * FROM webhook_endpoints WHERE user_id = ?').get(uid(req));
    }
    res.json({ url: ep.url || '', secret: ep.secret, active: !!ep.active, events: JSON.parse(ep.events_json || '[]') });
  });
  app.put('/api/webhooks/endpoint', authRequired, (req, res) => {
    const url = String((req.body && req.body.url) || '').trim();
    const events = Array.isArray(req.body && req.body.events) ? req.body.events : null;
    const active = req.body && typeof req.body.active === 'boolean' ? (req.body.active ? 1 : 0) : null;
    const ep = db.prepare('SELECT * FROM webhook_endpoints WHERE user_id = ?').get(uid(req));
    if (!ep) db.prepare('INSERT INTO webhook_endpoints (user_id, secret) VALUES (?, ?)').run(uid(req), 'whsec_' + crypto.randomBytes(12).toString('hex'));
    db.prepare(`UPDATE webhook_endpoints SET url = ?, events_json = COALESCE(?, events_json), active = COALESCE(?, active) WHERE user_id = ?`)
      .run(url, events ? JSON.stringify(events) : null, active, uid(req));
    res.json({ ok: true });
  });
  app.post('/api/webhooks/test', authRequired, async (req, res) => {
    const r = await emitWebhook(uid(req), 'ping.test', { message: 'This is a test event from ActivatePro', ts: nowIso() });
    if (!r) return res.status(400).json({ error: 'No active webhook endpoint configured' });
    pushNotification(uid(req), 'webhook', 'Test event sent', 'HTTP ' + r.status + ' · ' + r.ms + ' ms');
    res.json({ ok: r.status >= 200 && r.status < 300, status: r.status, ms: r.ms });
  });
  // Logs: admins see all, regular users see their own.
  app.get('/api/admin/webhooks', authRequired, (req, res) => {
    const me = dbi.getUserById(uid(req));
    const rows = (me && me.role === 'admin')
      ? db.prepare('SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 100').all()
      : db.prepare('SELECT * FROM webhook_logs WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(uid(req));
    res.json({ logs: rows });
  });

  /* ---------- Activity log ---------- */
  app.get('/api/admin/activity', authRequired, adminRequired, (_req, res) => {
    res.json({ activity: db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 200').all() });
  });

  /* ---------- Notifications ---------- */
  app.get('/api/notifications', authRequired, (req, res) => {
    res.json({ notifications: db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(uid(req)) });
  });
  app.post('/api/notifications/read', authRequired, (req, res) => {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(uid(req));
    res.json({ ok: true });
  });
  app.post('/api/notifications', authRequired, (req, res) => {
    const { icon, title, body } = req.body || {};
    pushNotification(uid(req), icon, title, body);
    res.json({ ok: true });
  });

  /* ---------- User settings (preferences) ---------- */
  app.get('/api/settings', authRequired, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(uid(req));
    const out = {}; rows.forEach(r => { try { out[r.key] = JSON.parse(r.value); } catch (e) { out[r.key] = r.value; } });
    res.json({ settings: out });
  });
  app.put('/api/settings', authRequired, (req, res) => {
    const patch = (req.body && req.body.settings) || req.body || {};
    const up = db.prepare('INSERT INTO user_settings (user_id, key, value) VALUES (?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value');
    db.transaction(() => { Object.entries(patch).forEach(([k, v]) => up.run(uid(req), k, JSON.stringify(v))); })();
    res.json({ ok: true });
  });

  /* ---------- Billing: wallet, payment methods, invoices ---------- */
  function ensureWallet(userId) {
    let w = db.prepare('SELECT * FROM wallet WHERE user_id = ?').get(userId);
    if (!w) { db.prepare('INSERT INTO wallet (user_id, balance) VALUES (?, 0)').run(userId); w = { user_id: userId, balance: 0 }; }
    return w;
  }
  app.get('/api/billing', authRequired, (req, res) => {
    const w = ensureWallet(uid(req));
    const methods = db.prepare('SELECT id, brand, last4, exp, is_default FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC, created_at').all(uid(req));
    const invoices = db.prepare('SELECT id, number, date, amount, status FROM invoices WHERE user_id = ? ORDER BY created_at DESC').all(uid(req));
    res.json({ wallet: { balance: w.balance }, methods, invoices });
  });
  app.post('/api/billing/methods', authRequired, (req, res) => {
    const b = req.body || {};
    const id = rid('pm');
    const makeDefault = db.prepare('SELECT COUNT(*) AS c FROM payment_methods WHERE user_id = ?').get(uid(req)).c === 0 ? 1 : 0;
    db.prepare('INSERT INTO payment_methods (id, user_id, brand, last4, exp, is_default) VALUES (?,?,?,?,?,?)')
      .run(id, uid(req), b.brand || 'Visa', String(b.last4 || '0000').slice(-4), b.exp || '01/30', makeDefault);
    res.json({ ok: true, id });
  });
  app.delete('/api/billing/methods/:id', authRequired, (req, res) => {
    db.prepare('DELETE FROM payment_methods WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
    res.json({ ok: true });
  });
  app.post('/api/billing/methods/:id/default', authRequired, (req, res) => {
    db.prepare('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?').run(uid(req));
    db.prepare('UPDATE payment_methods SET is_default = 1 WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
    res.json({ ok: true });
  });
  app.post('/api/billing/wallet/topup', authRequired, (req, res) => {
    const amount = parseInt((req.body && req.body.amount), 10) || 0;
    if (amount <= 0) return res.status(400).json({ error: 'amount must be positive' });
    ensureWallet(uid(req));
    db.prepare('UPDATE wallet SET balance = balance + ? WHERE user_id = ?').run(amount, uid(req));
    const w = db.prepare('SELECT balance FROM wallet WHERE user_id = ?').get(uid(req));
    pushNotification(uid(req), 'card', 'Wallet topped up', 'Balance is now Rp' + w.balance.toLocaleString('id-ID'));
    res.json({ ok: true, balance: w.balance });
  });
}

function db_invoiceCount() { return db.prepare('SELECT COUNT(*) AS c FROM invoices').get().c; }
function createInvoice(userId, number, amount) {
  const id = rid('inv');
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  db.prepare('INSERT INTO invoices (id, user_id, number, date, amount, status) VALUES (?,?,?,?,?,?)')
    .run(id, userId, number, date, parseInt(amount, 10) || 0, 'Paid');
  return id;
}

module.exports = { mount, logActivity, emitWebhook, pushNotification, clientIp, createInvoice, db_invoiceCount };
