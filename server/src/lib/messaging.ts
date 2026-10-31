import { randomBytes } from 'node:crypto';
import type { Db } from '../db.js';
import { getSettings, type Settings } from './settings.js';

/**
 * Text and email messages to residents. Each one is logged in outbound_messages, including the
 * ones not sent (alerts off, no provider set up, no phone on file), so the office can see what
 * residents would have received.
 * Providers: Twilio for SMS (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM) and Resend for email
 * (RESEND_API_KEY, MAIL_FROM).
 */

export type Channel = 'sms' | 'email';
export interface SendResult { status: 'sent' | 'failed' | 'skipped'; error?: string }

export const providers = () => ({
  sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
  email: !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM),
});

export function publicUrl(): string {
  const u = process.env.PUBLIC_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');
  return u.replace(/\/$/, '');
}

/** North American numbers to E.164; anything else must already start with +. */
export function e164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+') && d.length >= 8) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

async function sendSms(to: string, body: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: process.env.TWILIO_FROM!, To: to, Body: body }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) return { status: 'sent' };
  const j = (await res.json().catch(() => null)) as { message?: string } | null;
  return { status: 'failed', error: j?.message ?? `Twilio error ${res.status}` };
}

async function sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) return { status: 'sent' };
  const j = (await res.json().catch(() => null)) as { message?: string } | null;
  return { status: 'failed', error: j?.message ?? `Resend error ${res.status}` };
}

export interface OutMessage {
  customerId: string | null;
  jobId?: string | null;
  kind: string;
  channel: Channel;
  to: string | null;
  subject: string;
  body: string;
}

/** Logs and (when allowed) sends one message. A job alert of a given kind goes out once per channel. */
export async function deliver(db: Db, m: OutMessage, s: Settings): Promise<SendResult> {
  const recipient = m.channel === 'sms' ? e164(m.to) : m.to?.trim() || null;
  // Claim the (job, kind, channel) slot first so retries and duplicate events don't send twice.
  const { rows } = await db.query(
    `insert into outbound_messages (customer_id, job_id, channel, recipient, subject, body, status, kind)
     values ($1,$2,$3,$4,$5,$6,'queued',$7) on conflict do nothing returning id`,
    [m.customerId, m.jobId ?? null, m.channel, recipient ?? m.to ?? '', m.subject, m.body, m.kind],
  );
  const id = rows[0]?.id;
  if (!id) return { status: 'skipped', error: 'Already sent' };
  let r: SendResult;
  const on = m.channel === 'sms' ? s.alerts.sms : s.alerts.email;
  if (!recipient) r = { status: 'skipped', error: m.channel === 'sms' ? 'No mobile number on file' : 'No email on file' };
  else if (!on) r = { status: 'skipped', error: `${m.channel === 'sms' ? 'Text' : 'Email'} alerts are turned off in Settings` };
  else if (!providers()[m.channel]) r = { status: 'skipped', error: `No ${m.channel === 'sms' ? 'SMS' : 'email'} provider is set up yet` };
  else {
    try {
      r = m.channel === 'sms' ? await sendSms(recipient, m.body) : await sendEmail(recipient, m.subject, m.body);
    } catch (e) {
      r = { status: 'failed', error: (e as Error).message };
    }
  }
  await db.query('update outbound_messages set status = $2, error = $3 where id = $1', [id, r.status, r.error ?? null]);
  return r;
}

const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' });

/** Status alert for one job, to the customer's opted-in channels. */
export async function alertResident(db: Db, jobId: string, status: string): Promise<void> {
  const kind = status === 'scheduled' ? 'scheduled' : status === 'en_route' ? 'en_route' : status === 'completed' ? 'completed' : null;
  if (!kind) return;
  const s = await getSettings(db);
  if (kind === 'scheduled' && !s.alerts.on_scheduled) return;
  if (kind === 'en_route' && !s.alerts.on_en_route) return;
  if (kind === 'completed' && !s.alerts.on_completed) return;
  const { rows } = await db.query(
    `select j.id, j.status, j.scheduled_date, j.driver_id, j.track_token, j.completed_at, s.label as site_label,
            c.id as customer_id, c.phone, c.email, c.notify_sms, c.notify_email, d.litres
     from jobs j join sites s on s.id = j.site_id join customers c on c.id = j.customer_id left join deliveries d on d.job_id = j.id
     where j.id = $1`,
    [jobId],
  );
  const j = rows[0];
  if (!j || j.status !== status || (!j.notify_sms && !j.notify_email)) return;
  if (kind === 'scheduled' && (!j.scheduled_date || !j.driver_id)) return;
  let token = j.track_token as string | null;
  if (!token && kind !== 'completed') {
    token = randomBytes(12).toString('base64url');
    await db.query('update jobs set track_token = coalesce(track_token, $2) where id = $1', [jobId, token]);
    token = (await db.query('select track_token from jobs where id = $1', [jobId])).rows[0].track_token;
  }
  const link = token ? ` Track it: ${publicUrl()}/track/${token}` : '';
  const org = s.company.name;
  const text =
    kind === 'scheduled' ? `${org}: your water delivery to ${j.site_label} is booked for ${dayName(String(j.scheduled_date).slice(0, 10))}.${link}`
      : kind === 'en_route' ? `${org}: the water truck is on its way to ${j.site_label}.${link}`
        : `${org}: ${Math.round(Number(j.litres ?? 0)).toLocaleString('en-CA')} L delivered to ${j.site_label}. Thank you.`;
  const subject = kind === 'scheduled' ? 'Water delivery booked' : kind === 'en_route' ? 'Your water truck is on the way' : 'Water delivered';
  if (j.notify_sms) await deliver(db, { customerId: j.customer_id, jobId, kind, channel: 'sms', to: j.phone, subject, body: text }, s);
  if (j.notify_email) await deliver(db, { customerId: j.customer_id, jobId, kind, channel: 'email', to: j.email, subject, body: text }, s);
}
