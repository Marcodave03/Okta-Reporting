# 04 · Panduan Pengguna

Role platform: **admin** (semua fitur), **reviewer** (My Reviews, dashboard, reports), **auditor** (read-only + audit log).

---

## 1. Login & navigasi

- Buka http://localhost:3000 → login dengan admin awal atau **Sign in with Okta** (bila SSO dikonfigurasi).
- Sidebar dikelompokkan seperti Okta Admin: **Dashboards · Directory · Governance · Reporting · Settings**.
- Topbar: pencarian identitas, **Sync Okta** (admin), lonceng jumlah review pending, menu user.

## 2. Dashboards

| Dashboard | Isi utama |
|---|---|
| Executive Overview | Total/human/non-human identity, org risk score, high-risk, SoD open, completion %, overdue, dormant, donut human vs non-human & tipe identitas, risk distribution, tren risk 90 hari, top risky |
| Certification Status | Active campaign, completion %, pending, overdue items/campaigns, progress per campaign, decisions, tren keputusan, reviewer workload, campaign terjadwal |
| SoD & Risk | Tren pelanggaran per severity, per policy, per department, histogram risk score, top violators |
| My Dashboard | Dashboard pribadi dari katalog semua widget |

Aksi di header dashboard:

- **PDF / XLSX / CSV** — export dataset terkait.
- **Schedule** — buka Report Schedules untuk mengirim laporan otomatis.
- **Slack Business Owner** (Executive) — kirim executive summary ke channel Business Owner.
- **Customize** — lihat [07-THEMES-CUSTOMIZATION.md](07-THEMES-CUSTOMIZATION.md).
- Ikon tabel di pojok chart menampilkan data chart sebagai tabel.
- KPI dapat diklik untuk drill-down (mis. *Non-Human Identities* → daftar identitas non-human).

## 3. Directory

