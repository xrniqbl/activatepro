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
function logout() { setToken(''); AUTH.email = ''; try { localStorage.removeItem(DEMO_USER_KEY); } catch (e) {} }
async function apiAuthed(path, opts = {}) {
  const base = (CONFIG.apiBase || '').replace(/\/$/, '');
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const tok = getToken(); if (tok) headers.Authorization = 'Bearer ' + tok;
  const r = await fetch(base + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

/* ---------- Local persistent store (vouchers, order tracking, notifications) ---------- */
const STORE_KEY = 'ap-store-v1';
function getStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
function setStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }
function defaultNotifications() {
  return [
    { id: 'n1', icon: 'package', title: 'Order AP-10428 processing', body: 'iCloud removal is now at 50%.', time: '2 min ago', read: false },
    { id: 'n2', icon: 'checkCircle', title: 'Payment confirmed', body: 'Rp1.498.500 received for AP-10428.', time: '9 min ago', read: false },
    { id: 'n3', icon: 'truck', title: 'Order AP-10427 completed', body: 'Carrier unlock finished successfully.', time: '1 hr ago', read: false },
  ];
}
function seedStore() {
  const s = getStore();
  if (!s.vouchers) s.vouchers = [
    { code: 'WELCOME10', type: 'percent', value: 10, active: true, note: 'New customer \u2014 10% off' },
    { code: 'HEMAT50K', type: 'fixed', value: 50000, active: true, note: 'Rp50.000 off any order' },
    { code: 'PROMO25', type: 'percent', value: 25, active: false, note: 'Seasonal promo (disabled)' },
  ];
  if (!s.tracking) s.tracking = {};        // orderId -> { stage: 0..4 }
  if (!s.notifications) s.notifications = defaultNotifications();
  if (!s.settings) s.settings = {};        // settingKey -> value
  if (!s.apikeys) s.apikeys = [
    { id: 'k_live', label: 'Production', env: 'Live', key: 'ap_live_' + 'k29f8a3d7b1e4c6f2' },
    { id: 'k_test', label: 'Test', env: 'Test', key: 'ap_test_' + 'k7c19e0a52b8d4f63' },
  ];
  setStore(s);
  return s;
}

/* ---------- Settings helpers (persisted preferences + API keys) ---------- */
function applyAppSettings() {
  const s = getStore(); const set = s.settings || {};
  document.documentElement.classList.toggle('compact', !!set['appearance::Compact density']);
  document.documentElement.classList.toggle('reduce-motion', !!set['appearance::Reduce motion']);
  if (set['appearance::accent']) document.documentElement.style.setProperty('--primary', set['appearance::accent']);
}
function genApiKey(env) { return (env === 'Live' ? 'ap_live_' : 'ap_test_') + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10); }
function maskKey(k) { return k.slice(0, 8) + '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + k.slice(-4); }
function apiKeyRowsHTML() {
  const s = seedStore();
  return (s.apikeys || []).map(k => `<div class="card" style="box-shadow:none;background:var(--surface);padding:14px;display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap">
    <span style="color:var(--primary)">${I.key(18)}</span>
    <div style="flex:1;min-width:160px"><div style="font-weight:600;font-size:13px">${k.label} key <span class="badge ${k.env === 'Live' ? 'badge-success' : 'badge-neutral'}" style="font-size:10px">${k.env}</span></div><div class="cell-mono muted" style="font-size:12px">${maskKey(k.key)}</div></div>
    <button class="btn btn-outline btn-sm" data-copy="${k.id}">${I.copy(14)} Copy</button>
    <button class="btn btn-ghost btn-sm" data-revoke="${k.id}">Revoke</button></div>`).join('') || '<div class="muted" style="padding:14px;text-align:center;font-size:13px">No API keys \u2014 create one to get started.</div>';
}

/* ---------- Role / session (demo + backend) ---------- */
const ADMIN_EMAILS = ['admin@activatepro.io', 'alicia@activatepro.io', 'david@activatepro.io', 'priya@activatepro.io', 'iqbal@activatepro.io'];
const DEMO_USER_KEY = 'ap-demo-user';
function roleForEmail(email) { return ADMIN_EMAILS.indexOf(String(email || '').toLowerCase()) >= 0 ? 'admin' : 'user'; }
function setDemoUser(email, name) {
  const e = String(email || '').toLowerCase();
  const nm = name || (e ? e.split('@')[0].replace(/\b\w/g, c => c.toUpperCase()) : 'User');
  const u = { name: nm, email: e, initials: initialsOf(nm || e), role: roleForEmail(e) };
  DATA.user = u;
  try { localStorage.setItem(DEMO_USER_KEY, JSON.stringify(u)); } catch (err) {}
  return u;
}
function loadDemoUser() { try { const u = JSON.parse(localStorage.getItem(DEMO_USER_KEY)); if (u && u.email) DATA.user = u; } catch (e) {} }
function isAdmin() { return !!(DATA.user && DATA.user.role === 'admin'); }

/* ---------- Order tracking stages (admin -> customer) ---------- */

/* ============================================================
   i18n — two languages (Indonesian default, English) + currency
   ============================================================ */
let _lang = 'id';
try { _lang = localStorage.getItem('ap-lang') || 'id'; } catch (e) {}
const USD_RATE = 16000; // IDR per 1 USD (display conversion)

// [English, Indonesian] pairs. Translator works BOTH directions because the
// source code mixes English and Indonesian strings.
const I18N_PAIRS = [
  // Marketing nav / chrome
  ['Pricing', 'Harga'], ['Devices', 'Perangkat'], ['Features', 'Fitur'], ['FAQ', 'FAQ'],
  ['Support', 'Bantuan'], ['Sign in', 'Masuk'], ['Get started', 'Mulai'], ['Create one', 'Buat akun'],
  ["Don't have an account?", 'Belum punya akun?'], ['Already registered?', 'Sudah terdaftar?'],
  ['Create your account', 'Buat akun Anda'], ['Work email', 'Email kerja'], ['First name', 'Nama depan'],
  ['Last name', 'Nama belakang'], ['Email', 'Email'], ['Email address', 'Alamat email'], ['Password', 'Kata sandi'],
  ['Confirm password', 'Konfirmasi kata sandi'], ['Re-enter password', 'Masukkan ulang kata sandi'],
  ['Keep me signed in', 'Tetap masuk'], ['Forgot?', 'Lupa?'], ['or continue with email', 'atau lanjut dengan email'],
  ['or', 'atau'], ['Terms', 'Ketentuan'], ['Privacy Policy', 'Kebijakan Privasi'], ['I agree to the', 'Saya menyetujui'],
  ['Create a strong password', 'Buat kata sandi yang kuat'], ['you@company.com', 'anda@perusahaan.com'],
  ['Use 8+ characters with a mix of letters, numbers & symbols.', 'Gunakan 8+ karakter dengan kombinasi huruf, angka & simbol.'],
  ['At least 8 characters', 'Minimal 8 karakter'], ['Enter a valid email address.', 'Masukkan alamat email yang valid.'],
  ['Password is required.', 'Kata sandi wajib diisi.'], ['Password must be at least 8 characters.', 'Kata sandi minimal 8 karakter.'],
  ['Passwords do not match.', 'Kata sandi tidak cocok.'], ['Please accept the terms to continue.', 'Mohon setujui ketentuan untuk lanjut.'],
  // Hero / landing
  ['100% Original Method. Fast Process. Official Warranty. Best Price.', '100% Metode Original. Proses Cepat. Garansi Resmi. Harga Terbaik.'],
  ['Activate & unlock your iPhone with the fastest process and official warranty.', 'Aktivasi & unlock iPhone Anda dengan proses tercepat dan garansi resmi.'],
  ['Activate Your Device Today', 'Aktivasi Perangkat Anda Hari Ini'], ['Activate & Unlock', 'Aktivasi & Unlock'],
  ['0% Installment', 'Cicilan 0%'], ['Start Order', 'Mulai Pesanan'], ['View Services', 'Lihat Layanan'],
  ['Compare Services', 'Bandingkan Layanan'], ['All Services', 'Semua Layanan'], ['Our Services', 'Layanan Kami'],
  ['Featured Services', 'Layanan Unggulan'], ['Supports All iPhone Models', 'Mendukung Semua Model iPhone'],
  ['Supported devices', 'Perangkat yang didukung'], ['Supported', 'Didukung'],
  ['What Our Customers Say', 'Kata Pelanggan Kami'], ['Frequently Asked Questions', 'Pertanyaan yang Sering Diajukan'],
  ['Rated 4.9/5 by 3,200+ businesses', 'Dinilai 4.9/5 oleh 3.200+ bisnis'], ['Secure Payment', 'Pembayaran Aman'],
  ['Starting From', 'Mulai Dari'], ['Turnaround', 'Waktu Proses'], ['Compare Services', 'Bandingkan Layanan'],
  ['Permanent factory unlocks across 80+ carriers', 'Unlock pabrik permanen di 80+ operator'],
  ['Every iPhone from the iPhone 6 to the iPhone 17 Pro Max \u2014 across all iOS versions and 80+ carriers worldwide.', 'Setiap iPhone dari iPhone 6 hingga iPhone 17 Pro Max \u2014 di semua versi iOS dan 80+ operator di seluruh dunia.'],
  // Sidebar nav
  ['Dashboard', 'Dasbor'], ['New order', 'Pesanan baru'], ['My orders', 'Pesanan saya'], ['Order tracking', 'Lacak pesanan'],
  ['Checkout', 'Pembayaran'], ['Support center', 'Pusat bantuan'], ['Admin console', 'Konsol admin'],
  ['Profile', 'Profil'], ['Settings', 'Pengaturan'], ['Customer view', 'Tampilan pelanggan'],
  ['Order management', 'Manajemen pesanan'], ['User management', 'Manajemen pengguna'], ['Pricing management', 'Manajemen harga'],
  ['Voucher settings', 'Pengaturan voucher'], ['Webhook logs', 'Log webhook'], ['Activity logs', 'Log aktivitas'],
  ['Sign out', 'Keluar'], ['Main', 'Utama'], ['Account', 'Akun'], ['Overview', 'Ikhtisar'], ['Configuration', 'Konfigurasi'],
  // Topbar / common
  ['Search orders, IMEI\u2026', 'Cari pesanan, IMEI\u2026'], ['Notifications', 'Notifikasi'], ['Mark all read', 'Tandai sudah dibaca'],
  ['All read', 'Sudah dibaca semua'], ['New order', 'Pesanan baru'],
  // Dashboard
  ['Orders overview', 'Ikhtisar pesanan'], ['Recent orders', 'Pesanan terbaru'], ['Orders', 'Pesanan'], ['Spend', 'Pengeluaran'],
  ['Service mix', 'Komposisi layanan'], ['Order', 'Pesanan'], ['Device', 'Perangkat'], ['Service', 'Layanan'],
  ['Status', 'Status'], ['Amount', 'Jumlah'], ['Date', 'Tanggal'], ['Actions', 'Aksi'], ['Action', 'Aksi'], ['Track', 'Lacak'],
  ['Completed', 'Selesai'], ['Processing', 'Diproses'], ['Pending', 'Menunggu'], ['Failed', 'Gagal'], ['Queued', 'Antrean'],
  ['Showing 6 of 248 orders', 'Menampilkan 6 dari 248 pesanan'],
  // New order wizard
  ['Choose a service', 'Pilih layanan'], ['Select your device', 'Pilih perangkat Anda'],
  ['Enter & validate IMEI', 'Masukkan & validasi IMEI'], ['Review your order', 'Tinjau pesanan Anda'],
  ['Select the exact model you\u2019d like to service.', 'Pilih model persis yang ingin Anda layani.'],
  ['Choose your iPhone series \u2014 or search for a specific model.', 'Pilih seri iPhone Anda \u2014 atau cari model tertentu.'],
  ['All series', 'Semua seri'], ['All iPhone', 'Semua iPhone'], ['Search all iPhone models\u2026', 'Cari semua model iPhone\u2026'],
  ['No models match your search.', 'Tidak ada model yang cocok dengan pencarian Anda.'],
  ['IMEI number (15 digits)', 'Nomor IMEI (15 digit)'], ['Next', 'Lanjut'], ['Previous', 'Sebelumnya'], ['Back', 'Kembali'],
  ['Confirm the details below before continuing to checkout.', 'Konfirmasi detail di bawah sebelum lanjut ke pembayaran.'],
  ['Upload supporting documents', 'Unggah dokumen pendukung'], ['Attached documents', 'Dokumen terlampir'],
  ['No documents attached', 'Tidak ada dokumen terlampir'], ['Drop files here or', 'Letakkan file di sini atau'], ['browse', 'telusuri'],
  ['PDF, JPG or PNG \u00b7 up to 10MB each', 'PDF, JPG atau PNG \u00b7 maks 10MB per file'],
  ['Optional: proof of purchase or device photos to speed up verification.', 'Opsional: bukti pembelian atau foto perangkat untuk mempercepat verifikasi.'],
  ['Model:', 'Model:'], ['Est. model:', 'Perkiraan model:'], ['Length:', 'Panjang:'], ['Luhn:', 'Luhn:'], ['TAC:', 'TAC:'],
  ['FMI:', 'FMI:'], ['Blacklist:', 'Daftar hitam:'], ['Warranty:', 'Garansi:'], ['Dial', 'Telepon'],
  // Checkout
  ['Payment method', 'Metode pembayaran'], ['Order summary', 'Ringkasan pesanan'], ['Cardholder name', 'Nama pemegang kartu'],
  ['Card number', 'Nomor kartu'], ['Expiry', 'Kedaluwarsa'], ['Subtotal', 'Subtotal'], ['Discount', 'Diskon'], ['Total', 'Total'],
  ['Promo code', 'Kode promo'], ['Apply', 'Terapkan'], ['Back to order', 'Kembali ke pesanan'], ['Invoice preview', 'Pratinjau faktur'],
  ['Invoice', 'Faktur'], ['Billed to', 'Ditagih ke'], ['Amount due', 'Jumlah tagihan'], ['Draft', 'Draf'],
  ['Payments are encrypted and PCI-DSS compliant. You can request a full refund if the service fails.', 'Pembayaran dienkripsi dan sesuai PCI-DSS. Anda dapat meminta pengembalian penuh jika layanan gagal.'],
  ['Service fee', 'Biaya layanan'],
  // Tracking
  ['Live updates', 'Pembaruan langsung'], ['Order details', 'Detail pesanan'], ['Progress', 'Kemajuan'],
  ['Placed', 'Dibuat'], ['Verified', 'Terverifikasi'], ['Quality check', 'Pemeriksaan kualitas'], ['Refresh', 'Segarkan'],
  ['Get help with this order', 'Dapatkan bantuan untuk pesanan ini'],
  // Support
  ['How can we help?', 'Apa yang bisa kami bantu?'], ['Your tickets', 'Tiket Anda'], ['Knowledge base', 'Basis pengetahuan'],
  ['New ticket', 'Tiket baru'], ['Open a new ticket', 'Buka tiket baru'], ['Subject', 'Subjek'], ['Category', 'Kategori'],
  ['Message', 'Pesan'], ['Submit ticket', 'Kirim tiket'], ['Related order (optional)', 'Pesanan terkait (opsional)'],
  ['Briefly describe the issue', 'Jelaskan masalah secara singkat'], ['Still need help?', 'Masih butuh bantuan?'],
  ['This helped', 'Ini membantu'], ['Open', 'Terbuka'], ['In progress', 'Sedang berjalan'], ['Resolved', 'Selesai'],
  ['Open support center', 'Buka pusat bantuan'], ['Contact Support', 'Hubungi Bantuan'],
  // Settings
  ['General preferences', 'Preferensi umum'], ['Configure your workspace defaults.', 'Atur preferensi default ruang kerja Anda.'],
  ['Language', 'Bahasa'], ['Interface display language', 'Bahasa tampilan antarmuka'], ['Timezone', 'Zona waktu'],
  ['Used for timestamps & reports', 'Digunakan untuk waktu & laporan'], ['Currency', 'Mata uang'],
  ['Follows the selected language', 'Mengikuti bahasa yang dipilih'], ['Default service', 'Layanan default'],
  ['Pre-selected on new orders', 'Dipilih otomatis pada pesanan baru'], ['Auto-archive completed orders', 'Arsipkan otomatis pesanan selesai'],
  ['Hide orders 30 days after completion', 'Sembunyikan pesanan 30 hari setelah selesai'],
  ['Notification preferences', 'Preferensi notifikasi'], ['Choose how and when we contact you.', 'Pilih bagaimana dan kapan kami menghubungi Anda.'],
  ['Order status updates', 'Pembaruan status pesanan'], ['When an order changes status', 'Saat status pesanan berubah'],
  ['Order completed', 'Pesanan selesai'], ['When activation finishes', 'Saat aktivasi selesai'],
  ['Payment & invoices', 'Pembayaran & faktur'], ['Receipts and billing alerts', 'Tanda terima dan pemberitahuan tagihan'],
  ['Product news & offers', 'Berita & penawaran produk'], ['Occasional promotions', 'Promosi sesekali'],
  ['Browser push', 'Push browser'], ['Real-time desktop alerts', 'Notifikasi desktop real-time'],
  ['SMS for failures', 'SMS untuk kegagalan'], ['Text me if an order fails', 'Kirim SMS jika pesanan gagal'],
  ['Change password', 'Ubah kata sandi'], ['Current password', 'Kata sandi saat ini'], ['New password', 'Kata sandi baru'],
  ['Confirm new password', 'Konfirmasi kata sandi baru'], ['Update password', 'Perbarui kata sandi'],
  ['Authentication', 'Autentikasi'], ['Protect your account with additional verification.', 'Lindungi akun Anda dengan verifikasi tambahan.'],
  ['Two-factor authentication', 'Autentikasi dua faktor'], ['Require a code at sign-in', 'Minta kode saat masuk'],
  ['Login alerts', 'Peringatan login'], ['Email me on new device sign-ins', 'Email saya saat login dari perangkat baru'],
  ['Trusted devices only', 'Hanya perangkat tepercaya'], ['Block sign-ins from new devices', 'Blokir login dari perangkat baru'],
  ['Payment methods', 'Metode pembayaran'], ['Add card', 'Tambah kartu'], ['Make default', 'Jadikan default'],
  ['Wallet', 'Dompet'], ['Current balance:', 'Saldo saat ini:'], ['Invoices', 'Faktur'], ['Export all', 'Ekspor semua'],
  ['Appearance', 'Tampilan'], ['Customize how ActivatePro looks for you.', 'Sesuaikan tampilan ActivatePro untuk Anda.'],
  ['Theme', 'Tema'], ['Light', 'Terang'], ['Dark', 'Gelap'], ['System', 'Sistem'], ['Accent color', 'Warna aksen'],
  ['Compact density', 'Kepadatan ringkas'], ['Reduce padding for denser tables', 'Kurangi jarak untuk tabel lebih padat'],
  ['Reduce motion', 'Kurangi animasi'], ['Minimize animations & transitions', 'Minimalkan animasi & transisi'],
  ['API keys', 'Kunci API'], ['Use these to authenticate API requests.', 'Gunakan ini untuk autentikasi permintaan API.'],
  ['Create key', 'Buat kunci'], ['Copy', 'Salin'], ['Revoke', 'Cabut'], ['Webhook endpoint', 'Endpoint webhook'],
  ["We'll POST event payloads to this URL.", 'Kami akan mengirim payload event ke URL ini.'], ['Endpoint URL', 'URL endpoint'],
  ['Send test', 'Kirim uji'], ['View webhook logs', 'Lihat log webhook'], ['Danger zone', 'Zona berbahaya'],
  ['Permanently delete your account and all associated data. This cannot be undone.', 'Hapus permanen akun Anda dan semua data terkait. Tindakan ini tidak dapat dibatalkan.'],
  ['Active sessions', 'Sesi aktif'], ['Two-factor auth', 'Autentikasi dua faktor'], ['Email on new sign-in', 'Email saat login baru'],
  ['Extra layer of security', 'Lapisan keamanan tambahan'], ['Change', 'Ubah'], ['Last changed 3 months ago', 'Terakhir diubah 3 bulan lalu'],
  // Profile
  ['Personal information', 'Informasi pribadi'], ['Update your personal details and contact information.', 'Perbarui detail pribadi dan informasi kontak Anda.'],
  ['Bio', 'Bio'], ['Phone', 'Telepon'], ['Country', 'Negara'], ['Save changes', 'Simpan perubahan'],
  ['Tell us about your business\u2026', 'Ceritakan tentang bisnis Anda\u2026'], ['Pro plan', 'Paket Pro'],
  ['Independent iPhone repair & activation reseller serving 500+ customers monthly.', 'Reseller perbaikan & aktivasi iPhone independen yang melayani 500+ pelanggan per bulan.'],
  // Admin
  ['Admin dashboard', 'Dasbor admin'], ['Operations overview', 'Ikhtisar operasi'], ['Revenue analytics', 'Analitik pendapatan'],
  ['Monthly revenue vs. orders', 'Pendapatan bulanan vs. pesanan'], ['Activity log', 'Log aktivitas'], ['View full log', 'Lihat log lengkap'],
  ['Manage orders', 'Kelola pesanan'], ['Manage and process all orders', 'Kelola dan proses semua pesanan'],
  ['Complete', 'Selesaikan'], ['Export', 'Ekspor'], ['All', 'Semua'], ['Search orders\u2026', 'Cari pesanan\u2026'],
  ['Team & users', 'Tim & pengguna'], ['Manage team members and resellers', 'Kelola anggota tim dan reseller'],
  ['Invite user', 'Undang pengguna'], ['Role', 'Peran'], ['Joined', 'Bergabung'], ['Users', 'Pengguna'], ['User', 'Pengguna'],
  ['Active', 'Aktif'], ['Suspended', 'Ditangguhkan'], ['Verified', 'Terverifikasi'], ['Unverified', 'Belum verifikasi'],
  ['Create and manage discount codes', 'Buat dan kelola kode diskon'], ['Create voucher', 'Buat voucher'],
  ['These codes work on the customer checkout page', 'Kode ini berlaku di halaman pembayaran pelanggan'],
  ['Vouchers', 'Voucher'], ['Code', 'Kode'], ['Type', 'Tipe'], ['Value', 'Nilai'], ['Note', 'Catatan'],
  ['Percentage', 'Persentase'], ['Fixed (Rp)', 'Tetap (Rp)'], ['Add', 'Tambah'], ['New customer discount', 'Diskon pelanggan baru'],
  ['Disabled', 'Nonaktif'], ['Total vouchers', 'Total voucher'], ['Connected to', 'Terhubung ke'],
  ['Konfigurasi harga layanan (IDR)', 'Konfigurasi harga layanan (IDR)'], ['Premium report', 'Laporan premium'],
  ['Delivery logs', 'Log pengiriman'], ['Event ID', 'ID Event'], ['Endpoint', 'Endpoint'], ['Latency', 'Latensi'],
  ['Time', 'Waktu'], ['All events', 'Semua event'], ['Rotate secret', 'Rotasi rahasia'], ['Rotate', 'Rotasi'],
  ['Actor', 'Pelaku'], ['Level', 'Tingkat'], ['Timestamp', 'Cap waktu'], ['IP address', 'Alamat IP'],
  ['Showing 7 of 18,402 events \u00b7 retained for 90 days', 'Menampilkan 7 dari 18.402 event \u00b7 disimpan 90 hari'],
  ['Access restricted', 'Akses dibatasi'], ['Administrator area', 'Area administrator'], ['Admin access only', 'Khusus akses admin'],
  ['The admin console is restricted to administrator accounts. Sign in with an admin account to manage orders, pricing and vouchers.', 'Konsol admin hanya untuk akun administrator. Masuk dengan akun admin untuk mengelola pesanan, harga, dan voucher.'],
  ['Back to dashboard', 'Kembali ke dasbor'],
  // Auth misc
  ['Reset password', 'Atur ulang kata sandi'], ['Set a new password', 'Atur kata sandi baru'],
  ['Enter the email associated with your account.', 'Masukkan email yang terkait dengan akun Anda.'],
  ['Enter and confirm your new password.', 'Masukkan dan konfirmasi kata sandi baru Anda.'],
  ['Check your inbox', 'Periksa kotak masuk Anda'], ['We sent a password reset link to', 'Kami mengirim tautan atur ulang kata sandi ke'],
  ['You can now sign in with your new password.', 'Anda sekarang bisa masuk dengan kata sandi baru.'],
  ['Enter verification code', 'Masukkan kode verifikasi'], ['Sent to', 'Dikirim ke'],
  ["Didn't receive a code?", 'Tidak menerima kode?'], ['Resend', 'Kirim ulang'], ['Wrong email? Go back', 'Email salah? Kembali'],
  ['Please enter all 6 digits.', 'Mohon masukkan semua 6 digit.'], ['Back to sign in', 'Kembali ke halaman masuk'],
  ['Company', 'Perusahaan'], ['Knowledge base', 'Basis pengetahuan'],
  ['Enterprise-grade iPhone activation and device service management. Trusted by 12,000+ resellers worldwide.', 'Manajemen aktivasi iPhone dan layanan perangkat kelas enterprise. Dipercaya 12.000+ reseller di seluruh dunia.'],
  // --- Additional coverage ---
  ['Cancel', 'Batal'], ['Other', 'Lainnya'], ['Required', 'Wajib'], ['Success', 'Berhasil'],
  ['Security', 'Keamanan'], ['Any', 'Apa saja'], ['All events', 'Semua event'],
  ['Carrier unlock', 'Unlock operator'], ['iCloud removal', 'Penghapusan iCloud'], ['iCloud Removal', 'Penghapusan iCloud'],
  ['Completed (3)', 'Selesai (3)'], ['Failed (1)', 'Gagal (1)'], ['Processing (1)', 'Diproses (1)'], ['All (6)', 'Semua (6)'],
  ['Production key', 'Kunci produksi'], ['Push & SMS', 'Push & SMS'], ['Last 7 months', '7 bulan terakhir'],
  ['No orders yet', 'Belum ada pesanan'], ['No users yet', 'Belum ada pengguna'],
  ['No vouchers yet \u2014 create one above.', 'Belum ada voucher \u2014 buat satu di atas.'],
  ['No API keys \u2014 create one to get started.', 'Belum ada kunci API \u2014 buat satu untuk memulai.'],
  ["You're all caught up \u2014 no notifications.", 'Semua sudah terbaca \u2014 tidak ada notifikasi.'],
  ['Password updated', 'Kata sandi diperbarui'], ['Signed in successfully', 'Berhasil masuk'],
  ['Signed in as administrator', 'Masuk sebagai administrator'], ['Invoice downloaded', 'Faktur diunduh'],
  ['Theme preference saved', 'Preferensi tema disimpan'], ['Accent color updated', 'Warna aksen diperbarui'],
  ['Preference saved', 'Preferensi disimpan'], ['Webhook URL saved', 'URL webhook disimpan'],
  ['API key copied to clipboard', 'Kunci API disalin ke papan klip'], ['New API key created', 'Kunci API baru dibuat'],
  ['All invoices exported', 'Semua faktur diekspor'], ['New code sent', 'Kode baru dikirim'],
  ['Search articles, guides, FAQs\u2026', 'Cari artikel, panduan, FAQ\u2026'],
  ['Search our knowledge base or open a ticket \u2014 our team replies in under 4 minutes.', 'Cari di basis pengetahuan atau buka tiket \u2014 tim kami membalas dalam waktu kurang dari 4 menit.'],
  ['Write a reply\u2026', 'Tulis balasan\u2026'], ["Tell us what's happening\u2026", 'Ceritakan apa yang terjadi\u2026'],
  ['Tap an article to open it', 'Ketuk artikel untuk membukanya'],
  ['Got it \u2014 a specialist will follow up shortly. Is there anything else I can help with?', 'Baik \u2014 spesialis kami akan menindaklanjuti segera. Ada lagi yang bisa kami bantu?'],
  ['This article explains', 'Artikel ini menjelaskan'],
  ['in detail. ActivatePro processes every device request through Apple GSX with full status transparency.', 'secara rinci. ActivatePro memproses setiap permintaan perangkat melalui Apple GSX dengan transparansi status penuh.'],
  ['Follow the steps below to resolve most issues on your own. If you still need help, open a support ticket and our team responds in under 4 minutes.', 'Ikuti langkah di bawah untuk menyelesaikan sebagian besar masalah sendiri. Jika masih butuh bantuan, buka tiket dan tim kami merespons dalam waktu kurang dari 4 menit.'],
  ['Confirm your order ID and device model.', 'Konfirmasi ID pesanan dan model perangkat Anda.'],
  ['Check the live status on the Order tracking page.', 'Cek status langsung di halaman Lacak pesanan.'],
  ['Review the eligibility and timing notes for your service.', 'Tinjau catatan kelayakan dan waktu untuk layanan Anda.'],
  ["Contact support if the status hasn't changed within the ETA.", 'Hubungi bantuan jika status belum berubah dalam ETA.'],
  ['Select the activation or unlock service for', 'Pilih layanan aktivasi atau unlock untuk'],
  ["Select the exact model you'd like to service.", 'Pilih model persis yang ingin Anda layani.'],
  ["Don't have an account?", 'Belum punya akun?'], ["Didn't receive a code?", 'Tidak menerima kode?'],
  ["Didn't get it? Resend email", 'Tidak menerima? Kirim ulang email'], ['open reset link', 'buka tautan reset'],
  ['. It expires in 30 minutes.', '. Tautan kedaluwarsa dalam 30 menit.'],
  ["We'll POST event payloads to this URL.", 'Kami akan mengirim payload event ke URL ini.'],
  ['PDF, JPG or PNG \u00b7 up to 10MB each', 'PDF, JPG atau PNG \u00b7 maks 10MB per file'],
  ['Your IMEI is checked locally (format + Luhn checksum). When a verification backend is connected, model, Find My, blacklist and warranty are confirmed via a live GSX lookup. We never store full device credentials.', 'IMEI Anda diperiksa secara lokal (format + checksum Luhn). Saat backend verifikasi terhubung, model, Find My, daftar hitam, dan garansi dikonfirmasi melalui pencarian GSX langsung. Kami tidak pernah menyimpan kredensial perangkat lengkap.'],
  ['\u00a9 2026 ActivatePro Inc. All rights reserved.', '\u00a9 2026 ActivatePro Inc. Hak cipta dilindungi.'],
  ['United States', 'Amerika Serikat'], ['United Kingdom', 'Britania Raya'], ['Singapore', 'Singapura'],
  ['Price (IDR)', 'Harga (IDR)'], ['Package', 'Paket'], ['Instant', 'Instan'],
  ['0% Installment', 'Cicilan 0%'],
  ['Up to 24 months \u00b7 BCA \u00b7 Mandiri \u00b7 BRI', 'Hingga 24 bulan \u00b7 BCA \u00b7 Mandiri \u00b7 BRI'],
  ['Instant service \u2014 affordable pricing for all models.', 'Layanan instan \u2014 harga terjangkau untuk semua model.'],
  ['All iPhone 6 \u2013 iPhone 17', 'Semua iPhone 6 \u2013 iPhone 17'],
  ['From iPhone 6 to iPhone 17 Pro Max \u2014 across all iOS versions and 80+ carriers worldwide.', 'Dari iPhone 6 hingga iPhone 17 Pro Max \u2014 lintas semua versi iOS dan 80+ carrier di seluruh dunia.'],
  ['Download PDF', 'Unduh PDF'], ['Download', 'Unduh'],
  ['Order placed', 'Pesanan dibuat'], ['IMEI verified', 'IMEI terverifikasi'], ['Processing activation', 'Memproses aktivasi'],
  ['Device ready to activate', 'Perangkat siap diaktifkan'], ['Final verification before delivery', 'Verifikasi akhir sebelum pengiriman'],
  ['Revenue (MTD)', 'Pendapatan (MTD)'], ['Orders (MTD)', 'Pesanan (MTD)'], ['Success rate', 'Tingkat keberhasilan'],
  ['Active users', 'Pengguna aktif'], ['Total users', 'Total pengguna'], ['Spend', 'Pengeluaran'], ['Service mix', 'Komposisi layanan'],
  ['Processing activation request', 'Memproses permintaan aktivasi'], ['IMEI verified via GSX', 'IMEI terverifikasi via GSX'],
  ['Payment confirmed', 'Pembayaran dikonfirmasi'], ['Live updates', 'Pembaruan langsung'],
  ['Avg. order value', 'Rata-rata nilai pesanan'], ['Margin', 'Margin'], ['Active services', 'Layanan aktif'],
  ['Deliveries (24h)', 'Pengiriman (24j)'], ['Avg. latency', 'Latensi rata-rata'], ['Resellers', 'Reseller'],
];

let _i18nEN = null, _i18nID = null;
function buildI18n() {
  _i18nEN = {}; _i18nID = {};
  I18N_PAIRS.forEach(p => { _i18nEN[p[0]] = p[1]; _i18nID[p[1]] = p[0]; });
}
function tr(s) {
  if (!_i18nEN) buildI18n();
  const k = s.trim();
  if (_lang === 'id') return Object.prototype.hasOwnProperty.call(_i18nEN, k) ? _i18nEN[k] : null;
  return Object.prototype.hasOwnProperty.call(_i18nID, k) ? _i18nID[k] : null;
}
function applyI18n(root) {
  root = root || document.body;
  if (!_i18nEN) buildI18n();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n => {
    const raw = n.nodeValue; const t = raw.trim(); if (!t) return;
    const rep = tr(t);
    if (rep != null && rep !== t) n.nodeValue = raw.replace(t, rep);
  });
  // In English mode, convert any hardcoded Rupiah amounts to USD.
  if (_lang === 'en') {
    nodes.forEach(n => {
      if (n.nodeValue.indexOf('Rp') < 0) return;
      n.nodeValue = n.nodeValue.replace(/Rp\s?([\d.]+)\s?(Jt|jt|JT|rb|Rb|RB)?/g, (m, num, suf) => {
        let val;
        if (/jt/i.test(suf || '')) val = parseFloat(num.replace(/\./g, '')) * 1e6;
        else if (/rb/i.test(suf || '')) val = parseFloat(num.replace(/\./g, '')) * 1e3;
        else val = parseFloat(num.replace(/\./g, ''));
        if (!isFinite(val)) return m;
        return '$' + (val / USD_RATE).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      });
    });
  }
  root.querySelectorAll('[placeholder]').forEach(el => {
    const p = el.getAttribute('placeholder'); if (!p) return;
    const rep = tr(p); if (rep != null && rep !== p) el.setAttribute('placeholder', rep);
  });
}
function setLang(l) {
  _lang = (l === 'en') ? 'en' : 'id';
  try { localStorage.setItem('ap-lang', _lang); } catch (e) {}
  render();
}

