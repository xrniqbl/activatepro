/* ============================================================
   ActivatePro — Application
   ============================================================ */
'use strict';

/* ---------- Runtime config ----------
   Set imeiApiBase to your backend URL to enable REAL IMEI verification
   (model / FMI / blacklist / warranty via Apple GSX or an IMEI-checker API).
   Leave it empty to run in HONEST offline mode: format + Luhn checksum only,
   with no fabricated device status. See the server/ folder to deploy the proxy. */
// Auto-detect backend API base depending on hosting context
const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const detectedBackend = isLocalhost ? 'http://localhost:8787' : (typeof window !== 'undefined' ? window.location.origin : '');

const CONFIG = {
  // Use auto-detected backend if available, otherwise fallback to empty (offline mode)
  imeiApiBase: detectedBackend, 
  apiBase: detectedBackend,
  // Midtrans Snap (frontend client key) — enables real payment popup at checkout.
  midtransClientKey: '',
  midtransProduction: false,
  // demoMode: fallback to simulation mode only if no backend is detected
  demoMode: !detectedBackend,
};

// In-session auth state (which email is being verified)
const AUTH = { email: '', pendingName: '' };

// Small JSON POST helper for backend calls (auth/OTP).
async function apiPost(path, body) {
  const base = (CONFIG.apiBase || '').replace(/\/$/, '');
  const r = await fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

// Session token (JWT) helpers
function getToken() { try { return localStorage.getItem('ap-token') || ''; } catch (e) { return ''; } }
function setToken(t) { try { t ? localStorage.setItem('ap-token', t) : localStorage.removeItem('ap-token'); } catch (e) {} }
function logout() { setToken(''); AUTH.email = ''; }
async function apiAuthed(path, opts = {}) {
  const base = (CONFIG.apiBase || '').replace(/\/$/, '');
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const tok = getToken(); if (tok) headers.Authorization = 'Bearer ' + tok;
  const r = await fetch(base + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

// Compute initials from a display name (e.g. "Iqbal Saputra" -> "IS")
function initialsOf(name) {
  return String(name || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase() || 'U';
}
// Fetch the signed-in user from the backend and refresh DATA.user + chrome.
async function loadMe() {
  if (!CONFIG.apiBase || !getToken()) return null;
  try {
    const { user } = await apiAuthed('/api/auth/me');
    if (user) {
      DATA.user = { name: user.name || user.email, email: user.email, initials: initialsOf(user.name || user.email), role: user.role || 'user' };
      // Re-render so sidebar/profile reflect the real account.
      try { render(); } catch (e) {}
    }
    return user;
  } catch (e) {
    // Token invalid/expired — clear it so the UI returns to a clean state.
    if (/Invalid|expired|authenticated/i.test(e.message)) logout();
    return null;
  }
}

// Load Midtrans Snap.js on demand
function loadSnap() {
  return new Promise((resolve, reject) => {
    if (window.snap) return resolve();
    const sc = document.createElement('script');
    sc.src = (CONFIG.midtransProduction ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com') + '/snap/snap.js';
    sc.setAttribute('data-client-key', CONFIG.midtransClientKey || '');
    sc.onload = () => resolve();
    sc.onerror = () => reject(new Error('Failed to load payment module'));
    document.head.appendChild(sc);
  });
}
// Create a Snap transaction for an order and open the payment popup
async function payWithMidtrans(orderId) {
  const d = await apiAuthed('/api/payments/midtrans/create', { method: 'POST', body: { order_id: orderId } });
  await loadSnap();
  return new Promise((resolve, reject) => {
    window.snap.pay(d.token, {
      onSuccess: r => resolve(r),
      onPending: r => resolve(r),
      onError: () => reject(new Error('Payment failed')),
      onClose: () => reject(new Error('Payment cancelled')),
    });
  });
}

/* ---------- Icons (Lucide-style inline SVG) ---------- */
const I = {
  _w: (p, s = 20) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`,
  smartphone: s => I._w('<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>', s),
  shield: s => I._w('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>', s),
  zap: s => I._w('<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>', s),
  check: s => I._w('<path d="M20 6 9 17l-5-5"/>', s),
  checkCircle: s => I._w('<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>', s),
  clock: s => I._w('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', s),
  arrowRight: s => I._w('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', s),
  star: s => I._w('<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>', s),
  chevronDown: s => I._w('<path d="m6 9 6 6 6-6"/>', s),
  chevronRight: s => I._w('<path d="m9 18 6-6-6-6"/>', s),
  menu: s => I._w('<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>', s),
  x: s => I._w('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', s),
  bell: s => I._w('<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>', s),
  search: s => I._w('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', s),
  layout: s => I._w('<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>', s),
  package: s => I._w('<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>', s),
  plusCircle: s => I._w('<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>', s),
  truck: s => I._w('<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>', s),
  headset: s => I._w('<path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1z"/><path d="M21 16v-3a9 9 0 0 0-18 0v3"/><path d="M21 11h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2a1 1 0 0 0 1-1z"/>', s),
  settings: s => I._w('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>', s),
  users: s => I._w('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', s),
  dollar: s => I._w('<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', s),
  webhook: s => I._w('<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>', s),
  activity: s => I._w('<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>', s),
  logout: s => I._w('<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>', s),
  upload: s => I._w('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>', s),
  card: s => I._w('<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>', s),
  file: s => I._w('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>', s),
  trend: s => I._w('<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>', s),
  trendDown: s => I._w('<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>', s),
  apple: s => I._w('<path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"/><path d="M10 2c1 .5 2 2 2 5"/>', s),
  google: s => `<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.22V7.04H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"/><path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.04L5.84 9.9C6.71 7.29 9.14 4.75 12 4.75Z"/></svg>`,
  eye: s => I._w('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>', s),
  download: s => I._w('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>', s),
  filter: s => I._w('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>', s),
  dots: s => I._w('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', s),
  send: s => I._w('<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>', s),
  book: s => I._w('<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>', s),
  globe: s => I._w('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>', s),
  lock: s => I._w('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', s),
  mail: s => I._w('<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>', s),
  refresh: s => I._w('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', s),
  alert: s => I._w('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>', s),
  cpu: s => I._w('<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>', s),
  ticket: s => I._w('<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>', s),
};

/* ---------- Mock data ---------- */
const DATA = {
  user: { name: 'Iqbal Saputra', email: 'iqbal@activatepro.io', initials: 'IS' },
  services: [
    { id: 'icloud', name: 'iCloud Activation Lock Removal', price: 50000, from: 1, eta: '2–24 jam', popular: true, desc: 'Clean iCloud-locked iPhones tied to a previous Apple ID. Premium IMEI service.', features:['Clean & Lost mode','All iPhone models','GSX report included','98.6% success rate'] },
    { id: 'carrier', name: 'Carrier Network Unlock', price: 75000, from: 1, eta: '1–48 jam', popular: false, desc: 'Factory unlock from AT&T, T-Mobile, Verizon and 80+ global carriers.', features:['Permanent factory unlock','80+ carriers','No jailbreak needed','Lifetime guarantee'] },
    { id: 'fmi', name: 'FMI / Activation Status Check', price: 25000, flat: 1, eta: 'Instan', popular: false, desc: 'Instant Find My iPhone, blacklist & warranty status report via GSX.', features:['Find My status','Blacklist check','Warranty & coverage','Instant delivery'] },
    { id: 'mdm', name: 'MDM Profile Bypass', price: 100000, from: 1, eta: '1–6 jam', popular: false, desc: 'Remove Remote Management (MDM) enrollment lock screen safely.', features:['Remote Management bypass','No data loss','iOS 12–18 support','Setup assistance'] },
  ],
  devices: ['iPhone 16 Pro Max','iPhone 16 Pro','iPhone 16','iPhone 15 Pro','iPhone 15','iPhone 14 Pro','iPhone 13','iPhone SE (3rd gen)','iPad Pro M4','Apple Watch Ultra 2'],
  orders: [
    { id:'AP-10428', device:'iPhone 15 Pro', service:'iCloud Activation Lock Removal', imei:'356789104253871', status:'Processing', amount:1350000, date:'2026-06-19', eta:'~6 hrs' },
    { id:'AP-10427', device:'iPhone 14 Pro', service:'Carrier Network Unlock', imei:'351299832104577', status:'Completed', amount:900000, date:'2026-06-18', eta:'Done' },
    { id:'AP-10426', device:'iPhone 16 Pro Max', service:'FMI Status Check', imei:'350112998475210', status:'Completed', amount:25000, date:'2026-06-18', eta:'Done' },
    { id:'AP-10425', device:'iPhone 13', service:'MDM Profile Bypass', imei:'358211004785612', status:'Pending', amount:700000, date:'2026-06-17', eta:'Queued' },
    { id:'AP-10424', device:'iPhone 15', service:'iCloud Activation Lock Removal', imei:'356900112478553', status:'Failed', amount:1250000, date:'2026-06-16', eta:'Refunded' },
    { id:'AP-10423', device:'iPhone SE (3rd gen)', service:'Carrier Network Unlock', imei:'359002148756301', status:'Completed', amount:750000, date:'2026-06-15', eta:'Done' },
  ],
  admins: [
    { name:'Alicia Moreno', email:'alicia@activatepro.io', role:'Owner', status:'Active', orders:1284, joined:'2024-01-12' },
    { name:'David Chen', email:'david@activatepro.io', role:'Operator', status:'Active', orders:842, joined:'2024-06-03' },
    { name:'Priya Nair', email:'priya@activatepro.io', role:'Support', status:'Active', orders:391, joined:'2025-02-19' },
    { name:'Marco Rossi', email:'marco@reseller.co', role:'Reseller', status:'Suspended', orders:77, joined:'2025-09-30' },
  ],
  webhooks: [
    { id:'evt_9f23', event:'order.completed', url:'https://reseller.co/hooks/ap', status:200, ms:142, time:'11:24:02' },
    { id:'evt_9f22', event:'order.created', url:'https://reseller.co/hooks/ap', status:200, ms:98, time:'11:23:41' },
    { id:'evt_9f21', event:'payment.succeeded', url:'https://billing.acme.io/wh', status:200, ms:211, time:'11:20:18' },
    { id:'evt_9f20', event:'order.failed', url:'https://reseller.co/hooks/ap', status:500, ms:5031, time:'11:14:55' },
    { id:'evt_9f19', event:'imei.verified', url:'https://reseller.co/hooks/ap', status:200, ms:120, time:'11:09:30' },
  ],
  activity: [
    { who:'David Chen', act:'completed order', obj:'AP-10427', time:'2 min ago', type:'success' },
    { who:'System', act:'auto-refunded failed order', obj:'AP-10424', time:'18 min ago', type:'warning' },
    { who:'Priya Nair', act:'replied to ticket', obj:'#4821', time:'34 min ago', type:'info' },
    { who:'Alicia Moreno', act:'updated pricing for', obj:'Carrier Unlock', time:'1 hr ago', type:'info' },
    { who:'System', act:'webhook delivery failed', obj:'evt_9f20', time:'1 hr ago', type:'danger' },
  ],
};

/* ---------- Helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const money = n => 'Rp' + Number(n).toLocaleString('id-ID');
function statusBadge(s) {
  const m = { Completed:'success', Processing:'info', Pending:'warning', Failed:'danger', Queued:'neutral' };
  return `<span class="badge badge-${m[s]||'neutral'} badge-dot">${s}</span>`;
}
function toast(msg, icon = 'checkCircle') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${I[icon] ? I[icon](18) : ''}<span>${msg}</span>`;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 250); }, 2800);
}

/* ---------- Router (click-intercept; works inside sandboxed iframes) ---------- */
const ROUTES = {};
let _route = ((location.hash || '#/').slice(1).split('#')[0]) || '/';
function route(path, fn) { ROUTES[path] = fn; }
function currentPath() { return _route; }
function navigate(path) {
  _route = path || '/';
  try { history.replaceState(null, '', '#' + _route); } catch (e) {}
  render();
}
function render() {
  const path = currentPath();
  const fn = ROUTES[path] || ROUTES['/'];
  const app = $('#app');
  app.innerHTML = '';
  app.appendChild(fn());
  window.scrollTo(0, 0);
  if (typeof fn._after === 'function') fn._after();
  bindGlobal();
}
// Intercept all in-app anchor clicks and route programmatically.
document.addEventListener('click', function (e) {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.charAt(0) !== '#') return;
  e.preventDefault();
  let target = href.slice(1), section = null;
  const hi = target.indexOf('#');
  if (hi >= 0) { section = target.slice(hi + 1); target = target.slice(0, hi); }
  if (!target) target = '/';
  navigate(target);
  if (section) { const s = document.getElementById(section); if (s) setTimeout(() => s.scrollIntoView({ behavior: 'smooth' }), 60); }
});
// Fallback for back/forward + deep links.
window.addEventListener('hashchange', function () {
  const p = ((location.hash || '#/').slice(1).split('#')[0]) || '/';
  if (p !== _route) { _route = p; render(); }
});
window.addEventListener('DOMContentLoaded', () => { render(); loadMe(); });

function el(html) { const t = document.createElement('div'); t.innerHTML = html.trim(); return t.firstElementChild; }

/* ============================================================
   MARKETING CHROME
   ============================================================ */
function brandLogo(dark = false) {
  return `<a href="#/" style="display:flex;align-items:center;gap:10px">
    <span class="logo-mark">${I.shield(20)}</span>
    <span style="font-weight:800;font-size:17px;letter-spacing:-.02em;color:${dark?'#fff':'var(--foreground)'}">ActivatePro</span>
  </a>`;
}
function marketingNav() {
  return `<header class="nav"><div class="container-x" style="display:flex;align-items:center;justify-content:space-between;height:68px">
    ${brandLogo()}
    <nav class="hidden md:flex" style="align-items:center;gap:4px">
      <a class="nav-link" href="#/#services">Pricing</a>
      <a class="nav-link" href="#/#devices">Devices</a>
      <a class="nav-link" href="#/#features">Features</a>
      <a class="nav-link" href="#/#faq">FAQ</a>
      <a class="nav-link" href="#/support">Support</a>
    </nav>
    <div style="display:flex;align-items:center;gap:10px">
      ${themeBtn()}
      <a class="btn btn-ghost btn-sm hidden sm:inline-flex" href="#/login">Sign in</a>
      <a class="btn btn-primary btn-sm" href="#/register">Get started ${I.arrowRight(15)}</a>
    </div>
  </div></header>`;
}
function marketingFooter() {
  const col = (h, links) => `<div><div style="font-weight:700;font-size:13px;margin-bottom:14px">${h}</div>
    ${links.map(l => `<a href="${l[1]}" class="muted" style="display:block;font-size:13.5px;margin-bottom:10px">${l[0]}</a>`).join('')}</div>`;
  return `<footer style="background:#0a0a0a;color:#fff">
    <div class="container-x" style="padding:64px 24px 32px">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:40px" class="footer-grid">
        <div style="max-width:300px">
          ${brandLogo(true)}
          <p style="color:#9aa3ad;font-size:13.5px;margin-top:16px;line-height:1.7">Enterprise-grade iPhone activation and device service management. Trusted by 12,000+ resellers worldwide.</p>
          <div style="display:flex;gap:8px;margin-top:18px">
            <span class="badge" style="background:#16221c;color:#34d399">${I.shield(13)} SOC 2 Type II</span>
            <span class="badge" style="background:#1a2230;color:#7cc0ec">256-bit SSL</span>
          </div>
        </div>
        ${col('Product', [['Pricing','#/#services'],['Supported devices','#/#devices'],['New order','#/dashboard/new-order'],['Order tracking','#/dashboard/tracking']])}
        ${col('Company', [['About','#/'],['Support center','#/support'],['Admin console','#/admin'],['API & webhooks','#/admin/webhooks']])}
        ${col('Legal', [['Terms of service','#/'],['Privacy policy','#/'],['Refund policy','#/'],['Status','#/']])}
      </div>
      <div class="divider" style="background:#222;margin:40px 0 24px"></div>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;color:#7a828c;font-size:12.5px">
        <span>© 2026 ActivatePro Inc. All rights reserved.</span>
        <span style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:999px;background:#34d399;display:inline-block"></span> All systems operational</span>
      </div>
    </div>
  </footer>`;
}

/* ============================================================
   1. LANDING PAGE
   ============================================================ */
route('/', function () {
  /* ---- imagery for product-style cards ---- */
  const SERVICE_IMG = {
    icloud:  'assets/phone-titanium.jpg',
    carrier: 'assets/phone-desert.jpg',
    fmi:     'assets/phone-blue.jpg',
    mdm:     'assets/phone-black.jpg',
  };
  const SERVICE_TAG = { icloud:'NEW', carrier:'', fmi:'', mdm:'HOT' };
  const SWATCHES = ['#8c8c8c','#1d1d1f','#c8b79e','#3a4a63'];

  /* ---- FEATURED SERVICES (product-card style) ---- */
  const featured = DATA.services.map(s => `
    <div class="store-card">
      ${SERVICE_TAG[s.id] ? `<span class="store-tag ${SERVICE_TAG[s.id]==='HOT'?'tag-hot':'tag-new'}">${SERVICE_TAG[s.id]}</span>` : ''}
      <div class="store-card-img"><img src="${SERVICE_IMG[s.id]||'assets/phone-titanium.jpg'}" alt="${s.name}" loading="lazy"></div>
      <div class="store-swatches">
        ${SWATCHES.map((c,i)=>`<span class="sw ${i===0?'active':''}" style="background:${c}"></span>`).join('')}
        <span class="store-cap">All iPhone</span>
      </div>
      <h3 class="store-card-title">${s.name}</h3>
      <div class="store-price"><span class="muted" style="font-size:12.5px">${s.flat?'Flat':'Mulai'}</span> <b>${money(s.price)}</b></div>
      <a href="#/dashboard/new-order" class="btn-buy">Order Now ${I.arrowRight(15)}</a>
    </div>`).join('');

  /* ---- TRUST STRIP ---- */
  const trust = [
    ['shield','Original Process','Metode resmi berbasis IMEI.'],
    ['zap','Proses Cepat','Selesai dalam 1\u201324 jam.'],
    ['lock','Secure Payment','Pembayaran aman & terenkripsi.'],
    ['checkCircle','Garansi Resmi','No-fix-no-fee guarantee.'],
  ].map(t=>`<div class="trust-item">
      <span class="trust-ico">${I[t[0]]?I[t[0]](22):I.shield(22)}</span>
      <div><div class="trust-h">${t[1]}</div><div class="muted" style="font-size:12.5px">${t[2]}</div></div>
    </div>`).join('');

  /* ---- SERVICE CATEGORIES (Shop By Category style) ---- */
  const cats = [
    ['iCloud Removal','Activation Lock','assets/phone-titanium.jpg','#/dashboard/new-order'],
    ['Carrier Unlock','Factory unlock','assets/phone-desert.jpg','#/dashboard/new-order'],
    ['Status Check','FMI & blacklist','assets/phone-blue.jpg','#/dashboard/new-order'],
    ['MDM Bypass','Remote management','assets/phone-black.jpg','#/dashboard/new-order'],
  ].map(c=>`<a href="${c[3]}" class="cat-card">
      <div class="cat-text"><div class="cat-h">${c[0]}</div><div class="cat-sub">${c[1]}</div>
        <span class="cat-arrow">${I.arrowRight(16)}</span></div>
      <img src="${c[2]}" alt="${c[0]}" class="cat-img" loading="lazy">
    </a>`).join('');

  /* ---- COMPARE SERVICES table ---- */
  const compareRows = DATA.services.map(s=>`<tr>
      <td style="font-weight:700">${s.name}</td>
      <td>${s.eta}</td>
      <td>All iPhone</td>
      <td>98.6%</td>
      <td style="font-weight:700">${money(s.price)}</td>
    </tr>`).join('');

  /* ---- TESTIMONIALS ---- */
  const testi = [
    ['Pengerjaan cepat, iCloud kebuka dalam hitungan jam. Mantap!','Rizky Pratama','RP'],
    ['Admin ramah, proses jelas dan aman. Carrier unlock sukses 100%.','Dewi Anggraini','DA'],
    ['Best service! Harga transparan, garansi beneran ada. Recommended.','Michael Jonathan','MJ'],
  ].map(t=>`<div class="card card-pad testi-card">
      <div class="star" style="display:flex;gap:2px;margin-bottom:10px">${I.star(16).repeat(5)}</div>
      <p style="font-size:14px;line-height:1.6;margin-bottom:16px">${t[0]}</p>
      <div style="display:flex;align-items:center;gap:11px"><span class="avatar">${t[2]}</span>
        <div style="font-weight:600;font-size:13.5px">${t[1]}</div></div>
    </div>`).join('');

  /* ---- PAYMENT METHODS ---- */
  const pays = ['VISA','Mastercard','BCA','Mandiri','BRI','QRIS','GoPay','OVO','Dana'].map(p=>`<span class="pay-chip">${p}</span>`).join('');

  /* ---- FAQ ---- */
  const faqs = [
    ['Apakah prosesnya aman dan permanen?','Ya. Semua layanan menggunakan metode resmi berbasis IMEI yang terhubung ke database Apple GSX dan carrier. Carrier unlock bersifat factory-level dan permanen \u2014 tetap aktif setelah update iOS maupun reset.'],
    ['Berapa lama proses activation?','Sebagian besar layanan diproses dalam 1\u201324 jam. Cek status FMI bersifat instan. Anda menerima update di setiap tahap melalui timeline pelacakan order.'],
    ['Bagaimana jika layanan gagal?','Order yang gagal otomatis di-refund ke wallet atau metode pembayaran asal. Tingkat keberhasilan 98.6% kami didukung jaminan no-fix-no-fee.'],
    ['Apakah melayani reseller & order banyak?','Tentu. Reseller console menyediakan harga volume, REST API, signed webhooks, dan manajemen sub-akun untuk tim dengan volume tinggi.'],
    ['Metode pembayaran apa saja yang diterima?','Kami menerima kartu kredit/debit, transfer bank, QRIS, GoPay, OVO, dan Dana. Semua pembayaran aman dan terenkripsi.'],
  ].map(f=>`<div class="acc-item" data-acc>
      <button class="acc-trigger">${f[0]}<span class="acc-chevron">${I.chevronDown(20)}</span></button>
      <div class="acc-body"><p style="padding:0 4px 20px;font-size:14px;line-height:1.7">${f[1]}</p></div></div>`).join('');

  const page = el(`<div>
    ${marketingNav()}

    <!-- HERO -->
    <section class="store-hero">
      <img class="store-hero-bgimg" src="assets/hero-iphones.jpg" alt="iPhone activation" loading="eager">
      <div class="store-hero-overlay"></div>
      <div class="container-x store-hero-grid">
        <div class="store-hero-copy fade-in">
          <h1 class="store-hero-title">Activate &amp; Unlock<br>Any <span>iPhone</span></h1>
          <p class="store-hero-sub">100% Metode Original. Proses Cepat. Garansi Resmi. Harga Terbaik.</p>
          <div class="store-hero-cta">
            <a href="#/dashboard/new-order" class="btn-store-dark">Start Order</a>
            <a href="#/#services" class="btn-store-ghost">View Services</a>
          </div>
          <div class="store-hero-badges">
            ${[['shield','100% Original','IMEI-based methods'],['checkCircle','Garansi Resmi','No-fix-no-fee'],['zap','Proses Cepat','1\u201324 jam selesai']].map(b=>`
              <div class="hb"><span class="hb-ico">${I[b[0]]?I[b[0]](18):I.shield(18)}</span><div><div class="hb-h">${b[0]==='shield'?'100% Original':b[0]==='checkCircle'?'Garansi Resmi':'Proses Cepat'}</div><div class="hb-s">${b[2]}</div></div></div>`).join('')}
          </div>
        </div>
      </div>
      <div class="store-dots"><span class="dot active"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    </section>

    <!-- FEATURED SERVICES -->
    <section class="section" id="services"><div class="container-x">
      <div class="store-head">
        <h2 class="store-h2">Featured Services</h2>
        <a href="#/dashboard/new-order" class="btn-pill">View All Services ${I.arrowRight(15)}</a>
      </div>
      <div class="store-grid">${featured}</div>
    </div></section>

    <!-- TRUST STRIP -->
    <section class="trust-strip"><div class="container-x trust-grid">${trust}</div></section>

    <!-- SERVICE CATEGORIES -->
    <section class="section"><div class="container-x">
      <div style="text-align:center;margin-bottom:36px"><h2 class="store-h2">Our Services</h2></div>
      <div class="cat-grid">${cats}</div>
    </div></section>

    <!-- COMPARE SERVICES -->
    <section class="section" style="padding-top:0"><div class="container-x">
      <div class="store-head"><h2 class="store-h2">Compare Services</h2>
        <a href="#/#services" class="btn-pill">All Services ${I.arrowRight(15)}</a></div>
      <div class="table-wrapper compare-wrap"><table class="compare-table">
        <thead><tr><th>Service</th><th>Turnaround</th><th>Devices</th><th>Success</th><th>Starting From</th></tr></thead>
        <tbody>${compareRows}</tbody></table></div>
    </div></section>

    <!-- SUPPORTED DEVICES (dark) -->
    <section class="section"><div class="container-x">
      <div class="dark-band">
        <div class="dark-band-copy">
          <h2 style="color:#fff;font-size:30px;margin:0 0 12px">Mendukung Semua Model iPhone</h2>
          <p style="color:#9aa3ad;font-size:14.5px;line-height:1.7;margin:0 0 22px;max-width:380px">Dari iPhone 6 hingga iPhone 17 Pro Max \u2014 lintas semua versi iOS dan 80+ carrier di seluruh dunia.</p>
          <div class="brand-chips">
            ${['iPhone','iPad','Apple Watch','AT&amp;T','T-Mobile','Verizon'].map(b=>`<span class="brand-chip">${b}</span>`).join('')}
          </div>
          <a href="#/dashboard/new-order" class="btn-store-light" style="margin-top:24px">Check Compatibility ${I.arrowRight(15)}</a>
        </div>
        <div class="dark-band-img"><img src="assets/devices-dark.jpg" alt="Supported iPhones" loading="lazy"></div>
      </div>
    </div></section>

    <!-- TESTIMONIALS -->
    <section class="section" style="background:var(--surface)"><div class="container-x">
      <div style="text-align:center;margin-bottom:40px"><h2 class="store-h2">What Our Customers Say</h2></div>
      <div class="testi-grid">${testi}</div>
    </div></section>

    <!-- PAYMENTS -->
    <section class="section" style="padding-top:0"><div class="container-x">
      <div class="pay-band">
        <div><div class="store-cap" style="margin-bottom:14px">Secure Payment</div><div class="pay-row">${pays}</div></div>
        <div class="install-box"><div><div style="font-weight:700;font-size:14px">Cicilan 0%</div><div class="muted" style="font-size:12px">Hingga 24 bulan \u00b7 BCA \u00b7 Mandiri \u00b7 BRI</div></div><div class="install-zero">0<span>%</span></div></div>
      </div>
    </div></section>

    <!-- FAQ -->
    <section class="section" id="faq" style="padding-top:0"><div class="container-x" style="max-width:820px">
      <div style="text-align:center;margin:0 auto 36px"><h2 class="store-h2">Frequently Asked Questions</h2></div>
      <div class="card" style="padding:8px 24px">${faqs}</div>
    </div></section>

    <!-- CTA dark -->
    <section style="padding:0 0 64px"><div class="container-x">
      <div class="cta-band">
        <img src="assets/devices-dark.jpg" class="cta-img" alt="">
        <div class="cta-copy">
          <h2 style="color:#fff;font-size:32px;margin:0 0 10px">Activate Your Device Today</h2>
          <p style="color:#c7ccd3;font-size:15px;max-width:440px;margin:0">Aktivasi & unlock iPhone Anda dengan proses tercepat dan garansi resmi.</p>
        </div>
        <div class="cta-actions">
          <a href="#/dashboard/new-order" class="btn-store-light">Start Order</a>
          <a href="#/support" class="btn-store-outline">Contact Support</a>
        </div>
      </div>
    </div></section>

    ${marketingFooter()}
  </div>`);
  return page;
});

/* ============================================================
   AUTH PAGES (Login / Register) — split layout
   ============================================================ */
function authAside(title, sub, points) {
  return `<div style="background:linear-gradient(150deg,#2563eb,#1e3a8a);color:#fff;padding:48px;display:flex;flex-direction:column;position:relative;overflow:hidden" class="auth-aside">
    <div class="grid-mask" style="position:absolute;inset:0;opacity:.15"></div>
    <div style="position:relative;flex:1;display:flex;flex-direction:column">
      ${brandLogo(true)}
      <div style="margin-top:auto">
        <h2 style="font-size:30px;color:#fff;line-height:1.2;margin-bottom:14px">${title}</h2>
        <p style="opacity:.9;font-size:15px;line-height:1.6;max-width:380px;margin-bottom:28px">${sub}</p>
        <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:14px">
          ${points.map(p => `<li style="display:flex;gap:11px;align-items:flex-start;font-size:14px"><span style="margin-top:1px">${I.checkCircle(18)}</span>${p}</li>`).join('')}
        </ul>
        <div style="margin-top:36px;display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.12);padding:14px 16px;border-radius:14px;backdrop-filter:blur(8px);max-width:380px">
          <div class="star" style="display:flex;gap:1px">${I.star(15).repeat(5)}</div>
          <span style="font-size:13px;opacity:.95">Rated 4.9/5 by 3,200+ businesses</span>
        </div>
      </div>
    </div>
  </div>`;
}

route('/login', function () {
  const page = el(`<div style="min-height:100dvh;display:grid;grid-template-columns:1fr 1fr" class="auth-shell">
    ${authAside('Welcome back.', 'Sign in to manage your orders, track activations, and access your reseller console.', ['Real-time order tracking & notifications','Wallet balance and invoice history','Reseller API keys & webhook logs'])}
    <div style="display:flex;align-items:center;justify-content:center;padding:40px 24px;background:var(--background)">
      <div style="width:100%;max-width:400px" class="fade-in">
        <div class="md:hidden" style="margin-bottom:24px">${brandLogo()}</div>
        <h1 style="font-size:26px;margin-bottom:6px">Sign in</h1>
        <p class="muted" style="margin-bottom:26px;font-size:14px">Don't have an account? <a href="#/register" style="color:var(--primary);font-weight:600">Create one</a></p>
        <div style="display:flex;gap:10px;margin-bottom:22px">
          <button class="btn btn-outline btn-block" data-toast="Google sign-in (demo)">${I.google(18)} Google</button>
          <button class="btn btn-outline btn-block" data-toast="Apple sign-in (demo)">${I.apple(17)} Apple</button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px"><div class="divider" style="flex:1"></div><span class="muted" style="font-size:12px">or continue with email</span><div class="divider" style="flex:1"></div></div>
        <form id="loginForm" novalidate style="display:flex;flex-direction:column;gap:16px">
          <div class="field"><label class="label">Email</label>
            <div class="input-group"><span class="input-icon">${I.mail(17)}</span><input class="input" name="email" type="email" placeholder="you@company.com"></div>
            <span class="input-error" data-err="email">Enter a valid email address.</span></div>
          <div class="field">
            <div style="display:flex;justify-content:space-between"><label class="label">Password</label><a href="#/forgot" style="font-size:12.5px;color:var(--primary);font-weight:600">Forgot?</a></div>
            <div class="input-group"><span class="input-icon">${I.lock(17)}</span><input class="input" name="password" type="password" placeholder="••••••••" style="padding-right:42px"><button type="button" class="pw-toggle" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted-foreground)">${I.eye(18)}</button></div>
            <span class="input-error" data-err="password">Password is required.</span></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer"><input type="checkbox" style="width:16px;height:16px;accent-color:var(--primary)"> Keep me signed in</label>
          <button type="submit" class="btn btn-primary btn-block btn-lg">Sign in ${I.arrowRight(16)}</button>
        </form>
      </div>
    </div>
  </div>`);
  return page;
});
ROUTES['/login']._after = function () {
  bindPwToggle();
  const f = $('#loginForm');
  f.addEventListener('submit', e => {
    e.preventDefault();
    let ok = true;
    const email = f.email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showErr(f.email, 'email'); ok = false; } else clearErr(f.email, 'email');
    if (!f.password.value) { showErr(f.password, 'password'); ok = false; } else clearErr(f.password, 'password');
    if (!ok) return;
    AUTH.email = email.toLowerCase();
    if (!CONFIG.apiBase) { toast('Signed in successfully'); setTimeout(() => navigate('/dashboard'), 600); return; }
    apiPost('/api/auth/login', { email: AUTH.email, password: f.password.value })
      .then(d => { setToken(d.token); toast('Signed in successfully'); navigate('/dashboard'); })
      .catch(err => {
        if (/not verified/i.test(err.message)) { apiPost('/api/auth/send-otp', { email: AUTH.email }).catch(() => {}); toast('Please verify your email'); navigate('/verify'); return; }
        showErr(f.password, 'password'); toast(err.message);
      });
  });
};

