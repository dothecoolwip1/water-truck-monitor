import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authedUrl, type Job, type JobStatus } from '../api';
import StatusBadge from '../components/StatusBadge';
import { useLoad } from '../hooks';
import { addDays, day, litres, STATUS_LABEL, time, todayIso } from '../format';

export default function Jobs() {
  const [from, setFrom] = useState(addDays(todayIso(), -7));
  const [to, setTo] = useState(todayIso());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const query = `/jobs?from=${from}&to=${to}${status ? `&status=${status}` : ''}`;
  const jobs = useLoad<Job[]>(query, [query]);

  const needle = q.trim().toLowerCase();
  const rows = (jobs.data ?? []).filter(
    (j) =>
      !needle ||
      String(j.number).includes(needle) ||
      j.customer_name.toLowerCase().includes(needle) ||
      j.site_label.toLowerCase().includes(needle) ||
      (j.driver_name ?? '').toLowerCase().includes(needle),
  );
  const total = rows.reduce((s, j) => s + (j.delivered_litres ?? 0), 0);

  return (
    <div className="page">
      <div className="toolbar">
        <h2>Jobs</h2>
        <label className="inline">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input placeholder="Search job, customer, driver" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="spacer" />
        <a className="button" href={authedUrl(`/exports/deliveries.csv?from=${from}&to=${to}`)}>Download deliveries CSV</a>
      </div>
      {jobs.error && <p className="error">{jobs.error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Job</th><th>Date</th><th>Customer / delivery point</th><th>Driver</th><th>Truck</th><th>Status</th>
            <th className="num">Requested</th><th className="num">Delivered</th><th>Done</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => (
            <tr key={j.id}>
              <td><Link to={`/jobs/${j.id}`}>#{j.number}</Link></td>
              <td>{day(j.scheduled_date)}</td>
              <td>{j.customer_name}{j.site_label !== j.customer_name && <span className="muted"> · {j.site_label}</span>}</td>
              <td>{j.driver_name ?? <span className="muted">—</span>}</td>
              <td>{j.truck_name ?? <span className="muted">—</span>}</td>
              <td><StatusBadge status={j.status} /></td>
              <td className="num">{litres(j.requested_litres)}</td>
              <td className="num">{j.delivered_litres !== null ? <strong>{litres(j.delivered_litres)}</strong> : '—'}</td>
              <td>{time(j.completed_at)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={7}>{rows.length} jobs</td><td className="num"><strong>{litres(total)}</strong></td><td /></tr>
        </tfoot>
      </table>
      {jobs.loading && !jobs.data && <p className="muted">Loading…</p>}
    </div>
  );
}
