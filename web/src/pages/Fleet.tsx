import { useState, type FormEvent } from 'react';
import { patch, post, type Tank, type Truck, type User } from '../api';
import { useAuth } from '../auth';
import Modal from '../components/Modal';
import { useLoad } from '../hooks';
import { dateTime, litres } from '../format';

export default function Fleet() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const trucks = useLoad<Truck[]>('/trucks?active=all');
  const users = useLoad<User[]>('/users');
  const tanks = useLoad<Tank[]>('/tanks');
  const [truck, setTruck] = useState<Truck | 'new' | null>(null);
  const [person, setPerson] = useState<User | 'new' | null>(null);
  const [tank, setTank] = useState<Tank | 'new' | null>(null);
  const [newKey, setNewKey] = useState<{ device_id: string; device_key: string } | null>(null);

  async function rotate(t: Tank) {
    if (!confirm(`Make a new key for ${t.name}? The sensor will stop reporting until it is set up with the new key.`)) return;
    const r = await post<{ device_key: string }>(`/tanks/${t.id}/rotate-key`);
    setNewKey({ device_id: t.device_id, device_key: r.device_key });
  }

  return (
    <div className="page">
      <section>
        <div className="toolbar"><h2>Trucks</h2><div className="spacer" /><button className="primary" onClick={() => setTruck('new')}>Add truck</button></div>
        <table className="table">
          <thead><tr><th>Truck</th><th>Plate</th><th className="num">Tank</th><th>Meter serial</th><th className="num">Last meter reading</th><th /></tr></thead>
          <tbody>
            {(trucks.data ?? []).map((t) => (
              <tr key={t.id} className={t.active ? '' : 'muted'}>
                <td>{t.name}{!t.active && ' (retired)'}</td><td>{t.plate ?? '—'}</td><td className="num">{litres(t.capacity_l)}</td>
                <td>{t.meter_serial ?? '—'}</td><td className="num">{t.last_meter_reading ?? '—'}</td>
                <td><button className="link" onClick={() => setTruck(t)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <div className="toolbar"><h2>People</h2><div className="spacer" />{isAdmin && <button className="primary" onClick={() => setPerson('new')}>Add person</button>}</div>
        <table className="table">
          <thead><tr><th>Name</th><th>Email (sign-in)</th><th>Phone</th><th>Role</th><th>Phone alerts</th><th /></tr></thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id} className={u.active ? '' : 'muted'}>
                <td>{u.name}{!u.active && ' (disabled)'}</td><td>{u.email}</td><td>{u.phone ?? '—'}</td><td>{u.role}</td>
                <td>{u.role === 'driver' ? (u.has_push ? 'On' : <span className="muted">App not signed in</span>) : ''}</td>
                <td>{isAdmin && <button className="link" onClick={() => setPerson(u)}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isAdmin && <p className="muted small">Only admins can add or change accounts.</p>}
      </section>

      <section>
        <div className="toolbar"><h2>Bulk water tanks</h2><div className="spacer" />{isAdmin && <button className="primary" onClick={() => setTank('new')}>Add tank sensor</button>}</div>
        <table className="table">
          <thead><tr><th>Tank</th><th>Sensor device id</th><th className="num">Capacity</th><th className="num">Current level</th><th>Last reading</th><th /></tr></thead>
          <tbody>
            {(tanks.data ?? []).map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td><td><code>{t.device_id}</code></td><td className="num">{litres(t.capacity_l)}</td>
                <td className="num">{t.latest_volume_l != null ? `${litres(t.latest_volume_l)} (${Math.round((t.latest_volume_l / t.capacity_l) * 100)}%)` : '—'}</td>
                <td>{t.latest_ts ? dateTime(t.latest_ts) : <span className="error">no readings yet</span>}</td>
                <td>{isAdmin && <><button className="link" onClick={() => setTank(t)}>Edit</button> <button className="link" onClick={() => void rotate(t)}>New key</button></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {truck && <TruckForm truck={truck === 'new' ? null : truck} onClose={() => setTruck(null)} onSaved={() => { setTruck(null); void trucks.reload(); }} />}
      {person && <PersonForm person={person === 'new' ? null : person} onClose={() => setPerson(null)} onSaved={() => { setPerson(null); void users.reload(); }} />}
      {tank && (
        <TankForm
          tank={tank === 'new' ? null : tank}
          onClose={() => setTank(null)}
          onSaved={(t) => { setTank(null); if (t.device_key) setNewKey({ device_id: t.device_id, device_key: t.device_key }); void tanks.reload(); }}
        />
      )}
      {newKey && (
        <Modal title="Sensor key" onClose={() => setNewKey(null)}>
          <p>Set up the tank sensor or its gateway to send readings with these details. The key is shown only once.</p>
          <dl>
            <dt>URL</dt><dd><code>{window.location.origin}/api/ingest/tank-readings</code></dd>
            <dt>Header x-device-id</dt><dd><code>{newKey.device_id}</code></dd>
            <dt>Header x-device-key</dt><dd><code>{newKey.device_key}</code></dd>
            <dt>Body (JSON)</dt><dd><code>{'{"ts": "2026-11-02T14:00:00Z", "level_mm": 4200}'}</code></dd>
          </dl>
          <p className="small muted">The body can carry <code>volume_l</code>, <code>level_mm</code>, <code>distance_mm</code> (lid to water) or <code>level_pct</code>, one reading or a <code>readings</code> list.</p>
          <div className="actions"><button className="primary" onClick={() => setNewKey(null)}>I've saved it</button></div>
        </Modal>
      )}
    </div>
  );
}

function useSubmit<T>(fn: () => Promise<T>, onSaved: (r: T) => void) {
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    submit: async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      try {
        onSaved(await fn());
      } catch (err) {
        setError((err as Error).message);
      }
    },
  };
}

const n = (v: string) => (v === '' ? null : Number(v));

function TruckForm({ truck, onClose, onSaved }: { truck: Truck | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: truck?.name ?? '', plate: truck?.plate ?? '', capacity_l: String(truck?.capacity_l ?? ''), meter_serial: truck?.meter_serial ?? '', active: truck?.active ?? true });
  const body = { name: f.name, plate: f.plate || null, capacity_l: Number(f.capacity_l || 0), meter_serial: f.meter_serial || null, active: f.active };
  const { error, submit } = useSubmit(() => (truck ? patch(`/trucks/${truck.id}`, body) : post('/trucks', body)), onSaved);
  return (
    <Modal title={truck ? 'Edit truck' : 'Add truck'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="grid2">
          <label>Name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
          <label>Plate<input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} /></label>
          <label>Tank size (litres)<input type="number" min={0} value={f.capacity_l} onChange={(e) => setF({ ...f, capacity_l: e.target.value })} /></label>
          <label>Flow meter serial<input value={f.meter_serial} onChange={(e) => setF({ ...f, meter_serial: e.target.value })} /></label>
        </div>
        {truck && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> In service</label>}
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save</button></div>
      </form>
    </Modal>
  );
}

function PersonForm({ person, onClose, onSaved }: { person: User | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: person?.name ?? '', email: person?.email ?? '', phone: person?.phone ?? '', role: person?.role ?? 'driver', password: '', active: person?.active ?? true });
  const body: Record<string, unknown> = { name: f.name, email: f.email, phone: f.phone || null, role: f.role, active: f.active };
  if (f.password) body.password = f.password;
  const { error, submit } = useSubmit(() => (person ? patch(`/users/${person.id}`, body) : post('/users', body)), onSaved);
  return (
    <Modal title={person ? 'Edit person' : 'Add person'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
        <div className="grid2">
          <label>Email (used to sign in)<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label>Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label>Role
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as User['role'] })}>
              <option value="driver">Driver (phone app)</option>
              <option value="dispatcher">Dispatcher (office)</option>
              <option value="admin">Admin (office, manages accounts)</option>
            </select>
          </label>
          <label>{person ? 'New password (leave blank to keep)' : 'Password'}<input type="text" minLength={8} required={!person} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></label>
        </div>
        {person && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Can sign in</label>}
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save</button></div>
      </form>
    </Modal>
  );
}

