import nodemailer from 'nodemailer';
import { getConfig } from './settings';
import { NotificationLog } from './models';

export type MailAttachment = { filename: string; content: Buffer; contentType?: string };

export async function sendMail(opts: { to: string | string[]; subject: string; html: string; attachments?: MailAttachment[]; event?: string }) {
  const to = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(Boolean);
  if (!to.length) return { ok: false, error: 'no recipients' };
  const { smtp } = await getConfig();
  if (!smtp.host) {
    await NotificationLog.create({ channel: 'email', event: opts.event, to: to.join(', '), subject: opts.subject, status: 'skipped', error: 'SMTP not configured' });
    return { ok: false, error: 'SMTP not configured' };
  }
  // di dalam container Docker, "localhost" (Mailpit saat dev) = container mailpit
  const host = ['localhost', '127.0.0.1'].includes(smtp.host) && process.env.SMTP_LOCALHOST_ALIAS ? process.env.SMTP_LOCALHOST_ALIAS : smtp.host;
  try {
    const transport = nodemailer.createTransport({
      host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      tls: { rejectUnauthorized: false },
    });
    await transport.sendMail({ from: smtp.from, to: to.join(', '), subject: opts.subject, html: wrapHtml(opts.subject, opts.html), attachments: opts.attachments });
    await NotificationLog.create({ channel: 'email', event: opts.event, to: to.join(', '), subject: opts.subject, status: 'sent' });
    return { ok: true };
  } catch (e: any) {
    await NotificationLog.create({ channel: 'email', event: opts.event, to: to.join(', '), subject: opts.subject, status: 'failed', error: e.message });
    return { ok: false, error: e.message };
  }
}

function wrapHtml(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f4;font-family:Segoe UI,Arial,sans-serif;color:#1d1d21">
  <div style="max-width:720px;margin:24px auto;background:#fff;border:1px solid #e1e1e1;border-radius:8px;overflow:hidden">
    <div style="background:#1662dd;color:#fff;padding:16px 24px;font-size:16px;font-weight:600">IGA Platform · ${title}</div>
    <div style="padding:24px;font-size:14px;line-height:1.6">${body}</div>
    <div style="padding:12px 24px;color:#6e6e78;font-size:12px;border-top:1px solid #eee">Pesan otomatis dari Identity Governance Platform (Okta integrated).</div>
  </div></body></html>`;
}
