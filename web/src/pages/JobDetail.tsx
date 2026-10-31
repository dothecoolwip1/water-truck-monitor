import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { authedUrl, post, type JobDetail } from '../api';
import JobForm from '../components/JobForm';
import JobMap from '../components/Map';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import { useLoad } from '../hooks';
import { dateTime, day, litres, todayIso } from '../format';

const ACTION_LABEL: Record<string, string> = {
  created: 'Job created',
  updated: 'Job changed',
  assigned: 'Assigned',
  started: 'Driver started the job',
  arrived: 'Arrived on site',
  completed: 'Delivery recorded',
  cancelled: 'Cancelled',
  entered_by_office: 'Entered by the office',
};

function describe(changes: Record<string, unknown> | null): string {
  if (!changes) return '';
  return Object.entries(changes)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => (Array.isArray(v) && v.length === 2 ? `${k}: ${v[0] ?? '—'} → ${v[1] ?? '—'}` : `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`))
    .join(', ');
}

export default function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const job = useLoad<JobDetail>(`/jobs/${id}`, [id]);
  const [editing, setEditing] = useState(false);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (job.error) return <div className="page"><p className="error">{job.error}</p></div>;
  const j = job.data;
  if (!j) return <div className="page muted">Loading…</div>;
  const open = !['completed', 'cancelled'].includes(j.status);

  async function act(path: string, body: unknown, after?: (r: JobDetail) => void) {
    setError(null);
    try {
      const r = await post<JobDetail>(path, body);
      if (after) after(r);
      else await job.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="page detail">
      <div className="toolbar">
        <Link to="/">← Dispatch</Link>
        <h2>Job #{j.number}</h2>
        <StatusBadge status={j.status} />
        <div className="spacer" />
        {j.status === 'completed' && <a className="button" href={authedUrl(`/jobs/${j.id}/ticket.pdf`)} target="_blank" rel="noreferrer">Delivery ticket (PDF)</a>}
        <button onClick={() => act(`/jobs/${j.id}/clone`, { scheduled_date: todayIso() }, (r) => navigate(`/jobs/${r.id}`))}>Repeat for today</button>
        {open && <button onClick={() => setEditing(true)}>Edit</button>}
        {open && <button onClick={() => setEntering(true)}>Enter paper ticket</button>}
        {open && (
          <button className="danger" onClick={() => {
            const reason = prompt('Why is this job being cancelled?');
            if (reason !== null) void act(`/jobs/${j.id}/cancel`, { reason });
          }}>Cancel job</button>
        )}
      </div>
      {error && <p className="error banner">{error}</p>}
      <div className="detail-grid">
        <div className="card">
          <h3>{j.site_label}</h3>
          <p>{j.customer_name !== j.site_label && j.customer_name}{j.customer_phone && <> · <a href={`tel:${j.customer_phone}`}>{j.customer_phone}</a></>}</p>
          {j.site_address && <p className="muted">{j.site_address}</p>}
          {j.site_access_notes && <p className="note">Access: {j.site_access_notes}</p>}
          <dl>
            <dt>Date</dt><dd>{day(j.scheduled_date)}</dd>
            <dt>Driver</dt><dd>{j.driver_name ?? '—'}</dd>
            <dt>Truck</dt><dd>{j.truck_name ?? '—'}</dd>
            <dt>Requested</dt><dd>{litres(j.requested_litres)}</dd>
            {j.notes && <><dt>Notes</dt><dd>{j.notes}</dd></>}
            <dt>Started</dt><dd>{dateTime(j.started_at)}</dd>
            <dt>Arrived</dt><dd>{dateTime(j.arrived_at)}{j.arrival_source && <span className="muted"> ({j.arrival_source === 'manual' ? 'driver tapped arrived' : 'GPS geofence'})</span>}</dd>
            <dt>Completed</dt><dd>{dateTime(j.completed_at)}</dd>
          </dl>
        </div>
        <div className="card">
          <h3>Delivery</h3>
          {j.status === 'completed' ? (
            <>
              <p className="big">{litres(j.delivered_litres)}</p>
              <dl>
                <dt>Meter start</dt><dd>{j.meter_start ?? '—'}</dd>
                <dt>Meter end</dt><dd>{j.meter_end ?? '—'}</dd>
                {j.meter_start !== null && j.meter_end !== null && (
                  <><dt>Meter difference</dt><dd>{litres(j.meter_end - j.meter_start)}{Math.abs(j.meter_end - j.meter_start - (j.delivered_litres ?? 0)) > 1 && <span className="error"> (doesn't match litres entered)</span>}</dd></>
                )}
                <dt>Received by</dt><dd>{j.recipient_name ?? '—'}</dd>
                {j.delivery_notes && <><dt>Driver notes</dt><dd>{j.delivery_notes}</dd></>}
              </dl>
              <div className="photos">
                {j.meter_photo_id && <a href={authedUrl(`/files/${j.meter_photo_id}`)} target="_blank" rel="noreferrer"><img src={authedUrl(`/files/${j.meter_photo_id}`)} alt="Meter reading" /></a>}
                {j.signature_id && <img className="sig" src={authedUrl(`/files/${j.signature_id}`)} alt="Signature" />}
              </div>
            </>
          ) : (
            <p className="muted">Not delivered yet.</p>
          )}
        </div>
        <div className="card mapcard">
          <JobMap jobs={[j]} trail={j.trail.map((p) => [p.lat, p.lng])} height={320} />
          <p className="muted small">{j.trail.length ? `${j.trail.length} GPS points recorded during the job` : 'No GPS trail recorded for this job.'}</p>
        </div>
        <div className="card">
          <h3>History</h3>
          {j.audit.length === 0 && <p className="muted small">No history recorded.</p>}
          <ol className="audit">
            {j.audit.map((a, i) => (
              <li key={i}>
                <span className="muted small">{dateTime(a.at)}</span> <strong>{ACTION_LABEL[a.action] ?? a.action}</strong>
                {a.actor_name && <span className="muted"> by {a.actor_name}</span>}
                {['updated', 'assigned', 'cancelled', 'completed'].includes(a.action) && <div className="small muted">{describe(a.changes)}</div>}
              </li>
            ))}
          </ol>
        </div>
      </div>
      {editing && (
        <Modal title={`Edit job #${j.number}`} onClose={() => setEditing(false)}>
          <JobForm job={j} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); void job.reload(); }} />
        </Modal>
      )}
      {entering && <PaperTicket jobId={j.id} onClose={() => setEntering(false)} onDone={() => { setEntering(false); void job.reload(); }} />}
    </div>
  );
}

