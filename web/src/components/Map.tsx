import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import type { Job, LivePosition } from '../api';
import { STATUS_COLOR, STATUS_LABEL, litres } from '../format';

// Bundlers break Leaflet's default marker image paths; point them at the bundled files.
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

const [defLat, defLng] = (import.meta.env.VITE_MAP_CENTER ?? '66.2565,-128.6335').split(',').map(Number);
export const DEFAULT_CENTER: [number, number] = [defLat, defLng];

const truckIcon = (label: string) =>
  L.divIcon({
    className: 'truck-icon',
    html: `<div><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 5h11v9h1.5l1.8-4H21l1 3v4h-2a2.5 2.5 0 0 1-5 0H9a2.5 2.5 0 0 1-5 0H2V6a1 1 0 0 1 1-1z"/></svg><span>${label.replace(/</g, '&lt;')}</span></div>`,
    iconSize: undefined as unknown as L.PointExpression,
    iconAnchor: [12, 12],
  });

function FitTo({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join(';');
  const latest = useRef(points);
  latest.current = points;

  const fit = useCallback(() => {
    const pts = latest.current;
    if (pts.length === 1) map.setView(pts[0], 15);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
  }, [map]);

  useEffect(fit, [key, fit]);

  // The page layout can change the map's size after it is drawn; refit when it does.
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      fit();
    });
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map, fit]);
  return null;
}

interface Props {
  jobs?: Job[];
  positions?: LivePosition[];
  trail?: [number, number][];
  highlight?: string | null;
  onJobClick?: (job: Job) => void;
  fit?: boolean;
  height?: number | string;
  extra?: React.ReactNode;
}

export default function JobMap({ jobs = [], positions = [], trail, highlight, onJobClick, fit = true, height = '100%', extra }: Props) {
  const jobPoints = jobs.filter((j) => j.site_lat !== null && j.site_lng !== null);
  const fitPoints: [number, number][] = [
    ...jobPoints.map((j) => [j.site_lat!, j.site_lng!] as [number, number]),
    ...(trail ?? []),
  ];
  return (
    <MapContainer center={DEFAULT_CENTER} zoom={14} style={{ height, width: '100%' }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url={import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'}
      />
      {fit && <FitTo points={fitPoints} />}
      {trail && trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: '#7b3fb5', weight: 4, opacity: 0.8 }} />}
      {jobPoints.map((j) => (
        <CircleMarker
          key={j.id}
          center={[j.site_lat!, j.site_lng!]}
          radius={highlight === j.id ? 11 : 8}
          pathOptions={{ color: '#fff', weight: 2, fillColor: STATUS_COLOR[j.status], fillOpacity: 0.95 }}
          eventHandlers={{ click: () => onJobClick?.(j) }}
        >
          <Tooltip>
            <strong>#{j.number} {j.site_label}</strong>
            <br />
            {STATUS_LABEL[j.status]} · {j.driver_name ?? 'unassigned'} · {litres(j.delivered_litres ?? j.requested_litres)}
          </Tooltip>
        </CircleMarker>
      ))}
      {positions.filter((p) => p.lat !== null).map((p) => (
        <Marker key={p.driver_id} position={[p.lat!, p.lng!]} icon={truckIcon(p.truck_name)}>
          <Tooltip>
            {p.truck_name}: {p.driver_name}
            {p.current_job_number ? ` · job #${p.current_job_number}` : ''}
            <br />
            last seen {p.ts ? new Date(p.ts).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : 'never'}
          </Tooltip>
        </Marker>
      ))}
      {extra}
    </MapContainer>
  );
}
