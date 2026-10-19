import { route } from '@/lib/api';
import { listDatasets } from '@/lib/reports';
import { EXPORT_FORMATS } from '@/lib/exporters';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({
  datasets: listDatasets(),
  formats: EXPORT_FORMATS,
  operators: [
    { key: 'eq', label: 'sama dengan' },
    { key: 'ne', label: 'tidak sama dengan' },
    { key: 'contains', label: 'mengandung' },
    { key: 'in', label: 'salah satu dari (a,b,c)' },
    { key: 'gt', label: 'lebih besar dari' },
    { key: 'lt', label: 'lebih kecil dari' },
    { key: 'older_than_days', label: 'lebih lama dari N hari' },
    { key: 'empty', label: 'kosong' },
  ],
}));
