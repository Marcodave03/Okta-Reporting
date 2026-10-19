import { getConfig } from './settings';
import { NotificationLog } from './models';

export type SlackTarget = 'default' | 'business_owner';
type SlackConfig = Awaited<ReturnType<typeof getConfig>>['slack'];

const channelFor = (slack: SlackConfig, target?: SlackTarget) => (target === 'business_owner' ? slack.businessOwnerChannelId || slack.channelId : slack.channelId);
const logTo = (target?: SlackTarget) => (target === 'business_owner' ? 'slack:business-owner' : 'slack:default');

/** Slack Web API call with the bot token; throws on `ok: false`. */
async function slackApi(token: string, method: string, body: Record<string, any>, form = false) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8' },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error}`);
  return json;
}

/** Text message: incoming webhook when configured, otherwise chat.postMessage with the bot token + channel. */
export async function postSlack(text: string, opts: { target?: SlackTarget; blocks?: any[]; event?: string } = {}) {
  const { slack } = await getConfig();
  const url = opts.target === 'business_owner' ? slack.businessOwnerWebhookUrl || slack.webhookUrl : slack.webhookUrl;
  const channel = channelFor(slack, opts.target);
  const to = logTo(opts.target);
  if (!url && !(slack.botToken && channel)) {
    await NotificationLog.create({ channel: 'slack', event: opts.event, to, subject: text.slice(0, 120), status: 'skipped', error: 'Slack webhook not configured' });
    return { ok: false, skipped: true, error: 'Slack webhook not configured' };
  }
  try {
    if (url) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.blocks ? { text, blocks: opts.blocks } : { text }),
      });
      if (!res.ok) throw new Error(`Slack HTTP ${res.status}: ${await res.text()}`);
    } else {
      await slackApi(slack.botToken, 'chat.postMessage', { channel, text, ...(opts.blocks ? { blocks: opts.blocks } : {}) });
    }
    await NotificationLog.create({ channel: 'slack', event: opts.event, to, subject: text.slice(0, 120), status: 'sent' });
    return { ok: true };
  } catch (e: any) {
    await NotificationLog.create({ channel: 'slack', event: opts.event, to, subject: text.slice(0, 120), status: 'failed', error: e.message });
    return { ok: false, error: e.message };
  }
}

/**
 * Uploads files (e.g. report attachments) to the target channel. Incoming webhooks cannot carry files,
 * so this needs the bot token (scopes chat:write + files:write) and the bot invited to the channel.
 * Uses the files.getUploadURLExternal → upload → files.completeUploadExternal flow.
 */
export async function uploadSlackFiles(files: { filename: string; content: Buffer }[], opts: { target?: SlackTarget; comment?: string; event?: string } = {}) {
  const { slack } = await getConfig();
  const channel = channelFor(slack, opts.target);
  const to = logTo(opts.target);
  const subject = `${files.length} file(s): ${files.map((file) => file.filename).join(', ')}`.slice(0, 120);
  if (!slack.botToken || !channel) {
    await NotificationLog.create({ channel: 'slack', event: opts.event, to, subject, status: 'skipped', error: 'Slack bot token / channel ID not configured' });
    return { ok: false, skipped: true, error: 'Slack bot token / channel ID not configured' };
  }
  try {
    const uploaded: { id: string; title: string }[] = [];
    for (const file of files) {
      const { upload_url, file_id } = await slackApi(slack.botToken, 'files.getUploadURLExternal', { filename: file.filename, length: String(file.content.length) }, true);
      const res = await fetch(upload_url, { method: 'POST', body: new Uint8Array(file.content) });
      if (!res.ok) throw new Error(`Slack upload ${file.filename}: HTTP ${res.status}`);
      uploaded.push({ id: file_id, title: file.filename });
    }
    await slackApi(slack.botToken, 'files.completeUploadExternal', { files: uploaded, channel_id: channel, ...(opts.comment ? { initial_comment: opts.comment } : {}) });
    await NotificationLog.create({ channel: 'slack', event: opts.event, to, subject, status: 'sent' });
    return { ok: true };
  } catch (e: any) {
    await NotificationLog.create({ channel: 'slack', event: opts.event, to, subject, status: 'failed', error: e.message });
    return { ok: false, error: e.message };
  }
}

/** Blok Slack berisi ringkasan KPI untuk Business Owner. */
export function kpiBlocks(title: string, kpis: { label: string; value: any }[], footer?: string) {
  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: title } },
    { type: 'section', fields: kpis.slice(0, 10).map((k) => ({ type: 'mrkdwn', text: `*${k.label}*\n${k.value}` })) },
  ];
  if (footer) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: footer }] });
  return blocks;
}
