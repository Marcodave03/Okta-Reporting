import { connectDB } from './db';
import { ensureBootstrap } from './bootstrap';
import { processDueSchedules } from './reports';
import { processEscalationsAndOverdue, processScheduledCampaigns } from './campaigns';
import { getConfig, getSetting } from './settings';
import { getEventsState, getSyncState, pullOktaEvents, syncFromOkta } from './okta';
import { runSodScan } from './sod';
import { Snapshot } from './models';
import { dayKey } from './util';

const g = global as any;
const TICK_MS = 60_000;

/**
 * In-process scheduler (berjalan di container Next.js lewat instrumentation.ts).
 * Setiap menit: report schedule & campaign terjadwal. Setiap jam: eskalasi/overdue.
 * Sesuai interval: Okta sync. Tiap jam: SoD scan + snapshot tren + tarik System Log inkremental.
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

      // SoD scan tiap jam (dan selalu bila belum ada snapshot hari ini) → violation list & posture tetap segar
      if (tick % 60 === 1 || (tick % 15 === 1 && !(await Snapshot.exists({ day: dayKey() })))) await runSodScan({ notify: true });

      // Okta sync berkala
      const cfg = await getConfig();
      const hours = cfg.okta.syncIntervalHours;
      const oktaReady = !!(cfg.okta.apiToken && cfg.okta.orgUrl && !cfg.okta.orgUrl.includes('your-org'));
      if (hours > 0 && oktaReady && !getSyncState().running) {
        const last = await getSetting<any>('okta.lastSync', null);
        const lastAt = last?.at ? new Date(last.at).getTime() : 0;
        if (Date.now() - lastAt > hours * 3600_000) await syncFromOkta('scheduler').catch((e) => console.error('[scheduler] okta sync', e.message));
      }

      // System Log inkremental tiap jam di antara full sync: membership add/remove terbaru
      // dipakai Identity Security Posture untuk merekonstruksi pelanggaran SoD per jam.
      if (tick % 60 === 30 && oktaReady && !getSyncState().running && !getEventsState().running) {
        await pullOktaEvents().catch((e) => console.error('[scheduler] okta events', e.message));
      }
    } catch (e: any) {
      console.error('[scheduler] tick failed:', e.message);
    }
  };
  setTimeout(run, 10_000);
  setInterval(run, TICK_MS);
  console.log('[scheduler] started');
}