function TankForm({ tank, onClose, onSaved }: { tank: Tank | null; onClose: () => void; onSaved: (t: Tank) => void }) {
  const [f, setF] = useState({
    name: tank?.name ?? '', device_id: tank?.device_id ?? '', capacity_l: String(tank?.capacity_l ?? ''), height_mm: String(tank?.height_mm ?? ''),
    lat: String(tank?.lat ?? ''), lng: String(tank?.lng ?? ''), noise_l: String(tank?.noise_l ?? 200),
  });
  const body = { name: f.name, device_id: f.device_id, capacity_l: Number(f.capacity_l), height_mm: n(f.height_mm), lat: n(f.lat), lng: n(f.lng), noise_l: Number(f.noise_l || 0) };
  const { error, submit } = useSubmit(() => (tank ? patch<Tank>(`/tanks/${tank.id}`, body) : post<Tank>('/tanks', body)), onSaved);
  return (
    <Modal title={tank ? 'Edit tank' : 'Add tank sensor'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="grid2">
          <label>Name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
          <label>Sensor device id<input required value={f.device_id} onChange={(e) => setF({ ...f, device_id: e.target.value })} placeholder="e.g. armor-001" /></label>
          <label>Capacity (litres)<input type="number" required min={1} value={f.capacity_l} onChange={(e) => setF({ ...f, capacity_l: e.target.value })} /></label>
          <label>Water height when full (mm)<input type="number" min={1} value={f.height_mm} onChange={(e) => setF({ ...f, height_mm: e.target.value })} /></label>
          <label>Latitude<input value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /></label>
          <label>Longitude<input value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} /></label>
          <label>Ignore level changes under (litres)<input type="number" min={0} value={f.noise_l} onChange={(e) => setF({ ...f, noise_l: e.target.value })} /></label>
        </div>
        <p className="small muted">Height is needed only if the sensor reports a depth or distance rather than litres or percent.</p>
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save</button></div>
      </form>
    </Modal>
  );
}
