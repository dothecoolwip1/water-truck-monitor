import type { Db } from '../db.js';
import { invoiceDetail } from './billing.js';
import { publicUrl } from './messaging.js';
import { getSettings, updateSettings, type Settings } from './settings.js';
import { HttpError } from '../http.js';

/**
 * Direct sync with QuickBooks Online through Intuit's OAuth app. Needs QBO_CLIENT_ID and
 * QBO_CLIENT_SECRET from developer.intuit.com, and QBO_ENV=production once the app is approved
 * (sandbox otherwise). Writing invoices and customers is free on Intuit's Builder tier.
 */

export const qboConfigured = () => !!(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);
const apiBase = () => (process.env.QBO_ENV === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com');
export const redirectUri = () => `${publicUrl()}/api/public/quickbooks/callback`;
const basic = () => `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64')}`;
const MINOR = 'minorversion=75';

export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID ?? '', response_type: 'code', scope: 'com.intuit.quickbooks.accounting', redirect_uri: redirectUri(), state,
  });
  return `https://appcenter.intuit.com/connect/oauth2?${q}`;
}

async function tokenCall(body: Record<string, string>) {
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { authorization: basic(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
  if (!res.ok || !j.access_token) throw new HttpError(502, `QuickBooks sign-in failed${j.error ? `: ${j.error}` : ''}`);
  return j as { access_token: string; refresh_token: string };
}

export async function connect(db: Db, code: string, realmId: string): Promise<void> {
  const t = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  await updateSettings(db, { quickbooks: { realm_id: realmId, refresh_token: t.refresh_token, connected_at: new Date().toISOString() } });
  try {
    const client = await QboClient.open(db);
    const info = await client.get<{ CompanyInfo?: { CompanyName?: string } }>(`/companyinfo/${realmId}`);
    await updateSettings(db, { quickbooks: { company_name: info.CompanyInfo?.CompanyName ?? null } });
  } catch {
    // The name is only for display.
  }
}

export async function disconnect(db: Db): Promise<void> {
  await updateSettings(db, { quickbooks: { realm_id: null, refresh_token: null, connected_at: null, company_name: null } });
}

type QboEntity = { Id: string; [k: string]: unknown };

export class QboClient {
  private memo = new Map<string, Promise<unknown>>();
  private constructor(private db: Db, private realm: string, private access: string) {}

  /** Work that doesn't change during one sync (settings, tax codes) runs once per client. */
  once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.memo.has(key)) this.memo.set(key, fn());
    return this.memo.get(key) as Promise<T>;
  }
  settings() { return this.once('settings', () => getSettings(this.db)); }

  /** Refresh tokens rotate on every use, so the new one is saved straight away. */
  static async open(db: Db): Promise<QboClient> {
    if (!qboConfigured()) throw new HttpError(400, 'QuickBooks is not set up on the server yet');
    const s = await getSettings(db);
    if (!s.quickbooks.refresh_token || !s.quickbooks.realm_id) throw new HttpError(400, 'Connect QuickBooks in Settings first');
    const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: s.quickbooks.refresh_token });
    if (t.refresh_token && t.refresh_token !== s.quickbooks.refresh_token) await updateSettings(db, { quickbooks: { refresh_token: t.refresh_token } });
    return new QboClient(db, s.quickbooks.realm_id, t.access_token);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${apiBase()}/v3/company/${this.realm}${path}${sep}${MINOR}`, {
      method,
      headers: { authorization: `Bearer ${this.access}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { Fault?: { Error?: { Message?: string; Detail?: string }[] } };
    if (!res.ok || j.Fault) {
      const e = j.Fault?.Error?.[0];
      throw new HttpError(502, `QuickBooks: ${e?.Detail ?? e?.Message ?? res.statusText}`);
    }
    return j as T;
  }
  get<T>(path: string) { return this.call<T>('GET', path); }
  post<T>(path: string, body: unknown) { return this.call<T>('POST', path, body); }

  async query<T extends QboEntity>(entity: string, where: string): Promise<T[]> {
    const q = encodeURIComponent(`select * from ${entity} where ${where} maxresults 10`);
    const r = await this.get<{ QueryResponse: Record<string, T[]> }>(`/query?query=${q}`);
    return r.QueryResponse?.[entity] ?? [];
  }
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function ensureCustomer(q: QboClient, db: Db, c: { id: string; name: string; qbo_id: string | null; email: string | null; phone: string | null }) {
  if (c.qbo_id) return c.qbo_id;
  const name = c.name.slice(0, 100);
  const found = await q.query('Customer', `DisplayName = '${esc(name)}'`);
  const id = found[0]?.Id ?? (await q.post<{ Customer: QboEntity }>('/customer', {
    DisplayName: name,
    ...(c.email ? { PrimaryEmailAddr: { Address: c.email } } : {}),
    ...(c.phone ? { PrimaryPhone: { FreeFormNumber: c.phone } } : {}),
  })).Customer.Id;
  await db.query('update customers set qbo_id = $2 where id = $1', [c.id, id]);
  return id;
}

