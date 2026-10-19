import { route, ADMIN } from '@/lib/api';
import { executiveSummary } from '@/lib/metrics';
import { kpiBlocks, postSlack } from '@/lib/slack';
import { sendMail } from '@/lib/mailer';
import { getConfig } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { escapeHtml, fmtDate } from '@/lib/util';

export const dynamic = 'force-dynamic';

/** Kirim Executive Summary ke Slack Business Owner (+ email business owners). */
export const POST = route(async ({ user }) => {
  const s = await executiveSummary();
  const cfg = await getConfig();
  const pick = ['identities', 'nonHuman', 'highRisk', 'orgRisk', 'sodOpen', 'certCompletion', 'overdue', 'activeCampaigns', 'privileged', 'dormant'];
  const kpis = s.kpis.filter((k: any) => pick.includes(k.key));
  const title = `Identity Governance — Executive Summary ${fmtDate(new Date())}`;
  const slack = await postSlack(title, { target: 'business_owner', blocks: kpiBlocks(title, kpis, `<${cfg.app.baseUrl}/dashboard|Buka Executive Dashboard>`), event: 'digest.business_owner' });
  let email: any = null;
  if (cfg.businessOwners.length) {
    email = await sendMail({
      to: cfg.businessOwners,
      subject: title,
      html: `<table style="border-collapse:collapse">${kpis.map((k: any) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(k.label)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600">${k.value}</td></tr>`).join('')}</table>`,
      event: 'digest.business_owner',
    });
  }
  await audit(user.email, 'digest.business_owner', 'slack', { slack: slack.ok, email: email?.ok });
  return { slack, email };
}, ADMIN);
