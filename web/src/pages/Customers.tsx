import { useMemo, useState, type FormEvent } from 'react';
import { useMapEvents, Marker } from 'react-leaflet';
import { patch, post, type Customer, type Site } from '../api';
import JobMap from '../components/Map';
import Modal from '../components/Modal';
import { csvObjects } from '../csv';
import { useLoad } from '../hooks';
import { litres } from '../format';

export default function Customers() {
  const customers = useLoad<Customer[]>('/customers?active=all');
  const sites = useLoad<Site[]>('/sites?active=all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | 'new' | null>(null);
  const [editingSite, setEditingSite] = useState<Site | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (customers.data ?? []).filter((c) => !n || c.name.toLowerCase().includes(n) || (c.account_code ?? '').toLowerCase().includes(n));
  }, [customers.data, q]);
  const current = customers.data?.find((c) => c.id === selected) ?? null;
  const currentSites = (sites.data ?? []).filter((s) => s.customer_id === selected);

  return (
    <div className="page split">
      <aside className="card listpane">
        <div className="row">
          <input placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="row">
          <button className="primary" onClick={() => setEditingCustomer('new')}>Add customer</button>
          <button onClick={() => setImporting(true)}>Import CSV</button>
        </div>
        <ul className="pick">
          {list.map((c) => (
            <li key={c.id} className={c.id === selected ? 'sel' : ''} onClick={() => setSelected(c.id)}>
              <span className={c.active ? '' : 'muted'}>{c.name}</span>
              {c.account_code && <span className="muted small">{c.account_code}</span>}
            </li>
          ))}
        </ul>
        <p className="muted small">{list.length} customers</p>
      </aside>
      <section className="grow">
        {current ? (
          <>
            <div className="toolbar">
              <h2>{current.name}</h2>
              {!current.active && <span className="badge">Inactive</span>}
              <div className="spacer" />
              <button onClick={() => setEditingCustomer(current)}>Edit customer</button>
              <button className="primary" onClick={() => setEditingSite('new')}>Add delivery point</button>
            </div>
            <div className="card">
              <dl>
                <dt>Account</dt><dd>{current.account_code ?? '—'}</dd>
                <dt>Phone</dt><dd>{current.phone ?? '—'}</dd>
                <dt>Email</dt><dd>{current.email ?? '—'}</dd>
                {current.notes && <><dt>Notes</dt><dd>{current.notes}</dd></>}
              </dl>
            </div>
            <table className="table">
              <thead><tr><th>Delivery point</th><th>Address</th><th>Tank</th><th>Geofence</th><th>Location</th><th /></tr></thead>
              <tbody>
                {currentSites.map((s) => (
                  <tr key={s.id} className={s.active ? '' : 'muted'}>
                    <td>{s.label}</td>
                    <td>{s.address ?? '—'}</td>
                    <td>{litres(s.tank_capacity_l)}</td>
                    <td>{s.geofence_m} m</td>
                    <td>{s.lat !== null ? `${s.lat.toFixed(5)}, ${s.lng!.toFixed(5)}` : <span className="error">not set: no automatic arrival</span>}</td>
                    <td><button className="link" onClick={() => setEditingSite(s)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="muted center">Pick a customer to see their delivery points.</p>
        )}
      </section>
      {editingCustomer && (
        <CustomerForm
          customer={editingCustomer === 'new' ? null : editingCustomer}
          onClose={() => setEditingCustomer(null)}
          onSaved={(c) => { setEditingCustomer(null); setSelected(c.id); void customers.reload(); }}
        />
      )}
      {editingSite && current && (
        <SiteForm
          customerId={current.id}
          site={editingSite === 'new' ? null : editingSite}
          onClose={() => setEditingSite(null)}
          onSaved={() => { setEditingSite(null); void sites.reload(); }}
        />
      )}
      {importing && <ImportForm onClose={() => setImporting(false)} onDone={() => { void customers.reload(); void sites.reload(); }} />}
    </div>
  );
}

function CustomerForm({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: (c: Customer) => void }) {
  const [f, setF] = useState({
    name: customer?.name ?? '', account_code: customer?.account_code ?? '', phone: customer?.phone ?? '',
    email: customer?.email ?? '', notes: customer?.notes ?? '', active: customer?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...f, account_code: f.account_code || null, phone: f.phone || null, email: f.email || null, notes: f.notes || null };
    try {
      onSaved(customer ? await patch<Customer>(`/customers/${customer.id}`, body) : await post<Customer>('/customers', body));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title={customer ? 'Edit customer' : 'Add customer'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
        <div className="grid2">
          <label>Account code<input value={f.account_code} onChange={(e) => setF({ ...f, account_code: e.target.value })} /></label>
          <label>Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        </div>
        <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Notes<textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {customer && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save</button></div>
      </form>
    </Modal>
  );
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function SiteForm({ customerId, site, onClose, onSaved }: { customerId: string; site: Site | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    label: site?.label ?? '', address: site?.address ?? '', lat: site?.lat ?? null as number | null, lng: site?.lng ?? null as number | null,
    geofence_m: site?.geofence_m ?? 75, tank_capacity_l: site?.tank_capacity_l?.toString() ?? '', access_notes: site?.access_notes ?? '',
    active: site?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      ...f, customer_id: customerId, address: f.address || null, access_notes: f.access_notes || null,
      tank_capacity_l: f.tank_capacity_l ? Number(f.tank_capacity_l) : null,
    };
    try {
      if (site) await patch(`/sites/${site.id}`, body);
      else await post('/sites', body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title={site ? 'Edit delivery point' : 'Add delivery point'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="grid2">
          <label>Name<input required value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. House 12" autoFocus /></label>
          <label>Address<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
          <label>Tank size (litres)<input type="number" min={0} value={f.tank_capacity_l} onChange={(e) => setF({ ...f, tank_capacity_l: e.target.value })} /></label>
          <label>Arrival radius (metres)<input type="number" min={10} max={2000} value={f.geofence_m} onChange={(e) => setF({ ...f, geofence_m: Number(e.target.value) })} /></label>
        </div>
        <label>Access notes for drivers<input value={f.access_notes} onChange={(e) => setF({ ...f, access_notes: e.target.value })} placeholder="Fill pipe on north side; dog in yard" /></label>
        <p className="small muted">Click the map where the truck parks to fill the tank. {f.lat !== null && `(${f.lat.toFixed(5)}, ${f.lng!.toFixed(5)})`}</p>
        <div className="minimap">
          <JobMap fit={false} height={280} extra={<>
            <ClickToPlace onPick={(lat, lng) => setF({ ...f, lat, lng })} />
            {f.lat !== null && f.lng !== null && <Marker position={[f.lat, f.lng]} />}
          </>} />
        </div>
        {site && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save</button></div>
      </form>
    </Modal>
  );
}

const COLUMNS = 'customer, account_code, phone, email, site_label, address, lat, lng, tank_capacity_l, access_notes';

function ImportForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(file: File) {
    setError(null);
    const parsed = csvObjects(await file.text());
    if (parsed.length && !('customer' in parsed[0])) return setError('The first row must be headers, including a "customer" column.');
    setRows(parsed);
  }
  async function submit() {
    try {
      const clean = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === '' ? null : v])));
      const r = await post<{ customers_created: number; sites_created: number }>('/import/customers', { rows: clean });
      setResult(`Added ${r.customers_created} customers and ${r.sites_created} delivery points.`);
      setRows([]);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title="Import customers from a spreadsheet" onClose={onClose} wide>
      <p className="small">Save the spreadsheet as CSV with these column headings (only <code>customer</code> is required): <code>{COLUMNS}</code>. Rows with the same account code or customer name become one customer with several delivery points.</p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
      {rows.length > 0 && (
        <>
          <p>{rows.length} rows ready. First few:</p>
          <table className="table small">
            <thead><tr><th>Customer</th><th>Account</th><th>Delivery point</th><th>Address</th><th>Lat/Lng</th></tr></thead>
            <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i}><td>{r.customer}</td><td>{r.account_code}</td><td>{r.site_label}</td><td>{r.address}</td><td>{r.lat} {r.lng}</td></tr>)}</tbody>
          </table>
          <div className="actions"><button className="primary" onClick={submit}>Import {rows.length} rows</button></div>
        </>
      )}
      {result && <p className="ok">{result}</p>}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