route('/register', function () {
  const page = el(`<div style="min-height:100dvh;display:grid;grid-template-columns:1fr 1fr" class="auth-shell">
    ${authAside('Start in 60 seconds.', 'Create your ActivatePro account and process your first device activation today. No setup fees.', ['Free account — pay only per device','Instant IMEI validation & GSX checks','98.6% success rate, money-back guarantee'])}
    <div style="display:flex;align-items:center;justify-content:center;padding:40px 24px;background:var(--background)">
      <div style="width:100%;max-width:420px" class="fade-in">
        <div class="md:hidden" style="margin-bottom:24px">${brandLogo()}</div>
        <h1 style="font-size:26px;margin-bottom:6px">Create your account</h1>
        <p class="muted" style="margin-bottom:24px;font-size:14px">Already registered? <a href="#/login" style="color:var(--primary);font-weight:600">Sign in</a></p>
        <div style="display:flex;gap:10px;margin-bottom:20px">
          <button class="btn btn-outline btn-block" data-toast="Google sign-up (demo)">${I.google(18)} Google</button>
          <button class="btn btn-outline btn-block" data-toast="Apple sign-up (demo)">${I.apple(17)} Apple</button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px"><div class="divider" style="flex:1"></div><span class="muted" style="font-size:12px">or</span><div class="divider" style="flex:1"></div></div>
        <form id="regForm" novalidate style="display:flex;flex-direction:column;gap:15px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label class="label">First name</label><input class="input" name="first" placeholder="Iqbal"><span class="input-error" data-err="first">Required</span></div>
            <div class="field"><label class="label">Last name</label><input class="input" name="last" placeholder="Saputra"><span class="input-error" data-err="last">Required</span></div>
          </div>
          <div class="field"><label class="label">Work email</label>
            <div class="input-group"><span class="input-icon">${I.mail(17)}</span><input class="input" name="email" type="email" placeholder="you@company.com"></div>
            <span class="input-error" data-err="email">Enter a valid email address.</span></div>
          <div class="field"><label class="label">Password</label>
            <div class="input-group"><span class="input-icon">${I.lock(17)}</span><input class="input" name="password" type="password" placeholder="Create a strong password" style="padding-right:42px"><button type="button" class="pw-toggle" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted-foreground)">${I.eye(18)}</button></div>
            <div class="strength-bars" style="margin-top:8px"><span></span><span></span><span></span><span></span></div>
            <span class="input-hint" id="pwHint">Use 8+ characters with a mix of letters, numbers & symbols.</span></div>
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;cursor:pointer;color:var(--muted-foreground)"><input type="checkbox" name="terms" style="width:16px;height:16px;accent-color:var(--primary);margin-top:2px"> I agree to the <a href="#/" style="color:var(--primary)">Terms</a> &amp; <a href="#/" style="color:var(--primary)">Privacy Policy</a></label>
          <span class="input-error" data-err="terms" style="margin-top:-8px">Please accept the terms to continue.</span>
          <button type="submit" class="btn btn-primary btn-block btn-lg">Create account ${I.arrowRight(16)}</button>
        </form>
      </div>
    </div>
  </div>`);
  return page;
});
ROUTES['/register']._after = function () {
  bindPwToggle();
  const f = $('#regForm');
  const bars = $$('.strength-bars > span', f);
  const hint = $('#pwHint', f);
  f.password.addEventListener('input', () => {
    const v = f.password.value; let score = 0;
    if (v.length >= 8) score++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/\d/.test(v)) score++; if (/[^A-Za-z0-9]/.test(v)) score++;
    const colors = ['', '#dc2626', '#d97706', '#2563eb', '#16a34a'];
    const labels = ['', 'Weak password', 'Fair password', 'Good password', 'Strong password'];
    bars.forEach((b, i) => b.style.background = i < score ? colors[score] : 'var(--muted)');
    if (v) { hint.textContent = labels[score] || labels[1]; hint.style.color = colors[score] || '#dc2626'; }
    else { hint.textContent = 'Use 8+ characters with a mix of letters, numbers & symbols.'; hint.style.color = 'var(--muted-foreground)'; }
  });
  f.addEventListener('submit', e => {
    e.preventDefault(); let ok = true;
    ['first', 'last'].forEach(n => { if (!f[n].value.trim()) { showErr(f[n], n); ok = false; } else clearErr(f[n], n); });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim())) { showErr(f.email, 'email'); ok = false; } else clearErr(f.email, 'email');
    if (f.password.value.length < 8) { showErr(f.password, null); $('[data-err="password"]', f) && true; ok = false; }
    if (!f.terms.checked) { $('[data-err="terms"]').classList.add('show'); ok = false; } else $('[data-err="terms"]').classList.remove('show');
    if (!ok) return;
    AUTH.email = f.email.value.trim().toLowerCase();
    AUTH.pendingName = (f.first.value.trim() + ' ' + f.last.value.trim()).trim();
    if (!CONFIG.apiBase) { toast('Account created — verify your email'); setTimeout(() => navigate('/verify'), 600); return; }
    toast('Sending verification code…');
    apiPost('/api/auth/send-otp', { email: AUTH.email, name: AUTH.pendingName })
      .then(() => { toast('Verification code sent'); navigate('/verify'); })
      .catch(err => toast('Could not send code: ' + err.message));
  });
};

