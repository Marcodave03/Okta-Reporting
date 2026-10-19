# 07 · Theme, Font, Design & Kustomisasi Dashboard

## Settings › Appearance

Preferensi berlaku **per user**: disimpan di `localStorage` (diterapkan sebelum halaman dirender sehingga tidak berkedip) dan di server (`appusers.preferences`) sehingga ikut ke perangkat lain saat login.

### 5 Theme

| Key | Nama | Karakter |
|---|---|---|
| `okta` | **Okta Blue** (default) | Replika nuansa Okta Admin Console — sidebar putih, aksen `#1662dd`, latar abu muda |
| `midnight` | Midnight Dark | Mode gelap penuh untuk ruang monitoring |
| `emerald` | Emerald | Sidebar hijau tua, aksen hijau |
| `sunset` | Sunset | Hangat, aksen oranye |
| `royal` | Royal Purple | Sidebar ungu gelap, aksen violet |

Setiap theme mendefinisikan token CSS (`--primary`, `--bg`, `--surface`, `--sidebar-*`, status `--success/--warning/--danger`, palet chart `--chart-1..6`, warna severity `--sev-low..critical`) di `src/app/globals.css` pada selector `html[data-theme='…']`.

Palet chart kategorikal setiap theme sudah divalidasi dengan pengecekan lightness band, chroma, pemisahan warna untuk buta warna (CVD) dan kontras terhadap permukaan. Warna severity (low/medium/high/critical) dipisah dari palet kategorikal dan selalu disertai label teks.

### 10 Font

Public Sans (font Okta Odyssey, default) · Inter · Roboto · Open Sans · Lato · Poppins · Montserrat · Nunito · IBM Plex Sans · Source Sans 3.
Dimuat via `next/font/google` (self-hosted saat build; hanya font yang dipakai yang diunduh browser).

### 3 Design

| Key | Nama | Perubahan |
|---|---|---|
| `classic` | Classic | Layout Okta: sidebar penuh 252px dengan indikator aktif, kartu border tipis, radius 6px |
| `compact` | Compact | Sidebar ikon 64px, topbar 48px, font 13px, padding & baris tabel rapat |
| `modern` | Modern | Sidebar mengambang rounded, topbar blur transparan, kartu radius 14px dengan bayangan, tombol pill, tab segmented |

### Menambah theme baru

1. Tambahkan blok `html[data-theme='nama'] { … }` di `globals.css` (salin dari `okta`, ubah nilainya).
2. Tambahkan entri ke `THEMES` di `src/lib/themes.ts` (key, nama, deskripsi, 4 warna swatch).

## Kustomisasi dashboard

Klik **Customize** di dashboard mana pun:

| Kontrol | Fungsi |
|---|---|
| Kolom judul | Ganti nama widget |
| ↑ / ↓ | Ubah urutan |
| 1/4 – 4/4 | Lebar widget (grid 4 kolom; otomatis menyesuaikan di layar kecil) |
| 👁 | Sembunyikan / tampilkan |
| ✕ (My Dashboard) | Hapus widget |
| **Tambah widget** | Tampilkan kembali widget tersembunyi; di My Dashboard pilih dari katalog 40+ widget |
| **Simpan layout** / **Reset default** | Simpan per user di koleksi `dashboardlayouts` / kembali ke default |

Menambah widget baru: daftarkan di objek `WIDGETS` (`src/components/dashboard.tsx`) dengan `title`, `size`, `kind`, `render(metrics, colors)`, dan opsional `table()` untuk tampilan tabel. Data berasal dari `GET /api/metrics` (`src/lib/metrics.ts`).

## Kustomisasi report

**Reports › Custom report** atau ikon ✏ pada report sistem: pilih kolom, filter, sort, limit → **Simpan**. **Duplicate** membuat salinan report sistem yang bisa diubah penuh (termasuk dataset). Dataset baru dapat ditambahkan di `DATASETS` pada `src/lib/reports.ts`.
