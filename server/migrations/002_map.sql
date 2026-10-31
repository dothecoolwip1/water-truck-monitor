-- Building outlines from OpenStreetMap, cached so maps can draw real houses
-- and delivery points can snap to them.
create table map_buildings (
  osm_id bigint primary key,
  lat double precision not null,
  lng double precision not null,
  outline jsonb not null,          -- [[lng, lat], ...] closed ring
  kind text,                       -- OSM building tag: house, school, yes...
  name text,
  address text,
  fetched_at timestamptz not null default now()
);
create index map_buildings_lat_lng on map_buildings (lat, lng);

-- Areas already fetched, so the same box isn't asked for twice.
create table map_areas (
  id bigserial primary key,
  south double precision not null,
  west double precision not null,
  north double precision not null,
  east double precision not null,
  buildings int not null,
  fetched_at timestamptz not null default now()
);

create table app_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
