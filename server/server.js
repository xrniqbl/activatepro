/* ============================================================
   ActivatePro — IMEI verification backend (REAL lookup proxy)
   ------------------------------------------------------------
   This is the piece that makes IMEI validation "beneran":
   the browser does Luhn (format) only; THIS server performs the
   actual device lookup (model / FMI / blacklist / warranty) by
   calling a real IMEI-checker provider with a SECRET API key
   that must never live in front-end code.

   Supported providers (pick one via IMEI_PROVIDER):
     - sickw      → https://sickw.com  (GSX / FMI / blacklist services)
     - dhru       → any DHRU Fusion IMEI API (ifreeicloud, etc.)
     - mock       → deterministic fake data for local UI testing only

   Run:
     cp .env.example .env   # fill in your keys
     npm install
     npm start
   ============================================================ */
'use strict';

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dbi = require('./db');
const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET not set — using an insecure dev secret. Set JWT_SECRET in production.');

function signToken(user) { return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' }); }
function publicUser(u) { return { id: u.id, email: u.email, name: u.name, verified: !!u.verified, role: u.role || 'user' }; }
function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(tok, JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ error: 'Invalid or expired session' }); }
}
function adminRequired(req, res, next) {
  const u = dbi.getUserById(req.user.uid);
  if (!u || u.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
// Emails listed in ADMIN_EMAILS (comma-separated) are auto-promoted to admin.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
function ensureAdmin(email) {
  if (!email) return;
  const e = email.toLowerCase();
  if (ADMIN_EMAILS.includes(e)) {
    const u = dbi.getUserByEmail(e);
    if (u && u.role !== 'admin') dbi.setRole(e, 'admin');
  }
}

const app = express();

// ---- Security headers (helmet) ----
// CSP is disabled because the SPA loads from CDNs (Tailwind, Chart.js, Google Fonts)
// and Midtrans Snap. All other protections (nosniff, frameguard, HSTS, referrer) stay on.
const helmet = require('helmet');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '256kb' }));

// ---- Rate limiting (anti brute-force) ----
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 30,                  // max attempts per IP per window for sensitive auth routes
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts — please try again later' },
});

// ---- File uploads (multer, disk storage under server/uploads) ----
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + '-' + safe);
  },
});
const ALLOWED_UPLOAD_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
]);
function uploadFileFilter(_req, file, cb) {
  // Whitelist only. SVG is intentionally excluded (can carry scripts -> XSS).
  if (ALLOWED_UPLOAD_MIME.has(file.mimetype)) return cb(null, true);
  cb(new Error('Unsupported file type: ' + file.mimetype + ' (allowed: JPG, PNG, GIF, WEBP, HEIC, PDF)'));
}
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024, files: 8 }, fileFilter: uploadFileFilter }); // 10MB/file, max 8
// Serve uploaded files back. Force download (never render inline) + nosniff to defuse stored-XSS.
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res) => {
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  },
}));

const PROVIDER = (process.env.IMEI_PROVIDER || 'mock').toLowerCase();

/* ---------- Free offline TAC database (model lookup, no API key) ----------
   Source: VTSTech/IMEIDB (open-source). Lets us identify the device MODEL and
   confirm the manufacturer from the first 8 digits of the IMEI for free. */
let TACDB = {};
try {
  TACDB = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tacdb.json'), 'utf8'));
  console.log(`Loaded TAC database: ${Object.keys(TACDB).length} entries`);
} catch (e) {
  console.warn('TAC database not loaded (data/tacdb.json missing) — model lookup limited');
}
function tacInfo(imei) {
  const tac = String(imei).slice(0, 8);
  const hit = TACDB[tac] || null;
  return { tac, manufacturer: hit ? hit.manufacturer : null, model: hit ? hit.model : null };
}