/* shared form helpers */
function showErr(input, key) { input.classList.add('error'); if (key) { const e = document.querySelector(`[data-err="${key}"]`); if (e) e.classList.add('show'); } }
function clearErr(input, key) { input.classList.remove('error'); if (key) { const e = document.querySelector(`[data-err="${key}"]`); if (e) e.classList.remove('show'); } }
function bindPwToggle() {
  $$('.pw-toggle').forEach(btn => btn.addEventListener('click', () => {
    const inp = btn.parentElement.querySelector('input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }));
}

/* ============================================================
   DASHBOARD SHELL (shared by customer + admin)
   ============================================================ */
const CUSTOMER_NAV = [
  { sec: 'Main' },
  { k: '/dashboard', label: 'Dashboard', icon: 'layout' },
  { k: '/dashboard/new-order', label: 'New order', icon: 'plusCircle' },
  { k: '/dashboard/orders', label: 'My orders', icon: 'package' },
  { k: '/dashboard/tracking', label: 'Order tracking', icon: 'truck' },
  { sec: 'Account' },
  { k: '/dashboard/checkout', label: 'Checkout', icon: 'card' },
  { k: '/support', label: 'Support center', icon: 'headset' },
  { k: '/admin', label: 'Admin console', icon: 'settings' },
];
const ADMIN_NAV = [
  { sec: 'Overview' },
  { k: '/admin', label: 'Dashboard', icon: 'layout' },
  { k: '/admin/orders', label: 'Order management', icon: 'package' },
  { k: '/admin/users', label: 'User management', icon: 'users' },
  { sec: 'Configuration' },
  { k: '/admin/pricing', label: 'Pricing management', icon: 'dollar' },
  { k: '/admin/webhooks', label: 'Webhook logs', icon: 'webhook' },
  { k: '/admin/activity', label: 'Activity logs', icon: 'activity' },
  { sec: '' },
  { k: '/dashboard', label: 'Customer view', icon: 'smartphone' },
];

function shell(activeKey, nav, title, subtitle, content) {
  const links = nav.map(n => {
    if (n.sec !== undefined) return n.sec ? `<div class="side-section">${n.sec}</div>` : `<div style="height:14px"></div>`;
    const active = n.k === activeKey ? 'active' : '';
    return `<a class="side-link ${active}" href="#${n.k}">${I[n.icon](18)}${n.label}</a>`;
  }).join('');
  const wrap = el(`<div class="app-shell">
    <div class="scrim" id="scrim"></div>
    <aside class="sidebar" id="sidebar">
      <div style="padding:18px 16px;border-bottom:1px solid var(--border)">${brandLogo()}</div>
      <nav style="flex:1;overflow-y:auto;padding:12px 12px 8px">${links}</nav>
      <div style="padding:12px;border-top:1px solid var(--border)">
        <div class="card" style="padding:12px;display:flex;align-items:center;gap:10px;box-shadow:none;background:var(--surface)">
          <span class="avatar" style="width:34px;height:34px">${DATA.user.initials}</span>
          <div style="min-width:0;flex:1"><div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${DATA.user.name}</div><div class="muted" style="font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${DATA.user.email}</div></div>
          <a href="#/login" class="btn btn-ghost btn-icon btn-sm" title="Sign out">${I.logout(17)}</a>
        </div>
      </div>
    </aside>
    <div style="display:flex;flex-direction:column;min-width:0">
      <header class="topbar">
        <div style="display:flex;align-items:center;gap:12px;min-width:0">
          <button class="btn btn-ghost btn-icon md:hidden" id="menuBtn">${I.menu(20)}</button>
          <div style="min-width:0"><h1 style="font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</h1>${subtitle?`<div class="muted" style="font-size:12.5px">${subtitle}</div>`:''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="input-group hidden lg:block" style="width:240px"><span class="input-icon">${I.search(16)}</span><input class="input" placeholder="Search orders, IMEI…" style="height:38px"></div>
          ${themeBtn()}
          <button class="btn btn-ghost btn-icon" data-toast="3 new notifications" style="position:relative">${I.bell(19)}<span style="position:absolute;top:7px;right:8px;width:8px;height:8px;background:var(--danger);border-radius:999px;border:2px solid #fff"></span></button>
          <a href="#/dashboard/new-order" class="btn btn-primary btn-sm hidden sm:inline-flex">${I.plusCircle(15)} New order</a>
          <span class="avatar" style="width:36px;height:36px">${DATA.user.initials}</span>
        </div>
      </header>
      <main class="content fade-in">${content}</main>
    </div>
  </div>`);
  return wrap;
}
function bindShell() {
  const mb = $('#menuBtn'), sb = $('#sidebar'), sc = $('#scrim');
  if (mb && sb) { mb.addEventListener('click', () => { sb.classList.add('open'); sc.classList.add('open'); }); }
  if (sc) sc.addEventListener('click', () => { sb.classList.remove('open'); sc.classList.remove('open'); });
}

function statCard(icon, label, value, delta, up = true) {
  return `<div class="card stat-card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <span class="stat-icon" style="background:var(--primary-50);color:var(--primary)">${I[icon](20)}</span>
      ${delta!=null?`<span class="badge ${up?'badge-success':'badge-danger'}" style="font-size:11px">${up?I.trend(13):I.trendDown(13)} ${delta}</span>`:''}
    </div>
    <div style="font-size:28px;font-weight:800;margin-top:14px;letter-spacing:-.02em">${value}</div>
    <div class="muted" style="font-size:13px;margin-top:2px">${label}</div>
  </div>`;
}

/* ============================================================
   4. CUSTOMER DASHBOARD
   ============================================================ */
route('/dashboard', function () {
  const recent = DATA.orders.slice(0, 5).map(o => `<tr>
    <td class="cell-mono" style="color:var(--primary);font-weight:600">${o.id}</td>
    <td><div style="font-weight:600">${o.device}</div><div class="muted" style="font-size:12px">${o.service}</div></td>
    <td class="cell-mono">${o.imei}</td>
    <td>${statusBadge(o.status)}</td>
    <td style="font-weight:600">${money(o.amount)}</td>
    <td><a href="#/dashboard/tracking" class="btn btn-ghost btn-sm">Track ${I.chevronRight(14)}</a></td>
  </tr>`).join('');

  const notifs = [
    ['checkCircle','success','Order AP-10427 completed','Carrier unlock finished · 12 min ago'],
    ['clock','info','Order AP-10428 processing','iCloud removal in progress · 1 hr ago'],
    ['alert','warning','Order AP-10424 refunded','Service could not be completed · 3 hrs ago'],
    ['card','info','Invoice INV-2048 paid','Rp1.498.500 charged to •••• 4242 · 5 hrs ago'],
  ].map(n => `<div style="display:flex;gap:12px;padding:14px 4px;border-bottom:1px solid var(--border)">
    <span class="stat-icon" style="width:34px;height:34px;background:var(--${n[1]==='success'?'success':n[1]==='warning'?'warning':'info'}-bg);color:var(--${n[1]==='success'?'success':n[1]==='warning'?'warning':'info'})">${I[n[0]](17)}</span>
    <div style="flex:1"><div style="font-weight:600;font-size:13.5px">${n[2]}</div><div class="muted" style="font-size:12px">${n[3]}</div></div></div>`).join('');

  const content = `
    <div id="dashStats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px" class="card-grid">
      ${statCard('package','Total orders','248','12.4%')}
      ${statCard('checkCircle','Completed','231','8.1%')}
      ${statCard('clock','In progress','9','3 active', false)}
      ${statCard('dollar','Total spent','Rp48,2Jt','18.2%')}
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px" class="dash-grid">
      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
          <div><h3 style="font-size:16px">Orders overview</h3><div class="muted" style="font-size:12.5px">Last 7 months</div></div>
          <div class="segmented"><button class="active">Orders</button><button>Spend</button></div>
        </div>
        <div style="height:240px"><canvas id="ordersChart"></canvas></div>
      </div>
      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="font-size:16px">Service mix</h3></div>
        <div style="height:200px"><canvas id="mixChart"></canvas></div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
          ${[['iCloud Removal','#2563eb','46%'],['Carrier Unlock','#60a5fa','31%'],['Status Check','#a9cde5','14%'],['MDM Bypass','#dce9f3','9%']].map(s=>`<div style="display:flex;align-items:center;gap:8px;font-size:12.5px"><span style="width:10px;height:10px;border-radius:3px;background:${s[1]}"></span><span style="flex:1">${s[0]}</span><span class="muted" style="font-weight:600">${s[2]}</span></div>`).join('')}
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px" class="dash-grid">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border)">
          <h3 style="font-size:16px">Recent orders</h3>
          <a href="#/dashboard/orders" class="btn btn-ghost btn-sm">View all ${I.chevronRight(14)}</a>
        </div>
        <div class="table-wrapper"><table class="data"><thead><tr><th>Order</th><th>Device</th><th>IMEI</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody id="dashRecentBody">${recent}</tbody></table></div>
      </div>
      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3 style="font-size:16px">Notifications</h3><span class="badge badge-info">4 new</span></div>
        ${notifs}
        <a href="#/support" class="btn btn-outline btn-block btn-sm" style="margin-top:14px">Open support center</a>
      </div>
    </div>`;
  return shell('/dashboard', CUSTOMER_NAV, 'Dashboard', `Welcome back, ${DATA.user.name.split(' ')[0]} 👋`, content);
});
ROUTES['/dashboard']._after = function () {
  bindShell();
  if (CONFIG.apiBase && getToken()) {
    apiAuthed('/api/orders').then(d => {
      const orders = d.orders || [];
      const completed = orders.filter(o => o.status === 'Completed').length;
      const inprog = orders.filter(o => o.status === 'Processing' || o.status === 'Pending').length;
      const spent = orders.reduce((a, o) => a + (o.amount || 0), 0);
      const grid = $('#dashStats');
      if (grid) grid.innerHTML =
        statCard('package','Total orders', String(orders.length)) +
        statCard('checkCircle','Completed', String(completed)) +
        statCard('clock','In progress', String(inprog), '', false) +
        statCard('dollar','Total spent', money(spent));
      const tb = $('#dashRecentBody');
      if (tb && orders.length) tb.innerHTML = orders.slice(0,5).map(o => `<tr>
        <td class="cell-mono" style="color:var(--primary);font-weight:600">${o.id}</td>
        <td><div style="font-weight:600">${o.device||'\u2014'}</div><div class="muted" style="font-size:12px">${o.service||''}</div></td>
        <td class="cell-mono">${o.imei||'\u2014'}</td>
        <td>${statusBadge(o.status)}</td>
        <td style="font-weight:600">${money(o.amount||0)}</td>
        <td><a href="#/dashboard/tracking" class="btn btn-ghost btn-sm">Track ${I.chevronRight(14)}</a></td></tr>`).join('');
    }).catch(()=>{});
  }
  if (!window.Chart) return;
  const grid = { grid: { color: '#eef0f3' }, ticks: { color: '#64748b', font: { size: 11 } }, border: { display: false } };
  new Chart($('#ordersChart'), { type: 'line', data: { labels: ['Dec','Jan','Feb','Mar','Apr','May','Jun'], datasets: [{ data: [22,28,31,38,42,49,58], borderColor: '#2563eb', backgroundColor: 'rgba(38,111,162,.12)', fill: true, tension: .4, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: grid, y: { ...grid, beginAtZero: true } } } });
  new Chart($('#mixChart'), { type: 'doughnut', data: { labels: ['iCloud','Carrier','Status','MDM'], datasets: [{ data: [46,31,14,9], backgroundColor: ['#2563eb','#60a5fa','#a9cde5','#dce9f3'], borderWidth: 0, cutout: '68%' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
};

/* ============================================================
   5. NEW ORDER — multi-step wizard
   ============================================================ */
const WIZ = { step: 1, series: null, device: null, deviceQuery: '', service: null, imei: '', imeiValid: false, files: [], uploaded: [] };
const SERIES = [
  { key: '6', label: 'iPhone 6 series', variants: [{ name: 'iPhone 6' }, { name: 'iPhone 6 Plus' }, { name: 'iPhone 6s' }, { name: 'iPhone 6s Plus' }] },
  { key: 'se', label: 'iPhone SE series', variants: [{ name: 'iPhone SE (1st gen)' }, { name: 'iPhone SE (2nd gen)' }, { name: 'iPhone SE (3rd gen)' }] },
  { key: '7', label: 'iPhone 7 series', variants: [{ name: 'iPhone 7' }, { name: 'iPhone 7 Plus' }] },
  { key: '8', label: 'iPhone 8 series', variants: [{ name: 'iPhone 8' }, { name: 'iPhone 8 Plus' }] },
  { key: 'x', label: 'iPhone X series', variants: [{ name: 'iPhone X' }, { name: 'iPhone XR' }, { name: 'iPhone XS' }, { name: 'iPhone XS Max' }] },
  { key: '11', label: 'iPhone 11 series', variants: [{ name: 'iPhone 11' }, { name: 'iPhone 11 Pro', pro: 1 }, { name: 'iPhone 11 Pro Max', pro: 1 }] },
  { key: '12', label: 'iPhone 12 series', variants: [{ name: 'iPhone 12 mini' }, { name: 'iPhone 12' }, { name: 'iPhone 12 Pro', pro: 1 }, { name: 'iPhone 12 Pro Max', pro: 1 }] },
  { key: '13', label: 'iPhone 13 series', variants: [{ name: 'iPhone 13 mini' }, { name: 'iPhone 13' }, { name: 'iPhone 13 Pro', pro: 1 }, { name: 'iPhone 13 Pro Max', pro: 1 }] },
  { key: '14', label: 'iPhone 14 series', variants: [{ name: 'iPhone 14' }, { name: 'iPhone 14 Plus' }, { name: 'iPhone 14 Pro', pro: 1 }, { name: 'iPhone 14 Pro Max', pro: 1 }] },
  { key: '15', label: 'iPhone 15 series', variants: [{ name: 'iPhone 15' }, { name: 'iPhone 15 Plus' }, { name: 'iPhone 15 Pro', pro: 1 }, { name: 'iPhone 15 Pro Max', pro: 1 }] },
  { key: '16', label: 'iPhone 16 series', variants: [{ name: 'iPhone 16' }, { name: 'iPhone 16 Plus' }, { name: 'iPhone 16 Pro', pro: 1 }, { name: 'iPhone 16 Pro Max', pro: 1 }] },
  { key: '17', label: 'iPhone 17 series', variants: [{ name: 'iPhone 17' }, { name: 'iPhone 17 Pro', pro: 1 }, { name: 'iPhone 17 Pro Max', pro: 1 }] },
];
function wizSteps() {
  const labels = ['Device', 'Service', 'IMEI', 'Upload', 'Review'];
  return `<div class="stepper" style="margin-bottom:28px">${labels.map((l, i) => {
    const n = i + 1; const cls = WIZ.step > n ? 'done' : WIZ.step === n ? 'active' : '';
    return `<div class="step ${cls}"><span class="step-dot">${WIZ.step > n ? I.check(16) : n}</span><span class="step-label hidden sm:inline">${l}</span></div>${i < labels.length - 1 ? `<span class="step-line ${WIZ.step > n ? 'done' : ''}"></span>` : ''}`;
  }).join('')}</div>`;
}
/* ---------- IMEI validation ----------
   luhn(): REAL GSMA Luhn checksum. Proves the 15-digit number is well-formed,
           NOT that a device exists. Anyone can mint a Luhn-valid number.
   imeiInspect(): local structural checks (length, checksum, TAC).
   imeiVerify(): LIVE device lookup (model/FMI/blacklist/warranty) via the
           backend proxy in CONFIG.imeiApiBase. Returns null in offline mode
           so the UI never shows fabricated status. */
function luhn(imei) {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) { let d = +imei[i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}
function imeiInspect(imei) {
  if (!/^\d{15}$/.test(imei)) return { ok: false, reason: 'IMEI must be exactly 15 digits' };
  if (!luhn(imei)) return { ok: false, reason: 'Invalid IMEI checksum (Luhn) \u2014 re-check the number' };
  const tac = imei.slice(0, 8);
  const rbi = imei.slice(0, 2); // Reporting Body Identifier (Apple is commonly 35 / BABT)
  // Model is filled ONLY from a real TAC source (window.APPLE_TACS), never guessed.
  const model = (typeof window !== 'undefined' && window.APPLE_TACS && window.APPLE_TACS[tac]) || null;
  return { ok: true, tac, rbi, model };
}
async function imeiVerify(imei) {
  if (!CONFIG.imeiApiBase) {
    if (CONFIG.demoMode) {
      // Synthetic, deterministic, and CLEARLY labeled — for UI preview only.
      const n = imei.split('').reduce((a, c) => a + (+c), 0);
      const tac = imei.slice(0, 8);
      const model = (typeof window !== 'undefined' && window.APPLE_TACS && window.APPLE_TACS[tac]) || 'iPhone (demo)';
      return {
        model,
        fmi: n % 2 ? 'ON' : 'OFF',
        blacklist: n % 3 ? 'Clean' : 'Blacklisted',
        warranty: n % 2 ? 'Out of coverage' : 'Active',
        source: 'DEMO (synthetic \u2014 NOT a real lookup)',
      };
    }
    return null; // offline mode \u2014 no live data, no fakes
  }
  const r = await fetch(CONFIG.imeiApiBase.replace(/\/$/, '') + '/api/imei/check', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imei })
  });
  if (!r.ok) throw new Error('verification service ' + r.status);
  return await r.json(); // { model, fmi, blacklist, warranty, source }
}
function wizBody() {
  if (WIZ.step === 1) {
    if (!WIZ.series) {
      return `<h3 style="font-size:18px;margin-bottom:4px">Select your device</h3><p class="muted" style="margin-bottom:16px;font-size:13.5px">Choose your iPhone series — or search for a specific model.</p>
      <div class="input-group" style="max-width:360px;margin-bottom:18px"><span class="input-icon">${I.search(17)}</span><input class="input" id="devSearch" placeholder="Search all iPhone models…" value="${(WIZ.deviceQuery || '').replace(/"/g, '&quot;')}"></div>
      <div id="devGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px" class="wiz-grid">${deviceGridHTML()}</div>`;
    }
    const ser = SERIES.find(s => s.key === WIZ.series);
    return `<button class="btn btn-ghost btn-sm" id="seriesBack" style="padding-left:8px;margin-bottom:10px"><span style="display:inline-flex;transform:rotate(180deg)">${I.chevronRight(15)}</span> All series</button>
      <h3 style="font-size:18px;margin-bottom:4px">${ser.label}</h3><p class="muted" style="margin-bottom:20px;font-size:13.5px">Select the exact model you'd like to service.</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px" class="wiz-grid">
        ${ser.variants.map(v => deviceTileHTML(v)).join('')}
      </div>`;
  }
  if (WIZ.step === 2) {
    return `<h3 style="font-size:18px;margin-bottom:4px">Choose a service</h3><p class="muted" style="margin-bottom:20px;font-size:13.5px">Select the activation or unlock service for <b>${WIZ.device}</b>.</p>
    <div style="display:flex;flex-direction:column;gap:12px">
      ${DATA.services.map(s => `<div class="device-tile ${WIZ.service === s.id ? 'selected' : ''}" data-service="${s.id}" style="display:flex;align-items:center;gap:16px">
        <span class="check">${I.checkCircle(20)}</span>
        <span class="stat-icon" style="background:var(--primary-50);color:var(--primary)">${I.shield(20)}</span>
        <div style="flex:1"><div style="font-weight:600">${s.name}</div><div class="muted" style="font-size:12.5px">${s.desc}</div></div>
        <div style="text-align:right"><div style="font-size:20px;font-weight:800">${money(priceFor(s.id, WIZ.device) || s.price)}</div><div class="muted" style="font-size:11.5px">${s.eta}</div></div>
      </div>`).join('')}
    </div>`;
  }
  if (WIZ.step === 3) {
    return `<h3 style="font-size:18px;margin-bottom:4px">Enter & validate IMEI</h3><p class="muted" style="margin-bottom:20px;font-size:13.5px">Dial <span class="kbd">*#06#</span> on the device or check Settings → General → About.</p>
    <div class="field" style="max-width:440px">
      <label class="label">IMEI number (15 digits)</label>
      <div style="display:flex;gap:10px">
        <input class="input cell-mono" id="imeiInput" maxlength="15" inputmode="numeric" placeholder="356699080000002" value="${WIZ.imei}" style="font-size:15px;letter-spacing:1px">
        <button class="btn btn-soft" id="imeiCheck" style="white-space:nowrap">${I.search(16)} Validate</button>
      </div>
      <div id="imeiResult" style="margin-top:14px"></div>
    </div>
    <div class="card" style="background:var(--surface);box-shadow:none;padding:16px;margin-top:20px;max-width:440px;display:flex;gap:10px">
      <span style="color:var(--primary)">${I.shield(20)}</span>
      <div style="font-size:12.5px;color:var(--muted-foreground)">Your IMEI is checked locally (format + Luhn checksum). When a verification backend is connected, model, Find My, blacklist and warranty are confirmed via a live GSX lookup. We never store full device credentials.</div>
    </div>`;
  }
  if (WIZ.step === 4) {
    return `<h3 style="font-size:18px;margin-bottom:4px">Upload supporting documents</h3><p class="muted" style="margin-bottom:20px;font-size:13.5px">Optional: proof of purchase or device photos to speed up verification.</p>
    <div class="dropzone" id="dropzone"><div style="color:var(--primary);display:flex;justify-content:center;margin-bottom:10px">${I.upload(30)}</div>
      <div style="font-weight:600">Drop files here or <span style="color:var(--primary)">browse</span></div>
      <div class="muted" style="font-size:12.5px;margin-top:4px">PDF, JPG or PNG · up to 10MB each</div>
      <input type="file" id="fileInput" multiple accept=".pdf,.jpg,.jpeg,.png" hidden></div>
    <div id="fileList" style="margin-top:16px;display:flex;flex-direction:column;gap:8px">${renderFiles()}</div>`;
  }
  // step 5 review
  const svc = DATA.services.find(s => s.id === WIZ.service) || {};
  const base = priceFor(WIZ.service, WIZ.device) || svc.price || 0;
  const tax = Math.round(base * 0.11);
  return `<h3 style="font-size:18px;margin-bottom:4px">Review your order</h3><p class="muted" style="margin-bottom:20px;font-size:13.5px">Confirm the details below before continuing to checkout.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="wiz-grid">
      ${[['Device', WIZ.device, 'smartphone'], ['Service', svc.name, 'shield'], ['IMEI', WIZ.imei || '—', 'cpu'], ['Turnaround', svc.eta, 'clock']].map(r => `
        <div class="card" style="box-shadow:none;background:var(--surface);padding:16px"><div class="muted" style="font-size:11.5px;display:flex;align-items:center;gap:6px;margin-bottom:6px">${I[r[2]](14)} ${r[0]}</div><div style="font-weight:600;font-size:14px">${r[1] || '—'}</div></div>`).join('')}
    </div>
    <div class="card" style="box-shadow:none;background:var(--surface);padding:16px;margin-top:14px">
      <div class="muted" style="font-size:11.5px;margin-bottom:8px">Attached documents</div>
      ${WIZ.files.length ? WIZ.files.map(f => `<div style="font-size:13px;display:flex;align-items:center;gap:8px;padding:3px 0">${I.file(15)} ${f}</div>`).join('') : '<div class="muted" style="font-size:13px">No documents attached</div>'}
    </div>
    <div class="card" style="padding:18px;margin-top:14px">
      <div style="display:flex;justify-content:space-between;font-size:13.5px;padding:4px 0"><span class="muted">Service fee</span><span>${money(base)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13.5px;padding:4px 0"><span class="muted">PPN (11%)</span><span>${money(tax)}</span></div>
      <div class="divider" style="margin:10px 0"></div>
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:17px"><span>Total</span><span style="color:var(--primary)">${money(base + tax)}</span></div>
    </div>`;
}
function renderFiles() {
  return WIZ.files.map((f, i) => `<div class="card" style="box-shadow:none;background:var(--surface);padding:10px 14px;display:flex;align-items:center;gap:10px">
    <span style="color:var(--primary)">${I.file(18)}</span><span style="flex:1;font-size:13px;font-weight:500">${f}</span>
    <button class="btn btn-ghost btn-icon btn-sm" data-rmfile="${i}">${I.x(16)}</button></div>`).join('');
}
function wizCanNext() {
  if (WIZ.step === 1) return !!WIZ.device;
  if (WIZ.step === 2) return !!WIZ.service;
  if (WIZ.step === 3) return WIZ.imeiValid;
  return true;
}
route('/dashboard/new-order', function () {
  const content = `<div style="max-width:820px;margin:0 auto">
    <div class="card card-pad">
      ${wizSteps()}
      <div id="wizBody" class="fade-in">${wizBody()}</div>
      <div class="divider" style="margin:24px 0 18px"></div>
      <div style="display:flex;justify-content:space-between">
        <button class="btn btn-outline" id="wizBack" ${WIZ.step === 1 ? 'style="visibility:hidden"' : ''}>Back</button>
        <button class="btn btn-primary" id="wizNext">${WIZ.step === 5 ? 'Continue to checkout' : 'Continue'} ${I.arrowRight(16)}</button>
      </div>
    </div>
  </div>`;
  return shell('/dashboard/new-order', CUSTOMER_NAV, 'New order', 'Create a new device service order', content);
});
ROUTES['/dashboard/new-order']._after = function () {
  bindShell();
  const rerender = () => { $('#wizBody').innerHTML = wizBody(); $('.app-shell') && rebindWiz(); refreshWizChrome(); };
  function refreshWizChrome() {
    $('.stepper').outerHTML = wizSteps();
    const back = $('#wizBack'), next = $('#wizNext');
    back.style.visibility = WIZ.step === 1 ? 'hidden' : 'visible';
    next.innerHTML = (WIZ.step === 5 ? 'Continue to checkout' : 'Continue') + ' ' + I.arrowRight(16);
  }
  function bindTiles() {
    $$('[data-series]').forEach(t => t.addEventListener('click', () => { WIZ.series = t.dataset.series; rerender(); }));
    $$('[data-device]').forEach(t => t.addEventListener('click', () => { WIZ.device = t.dataset.device; $$('[data-device]').forEach(x => x.classList.remove('selected')); t.classList.add('selected'); }));
  }
  function rebindWiz() {
    bindTiles();
    const _sb = $('#seriesBack'); if (_sb) _sb.addEventListener('click', () => { WIZ.series = null; rerender(); });
    const _ds = $('#devSearch'); if (_ds) _ds.addEventListener('input', () => { WIZ.deviceQuery = _ds.value; const g = $('#devGrid'); if (g) g.innerHTML = deviceGridHTML(); bindTiles(); });
    $$('[data-service]').forEach(t => t.addEventListener('click', () => { WIZ.service = t.dataset.service; $$('[data-service]').forEach(x => x.classList.remove('selected')); t.classList.add('selected'); }));
    const imei = $('#imeiInput');
    if (imei) {
      imei.addEventListener('input', () => { imei.value = imei.value.replace(/\D/g, ''); WIZ.imei = imei.value; WIZ.imeiValid = false; $('#imeiResult').innerHTML = ''; imei.classList.remove('error'); });
      $('#imeiCheck').addEventListener('click', async () => {
        const res = $('#imeiResult'); const btn = $('#imeiCheck');
        imei.classList.remove('error');
        // 1) LOCAL validation \u2014 real, runs in the browser (format + Luhn checksum + TAC)
        const chk = imeiInspect(WIZ.imei);
        if (!chk.ok) {
          imei.classList.add('error'); WIZ.imeiValid = false;
          res.innerHTML = `<div class="badge badge-danger">${I.alert(14)} ${chk.reason}</div>`;
          refreshWizChrome(); return;
        }
        // 2) LIVE device lookup via backend (model / FMI / blacklist / warranty)
        if (btn) btn.disabled = true;
        res.innerHTML = `<div class="muted" style="font-size:13px;display:flex;align-items:center;gap:8px">${I.refresh(15)} Validating IMEI\u2026</div>`;
        let live = null, liveErr = null;
        try { live = await imeiVerify(WIZ.imei); } catch (e) { liveErr = (e && e.message) || 'lookup failed'; }
        WIZ.imeiValid = true; // checksum passed \u2014 safe to continue the order
        if (live) {
          const fmiDanger = String(live.fmi).toUpperCase() === 'ON';
          const blClean = String(live.blacklist || '').toLowerCase().includes('clean');
          res.innerHTML = `<div class="card" style="box-shadow:none;border-color:var(--success);background:var(--success-bg);padding:14px"><div style="display:flex;align-items:center;gap:8px;color:var(--success);font-weight:600;font-size:13.5px">${I.checkCircle(18)} IMEI verified \u00b7 live lookup</div><div style="font-size:12.5px;color:var(--muted-foreground);margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px"><span>Model: <b>${live.model || chk.model || '\u2014'}</b></span><span>FMI: <b style="color:var(--${fmiDanger?'danger':'success'})">${live.fmi ?? '\u2014'}</b></span><span>Blacklist: <b style="color:var(--${blClean?'success':'danger'})">${live.blacklist ?? '\u2014'}</b></span><span>Warranty: <b>${live.warranty ?? '\u2014'}</b></span></div><div class="muted" style="font-size:11px;margin-top:8px">Source: ${live.source || 'verification API'}</div></div>`;
        } else {
          // HONEST offline state \u2014 never invent device status
          const note = liveErr ? `Live verification unavailable (${liveErr}).` : 'Live device verification is not configured.';
          res.innerHTML = `<div class="card" style="box-shadow:none;border-color:#f59e0b;background:var(--surface);padding:14px"><div style="display:flex;align-items:center;gap:8px;color:var(--primary);font-weight:600;font-size:13.5px">${I.checkCircle(18)} Format & checksum valid</div><div style="font-size:12.5px;color:var(--muted-foreground);margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px"><span>Length: <b>15 \u2713</b></span><span>Luhn: <b>Passed \u2713</b></span><span>TAC: <b>${chk.tac}</b></span><span>Est. model: <b>${chk.model || 'unknown (offline)'}</b></span></div><div class="muted" style="font-size:11px;margin-top:8px">${note} FMI / blacklist / warranty need a live GSX lookup \u2014 enable the backend in server/ and set CONFIG.imeiApiBase.</div></div>`;
        }
        if (btn) btn.disabled = false;
        refreshWizChrome();
      });
    }
    const dz = $('#dropzone'), fi = $('#fileInput');
    if (dz) {
      dz.addEventListener('click', () => fi.click());
      ['dragover'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach(e => dz.addEventListener(e, () => dz.classList.remove('drag')));
      dz.addEventListener('drop', ev => { ev.preventDefault(); addFiles(ev.dataTransfer.files); });
      fi.addEventListener('change', () => addFiles(fi.files));
    }
    $$('[data-rmfile]').forEach(b => b.addEventListener('click', () => { WIZ.files.splice(+b.dataset.rmfile, 1); $('#fileList').innerHTML = renderFiles(); rebindWiz(); }));
  }
  function addFiles(list) {
    const arr = Array.from(list);
    if (!arr.length) return;
    // Offline mode: just track names locally.
    if (!CONFIG.apiBase || !getToken()) {
      arr.forEach(f => WIZ.files.push(f.name));
      $('#fileList') && ($('#fileList').innerHTML = renderFiles()); rebindWiz();
      toast(arr.length + ' file(s) attached', 'upload');
      return;
    }
    // Real upload to backend via multipart/form-data.
    const fd = new FormData();
    arr.forEach(f => fd.append('files', f));
    toast('Uploading ' + arr.length + ' file(s)\u2026', 'upload');
    const base = (CONFIG.apiBase || '').replace(/\/$/, '');
    fetch(base + '/api/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }, body: fd })
      .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; }))
      .then(d => {
        WIZ.uploaded = WIZ.uploaded || [];
        (d.files || []).forEach(uf => { WIZ.files.push(uf.name); WIZ.uploaded.push(uf); });
        $('#fileList') && ($('#fileList').innerHTML = renderFiles()); rebindWiz();
        toast(arr.length + ' file(s) uploaded', 'upload');
      })
      .catch(err => toast('Upload failed: ' + err.message, 'alert'));
  }
  rebindWiz();
  $('#wizBack').addEventListener('click', () => { if (WIZ.step > 1) { WIZ.step--; rerender(); } });
  $('#wizNext').addEventListener('click', () => {
    if (!wizCanNext()) {
      const msg = WIZ.step === 1 ? 'Please select a device' : WIZ.step === 2 ? 'Please choose a service' : 'Please validate the IMEI first';
      toast(msg, 'alert'); return;
    }
    if (WIZ.step === 5) { navigate('/dashboard/checkout'); return; }
    WIZ.step++; rerender();
  });
};

/* ============================================================
   MY ORDERS (list)
   ============================================================ */
route('/dashboard/orders', function () {
  const rows = DATA.orders.map(o => `<tr>
    <td class="cell-mono" style="color:var(--primary);font-weight:600">${o.id}</td>
    <td><div style="font-weight:600">${o.device}</div><div class="muted" style="font-size:12px">${o.service}</div></td>
    <td class="cell-mono">${o.imei}</td>
    <td>${statusBadge(o.status)}</td>
    <td class="muted">${o.date}</td>
    <td style="font-weight:600">${money(o.amount)}</td>
    <td><div style="display:flex;gap:4px"><a href="#/dashboard/tracking" class="btn btn-ghost btn-sm">Track</a><button class="btn btn-ghost btn-icon btn-sm" data-toast="Order menu">${I.dots(16)}</button></div></td>
  </tr>`).join('');
  const content = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
      <div class="segmented"><button class="active">All (6)</button><button>Processing (1)</button><button>Completed (3)</button><button>Failed (1)</button></div>
      <div style="display:flex;gap:8px"><button class="btn btn-outline btn-sm">${I.filter(15)} Filter</button><button class="btn btn-outline btn-sm">${I.download(15)} Export</button></div>
    </div>
    <div class="card"><div class="table-wrapper"><table class="data"><thead><tr><th>Order</th><th>Device</th><th>IMEI</th><th>Status</th><th>Date</th><th>Amount</th><th></th></tr></thead><tbody id="ordersBody">${rows}</tbody></table></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-top:1px solid var(--border)"><span class="muted" style="font-size:12.5px">Showing 6 of 248 orders</span>
        <div style="display:flex;gap:6px"><button class="btn btn-outline btn-sm">Previous</button><button class="btn btn-outline btn-sm" style="background:var(--primary);color:#fff;border-color:var(--primary)">1</button><button class="btn btn-outline btn-sm">2</button><button class="btn btn-outline btn-sm">Next</button></div></div>
    </div>`;
  return shell('/dashboard/orders', CUSTOMER_NAV, 'My orders', 'All your device service orders', content);
});
ROUTES['/dashboard/orders']._after = function () {
  bindShell();
  if (!CONFIG.apiBase || !getToken()) return;
  apiAuthed('/api/orders').then(d => {
    const tb = document.getElementById('ordersBody');
    if (!tb || !d.orders || !d.orders.length) return;
    tb.innerHTML = d.orders.map(o => `<tr>
      <td class="cell-mono" style="color:var(--primary);font-weight:600">${o.id}</td>
      <td><div style="font-weight:600">${o.device || '\u2014'}</div><div class="muted" style="font-size:12px">${o.service || ''}</div></td>
      <td class="cell-mono">${o.imei || '\u2014'}</td>
      <td>${statusBadge(o.status)}</td>
      <td class="muted">${(o.created_at || '').slice(0, 10)}</td>
      <td style="font-weight:600">${money(o.amount)}</td>
      <td><div style="display:flex;gap:4px"><a href="#/dashboard/tracking" class="btn btn-ghost btn-sm">Track</a></div></td>
    </tr>`).join('');
  }).catch(() => {});
};

/* ============================================================
   6. CHECKOUT
   ============================================================ */
route('/dashboard/checkout', function () {
  const svc = DATA.services.find(s => s.id === WIZ.service) || DATA.services[0];
  const base = priceFor(WIZ.service, WIZ.device) || svc.price || 0;
  const tax = Math.round(base * 0.11);
  const total = base + tax;
  const content = `<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:20px;max-width:1000px;margin:0 auto" class="checkout-grid">
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card card-pad">
        <h3 style="font-size:16px;margin-bottom:16px">Payment method</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px" id="payMethods">
          ${[['card','Card','card'],['apple','Apple Pay','apple'],['google','Google Pay','google']].map((m,i)=>`<div class="device-tile ${i===0?'selected':''}" data-pay="${m[0]}" style="text-align:center;padding:14px 10px"><span class="check">${I.checkCircle(18)}</span><div style="display:flex;justify-content:center;margin-bottom:6px;color:var(--foreground)">${I[m[2]](22)}</div><div style="font-weight:600;font-size:12.5px">${m[1]}</div></div>`).join('')}
        </div>
        <form id="payForm" style="display:flex;flex-direction:column;gap:14px">
          <div class="field"><label class="label">Cardholder name</label><input class="input" value="Iqbal Saputra"></div>
          <div class="field"><label class="label">Card number</label><div class="input-group"><span class="input-icon">${I.card(17)}</span><input class="input cell-mono" placeholder="4242 4242 4242 4242" value="4242 4242 4242 4242"></div></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label class="label">Expiry</label><input class="input cell-mono" placeholder="MM / YY" value="08 / 28"></div>
            <div class="field"><label class="label">CVC</label><input class="input cell-mono" placeholder="123" value="•••"></div>
          </div>
        </form>
      </div>
      <div class="card card-pad" style="display:flex;align-items:center;gap:12px;background:var(--surface);box-shadow:none">
        <span style="color:var(--success)">${I.lock(20)}</span><div style="font-size:12.5px;color:var(--muted-foreground)">Payments are encrypted and PCI-DSS compliant. You can request a full refund if the service fails.</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card card-pad">
        <h3 style="font-size:16px;margin-bottom:16px">Order summary</h3>
        <div style="display:flex;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--border)">
          <span class="stat-icon" style="background:var(--primary-50);color:var(--primary)">${I.shield(20)}</span>
          <div style="flex:1"><div style="font-weight:600;font-size:13.5px">${svc.name}</div><div class="muted" style="font-size:12px">${WIZ.device||'iPhone 15 Pro'} · ${svc.eta}</div></div>
          <div style="font-weight:700">${money(base)}</div>
        </div>
        <div style="padding:14px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;font-size:13.5px;padding:3px 0"><span class="muted">Subtotal</span><span>${money(base)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:13.5px;padding:3px 0"><span class="muted">PPN (11%)</span><span>${money(tax)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:13.5px;padding:3px 0"><span class="muted">Discount</span><span style="color:var(--success)">−Rp0</span></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:18px;padding:14px 0"><span>Total</span><span style="color:var(--primary)">${money(total)}</span></div>
        <div style="display:flex;gap:8px;margin-bottom:14px"><input class="input" placeholder="Promo code" style="height:40px"><button class="btn btn-outline btn-sm" data-toast="Promo applied">Apply</button></div>
        <button class="btn btn-primary btn-block btn-lg" id="payBtn">${I.lock(16)} Pay ${money(total)}</button>
        <a href="#/dashboard/new-order" class="btn btn-ghost btn-block btn-sm" style="margin-top:8px">Back to order</a>
      </div>
      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="font-size:15px">Invoice preview</h3><span class="badge badge-neutral">Draft</span></div>
        <div style="font-size:12.5px;color:var(--muted-foreground);line-height:1.8">
          <div style="display:flex;justify-content:space-between"><span>Invoice</span><span class="cell-mono">INV-2049</span></div>
          <div style="display:flex;justify-content:space-between"><span>Date</span><span>Jun 20, 2026</span></div>
          <div style="display:flex;justify-content:space-between"><span>Billed to</span><span>${DATA.user.email}</span></div>
          <div class="divider" style="margin:10px 0"></div>
          <div style="display:flex;justify-content:space-between;color:var(--foreground);font-weight:600"><span>Amount due</span><span>${money(total)}</span></div>
        </div>
        <button class="btn btn-outline btn-block btn-sm" style="margin-top:12px" data-toast="Invoice downloaded">${I.download(15)} Download PDF</button>
      </div>
    </div>
  </div>`;
  return shell('/dashboard/checkout', CUSTOMER_NAV, 'Checkout', 'Complete your payment', content);
});
ROUTES['/dashboard/checkout']._after = function () {
  bindShell();
  $$('[data-pay]').forEach(t => t.addEventListener('click', () => { $$('[data-pay]').forEach(x => x.classList.remove('selected')); t.classList.add('selected'); }));
  $('#payBtn').addEventListener('click', async () => {
    if (!CONFIG.apiBase || !getToken()) { toast('Payment successful — order placed!'); setTimeout(() => navigate('/dashboard/tracking'), 700); return; }
    const svc = DATA.services.find(s => s.id === WIZ.service) || {};
    const amount = priceFor(WIZ.service, WIZ.device) || svc.price || 0;
    const btn = $('#payBtn'); btn.disabled = true;
    try {
      const { order } = await apiAuthed('/api/orders', { method: 'POST', body: { device: WIZ.device, service: svc.name || WIZ.service, imei: WIZ.imei, amount, eta: svc.eta } });
      if (CONFIG.midtransClientKey) { await payWithMidtrans(order.id); }
      toast('Order placed!'); setTimeout(() => navigate('/dashboard/tracking'), 700);
    } catch (err) { toast(err.message); btn.disabled = false; }
  });
};

/* ============================================================
   7. ORDER TRACKING
   ============================================================ */
route('/dashboard/tracking', function () {
  const steps = [
    ['done', 'check', 'Order placed', 'Payment confirmed · Jun 20, 09:14', 'AP-10428'],
    ['done', 'check', 'IMEI verified', 'GSX check passed · Jun 20, 09:15'],
    ['current', 'refresh', 'Processing activation', 'Removing iCloud lock — in progress', 'now'],
    ['', 'shield', 'Quality check', 'Final verification before delivery'],
    ['', 'checkCircle', 'Completed', 'Device ready to activate'],
  ];
  const tl = steps.map(s => `<div class="tl-item ${s[0]}"><span class="tl-dot">${I[s[1]](16)}</span>
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px"><div style="font-weight:600;font-size:14px">${s[2]}</div>${s[4] ? `<span class="badge ${s[0] === 'current' ? 'badge-info' : 'badge-neutral'}" style="font-size:11px">${s[4]}</span>` : ''}</div>
    <div class="muted" style="font-size:12.5px;margin-top:2px">${s[3]}</div></div>`).join('');
  const content = `<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:20px;max-width:1000px;margin:0 auto" class="checkout-grid">
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:10px">
        <div><div style="display:flex;align-items:center;gap:10px"><h3 style="font-size:18px" class="cell-mono" >AP-10428</h3>${statusBadge('Processing')}</div><div class="muted" style="font-size:13px;margin-top:4px">iPhone 15 Pro · iCloud Activation Lock Removal</div></div>
        <button class="btn btn-outline btn-sm" data-toast="Refreshed — still processing">${I.refresh(15)} Refresh</button>
      </div>
      <div style="margin-bottom:8px;display:flex;justify-content:space-between;font-size:12.5px"><span class="muted">Progress</span><span style="font-weight:600">50% · ETA ~6 hrs</span></div>
      <div class="progress" style="margin-bottom:28px"><span style="width:50%"></span></div>
      <div class="timeline">${tl}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card card-pad">
        <h3 style="font-size:15px;margin-bottom:14px">Live updates</h3>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${[['Processing activation request','2 min ago','info'],['IMEI verified via GSX','7 min ago','success'],['Payment confirmed','9 min ago','success']].map(u=>`<div style="display:flex;gap:10px;align-items:flex-start"><span style="width:8px;height:8px;border-radius:999px;margin-top:6px;background:var(--${u[2]==='success'?'success':'info'})"></span><div><div style="font-size:13px;font-weight:500">${u[0]}</div><div class="muted" style="font-size:11.5px">${u[1]}</div></div></div>`).join('')}
        </div>
      </div>
      <div class="card card-pad">
        <h3 style="font-size:15px;margin-bottom:12px">Order details</h3>
        <div style="font-size:12.5px;line-height:2;color:var(--muted-foreground)">
          <div style="display:flex;justify-content:space-between"><span>IMEI</span><span class="cell-mono" style="color:var(--foreground)">356789104253871</span></div>
          <div style="display:flex;justify-content:space-between"><span>Service</span><span style="color:var(--foreground)">iCloud Removal</span></div>
          <div style="display:flex;justify-content:space-between"><span>Amount</span><span style="color:var(--foreground)">${money(1498500)}</span></div>
          <div style="display:flex;justify-content:space-between"><span>Placed</span><span style="color:var(--foreground)">Jun 20, 09:14</span></div>
        </div>
        <a href="#/support" class="btn btn-outline btn-block btn-sm" style="margin-top:14px">${I.headset(15)} Get help with this order</a>
      </div>
    </div>
  </div>`;
  return shell('/dashboard/tracking', CUSTOMER_NAV, 'Order tracking', 'Real-time status of your order', content);
});
ROUTES['/dashboard/tracking']._after = bindShell;

/* ============================================================
   8. SUPPORT CENTER (tickets · live chat · knowledge base)
   ============================================================ */
route('/support', function () {
  const tickets = [
    ['#4821', 'iCloud removal stuck at 50%', 'Open', 'warning', '2h ago'],
    ['#4816', 'Carrier unlock — wrong network', 'In progress', 'info', '5h ago'],
    ['#4790', 'Refund for failed order AP-10424', 'Resolved', 'success', '1d ago'],
    ['#4772', 'API webhook not firing', 'Resolved', 'success', '2d ago'],
  ].map(t => `<div class="card" style="box-shadow:none;border-color:var(--border);padding:14px;display:flex;align-items:center;gap:12px;cursor:pointer" class="card-hover">
    <div style="flex:1"><div style="display:flex;align-items:center;gap:8px"><span class="cell-mono" style="font-weight:600;color:var(--primary)">${t[0]}</span><span class="badge badge-${t[3]}" style="font-size:11px">${t[2]}</span></div><div style="font-size:13.5px;font-weight:500;margin-top:4px">${t[1]}</div></div>
    <div style="text-align:right"><div class="muted" style="font-size:11.5px">${t[4]}</div>${I.chevronRight(16)}</div></div>`).join('');

  const kb = [
    ['smartphone', 'How iCloud removal works', '8 articles'],
    ['globe', 'Carrier unlock guide', '12 articles'],
    ['cpu', 'Understanding IMEI checks', '6 articles'],
    ['card', 'Billing & refunds', '9 articles'],
    ['webhook', 'API & webhooks', '14 articles'],
    ['shield', 'Security & privacy', '5 articles'],
  ].map(k => `<a href="#/support" class="card card-hover card-pad" style="display:block">
    <span class="stat-icon" style="background:var(--primary-50);color:var(--primary)">${I[k[0]](20)}</span>
    <div style="font-weight:600;font-size:14px;margin-top:12px">${k[1]}</div><div class="muted" style="font-size:12.5px;margin-top:2px">${k[2]}</div></a>`).join('');

  const chat = `<div class="card" style="display:flex;flex-direction:column;height:460px">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
      <span class="avatar" style="background:var(--primary)">${I.headset(17)}</span>
      <div style="flex:1"><div style="font-weight:600;font-size:13.5px">ActivatePro Support</div><div class="muted" style="font-size:11.5px;display:flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:999px;background:var(--success)"></span> Online · replies in ~3 min</div></div>
    </div>
    <div id="chatLog" style="flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:8px"><span class="avatar" style="width:28px;height:28px;font-size:11px">${I.headset(14)}</span><div class="chat-bubble them">Hi Iqbal 👋 How can we help with your activation today?</div></div>
      <div style="display:flex;justify-content:flex-end"><div class="chat-bubble me">My iCloud removal for AP-10428 is stuck at 50%.</div></div>
      <div style="display:flex;gap:8px"><span class="avatar" style="width:28px;height:28px;font-size:11px">${I.headset(14)}</span><div class="chat-bubble them">Thanks! I can see it's actively processing on GSX. Estimated completion is ~6 hrs — I'll flag it as priority for you.</div></div>
    </div>
    <div style="padding:12px;border-top:1px solid var(--border);display:flex;gap:8px">
      <input class="input" id="chatInput" placeholder="Type your message…"><button class="btn btn-primary btn-icon" id="chatSend">${I.send(18)}</button>
    </div>
  </div>`;

  const content = `
    <div class="card card-pad" style="background:linear-gradient(135deg,#2563eb,#1e40af);color:#fff;margin-bottom:20px;border:none">
      <h2 style="color:#fff;font-size:24px">How can we help?</h2>
      <p style="opacity:.9;font-size:14px;margin:6px 0 16px">Search our knowledge base or open a ticket — our team replies in under 4 minutes.</p>
      <div class="input-group" style="max-width:520px"><span class="input-icon">${I.search(18)}</span><input class="input" placeholder="Search articles, guides, FAQs…" style="height:46px"></div>
    </div>
    <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:20px" class="checkout-grid">
      <div style="display:flex;flex-direction:column;gap:20px">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border)"><h3 style="font-size:16px">Your tickets</h3><button class="btn btn-primary btn-sm" data-toast="New ticket form opened">${I.plusCircle(15)} New ticket</button></div>
          <div style="padding:14px;display:flex;flex-direction:column;gap:10px">${tickets}</div>
        </div>
        <div>
          <h3 style="font-size:16px;margin-bottom:14px">Knowledge base</h3>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px" class="kb-grid">${kb}</div>
        </div>
      </div>
      <div><h3 style="font-size:16px;margin-bottom:14px">Live chat</h3>${chat}</div>
    </div>`;
  return shell('/support', CUSTOMER_NAV, 'Support center', "We're here to help", content);
});
ROUTES['/support']._after = function () {
  bindShell();
  const send = () => {
    const inp = $('#chatInput'); const v = inp.value.trim(); if (!v) return;
    const log = $('#chatLog');
    log.insertAdjacentHTML('beforeend', `<div style="display:flex;justify-content:flex-end"><div class="chat-bubble me">${v.replace(/</g,'&lt;')}</div></div>`);
    inp.value = ''; log.scrollTop = log.scrollHeight;
    setTimeout(() => {
      log.insertAdjacentHTML('beforeend', `<div style="display:flex;gap:8px"><span class="avatar" style="width:28px;height:28px;font-size:11px">${I.headset(14)}</span><div class="chat-bubble them">Got it — a specialist will follow up shortly. Is there anything else I can check for you?</div></div>`);
      log.scrollTop = log.scrollHeight;
    }, 800);
  };
  $('#chatSend').addEventListener('click', send);
  $('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
};

/* ============================================================
   9. ADMIN DASHBOARD + sub-pages
   ============================================================ */
route('/admin', function () {
  const topOrders = DATA.orders.slice(0, 5).map(o => `<tr>
    <td class="cell-mono" style="color:var(--primary);font-weight:600">${o.id}</td>
    <td>${o.device}</td><td class="muted" style="font-size:12.5px">${o.service}</td>
    <td>${statusBadge(o.status)}</td><td style="font-weight:600">${money(o.amount)}</td></tr>`).join('');
  const acts = DATA.activity.map(a => `<div style="display:flex;gap:10px;padding:11px 0;border-bottom:1px solid var(--border)">
    <span style="width:8px;height:8px;border-radius:999px;margin-top:6px;background:var(--${a.type==='success'?'success':a.type==='warning'?'warning':a.type==='danger'?'danger':'info'})"></span>
    <div style="flex:1;font-size:13px"><b>${a.who}</b> ${a.act} <b style="color:var(--primary)">${a.obj}</b><div class="muted" style="font-size:11.5px">${a.time}</div></div></div>`).join('');
  const content = `
    <div id="adminStats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px" class="card-grid">
      ${statCard('dollar','Revenue (MTD)','Rp842Jt','22.6%')}
      ${statCard('package','Orders (MTD)','1,842','14.2%')}
      ${statCard('checkCircle','Success rate','98.6%','0.4%')}
      ${statCard('users','Active users','3,217','9.8%')}
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px" class="dash-grid">
      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px"><div><h3 style="font-size:16px">Revenue analytics</h3><div class="muted" style="font-size:12.5px">Monthly revenue vs. orders</div></div><div class="segmented"><button>7D</button><button class="active">6M</button><button>1Y</button></div></div>
        <div style="height:260px"><canvas id="revChart"></canvas></div>
      </div>
      <div class="card card-pad"><h3 style="font-size:16px;margin-bottom:14px">Activity log</h3>${acts}<a href="#/admin/activity" class="btn btn-outline btn-block btn-sm" style="margin-top:12px">View full log</a></div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border)"><h3 style="font-size:16px">Recent orders</h3><a href="#/admin/orders" class="btn btn-ghost btn-sm">Manage orders ${I.chevronRight(14)}</a></div>
      <div class="table-wrapper"><table class="data"><thead><tr><th>Order</th><th>Device</th><th>Service</th><th>Status</th><th>Amount</th></tr></thead><tbody id="adminRecentBody">${topOrders}</tbody></table></div>
    </div>`;
  return shell('/admin', ADMIN_NAV, 'Admin dashboard', 'Operations overview', content);
});
ROUTES['/admin']._after = function () {
  bindShell();
  if (CONFIG.apiBase && getToken()) {
    apiAuthed('/api/admin/stats').then(st => {
      const grid = $('#adminStats');
      if (grid) grid.innerHTML =
        statCard('dollar','Revenue (total)', money(st.revenue||0)) +
        statCard('package','Orders (total)', String(st.orders||0)) +
        statCard('checkCircle','Verified mix','\u2014') +
        statCard('users','Total users', String(st.users||0));
    }).catch(()=>{});
    apiAuthed('/api/admin/orders').then(d => {
      const tb = $('#adminRecentBody');
      if (tb && d.orders) tb.innerHTML = d.orders.slice(0,5).map(o => `<tr>
        <td class="cell-mono" style="color:var(--primary);font-weight:600">${o.id}</td>
        <td>${o.device||'\u2014'}</td><td class="muted" style="font-size:12.5px">${o.service||''}</td>
        <td>${statusBadge(o.status)}</td><td style="font-weight:600">${money(o.amount||0)}</td></tr>`).join('') || tb.innerHTML;
    }).catch(()=>{});
  }
  if (!window.Chart) return;
  const grid = { grid: { color: '#eef0f3' }, ticks: { color: '#64748b', font: { size: 11 } }, border: { display: false } };
  new Chart($('#revChart'), { type: 'bar', data: { labels: ['Jan','Feb','Mar','Apr','May','Jun'], datasets: [
    { label: 'Revenue', data: [42,51,58,67,74,84], backgroundColor: '#2563eb', borderRadius: 6, barPercentage: .6, yAxisID: 'y' },
    { type: 'line', label: 'Orders', data: [980,1120,1290,1480,1640,1842], borderColor: '#f5a623', backgroundColor: 'transparent', borderWidth: 2.5, tension: .4, pointRadius: 0, yAxisID: 'y1' }
  ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }, scales: { x: grid, y: { ...grid, beginAtZero: true }, y1: { position: 'right', grid: { display: false }, ticks: { color: '#64748b', font: { size: 11 } }, border: { display: false } } } } });
};

/* ---- Admin: Order management ---- */
route('/admin/orders', function () {
  const rows = DATA.orders.map(o => `<tr>
    <td><input type="checkbox" style="accent-color:var(--primary)"></td>
    <td class="cell-mono" style="color:var(--primary);font-weight:600">${o.id}</td>
    <td><div style="font-weight:600">${o.device}</div><div class="muted" style="font-size:12px">${o.service}</div></td>
    <td class="cell-mono">${o.imei}</td><td>${statusBadge(o.status)}</td><td class="muted">${o.date}</td><td style="font-weight:600">${money(o.amount)}</td>
    <td><div style="display:flex;gap:4px"><button class="btn btn-soft btn-sm" data-toast="Order ${o.id} marked complete">Complete</button><button class="btn btn-ghost btn-icon btn-sm" data-toast="Order actions">${I.dots(16)}</button></div></td></tr>`).join('');
  const content = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
      <div class="segmented"><button class="active">All</button><button>Pending</button><button>Processing</button><button>Failed</button></div>
      <div style="display:flex;gap:8px"><div class="input-group hidden sm:block" style="width:220px"><span class="input-icon">${I.search(16)}</span><input class="input" placeholder="Search orders…" style="height:38px"></div><button class="btn btn-outline btn-sm">${I.download(15)} Export</button></div>
    </div>
    <div class="card"><div class="table-wrapper"><table class="data"><thead><tr><th style="width:36px"><input type="checkbox" style="accent-color:var(--primary)"></th><th>Order</th><th>Device</th><th>IMEI</th><th>Status</th><th>Date</th><th>Amount</th><th>Actions</th></tr></thead><tbody id="adminOrdersBody">${rows}</tbody></table></div></div>`;
  return shell('/admin/orders', ADMIN_NAV, 'Order management', 'Manage and process all orders', content);
});
ROUTES['/admin/orders']._after = function () {
  bindShell();
  if (!CONFIG.apiBase || !getToken()) return;
  apiAuthed('/api/admin/orders').then(d => {
    const tb = $('#adminOrdersBody');
    if (!tb || !d.orders) return;
    tb.innerHTML = d.orders.map(o => `<tr>
      <td><input type="checkbox" style="accent-color:var(--primary)"></td>
      <td class="cell-mono" style="color:var(--primary);font-weight:600">${o.id}</td>
      <td><div style="font-weight:600">${o.device||'\u2014'}</div><div class="muted" style="font-size:12px">${o.service||''}</div></td>
      <td class="cell-mono">${o.imei||'\u2014'}</td><td>${statusBadge(o.status)}</td><td class="muted">${(o.created_at||'').slice(0,10)}</td><td style="font-weight:600">${money(o.amount||0)}</td>
      <td><div style="display:flex;gap:4px"><button class="btn btn-soft btn-sm" data-complete="${o.id}">Complete</button><button class="btn btn-ghost btn-icon btn-sm" data-toast="Order actions">${I.dots(16)}</button></div></td></tr>`).join('') || `<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">No orders yet</td></tr>`;
    // Wire the Complete buttons to a real status update.
    $$('[data-complete]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.complete; b.disabled = true;
      apiAuthed('/api/admin/orders/' + id, { method: 'PATCH', body: { status: 'Completed' } })
        .then(() => { toast('Order ' + id + ' marked complete'); ROUTES['/admin/orders']._after(); })
        .catch(err => { toast(err.message, 'alert'); b.disabled = false; });
    }));
  }).catch(()=>{});
};

/* ---- Admin: User management ---- */
route('/admin/users', function () {
  const roleBadge = r => ({ Owner: 'info', Operator: 'success', Support: 'neutral', Reseller: 'warning' }[r] || 'neutral');
  const rows = DATA.admins.map(u => `<tr>
    <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar" style="width:34px;height:34px;font-size:12px">${u.name.split(' ').map(n=>n[0]).join('')}</span><div><div style="font-weight:600">${u.name}</div><div class="muted" style="font-size:12px">${u.email}</div></div></div></td>
    <td><span class="badge badge-${roleBadge(u.role)}">${u.role}</span></td>
    <td>${u.status === 'Active' ? statusBadge('Completed').replace('Completed','Active') : '<span class="badge badge-danger badge-dot">Suspended</span>'}</td>
    <td style="font-weight:600">${u.orders.toLocaleString()}</td><td class="muted">${u.joined}</td>
    <td><button class="btn btn-ghost btn-icon btn-sm" data-toast="Edit user">${I.dots(16)}</button></td></tr>`).join('');
  const content = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px" class="card-grid">
      ${statCard('users','Total users','3,217','9.8%')}${statCard('checkCircle','Active','3,140')}${statCard('shield','Resellers','284','12%')}${statCard('alert','Suspended','7', '2', false)}
    </div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border)"><h3 style="font-size:16px">Team & users</h3><button class="btn btn-primary btn-sm" data-toast="Invite sent">${I.plusCircle(15)} Invite user</button></div>
      <div class="table-wrapper"><table class="data"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Orders</th><th>Joined</th><th></th></tr></thead><tbody id="adminUsersBody">${rows}</tbody></table></div></div>`;
  return shell('/admin/users', ADMIN_NAV, 'User management', 'Manage team members and resellers', content);
});
ROUTES['/admin/users']._after = function () {
  bindShell();
  if (!CONFIG.apiBase || !getToken()) return;
  apiAuthed('/api/admin/users').then(d => {
    const tb = $('#adminUsersBody');
    if (!tb || !d.users) return;
    const roleBadge = r => ({ admin: 'info', user: 'neutral' }[r] || 'neutral');
    tb.innerHTML = d.users.map(u => `<tr>
      <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar" style="width:34px;height:34px;font-size:12px">${initialsOf(u.name||u.email)}</span><div><div style="font-weight:600">${u.name||'\u2014'}</div><div class="muted" style="font-size:12px">${u.email}</div></div></div></td>
      <td><span class="badge badge-${roleBadge(u.role)}">${u.role||'user'}</span></td>
      <td>${u.verified ? '<span class="badge badge-success badge-dot">Verified</span>' : '<span class="badge badge-warning badge-dot">Unverified</span>'}</td>
      <td style="font-weight:600">\u2014</td><td class="muted">${(u.created_at||'').slice(0,10)}</td>
      <td><button class="btn btn-ghost btn-icon btn-sm" data-toast="Edit user">${I.dots(16)}</button></td></tr>`).join('') || `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No users yet</td></tr>`;
  }).catch(()=>{});
};

/* ---- Admin: Pricing management ---- */
route('/admin/pricing', function () {
  const rupInput = v => `<div class="input-group" style="width:160px;margin-left:auto"><span class="input-icon" style="font-weight:600;font-size:12px;color:var(--muted-foreground)">Rp</span><input class="input cell-mono" value="${v.toLocaleString('id-ID')}" style="height:36px;text-align:right;padding-left:38px"></div>`;
  const priceCard = (num, title, sub, rows, col) => `<div class="card" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border);gap:12px;flex-wrap:wrap"><div><h3 style="font-size:16px">${num}. ${title}</h3>${sub ? `<p class="muted" style="font-size:12.5px;margin-top:2px">${sub}</p>` : ''}</div><button class="btn btn-soft btn-sm" data-toast="${title} — pricing saved">Save changes</button></div>
    <div class="table-wrapper"><table class="data"><thead><tr><th>${col}</th><th style="text-align:right">Harga (IDR)</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td style="font-weight:500">${r[0]}</td><td>${rupInput(r[1])}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  const fmiCard = `<div class="card" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border)"><div><h3 style="font-size:16px">3. FMI / Activation Status Check</h3><p class="muted" style="font-size:12.5px;margin-top:2px">Layanan instan — harga terjangkau untuk semua model.</p></div><button class="btn btn-soft btn-sm" data-toast="FMI — pricing saved">Save changes</button></div>
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:10px"><span class="badge badge-info badge-dot">Instan</span><span style="font-weight:500;font-size:13.5px">Semua iPhone 6 – iPhone 17</span></div>
      ${rupInput(25000)}
    </div>
    <div style="padding:10px 20px 2px"><div class="muted" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Premium report</div></div>
    <div class="table-wrapper"><table class="data"><thead><tr><th>Paket</th><th style="text-align:right">Harga (IDR)</th></tr></thead><tbody>
      ${TBL_FMI.map(r => `<tr><td style="font-weight:500">${r[0]}</td><td>${rupInput(r[1])}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  const content = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px" class="card-grid">
      ${statCard('dollar','Avg. order value','Rp685rb','3.2%')}${statCard('trend','Margin','62%','1.1%')}${statCard('package','Active services','4')}
    </div>
    ${priceCard(1, 'iCloud Activation Lock Removal', 'Harga per model — iPhone 6 hingga 17 Series', TBL_ICLOUD, 'Device')}
    ${priceCard(2, 'Carrier Network Unlock', 'Dikelompokkan per seri', TBL_CARRIER, 'Device')}
    ${fmiCard}
    ${priceCard(4, 'MDM Profile Bypass', 'Dikelompokkan per seri', TBL_MDM, 'Device')}`;
  return shell('/admin/pricing', ADMIN_NAV, 'Pricing management', 'Konfigurasi harga layanan (IDR)', content);
});
ROUTES['/admin/pricing']._after = bindShell;

/* ---- Admin: Webhook logs ---- */
route('/admin/webhooks', function () {
  const rows = DATA.webhooks.map(w => `<tr>
    <td class="cell-mono" style="color:var(--primary)">${w.id}</td>
    <td><span class="tag">${w.event}</span></td>
    <td class="cell-mono muted" style="font-size:12px">${w.url}</td>
    <td>${w.status === 200 ? '<span class="badge badge-success badge-dot">200 OK</span>' : `<span class="badge badge-danger badge-dot">${w.status} Error</span>`}</td>
    <td class="cell-mono ${w.ms > 1000 ? '' : 'muted'}" style="${w.ms>1000?'color:var(--danger);font-weight:600':''}">${w.ms} ms</td>
    <td class="muted cell-mono">${w.time}</td>
    <td><button class="btn btn-ghost btn-sm" data-toast="Redelivering ${w.id}">${I.refresh(14)} Retry</button></td></tr>`).join('');
  const content = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px" class="card-grid">
      ${statCard('webhook','Deliveries (24h)','12,840','6.1%')}${statCard('checkCircle','Success','99.2%')}${statCard('alert','Failed','103','12', false)}${statCard('clock','Avg. latency','148 ms')}
    </div>
    <div class="card card-pad" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="color:var(--primary)">${I.webhook(20)}</span><div style="flex:1;min-width:200px"><div style="font-weight:600;font-size:13.5px">Endpoint</div><div class="cell-mono muted" style="font-size:12.5px">https://reseller.co/hooks/ap</div></div>
      <span class="badge badge-success badge-dot">Active</span><button class="btn btn-outline btn-sm" data-toast="Secret rotated">Rotate secret</button><button class="btn btn-outline btn-sm" data-toast="Test event sent">Send test</button>
    </div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border)"><h3 style="font-size:16px">Delivery logs</h3><div class="segmented"><button class="active">All</button><button>Failed</button></div></div>
      <div class="table-wrapper"><table class="data"><thead><tr><th>Event ID</th><th>Type</th><th>Endpoint</th><th>Status</th><th>Latency</th><th>Time</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  return shell('/admin/webhooks', ADMIN_NAV, 'Webhook logs', 'Monitor webhook deliveries', content);
});
ROUTES['/admin/webhooks']._after = bindShell;

/* ---- Admin: Activity logs ---- */
route('/admin/activity', function () {
  const all = [...DATA.activity, ...DATA.activity.map(a => ({ ...a, time: a.time.replace('min','min').replace('hr','hr') }))];
  const rows = [
    ['David Chen','completed','order AP-10427','success','Jun 20, 11:24:02','198.51.100.4'],
    ['System','auto-refunded','order AP-10424','warning','Jun 20, 11:09:30','—'],
    ['Priya Nair','replied to','ticket #4821','info','Jun 20, 10:52:18','203.0.113.9'],
    ['Alicia Moreno','updated pricing for','Carrier Unlock','info','Jun 20, 10:14:55','198.51.100.7'],
    ['System','webhook delivery failed','evt_9f20','danger','Jun 20, 10:01:12','—'],
    ['Marco Rossi','login attempt blocked','reseller account','danger','Jun 20, 09:44:30','192.0.2.55'],
    ['David Chen','verified IMEI','356789104253871','success','Jun 20, 09:15:08','198.51.100.4'],
  ].map(r => `<tr>
    <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar" style="width:30px;height:30px;font-size:11px;background:${r[0]==='System'?'var(--muted-foreground)':'var(--primary)'}">${r[0]==='System'?I.cpu(15):r[0].split(' ').map(n=>n[0]).join('')}</span><span style="font-weight:600;font-size:13px">${r[0]}</span></div></td>
    <td style="font-size:13px">${r[1]} <b style="color:var(--primary)">${r[2]}</b></td>
    <td><span style="width:8px;height:8px;border-radius:999px;display:inline-block;background:var(--${r[3]==='success'?'success':r[3]==='warning'?'warning':r[3]==='danger'?'danger':'info'})"></span></td>
    <td class="cell-mono muted" style="font-size:12px">${r[4]}</td><td class="cell-mono muted" style="font-size:12px">${r[5]}</td></tr>`).join('');
  const content = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
      <div class="segmented"><button class="active">All events</button><button>Users</button><button>System</button><button>Security</button></div>
      <div style="display:flex;gap:8px"><button class="btn btn-outline btn-sm">${I.filter(15)} Filter</button><button class="btn btn-outline btn-sm">${I.download(15)} Export CSV</button></div>
    </div>
    <div class="card"><div class="table-wrapper"><table class="data"><thead><tr><th>Actor</th><th>Action</th><th>Level</th><th>Timestamp</th><th>IP address</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div style="padding:14px 20px;border-top:1px solid var(--border)" class="muted" style="font-size:12.5px">Showing 7 of 18,402 events · retained for 90 days</div></div>`;
  return shell('/admin/activity', ADMIN_NAV, 'Activity logs', 'Audit trail of all platform events', content);
});
ROUTES['/admin/activity']._after = bindShell;

/* ============================================================
   GLOBAL bindings (toast buttons etc.)
   ============================================================ */
function bindGlobal() {
  $$('[data-theme-toggle]').forEach(b => { if (b._bt) return; b._bt = true; b.addEventListener('click', toggleTheme); });
  updateThemeIcons();
  $$('[data-toast]').forEach(b => {
    if (b._bound) return; b._bound = true;
    b.addEventListener('click', () => toast(b.dataset.toast));
  });
  $$('[data-acc]').forEach(item => {
    const t = item.querySelector('.acc-trigger'); if (t._bound) return; t._bound = true;
    t.addEventListener('click', () => item.classList.toggle('open'));
  });
  $$('.segmented').forEach(seg => {
    if (seg._bound) return; seg._bound = true;
    seg.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => { seg.querySelectorAll('button').forEach(x => x.classList.remove('active')); btn.classList.add('active'); }));
  });
}

