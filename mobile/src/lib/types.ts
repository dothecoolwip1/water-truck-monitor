export type JobStatus = 'requested' | 'scheduled' | 'en_route' | 'arrived' | 'completed' | 'cancelled';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'dispatcher' | 'driver';
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
  customer_name: string;
  customer_phone: string | null;
  site_label: string;
  site_address: string | null;
  site_lat: number | null;
  site_lng: number | null;
  site_geofence_m: number;
  site_access_notes: string | null;
  truck_id: string | null;
  truck_name: string | null;
  started_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  delivered_litres: number | null;
}

export interface Truck {
  id: string;
  name: string;
  plate: string | null;
  capacity_l: number;
  last_meter_reading: number | null;
}

export interface SourceTank {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  geofence_m: number;
}

export interface Shift {
  id: string;
  truck_id: string;
  truck_name: string;
  started_at: string;
  start_meter: number | null;
}

export interface Today {
  shift: Shift | null;
  jobs: Job[];
  trucks: Truck[];
  tanks: SourceTank[];
  server_time: string;
}

export interface PhotoRef {
  // A file kept in the app's documents folder until the delivery syncs.
  uri: string;
  mime: 'image/jpeg' | 'image/png';
}

export type Op =
  | { type: 'shift_start'; client_id: string; at: string; truck_id: string; start_meter?: number | null }
  | { type: 'shift_end'; client_id: string; at: string; end_meter?: number | null }
  | { type: 'job_start'; client_id: string; at: string; job_id: string }
  | { type: 'job_arrive'; client_id: string; at: string; job_id: string; source: 'geofence' | 'manual' }
  | {
      type: 'job_complete';
      client_id: string;
      at: string;
      job_id: string;
      litres: number;
      meter_start?: number | null;
      meter_end?: number | null;
      recipient_name?: string | null;
      notes?: string | null;
      lat?: number | null;
      lng?: number | null;
      meter_photo?: PhotoRef | null;
      signature?: PhotoRef | null;
    }
  | { type: 'fill'; client_id: string; started_at: string; ended_at: string; tank_id?: string | null; litres_reported?: number | null }
  | { type: 'gps'; client_id: string; points: GpsPoint[] };

export interface GpsPoint {
  ts: string;
  lat: number;
  lng: number;
  accuracy_m?: number | null;
  speed_mps?: number | null;
  heading?: number | null;
}

export interface Problem {
  client_id: string;
  type: Op['type'];
  error: string;
  at: string;
  job_id?: string;
}
