import type pg from 'pg';

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Building {
  osm_id: number;
  lat: number;
  lng: number;
  outline: [number, number][];
  kind: string | null;
  name: string | null;
  address: string | null;
}

const ENDPOINTS = (process.env.OVERPASS_URLS ?? 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Box of roughly `radiusM` metres around a point. */
export function bboxAround(lat: number, lng: number, radiusM: number): Bbox {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, west: lng - dLng, north: lat + dLat, east: lng + dLng };
}

interface OverpassElement {
  type: 'way' | 'node' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

async function overpass(query: string): Promise<OverpassElement[]> {
  let lastErr: unknown = null;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'water-truck-metering/1.0' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as { elements: OverpassElement[] };
      return json.elements ?? [];
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('No Overpass endpoint configured');
}

const unescapeXml = (v: string) =>
  v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/** Parses the main OpenStreetMap API's XML into the same shape Overpass returns with `out geom`. */
export function parseOsmXml(xml: string): OverpassElement[] {
  const nodes = new Map<string, { lat: number; lon: number }>();
  for (const m of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    const id = /\bid="(-?\d+)"/.exec(m[1])?.[1];
    const lat = /\blat="([-\d.]+)"/.exec(m[1])?.[1];
    const lon = /\blon="([-\d.]+)"/.exec(m[1])?.[1];
    if (id && lat && lon) nodes.set(id, { lat: Number(lat), lon: Number(lon) });
  }
  const out: OverpassElement[] = [];
  for (const m of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const id = Number(/\bid="(\d+)"/.exec(m[1])?.[1]);
    const tags: Record<string, string> = {};
    for (const t of m[2].matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) tags[unescapeXml(t[1])] = unescapeXml(t[2]);
    if (!tags.building && !(tags.highway && tags.name)) continue;
    const geometry = [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((r) => nodes.get(r[1])).filter((g): g is { lat: number; lon: number } => !!g);
    out.push({ type: 'way', id, tags, geometry });
  }
  return out;
}

async function osmApi(b: Bbox): Promise<OverpassElement[]> {
  const url = `${process.env.OSM_API_URL ?? 'https://api.openstreetmap.org/api/0.6/map'}?bbox=${b.west},${b.south},${b.east},${b.north}`;
  const res = await fetch(url, { headers: { 'user-agent': 'water-truck-metering/1.0' }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`OpenStreetMap API ${res.status}`);
  return parseOsmXml(await res.text());
}

/** Buildings and named streets in a box: Overpass first, the main OpenStreetMap API if Overpass is slow or down. */
async function fetchElements(b: Bbox): Promise<OverpassElement[]> {
  const box = `(${b.south},${b.west},${b.north},${b.east})`;
  try {
    return await overpass(`[out:json][timeout:20];(way["building"]${box};way["highway"]["name"]${box};);out geom tags;`);
  } catch (err) {
    try {
      return await osmApi(b);
    } catch (err2) {
      throw new Error(`${(err as Error).message}; ${(err2 as Error).message}`);
    }
  }
}

function centroid(ring: [number, number][]): [number, number] {
  // Area-weighted centroid of the polygon; falls back to the vertex average.
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-14) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function distToSegmentM(lat: number, lng: number, a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  // Flat-earth projection in metres around the point; fine at street scale.
  const k = Math.cos((lat * Math.PI) / 180) * 111_320;
  const ax = (a.lon - lng) * k, ay = (a.lat - lat) * 111_320;
  const bx = (b.lon - lng) * k, by = (b.lat - lat) * 111_320;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Downloads building outlines (and street names, to describe houses without an address) for a box. */
export async function downloadBuildings(b: Bbox): Promise<Building[]> {
  const elements = await fetchElements(b);
  const streets = elements
    .filter((e) => e.tags?.highway && e.tags.name && e.geometry?.length)
    .map((e) => ({ name: e.tags!.name, pts: e.geometry! }));

  const out: Building[] = [];
  for (const e of elements) {
    if (e.type !== 'way' || !e.tags?.building || !e.geometry || e.geometry.length < 4) continue;
    const ring = e.geometry.map((g) => [g.lon, g.lat] as [number, number]);
    const [lng, lat] = centroid(ring);
    const t = e.tags;
    let address: string | null = null;
    if (t['addr:housenumber'] || t['addr:street']) {
      address = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    } else if (streets.length) {
      let best: { name: string; d: number } | null = null;
      for (const s of streets) {
        for (let i = 0; i < s.pts.length - 1; i++) {
          const d = distToSegmentM(lat, lng, s.pts[i], s.pts[i + 1]);
          if (!best || d < best.d) best = { name: s.name, d };
        }
      }
      if (best && best.d < 150) address = best.name;
    }
    out.push({ osm_id: e.id, lat, lng, outline: ring, kind: t.building === 'yes' ? null : t.building, name: t.name ?? null, address });
  }
  return out;
}

export async function storeBuildings(pool: pg.Pool | pg.PoolClient, b: Bbox, list: Building[]) {
  if (list.length) {
    await pool.query(
      `insert into map_buildings (osm_id, lat, lng, outline, kind, name, address)
       select (x->>'osm_id')::bigint, (x->>'lat')::float8, (x->>'lng')::float8, x->'outline', x->>'kind', x->>'name', x->>'address'
       from jsonb_array_elements($1::jsonb) x
       on conflict (osm_id) do update set lat = excluded.lat, lng = excluded.lng, outline = excluded.outline,
         kind = excluded.kind, name = excluded.name, address = excluded.address, fetched_at = now()`,
      [JSON.stringify(list)],
    );
  }
  await pool.query('insert into map_areas (south, west, north, east, buildings) values ($1,$2,$3,$4,$5)', [
    b.south, b.west, b.north, b.east, list.length,
  ]);
}

/**
 * Makes sure buildings for `need` are cached, downloading `fetchBox` (normally a
 * larger, grid-aligned box) if no area fetched in the last 90 days covers it. Download failures are logged, not thrown,
 * so the map still works (without outlines) when OpenStreetMap is unreachable.
 */
export async function ensureBuildings(pool: pg.Pool, need: Bbox, fetchBox: Bbox = need, log: (msg: string) => void = () => {}): Promise<void> {
  const covered = await pool.query(
    `select 1 from map_areas where south <= $1 and west <= $2 and north >= $3 and east >= $4
       and fetched_at > now() - interval '90 days' limit 1`,
    [need.south, need.west, need.north, need.east],
  );
  if (covered.rows[0]) return;
  try {
    await storeBuildings(pool, fetchBox, await downloadBuildings(fetchBox));
  } catch (err) {
    log(`Building outlines unavailable: ${(err as Error).message}`);
  }
}

export async function buildingsIn(pool: pg.Pool | pg.PoolClient, b: Bbox, limit = 4000): Promise<Building[]> {
  const { rows } = await pool.query(
    `select osm_id::float8 as osm_id, lat, lng, outline, kind, name, address from map_buildings
     where lat between $1 and $3 and lng between $2 and $4 limit $5`,
    [b.south, b.west, b.north, b.east, limit],
  );
  return rows;
}