/* ============================================================
   EXTRA ICONS + NAV (Profile & Settings)
   ============================================================ */
Object.assign(I, {
  user: s => I._w('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', s),
  key: s => I._w('<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>', s),
  wallet: s => I._w('<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>', s),
  trash: s => I._w('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>', s),
  copy: s => I._w('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', s),
  building: s => I._w('<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>', s),
  phone: s => I._w('<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>', s),
  pin: s => I._w('<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>', s),
  palette: s => I._w('<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2"/>', s),
  monitor: s => I._w('<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>', s),
  moon: s => I._w('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>', s),
  sun: s => I._w('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>', s),
  camera: s => I._w('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>', s),
});
(function insertNav() {
  const idx = CUSTOMER_NAV.findIndex(n => n.k === '/dashboard/checkout');
  CUSTOMER_NAV.splice(idx, 0,
    { k: '/dashboard/profile', label: 'Profile', icon: 'user' },
    { k: '/dashboard/settings', label: 'Settings', icon: 'settings' });
})();

function sw(checked) { return `<label class="switch"><input type="checkbox" ${checked ? 'checked' : ''}><span class="track"></span></label>`; }

/* ============================================================
   PROFILE PAGE
   ============================================================ */
route('/dashboard/profile', function () {
  const u = DATA.user;
  const content = `<div style="max-width:1000px;margin:0 auto;display:flex;flex-direction:column;gap:20px">
    <div class="card" style="overflow:hidden">
      <div class="cover"><div class="grid-mask" style="position:absolute;inset:0;opacity:.2"></div></div>
      <div style="padding:0 24px 22px;margin-top:-46px;display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap">
        <div style="position:relative"><div class="profile-avatar">${u.initials}</div>
          <button class="btn btn-primary btn-icon btn-sm" style="position:absolute;bottom:-2px;right:-6px;width:30px;height:30px;border:2px solid #fff" data-toast="Upload new photo">${I.camera(15)}</button></div>
        <div style="flex:1;min-width:160px;padding-bottom:4px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="font-size:22px">${u.name}</h2><span class="badge badge-info">Pro plan</span><span class="badge badge-success badge-dot">Verified</span></div>
          <div class="muted" style="font-size:13.5px;margin-top:2px;display:flex;align-items:center;gap:14px;flex-wrap:wrap"><span style="display:flex;align-items:center;gap:5px">${I.mail(14)} ${u.email}</span><span style="display:flex;align-items:center;gap:5px">${I.pin(14)} Jakarta, ID</span><span style="display:flex;align-items:center;gap:5px">${I.clock(14)} Member since Jan 2024</span></div>
        </div>
        <div style="display:flex;gap:8px;padding-bottom:4px"><a href="#/dashboard/settings" class="btn btn-outline btn-sm">${I.settings(15)} Settings</a><button class="btn btn-primary btn-sm" id="profileSave2" data-toast="Profile saved">Save changes</button></div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px" class="card-grid">
      ${statCard('package','Lifetime orders','248','12.4%')}
      ${statCard('wallet','Wallet balance','Rp1,84Jt')}
      ${statCard('checkCircle','Success rate','98.6%')}
      ${statCard('star','Loyalty points','3,420','5%')}
    </div>

    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:20px" class="checkout-grid">
      <div style="display:flex;flex-direction:column;gap:20px">
        <div class="card card-pad">
          <h3 style="font-size:16px;margin-bottom:4px">Personal information</h3>
          <p class="muted" style="font-size:12.5px;margin-bottom:18px">Update your personal details and contact information.</p>
          <form id="profileForm" style="display:flex;flex-direction:column;gap:15px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="wiz-grid">
              <div class="field"><label class="label">First name</label><input class="input" id="pfFirst" value="${(u.name||'').split(' ')[0]||''}"></div>
              <div class="field"><label class="label">Last name</label><input class="input" id="pfLast" value="${(u.name||'').split(' ').slice(1).join(' ')||''}"></div>
            </div>
            <div class="field"><label class="label">Email address</label><div class="input-group"><span class="input-icon">${I.mail(17)}</span><input class="input" value="${u.email}"></div></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="wiz-grid">
              <div class="field"><label class="label">Phone</label><div class="input-group"><span class="input-icon">${I.phone(17)}</span><input class="input" value="+62 812 3456 7890"></div></div>
              <div class="field"><label class="label">Company</label><div class="input-group"><span class="input-icon">${I.building(17)}</span><input class="input" value="MobileFix Co."></div></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="wiz-grid">
              <div class="field"><label class="label">Country</label><select class="select"><option>Indonesia</option><option>United States</option><option>United Kingdom</option><option>Singapore</option></select></div>
              <div class="field"><label class="label">Timezone</label><select class="select"><option>(GMT+7) Jakarta</option><option>(GMT+0) London</option><option>(GMT-5) New York</option></select></div>
            </div>
            <div class="field"><label class="label">Bio</label><textarea class="textarea" placeholder="Tell us about your business…">Independent iPhone repair & activation reseller serving 500+ customers monthly.</textarea></div>
            <div style="display:flex;gap:10px"><button type="submit" class="btn btn-primary">Save changes</button><button type="reset" class="btn btn-ghost">Cancel</button></div>
          </form>
        </div>

        <div class="card card-pad">
          <h3 style="font-size:16px;margin-bottom:16px">API keys</h3>
          <div class="card" style="box-shadow:none;background:var(--surface);padding:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span style="color:var(--primary)">${I.key(18)}</span>
            <div style="flex:1;min-width:160px"><div style="font-weight:600;font-size:13px">Production key</div><div class="cell-mono muted" style="font-size:12px">ap_live_••••••••••••8f2a</div></div>
            <button class="btn btn-outline btn-sm" data-toast="API key copied">${I.copy(14)} Copy</button>
            <button class="btn btn-ghost btn-sm" data-toast="Key rotated">Rotate</button>
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:20px">
        <div class="card card-pad">
          <h3 style="font-size:15px;margin-bottom:14px">Security</h3>
          <div class="set-row" style="padding-top:0"><div class="meta"><h4>Password</h4><p>Last changed 3 months ago</p></div><button class="btn btn-outline btn-sm" data-toast="Password dialog opened">Change</button></div>
          <div class="set-row"><div class="meta"><h4>Two-factor auth</h4><p>Extra layer of security</p></div>${sw(true)}</div>
          <div class="set-row"><div class="meta"><h4>Login alerts</h4><p>Email on new sign-in</p></div>${sw(true)}</div>
        </div>
        <div class="card card-pad">
          <h3 style="font-size:15px;margin-bottom:12px">Active sessions</h3>
          ${[['MacBook Pro · Jakarta','Current session','monitor','success'],['iPhone 15 Pro · Jakarta','2 hours ago','smartphone',''],['Chrome · Singapore','3 days ago','globe','']].map(s=>`<div style="display:flex;align-items:center;gap:11px;padding:9px 0"><span class="stat-icon" style="width:34px;height:34px;background:var(--surface);color:var(--muted-foreground)">${I[s[2]](16)}</span><div style="flex:1"><div style="font-size:13px;font-weight:600">${s[0]}</div><div class="muted" style="font-size:11.5px">${s[1]}</div></div>${s[3]==='success'?'<span class="badge badge-success" style="font-size:11px">Active</span>':`<button class="btn btn-ghost btn-sm" data-toast="Session revoked">Revoke</button>`}</div>`).join('')}
        </div>
        <div class="card card-pad" style="border-color:var(--danger)">
          <h3 style="font-size:15px;margin-bottom:6px;color:var(--danger)">Danger zone</h3>
          <p class="muted" style="font-size:12.5px;margin-bottom:14px">Permanently delete your account and all associated data. This cannot be undone.</p>
          <button class="btn btn-danger btn-sm btn-block" data-toast="Account deletion requires confirmation">${I.trash(15)} Delete account</button>
        </div>
      </div>
    </div>
  </div>`;
  return shell('/dashboard/profile', CUSTOMER_NAV, 'Profile', 'Manage your account & personal info', content);
});
ROUTES['/dashboard/profile']._after = function () {
  bindShell();
  const f = $('#profileForm');
  if (f) f.addEventListener('submit', e => {
    e.preventDefault();
    const first = ($('#pfFirst') && $('#pfFirst').value.trim()) || '';
    const last = ($('#pfLast') && $('#pfLast').value.trim()) || '';
    const name = (first + ' ' + last).trim();
    if (!CONFIG.apiBase || !getToken()) { toast('Profile saved successfully'); return; }
    if (!name) { toast('Name is required', 'alert'); return; }
    apiAuthed('/api/profile', { method: 'PATCH', body: { name } })
      .then(d => { if (d && d.user) { DATA.user = { name: d.user.name, email: d.user.email, initials: initialsOf(d.user.name), role: d.user.role }; } toast('Profile saved successfully'); render(); })
      .catch(err => toast(err.message, 'alert'));
  });
};