/* ---------- Helpers ---------- */
function luhnValid(imei) {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = +imei[i];
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

// Normalize any provider response into the shape the front-end expects.
function normalize({ model, fmi, blacklist, warranty, source, raw }) {
  return {
    model: model || null,
    fmi: fmi || null,            // 'ON' | 'OFF'
    blacklist: blacklist || null, // 'Clean' | 'Blacklisted'
    warranty: warranty || null,
    source: source || PROVIDER,
    raw: process.env.RETURN_RAW === '1' ? raw : undefined,
  };
}

/* ---------- Provider: Sickw ---------- */
// Docs: https://sickw.com/api  — service IDs differ per account/plan.
async function checkSickw(imei) {
  const key = process.env.SICKW_API_KEY;
  const serviceId = process.env.SICKW_SERVICE_ID || '0'; // e.g. FMI / GSX service id
  if (!key) throw new Error('SICKW_API_KEY not set');
  const url = `https://sickw.com/api.php?format=json&key=${encodeURIComponent(key)}&imei=${encodeURIComponent(imei)}&service=${encodeURIComponent(serviceId)}`;
  const r = await fetch(url);
  const data = await r.json();
  if (data.status !== 'success') throw new Error(data.result || 'sickw lookup failed');
  // `data.result` is usually an HTML/text blob; parse the fields you need.
  const text = String(data.result);
  const grab = (label) => {
    const m = text.match(new RegExp(label + '\\s*:?\\s*</?[^>]*>?\\s*([^<\\n]+)', 'i'));
    return m ? m[1].trim() : null;
  };
  return normalize({
    model: grab('Model') || grab('Description'),
    fmi: /find my.*on|fmi.*on/i.test(text) ? 'ON' : (/find my.*off|fmi.*off/i.test(text) ? 'OFF' : null),
    blacklist: /blacklist.*clean|clean/i.test(text) ? 'Clean' : (/blacklist|lost|stolen/i.test(text) ? 'Blacklisted' : null),
    warranty: grab('Warranty') || grab('Coverage'),
    source: 'sickw',
    raw: data,
  });
}

/* ---------- Provider: DHRU Fusion (ifreeicloud-style) ---------- */
async function checkDhru(imei) {
  const apiUrl = process.env.DHRU_API_URL;      // e.g. https://example.com/api/index.php
  const username = process.env.DHRU_USERNAME;
  const apiKey = process.env.DHRU_API_KEY;
  const serviceId = process.env.DHRU_SERVICE_ID;
  if (!apiUrl || !username || !apiKey || !serviceId) throw new Error('DHRU_* env vars not fully set');
  const body = new URLSearchParams({
    username, apiaccesskey: apiKey, action: 'placeimeiorder',
    requestformat: 'JSON', service: serviceId, imei,
  });
  const r = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await r.json();
  const success = data && data.SUCCESS && data.SUCCESS[0];
  if (!success) throw new Error((data && data.ERROR && data.ERROR[0] && data.ERROR[0].MESSAGE) || 'dhru lookup failed');
  const result = String(success.AdditionalInfo?.result || success.RESULT || '');
  const grab = (label) => {
    const m = result.match(new RegExp(label + '\\s*:?\\s*([^<\\n]+)', 'i'));
    return m ? m[1].trim() : null;
  };
  return normalize({
    model: grab('Model') || grab('Description'),
    fmi: /find my.*on/i.test(result) ? 'ON' : (/find my.*off/i.test(result) ? 'OFF' : null),
    blacklist: /clean/i.test(result) ? 'Clean' : (/lost|stolen|blacklist/i.test(result) ? 'Blacklisted' : null),
    warranty: grab('Warranty') || grab('Coverage'),
    source: 'dhru',
    raw: data,
  });
}

/* ---------- Provider: imeilookup.com (advertises a free tier) ----------
   Generic implementation — adjust the URL/params/field mapping to match the
   exact API docs of your imeilookup.com account (free accounts are rate-limited). */
async function checkImeilookup(imei) {
  const key = process.env.IMEILOOKUP_API_KEY;
  const base = process.env.IMEILOOKUP_API_URL || 'https://api.imeilookup.com/check';
  const service = process.env.IMEILOOKUP_SERVICE || '';
  if (!key) throw new Error('IMEILOOKUP_API_KEY not set');
  const url = `${base}?apikey=${encodeURIComponent(key)}&imei=${encodeURIComponent(imei)}` + (service ? `&service=${encodeURIComponent(service)}` : '');
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && (data.error || data.message)) || ('imeilookup ' + r.status));
  // Field names vary per plan — map the most common ones.
  const fmi = data.fmi || data.findMyIphone || data.find_my || null;
  const bl = data.blacklist || data.blacklistStatus || data.gsmaStatus || null;
  return normalize({
    model: data.model || data.modelDesc || data.deviceName || tacInfo(imei).model,
    fmi: fmi ? (String(fmi).toLowerCase().includes('on') ? 'ON' : 'OFF') : null,
    blacklist: bl ? (String(bl).toLowerCase().includes('clean') ? 'Clean' : 'Blacklisted') : null,
    warranty: data.warranty || data.warrantyStatus || data.coverage || null,
    source: 'imeilookup.com',
    raw: data,
  });
}

