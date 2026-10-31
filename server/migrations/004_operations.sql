-- Truck uptime: daily inspections and maintenance.
alter table trucks add column if not exists odometer_km numeric(10,1);
alter table trucks add column if not exists engine_hours numeric(10,1);
alter table trucks add column if not exists out_of_service boolean not null default false;
alter table trucks add column if not exists out_of_service_reason text;

create table if not exists inspections (
  id uuid primary key default gen_random_uuid(),
  client_id text unique,
  truck_id uuid not null references trucks(id),
  driver_id uuid references users(id),
  at timestamptz not null default now(),
  odometer_km numeric(10,1),
  engine_hours numeric(10,1),
  items jsonb not null default '[]',
  defects integer not null default 0,
  safe boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists inspections_truck_at on inspections (truck_id, at desc);

create table if not exists maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references trucks(id) on delete cascade,
  name text not null,
  every_km integer,
  every_hours integer,
  every_days integer,
  last_done_at date,
  last_done_km numeric(10,1),
  last_done_hours numeric(10,1),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists maintenance_log (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references trucks(id) on delete cascade,
  task_id uuid references maintenance_tasks(id) on delete set null,
  title text not null,
  done_at date not null default current_date,
  odometer_km numeric(10,1),
  engine_hours numeric(10,1),
  cost numeric(12,2),
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists maintenance_log_truck on maintenance_log (truck_id, done_at desc);

-- Forecasting: which places must never run dry.
alter table sites add column if not exists critical boolean not null default false;

-- Resident alerts (opt-in) and customer classes for consistent pricing.
alter table customers add column if not exists customer_class text not null default 'residential';
alter table customers add column if not exists notify_sms boolean not null default false;
alter table customers add column if not exists notify_email boolean not null default false;
alter table customers add column if not exists qbo_id text;

create table if not exists class_rates (
  customer_class text not null,
  price_item_id uuid not null references price_items(id) on delete cascade,
  unit_price numeric(12,4) not null,
  primary key (customer_class, price_item_id)
);

create table if not exists outbound_messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  channel text not null,               -- sms | email
  recipient text not null,
  subject text,
  body text not null,
  status text not null default 'queued', -- sent | failed | skipped
  error text,
  kind text,                            -- scheduled | en_route | completed | notice
  created_at timestamptz not null default now()
);
create index if not exists outbound_messages_created on outbound_messages (created_at desc);
create unique index if not exists outbound_messages_once on outbound_messages (job_id, kind, channel) where job_id is not null;

-- QuickBooks Online links.
alter table price_items add column if not exists qbo_id text;
alter table invoices add column if not exists qbo_id text;
alter table invoices add column if not exists qbo_synced_at timestamptz;