/* ============================================================
   SETTINGS PAGE (tabbed)
   ============================================================ */
function setRow(title, desc, control) {
  return `<div class="set-row"><div class="meta"><h4>${title}</h4><p>${desc}</p></div><div class="set-control">${control}</div></div>`;
}
route('/dashboard/settings', function () {
  const tabs = [
    ['general', 'General', 'settings'],
    ['notifications', 'Notifications', 'bell'],
    ['security', 'Security', 'shield'],
    ['billing', 'Billing', 'card'],
    ['appearance', 'Appearance', 'palette'],
    ['api', 'API & Webhooks', 'webhook'],
  ];
  const tabBtns = tabs.map((t, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-tab="${t[0]}">${I[t[2]](16)} <span class="hidden sm:inline">${t[1]}</span></button>`).join('');

  const general = `<div class="card card-pad">
    <h3 style="font-size:16px;margin-bottom:2px">General preferences</h3><p class="muted" style="font-size:12.5px;margin-bottom:6px">Configure your workspace defaults.</p>
    ${setRow('Language', 'Interface display language', `<select class="select" style="width:200px;height:40px"><option>English (US)</option><option>Bahasa Indonesia</option><option>Español</option></select>`)}
    ${setRow('Timezone', 'Used for timestamps & reports', `<select class="select" style="width:200px;height:40px"><option>(GMT+7) Jakarta</option><option>(GMT+0) London</option><option>(GMT-5) New York</option></select>`)}
    ${setRow('Currency', 'Default billing currency', `<select class="select" style="width:200px;height:40px"><option>USD ($)</option><option>IDR (Rp)</option><option>EUR (€)</option></select>`)}
    ${setRow('Default service', 'Pre-selected on new orders', `<select class="select" style="width:200px;height:40px">${DATA.services.map(s => `<option>${s.name}</option>`).join('')}</select>`)}
    ${setRow('Auto-archive completed orders', 'Hide orders 30 days after completion', sw(true))}
  </div>`;

  const notifications = `<div class="card card-pad">
    <h3 style="font-size:16px;margin-bottom:2px">Notification preferences</h3><p class="muted" style="font-size:12.5px;margin-bottom:6px">Choose how and when we contact you.</p>
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted-foreground);padding:16px 0 4px">Email</div>
    ${setRow('Order status updates', 'When an order changes status', sw(true))}
    ${setRow('Order completed', 'When activation finishes', sw(true))}
    ${setRow('Payment & invoices', 'Receipts and billing alerts', sw(true))}
    ${setRow('Product news & offers', 'Occasional promotions', sw(false))}
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted-foreground);padding:16px 0 4px">Push & SMS</div>
    ${setRow('Browser push', 'Real-time desktop alerts', sw(true))}
    ${setRow('SMS for failures', 'Text me if an order fails', sw(false))}
  </div>`;

  const security = `<div style="display:flex;flex-direction:column;gap:16px">
    <div class="card card-pad">
      <h3 style="font-size:16px;margin-bottom:14px">Change password</h3>
      <form id="pwForm" style="display:flex;flex-direction:column;gap:14px;max-width:440px">
        <div class="field"><label class="label">Current password</label><div class="input-group"><span class="input-icon">${I.lock(17)}</span><input class="input" id="pwCurrent" type="password" placeholder="••••••••"></div></div>
        <div class="field"><label class="label">New password</label><div class="input-group"><span class="input-icon">${I.lock(17)}</span><input class="input" id="pwNew" type="password" placeholder="••••••••"></div></div>
        <div class="field"><label class="label">Confirm new password</label><div class="input-group"><span class="input-icon">${I.lock(17)}</span><input class="input" id="pwConfirm" type="password" placeholder="••••••••"></div></div>
        <button type="submit" class="btn btn-primary" style="align-self:flex-start">Update password</button>
      </form>
    </div>
    <div class="card card-pad">
      <h3 style="font-size:16px;margin-bottom:2px">Authentication</h3><p class="muted" style="font-size:12.5px;margin-bottom:6px">Protect your account with additional verification.</p>
      ${setRow('Two-factor authentication', 'Require a code at sign-in', sw(true))}
      ${setRow('Login alerts', 'Email me on new device sign-ins', sw(true))}
      ${setRow('Trusted devices only', 'Block sign-ins from new devices', sw(false))}
    </div>
  </div>`;

  const billing = `<div style="display:flex;flex-direction:column;gap:16px">
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><h3 style="font-size:16px">Payment methods</h3><button class="btn btn-outline btn-sm" data-toast="Add card dialog opened">${I.plusCircle(15)} Add card</button></div>
      ${[['•••• 4242','Visa · Expires 08/28','Default'],['•••• 8801','Mastercard · Expires 03/27','']].map(c=>`<div class="card" style="box-shadow:none;background:var(--surface);padding:14px;display:flex;align-items:center;gap:12px;margin-bottom:10px"><span style="color:var(--primary)">${I.card(20)}</span><div style="flex:1"><div style="font-weight:600;font-size:13.5px">${c[0]}</div><div class="muted" style="font-size:12px">${c[1]}</div></div>${c[2]?`<span class="badge badge-info">${c[2]}</span>`:`<button class="btn btn-ghost btn-sm" data-toast="Set as default">Make default</button>`}<button class="btn btn-ghost btn-icon btn-sm" data-toast="Card removed">${I.trash(15)}</button></div>`).join('')}
    </div>
    <div class="card card-pad">
      <h3 style="font-size:16px;margin-bottom:2px">Wallet</h3><p class="muted" style="font-size:12.5px;margin-bottom:6px">Current balance: <b style="color:var(--foreground)">Rp1.840.000</b></p>
      ${setRow('Auto-reload', 'Top up Rp250.000 when balance drops below Rp100.000', sw(true))}
      ${setRow('Reseller volume billing', 'Consolidate into monthly invoice', sw(false))}
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border)"><h3 style="font-size:16px">Invoices</h3><button class="btn btn-outline btn-sm" data-toast="All invoices exported">${I.download(15)} Export all</button></div>
      <div class="table-wrapper"><table class="data"><thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${[['INV-2048','Jun 18, 2026','Rp1.498.500','Paid'],['INV-2041','Jun 10, 2026','Rp1.350.000','Paid'],['INV-2033','Jun 02, 2026','Rp2.100.000','Paid']].map(r=>`<tr><td class="cell-mono" style="color:var(--primary);font-weight:600">${r[0]}</td><td class="muted">${r[1]}</td><td style="font-weight:600">${r[2]}</td><td><span class="badge badge-success badge-dot">${r[3]}</span></td><td><button class="btn btn-ghost btn-sm" data-toast="Invoice downloaded">${I.download(14)}</button></td></tr>`).join('')}
      </tbody></table></div>
    </div>
  </div>`;

  const appearance = `<div class="card card-pad">
    <h3 style="font-size:16px;margin-bottom:2px">Appearance</h3><p class="muted" style="font-size:12.5px;margin-bottom:18px">Customize how ActivatePro looks for you.</p>
    <div class="set-control" style="display:block"><h4 style="font-size:14px;font-weight:600;margin-bottom:10px">Theme</h4>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:420px">
        <div class="theme-card active" data-theme><div style="color:var(--primary);display:flex;justify-content:center;margin-bottom:6px">${I.sun(22)}</div><div style="font-size:12.5px;font-weight:600">Light</div></div>
        <div class="theme-card" data-theme><div style="color:var(--muted-foreground);display:flex;justify-content:center;margin-bottom:6px">${I.moon(22)}</div><div style="font-size:12.5px;font-weight:600">Dark</div></div>
        <div class="theme-card" data-theme><div style="color:var(--muted-foreground);display:flex;justify-content:center;margin-bottom:6px">${I.monitor(22)}</div><div style="font-size:12.5px;font-weight:600">System</div></div>
      </div>
    </div>
    <div class="divider" style="margin:20px 0"></div>
    <h4 style="font-size:14px;font-weight:600;margin-bottom:10px">Accent color</h4>
    <div style="display:flex;gap:10px;margin-bottom:4px">${['#2563eb','#0f172a','#7c3aed','#16a34a','#dc2626','#d97706'].map((c,i)=>`<span class="swatch ${i===0?'active':''}" data-swatch style="background:${c}"></span>`).join('')}</div>
    <div class="divider" style="margin:20px 0"></div>
    ${setRow('Compact density', 'Reduce padding for denser tables', sw(false))}
    ${setRow('Reduce motion', 'Minimize animations & transitions', sw(false))}
  </div>`;

  const api = `<div style="display:flex;flex-direction:column;gap:16px">
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div><h3 style="font-size:16px">API keys</h3><p class="muted" style="font-size:12.5px;margin-top:2px">Use these to authenticate API requests.</p></div><button class="btn btn-primary btn-sm" data-toast="New key generated">${I.plusCircle(15)} Create key</button></div>
      ${[['Production','ap_live_••••••••••••8f2a','Live'],['Test','ap_test_••••••••••••2c19','Test']].map(k=>`<div class="card" style="box-shadow:none;background:var(--surface);padding:14px;display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap"><span style="color:var(--primary)">${I.key(18)}</span><div style="flex:1;min-width:160px"><div style="font-weight:600;font-size:13px">${k[0]} key <span class="badge ${k[2]==='Live'?'badge-success':'badge-neutral'}" style="font-size:10px">${k[2]}</span></div><div class="cell-mono muted" style="font-size:12px">${k[1]}</div></div><button class="btn btn-outline btn-sm" data-toast="Key copied">${I.copy(14)} Copy</button><button class="btn btn-ghost btn-sm" data-toast="Key revoked">Revoke</button></div>`).join('')}
    </div>
    <div class="card card-pad">
      <h3 style="font-size:16px;margin-bottom:2px">Webhook endpoint</h3><p class="muted" style="font-size:12.5px;margin-bottom:14px">We'll POST event payloads to this URL.</p>
      <div class="field" style="margin-bottom:14px"><label class="label">Endpoint URL</label><div style="display:flex;gap:8px"><input class="input cell-mono" value="https://reseller.co/hooks/ap"><button class="btn btn-outline" data-toast="Test event sent">Send test</button></div></div>
      ${setRow('order.created', 'Fires when an order is placed', sw(true))}
      ${setRow('order.completed', 'Fires on successful activation', sw(true))}
      ${setRow('order.failed', 'Fires when an order fails', sw(true))}
      ${setRow('payment.succeeded', 'Fires on successful payment', sw(false))}
      <a href="#/admin/webhooks" class="btn btn-outline btn-sm" style="margin-top:14px">View webhook logs</a>
    </div>
  </div>`;

  const panels = { general, notifications, security, billing, appearance, api };
  const panelHtml = Object.entries(panels).map(([k, v], i) => `<div class="tab-panel ${i === 0 ? 'active' : ''}" data-panel="${k}">${v}</div>`).join('');

  const content = `<div style="max-width:920px;margin:0 auto">
    <div class="card" style="padding:0 16px;margin-bottom:20px"><div class="tabs">${tabBtns}</div></div>
    ${panelHtml}
  </div>`;
  return shell('/dashboard/settings', CUSTOMER_NAV, 'Settings', 'Manage your preferences', content);
});
ROUTES['/dashboard/settings']._after = function () {
  bindShell();
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.remove('active')); t.classList.add('active');
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
  }));
  const modes = ['light', 'dark', 'system'];
  const cards = $$('[data-theme]');
  cards.forEach((c, i) => { c.classList.toggle('active', modes[i] === _theme); });
  cards.forEach((c, i) => c.addEventListener('click', () => { cards.forEach(x => x.classList.remove('active')); c.classList.add('active'); applyTheme(modes[i]); toast('Theme preference saved'); }));
  $$('[data-swatch]').forEach(s => s.addEventListener('click', () => { $$('[data-swatch]').forEach(x => x.classList.remove('active')); s.classList.add('active'); document.documentElement.style.setProperty('--primary', s.style.background); toast('Accent color updated'); }));
  const pf = $('#pwForm'); if (pf) pf.addEventListener('submit', e => {
    e.preventDefault();
    const cur = ($('#pwCurrent') && $('#pwCurrent').value) || '';
    const nw = ($('#pwNew') && $('#pwNew').value) || '';
    const cf = ($('#pwConfirm') && $('#pwConfirm').value) || '';
    if (nw.length < 8) { toast('New password must be at least 8 characters', 'alert'); return; }
    if (nw !== cf) { toast('Passwords do not match', 'alert'); return; }
    if (!CONFIG.apiBase || !getToken()) { toast('Password updated'); pf.reset(); return; }
    apiAuthed('/api/auth/change-password', { method: 'POST', body: { current: cur, next: nw } })
      .then(() => { toast('Password updated'); pf.reset(); })
      .catch(err => toast(err.message, 'alert'));
  });
};

/* ============================================================
   THEME ENGINE (dark mode)
   ============================================================ */
let _theme = 'light';
function storedTheme() { try { return localStorage.getItem('ap-theme'); } catch (e) { return null; } }
function saveTheme(t) { try { localStorage.setItem('ap-theme', t); } catch (e) {} }
function systemDark() { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
function applyTheme(mode) {
  _theme = mode;
  const dark = mode === 'dark' || (mode === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
  saveTheme(mode);
  updateThemeIcons();
}
function updateThemeIcons() {
  const dark = document.documentElement.classList.contains('dark');
  $$('[data-theme-toggle]').forEach(b => b.innerHTML = dark ? I.sun(19) : I.moon(19));
}
function toggleTheme() { applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'); }
function initTheme() { applyTheme(storedTheme() || 'light'); }
function themeBtn() { return `<button class="btn btn-ghost btn-icon" data-theme-toggle aria-label="Toggle dark mode" title="Toggle theme"></button>`; }
initTheme();
window.addEventListener('DOMContentLoaded', initTheme);

/* ============================================================
   FORGOT PASSWORD
   ============================================================ */
route('/forgot', function () {
  const page = el(`<div style="min-height:100dvh;display:grid;grid-template-columns:1fr 1fr" class="auth-shell">
    ${authAside('Forgot your password?', "No problem. Enter your account email and we'll send you a secure link to reset it.", ['Secure, single-use reset links','Links expire after 30 minutes','Your data stays encrypted'])}
    <div style="display:flex;align-items:center;justify-content:center;padding:40px 24px;background:var(--background)">
      <div style="width:100%;max-width:400px" class="fade-in">
        <div class="md:hidden" style="margin-bottom:24px">${brandLogo()}</div>
        <div id="forgotForm">
          <h1 style="font-size:26px;margin-bottom:6px">Reset password</h1>
          <p class="muted" style="margin-bottom:26px;font-size:14px">Enter the email associated with your account.</p>
          <form id="fForm" novalidate style="display:flex;flex-direction:column;gap:16px">
            <div class="field"><label class="label">Email</label>
              <div class="input-group"><span class="input-icon">${I.mail(17)}</span><input class="input" name="email" type="email" placeholder="you@company.com"></div>
              <span class="input-error" data-err="femail">Enter a valid email address.</span></div>
            <button type="submit" class="btn btn-primary btn-block btn-lg">Send reset link ${I.arrowRight(16)}</button>
          </form>
          <a href="#/login" class="btn btn-ghost btn-block btn-sm" style="margin-top:12px">${I.arrowRight(15)} Back to sign in</a>
        </div>
        <div id="forgotDone" style="display:none;text-align:center">
          <span class="stat-icon" style="margin:0 auto 16px;width:56px;height:56px;background:var(--success-bg);color:var(--success)">${I.mail(26)}</span>
          <h1 style="font-size:24px;margin-bottom:8px">Check your inbox</h1>
          <p class="muted" style="font-size:14px;margin-bottom:22px">We sent a password reset link to <b id="fEmail" style="color:var(--foreground)"></b>. It expires in 30 minutes.</p>
          <a href="#/login" class="btn btn-primary btn-block btn-lg">Back to sign in</a>
          <button class="btn btn-ghost btn-block btn-sm" id="fResend" style="margin-top:10px">Didn't get it? Resend email</button>
        </div>
      </div>
    </div>
  </div>`);
  return page;
});
ROUTES['/forgot']._after = function () {
  const f = $('#fForm');
  const showDone = (email) => { $('#fEmail').textContent = email; $('#forgotForm').style.display = 'none'; $('#forgotDone').style.display = 'block'; };
  const submit = (email) => {
    if (!CONFIG.apiBase) { showDone(email); toast('Reset link sent'); return; }
    const btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
    apiPost('/api/auth/forgot', { email })
      .then(d => {
        showDone(email); toast('Reset link sent');
        // Dev mode: backend returns the token so you can reset without email.
        if (d && d.devToken) {
          const url = '#/reset?token=' + d.devToken;
          const done = $('#forgotDone');
          const dev = document.createElement('p');
          dev.style.cssText = 'margin-top:14px;font-size:12.5px';
          dev.innerHTML = 'Dev mode: <a href="' + url + '" style="color:var(--primary);font-weight:600">open reset link</a>';
          done.appendChild(dev);
        }
      })
      .catch(err => toast(err.message))
      .finally(() => { if (btn) btn.disabled = false; });
  };
  f.addEventListener('submit', e => {
    e.preventDefault();
    const email = f.email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showErr(f.email, 'femail'); return; }
    clearErr(f.email, 'femail');
    submit(email);
  });
  $('#fResend').addEventListener('click', () => { const email = f.email.value.trim() || $('#fEmail').textContent; if (email) submit(email); });
};

/* ============================================================
   RESET PASSWORD (token from email link: #/reset?token=...)
   ============================================================ */
route('/reset', function () {
  const page = el(`<div style="min-height:100dvh;display:grid;grid-template-columns:1fr 1fr" class="auth-shell">
    ${authAside('Choose a new password.', 'Pick a strong password you don\'t use anywhere else. Your reset link is single-use and expires in 30 minutes.', ['Single-use, secure reset','Minimum 8 characters','Your data stays encrypted'])}
    <div style="display:flex;align-items:center;justify-content:center;padding:40px 24px;background:var(--background)">
      <div style="width:100%;max-width:400px" class="fade-in">
        <div class="md:hidden" style="margin-bottom:24px">${brandLogo()}</div>
        <div id="resetForm">
          <h1 style="font-size:26px;margin-bottom:6px">Set a new password</h1>
          <p class="muted" style="margin-bottom:26px;font-size:14px">Enter and confirm your new password.</p>
          <form id="rForm" novalidate style="display:flex;flex-direction:column;gap:16px">
            <div class="field"><label class="label">New password</label>
              <div class="input-group"><span class="input-icon">${I.lock(17)}</span><input class="input" name="pw" type="password" placeholder="At least 8 characters"></div>
              <span class="input-error" data-err="rpw">Password must be at least 8 characters.</span></div>
            <div class="field"><label class="label">Confirm password</label>
              <div class="input-group"><span class="input-icon">${I.lock(17)}</span><input class="input" name="pw2" type="password" placeholder="Re-enter password"></div>
              <span class="input-error" data-err="rpw2">Passwords do not match.</span></div>
            <button type="submit" class="btn btn-primary btn-block btn-lg">Update password ${I.arrowRight(16)}</button>
          </form>
          <a href="#/login" class="btn btn-ghost btn-block btn-sm" style="margin-top:12px">${I.arrowRight(15)} Back to sign in</a>
        </div>
        <div id="resetDone" style="display:none;text-align:center">
          <span class="stat-icon" style="margin:0 auto 16px;width:56px;height:56px;background:var(--success-bg);color:var(--success)">${I.checkCircle(26)}</span>
          <h1 style="font-size:24px;margin-bottom:8px">Password updated</h1>
          <p class="muted" style="font-size:14px;margin-bottom:22px">You can now sign in with your new password.</p>
          <a href="#/login" class="btn btn-primary btn-block btn-lg">Back to sign in</a>
        </div>
      </div>
    </div>
  </div>`);
  return page;
});
ROUTES['/reset']._after = function () {
  const f = $('#rForm');
  // Extract token from the hash query (#/reset?token=...)
  let token = '';
  try { const h = location.hash || ''; const q = h.split('?')[1] || ''; token = new URLSearchParams(q).get('token') || ''; } catch (e) {}
  f.addEventListener('submit', e => {
    e.preventDefault();
    const pw = f.pw.value, pw2 = f.pw2.value;
    let ok = true;
    if (pw.length < 8) { showErr(f.pw, 'rpw'); ok = false; } else clearErr(f.pw, 'rpw');
    if (pw !== pw2) { showErr(f.pw2, 'rpw2'); ok = false; } else clearErr(f.pw2, 'rpw2');
    if (!ok) return;
    if (!token) { toast('Missing or invalid reset link'); return; }
    if (!CONFIG.apiBase) { $('#resetForm').style.display = 'none'; $('#resetDone').style.display = 'block'; return; }
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    apiPost('/api/auth/reset', { token, password: pw })
      .then(() => { $('#resetForm').style.display = 'none'; $('#resetDone').style.display = 'block'; toast('Password updated'); })
      .catch(err => { toast(err.message); btn.disabled = false; });
  });
};

/* ============================================================
   EMAIL VERIFICATION (OTP)
   ============================================================ */
route('/verify', function () {
  const page = el(`<div style="min-height:100dvh;display:grid;grid-template-columns:1fr 1fr" class="auth-shell">
    ${authAside('Verify your email.', 'We sent a 6-digit verification code to your inbox. Enter it below to activate your account.', ['Confirms you own this email','Protects against fraud','Takes less than a minute'])}
    <div style="display:flex;align-items:center;justify-content:center;padding:40px 24px;background:var(--background)">
      <div style="width:100%;max-width:420px;text-align:center" class="fade-in">
        <div class="md:hidden" style="margin-bottom:24px;text-align:left">${brandLogo()}</div>
        <span class="stat-icon" style="margin:0 auto 16px;width:56px;height:56px;background:var(--primary-50);color:var(--primary)">${I.shield(26)}</span>
        <h1 style="font-size:25px;margin-bottom:8px">Enter verification code</h1>
        <p class="muted" style="font-size:14px;margin-bottom:26px">Sent to <b style="color:var(--foreground)">${AUTH.email || DATA.user.email}</b></p>
        <div id="otp" style="display:flex;gap:10px;justify-content:center;margin-bottom:8px">
          ${Array.from({length:6}).map(()=>`<input class="otp-input" maxlength="1" inputmode="numeric">`).join('')}
        </div>
        <div class="input-error" data-err="otp" style="text-align:center;margin-bottom:14px">Please enter all 6 digits.</div>
        <button class="btn btn-primary btn-block btn-lg" id="otpVerify">Verify & continue ${I.arrowRight(16)}</button>
        <div class="muted" style="font-size:13px;margin-top:18px">Didn't receive a code? <button id="otpResend" style="background:none;border:none;color:var(--primary);font-weight:600;cursor:pointer">Resend</button> <span id="otpTimer"></span></div>
        <a href="#/register" class="btn btn-ghost btn-block btn-sm" style="margin-top:8px">Wrong email? Go back</a>
      </div>
    </div>
  </div>`);
  return page;
});
ROUTES['/verify']._after = function () {
  const inputs = $$('#otp .otp-input');
  inputs[0] && inputs[0].focus();
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '');
      $('[data-err="otp"]').classList.remove('show');
      if (inp.value && i < inputs.length - 1) inputs[i + 1].focus();
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Backspace' && !inp.value && i > 0) inputs[i - 1].focus(); });
    inp.addEventListener('paste', e => {
      e.preventDefault();
      const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
      d.forEach((c, j) => { if (inputs[j]) inputs[j].value = c; });
      (inputs[d.length] || inputs[5]).focus();
    });
  });
  $('#otpVerify').addEventListener('click', () => {
    const code = inputs.map(i => i.value).join('');
    if (code.length < 6) { $('[data-err="otp"]').classList.add('show'); return; }
    if (!CONFIG.apiBase) { toast('Email verified — welcome!'); setTimeout(() => navigate('/dashboard'), 600); return; }
    apiPost('/api/auth/verify-otp', { email: AUTH.email || DATA.user.email, code })
      .then(d => { if (d && d.token) setToken(d.token); toast('Email verified — welcome!'); setTimeout(() => navigate('/dashboard'), 600); })
      .catch(err => { const e = $('[data-err="otp"]'); e.textContent = err.message; e.classList.add('show'); });
  });
  let t = 30; const timer = $('#otpTimer'); const resend = $('#otpResend');
  resend.disabled = true; resend.style.opacity = '.5';
  const iv = setInterval(() => { t--; timer.textContent = t > 0 ? `in ${t}s` : ''; if (t <= 0) { clearInterval(iv); resend.disabled = false; resend.style.opacity = '1'; } }, 1000);
  resend.addEventListener('click', () => {
    if (resend.disabled) return;
    if (!CONFIG.apiBase) { toast('New code sent'); return; }
    apiPost('/api/auth/send-otp', { email: AUTH.email || DATA.user.email, name: AUTH.pendingName })
      .then(() => toast('New code sent'))
      .catch(err => toast('Could not resend: ' + err.message));
  });
};

/* ============================================================
   iPHONE MODELS (6 → 17 Pro Max) + marquee showcase
   ============================================================ */
const IPHONE_MODELS = [
  { name: 'iPhone 6' }, { name: 'iPhone 6 Plus' }, { name: 'iPhone 6s' }, { name: 'iPhone 6s Plus' }, { name: 'iPhone SE (1st gen)' },
  { name: 'iPhone 7' }, { name: 'iPhone 7 Plus' }, { name: 'iPhone 8' }, { name: 'iPhone 8 Plus' }, { name: 'iPhone X' },
  { name: 'iPhone XR' }, { name: 'iPhone XS' }, { name: 'iPhone XS Max' }, { name: 'iPhone 11' }, { name: 'iPhone 11 Pro', pro: 1 },
  { name: 'iPhone 11 Pro Max', pro: 1 }, { name: 'iPhone SE (2nd gen)' }, { name: 'iPhone 12 mini' }, { name: 'iPhone 12' }, { name: 'iPhone 12 Pro', pro: 1 },
  { name: 'iPhone 12 Pro Max', pro: 1 }, { name: 'iPhone 13 mini' }, { name: 'iPhone 13' }, { name: 'iPhone 13 Pro', pro: 1 }, { name: 'iPhone 13 Pro Max', pro: 1 },
  { name: 'iPhone SE (3rd gen)' }, { name: 'iPhone 14' }, { name: 'iPhone 14 Plus' }, { name: 'iPhone 14 Pro', pro: 1 }, { name: 'iPhone 14 Pro Max', pro: 1 },
  { name: 'iPhone 15' }, { name: 'iPhone 15 Plus' }, { name: 'iPhone 15 Pro', pro: 1 }, { name: 'iPhone 15 Pro Max', pro: 1 },
  { name: 'iPhone 16' }, { name: 'iPhone 16 Plus' }, { name: 'iPhone 16 Pro', pro: 1 }, { name: 'iPhone 16 Pro Max', pro: 1 },
  { name: 'iPhone 17' }, { name: 'iPhone 17 Pro', pro: 1 }, { name: 'iPhone 17 Pro Max', pro: 1 },
];
function phoneSVG(pro) {
  const body = pro ? '#20283a' : '#dfe6ec';
  return `<svg class="dev-ph" width="30" height="50" viewBox="0 0 30 50" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="28" height="48" rx="7.5" fill="${body}"/>
    <rect x="1.5" y="1.5" width="27" height="47" rx="7" stroke="rgba(0,0,0,.14)"/>
    <rect x="3.2" y="3.4" width="23.6" height="43.2" rx="5.6" fill="url(#${pro ? 'scrPro' : 'scrStd'})"/>
    <rect x="11" y="5.4" width="8" height="2.8" rx="1.4" fill="#0a0a0a"/>
  </svg>`;
}
function deviceChip(m) {
  return `<div class="dev-chip">${phoneSVG(m.pro)}<div><div class="dev-name">${m.name}</div><div class="dev-sub"><span class="ok">${I.checkCircle(12)}</span> Supported</div></div></div>`;
}
function deviceShowcase() {
  const mid = Math.ceil(IPHONE_MODELS.length / 2);
  const top = IPHONE_MODELS.slice(0, mid).map(deviceChip).join('');
  const bot = IPHONE_MODELS.slice(mid).map(deviceChip).join('');
  const carriers = ['AT&T', 'T-Mobile', 'Verizon', 'Vodafone', 'Orange', 'O2', 'EE', 'Telcel', 'Claro', 'Telstra', 'Rogers', 'SK Telecom'];
  return `<section class="section devices-section" id="devices">
    <svg width="0" height="0" style="position:absolute"><defs>
      <linearGradient id="scrStd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#1e40af"/></linearGradient>
      <linearGradient id="scrPro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c3a57"/><stop offset="1" stop-color="#0b1220"/></linearGradient>
    </defs></svg>
    <div class="container-x"><div style="text-align:center;max-width:660px;margin:0 auto 40px">
      <span class="eyebrow">${I.smartphone(14)} Compatibility</span>
      <h2 style="font-size:38px;margin:16px 0 12px">Supported devices</h2>
      <p class="muted" style="font-size:16px">Every iPhone from the iPhone 6 to the iPhone 17 Pro Max — across all iOS versions and 80+ carriers worldwide.</p>
    </div></div>
    <div class="marquee" style="margin-bottom:16px"><div class="marquee-track marquee-left">${top}${top}</div></div>
    <div class="marquee"><div class="marquee-track marquee-right">${bot}${bot}</div></div>
    <div class="container-x">
      <div style="text-align:center;margin-top:38px"><a href="#/dashboard/new-order" class="btn btn-primary btn-lg">Check your device ${I.arrowRight(16)}</a></div>
      <div class="carriers"><div class="muted" style="text-align:center;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:22px">Permanent factory unlocks across 80+ carriers</div>
        <div style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:30px 44px">${carriers.map(c => `<span class="carrier-logo">${c}</span>`).join('')}</div>
      </div>
    </div>
  </section>`;
}

/* ---- device picker tile/grid helpers (series + search) ---- */
function seriesTileHTML(s) {
  return `<div class="device-tile" data-series="${s.key}">
    <span style="color:var(--primary);display:block;margin-bottom:12px">${I.smartphone(26)}</span>
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:8px">
      <div><div style="font-weight:600;font-size:13.5px">${s.label}</div><div class="muted" style="font-size:11.5px">${s.variants.length} model${s.variants.length > 1 ? 's' : ''}</div></div>
      <span style="color:var(--muted-foreground)">${I.chevronRight(18)}</span>
    </div></div>`;
}
function deviceTileHTML(v) {
  return `<div class="device-tile ${WIZ.device === v.name ? 'selected' : ''}" data-device="${v.name}">
    <span class="check">${I.checkCircle(20)}</span>
    <span style="color:var(--primary);display:block;margin-bottom:10px">${I.smartphone(26)}</span>
    <div style="font-weight:600;font-size:13.5px">${v.name}</div><div class="muted" style="font-size:11.5px">${v.pro ? 'Pro · iOS 12–18' : 'iOS 12–18'}</div></div>`;
}
function deviceGridHTML() {
  const q = (WIZ.deviceQuery || '').trim().toLowerCase();
  if (q) {
    const matches = SERIES.flatMap(s => s.variants).filter(v => v.name.toLowerCase().includes(q));
    if (!matches.length) return `<div class="muted" style="grid-column:1/-1;text-align:center;padding:34px;font-size:13.5px">No models match your search.</div>`;
    return matches.map(deviceTileHTML).join('');
  }
  return SERIES.map(seriesTileHTML).join('');
}

/* ============================================================
   PRICING ENGINE (IDR, per-device)
   ============================================================ */
const ICLOUD = {
  'iPhone 6': 50000, 'iPhone 6 Plus': 60000, 'iPhone 6s': 70000, 'iPhone 6s Plus': 80000,
  'iPhone 7': 90000, 'iPhone 7 Plus': 110000, 'iPhone 8': 130000, 'iPhone 8 Plus': 150000,
  'iPhone X': 300000, 'iPhone XR': 350000, 'iPhone XS': 400000, 'iPhone XS Max': 450000,
  'iPhone 11': 500000, 'iPhone 11 Pro': 550000, 'iPhone 11 Pro Max': 600000,
  'iPhone 12 mini': 650000, 'iPhone 12': 700000, 'iPhone 12 Pro': 750000, 'iPhone 12 Pro Max': 800000,
  'iPhone 13 mini': 850000, 'iPhone 13': 900000, 'iPhone 13 Pro': 950000, 'iPhone 13 Pro Max': 1000000,
  'iPhone 14': 1050000, 'iPhone 14 Plus': 1100000, 'iPhone 14 Pro': 1150000, 'iPhone 14 Pro Max': 1200000,
  'iPhone 15': 1250000, 'iPhone 15 Plus': 1300000, 'iPhone 15 Pro': 1350000, 'iPhone 15 Pro Max': 1400000,
  'iPhone 16': 1450000, 'iPhone 16 Plus': 1450000, 'iPhone 16 Pro': 1450000, 'iPhone 16 Pro Max': 1450000,
  'iPhone 17': 1500000, 'iPhone 17 Pro': 1500000, 'iPhone 17 Pro Max': 1500000,
  'iPhone SE (1st gen)': 70000, 'iPhone SE (2nd gen)': 500000, 'iPhone SE (3rd gen)': 900000,
};
const CARRIER = { '6': 75000, 'se1': 75000, '7': 125000, '8': 175000, 'x': 250000, 'xrxs': 350000, '11': 450000, 'se2': 450000, '12': 600000, '13': 750000, 'se3': 750000, '14': 900000, '15': 1100000, '16': 1300000, '17': 1500000 };
const MDM = { '6': 100000, 'se1': 100000, '7': 150000, '8': 200000, 'x': 250000, 'xrxs': 350000, '11': 450000, 'se2': 450000, '12': 550000, '13': 700000, 'se3': 700000, '14': 850000, '15': 1000000, '16': 1250000, '17': 1500000 };
function seriesKeyOf(n) {
  if (!n) return '6';
  if (/SE \(1st/.test(n)) return 'se1';
  if (/SE \(2nd/.test(n)) return 'se2';
  if (/SE \(3rd/.test(n)) return 'se3';
  if (/ 17/.test(n)) return '17';
  if (/ 16/.test(n)) return '16';
  if (/ 15/.test(n)) return '15';
  if (/ 14/.test(n)) return '14';
  if (/ 13/.test(n)) return '13';
  if (/ 12/.test(n)) return '12';
  if (/ 11/.test(n)) return '11';
  if (/XR|XS/.test(n)) return 'xrxs';
  if (/ X$/.test(n)) return 'x';
  if (/ 8/.test(n)) return '8';
  if (/ 7/.test(n)) return '7';
  return '6';
}
function priceFor(svcId, device) {
  if (svcId === 'fmi') return 25000;
  if (svcId === 'icloud') {
    if (ICLOUD[device] != null) return ICLOUD[device];
    return ({ '16': 1450000, '17': 1500000 })[seriesKeyOf(device)] || 0;
  }
  const k = seriesKeyOf(device);
  if (svcId === 'carrier') return CARRIER[k] || 0;
  if (svcId === 'mdm') return MDM[k] || 0;
  return 0;
}
/* Admin display tables (match published price list) */
const TBL_ICLOUD = [
  ['iPhone 6', 50000], ['iPhone 6 Plus', 60000], ['iPhone 6s', 70000], ['iPhone 6s Plus', 80000],
  ['iPhone 7', 90000], ['iPhone 7 Plus', 110000], ['iPhone 8', 130000], ['iPhone 8 Plus', 150000],
  ['iPhone X', 300000], ['iPhone XR', 350000], ['iPhone XS', 400000], ['iPhone XS Max', 450000],
  ['iPhone 11', 500000], ['iPhone 11 Pro', 550000], ['iPhone 11 Pro Max', 600000],
  ['iPhone 12 mini', 650000], ['iPhone 12', 700000], ['iPhone 12 Pro', 750000], ['iPhone 12 Pro Max', 800000],
  ['iPhone 13 mini', 850000], ['iPhone 13', 900000], ['iPhone 13 Pro', 950000], ['iPhone 13 Pro Max', 1000000],
  ['iPhone 14', 1050000], ['iPhone 14 Plus', 1100000], ['iPhone 14 Pro', 1150000], ['iPhone 14 Pro Max', 1200000],
  ['iPhone 15', 1250000], ['iPhone 15 Plus', 1300000], ['iPhone 15 Pro', 1350000], ['iPhone 15 Pro Max', 1400000],
  ['iPhone 16 Series', 1450000], ['iPhone 17 Series', 1500000],
];
const TBL_CARRIER = [
  ['iPhone 6 – 6s Plus', 75000], ['iPhone 7 – 7 Plus', 125000], ['iPhone 8 – 8 Plus', 175000], ['iPhone X', 250000], ['iPhone XR / XS', 350000], ['iPhone 11 Series', 450000], ['iPhone 12 Series', 600000], ['iPhone 13 Series', 750000], ['iPhone 14 Series', 900000], ['iPhone 15 Series', 1100000], ['iPhone 16 Series', 1300000], ['iPhone 17 Series', 1500000],
];
const TBL_MDM = [
  ['iPhone 6 – 6s Plus', 100000], ['iPhone 7 – 7 Plus', 150000], ['iPhone 8 – 8 Plus', 200000], ['iPhone X', 250000], ['iPhone XR / XS', 350000], ['iPhone 11 Series', 450000], ['iPhone 12 Series', 550000], ['iPhone 13 Series', 700000], ['iPhone 14 Series', 850000], ['iPhone 15 Series', 1000000], ['iPhone 16 Series', 1250000], ['iPhone 17 Series', 1500000],
];
const TBL_FMI = [['FMI Check Basic', 25000], ['FMI Check Premium', 50000], ['FMI + GSX Report', 100000], ['FMI + Blacklist + Warranty', 150000]];
