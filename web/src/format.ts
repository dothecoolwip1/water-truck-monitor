import type { JobStatus } from './api';

export const litres = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${Math.round(v).toLocaleString('en-CA')} L`;

export const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '—';

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const day = (d: string | null | undefined) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Unscheduled';

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  requested: 'Requested',
  scheduled: 'Scheduled',
  en_route: 'On the way',
  arrived: 'On site',
  completed: 'Delivered',
  cancelled: 'Cancelled',
};

export const STATUS_COLOR: Record<JobStatus, string> = {
  requested: '#8a6d00',
  scheduled: '#1769aa',
  en_route: '#7b3fb5',
  arrived: '#c25e00',
  completed: '#2e7d32',
  cancelled: '#777',
};
