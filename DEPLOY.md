# Deploying ActivatePro

The Node backend in `server/` **also serves the frontend** (`index.html`, `app.js`, `styles.css`),
so one web service hosts the whole app + API. The browser auto-detects the backend at the same
origin — no frontend config needed.

## Option A — Render (one-click Blueprint, recommended)

1. Push this repo to GitHub (already done).
2. Go to **https://dashboard.render.com → New → Blueprint**.
3. Connect the `xrniqbl/activatepro` repo. Render reads `render.yaml` automatically.
4. Click **Apply**. Render runs `npm install` in `server/` and starts `npm start`.
5. Open **Environment** for the service and fill the blank vars you need:
   - `ADMIN_EMAILS` — your email, to become admin.
   - `BREVO_API_KEY` + `BREVO_SENDER_EMAIL` — for real OTP emails.
   - `MIDTRANS_SERVER_KEY` + `MIDTRANS_CLIENT_KEY` — for real payments.
   - `IMEI_PROVIDER=sickw` + `SICKW_API_KEY` + `SICKW_SERVICE_ID` — for real IMEI checks.
   - `JWT_SECRET` is auto-generated. Leave anything you don't use blank → that feature stays in safe demo mode.
6. After deploy, set `ALLOWED_ORIGIN` to your live URL (e.g. `https://activatepro.onrender.com`).

Your app is live at the service URL.

## Option B — Railway / Fly / VPS

Any Node host works. Settings:
- Root / working dir: `server`
- Build: `npm install`   ·   Start: `npm start`   ·   Health check: `/health`
- Set the same env vars as above.

## ⚠️ Database persistence (important)

The app uses **SQLite** at `server/data/activatepro.db`. On free/ephemeral hosts (Render free,
Railway without a volume) this file is **wiped on every redeploy** — users/orders reset.

For real production, either:
- Attach a **persistent disk/volume** and point `DB_FILE` to it, **or**
- Switch to PostgreSQL (swap `server/db.js` — exported function names stay the same).

## Local run

```bash
cd server
cp .env.example .env   # fill in keys
npm install
npm start              # → http://localhost:8787 (serves frontend + API)
```
