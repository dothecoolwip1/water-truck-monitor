import { useEffect, useMemo, useRef, useState } from 'react';
import { authedUrl, type DayReport, type Tank } from '../api';
import { useLoad } from '../hooks';
import { addDays, dateTime, day, litres, todayIso } from '../format';

interface Fill {
  id: string;
  started_at: string;
  ended_at: string;
  truck_name: string;
  driver_name: string;
  tank_name: string | null;
  litres_reported: number | null;
  litres_from_tank: number | null;
}
interface CustomerTotal {
  id: string;
  name: string;
  account_code: string | null;
  deliveries: number;
  litres: number;
}

export default function Reports() {
  const [from, setFrom] = useState(addDays(todayIso(), -13));
  const [to, setTo] = useState(todayIso());
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const range = `from=${from}&to=${to}`;
  const daily = useLoad<DayReport[]>(`/reports/daily?${range}`, [range]);
  const fills = useLoad<Fill[]>(`/reports/fills?${range}`, [range]);
  const customers = useLoad<CustomerTotal[]>(`/reports/customers?${range}`, [range]);
  const tanks = useLoad<Tank[]>('/tanks');

  const days = daily.data ?? [];
  const sum = (k: 'delivered_l' | 'jobs_completed') => days.reduce((s, d) => s + d[k], 0);
  const drawn = days.some((d) => d.tank_drawn_l !== null) ? days.reduce((s, d) => s + (d.tank_drawn_l ?? 0), 0) : null;
  const gap = drawn === null ? null : drawn - sum('delivered_l');

  return (
    <div className="page reports">
      <div className="toolbar">
        <h2>Reports</h2>
        <label className="inline">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="link" onClick={() => { setFrom(addDays(todayIso(), -6)); setTo(todayIso()); }}>Last 7 days</button>
        <button className="link" onClick={() => { setFrom(addDays(todayIso(), -29)); setTo(todayIso()); }}>Last 30 days</button>
        <div className="spacer" />
        <a className="button" href={authedUrl(`/exports/deliveries.csv?${range}`)}>Download deliveries CSV</a>
      </div>
      {daily.error && <p className="error">{daily.error}</p>}

      <div className="tiles">
        <div className="tile"><span className="muted small">Delivered</span><strong>{litres(sum('delivered_l'))}</strong></div>
        <div className="tile"><span className="muted small">Deliveries</span><strong>{sum('jobs_completed').toLocaleString('en-CA')}</strong></div>
        <div className="tile"><span className="muted small">Drawn from bulk tank</span><strong>{drawn === null ? 'No sensor' : litres(drawn)}</strong></div>
        <div className="tile">
          <span className="muted small">Not accounted for</span>
          <strong>{gap === null ? '—' : litres(gap)}</strong>
          {gap !== null && drawn ? <span className="muted small">{((gap / drawn) * 100).toFixed(1)}% of drawn</span> : null}
        </div>
      </div>

      <section className="card">
        <div className="row spread">
          <h3>Litres per day: drawn from the tank vs. delivered</h3>
          <div className="segmented">
            <button className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>Chart</button>
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button>
          </div>
        </div>
        {view === 'chart' ? <DailyChart days={days} /> : <DailyTable days={days} />}
        <p className="muted small">
          The tank sensor shows how much water left the bulk tank; drivers record what went into each customer's tank from the truck
          meter. A small gap either way is normal (water left in a truck overnight, meter rounding). A large or growing gap is worth a look.
        </p>
      </section>

      {(tanks.data ?? []).map((t) => <TankLevel key={t.id} tank={t} />)}

      <div className="grid2 wide-gap">
        <section className="card">
          <h3>Truck fills</h3>
          <table className="table small">
            <thead><tr><th>When</th><th>Truck</th><th>Driver</th><th className="num">From tank sensor</th><th className="num">Driver's meter</th></tr></thead>
            <tbody>
              {(fills.data ?? []).map((f) => (
                <tr key={f.id}>
                  <td>{dateTime(f.started_at)}</td><td>{f.truck_name}</td><td>{f.driver_name}</td>
                  <td className="num">{f.litres_from_tank === null ? <span className="muted">no reading</span> : litres(f.litres_from_tank)}</td>
                  <td className="num">{litres(f.litres_reported)}</td>
                </tr>
              ))}
              {fills.data?.length === 0 && <tr><td colSpan={5} className="muted">No fills logged in this range.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h3>By customer</h3>
          <table className="table small">
            <thead><tr><th>Customer</th><th>Account</th><th className="num">Deliveries</th><th className="num">Litres</th></tr></thead>
            <tbody>
              {(customers.data ?? []).map((c) => (
                <tr key={c.id}><td>{c.name}</td><td>{c.account_code ?? '—'}</td><td className="num">{c.deliveries}</td><td className="num">{litres(c.litres)}</td></tr>
              ))}
              {customers.data?.length === 0 && <tr><td colSpan={4} className="muted">No deliveries in this range.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function DailyTable({ days }: { days: DayReport[] }) {
  return (
    <table className="table">
      <thead>
        <tr><th>Day</th><th className="num">Deliveries</th><th className="num">Delivered</th><th className="num">Drawn from tank</th><th className="num">Not accounted for</th><th>By truck</th></tr>
      </thead>
      <tbody>
        {days.map((d) => (
          <tr key={d.day}>
            <td>{day(d.day)}</td>
            <td className="num">{d.jobs_completed}</td>
            <td className="num">{litres(d.delivered_l)}</td>
            <td className="num">{d.tank_drawn_l === null ? '—' : litres(d.tank_drawn_l)}</td>
            <td className="num">{d.unaccounted_l === null ? '—' : `${litres(d.unaccounted_l)}${d.unaccounted_pct !== null ? ` (${d.unaccounted_pct}%)` : ''}`}</td>
            <td className="small">{d.by_truck.map((t) => `${t.truck_name ?? '?'}: ${litres(t.delivered_l)}`).join(' · ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Tracks an element's width so charts draw at real pixel size and text stays legible. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const H = 260;
const PAD = { l: 64, r: 12, t: 12, b: 28 };

function niceMax(v: number): number {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

function DailyChart({ days }: { days: DayReport[] }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const hasTank = days.some((d) => d.tank_drawn_l !== null);
  const max = niceMax(Math.max(0, ...days.map((d) => Math.max(d.delivered_l, d.tank_drawn_l ?? 0))));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const slot = plotW / Math.max(days.length, 1);
  const barW = Math.max(3, Math.min(22, (slot - 8) / (hasTank ? 2 : 1) - 2));
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(days.length / Math.max(2, Math.floor(plotW / 70)));
  const h = hover !== null ? days[hover] : null;

  return (
    <div className="chart" ref={ref}>
      {days.length === 0 && <p className="muted">No data.</p>}
      <div className="legend">
        {hasTank && <span><i className="sw s2" /> Drawn from tank</span>}
        <span><i className="sw s1" /> Delivered</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Litres drawn from the tank and delivered per day" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="axis">{Math.round(t).toLocaleString('en-CA')}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const bars = hasTank
            ? [{ v: d.tank_drawn_l ?? 0, cls: 's2', x: cx - barW - 1 }, { v: d.delivered_l, cls: 's1', x: cx + 1 }]
            : [{ v: d.delivered_l, cls: 's1', x: cx - barW / 2 }];
          return (
            <g key={d.day}>
              {hover === i && <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={plotH} className="hoverband" />}
              {bars.map((b) => {
                const top = y(b.v);
                const hgt = PAD.t + plotH - top;
                return hgt > 0 ? <path key={b.cls} className={`bar ${b.cls}`} d={roundedTop(b.x, top, barW, hgt, Math.min(4, barW / 2))} /> : null;
              })}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" className="axis">
                  {new Date(`${d.day}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                </text>
              )}
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="baseline" />
      </svg>
      {h && hover !== null && (
        <div className="tooltip" style={{ left: `${((PAD.l + slot * hover + slot / 2) / W) * 100}%` }}>
          <strong>{day(h.day)}</strong>
          {h.tank_drawn_l !== null && <div><i className="sw s2" /> Drawn {litres(h.tank_drawn_l)}</div>}
          <div><i className="sw s1" /> Delivered {litres(h.delivered_l)} ({h.jobs_completed} jobs)</div>
          {h.unaccounted_l !== null && <div className="muted">Gap {litres(h.unaccounted_l)}</div>}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function TankLevel({ tank }: { tank: Tank }) {
  const readings = useLoad<{ ts: string; volume_l: number }[]>(`/tanks/${tank.id}/readings?hours=48`);
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const pts = readings.data ?? [];
  const t0 = pts.length ? new Date(pts[0].ts).getTime() : 0;
  const t1 = pts.length ? new Date(pts[pts.length - 1].ts).getTime() : 1;
  const plotW = W - PAD.l - PAD.r;
  const plotH = 160;
  const x = (ts: string) => PAD.l + ((new Date(ts).getTime() - t0) / Math.max(t1 - t0, 1)) * plotW;
  const y = (v: number) => PAD.t + plotH - (v / tank.capacity_l) * plotH;
  const path = useMemo(() => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.volume_l).toFixed(1)}`).join(''), [pts, W]); // eslint-disable-line react-hooks/exhaustive-deps

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!pts.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = t0 + ((px - PAD.l) / plotW) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(new Date(pts[i].ts).getTime() - t) < Math.abs(new Date(pts[best].ts).getTime() - t)) best = i;
    setHover(best);
  }
  const hp = hover !== null ? pts[hover] : null;

  return (
    <section className="card">
      <h3>{tank.name}: level over the last 48 hours</h3>
      <div className="chart" ref={ref}>
      {pts.length < 2 ? (
        <p className="muted">Not enough readings yet. Readings appear once the sensor starts posting to the tank feed.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${plotH + PAD.t + PAD.b}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${tank.name} level`}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(f * tank.capacity_l)} y2={y(f * tank.capacity_l)} className="grid" />
                <text x={PAD.l - 8} y={y(f * tank.capacity_l) + 4} textAnchor="end" className="axis">{Math.round(f * 100)}%</text>
              </g>
            ))}
            <path d={path} className="line s1" />
            <text x={PAD.l} y={plotH + PAD.t + 20} className="axis">{dateTime(pts[0].ts)}</text>
            <text x={W - PAD.r} y={plotH + PAD.t + 20} textAnchor="end" className="axis">{dateTime(pts[pts.length - 1].ts)}</text>
            {hp && (
              <>
                <line x1={x(hp.ts)} x2={x(hp.ts)} y1={PAD.t} y2={PAD.t + plotH} className="crosshair" />
                <circle cx={x(hp.ts)} cy={y(hp.volume_l)} r={4.5} className="dot s1" />
              </>
            )}
          </svg>
          {hp && (
            <div className="tooltip" style={{ left: `${(x(hp.ts) / W) * 100}%` }}>
              <strong>{dateTime(hp.ts)}</strong>
              <div>{litres(hp.volume_l)} ({Math.round((hp.volume_l / tank.capacity_l) * 100)}%)</div>
            </div>
          )}
        </>
      )}
      </div>
    </section>
  );
}
