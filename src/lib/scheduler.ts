import { connectDB } from './db';
import { ensureBootstrap } from './bootstrap';
import { processDueSchedules } from './reports';
import { processEscalationsAndOverdue, processScheduledCampaigns } from './campaigns';
import { getConfig, getSetting } from './settings';
import { getSyncState, syncFromOkta } from './okta';
import { runSodScan } from './sod';
import { Snapshot } from './models';
import { dayKey } from './util';

const g = global as any;
const TICK_MS = 60_000;

/**
 * In-process scheduler (berjalan di container Next.js lewat instrumentation.ts).
 * Setiap menit: report schedule & campaign terjadwal. Setiap jam: eskalasi/overdue.
 * Sesuai interval: Okta sync. Harian: SoD scan + snapshot tren.
 */
export function startScheduler() {
  if (g.__igaScheduler) return;
  g.__igaScheduler = true;
  let tick = 0;
  const run = async () => {
    tick++;
    try {
      await connectDB();
      await ensureBootstrap();
      await processDueSchedules();
      await processScheduledCampaigns();
      if (tick % 60 === 1) await processEscalationsAndOverdue();

      // snapshot harian (SoD scan) bila belum ada snapshot hari ini
      if (tick % 15 === 1 && !(await Snapshot.exists({ day: dayKey() }))) await runSodScan({ notify: true });

      // Okta sync berkala
      const cfg = await getConfig();
      const hours = cfg.okta.syncIntervalHours;
      if (hours > 0 && cfg.okta.apiToken && cfg.okta.orgUrl && !cfg.okta.orgUrl.includes('your-org') && !getSyncState().running) {
        const last = await getSetting<any>('okta.lastSync', null);
        const lastAt = last?.at ? new Date(last.at).getTime() : 0;
        if (Date.now() - lastAt > hours * 3600_000) await syncFromOkta('scheduler').catch((e) => console.error('[scheduler] okta sync', e.message));
      }
    } catch (e: any) {
      console.error('[scheduler] tick failed:', e.message);
    }
  };
  setTimeout(run, 10_000);
  setInterval(run, TICK_MS);
  console.log('[scheduler] started');
}
