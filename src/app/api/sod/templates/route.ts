import { route, ADMIN } from '@/lib/api';
import { SodPolicy } from '@/lib/models';
import { installTemplate, SOD_TEMPLATES } from '@/lib/sod';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const installed = await SodPolicy.find({ isPredefined: true }, { templateKey: 1 }).lean<any[]>();
  const keys = new Set(installed.map((p) => p.templateKey));
  return { items: SOD_TEMPLATES.map((t) => ({ ...t, installed: keys.has(t.key) })) };
});

/** body: { key, mode: 'predefined' | 'custom' } — install apa adanya atau clone menjadi custom policy yang bisa diedit. */
export const POST = route(async ({ body, user }) => {
  const p = await installTemplate(body.key, body.mode === 'custom' ? 'custom' : 'predefined', user.email);
  await audit(user.email, `sod.template.${body.mode || 'predefined'}`, p.name);
  return p;
}, ADMIN);
