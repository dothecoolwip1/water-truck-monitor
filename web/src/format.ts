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
  en_route: 'violet',
  arrived: 'orange',
  completed: 'teal',
  cancelled: 'gray',
};

/** Hex colours for the map, readable on satellite imagery. */
export const STATUS_HEX: Record<JobStatus, string> = {
  requested: '#f59e0b',
  scheduled: '#2877eb',
  en_route: '#8b5cf6',
  arrived: '#f97316',
  completed: '#10b981',
  cancelled: '#94a3b8',
};

export const initials = (name: string | null | undefined) =>
  (name ?? '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** A stable, pleasant colour per person, for avatars. */
const AVATAR = ['#2877eb', '#10b981', '#8b5cf6', '#f97316', '#0ea5e9', '#e11d48', '#14b8a6', '#a855f7'];
export function personColor(key: string | null | undefined): string {
  let h = 0;
  for (const ch of key ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

export const money = (v: number | string | null | undefined, digits = 2) =>
  v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) });
