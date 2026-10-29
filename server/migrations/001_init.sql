-- Core schema for the water truck metering system.
create extension if not exists pgcrypto;

create type user_role as enum ('admin', 'dispatcher', 'driver');
create type job_status as enum ('requested', 'scheduled', 'en_route', 'arrived', 'completed', 'cancelled');

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  phone text,
  role user_role not null,
  password_hash text not null,
  active boolean not null default true,
  push_token text,
  created_at timestamptz not null default now()
);

create table trucks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  plate text,
  capacity_l integer not null default 0,
  meter_serial text,
  last_meter_reading numeric(12,1),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_code text unique,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A delivery point: the house or building tank that a truck fills.
create table sites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  label text not null,
  address text,
  lat double precision,
  lng double precision,
  geofence_m integer not null default 75,
  tank_capacity_l integer,
  access_notes text,
  tags text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index sites_customer_idx on sites(customer_id);

-- The bulk holding tank(s) the trucks fill from, with a level sensor.
create table source_tanks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  device_id text not null unique,
  device_key_hash text not null,
  capacity_l integer not null,
  -- Used to convert a level reading (mm of water) into litres for a vertical tank.
  height_mm integer,
  lat double precision,
  lng double precision,
  geofence_m integer not null default 100,
  -- Level drops smaller than this are treated as sensor noise.
  noise_l integer not null default 200,
  created_at timestamptz not null default now()
);

create table tank_readings (
  id bigserial primary key,
  tank_id uuid not null references source_tanks(id) on delete cascade,
  ts timestamptz not null,
  level_mm numeric(10,1),
  level_pct numeric(6,2),
  volume_l numeric(12,1) not null,
  raw jsonb,
  received_at timestamptz not null default now(),
  unique (tank_id, ts)
);
create index tank_readings_ts_idx on tank_readings(tank_id, ts);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  client_id text unique,
  driver_id uuid not null references users(id),
  truck_id uuid not null references trucks(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  start_meter numeric(12,1),
  end_meter numeric(12,1)
);
create index shifts_driver_idx on shifts(driver_id, started_at desc);

create table files (
  id uuid primary key default gen_random_uuid(),
  client_id text unique,
  kind text not null,
  mime text not null,
  data bytea not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create sequence job_number_seq start 1001;

create table jobs (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique default nextval('job_number_seq'),
  customer_id uuid not null references customers(id),
  site_id uuid not null references sites(id),
  requested_litres integer,
  scheduled_date date,
  priority smallint not null default 0,
  status job_status not null default 'requested',
  truck_id uuid references trucks(id),
  driver_id uuid references users(id),
  sort_order integer not null default 0,
  notes text,
  tags text[] not null default '{}',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  arrived_at timestamptz,
  arrival_source text,
  completed_at timestamptz,
  cancelled_at timestamptz
);
create index jobs_date_idx on jobs(scheduled_date, status);
create index jobs_driver_idx on jobs(driver_id, scheduled_date);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  client_id text unique,
  job_id uuid not null unique references jobs(id) on delete cascade,
  shift_id uuid references shifts(id),
  truck_id uuid references trucks(id),
  driver_id uuid references users(id),
  litres numeric(10,1) not null check (litres >= 0),
  meter_start numeric(12,1),
  meter_end numeric(12,1),
  meter_photo_id uuid references files(id),
  signature_id uuid references files(id),
  recipient_name text,
  notes text,
  lat double precision,
  lng double precision,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index deliveries_recorded_idx on deliveries(recorded_at);

-- A truck filling at a source tank. Litres loaded come from the tank sensor;
-- the driver's meter number is kept for comparison.
create table fills (
  id uuid primary key default gen_random_uuid(),
  client_id text unique,
  shift_id uuid references shifts(id),
  truck_id uuid not null references trucks(id),
  driver_id uuid not null references users(id),
  tank_id uuid references source_tanks(id),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  litres_reported numeric(10,1),
  created_at timestamptz not null default now()
);
create index fills_started_idx on fills(started_at);

create table gps_points (
  id bigserial primary key,
  driver_id uuid not null references users(id),
  truck_id uuid references trucks(id),
  shift_id uuid references shifts(id),
  job_id uuid references jobs(id),
  ts timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m real,
  speed_mps real,
  heading real,
  unique (driver_id, ts)
);
create index gps_points_shift_idx on gps_points(shift_id, ts);
create index gps_points_job_idx on gps_points(job_id, ts);

create table audit_log (
  id bigserial primary key,
  entity text not null,
  entity_id uuid not null,
  action text not null,
  actor_id uuid references users(id),
  at timestamptz not null default now(),
  changes jsonb
);
create index audit_entity_idx on audit_log(entity, entity_id, at);
