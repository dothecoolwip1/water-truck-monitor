import type { Db } from '../db.js';

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'yesno' | 'choice';
  options?: string[];
  required?: boolean;
}

export interface Settings {
  company: { name: string; address: string; phone: string; email: string; tax_number: string };
  tax: { label: string; rate: number };
  invoice: { terms_days: number; footer: string; prefix: string };
  approvals: { auto: boolean; meter_tolerance_l: number; require_at_site: boolean; max_over_tank_pct: number };
  portal: { enabled: boolean; max_litres: number; message: string };
  form: { fields: FormField[] };
  inspection: { required: boolean; items: string[] };
  alerts: { sms: boolean; email: boolean; on_scheduled: boolean; on_en_route: boolean; on_completed: boolean };
  classes: { key: string; label: string }[];
  depot: { lat: number | null; lng: number | null; label: string };
  forecast: { warn_days: number };
  quickbooks: { realm_id: string | null; refresh_token: string | null; connected_at: string | null; company_name: string | null };
}

export const DEFAULT_INSPECTION = [
  'Tires and wheels', 'Lights and signals', 'Brakes and air system', 'Hoses, nozzle and couplings', 'Pump runs and holds pressure',
  'Meter seal intact', 'Tank heat and heat trace working', 'No leaks under the truck', 'Fire extinguisher and first aid kit', 'Mirrors, wipers and horn',
];

export const DEFAULT_SETTINGS: Settings = {
  company: { name: 'Water Delivery', address: '', phone: '', email: '', tax_number: '' },
  tax: { label: 'GST', rate: 0.05 },
  invoice: { terms_days: 30, footer: 'Thank you.', prefix: 'INV-' },
  approvals: { auto: true, meter_tolerance_l: 25, require_at_site: true, max_over_tank_pct: 10 },
  portal: { enabled: true, max_litres: 20000, message: '' },
  form: { fields: [] },
  inspection: { required: true, items: DEFAULT_INSPECTION },
  alerts: { sms: false, email: false, on_scheduled: true, on_en_route: true, on_completed: true },
  classes: [
    { key: 'residential', label: 'Residential' }, { key: 'public_housing', label: 'Public housing' },
    { key: 'commercial', label: 'Commercial' }, { key: 'institutional', label: 'Government and institutions' },
  ],
  depot: { lat: null, lng: null, label: 'Water plant' },
  forecast: { warn_days: 3 },
  quickbooks: { realm_id: null, refresh_token: null, connected_at: null, company_name: null },
};

/** Settings without secrets, for the office app. */
export function publicSettings(s: Settings) {
  return { ...s, quickbooks: { connected: !!s.quickbooks.refresh_token, realm_id: s.quickbooks.realm_id, connected_at: s.quickbooks.connected_at, company_name: s.quickbooks.company_name } };
}

type Plain = Record<string, unknown>;
function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out: Plain = { ...(base as Plain) };
  for (const [k, v] of Object.entries(over as Plain)) {
    const b = (base as Plain)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, v) : v;
  }
  return out as T;
}

export async function getSettings(db: Db): Promise<Settings> {
  const { rows } = await db.query('select data from settings where id = 1');
  return merge(DEFAULT_SETTINGS, rows[0]?.data);
}

export async function updateSettings(db: Db, patch: unknown): Promise<Settings> {
  const current = await getSettings(db);
  const next = merge(current, patch);
  await db.query(
    `insert into settings (id, data, updated_at) values (1, $1, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [JSON.stringify(next)],
  );
  return next;
}
