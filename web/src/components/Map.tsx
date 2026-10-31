import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import MapGL, { Layer, Marker, NavigationControl, GeolocateControl, Popup, Source, type MapRef, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import { setWorkerUrl, type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { ActionIcon, Box, SegmentedControl, Text, Tooltip, useComputedColorScheme } from '@mantine/core';
import { IconFocusCentered, IconTruck } from '@tabler/icons-react';
import type { Job, LivePosition } from '../api';
import { useApi } from '../hooks';
import { STATUS_HEX, ago, litres } from '../format';
import StatusBadge from './StatusBadge';

const [defLat, defLng] = (import.meta.env.VITE_MAP_CENTER ?? '66.2565,-128.6335').split(',').map(Number);
export const DEFAULT_CENTER = { lat: defLat, lng: defLng };

// MapLibre loads its worker from next to its own script by default, which a bundler moves; point it at the bundled copy.
setWorkerUrl(workerUrl);

// Satellite imagery shows the actual houses; the street map is the fallback for poor imagery or low bandwidth.
const SATELLITE_URL = import.meta.env.VITE_SATELLITE_URL ?? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS_URL = import.meta.env.VITE_LABELS_URL ?? 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const STREETS_URL = import.meta.env.VITE_STREETS_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

type Basemap = 'satellite' | 'streets';
const BASEMAP_KEY = 'wt.basemap';

function readBasemap(): Basemap {
  try {
    return localStorage.getItem(BASEMAP_KEY) === 'streets' ? 'streets' : 'satellite';
  } catch {
    return 'satellite';
  }
}

export function makeStyle(base: Basemap): StyleSpecification {
  return {
    version: 8,
    sources: {
      satellite: { type: 'raster', tiles: [SATELLITE_URL], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      labels: { type: 'raster', tiles: [LABELS_URL], tileSize: 256, maxzoom: 19 },
      streets: { type: 'raster', tiles: [STREETS_URL], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': base === 'satellite' ? '#1d2a1f' : '#eef1ec' } },
      { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: base === 'satellite' ? 'visible' : 'none' } },
      { id: 'labels', type: 'raster', source: 'labels', layout: { visibility: base === 'satellite' ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.85 } },
      { id: 'streets', type: 'raster', source: 'streets', layout: { visibility: base === 'streets' ? 'visible' : 'none' } },
    ],
  };
}

interface BuildingProps {
  id: number;
  lat: number;
  lng: number;
  kind: string | null;
  name: string | null;
  address: string | null;
}
type BuildingFeature = GeoJSON.Feature<GeoJSON.Polygon, BuildingProps>;
type BuildingCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, BuildingProps>;

export interface PickedPoint {
  lat: number;
  lng: number;
  building: BuildingProps | null;
}

function insideRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The building a point falls in, or the nearest one within ~25 m. */
export function buildingAt(fc: BuildingCollection | undefined, lat: number, lng: number): BuildingFeature | null {
  if (!fc) return null;
  let best: BuildingFeature | null = null;
  let bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const f of fc.features) {
    const p = f.properties;
    const d = Math.hypot((p.lat - lat) * 111_320, (p.lng - lng) * 111_320 * k);
    if (d > 80) continue;
    if (insideRing(lng, lat, f.geometry.coordinates[0])) return f;
    if (d < bestD && d < 25) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

const GRID = 0.01;

/** Building outlines for the visible area, fetched by grid cell so panning reuses the cache. */
function useBuildings(bounds: [number, number, number, number] | null, zoom: number) {
  const key = useMemo(() => {
    if (!bounds || zoom < 12.5) return null;
    const [w, s, e, n] = bounds;
    const f = (v: number, up: boolean) => ((up ? Math.ceil(v / GRID) : Math.floor(v / GRID)) * GRID).toFixed(2);
    return `/map/buildings?bbox=${f(s, false)},${f(w, false)},${f(n, true)},${f(e, true)}`;
  }, [bounds, zoom]);
  return useApi<BuildingCollection>(key, { staleTime: 3_600_000, placeholderData: (prev: BuildingCollection | undefined) => prev, retry: false });
}

function JobPin({ job, active, compact }: { job: Job; active: boolean; compact: boolean }) {
  const color = STATUS_HEX[job.status];
  // Zoomed out over the whole community, numbered pins would pile up; show dots until zoomed in.
  if (compact && !active) return <div className={`wt-dot${job.priority === 2 ? ' urgent' : ''}`} style={{ ['--pin' as string]: color }} />;
  return (
    <div className={`wt-pin${active ? ' active' : ''}${job.priority === 2 ? ' urgent' : ''}`} style={{ ['--pin' as string]: color }}>
      {job.number ? <span>{job.number}</span> : <span className="wt-pin-label">{job.site_label}</span>}
    </div>
  );
}

function TruckPin({ p }: { p: LivePosition }) {
  return (
    <div className="wt-truck">
      <span className="wt-truck-icon"><IconTruck size={14} stroke={2.4} /></span>
      <span>{p.truck_name}</span>
    </div>
  );
}

interface Props {
  jobs?: Job[];
  positions?: LivePosition[];
  trail?: [number, number][];
  highlight?: string | null;
  onJobClick?: (job: Job) => void;
  /** Turns on placing a point: tapping a house snaps to it. */
  onPick?: (p: PickedPoint) => void;
  picked?: { lat: number; lng: number } | null;
  fit?: boolean;
  height?: number | string;
  radius?: number | string;
  children?: ReactNode;
}

export default function JobMap({
  jobs = [], positions = [], trail, highlight, onJobClick, onPick, picked, fit = true, height = '100%', radius = 'var(--mantine-radius-lg)', children,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [basemap, setBasemap] = useState<Basemap>(readBasemap);
  const style = useMemo(() => makeStyle(basemap), [basemap]);
  const [view, setView] = useState<{ bounds: [number, number, number, number] | null; zoom: number }>({ bounds: null, zoom: 14 });
  const [popup, setPopup] = useState<Job | null>(null);
  const scheme = useComputedColorScheme('light');
  const buildings = useBuildings(view.bounds, view.zoom);

  const pinned = jobs.filter((j) => j.site_lat !== null && j.site_lng !== null);
  const onDuty = positions.filter((p) => p.lat !== null && p.lng !== null);

  // Light up the actual house each job goes to, in the job's status colour.
  const siteBuildings = useMemo<BuildingCollection>(() => {
    const features: BuildingFeature[] = [];
    const seen = new Set<number>();
    for (const j of pinned) {
      const b = buildingAt(buildings.data, j.site_lat!, j.site_lng!);
      if (b && !seen.has(b.properties.id)) {
        seen.add(b.properties.id);
        features.push({ ...b, properties: { ...b.properties, color: STATUS_HEX[j.status], active: j.id === highlight } as BuildingProps });
      }
    }
    if (picked) {
      const b = buildingAt(buildings.data, picked.lat, picked.lng);
      if (b) features.push({ ...b, properties: { ...b.properties, color: '#ff6b6b', active: true } as BuildingProps });
    }
    return { type: 'FeatureCollection', features };
  }, [buildings.data, pinned, highlight, picked]);

  const fitPoints = useMemo(
    () => [...pinned.map((j) => [j.site_lng!, j.site_lat!] as [number, number]), ...(trail ?? []).map(([lat, lng]) => [lng, lat] as [number, number])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pinned.map((j) => j.id).join(), trail?.length],
  );

  const fitAll = useCallback(
    (animate = true) => {
      const map = mapRef.current;
      if (!map) return;
      if (picked) return map.flyTo({ center: [picked.lng, picked.lat], zoom: Math.max(map.getZoom(), 17), duration: animate ? 600 : 0 });
      if (fitPoints.length === 0) return map.flyTo({ center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat], zoom: 14.5, duration: animate ? 600 : 0 });
      if (fitPoints.length === 1) return map.flyTo({ center: fitPoints[0], zoom: 17, duration: animate ? 600 : 0 });
      const lngs = fitPoints.map((p) => p[0]);
      const lats = fitPoints.map((p) => p[1]);
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 48, maxZoom: 17, duration: animate ? 600 : 0 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fitPoints, picked?.lat, picked?.lng],
  );

  useEffect(() => {
    if (fit) fitAll();
  }, [fit, fitAll]);

  function syncView(m: MapLibreMap) {
    const b = m.getBounds();
    setView({ bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: m.getZoom() });
  }

  function onClick(e: MapLayerMouseEvent) {
    if (!onPick) return;
    const b = buildingAt(buildings.data, e.lngLat.lat, e.lngLat.lng);
    // Inside a house: use the house's centre, which is what the driver's geofence should circle.
    if (b && insideRing(e.lngLat.lng, e.lngLat.lat, b.geometry.coordinates[0])) onPick({ lat: b.properties.lat, lng: b.properties.lng, building: b.properties });
    else onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng, building: b?.properties ?? null });
  }

  function changeBasemap(v: string) {
    const next = v as Basemap;
    setBasemap(next);
    try {
      localStorage.setItem(BASEMAP_KEY, next);
    } catch {
      // Not remembered; fine.
    }
  }

  const outline = basemap === 'satellite' ? '#ffffff' : scheme === 'dark' ? '#5c5f66' : '#868e96';

  return (
    <Box pos="relative" h={height} w="100%" className="wt-map" style={{ borderRadius: radius, overflow: 'hidden', isolation: 'isolate', border: '1px solid var(--wt-border)' }}>
      <MapGL
        ref={mapRef}
        initialViewState={{ longitude: DEFAULT_CENTER.lng, latitude: DEFAULT_CENTER.lat, zoom: 14.5 }}
        mapStyle={style}
        style={{ width: '100%', height: '100%' }}
        onLoad={(e) => {
          syncView(e.target);
          if (fit) fitAll(false);
        }}
        onMoveEnd={(e) => syncView(e.target)}
        onClick={onClick}
        cursor={onPick ? 'crosshair' : undefined}
        attributionControl={{ compact: true }}
        dragRotate={false}
        touchPitch={false}
        maxZoom={19.5}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <GeolocateControl position="top-right" />
        {buildings.data && (
          <Source id="buildings" type="geojson" data={buildings.data}>
            <Layer id="buildings-fill" type="fill" paint={{ 'fill-color': outline, 'fill-opacity': basemap === 'satellite' ? 0.08 : 0.25 }} />
            <Layer id="buildings-line" type="line" paint={{ 'line-color': outline, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.4, 18, 1.4], 'line-opacity': 0.75 }} />
          </Source>
        )}
        <Source id="site-buildings" type="geojson" data={siteBuildings}>
          <Layer id="site-fill" type="fill" paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'active'], 0.75, 0.5] }} />
          <Layer id="site-line" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'active'], 3.5, 2] }} />
        </Source>
        {trail && trail.length > 1 && (
          <Source id="trail" type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trail.map(([lat, lng]) => [lng, lat]) } }}>
            <Layer id="trail-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.8 }} />
            <Layer id="trail-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': '#be4bdb', 'line-width': 4 }} />
          </Source>
        )}
        {pinned.map((j) => (
          <Marker
            key={j.id}
            longitude={j.site_lng!}
            latitude={j.site_lat!}
            anchor={view.zoom < 15.5 && j.id !== highlight && popup?.id !== j.id ? 'center' : 'bottom'}
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              if (onJobClick) setPopup(j);
            }}
            style={{ zIndex: j.id === highlight ? 3 : 1 }}
          >
            <JobPin job={j} active={j.id === highlight || popup?.id === j.id} compact={view.zoom < 15.5 && pinned.length > 1} />
          </Marker>
        ))}
        {onDuty.map((p) => (
          <Marker key={p.driver_id} longitude={p.lng!} latitude={p.lat!} anchor="center" style={{ zIndex: 4 }}>
            <Tooltip label={`${p.driver_name} · seen ${ago(p.ts)}${p.current_job_number ? ` · job #${p.current_job_number}` : ''}`} withArrow>
              <div>
                <TruckPin p={p} />
              </div>
            </Tooltip>
          </Marker>
        ))}
        {picked && (
          <Marker longitude={picked.lng} latitude={picked.lat} anchor="bottom" style={{ zIndex: 5 }}>
            <div className="wt-pin active" style={{ ['--pin' as string]: '#ff6b6b' }}><span>•</span></div>
          </Marker>
        )}
        {popup && onJobClick && (
          <Popup longitude={popup.site_lng!} latitude={popup.site_lat!} anchor="top" offset={8} onClose={() => setPopup(null)} closeButton={false} maxWidth="260px">
            <Box p={4} onClick={() => onJobClick(popup)} style={{ cursor: 'pointer' }}>
              <Text className="wt-chip-num">#{popup.number}</Text>
              <Text fw={650} size="sm" mt={2}>{popup.site_label}</Text>
              <Text size="xs" c="dimmed">{popup.site_address}</Text>
              <Box mt={8}><StatusBadge status={popup.status} /></Box>
              <Text size="xs" c="dimmed" mt={6}>{popup.driver_name ?? 'Unassigned'} · {litres(popup.delivered_litres ?? popup.requested_litres)}</Text>
              <Text size="xs" c="water" fw={650} mt={8}>Open job →</Text>
            </Box>
          </Popup>
        )}
        {children}
      </MapGL>
      <Box pos="absolute" top={10} left={10} style={{ zIndex: 2, display: 'flex', gap: 8 }}>
        <SegmentedControl
          size="xs"
          radius="xl"
          value={basemap}
          onChange={changeBasemap}
          data={[{ value: 'satellite', label: 'Satellite' }, { value: 'streets', label: 'Streets' }]}
          className="wt-map-glass"
          styles={{ indicator: { boxShadow: 'var(--mantine-shadow-sm)' } }}
        />
        <Tooltip label="Show everything">
          <ActionIcon variant="default" radius="xl" size={30} onClick={() => fitAll()} aria-label="Show everything" className="wt-map-glass">
            <IconFocusCentered size={16} />
          </ActionIcon>
        </Tooltip>
      </Box>
      {view.zoom < 12.5 && (
        <Text pos="absolute" bottom={28} left={10} size="xs" className="wt-map-hint">Zoom in to see houses</Text>
      )}
    </Box>
  );
}
