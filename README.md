# IGA Platform — Identity Governance terintegrasi Okta

Aplikasi **fullstack monolitik Next.js 14 (App Router) + PostgreSQL**, dijalankan dengan **Docker**, untuk Identity Governance & Administration (IGA) di atas data Okta: access certification, Separation of Duties (SoD), role mining, risk scoring, dashboard eksekutif, reporting terjadwal, serta notifikasi email & Slack.

UI mengikuti gaya **Okta Admin Console** (sidebar putih, aksen biru `#1662dd`, font Public Sans) dan bisa diganti lewat **Settings › Appearance**: **5 theme**, **10 font**, **3 design layout**.

## Quick start

Isi `DATABASE_URL` (PostgreSQL) di `.env`; tabel dibuat otomatis saat pertama dipakai:

```powershell
cd "C:\code\Okta Reporting Dashboard"
npm install
npm run dev                                # http://localhost:3000
```

Opsional — app + PostgreSQL di Docker:

```powershell
docker compose up -d --build
```

| Service | URL |
|---|---|
| Aplikasi | http://localhost:3000 |
| PostgreSQL (docker compose) | postgresql://iga:iga@localhost:5432/okta_iga |
| Mailpit (hanya bila pakai docker compose) | http://localhost:8025 |

Login awal: `admin@iga.local` / `Admin123!` (ubah via `ADMIN_EMAIL` / `ADMIN_PASSWORD` sebelum start pertama).

Bila `SEED_DEMO_DATA=true`, database kosong otomatis diisi data demo sehingga semua dashboard langsung terisi. Untuk memakai data asli: **Settings › Data › Reset**, lalu **Sync Okta**.

## Dokumentasi

| File | Isi |
|---|---|
| [docs/01-OVERVIEW.md](docs/01-OVERVIEW.md) | Ringkasan semua fitur yang dibuat & peta requirement |
| [docs/02-INSTALLATION.md](docs/02-INSTALLATION.md) | Instalasi Docker / lokal, variabel environment, troubleshooting |
| [docs/03-OKTA-INTEGRATION.md](docs/03-OKTA-INTEGRATION.md) | Cara kerja integrasi Okta (sync, usage data, remediasi, SSO) |
| [docs/04-USER-GUIDE.md](docs/04-USER-GUIDE.md) | Panduan pemakaian setiap modul langkah demi langkah |
| [docs/05-ARCHITECTURE.md](docs/05-ARCHITECTURE.md) | Arsitektur, struktur folder, model data, engine & scheduler |
| [docs/06-API-REFERENCE.md](docs/06-API-REFERENCE.md) | Daftar endpoint REST API |
| [docs/07-THEMES-CUSTOMIZATION.md](docs/07-THEMES-CUSTOMIZATION.md) | Theme, font, design & kustomisasi dashboard |

## Stack

Next.js 14 · React 18 · TypeScript · PostgreSQL (node-postgres, JSONB) · Recharts · ExcelJS · jsPDF · Nodemailer · jose (JWT) · Docker Compose.
