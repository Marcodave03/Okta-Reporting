import { Setting } from './models';

export type IntegrationConfig = {
  okta: { orgUrl: string; apiToken: string; remediation: boolean; syncIntervalHours: number; clientId: string; clientSecret: string };
  smtp: { host: string; port: number; user: string; pass: string; secure: boolean; from: string };
  slack: { webhookUrl: string; businessOwnerWebhookUrl: string; botToken: string; channelId: string; businessOwnerChannelId: string };
  businessOwners: string[];
  app: { baseUrl: string };
};

const KEY = 'integrations';

function fromEnv(): IntegrationConfig {
  const e = process.env;
  return {
    okta: {
      orgUrl: (e.OKTA_ORG_URL || '').replace(/\/$/, ''),
      apiToken: e.OKTA_API_TOKEN || '',
      remediation: e.OKTA_REMEDIATION_ENABLED === 'true',
      syncIntervalHours: Number(e.OKTA_SYNC_INTERVAL_HOURS ?? 6),
      clientId: e.OKTA_CLIENT_ID || '',
      clientSecret: e.OKTA_CLIENT_SECRET || '',
    },
    smtp: {
      host: e.SMTP_HOST || '',
      port: Number(e.SMTP_PORT || 587),
      user: e.SMTP_USER || '',
      pass: e.SMTP_PASS || '',
      secure: e.SMTP_SECURE === 'true',
      from: e.SMTP_FROM || 'IGA Platform <iga@company.local>',
    },
    slack: {
      webhookUrl: e.SLACK_WEBHOOK_URL || '',
      businessOwnerWebhookUrl: e.SLACK_BUSINESS_OWNER_WEBHOOK_URL || '',
      botToken: e.SLACK_BOT_TOKEN || '',
      channelId: e.SLACK_CHANNEL_ID || '',
      businessOwnerChannelId: e.SLACK_BUSINESS_OWNER_CHANNEL_ID || '',
    },
    businessOwners: [],
    app: { baseUrl: e.APP_BASE_URL || 'http://localhost:3000' },
  };
}

/** Konfigurasi = env sebagai default, ditimpa oleh nilai yang disimpan via UI Settings (non-empty). */
export async function getConfig(): Promise<IntegrationConfig> {
  const base = fromEnv();
  const doc = await Setting.findOne({ key: KEY }).lean<any>();
  const saved = doc?.value || {};
  const merge = (a: any, b: any) => {
    const out = { ...a };
    for (const k of Object.keys(b || {})) if (b[k] !== '' && b[k] !== null && b[k] !== undefined) out[k] = b[k];
    return out;
  };
  return {
    okta: merge(base.okta, saved.okta),
    smtp: merge(base.smtp, saved.smtp),
    slack: merge(base.slack, saved.slack),
    businessOwners: saved.businessOwners || base.businessOwners,
    app: merge(base.app, saved.app),
  };
}

export async function saveConfig(patch: Partial<IntegrationConfig>) {
  const doc = await Setting.findOne({ key: KEY });
  const current = doc?.value || {};
  const next: any = { ...current };
  for (const section of Object.keys(patch)) {
    const val = (patch as any)[section];
    if (Array.isArray(val) || typeof val !== 'object') next[section] = val;
    else {
      next[section] = { ...(current[section] || {}) };
      for (const [k, v] of Object.entries(val)) {
        // nilai rahasia yang masih ter-mask tidak ditimpa
        if (typeof v === 'string' && v.startsWith('••••')) continue;
        next[section][k] = v;
      }
    }
  }
  await Setting.updateOne({ key: KEY }, { $set: { value: next } }, { upsert: true });
}

const mask = (s: string) => (s ? `••••${s.slice(-4)}` : '');

export async function getPublicConfig() {
  const c = await getConfig();
  return {
    ...c,
    okta: { ...c.okta, apiToken: mask(c.okta.apiToken), clientSecret: mask(c.okta.clientSecret) },
    smtp: { ...c.smtp, pass: mask(c.smtp.pass) },
    slack: { ...c.slack, webhookUrl: mask(c.slack.webhookUrl), businessOwnerWebhookUrl: mask(c.slack.businessOwnerWebhookUrl), botToken: mask(c.slack.botToken) },
  };
}

export async function getSetting<T = any>(key: string, fallback: T): Promise<T> {
  const d = await Setting.findOne({ key }).lean<any>();
  return (d?.value ?? fallback) as T;
}

export async function setSetting(key: string, value: any) {
  await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
}