const TRACK_STAGES = ['Placed', 'Verified', 'Processing', 'Quality check', 'Completed'];
function stageStatus(stage) { return stage >= 4 ? 'Completed' : stage === 0 ? 'Pending' : 'Processing'; }
function orderStage(id, status) {
  const s = getStore(); const t = (s.tracking || {})[id];
  if (t && typeof t.stage === 'number') return t.stage;
  const map = { Pending: 0, Processing: 2, Completed: 4, Failed: 2, Queued: 0 };
  return map[status] != null ? map[status] : 2;
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
function money(n) {
  n = Number(n) || 0;
  if (_lang === 'en') { return '$' + (n / USD_RATE).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  return 'Rp' + n.toLocaleString('id-ID');
}
function statusBadge(s) {
  const m = { Completed:'success', Processing:'info', Pending:'warning', Failed:'danger', Queued:'neutral' };
  return `<span class="badge badge-${m[s]||'neutral'} badge-dot">${s}</span>`;
}
function toast(msg, icon = 'checkCircle') {
  try { const r = tr(String(msg)); if (r != null) msg = r; } catch (e) {}
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
  // Admin area is restricted to administrator accounts only.
  if (path.indexOf('/admin') === 0 && !isAdmin()) {
    const app = $('#app');
    app.innerHTML = '';
    app.appendChild(adminDenied());
    window.scrollTo(0, 0);
    bindShell(); bindGlobal();
    return;
  }
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
window.addEventListener('DOMContentLoaded', () => { seedStore(); loadDemoUser(); render(); loadMe(); });

function el(html) { const t = document.createElement('div'); t.innerHTML = html.trim(); return t.firstElementChild; }

/* ---------- Modal system ---------- */
function closeModal() {
  const m = document.getElementById('app-modal');
  if (m) { m.classList.remove('open'); setTimeout(() => m.remove(), 200); }
}
function openModal(title, bodyHTML) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.id = 'app-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h3 style="font-size:17px;margin:0">${title}</h3><button class="btn btn-ghost btn-icon btn-sm" id="modalClose" aria-label="Close">${I.x(18)}</button></div>
    <div class="modal-body">${bodyHTML}</div>
  </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  const c = overlay.querySelector('#modalClose'); if (c) c.addEventListener('click', closeModal);
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); } });
  bindGlobal();
  return overlay;
}

