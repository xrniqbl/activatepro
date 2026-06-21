# ActivatePro — backend (IMEI + Auth + Orders + Payments)

This backend makes the core ActivatePro processes real and persistent:
- **Auth**: register → email OTP (Brevo) → verify → JWT session; login with bcrypt-hashed passwords.
- **Orders**: created and listed from a real SQLite database (per-user).
- **Payments**: Midtrans Snap scaffold (Indonesia) with a status webhook.
- **IMEI**: Luhn + free TAC model lookup + optional paid FMI/blacklist/warranty provider.

## Auth & Orders API
- `POST /api/auth/register`  `{ email, name, password }` → creates account, emails OTP.
- `POST /api/auth/send-otp`  `{ email }` → resend code.
- `POST /api/auth/verify-otp` `{ email, code }` → `{ token, user }` (marks verified).
- `POST /api/auth/login`     `{ email, password }` → `{ token, user }` (requires verified).
- `GET  /api/auth/me`        (Bearer token) → `{ user }`.
- `POST /api/orders`         (Bearer) `{ device, service, imei, amount, eta }` → creates an order.
- `GET  /api/orders`         (Bearer) → the user's orders.
- `POST /api/payments/midtrans/create` (Bearer) `{ order_id }` → Snap `{ token, redirect_url }`.
- `POST /api/payments/midtrans/notify` → Midtrans webhook → updates order status.

Set `JWT_SECRET` (long random string) and, for payments, `MIDTRANS_SERVER_KEY`.

### Payments (Midtrans Snap) end-to-end
1. Backend: set `MIDTRANS_SERVER_KEY` (+ `MIDTRANS_IS_PRODUCTION=1` for live).
2. Frontend: set `CONFIG.midtransClientKey` (and `midtransProduction`) in `../app.js` — this is the
   **client** key (safe for the browser); the **server** key stays in the backend only.
3. Checkout flow: the Pay button creates the order → requests a Snap token → opens the Snap popup.
   On success the user goes to tracking; the final order status is set by the webhook.
4. Webhook: point Midtrans **Payment Notification URL** to `POST /api/payments/midtrans/notify`.
   The signature is verified as `sha512(order_id + status_code + gross_amount + serverKey)`.
   Tested: valid signature → `Processing`; invalid → `403`.

Data is stored in `data/activatepro.db` (SQLite). For production, point `DB_FILE` elsewhere or
swap `db.js` for PostgreSQL.

---

## IMEI verification backend

This backend is what turns IMEI validation from **format-only** into a **real device check**.

## Why a backend is required
- The browser can only verify the **Luhn checksum** — that a 15-digit number is *well-formed*.
  Anyone can generate a Luhn-valid number, so this proves nothing about a real device.
- A **real** check (model, Find My iPhone / FMI, blacklist, warranty) requires querying
  Apple **GSX** or an IMEI-checker provider. Those use a **secret API key** that must
  **never** be placed in front-end JavaScript (it would be stolen instantly).
- So the secret key + provider call live here, on the server.

## Setup
```bash
cd server
cp .env.example .env      # fill in your provider keys
npm install
npm start                 # → http://localhost:8787
```

## Connect the frontend
In `../app.js`, set:
```js
const CONFIG = { imeiApiBase: 'http://localhost:8787' };
```
The Validate button will then call `POST /api/imei/check` and display **real** results.
Leave `imeiApiBase` empty to stay in honest offline mode (format + checksum only — no fake status).

## Providers
Set `IMEI_PROVIDER` in `.env`:
- `mock`       — deterministic fake data, clearly labeled "NOT REAL". UI testing only.
- `imeilookup` — imeilookup.com (advertises a FREE tier, rate-limited). Needs `IMEILOOKUP_API_KEY`. Field mapping in `checkImeilookup()` may need tweaking to match your plan's docs.
- `sickw`      — https://sickw.com/api  (paid; needs `SICKW_API_KEY`, `SICKW_SERVICE_ID`).
- `dhru`       — any DHRU Fusion API e.g. ifreeicloud (paid; needs `DHRU_*`).

## Free TAC model lookup (no API key, no cost)
A bundled open-source TAC database (`data/tacdb.json`, ~27k devices, from VTSTech/IMEIDB)
identifies the device **model** and **manufacturer** from the first 8 digits — for free.

`POST /api/imei/tac`  body `{ "imei": "356699080000002" }`
```json
{ "tac": "35669908", "manufacturer": "Apple", "model": "iPhone 8 Rose Gold 64GB (A1863)", "source": "TAC database (offline, free)" }
```
The same data also populates `../tac-data.js` so the **frontend identifies the model offline**
without any backend. Coverage note: this free dataset is older (good up to ~iPhone 8 / X era).
Newer models resolve to "unknown (offline)" until you use a paid provider or refresh the dataset.

To refresh the dataset:
```bash
curl -L https://raw.githubusercontent.com/VTSTech/IMEIDB/master/imeidb.csv -o imeidb.csv
# then regenerate data/tacdb.json and ../tac-data.js (see import notes)
```

> Honest summary: **model + TAC validation = free**. **FMI / blacklist / warranty (GSX) = practically paid** — only `imeilookup` offers a limited free tier.

## What's free vs paid

Provider response formats vary; the `grab()`/regex parsing in `server.js` is a starting
point — adjust the field extraction to match your provider's exact payload.

## API
`POST /api/imei/check`  body `{ "imei": "356789104253871" }`
Returns:
```json
{ "model": "...", "fmi": "ON|OFF", "blacklist": "Clean|Blacklisted", "warranty": "...", "source": "sickw" }
```
Returns `400` if the IMEI fails Luhn, `502` if the provider lookup fails.

`POST /api/imei/tac`  body `{ "imei": "..." }` → free offline model lookup (see above).

`GET /health` → `{ "ok": true, "provider": "..." }`

## OTP email verification (Brevo)
Sends a 6-digit code to the user's email via Brevo's Transactional Email API.

Setup:
1. In Brevo → **SMTP & API → API Keys**, create a key → set `BREVO_API_KEY`.
2. In Brevo → **Senders, Domains & Dedicated IPs**, verify a sender email → set `BREVO_SENDER_EMAIL` to it (unverified senders are rejected by Brevo).
3. Optionally set `BREVO_SENDER_NAME` and `OTP_TTL_SECONDS`.

Endpoints:
- `POST /api/auth/send-otp`  `{ "email": "user@x.com", "name": "Iqbal" }` → emails a code, returns `{ ok: true, ttl }`.
- `POST /api/auth/verify-otp` `{ "email": "user@x.com", "code": "123456" }` → `{ ok: true, verified: true }` or an error.

Behavior: codes expire (default 5 min), are single-use, max 5 attempts, and resends are throttled to 1 per 30s.
Set `OTP_DEV_RETURN=1` to return the code in the API response for local testing **without** sending email (never enable in production).

Connect the frontend: set `CONFIG.apiBase` in `../app.js` to this server's URL. The Register → Verify
flow then sends and checks real codes. Leave `apiBase` empty to keep the offline demo behavior.

> Note: OTP codes are stored in-memory — fine for a single dev instance. For production use Redis or a DB.
