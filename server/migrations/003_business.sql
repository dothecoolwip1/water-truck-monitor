-- Business features: settings, price book, line items, approvals, invoices, comments, followers,
-- notifications, recurring jobs, resident requests.

create table settings (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
insert into settings (id) values (1) on conflict do nothing;

create table price_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  unit text not null default 'each',
  unit_price numeric(12,4) not null default 0 check (unit_price >= 0),
  -- water: priced per litre delivered; delivery: once per completed job; other: added by hand unless auto_add.
  kind text not null default 'other' check (kind in ('water', 'delivery', 'other')),
  auto_add boolean not null default false,
  taxable boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table customer_rates (
  customer_id uuid not null references customers(id) on delete cascade,
  price_item_id uuid not null references price_items(id) on delete cascade,
  unit_price numeric(12,4) not null check (unit_price >= 0),
  primary key (customer_id, price_item_id)
);

create sequence invoice_number_seq start 1001;
create table invoices (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique default nextval('invoice_number_seq'),
  customer_id uuid not null references customers(id) on delete cascade,
  period_start date,
  period_end date,
  issue_date date not null default current_date,
  due_date date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  paid_at timestamptz
);
create index invoices_customer on invoices (customer_id, created_at desc);

create table job_lines (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  price_item_id uuid references price_items(id) on delete set null,
  description text not null,
  quantity numeric(12,3) not null,
  unit text,
  unit_price numeric(12,4) not null,
  taxable boolean not null default true,
  sort smallint not null default 0
);
create index job_lines_job on job_lines (job_id);

alter table jobs
  add column approval_status text check (approval_status in ('pending', 'approved', 'rejected')),
  add column approved_by uuid references users(id),
  add column approved_at timestamptz,
  add column approval_note text,
  add column invoice_id uuid references invoices(id) on delete set null,
  add column source text not null default 'office',
  add column recurring_id uuid,
  add column track_token text unique,
  add column requester_name text,
  add column requester_phone text;
create index jobs_approval on jobs (approval_status) where approval_status = 'pending';
create index jobs_unbilled on jobs (customer_id) where approval_status = 'approved' and invoice_id is null;

alter table deliveries add column form_data jsonb;

create table job_comments (
  id uuid primary key default gen_random_uuid(),
  client_id text unique,
  job_id uuid not null references jobs(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index job_comments_job on job_comments (job_id, created_at);

create table job_followers (
  job_id uuid not null references jobs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

create table job_reads (
  job_id uuid not null references jobs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

create table notifications (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  job_id uuid references jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user on notifications (user_id, created_at desc);

create table recurring_jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  requested_litres integer check (requested_litres > 0),
  every_days smallint not null default 7 check (every_days between 1 and 90),
  -- When set (0 = Sunday … 6 = Saturday), jobs fall on these weekdays instead of every N days.
  weekdays smallint[],
  start_date date not null,
  end_date date,
  driver_id uuid references users(id) on delete set null,
  truck_id uuid references trucks(id) on delete set null,
  notes text,
  tags text[] not null default '{}',
  active boolean not null default true,
  generated_through date,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
alter table jobs add constraint jobs_recurring_fk foreign key (recurring_id) references recurring_jobs(id) on delete set null;
create unique index jobs_recurring_date on jobs (recurring_id, scheduled_date) where recurring_id is not null;