- **Identities** — filter tipe (human/service/bot/API), department, lifecycle, risk, status Okta, dormant 90 hari; export. Klik baris untuk detail: profil, risk, akses + *last used*, pelanggaran SoD, riwayat certification, rantai manager.
- **Org Hierarchy** — tree manager → bawahan (expand/collapse, cari nama, filter department). Menampilkan jumlah review pending tiap orang sebagai reviewer. Inilah dasar hierarki reviewer.
- **Apps & Entitlements** — set **owner** (email) dan **risk level**/**privileged**. Owner dipakai level reviewer `app_owner` / `entitlement_owner`.

## 4. Access Certification

### Membuat campaign (admin) — Certification Campaigns › **New campaign**

1. **Informasi** — nama, deskripsi, durasi (hari) → jatuh tempo.
2. **Scope** — pilih salah satu:
   `Semua akses`, `Department`, `Application`, `Entitlement/group`, `Role`, `Risk` (identitas atau entitlement, level dipilih), `Mover`, `Leaver`, `Long inactive` (N hari), `Privileged`, `Non-human`.
   Untuk scope selain department, bisa ditambah filter department.
3. **Reviewer & hierarki** — susun level berurutan (↑↓, tambah/hapus):
   `Manager langsung` → `Manager dari manager` → `Application owner` → `Entitlement owner` → `Reviewer tertentu` → `Fallback`.
   Sistem memakai level pertama yang punya reviewer dan **bukan** identitas itu sendiri (anti self-review).
   Opsi: izinkan **reassignment**, **auto-eskalasi** (setelah N hari pindah ke level berikutnya, maks. M kali), **auto-remediation** (revoke → Okta).
4. **Jadwal** — *Launch sekarang*, *Jadwalkan* (tanggal mulai + pengulangan weekly/monthly/quarterly/semiannual/annual), atau *Draft*.
5. **Hitung preview** — jumlah item, identitas, dan distribusi reviewer sebelum launch.

Saat launch: item review dibuat, reviewer menerima email personal (*campaign.launched*), dan pengumuman ke Slack. Campaign berulang tetap berstatus `scheduled` dan membuat **instance** baru tiap periode (riwayat instance tampil di halaman campaign).

### Halaman campaign

- KPI progress, pending, approved/revoked, due date; tabel progress per reviewer; konfigurasi.
- Aksi admin: **Launch now**, **Send reminder**, **Retry remediation**, **Close**, **Cancel**, **Delete**, export item (CSV/XLSX/PDF).
- Tabel item (filter keputusan, cari identitas, hanya konflik SoD) dengan aksi per item atau bulk.

### Melakukan review — **My Reviews**

- Setiap item menampilkan *risk insight*: risk level, badge **SoD** (akses bagian pelanggaran terbuka), **privileged**, **never used / unused N hari**, lifecycle (leaver/mover/inactive).
- **Approve** (✓) — langsung.
- **Revoke** (✕) — wajib alasan; akses diremediasi sesuai konfigurasi campaign.
- **Reassign** — pindahkan ke reviewer lain (email) dengan alasan; reviewer baru dinotifikasi; riwayat tersimpan.
- Pilih banyak item dengan checkbox untuk bulk action.
- Admin dapat beralih ke *Semua reviewer (admin view)*.

### Otomasi

| Kapan | Apa |
|---|---|
| Item pending > `afterDays` sejak di-assign | Eskalasi ke level hierarki berikutnya + email *certification.escalated* |
| Campaign lewat jatuh tempo | Email *certification.overdue* ke reviewer yang masih pending (maks. 1×/24 jam) |
| Semua item diputuskan | Campaign `completed` + email ke owner & Business Owners + Slack Business Owner |

## 5. Separation of Duties

- **SoD Policies › Predefined library** — 10 template. **Install** (predefined, rule terkunci; hanya enable/severity) atau **Clone ke custom** (bisa diedit penuh).
- **Custom policy** — isi Sisi A & Sisi B dengan **pola regex** nama entitlement (otomatis mencakup group Okta baru) dan/atau **entitlement spesifik**. **Preview matching** menunjukkan entitlement yang cocok.
- **Run SoD scan** — mendeteksi identitas yang memegang ≥1 akses di A **dan** ≥1 di B. Scan juga berjalan setelah setiap sync Okta dan harian.
- **SoD Violations** — filter status/severity; aksi **Mitigate** / **Accept risk** (wajib justifikasi), **Re-open**, **Mark remediated**. Pelanggaran yang sudah tidak terdeteksi otomatis menjadi `remediated`.

## 6. Role Mining

1. Atur parameter: metode **Attribute-based** (pilih atribut: department, title, location, employee type) atau **Entitlement clustering** (Jaccard similarity), **min. support** (porsi anggota yang harus memiliki entitlement), **min. anggota**, **usage data** (abaikan entitlement tak terpakai > N hari).
2. **Run role mining** → kandidat role muncul di tab *Candidate roles* dengan confidence & anggota. Entitlement berlatar kuning = mayoritas anggota tidak memakainya.
3. **Approve** kandidat → *Active role*. Role aktif dapat dipakai sebagai scope campaign.
4. Tab **Optimization** — rekomendasi *duplicate*, *merge*, *hierarchy*, *remove entitlement*, *retire*, beserta role coverage dan jumlah akses di luar role. Tombol **Terapkan** untuk rekomendasi yang dapat dieksekusi.

## 7. Reports & Scheduling

- **Reports** — 12 report sistem + custom. **Custom report**: pilih dataset (Identities, Entitlements, Access, SoD Violations, Certification Items, Campaigns, Roles, Audit, Executive Summary), kolom, filter (sama dengan, mengandung, salah satu dari, >, <, lebih lama dari N hari, kosong), sort, limit. **Preview** lalu export **CSV / XLSX / PDF / JSON / HTML**. Report sistem bisa di-customize atau di-*duplicate*.
- **Report Schedules** — pilih report, frekuensi (hourly/daily/weekly/monthly/quarterly/custom cron), jam & hari, format lampiran (bisa lebih dari satu), penerima email, dan/atau Slack (default atau Business Owner). **Run now** untuk uji; riwayat eksekusi di bawah.

## 8. Workflows & Alerts

- Daftar rule per event. Toggle aktif, **Edit** (channel email/Slack, target Slack, penerima dinamis: reviewer terkait, campaign owner, semua admin, Business Owners + email tambahan, subject, body HTML dengan variabel `{{campaign}}`, `{{count}}`, `{{dueDate}}`, `{{link}}`, dst.), **Test** (kirim ke Anda dengan data contoh).
- **Notification log** — semua email/Slack beserta status `sent` / `failed` / `skipped`.

## 9. Settings

- **Appearance** — theme, font, design (berlaku per user).
- **Integrations** — Okta (URL, token, interval sync, remediasi, OIDC), SMTP, Slack (2 webhook), email Business Owners, base URL; tombol test & status sync.
- **Users & Roles** — tambah user lokal/SSO, ubah role, nonaktifkan.
- **Data** — load demo data, recompute analytics, reset data governance.
