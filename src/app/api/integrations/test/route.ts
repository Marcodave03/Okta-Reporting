import { route, ADMIN, HttpError } from '@/lib/api';
import { testOktaConnection } from '@/lib/okta';
import { sendMail } from '@/lib/mailer';
import { postSlack, uploadSlackFiles } from '@/lib/slack';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ body, user }) => {
  switch (body?.channel) {
    case 'okta':
      try {
        return await testOktaConnection();
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    case 'smtp':
      return sendMail({ to: String(body.to || '').trim() || user.email, subject: 'Test email IGA Platform', html: `<p>Konfigurasi SMTP berhasil ✅</p><p style="color:#888">Dikirim oleh ${user.email} pada ${new Date().toISOString()}</p>`, event: 'test' });
    case 'slack':
      return postSlack(':white_check_mark: Test notifikasi dari IGA Platform', { target: 'default', event: 'test' });
    case 'slack_bo':
      return postSlack(':briefcase: Test notifikasi Business Owner dari IGA Platform', { target: 'business_owner', event: 'test' });
    case 'slack_file':
      return uploadSlackFiles([{ filename: 'iga-slack-test.txt', content: Buffer.from(`Test upload file dari IGA Platform oleh ${user.email} pada ${new Date().toISOString()}\n`) }], { comment: ':paperclip: Test upload file report dari IGA Platform', event: 'test' });
    default:
      throw new HttpError(400, 'channel tidak dikenal');
  }
}, ADMIN);
