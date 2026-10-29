import { useMemo, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { post, type Job, type LivePosition, type User } from '../api';
import JobForm from '../components/JobForm';
import JobMap from '../components/Map';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import { useDebounced, useLive, useLoad } from '../hooks';
import { addDays, day, litres, time, todayIso } from '../format';

const QUEUE = '__queue__';

export default function Dispatch() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayIso());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ col: string; index: number } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const dayJobs = useLoad<Job[]>(`/jobs?date=${date}`, [date]);
  const queue = useLoad<Job[]>('/jobs?unscheduled=true');
  const drivers = useLoad<User[]>('/users?role=driver');
  const positions = useLoad<LivePosition[]>('/live/positions');

  const refreshJobs = useDebounced(() => {
    void dayJobs.reload();
    void queue.reload();
  }, 400);
  const refreshPositions = useDebounced(() => void positions.reload(), 300);
  const connected = useLive((e) => {
    if (e.type === 'job') refreshJobs();
    if (e.type === 'shift') refreshPositions();
    if (e.type === 'position') {
      positions.setData((prev) => {
        const list = prev ?? [];
        if (!list.some((p) => p.driver_id === e.driverId)) {
          refreshPositions();
          return list;
        }
        return list.map((p) => (p.driver_id === e.driverId ? { ...p, lat: e.lat as number, lng: e.lng as number, ts: e.ts as string } : p));
      });
    }
  });

  const columns = useMemo(() => {
    const assigned = (dayJobs.data ?? []).filter((j) => j.driver_id && j.status !== 'cancelled');
    const active = (drivers.data ?? []).filter((d) => d.active || assigned.some((j) => j.driver_id === d.id));
    return active.map((d) => ({
      driver: d,
      jobs: assigned.filter((j) => j.driver_id === d.id).sort((a, b) => a.sort_order - b.sort_order || a.number - b.number),
      onDuty: (positions.data ?? []).find((p) => p.driver_id === d.id) ?? null,
    }));
  }, [dayJobs.data, drivers.data, positions.data]);

  const queued = useMemo(() => {
    const seen = new Set<string>();
    return [...(queue.data ?? []), ...(dayJobs.data ?? []).filter((j) => !j.driver_id && j.status === 'requested')]
      .filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)))
      .sort((a, b) => b.priority - a.priority || a.number - b.number);
  }, [queue.data, dayJobs.data]);

  const allJobs = [...queued, ...columns.flatMap((c) => c.jobs)];
  const totals = {
    planned: columns.reduce((s, c) => s + c.jobs.reduce((t, j) => t + (j.requested_litres ?? 0), 0), 0),
    delivered: columns.reduce((s, c) => s + c.jobs.reduce((t, j) => t + (j.delivered_litres ?? 0), 0), 0),
    done: columns.reduce((s, c) => s + c.jobs.filter((j) => j.status === 'completed').length, 0),
    count: columns.reduce((s, c) => s + c.jobs.length, 0),
  };

  async function drop(col: string, index: number) {
    const job = allJobs.find((j) => j.id === dragId);
    setDragId(null);
    setDropAt(null);
    if (!job) return;
    const target = col === QUEUE ? queued : columns.find((c) => c.driver.id === col)?.jobs ?? [];
    const ids = target.map((j) => j.id).filter((id) => id !== job.id);
    ids.splice(Math.min(index, ids.length), 0, job.id);
    setError(null);
    try {
      await post('/jobs/reorder', {
        scheduled_date: date,
        driver_id: col === QUEUE ? null : col,
        job_ids: col === QUEUE ? [job.id] : ids,
      });
    } catch (e) {
      setError((e as Error).message);
    }
    await Promise.all([dayJobs.reload(), queue.reload()]);
  }

  const dragProps = (col: string, index: number) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.stopPropagation();
      if (dropAt?.col !== col || dropAt.index !== index) setDropAt({ col, index });
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void drop(col, index);
    },
  });

  const card = (j: Job, col: string, index: number) => {
    const movable = j.status !== 'completed';
    return (
      <div
        key={j.id}
        className={`jobcard${dragId === j.id ? ' dragging' : ''}${dropAt?.col === col && dropAt.index === index ? ' drop-before' : ''} p${j.priority}`}
        draggable={movable}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', j.id);
          setDragId(j.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropAt(null);
        }}
        onMouseEnter={() => setHighlight(j.id)}
        onMouseLeave={() => setHighlight(null)}
        onClick={() => navigate(`/jobs/${j.id}`)}
        {...dragProps(col, index)}
      >
        <div className="row spread">
          <strong>#{j.number} {j.site_label}</strong>
          <StatusBadge status={j.status} />
        </div>
        <div className="muted small">{j.customer_name !== j.site_label ? j.customer_name : j.site_address}</div>
        <div className="row spread small">
          <span>
            {j.status === 'completed' ? <strong>{litres(j.delivered_litres)}</strong> : litres(j.requested_litres)}
            {j.priority === 2 && <span className="urgent"> · urgent</span>}
          </span>
          <span className="muted">
            {j.completed_at ? `done ${time(j.completed_at)}` : j.arrived_at ? `on site ${time(j.arrived_at)}` : j.scheduled_date && col === QUEUE ? day(j.scheduled_date) : ''}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="dispatch">
      <div className="toolbar">
        <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
        {date !== todayIso() && <button className="link" onClick={() => setDate(todayIso())}>Today</button>}
        <h2>{day(date)}</h2>
        <span className="muted">
          {totals.done}/{totals.count} delivered · {litres(totals.delivered)} of {litres(totals.planned)} planned
        </span>
        <span className={`live-dot${connected ? ' on' : ''}`} title={connected ? 'Live updates on' : 'Reconnecting…'} />
        <div className="spacer" />
        <button className="primary" onClick={() => setCreating(true)}>New job</button>
      </div>
      {error && <p className="error banner">{error}</p>}
      <div className="dispatch-body">
        <div className="board">
          <section className="column queue" {...dragProps(QUEUE, queued.length)}>
            <header>
              <h3>Requests</h3>
              <span className="muted small">{queued.length} waiting</span>
            </header>
            {queued.map((j, i) => card(j, QUEUE, i))}
            {queued.length === 0 && <p className="muted small empty">No unassigned requests. Drag a job here to unassign it.</p>}
          </section>
          {columns.map((c) => (
            <section key={c.driver.id} className="column" {...dragProps(c.driver.id, c.jobs.length)}>
              <header>
                <h3>{c.driver.name}</h3>
                <span className="small">
                  {c.onDuty ? <span className="ok">On duty · {c.onDuty.truck_name}</span> : <span className="muted">Off duty</span>}
                </span>
                <span className="muted small">
                  {litres(c.jobs.reduce((s, j) => s + (j.delivered_litres ?? 0), 0))} /{' '}
                  {litres(c.jobs.reduce((s, j) => s + (j.requested_litres ?? 0), 0))}
                </span>
              </header>
              {c.jobs.map((j, i) => card(j, c.driver.id, i))}
              {c.jobs.length === 0 && <p className="muted small empty">Drag requests here to assign them.</p>}
            </section>
          ))}
          {drivers.data && columns.length === 0 && (
            <p className="muted">No drivers yet. Add them under Trucks &amp; people.</p>
          )}
        </div>
        <div className="mapwrap">
          <JobMap
            jobs={allJobs.filter((j) => j.scheduled_date === date || j.status === 'requested')}
            positions={positions.data ?? []}
            highlight={highlight}
            onJobClick={(j) => navigate(`/jobs/${j.id}`)}
          />
        </div>
      </div>
      {creating && (
        <Modal title="New delivery job" onClose={() => setCreating(false)}>
          <JobForm
            defaultDate={date}
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              void dayJobs.reload();
              void queue.reload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
