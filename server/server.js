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
function publicUser(u) { return { id: u.id, email: u.email, name: u.name, verified: !!u.verified }; }
function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(tok, JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ error: 'Invalid or expired session' }); }
}

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());

const PROVIDER = (process.env.IMEI_PROVIDER || 'mock').toLowerCase();

/* ---------- Free offline TAC database (model lookup, no API key) ----------
   Source: VTSTech/IMEIDB (open-source). Lets us identify the device MODEL and
   confirm the manufacturer from the first 8 digits of the IMEI for free. */
const fs = require('fs');
const path = require('path');
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
app.post('/api/auth/register', async (req, res) => {
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
app.post('/api/auth/verify-otp', (req, res) => {
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
  if (user) { dbi.markVerified(email); const fresh = dbi.getUserByEmail(email); return res.json({ ok: true, verified: true, token: signToken(fresh), user: publicUser(fresh) }); }
  return res.json({ ok: true, verified: true });
});

// Login with email + password (must be verified).
app.post('/api/auth/login', (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const user = dbi.getUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  if (!user.verified) return res.status(403).json({ error: 'Email not verified', needsVerification: true });
  return res.json({ ok: true, token: signToken(user), user: publicUser(user) });
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
