# 01 · Overview — Apa saja yang sudah dibuat

IGA Platform adalah satu aplikasi Next.js (frontend + backend API + scheduler dalam satu proses) yang membaca identitas, group, aplikasi, dan log penggunaan dari **Okta**, lalu menjalankan proses governance di atasnya. Semua data disimpan di **MongoDB**.

## Peta requirement → implementasi

| # | Requirement | Implementasi | Lokasi di aplikasi |
|---|---|---|---|
| 1 | Workflow reporting email | Workflow engine berbasis event (11 event) → email (HTML template dengan variabel) dan/atau Slack. Bisa di-enable/disable, ubah penerima, subject & body, serta tombol *Test*. Semua pengiriman dicatat di Notification log. | **Workflows & Alerts** |
| 2 | Report scheduling | Jadwal hourly / daily / weekly / monthly / quarterly / custom cron. Scheduler in-process mengeksekusi tiap menit, mengirim lampiran via email dan ringkasan ke Slack, dengan riwayat eksekusi. | **Report Schedules** |
| 3 | Dashboard reporting | 4 dashboard: Executive, Certification Status, SoD & Risk, My Dashboard — 40+ widget. | **Dashboards** |
| 4 | Integrasi Slack untuk Business Owner | Dua webhook: default (tim IAM) & **Business Owner**. Executive summary (Slack Block Kit) dikirim manual dari Executive dashboard atau terjadwal; laporan campaign selesai otomatis ke channel BO. | Executive dashboard › *Slack Business Owner*, Settings › Integrations |
| 5 | Predefined SoD → custom SoD | Library 10 kebijakan predefined (Finance P2P, R2R, Treasury, HR/Payroll, IT change, Security, IAM, Sales). *Install* apa adanya atau *Clone ke custom* lalu ubah pola regex / pilih entitlement spesifik; preview matching. | **SoD Policies** |
| 6 | Campaign dengan schedule berbasis department, application, role, risk, mover, long leaver, dll | 11 tipe scope: all, department, application, entitlement, role, risk (identity/entitlement), mover, leaver, long inactive (N hari), privileged, non-human. Launch sekarang / jadwalkan / berulang (weekly–annual). | **Certification Campaigns › New** |
| 7 | Reviewer assignment, hierarki yang dapat dikonfigurasi, reassignment | Hierarki reviewer berurutan (manager → manager-of-manager → app owner → entitlement owner → reviewer tertentu → fallback), pencegahan self-review, auto-eskalasi setelah N hari, reassignment per item / bulk dengan riwayat. **Org Hierarchy viewer** menampilkan struktur manager. | Campaign wizard, **My Reviews**, **Org Hierarchy** |
| 8 | Role discovery, role mining, role optimization (atribut user + usage data) | Mining *attribute-based* (department/title/location/employee type) dan *entitlement clustering* (Jaccard), usage-aware (Okta System Log SSO events). Optimasi: duplicate, merge (overlap ≥80%), hierarchy (subset), remove unused entitlement, retire role kecil, role coverage. | **Role Mining** |
| 9 | Executive dashboard: risiko tingkat tinggi & jenis identitas (human / non-human) | KPI total/human/non-human, org risk score, high-risk, SoD open, dormant; donut human vs non-human & tipe (human/service/bot/API); risk distribution, tren risk 90 hari, top risky identities. | **Executive Overview** |
| 10 | Dashboard status certification, overdue, completion rate | Completion per campaign, decisions, overdue campaigns & items, reviewer workload, tren keputusan 30 hari, campaign terjadwal. | **Certification Status** |
| 11 | Dashboard SoD trend, risk scoring, SoD violations | Tren 90 hari per severity, per policy, per department, histogram risk score, top violators, status pelanggaran. | **SoD & Risk** |
| 12 | Scheduling & multi export format | Export **CSV, XLSX, PDF, JSON, HTML** dari semua report, dashboard, daftar identities, violations, campaign, audit log; dan sebagai lampiran report terjadwal. | Semua halaman data |
| 13 | Customization report & dashboard | Report builder (dataset, kolom, filter, sort, limit, duplicate system report). Dashboard: ubah judul widget, urutan, lebar 1–4 kolom, show/hide, katalog widget untuk My Dashboard; layout disimpan per user. | **Reports**, tombol *Customize* di dashboard |
| + | Integrasi Okta | Management API (users, groups, apps, membership, System Log), remediasi revoke ke Okta, Okta SSO (OIDC). | Settings › Integrations |
| + | UI ala Okta + Settings theme | 5 theme, 10 font, 3 design. | **Settings › Appearance** |

## Modul pendukung

- **Identities** — inventaris identitas dengan filter tipe, department, lifecycle (joiner/mover/leaver/inactive), status Okta, dormant, risk; detail per identitas (akses + usage, pelanggaran SoD, riwayat review, rantai manager).
- **Apps & Entitlements** — set owner & risk level aplikasi/entitlement (dipakai reviewer `app_owner` / `entitlement_owner`).
- **Risk scoring** — skor 0-100 per identitas, dihitung ulang setelah sync, SoD scan, atau perubahan status violation.
- **Audit Log** — semua aksi penting (login, keputusan, policy, sync, export).
- **Users & Roles platform** — role `admin`, `reviewer`, `auditor` (read-only).
- **Demo data** — 145 identitas (133 human + 12 non-human), 20 aplikasi, 69 entitlement, 6 campaign + 2 terjadwal, role, tren 90 hari.

## Batasan yang perlu diketahui

- Scheduler berjalan di dalam proses Next.js; jalankan **1 replika** container app (bila diskalakan, pindahkan scheduler ke worker terpisah).
- Remediasi Okta mendukung group membership & app assignment; admin role Okta belum disinkronkan.
- Report menjalankan filter di memori — cocok hingga puluhan ribu baris; untuk skala jauh lebih besar perlu agregasi di MongoDB.