/* ---------- Provider: mock (UI testing only — clearly labeled) ---------- */
function checkMock(imei) {
  // Deterministic from the IMEI so it's stable but obviously synthetic.
  const n = imei.split('').reduce((a, c) => a + (+c), 0);
  return normalize({
    model: 'iPhone (mock model)',
    fmi: n % 2 ? 'ON' : 'OFF',
    blacklist: n % 3 ? 'Clean' : 'Blacklisted',
    warranty: n % 2 ? 'Out of coverage' : 'Active',
    source: 'mock (NOT REAL — set IMEI_PROVIDER to sickw/dhru)',
  });
}

/* ---------- Route ---------- */
app.post('/api/imei/check', async (req, res) => {
  const imei = String((req.body && req.body.imei) || '').trim();
  if (!luhnValid(imei)) {
    return res.status(400).json({ error: 'Invalid IMEI: must be 15 digits with a valid Luhn checksum' });
  }
  try {
    let result;
    if (PROVIDER === 'sickw') result = await checkSickw(imei);
    else if (PROVIDER === 'dhru') result = await checkDhru(imei);
    else if (PROVIDER === 'imeilookup') result = await checkImeilookup(imei);
    else result = checkMock(imei);
    // Enrich with free offline TAC model if the provider didn't return one
    if (!result.model) result.model = tacInfo(imei).model;
    return res.json(result);
  } catch (e) {
    console.error('[imei/check]', e);
    return res.status(502).json({ error: e.message || 'verification failed' });
  }
});

/* ---------- Free TAC lookup (model only, no API key, no cost) ---------- */
app.post('/api/imei/tac', (req, res) => {
  const imei = String((req.body && req.body.imei) || '').trim();
  if (!luhnValid(imei)) {
    return res.status(400).json({ error: 'Invalid IMEI: must be 15 digits with a valid Luhn checksum' });
  }
  const info = tacInfo(imei);
  return res.json({ ...info, source: 'TAC database (offline, free)' });
});

/* ============================================================
   OTP email verification via Brevo (Transactional Email API)
   ------------------------------------------------------------
   POST /api/auth/send-otp   { email, name? }  -> emails a 6-digit code
   POST /api/auth/verify-otp { email, code }   -> validates the code
   The Brevo API key is SECRET and lives here, never in the frontend.
   Note: otpStore is in-memory (fine for one instance / dev). For
   production use Redis or a DB so codes survive restarts and scale. */
const OTP_TTL = (parseInt(process.env.OTP_TTL_SECONDS, 10) || 300) * 1000;
const otpStore = new Map(); // email -> { code, expires, attempts, lastSent }

function genOtp() { return String(Math.floor(100000 + Math.random() * 900000)); }