function PaperTicket({ jobId, onClose, onDone }: { jobId: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ litres: '', meter_start: '', meter_end: '', recipient_name: '', notes: '', delivered_at: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const num = (v: string) => (v === '' ? null : Number(v));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await post(`/jobs/${jobId}/complete`, {
        litres: Number(form.litres),
        meter_start: num(form.meter_start),
        meter_end: num(form.meter_end),
        recipient_name: form.recipient_name || null,
        notes: form.notes || null,
        delivered_at: form.delivered_at ? new Date(form.delivered_at).toISOString() : undefined,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Enter a paper delivery ticket" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="grid2">
          <label>Litres delivered<input type="number" min={0} step="0.1" required value={form.litres} onChange={set('litres')} autoFocus /></label>
          <label>Delivered at<input type="datetime-local" value={form.delivered_at} onChange={set('delivered_at')} /></label>
          <label>Meter start<input type="number" min={0} step="0.1" value={form.meter_start} onChange={set('meter_start')} /></label>
          <label>Meter end<input type="number" min={0} step="0.1" value={form.meter_end} onChange={set('meter_end')} /></label>
        </div>
        <label>Received by<input value={form.recipient_name} onChange={set('recipient_name')} /></label>
        <label>Notes<textarea rows={2} value={form.notes} onChange={set('notes')} /></label>
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Record delivery</button></div>
      </form>
    </Modal>
  );
}