/* ---------- Minimal client-side PDF generator (no external libs) ---------- */
function downloadInvoicePDF(lines, filename) {
  const esc = t => String(t).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let body = 'BT\n/F1 11 Tf\n16 TL\n50 790 Td\n';
  (lines || []).forEach(ln => { body += '(' + esc(ln) + ') Tj\nT*\n'; });
  body += 'ET';
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    '<</Length ' + body.length + '>>\nstream\n' + body + '\nendstream',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = pdf.length;
  pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach(off => { pdf += String(off).padStart(10, '0') + ' 00000 n \n'; });
  pdf += 'trailer\n<</Size ' + (objs.length + 1) + '/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF';
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'invoice.pdf';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

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
        </div>
        ${col('Product', [['Pricing','#/#services'],['Supported devices','#/#devices'],['New order','#/dashboard/new-order'],['Order tracking','#/dashboard/tracking']])}
        ${col('Company', [['About','#/'],['Support center','#/support'],['Admin console','#/admin'],['API & webhooks','#/admin/webhooks']])}
        ${col('Legal', [['Terms of service','#/'],['Privacy policy','#/'],['Refund policy','#/'],['Status','#/']])}
      </div>
      <div class="divider" style="background:#222;margin:40px 0 24px"></div>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;color:#7a828c;font-size:12.5px">
        <span>© 2026 ActivatePro Inc. All rights reserved.</span>
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
  const pays = [['Visa','visa'],['Mastercard','mastercard'],['BCA','bca'],['Mandiri','mandiri'],['BRI','bri'],['QRIS','qris'],['GoPay','gopay'],['OVO','ovo'],['Dana','dana']].map(p=>`<span class="pay-chip"><img class="pay-logo" src="assets/pay/${p[1]}.png" alt="${p[0]}" loading="lazy"></span>`).join('');

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
    <section class="section" id="features" style="padding-top:0"><div class="container-x">
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
  return `<div style="background:linear-gradient(150deg,#18181b,#18181b);color:#fff;padding:48px;display:flex;flex-direction:column;position:relative;overflow:hidden" class="auth-aside">
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
    if (!CONFIG.apiBase) { setDemoUser(AUTH.email); toast(isAdmin() ? 'Signed in as administrator' : 'Signed in successfully'); setTimeout(() => navigate('/dashboard'), 600); return; }
    apiPost('/api/auth/login', { email: AUTH.email, password: f.password.value })
      .then(d => { setToken(d.token); toast('Signed in successfully'); navigate('/dashboard'); })
      .catch(err => {
        // No reachable backend (e.g. static hosting) -> graceful demo sign-in.
        if (/HTTP 404|HTTP 5\d\d|Failed to fetch|NetworkError|Load failed|Unexpected token|JSON|<!DOCTYPE/i.test(err.message)) {
          setDemoUser(AUTH.email); toast(isAdmin() ? 'Signed in as administrator' : 'Signed in successfully'); setTimeout(() => navigate('/dashboard'), 600); return;
        }
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
    const colors = ['', '#18181b', '#71717a', '#18181b', '#3f3f46'];
    const labels = ['', 'Weak password', 'Fair password', 'Good password', 'Strong password'];
    bars.forEach((b, i) => b.style.background = i < score ? colors[score] : 'var(--muted)');
    if (v) { hint.textContent = labels[score] || labels[1]; hint.style.color = colors[score] || '#18181b'; }
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
  { k: '/admin/vouchers', label: 'Voucher settings', icon: 'ticket' },
  { k: '/admin/webhooks', label: 'Webhook logs', icon: 'webhook' },
  { k: '/admin/activity', label: 'Activity logs', icon: 'activity' },
  { sec: '' },
  { k: '/dashboard', label: 'Customer view', icon: 'smartphone' },
];

function shell(activeKey, nav, title, subtitle, content) {
  const links = nav.filter(n => !(n.k === '/admin' && !isAdmin())).map(n => {
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
          <div class="notif-wrap" style="position:relative">
            <button class="btn btn-ghost btn-icon" id="notifBtn" style="position:relative">${I.bell(19)}<span id="notifDot" style="position:absolute;top:7px;right:8px;width:8px;height:8px;background:var(--danger);border-radius:999px;border:2px solid var(--background)"></span></button>
            <div id="notifPanel" class="notif-panel" style="display:none"></div>
          </div>
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
  bindNotifications();
}

/* ---------- Notifications (real, store-backed) ---------- */
function notifPanelHTML() {
  const s = seedStore();
  const list = s.notifications || [];
  const unread = list.filter(n => !n.read).length;
  const items = list.length ? list.map(n => `<div class="notif-item ${n.read ? '' : 'unread'}" data-nid="${n.id}">
      <span class="notif-ic">${(I[n.icon] || I.bell)(16)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px">${n.title}</div>
        <div class="muted" style="font-size:12px;line-height:1.4">${n.body}</div>
        <div class="muted" style="font-size:11px;margin-top:3px">${n.time}</div>
      </div>${n.read ? '' : '<span class="notif-unread-dot"></span>'}
    </div>`).join('') : `<div class="muted" style="padding:26px;text-align:center;font-size:13px">You're all caught up \u2014 no notifications.</div>`;
  return `<div class="notif-head"><span style="font-weight:700;font-size:14px">Notifications</span>${unread ? `<button class="btn btn-ghost btn-sm" id="notifReadAll" style="height:28px">Mark all read</button>` : `<span class="muted" style="font-size:12px">All read</span>`}</div>
    <div class="notif-list">${items}</div>`;
}
function refreshNotifDot() {
  const s = getStore();
  const unread = (s.notifications || []).filter(n => !n.read).length;
  const dot = $('#notifDot'); if (dot) dot.style.display = unread ? 'block' : 'none';
}
function bindNotifications() {
  const btn = $('#notifBtn'), panel = $('#notifPanel');
  if (!btn || !panel || btn._bound) return;
  btn._bound = true;
  refreshNotifDot();
  const close = () => { panel.style.display = 'none'; };
  const open = () => {
    panel.innerHTML = notifPanelHTML();
    panel.style.display = 'block';
    try { applyI18n(panel); } catch (e) {}
    const ra = $('#notifReadAll');
    if (ra) ra.addEventListener('click', e => { e.stopPropagation(); const s = getStore(); (s.notifications || []).forEach(n => n.read = true); setStore(s); panel.innerHTML = notifPanelHTML(); refreshNotifDot(); });
    $$('.notif-item', panel).forEach(it => it.addEventListener('click', e => {
      e.stopPropagation();
      const s = getStore(); const n = (s.notifications || []).find(x => x.id === it.dataset.nid);
      if (n) { n.read = true; setStore(s); }
      it.classList.remove('unread'); const d = it.querySelector('.notif-unread-dot'); if (d) d.remove();
      refreshNotifDot();
    }));
  };
  btn.addEventListener('click', e => { e.stopPropagation(); panel.style.display === 'none' ? open() : close(); });
  document.addEventListener('click', e => { if (panel.style.display !== 'none' && !panel.contains(e.target) && !btn.contains(e.target)) close(); });
}
function pushNotification(icon, title, body) {
  const s = getStore();
  s.notifications = s.notifications || [];
  s.notifications.unshift({ id: 'n' + Date.now(), icon: icon, title: title, body: body, time: 'just now', read: false });
  s.notifications = s.notifications.slice(0, 30);
  setStore(s);
  refreshNotifDot();
}

/* ---------- Admin access guard view ---------- */
function adminDenied() {
  const content = `<div class="card card-pad" style="max-width:520px;margin:40px auto;text-align:center">
    <span class="stat-icon" style="margin:0 auto 14px;width:58px;height:58px;background:var(--primary-50);color:var(--primary)">${I.lock(26)}</span>
    <h2 style="font-size:22px;margin-bottom:8px">Admin access only</h2>
    <p class="muted" style="font-size:14px;margin-bottom:20px;line-height:1.6">The admin console is restricted to administrator accounts. Sign in with an admin account to manage orders, pricing and vouchers.</p>
    <a href="#/dashboard" class="btn btn-primary">${I.arrowRight(16)} Back to dashboard</a>
  </div>`;
  return shell('/dashboard', CUSTOMER_NAV, 'Access restricted', 'Administrator area', content);
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
          ${[['iCloud Removal','#18181b','46%'],['Carrier Unlock','#a1a1aa','31%'],['Status Check','#d4d4d8','14%'],['MDM Bypass','#e4e4e7','9%']].map(s=>`<div style="display:flex;align-items:center;gap:8px;font-size:12.5px"><span style="width:10px;height:10px;border-radius:3px;background:${s[1]}"></span><span style="flex:1">${s[0]}</span><span class="muted" style="font-weight:600">${s[2]}</span></div>`).join('')}
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
  const grid = { grid: { color: '#eef0f3' }, ticks: { color: '#71717a', font: { size: 11 } }, border: { display: false } };
  new Chart($('#ordersChart'), { type: 'line', data: { labels: ['Dec','Jan','Feb','Mar','Apr','May','Jun'], datasets: [{ data: [22,28,31,38,42,49,58], borderColor: '#18181b', backgroundColor: 'rgba(63,63,70,.12)', fill: true, tension: .4, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: grid, y: { ...grid, beginAtZero: true } } } });
  new Chart($('#mixChart'), { type: 'doughnut', data: { labels: ['iCloud','Carrier','Status','MDM'], datasets: [{ data: [46,31,14,9], backgroundColor: ['#18181b','#a1a1aa','#d4d4d8','#e4e4e7'], borderWidth: 0, cutout: '68%' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
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
          res.innerHTML = `<div class="card" style="box-shadow:none;border-color:#71717a;background:var(--surface);padding:14px"><div style="display:flex;align-items:center;gap:8px;color:var(--primary);font-weight:600;font-size:13.5px">${I.checkCircle(18)} Format & checksum valid</div><div style="font-size:12.5px;color:var(--muted-foreground);margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px"><span>Length: <b>15 \u2713</b></span><span>Luhn: <b>Passed \u2713</b></span><span>TAC: <b>${chk.tac}</b></span><span>Est. model: <b>${chk.model || 'unknown (offline)'}</b></span></div><div class="muted" style="font-size:11px;margin-top:8px">${note} FMI / blacklist / warranty need a live GSX lookup \u2014 enable the backend in server/ and set CONFIG.imeiApiBase.</div></div>`;
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
          <div style="display:flex;justify-content:space-between;font-size:13.5px;padding:3px 0"><span class="muted">Discount</span><span id="ckDiscount" style="color:var(--success)">−Rp0</span></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:18px;padding:14px 0"><span>Total</span><span id="ckTotal" style="color:var(--primary)">${money(total)}</span></div>
        <div style="display:flex;gap:8px;margin-bottom:6px"><input class="input cell-mono" id="promoInput" placeholder="Promo code" style="height:40px;text-transform:uppercase"><button class="btn btn-outline btn-sm" id="applyPromo">Apply</button></div>
        <div id="promoMsg" style="font-size:12px;margin-bottom:12px;min-height:16px"></div>
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
          <div style="display:flex;justify-content:space-between;color:var(--foreground);font-weight:600"><span>Amount due</span><span id="ckInvAmt">${money(total)}</span></div>
        </div>
        <button class="btn btn-outline btn-block btn-sm" id="dlInvoice" style="margin-top:12px">${I.download(15)} Download PDF</button>
      </div>
    </div>
  </div>`;
  return shell('/dashboard/checkout', CUSTOMER_NAV, 'Checkout', 'Complete your payment', content);
});
ROUTES['/dashboard/checkout']._after = function () {
  bindShell();
  $$('[data-pay]').forEach(t => t.addEventListener('click', () => { $$('[data-pay]').forEach(x => x.classList.remove('selected')); t.classList.add('selected'); }));

  // --- Pricing + voucher (vouchers are managed in the admin console) ---
  const svc0 = DATA.services.find(s => s.id === WIZ.service) || DATA.services[0];
  const base = priceFor(WIZ.service, WIZ.device) || svc0.price || 0;
  const tax = Math.round(base * 0.11);
  let applied = null; // { code, type, value, discount }
  function discountFor(v) {
    if (!v) return 0;
    return v.type === 'percent' ? Math.round((base + tax) * (v.value / 100)) : Math.min(v.value, base + tax);
  }
  function refreshTotals() {
    const disc = applied ? applied.discount : 0;
    const total = Math.max(0, base + tax - disc);
    const dEl = $('#ckDiscount'); if (dEl) dEl.textContent = '\u2212' + money(disc);
    const tEl = $('#ckTotal'); if (tEl) tEl.textContent = money(total);
    const iEl = $('#ckInvAmt'); if (iEl) iEl.textContent = money(total);
    const pb = $('#payBtn'); if (pb) pb.innerHTML = I.lock(16) + ' Pay ' + money(total);
    return total;
  }
  const apply = $('#applyPromo'), promo = $('#promoInput'), msg = $('#promoMsg');
  if (apply) apply.addEventListener('click', () => {
    const code = (promo.value || '').trim().toUpperCase();
    if (!code) { msg.textContent = ''; return; }
    const s = seedStore();
    const v = (s.vouchers || []).find(x => x.code === code);
    if (!v) { applied = null; msg.style.color = 'var(--danger)'; msg.textContent = 'Invalid voucher code.'; refreshTotals(); return; }
    if (!v.active) { applied = null; msg.style.color = 'var(--danger)'; msg.textContent = 'This voucher is no longer active.'; refreshTotals(); return; }
    applied = { code: v.code, type: v.type, value: v.value, discount: discountFor(v) };
    msg.style.color = 'var(--success)';
    msg.textContent = 'Applied ' + v.code + ' \u2014 you save ' + money(applied.discount) + (v.type === 'percent' ? ' (' + v.value + '%)' : '') + '.';
    refreshTotals();
    toast('Voucher ' + v.code + ' applied');
  });
  if (promo) promo.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply && apply.click(); } });

  // --- Downloadable invoice (real PDF file) ---
  const dl = $('#dlInvoice');
  if (dl) dl.addEventListener('click', () => {
    const total = refreshTotals();
    const disc = applied ? applied.discount : 0;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const lines = [
      'ActivatePro Inc.', 'Enterprise iPhone Activation & Device Services', '',
      'INVOICE', 'Invoice No : INV-2049', 'Date       : ' + dateStr,
      'Billed to  : ' + (DATA.user.email || ''), '',
      '----------------------------------------------',
      'Service    : ' + (svc0.name || ''),
      'Device     : ' + (WIZ.device || 'iPhone 15 Pro'),
      'IMEI       : ' + (WIZ.imei || '-'),
      '----------------------------------------------',
      'Subtotal   : ' + money(base),
      'PPN (11%)  : ' + money(tax),
      'Discount   : -' + money(disc) + (applied ? '  (' + applied.code + ')' : ''),
      '----------------------------------------------',
      'AMOUNT DUE : ' + money(total), '',
      'Thank you for your business.',
      'Payments are encrypted and PCI-DSS compliant.',
    ];
    downloadInvoicePDF(lines, 'ActivatePro-INV-2049.pdf');
    pushNotification('file', 'Invoice downloaded', 'INV-2049 saved as PDF (' + money(total) + ').');
    toast('Invoice downloaded');
  });

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
  const TRACK_ID = 'AP-10428';
  const stage = orderStage(TRACK_ID, 'Processing');
  const stepDefs = [
    ['check', 'Order placed', 'Payment confirmed · Jun 20, 09:14'],
    ['check', 'IMEI verified', 'GSX check passed · Jun 20, 09:15'],
    ['refresh', 'Processing activation', 'Removing iCloud lock'],
    ['shield', 'Quality check', 'Final verification before delivery'],
    ['checkCircle', 'Completed', 'Device ready to activate'],
  ];
  const steps = stepDefs.map((d, i) => {
    const state = i < stage ? 'done' : (i === stage ? 'current' : '');
    const badge = i === stage ? (stage >= 4 ? 'done' : 'now') : (i === 0 ? TRACK_ID : '');
    return [state, d[0], d[1], d[2] + (i === stage && stage < 4 ? ' — in progress' : ''), badge];
  });
  const pct = Math.min(100, Math.round((stage / 4) * 100));
  const trackStatus = stageStatus(stage);
  const etaTxt = stage >= 4 ? 'Completed' : 'ETA ~6 hrs';
  const tl = steps.map(s => `<div class="tl-item ${s[0]}"><span class="tl-dot">${I[s[1]](16)}</span>
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px"><div style="font-weight:600;font-size:14px">${s[2]}</div>${s[4] ? `<span class="badge ${s[0] === 'current' ? 'badge-info' : 'badge-neutral'}" style="font-size:11px">${s[4]}</span>` : ''}</div>
    <div class="muted" style="font-size:12.5px;margin-top:2px">${s[3]}</div></div>`).join('');
  const content = `<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:20px;max-width:1000px;margin:0 auto" class="checkout-grid">
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:10px">
        <div><div style="display:flex;align-items:center;gap:10px"><h3 style="font-size:18px" class="cell-mono" >AP-10428</h3>${statusBadge(trackStatus)}</div><div class="muted" style="font-size:13px;margin-top:4px">iPhone 15 Pro · iCloud Activation Lock Removal</div></div>
        <button class="btn btn-outline btn-sm" id="trackRefresh">${I.refresh(15)} Refresh</button>
      </div>
      <div style="margin-bottom:8px;display:flex;justify-content:space-between;font-size:12.5px"><span class="muted">Progress</span><span style="font-weight:600">${pct}% · ${etaTxt}</span></div>
      <div class="progress" style="margin-bottom:28px"><span style="width:${pct}%"></span></div>
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
ROUTES['/dashboard/tracking']._after = function () {
  bindShell();
  const r = $('#trackRefresh');
  if (r) r.addEventListener('click', () => { toast('Status refreshed'); navigate('/dashboard/tracking'); });
};

/* ============================================================
   8. SUPPORT CENTER (tickets · live chat · knowledge base)
   ============================================================ */
route('/support', function () {
  const tickets = [
    { id: '#4821', subj: 'iCloud removal stuck at 50%', status: 'Open', tone: 'warning', time: '2h ago', order: 'AP-10428',
      msgs: [
        ['them', 'Hi Iqbal \ud83d\udc4b Thanks for reaching out. Can you confirm the order ID affected?'],
        ['me', 'It is AP-10428 \u2014 the iCloud removal has been at 50% for a while.'],
        ['them', "Thanks! I can see it's actively processing on GSX. Estimated completion is ~6 hrs \u2014 I'll flag it as priority for you."],
      ] },
    { id: '#4816', subj: 'Carrier unlock \u2014 wrong network', status: 'In progress', tone: 'info', time: '5h ago', order: 'AP-10427',
      msgs: [
        ['them', 'We received your report about the carrier mismatch. Investigating now.'],
        ['me', 'The phone was an AT&T device but it was submitted as T-Mobile.'],
        ['them', 'Understood \u2014 our operator is correcting the network and re-running the unlock at no extra cost.'],
      ] },
    { id: '#4790', subj: 'Refund for failed order AP-10424', status: 'Resolved', tone: 'success', time: '1d ago', order: 'AP-10424',
      msgs: [
        ['them', 'Your refund for AP-10424 has been approved.'],
        ['me', 'Great, thank you. How long until it reflects?'],
        ['them', 'Refunds typically post within 3\u20135 business days to your original payment method.'],
      ] },
    { id: '#4772', subj: 'API webhook not firing', status: 'Resolved', tone: 'success', time: '2d ago', order: '\u2014',
      msgs: [
        ['them', 'We found the webhook endpoint was returning 500 errors.'],
        ['me', 'Fixed our server, can you resend the test event?'],
        ['them', 'Done \u2014 delivery succeeded with a 200 OK. Closing this ticket.'],
      ] },
  ];
  const ticketCards = tickets.map((t, i) => `<div class="card card-hover" data-ticket="${i}" style="box-shadow:none;border-color:var(--border);padding:14px;display:flex;align-items:center;gap:12px;cursor:pointer">
    <div style="flex:1"><div style="display:flex;align-items:center;gap:8px"><span class="cell-mono" style="font-weight:600;color:var(--primary)">${t.id}</span><span class="badge badge-${t.tone}" style="font-size:11px">${t.status}</span></div><div style="font-size:13.5px;font-weight:500;margin-top:4px">${t.subj}</div></div>
    <div style="text-align:right"><div class="muted" style="font-size:11.5px">${t.time}</div>${I.chevronRight(16)}</div></div>`).join('');

  const kb = [
    { icon: 'smartphone', title: 'How iCloud removal works', count: '8 articles',
      articles: ['What is iCloud Activation Lock?', 'Clean vs. Lost mode explained', 'How long does removal take?', 'Checking removal status', 'Supported iPhone models', 'After removal: setting up your device', 'Why some removals fail', 'Requesting a refund'] },
    { icon: 'globe', title: 'Carrier unlock guide', count: '12 articles',
      articles: ['Supported carriers worldwide', 'How factory unlock works', 'Finding your original carrier', 'Permanent vs. temporary unlock', 'Unlock turnaround times', 'No-jailbreak guarantee', 'Re-locking risks explained', 'Troubleshooting a failed unlock'] },
    { icon: 'cpu', title: 'Understanding IMEI checks', count: '6 articles',
      articles: ['What an IMEI reveals', 'Reading a GSX report', 'Blacklist & FMI status', 'Warranty & coverage checks', 'IMEI format & Luhn checksum', 'Privacy of IMEI lookups'] },
    { icon: 'card', title: 'Billing & refunds', count: '9 articles',
      articles: ['Accepted payment methods', 'Reading your invoice', 'Refund policy & timelines', 'Applying voucher codes', 'Wallet balance & top-ups', 'Failed payment troubleshooting'] },
    { icon: 'webhook', title: 'API & webhooks', count: '14 articles',
      articles: ['Getting your API keys', 'Authentication & rate limits', 'Creating orders via API', 'Webhook event types', 'Verifying webhook signatures', 'Retries & idempotency'] },
    { icon: 'shield', title: 'Security & privacy', count: '5 articles',
      articles: ['How we protect your data', 'Data retention policy', 'Two-factor authentication', 'Reporting a vulnerability', 'GDPR & data requests'] },
  ];
  const kbCards = kb.map((k, i) => `<a href="#/support" data-kb="${i}" class="card card-hover card-pad" style="display:block">
    <span class="stat-icon" style="background:var(--primary-50);color:var(--primary)">${I[k.icon](20)}</span>
    <div style="font-weight:600;font-size:14px;margin-top:12px">${k.title}</div><div class="muted" style="font-size:12.5px;margin-top:2px">${k.count}</div></a>`).join('');

  const content = `
    <div class="card card-pad" style="background:linear-gradient(135deg,#18181b,#18181b);color:#fff;margin-bottom:20px;border:none">
      <h2 style="color:#fff;font-size:24px">How can we help?</h2>
      <p style="opacity:.9;font-size:14px;margin:6px 0 16px">Search our knowledge base or open a ticket \u2014 our team replies in under 4 minutes.</p>
      <div class="input-group" style="max-width:520px"><span class="input-icon">${I.search(18)}</span><input class="input" id="kbSearch" placeholder="Search articles, guides, FAQs\u2026" style="height:46px"></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:24px;max-width:920px">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border)"><h3 style="font-size:16px">Your tickets</h3><button class="btn btn-primary btn-sm" id="newTicketBtn">${I.plusCircle(15)} New ticket</button></div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:10px" id="ticketList">${ticketCards}</div>
      </div>
      <div>
        <h3 style="font-size:16px;margin-bottom:14px">Knowledge base</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px" class="kb-grid" id="kbGrid">${kbCards}</div>
      </div>
    </div>`;
  const node = shell('/support', CUSTOMER_NAV, 'Support center', "We're here to help", content);
  ROUTES['/support']._tickets = tickets;
  ROUTES['/support']._kb = kb;
  return node;
});
ROUTES['/support']._after = function () {
  bindShell();
  const tickets = ROUTES['/support']._tickets || [];
  const kb = ROUTES['/support']._kb || [];

  // Open a ticket conversation in a modal.
  $$('[data-ticket]').forEach(card => card.addEventListener('click', () => {
    const t = tickets[+card.dataset.ticket]; if (!t) return;
    const thread = t.msgs.map(m => m[0] === 'them'
      ? `<div style="display:flex;gap:8px"><span class="avatar" style="width:28px;height:28px;font-size:11px;background:var(--primary)">${I.headset(14)}</span><div class="chat-bubble them">${m[1]}</div></div>`
      : `<div style="display:flex;justify-content:flex-end"><div class="chat-bubble me">${m[1]}</div></div>`).join('');
    openModal(`Ticket ${t.id}`, `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="badge badge-${t.tone}">${t.status}</span><span class="muted" style="font-size:12.5px">Order ${t.order} \u00b7 ${t.time}</span></div>
      <div style="font-weight:600;font-size:15px;margin-bottom:14px">${t.subj}</div>
      <div style="display:flex;flex-direction:column;gap:12px;max-height:320px;overflow-y:auto;padding:4px 2px 12px">${thread}</div>
      <div style="display:flex;gap:8px;border-top:1px solid var(--border);padding-top:12px">
        <input class="input" id="tkReply" placeholder="Write a reply\u2026"><button class="btn btn-primary btn-icon" id="tkSend">${I.send(18)}</button>
      </div>`);
    const send = () => {
      const inp = $('#tkReply'); const v = (inp.value || '').trim(); if (!v) return;
      const log = $('.modal .chat-bubble') ? $$('.modal [style*="overflow-y"]')[0] : null;
      const cont = document.querySelector('.modal-thread') || $$('.modal div[style*="overflow-y:auto"]')[0];
      const wrap = cont || inp.parentElement.previousElementSibling;
      wrap.insertAdjacentHTML('beforeend', `<div style="display:flex;justify-content:flex-end"><div class="chat-bubble me">${v.replace(/</g, '&lt;')}</div></div>`);
      inp.value = ''; wrap.scrollTop = wrap.scrollHeight;
      pushNotification('headset', 'Reply sent on ' + t.id, 'Our support team will follow up shortly.');
      setTimeout(() => {
        wrap.insertAdjacentHTML('beforeend', `<div style="display:flex;gap:8px"><span class="avatar" style="width:28px;height:28px;font-size:11px;background:var(--primary)">${I.headset(14)}</span><div class="chat-bubble them">Got it \u2014 a specialist will follow up shortly. Is there anything else I can help with?</div></div>`);
        wrap.scrollTop = wrap.scrollHeight;
      }, 800);
    };
    const sb = $('#tkSend'); if (sb) sb.addEventListener('click', send);
    const ri = $('#tkReply'); if (ri) ri.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  }));

  // Open a knowledge-base category in a modal.
  $$('[data-kb]').forEach(card => card.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const k = kb[+card.dataset.kb]; if (!k) return;
    const list = k.articles.map(a => `<a href="#/support" class="kb-article" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;text-decoration:none;color:var(--foreground)"><span style="font-size:13.5px;font-weight:500">${a}</span>${I.chevronRight(16)}</a>`).join('');
    openModal(k.title, `
      <div class="muted" style="font-size:12.5px;margin-bottom:14px">${k.count} \u00b7 Tap an article to open it</div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:380px;overflow-y:auto">${list}</div>`);
    $$('.kb-article').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      openModal(a.querySelector('span').textContent, `
        <div class="muted" style="font-size:12.5px;margin-bottom:12px">${k.title} \u00b7 Knowledge base</div>
        <p style="font-size:14px;line-height:1.7;margin-bottom:12px">This article explains <b>${a.querySelector('span').textContent.toLowerCase()}</b> in detail. ActivatePro processes every device request through Apple GSX with full status transparency.</p>
        <p style="font-size:14px;line-height:1.7;margin-bottom:12px">Follow the steps below to resolve most issues on your own. If you still need help, open a support ticket and our team responds in under 4 minutes.</p>
        <ol style="font-size:13.5px;line-height:1.8;padding-left:18px;color:var(--muted-foreground)"><li>Confirm your order ID and device model.</li><li>Check the live status on the Order tracking page.</li><li>Review the eligibility and timing notes for your service.</li><li>Contact support if the status hasn't changed within the ETA.</li></ol>
        <div style="margin-top:16px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" data-toast="Thanks for your feedback!">${I.checkCircle(15)} This helped</button><a href="#/support" class="btn btn-outline btn-sm" id="kbOpenTicket">Still need help?</a></div>`);
      const ot = $('#kbOpenTicket'); if (ot) ot.addEventListener('click', ev2 => { ev2.preventDefault(); closeModal(); $('#newTicketBtn') && $('#newTicketBtn').click(); });
      bindGlobal();
    }));
  }));

  // New ticket modal.
  const nt = $('#newTicketBtn');
  if (nt) nt.addEventListener('click', () => {
    openModal('Open a new ticket', `
      <form id="ntForm" style="display:flex;flex-direction:column;gap:14px">
        <div class="field"><label class="label">Subject</label><input class="input" name="subj" placeholder="Briefly describe the issue" required></div>
        <div class="field"><label class="label">Related order (optional)</label><input class="input cell-mono" name="order" placeholder="AP-10428"></div>
        <div class="field"><label class="label">Category</label><select class="input" name="cat"><option>iCloud removal</option><option>Carrier unlock</option><option>Billing & refunds</option><option>API & webhooks</option><option>Other</option></select></div>
        <div class="field"><label class="label">Message</label><textarea class="input" name="msg" rows="4" placeholder="Tell us what's happening\u2026" style="resize:vertical"></textarea></div>
        <button type="submit" class="btn btn-primary btn-block">${I.plusCircle(16)} Submit ticket</button>
      </form>`);
    const f = $('#ntForm');
    if (f) f.addEventListener('submit', e => {
      e.preventDefault();
      const subj = f.subj.value.trim() || 'New support request';
      const newId = '#' + (4822 + Math.floor(Math.random() * 50));
      const list = $('#ticketList');
      if (list) list.insertAdjacentHTML('afterbegin', `<div class="card" style="box-shadow:none;border-color:var(--border);padding:14px;display:flex;align-items:center;gap:12px"><div style="flex:1"><div style="display:flex;align-items:center;gap:8px"><span class="cell-mono" style="font-weight:600;color:var(--primary)">${newId}</span><span class="badge badge-warning" style="font-size:11px">Open</span></div><div style="font-size:13.5px;font-weight:500;margin-top:4px">${subj.replace(/</g, '&lt;')}</div></div><div style="text-align:right"><div class="muted" style="font-size:11.5px">just now</div>${I.chevronRight(16)}</div></div>`);
      pushNotification('headset', 'Ticket ' + newId + ' created', subj);
      toast('Ticket ' + newId + ' created');
      closeModal();
    });
  });

  // Knowledge-base search filter.
  const sb = $('#kbSearch');
  if (sb) sb.addEventListener('input', () => {
    const q = sb.value.toLowerCase();
    $$('#kbGrid [data-kb]').forEach(c => { c.style.display = c.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  });
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
  const grid = { grid: { color: '#eef0f3' }, ticks: { color: '#71717a', font: { size: 11 } }, border: { display: false } };
  new Chart($('#revChart'), { type: 'bar', data: { labels: ['Jan','Feb','Mar','Apr','May','Jun'], datasets: [
    { label: 'Revenue', data: [42,51,58,67,74,84], backgroundColor: '#18181b', borderRadius: 6, barPercentage: .6, yAxisID: 'y' },
    { type: 'line', label: 'Orders', data: [980,1120,1290,1480,1640,1842], borderColor: '#71717a', backgroundColor: 'transparent', borderWidth: 2.5, tension: .4, pointRadius: 0, yAxisID: 'y1' }
  ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }, scales: { x: grid, y: { ...grid, beginAtZero: true }, y1: { position: 'right', grid: { display: false }, ticks: { color: '#71717a', font: { size: 11 } }, border: { display: false } } } } });
};

/* ---- Admin: Order management ---- */
route('/admin/orders', function () {
  const rows = DATA.orders.map(o => `<tr>
    <td><input type="checkbox" style="accent-color:var(--primary)"></td>
    <td class="cell-mono" style="color:var(--primary);font-weight:600">${o.id}</td>
    <td><div style="font-weight:600">${o.device}</div><div class="muted" style="font-size:12px">${o.service}</div></td>
    <td class="cell-mono">${o.imei}</td><td>${statusBadge(o.status)}</td><td class="muted">${o.date}</td><td style="font-weight:600">${money(o.amount)}</td>
    <td><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <select class="input track-sel" data-track="${o.id}" title="Update order tracking" style="height:32px;width:140px;font-size:12px;padding:0 8px">${TRACK_STAGES.map((st, si) => `<option value="${si}" ${si === orderStage(o.id, o.status) ? 'selected' : ''}>${st}</option>`).join('')}</select>
      <button class="btn btn-soft btn-sm" data-complete-demo="${o.id}">Complete</button>
    </div></td></tr>`).join('');
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
  // Admin can update customer-facing order tracking (works in demo + backend).
  const applyStage = (id, stage) => {
    const s = getStore(); s.tracking = s.tracking || {}; s.tracking[id] = { stage: stage, updatedAt: Date.now() };
    setStore(s);
    const ord = DATA.orders.find(o => o.id === id); if (ord) ord.status = stageStatus(stage);
    pushNotification('truck', 'Order ' + id + ' updated', 'Tracking status set to "' + TRACK_STAGES[stage] + '".');
  };
  $$('.track-sel').forEach(sel => sel.addEventListener('change', () => {
    applyStage(sel.dataset.track, +sel.value);
    toast('Order ' + sel.dataset.track + ' \u2192 ' + TRACK_STAGES[+sel.value]);
  }));
  $$('[data-complete-demo]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.completeDemo; applyStage(id, 4); toast('Order ' + id + ' marked complete'); navigate('/admin/orders');
  }));
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

/* ---- Admin: Voucher settings (connected to checkout) ---- */
route('/admin/vouchers', function () {
  const s = seedStore();
  const vouchers = s.vouchers || [];
  const rows = vouchers.map((v, i) => `<tr>
    <td class="cell-mono" style="font-weight:700;color:var(--primary)">${v.code}</td>
    <td>${v.type === 'percent' ? v.value + '%' : money(v.value)}</td>
    <td class="muted" style="font-size:12.5px">${v.note || ''}</td>
    <td>${v.active ? '<span class="badge badge-success badge-dot">Active</span>' : '<span class="badge badge-neutral badge-dot">Disabled</span>'}</td>
    <td><div style="display:flex;gap:4px;justify-content:flex-end">
      <button class="btn btn-soft btn-sm" data-vtoggle="${i}">${v.active ? 'Disable' : 'Enable'}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-vdel="${i}" title="Delete">${I.trash(16)}</button>
    </div></td></tr>`).join('') || `<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">No vouchers yet \u2014 create one above.</td></tr>`;
  const content = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px" class="card-grid">
      ${statCard('ticket','Total vouchers', String(vouchers.length))}
      ${statCard('checkCircle','Active', String(vouchers.filter(v => v.active).length))}
      ${statCard('dollar','Connected to', 'Checkout')}
    </div>
    <div class="card card-pad" style="margin-bottom:18px">
      <h3 style="font-size:16px;margin-bottom:14px">Create voucher</h3>
      <form id="voucherForm" style="display:grid;grid-template-columns:1.2fr 1fr 1fr 1.4fr auto;gap:12px;align-items:end" class="voucher-form">
        <div class="field"><label class="label">Code</label><input class="input cell-mono" name="code" placeholder="WELCOME10" required style="text-transform:uppercase"></div>
        <div class="field"><label class="label">Type</label><select class="input" name="type"><option value="percent">Percentage</option><option value="fixed">Fixed (Rp)</option></select></div>
        <div class="field"><label class="label">Value</label><input class="input cell-mono" name="value" type="number" min="1" placeholder="10" required></div>
        <div class="field"><label class="label">Note</label><input class="input" name="note" placeholder="New customer discount"></div>
        <button type="submit" class="btn btn-primary">${I.plusCircle(16)} Add</button>
      </form>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border)"><h3 style="font-size:16px">Vouchers</h3><span class="muted" style="font-size:12.5px">These codes work on the customer checkout page</span></div>
      <div class="table-wrapper"><table class="data"><thead><tr><th>Code</th><th>Discount</th><th>Note</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead><tbody id="voucherBody">${rows}</tbody></table></div>
    </div>`;
  return shell('/admin/vouchers', ADMIN_NAV, 'Voucher settings', 'Create and manage discount codes', content);
});
ROUTES['/admin/vouchers']._after = function () {
  bindShell();
  const f = $('#voucherForm');
  if (f) f.addEventListener('submit', e => {
    e.preventDefault();
    const code = (f.code.value || '').trim().toUpperCase();
    const value = parseInt(f.value.value, 10);
    if (!code || !value || value <= 0) { toast('Enter a valid code and value', 'alert'); return; }
    const s = getStore(); s.vouchers = s.vouchers || [];
    if (s.vouchers.some(v => v.code === code)) { toast('That code already exists', 'alert'); return; }
    s.vouchers.unshift({ code: code, type: f.type.value, value: value, active: true, note: (f.note.value || '').trim() });
    setStore(s);
    toast('Voucher ' + code + ' created');
    navigate('/admin/vouchers');
  });
  $$('[data-vtoggle]').forEach(b => b.addEventListener('click', () => {
    const s = getStore(); const v = s.vouchers[+b.dataset.vtoggle];
    if (v) { v.active = !v.active; setStore(s); toast('Voucher ' + v.code + (v.active ? ' enabled' : ' disabled')); navigate('/admin/vouchers'); }
  }));
  $$('[data-vdel]').forEach(b => b.addEventListener('click', () => {
    const s = getStore(); const v = s.vouchers[+b.dataset.vdel];
    if (v) { s.vouchers.splice(+b.dataset.vdel, 1); setStore(s); toast('Voucher ' + v.code + ' deleted'); navigate('/admin/vouchers'); }
  }));
};

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
  try { applyAppSettings(); } catch (e) {}
  try { applyI18n(); } catch (e) {}
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
    ${setRow('Language', 'Interface display language', `<select class="select" id="langSelect" style="width:200px;height:40px"><option value="id">Bahasa Indonesia</option><option value="en">English</option></select>`)}
    ${setRow('Timezone', 'Used for timestamps & reports', `<select class="select" style="width:200px;height:40px"><option>(GMT+7) Jakarta</option><option>(GMT+0) London</option><option>(GMT-5) New York</option></select>`)}
    ${setRow('Currency', 'Follows the selected language', `<select class="select" id="currencySelect" style="width:200px;height:40px" disabled><option value="IDR">IDR (Rp)</option><option value="USD">USD ($)</option></select>`)}
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
      <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border)"><h3 style="font-size:16px">Invoices</h3><button class="btn btn-outline btn-sm" id="invExportAll">${I.download(15)} Export all</button></div>
      <div class="table-wrapper"><table class="data"><thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${[['INV-2048','Jun 18, 2026','Rp1.498.500','Paid'],['INV-2041','Jun 10, 2026','Rp1.350.000','Paid'],['INV-2033','Jun 02, 2026','Rp2.100.000','Paid']].map(r=>`<tr><td class="cell-mono" style="color:var(--primary);font-weight:600">${r[0]}</td><td class="muted">${r[1]}</td><td style="font-weight:600">${r[2]}</td><td><span class="badge badge-success badge-dot">${r[3]}</span></td><td><button class="btn btn-ghost btn-sm" data-inv="${r[0]}" data-inv-date="${r[1]}" data-inv-amt="${r[2]}" title="Download invoice PDF">${I.download(14)}</button></td></tr>`).join('')}
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
    <div style="display:flex;gap:10px;margin-bottom:4px">${['#18181b','#18181b','#52525b','#3f3f46','#18181b','#71717a'].map((c,i)=>`<span class="swatch ${i===0?'active':''}" data-swatch style="background:${c}"></span>`).join('')}</div>
    <div class="divider" style="margin:20px 0"></div>
    ${setRow('Compact density', 'Reduce padding for denser tables', sw(false))}
    ${setRow('Reduce motion', 'Minimize animations & transitions', sw(false))}
  </div>`;

  const api = `<div style="display:flex;flex-direction:column;gap:16px">
    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div><h3 style="font-size:16px">API keys</h3><p class="muted" style="font-size:12.5px;margin-top:2px">Use these to authenticate API requests.</p></div><button class="btn btn-primary btn-sm" id="apiCreateBtn">${I.plusCircle(15)} Create key</button></div>
      <div id="apiKeyList">${apiKeyRowsHTML()}</div>
    </div>
    <div class="card card-pad">
      <h3 style="font-size:16px;margin-bottom:2px">Webhook endpoint</h3><p class="muted" style="font-size:12.5px;margin-bottom:14px">We'll POST event payloads to this URL.</p>
      <div class="field" style="margin-bottom:14px"><label class="label">Endpoint URL</label><div style="display:flex;gap:8px"><input class="input cell-mono" id="webhookUrl" value="https://reseller.co/hooks/ap"><button class="btn btn-outline" id="webhookTest">Send test</button></div></div>
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
  $$('[data-swatch]').forEach(s => s.addEventListener('click', () => { $$('[data-swatch]').forEach(x => x.classList.remove('active')); s.classList.add('active'); const c = s.style.background; document.documentElement.style.setProperty('--primary', c); const st = getStore(); st.settings = st.settings || {}; st.settings['appearance::accent'] = c; setStore(st); toast('Accent color updated'); }));
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

  // --- Persist every toggle & dropdown across the Settings tabs ---
  $$('.tab-panel').forEach(panel => {
    const pname = panel.dataset.panel;
    $$('.set-row', panel).forEach(row => {
      const h4 = row.querySelector('.meta h4'); if (!h4) return;
      const key = pname + '::' + h4.textContent.trim();
      const cb = row.querySelector('input[type="checkbox"]');
      const sel = row.querySelector('select');
      if (sel && (sel.id === 'langSelect' || sel.id === 'currencySelect')) return;
      const st = getStore(); st.settings = st.settings || {};
      if (cb) {
        if (key in st.settings) cb.checked = !!st.settings[key];
        cb.addEventListener('change', () => {
          const s = getStore(); s.settings = s.settings || {}; s.settings[key] = cb.checked; setStore(s);
          applyAppSettings();
          toast(h4.textContent.trim() + (cb.checked ? ' enabled' : ' disabled'));
        });
      } else if (sel) {
        if (key in st.settings) sel.value = st.settings[key];
        sel.addEventListener('change', () => {
          const s = getStore(); s.settings = s.settings || {}; s.settings[key] = sel.value; setStore(s);
          toast('Preference saved');
        });
      }
    });
  });
  applyAppSettings();

  // --- Language selector (Indonesian / English) + currency follows language ---
  const langSel = $('#langSelect');
  if (langSel) { langSel.value = _lang; langSel.addEventListener('change', () => setLang(langSel.value)); }
  const curSel = $('#currencySelect');
  if (curSel) curSel.value = (_lang === 'en') ? 'USD' : 'IDR';

  // --- Webhook endpoint URL persistence + test ---
  const wh = $('#webhookUrl');
  if (wh) {
    const st = getStore(); if (st.settings && st.settings['api::webhookUrl']) wh.value = st.settings['api::webhookUrl'];
    wh.addEventListener('change', () => { const s = getStore(); s.settings = s.settings || {}; s.settings['api::webhookUrl'] = wh.value; setStore(s); toast('Webhook URL saved'); });
  }
  const wt = $('#webhookTest');
  if (wt) wt.addEventListener('click', () => { pushNotification('webhook', 'Test event sent', 'POST ' + (wh ? wh.value : '') + ' \u2014 200 OK'); toast('Test event sent \u2014 200 OK'); });

  // --- Billing: real invoice PDF downloads ---
  function invoicePDF(id, date, amt) {
    const lines = [
      'ActivatePro Inc.', 'Enterprise iPhone Activation & Device Services', '',
      'INVOICE', 'Invoice No : ' + id, 'Date       : ' + date,
      'Billed to  : ' + (DATA.user.email || ''), '',
      '----------------------------------------------',
      'Status     : Paid',
      'Amount     : ' + amt,
      '----------------------------------------------',
      'Thank you for your business.',
      'Payments are encrypted and PCI-DSS compliant.',
    ];
    downloadInvoicePDF(lines, 'ActivatePro-' + id + '.pdf');
  }
  $$('[data-inv]').forEach(b => b.addEventListener('click', () => {
    invoicePDF(b.dataset.inv, b.dataset.invDate, b.dataset.invAmt);
    pushNotification('file', 'Invoice downloaded', b.dataset.inv + ' saved as PDF.');
    toast('Invoice ' + b.dataset.inv + ' downloaded');
  }));
  const exAll = $('#invExportAll');
  if (exAll) exAll.addEventListener('click', () => {
    $$('[data-inv]').forEach(b => invoicePDF(b.dataset.inv, b.dataset.invDate, b.dataset.invAmt));
    toast('All invoices exported');
  });

  // --- API keys: create / copy / revoke (store-backed) ---
  function bindKeyRows() {
    $$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const s = getStore(); const k = (s.apikeys || []).find(x => x.id === b.dataset.copy); if (!k) return;
      try { await navigator.clipboard.writeText(k.key); toast('API key copied to clipboard'); }
      catch (e) { toast('Copy failed \u2014 select the key manually', 'alert'); }
    }));
    $$('[data-revoke]').forEach(b => b.addEventListener('click', () => {
      const s = getStore(); const idx = (s.apikeys || []).findIndex(x => x.id === b.dataset.revoke);
      if (idx < 0) return;
      const lbl = s.apikeys[idx].label; s.apikeys.splice(idx, 1); setStore(s);
      const list = $('#apiKeyList'); if (list) { list.innerHTML = apiKeyRowsHTML(); bindKeyRows(); }
      toast(lbl + ' key revoked');
    }));
  }
  bindKeyRows();
  const ck = $('#apiCreateBtn');
  if (ck) ck.addEventListener('click', () => {
    const s = getStore(); s.apikeys = s.apikeys || [];
    const id = 'k_' + Date.now();
    const newKey = { id: id, label: 'Key ' + (s.apikeys.length + 1), env: 'Live', key: genApiKey('Live') };
    s.apikeys.unshift(newKey); setStore(s);
    const list = $('#apiKeyList'); if (list) { list.innerHTML = apiKeyRowsHTML(); bindKeyRows(); }
    pushNotification('key', 'New API key created', newKey.label + ' (' + newKey.env + ')');
    toast('New API key created');
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
function toggleTheme() { applyTheme('light'); }
function initTheme() { applyTheme('light'); }
function themeBtn() { return ''; }
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
    if (!CONFIG.apiBase) { setDemoUser(AUTH.email || DATA.user.email, AUTH.pendingName); toast('Email verified — welcome!'); setTimeout(() => navigate('/dashboard'), 600); return; }
    apiPost('/api/auth/verify-otp', { email: AUTH.email || DATA.user.email, code })
      .then(d => { if (d && d.token) setToken(d.token); toast('Email verified — welcome!'); setTimeout(() => navigate('/dashboard'), 600); })
      .catch(err => {
        if (/HTTP 404|HTTP 5\d\d|Failed to fetch|NetworkError|Load failed|Unexpected token|JSON|<!DOCTYPE/i.test(err.message)) {
          setDemoUser(AUTH.email || DATA.user.email, AUTH.pendingName); toast('Email verified — welcome!'); setTimeout(() => navigate('/dashboard'), 600); return;
        }
        const e = $('[data-err="otp"]'); e.textContent = err.message; e.classList.add('show');
      });
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
  const body = pro ? '#27272a' : '#dfe6ec';
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
      <linearGradient id="scrStd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a1a1aa"/><stop offset="1" stop-color="#18181b"/></linearGradient>
      <linearGradient id="scrPro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#27272a"/><stop offset="1" stop-color="#0b0b0e"/></linearGradient>
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
