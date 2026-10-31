export type Role = 'admin' | 'dispatcher' | 'driver';
export type JobStatus = 'requested' | 'scheduled' | 'en_route' | 'arrived' | 'completed' | 'cancelled';

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
  active?: boolean;
  has_push?: boolean;
}

export interface Truck {
  id: string;
  name: string;
  plate: string | null;
  capacity_l: number;
  meter_serial: string | null;
  last_meter_reading: number | null;
  active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  account_code: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
}

export interface Site {
  id: string;
  customer_id: string;
  label: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  geofence_m: number;
  tank_capacity_l: number | null;
  access_notes: string | null;
  tags: string[];
  active: boolean;
}

export interface Tank {
  id: string;
  name: string;
  device_id: string;
  capacity_l: number;
  height_mm: number | null;
  lat: number | null;
  lng: number | null;
  geofence_m: number;
  noise_l: number;
  latest_volume_l?: number | null;
  latest_ts?: string | null;
  device_key?: string;
}

export interface Job {
  id: string;
  number: number;
  status: JobStatus;
  scheduled_date: string | null;
  requested_litres: number | null;
  priority: number;
  sort_order: number;
  notes: string | null;
  tags: string[];
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  site_id: string;
  site_label: string;
  site_address: string | null;
  site_lat: number | null;
  site_lng: number | null;
  site_access_notes: string | null;
  driver_id: string | null;
  driver_name: string | null;
  truck_id: string | null;
  truck_name: string | null;
  created_at: string;
  started_at: string | null;
  arrived_at: string | null;
  arrival_source: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  delivered_litres: number | null;
  meter_start: number | null;
  meter_end: number | null;
  recipient_name: string | null;
  delivery_notes: string | null;
  meter_photo_id: string | null;
  signature_id: string | null;
  delivered_at: string | null;
}

export interface JobDetail extends Job {
  trail: { ts: string; lat: number; lng: number; accuracy_m: number | null; speed_mps: number | null }[];
  audit: { action: string; at: string; changes: Record<string, unknown> | null; actor_name: string | null }[];
}

export interface LivePosition {
  driver_id: string;
  driver_name: string;
  truck_id: string;
  truck_name: string;
  started_at: string;
  lat: number | null;
  lng: number | null;
  ts: string | null;
  speed_mps: number | null;
  current_job_number: number | null;
}

export interface DayReport {
  day: string;
  jobs_completed: number;
  delivered_l: number;
  tank_drawn_l: number | null;
  fills_loaded_l: number | null;
  fills_reported_l: number;
  unaccounted_l: number | null;
  unaccounted_pct: number | null;
  by_truck: { truck_id: string | null; truck_name: string | null; delivered_l: number; jobs: number }[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'wt.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode); the session just won't persist.
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/auth/login') onUnauthorized();
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data?.details?.[0];
    const msg = detail ? `${data.error}: ${detail.path ? `${detail.path} ` : ''}${detail.message}` : (data?.error ?? res.statusText);
    throw new ApiError(res.status, msg, data?.details);
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, body);

/** URL for a link or <img> to an authenticated file, PDF or CSV. */
export function authedUrl(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `/api${path}${sep}token=${encodeURIComponent(getToken() ?? '')}`;
}