function otpEmailHtml(code) {
  const mins = Math.round(OTP_TTL / 60000);
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Inter,Arial,sans-serif;padding:32px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e9ee">
      <tr><td style="background:#266FA2;padding:22px 28px;color:#fff;font-size:18px;font-weight:700">ActivatePro</td></tr>
      <tr><td style="padding:30px 28px">
        <h1 style="margin:0 0 8px;font-size:20px;color:#0f172a">Verify your email</h1>
        <p style="margin:0 0 22px;color:#475569;font-size:14px">Use this code to finish setting up your ActivatePro account.</p>
        <div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#266FA2;background:#f0f6fb;border-radius:10px;text-align:center;padding:16px 0">${code}</div>
        <p style="margin:22px 0 0;color:#94a3b8;font-size:12.5px">This code expires in ${mins} minutes. If you didn't request it, you can ignore this email.</p>
      </td></tr>
    </table></td></tr></table></body></html>`;
}

async function sendBrevoEmail({ to, toName, subject, html, text }) {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error('BREVO_API_KEY not set');
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!senderEmail) throw new Error('BREVO_SENDER_EMAIL not set (must be a verified Brevo sender)');
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: senderEmail, name: process.env.BREVO_SENDER_NAME || 'ActivatePro' },
      to: [{ email: to, name: toName || undefined }],
      subject, htmlContent: html, textContent: text,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.message) || ('Brevo error ' + r.status));
  return data; // { messageId }
}

// Generate + store an OTP (returns the code so the same one is reused on dev fallback).
function makeOtp(email) {
  const code = genOtp();
  otpStore.set(email, { code, expires: Date.now() + OTP_TTL, attempts: 0, lastSent: Date.now() });
  return code;
}
async function emailOtp(email, name, code) {
  await sendBrevoEmail({
    to: email, toName: name,
    subject: 'Your ActivatePro verification code',
    html: otpEmailHtml(code),
    text: `Your ActivatePro verification code is ${code}. It expires in ${Math.round(OTP_TTL / 60000)} minutes.`,
  });
}
function otpResponse(res, code) {
  const out = { ok: true, ttl: OTP_TTL / 1000 };
  if (process.env.OTP_DEV_RETURN === '1') out.devCode = code;
  return res.json(out);
}
function otpError(res, e, code) {
  console.error('[otp]', e);
  if (process.env.OTP_DEV_RETURN === '1') return res.json({ ok: true, ttl: OTP_TTL / 1000, devCode: code, warning: 'email not sent (' + e.message + ') — dev mode' });
  return res.status(502).json({ error: e.message || 'failed to send verification email' });
}
function tooSoon(email) { const p = otpStore.get(email); return p && Date.now() - p.lastSent < 30000; }

// Register: create (or refresh an unverified) account, then email an OTP.
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const name = String((req.body && req.body.name) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const existing = dbi.getUserByEmail(email);
  if (existing && existing.verified) return res.status(409).json({ error: 'Email already registered — please log in' });
  const hash = bcrypt.hashSync(password, 10);
  if (existing) { dbi.updatePassword(email, hash); } else { dbi.createUser({ email, name, passwordHash: hash }); }
  if (tooSoon(email)) return res.status(429).json({ error: 'Please wait a few seconds before requesting another code' });
  const code = makeOtp(email);
  try { await emailOtp(email, name, code); } catch (e) { return otpError(res, e, code); }
  return otpResponse(res, code);
});

// Resend an OTP for an already-registered (unverified) email.
app.post('/api/auth/send-otp', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const name = String((req.body && req.body.name) || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (tooSoon(email)) return res.status(429).json({ error: 'Please wait a few seconds before requesting another code' });
  const code = makeOtp(email);
  try { await emailOtp(email, name, code); } catch (e) { return otpError(res, e, code); }
  return otpResponse(res, code);
});

// Verify the OTP: marks the user verified (if present) and issues a JWT session.
app.post('/api/auth/verify-otp', authLimiter, (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const code = String((req.body && req.body.code) || '').trim();
  const rec = otpStore.get(email);
  if (!rec) return res.status(400).json({ error: 'No code was requested for this email' });
  if (Date.now() > rec.expires) { otpStore.delete(email); return res.status(400).json({ error: 'Code expired — request a new one' }); }
  if (rec.attempts >= 5) { otpStore.delete(email); return res.status(429).json({ error: 'Too many attempts — request a new code' }); }
  rec.attempts++;
  if (code !== rec.code) return res.status(400).json({ error: 'Incorrect code' });
  otpStore.delete(email);
  const user = dbi.getUserByEmail(email);
  if (user) { dbi.markVerified(email); ensureAdmin(email); const fresh = dbi.getUserByEmail(email); return res.json({ ok: true, verified: true, token: signToken(fresh), user: publicUser(fresh) }); }
  return res.json({ ok: true, verified: true });
});

// Login with email + password (must be verified).
app.post('/api/auth/login', authLimiter, (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const user = dbi.getUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  if (!user.verified) return res.status(403).json({ error: 'Email not verified', needsVerification: true });
  ensureAdmin(email); const fresh = dbi.getUserByEmail(email);
  return res.json({ ok: true, token: signToken(fresh), user: publicUser(fresh) });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  const user = dbi.getUserById(req.user.uid);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user: publicUser(user) });
});

/* ---------- Orders (persisted, auth required) ---------- */
app.post('/api/orders', authRequired, (req, res) => {
  const b = req.body || {};
  if (!b.service && !b.device) return res.status(400).json({ error: 'device and service are required' });
  const order = dbi.createOrder({
    user_id: req.user.uid, device: b.device, service: b.service, imei: b.imei,
    amount: parseInt(b.amount, 10) || 0, eta: b.eta || 'Queued', status: b.status || 'Pending',
  });
  return res.json({ ok: true, order });
});
app.get('/api/orders', authRequired, (req, res) => {
  return res.json({ orders: dbi.listOrders(req.user.uid) });
});
app.get('/api/orders/:id', authRequired, (req, res) => {
  const order = dbi.getOrder(req.params.id);
  if (!order || order.user_id !== req.user.uid) return res.status(404).json({ error: 'Order not found' });
  return res.json({ order });
});

/* ---------- Payments: Midtrans Snap (scaffold) ---------- */
app.post('/api/payments/midtrans/create', authRequired, async (req, res) => {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) return res.status(501).json({ error: 'Payments not configured (MIDTRANS_SERVER_KEY missing)' });
  const order = dbi.getOrder(String((req.body && req.body.order_id) || ''));
  if (!order || order.user_id !== req.user.uid) return res.status(404).json({ error: 'Order not found' });
  const isProd = process.env.MIDTRANS_IS_PRODUCTION === '1';
  const base = isProd ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
  const gross = Math.round(order.amount * 1.11); // incl. PPN 11%
  const r = await fetch(base + '/snap/v1/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(serverKey + ':').toString('base64') },
    body: JSON.stringify({ transaction_details: { order_id: order.id, gross_amount: gross }, customer_details: { email: req.user.email } }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(502).json({ error: (data && (data.error_messages || []).join(', ')) || 'Midtrans error' });
  return res.json({ ok: true, token: data.token, redirect_url: data.redirect_url, gross_amount: gross });
});
app.post('/api/payments/midtrans/notify', (req, res) => {
  const n = req.body || {};
  const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
  // Verify Midtrans signature: sha512(order_id + status_code + gross_amount + serverKey)
  if (n.signature_key && n.order_id && n.status_code && n.gross_amount) {
    const expected = crypto.createHash('sha512').update(n.order_id + n.status_code + n.gross_amount + serverKey).digest('hex');
    if (expected !== n.signature_key) return res.status(403).json({ error: 'invalid signature' });
  }
  const status = n.transaction_status;
  if (n.order_id && status) {
    const fraud = n.fraud_status;
    const map = { settlement: 'Processing', capture: (fraud === 'accept' ? 'Processing' : 'Pending'), pending: 'Pending', deny: 'Failed', cancel: 'Failed', expire: 'Failed', refund: 'Failed' };
    dbi.setOrderStatus(n.order_id, map[status] || 'Pending', n.transaction_id);
  }
  return res.json({ ok: true });
});

/* ---------- File uploads (auth required) ---------- */
app.post('/api/uploads', authRequired, (req, res) => {
  upload.array('files', 8)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'upload failed' });
    const files = (req.files || []).map(f => ({
      name: f.originalname, stored: f.filename, size: f.size,
      url: '/uploads/' + f.filename,
    }));
    return res.json({ ok: true, files });
  });
});

/* ---------- Profile: update name (auth required) ---------- */
app.patch('/api/profile', authRequired, (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const user = dbi.updateName(req.user.uid, name);
  return res.json({ ok: true, user: publicUser(user) });
});

/* ---------- Change password (auth required) ---------- */
app.post('/api/auth/change-password', authRequired, (req, res) => {
  const current = String((req.body && req.body.current) || '');
  const next = String((req.body && req.body.next) || '');
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const user = dbi.getUserById(req.user.uid);
  if (!user || !bcrypt.compareSync(current, user.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  dbi.updatePassword(user.email, bcrypt.hashSync(next, 10));
  return res.json({ ok: true });
});

/* ============================================================
   Forgot / Reset password (token via email, in-memory store)
   POST /api/auth/forgot { email } -> emails a reset link/token
   POST /api/auth/reset  { token, password } -> sets a new password
   Tokens are single-use and expire (default 30 min). For production
   use Redis/DB so they survive restarts. ============================================================ */
const RESET_TTL = 30 * 60 * 1000;
const resetStore = new Map(); // token -> { email, expires }
function makeResetToken(email) {
  const token = crypto.randomBytes(24).toString('hex');
  resetStore.set(token, { email, expires: Date.now() + RESET_TTL });
  return token;
}
function resetEmailHtml(link) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Inter,Arial,sans-serif;padding:32px">
    <table role="presentation" width="100%"><tr><td align="center">
    <table role="presentation" width="440" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e9ee">
      <tr><td style="background:#266FA2;padding:22px 28px;color:#fff;font-size:18px;font-weight:700">ActivatePro</td></tr>
      <tr><td style="padding:30px 28px">
        <h1 style="margin:0 0 8px;font-size:20px;color:#0f172a">Reset your password</h1>
        <p style="margin:0 0 22px;color:#475569;font-size:14px">Click the button below to choose a new password. This link expires in 30 minutes.</p>
        <a href="${link}" style="display:inline-block;background:#266FA2;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Reset password</a>
        <p style="margin:22px 0 0;color:#94a3b8;font-size:12.5px">If you didn't request this, you can safely ignore this email.</p>
      </td></tr>
    </table></td></tr></table></body></html>`;
}
app.post('/api/auth/forgot', authLimiter, async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  const user = dbi.getUserByEmail(email);
  // Always respond ok to avoid leaking which emails exist.
  if (!user) return res.json({ ok: true });
  const token = makeResetToken(email);
  const origin = process.env.PUBLIC_URL || (req.headers.origin || '');
  const link = `${origin}/#/reset?token=${token}`;
  try {
    await sendBrevoEmail({
      to: email, toName: user.name,
      subject: 'Reset your ActivatePro password',
      html: resetEmailHtml(link),
      text: `Reset your ActivatePro password: ${link} (expires in 30 minutes)`,
    });
  } catch (e) {
    if (process.env.OTP_DEV_RETURN === '1') return res.json({ ok: true, devToken: token, warning: 'email not sent (' + e.message + ') — dev mode' });
    return res.status(502).json({ error: e.message || 'failed to send reset email' });
  }
  const out = { ok: true };
  if (process.env.OTP_DEV_RETURN === '1') out.devToken = token;
  return res.json(out);
});
app.post('/api/auth/reset', authLimiter, (req, res) => {
  const token = String((req.body && req.body.token) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const rec = resetStore.get(token);
  if (!rec) return res.status(400).json({ error: 'Invalid or used reset link' });
  if (Date.now() > rec.expires) { resetStore.delete(token); return res.status(400).json({ error: 'Reset link expired — request a new one' }); }
  resetStore.delete(token);
  dbi.updatePassword(rec.email, bcrypt.hashSync(password, 10));
  return res.json({ ok: true });
});

/* ---------- Admin (role=admin required) ---------- */
app.get('/api/admin/stats', authRequired, adminRequired, (_req, res) => res.json(dbi.adminStats()));
app.get('/api/admin/orders', authRequired, adminRequired, (_req, res) => res.json({ orders: dbi.listAllOrders() }));
app.get('/api/admin/users', authRequired, adminRequired, (_req, res) => res.json({ users: dbi.listAllUsers() }));
app.patch('/api/admin/orders/:id', authRequired, adminRequired, (req, res) => {
  const status = String((req.body && req.body.status) || '').trim();
  if (!status) return res.status(400).json({ error: 'status is required' });
  dbi.setOrderStatus(req.params.id, status, null);
  return res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ ok: true, provider: PROVIDER }));

// Serve static files from the parent directory (frontend HTML, JS, CSS)
app.use(express.static(path.join(__dirname, '..')));

// Fallback non-API routes to index.html for Single Page App (SPA) client-side routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') {
    return next();
  }
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`ActivatePro IMEI backend on :${PORT} (provider=${PROVIDER})`));
