// Client-safe: definisi pilihan tampilan (theme / font / design)
export const THEMES = [
  { key: 'okta', name: 'Okta Blue', description: 'Default — mengikuti Okta Admin Console', swatch: ['#1662dd', '#ffffff', '#f5f5f6', '#1d1d21'] },
  { key: 'midnight', name: 'Midnight Dark', description: 'Mode gelap untuk SOC / ruang monitoring', swatch: ['#5b8def', '#171a21', '#0f1115', '#e6e8ee'] },
  { key: 'emerald', name: 'Emerald', description: 'Hijau tenang, nuansa compliance', swatch: ['#0f8a5f', '#ffffff', '#f3f7f5', '#14261f'] },
  { key: 'sunset', name: 'Sunset', description: 'Hangat dengan aksen oranye', swatch: ['#d9480f', '#fffdfb', '#faf6f2', '#2b1d14'] },
  { key: 'royal', name: 'Royal Purple', description: 'Sidebar ungu gelap, aksen violet', swatch: ['#6741d9', '#ffffff', '#f6f4fb', '#1f1633'] },
] as const;

export const FONTS = [
  { key: 'public-sans', name: 'Public Sans', note: 'Font Okta Odyssey' },
  { key: 'inter', name: 'Inter', note: 'Modern UI' },
  { key: 'roboto', name: 'Roboto', note: 'Material' },
  { key: 'open-sans', name: 'Open Sans', note: 'Netral & mudah dibaca' },
  { key: 'lato', name: 'Lato', note: 'Humanis' },
  { key: 'poppins', name: 'Poppins', note: 'Geometris' },
  { key: 'montserrat', name: 'Montserrat', note: 'Tegas' },
  { key: 'nunito', name: 'Nunito', note: 'Rounded' },
  { key: 'plex', name: 'IBM Plex Sans', note: 'Enterprise' },
  { key: 'source-sans', name: 'Source Sans 3', note: 'Adobe' },
] as const;

export const DESIGNS = [
  { key: 'classic', name: 'Classic', description: 'Layout Okta Admin: sidebar penuh, border tipis, sudut 6px.' },
  { key: 'compact', name: 'Compact', description: 'Sidebar ikon, kepadatan tinggi — cocok untuk analis & tabel besar.' },
  { key: 'modern', name: 'Modern', description: 'Sidebar mengambang, kartu rounded dengan bayangan lembut.' },
] as const;

export type Prefs = { theme: string; font: string; design: string };
export const DEFAULT_PREFS: Prefs = { theme: 'okta', font: 'public-sans', design: 'classic' };
export const PREFS_KEY = 'iga-prefs';
