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
}

export const DEFAULT_SETTINGS: Settings = {
  company: { name: 'Water Delivery', address: '', phone: '', email: '', tax_number: '' },
  tax: { label: 'GST', rate: 0.05 },
  invoice: { terms_days: 30, footer: 'Thank you.', prefix: 'INV-' },
  approvals: { auto: true, meter_tolerance_l: 25, require_at_site: true, max_over_tank_pct: 10 },
  portal: { enabled: true, max_litres: 20000, message: '' },
  form: { fields: [] },
};

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
