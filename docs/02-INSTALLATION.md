# 02 · Instalasi & Konfigurasi

Lokasi project: `C:\code\Okta Reporting Dashboard`. Database: **PostgreSQL** (mis. Clever Cloud, atau container `postgres` dari docker compose).

## A. Siapkan PostgreSQL

Isi `DATABASE_URL=postgresql://user:password@host:port/database` di `.env`. Tabel (satu tabel JSONB per model) dan index dibuat otomatis saat aplikasi pertama kali memakainya — tidak perlu migrasi manual.

## B. Jalankan aplikasi (lokal)

Prasyarat: Node.js ≥ 18.18 (diuji Node 20 & 24).

```powershell
cd "C:\code\Okta Reporting Dashboard"
npm install
npm run dev                  # development: http://localhost:3000
# atau produksi:
npm run build; npm start
```

`.env` memakai `DATABASE_URL` (PostgreSQL). Untuk email tanpa Docker, isi SMTP asli (mis. Office 365 / Gmail) di Settings › Integrations, atau jalankan Mailpit lokal (`winget install axllent.mailpit`).

## C. Opsional — app + PostgreSQL di Docker

```powershell
docker compose up -d --build
docker compose logs -f app
```

`docker-compose.yml` menjalankan `app`, `postgres` dan `mailpit` (SMTP test, inbox http://localhost:8025). Container app memakai `DATABASE_URL=postgresql://iga:iga@postgres:5432/okta_iga`; hapus baris itu di compose untuk memakai `DATABASE_URL` dari `.env`.

> Untuk produksi: gunakan SMTP asli, set `APP_BASE_URL` ke URL HTTPS, dan pasang reverse proxy dengan TLS. Cookie session otomatis `Secure` bila `APP_BASE_URL` diawali `https`.

## Variabel environment

| Variabel | Default | Keterangan |
|---|---|---|
| `APP_BASE_URL` | `http://localhost:3000` | Dipakai untuk link di email & redirect SSO |
| `AUTH_SECRET` | — | Kunci HMAC JWT session. **Wajib diganti.** |
| `TZ` | `Asia/Jakarta` | Zona waktu scheduler cron |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | `admin@iga.local` / `Admin123!` | Admin awal (dibuat sekali bila belum ada) |
| `SEED_DEMO_DATA` | `true` | Isi data demo bila koleksi identities kosong |
| `DATABASE_URL` | — | Koneksi PostgreSQL. **Wajib.** |
| `PG_POOL_MAX` | `3` (`1` di Vercel) | Maksimum koneksi per instance — sesuaikan dengan batas koneksi database |
| `PGSSL` | otomatis | SSL aktif kecuali host `localhost`; `false` untuk mematikan |
| `OKTA_ORG_URL` | — | `https://<org>.okta.com` (tanpa `/` di akhir) |
| `OKTA_API_TOKEN` | — | Token Management API (SSWS) |
| `OKTA_REMEDIATION_ENABLED` | `false` | `true` = keputusan *Revoke* mencabut akses langsung di Okta |
| `OKTA_SYNC_INTERVAL_HOURS` | `6` | Sync otomatis; `0` = nonaktif |
| `OKTA_CLIENT_ID` / `OKTA_CLIENT_SECRET` | — | Opsional, mengaktifkan tombol *Sign in with Okta* |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_SECURE` `SMTP_FROM` | Mailpit | Pengiriman email |
| `SLACK_WEBHOOK_URL` | — | Incoming webhook channel default |
| `SLACK_BUSINESS_OWNER_WEBHOOK_URL` | — | Incoming webhook channel Business Owner |

Semua nilai Okta / SMTP / Slack juga bisa diubah dari **Settings › Integrations** (disimpan di koleksi `settings`, menimpa nilai `.env`).

## Keamanan

- `.env` berisi token Okta — sudah masuk `.gitignore` dan `.dockerignore` (tidak ikut ke image).
- Token yang pernah dibagikan di luar sistem (chat, email, tiket) sebaiknya **di-rotate** di Okta Admin › Security › API › Tokens.
- Gunakan token dari akun service dengan role minimum: *Read-only Admin* cukup untuk sync; remediasi butuh *Group Admin* / *App Admin* (atau Super Admin) pada resource terkait.

## Troubleshooting

| Gejala | Penyebab / solusi |
|---|---|
| Login: "Database tidak tersedia" | `DATABASE_URL` belum diset / salah, atau database tidak bisa dijangkau. |
| Error `too many connections` / `connection timeout` | Batas koneksi database tercapai (Clever Cloud DEV: 5). Turunkan `PG_POOL_MAX` atau naikkan paket database. |
| Build gagal mengunduh font | `next/font` mengunduh Google Fonts saat build — pastikan build punya akses internet. |
| Sync Okta: `OKTA_ORG_URL belum dikonfigurasi` | Isi org URL asli (bukan `your-org`). |
| Sync Okta: `Okta API 401` | Token salah / dicabut. Buat token baru. |
| Sync Okta: `Okta API 403` | Role pemilik token kurang (minimal Read-only Admin). |
| Email tidak terkirim | Lihat **Workflows › Notification log**; status `skipped` = SMTP belum dikonfigurasi. |
| Slack `skipped` | Webhook belum diisi di Settings › Integrations. |
