import type { JobStatus } from './api';

export const litres = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${Math.round(v).toLocaleString('en-CA')} L`;

export const compactLitres = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString('en-CA', { maximumFractionDigits: 2 })}M L`
    : v >= 10_000 ? `${(v / 1000).toLocaleString('en-CA', { maximumFractionDigits: 1 })}k L` : litres(v);

export const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '—';

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const day = (d: string | null | undefined) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Unscheduled';

export const longDay = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const todayIso = () => isoDate(new Date());

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : dateTime(iso);
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  requested: 'Requested',
  scheduled: 'Scheduled',
  en_route: 'On the way',
  arrived: 'On site',
  completed: 'Delivered',
  cancelled: 'Cancelled',
};

/** Mantine colour names for badges. */
export const STATUS_MANTINE: Record<JobStatus, string> = {
  requested: 'yellow',
  scheduled: 'water',
  en_route: 'grape',
  arrived: 'orange',
  completed: 'teal',
  cancelled: 'gray',
};

/** Hex colours for the map, readable on satellite imagery. */
export const STATUS_HEX: Record<JobStatus, string> = {
  requested: '#fab005',
  scheduled: '#339af0',
  en_route: '#be4bdb',
  arrived: '#fd7e14',
  completed: '#20c997',
  cancelled: '#adb5bd',
};