let incomeAccount: string | null = null;
async function ensureItem(q: QboClient, db: Db, it: { id: string | null; name: string; qbo_id: string | null }) {
  if (it.qbo_id) return it.qbo_id;
  const name = it.name.slice(0, 100);
  const found = await q.query('Item', `Name = '${esc(name)}'`);
  let id = found[0]?.Id;
  if (!id) {
    if (!incomeAccount) {
      const acct = await q.query('Account', `AccountType = 'Income'`);
      incomeAccount = acct[0]?.Id ?? null;
      if (!incomeAccount) throw new HttpError(502, 'QuickBooks has no income account to post sales to');
    }
    id = (await q.post<{ Item: QboEntity }>('/item', { Name: name, Type: 'Service', IncomeAccountRef: { value: incomeAccount } })).Item.Id;
  }
  if (it.id) await db.query('update price_items set qbo_id = $2 where id = $1', [it.id, id]);
  return id;
}

/** Canadian companies need a sales tax code on every line: GST for taxable lines, Exempt otherwise. */
async function taxCodes(q: QboClient, s: Settings) {
  const pick = async (names: string[]) => {
    for (const n of names) {
      const r = await q.query('TaxCode', `Name = '${esc(n)}'`);
      if (r[0]) return r[0].Id;
    }
    return null;
  };
  return { taxable: await pick([s.tax.label, 'GST', 'HST ON']), exempt: await pick(['Exempt', 'Zero-rated', 'Out of Scope']) };
}

/** Sends one invoice to QuickBooks (once; later edits stay in this app). */
export async function pushInvoice(db: Db, invoiceId: string, client?: QboClient): Promise<{ qbo_id: string; created: boolean }> {
  const inv = await invoiceDetail(db, invoiceId);
  if (inv.qbo_id) return { qbo_id: inv.qbo_id, created: false };
  if (inv.status === 'void') throw new HttpError(409, 'A void invoice is not sent to QuickBooks');
  // Claim the invoice so a button press and a bulk sync can't both create it.
  const claim = await db.query(
    `update invoices set qbo_claimed_at = now() where id = $1 and qbo_id is null
       and (qbo_claimed_at is null or qbo_claimed_at < now() - interval '2 minutes') returning id`,
    [invoiceId],
  );
  if (!claim.rows[0]) throw new HttpError(409, 'This invoice is already being sent to QuickBooks');
  try {
    return await createInQbo(db, inv, client);
  } finally {
    await db.query('update invoices set qbo_claimed_at = null where id = $1', [invoiceId]);
  }
}

/** Voids the QuickBooks copy of an invoice, so the deliveries can be billed again without charging twice. */
export async function voidInQbo(db: Db, qboId: string): Promise<void> {
  const q = await QboClient.open(db);
  const cur = await q.get<{ Invoice: QboEntity & { SyncToken: string } }>(`/invoice/${encodeURIComponent(qboId)}`);
  await q.post('/invoice?operation=void', { Id: qboId, SyncToken: cur.Invoice.SyncToken });
}

async function createInQbo(db: Db, inv: Awaited<ReturnType<typeof invoiceDetail>>, client?: QboClient) {
  const q = client ?? (await QboClient.open(db));
  const s = await q.settings();
  const cust = (await db.query('select id, name, qbo_id, email, phone from customers where id = $1', [inv.customer_id])).rows[0];
  const customerRef = await ensureCustomer(q, db, cust);
  const codes = await q.once('taxCodes', () => taxCodes(q, s));
  const items = new Map<string, string>();
  const Line = [];
  for (const l of inv.lines) {
    const key = l.price_item_id ?? `desc:${l.description}`;
    if (!items.has(key)) {
      const p = l.price_item_id ? (await db.query('select id, name, qbo_id from price_items where id = $1', [l.price_item_id])).rows[0] : null;
      items.set(key, await ensureItem(q, db, p ?? { id: null, name: l.description, qbo_id: null }));
    }
    const code = l.taxable ? codes.taxable : codes.exempt;
    Line.push({
      DetailType: 'SalesItemLineDetail',
      Amount: Number(l.amount),
      Description: `#${l.job_number} ${l.site_label}: ${l.description}`.slice(0, 4000),
      SalesItemLineDetail: { ItemRef: { value: items.get(key) }, Qty: Number(l.quantity), UnitPrice: Number(l.unit_price), ...(code ? { TaxCodeRef: { value: code } } : {}) },
    });
  }
  const body = {
    CustomerRef: { value: customerRef },
    DocNumber: `${s.invoice.prefix}${inv.number}`.slice(0, 21),
    TxnDate: String(inv.issue_date).slice(0, 10),
    ...(inv.due_date ? { DueDate: String(inv.due_date).slice(0, 10) } : {}),
    PrivateNote: `Water deliveries ${String(inv.period_start).slice(0, 10)} to ${String(inv.period_end).slice(0, 10)}`,
    ...(inv.notes ? { CustomerMemo: { value: String(inv.notes).slice(0, 1000) } } : {}),
    Line,
  };
  const created = await q.post<{ Invoice: QboEntity }>('/invoice', body);
  await db.query('update invoices set qbo_id = $2, qbo_synced_at = now() where id = $1', [inv.id, created.Invoice.Id]);
  return { qbo_id: created.Invoice.Id, created: true };
}
