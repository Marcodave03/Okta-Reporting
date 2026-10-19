import { AuditLog } from './models';

export async function audit(actor: string, action: string, target = '', details: any = {}) {
  try {
    await AuditLog.create({ actor, action, target, details, at: new Date() });
  } catch (e) {
    console.error('[audit] failed', e);
  }
}
