import { useMemo, useState, type FormEvent } from 'react';
import { patch, post, type Customer, type Job, type Site, type Truck, type User } from '../api';
import { useLoad } from '../hooks';

interface Props {
  job?: Job;
  defaultDate?: string;
  onSaved: (job: Job) => void;
  onCancel: () => void;
}

export default function JobForm({ job, defaultDate, onSaved, onCancel }: Props) {
  const customers = useLoad<Customer[]>('/customers');
  const sites = useLoad<Site[]>('/sites');
  const drivers = useLoad<User[]>('/users?role=driver');
  const trucks = useLoad<Truck[]>('/trucks');

  const [customerId, setCustomerId] = useState(job?.customer_id ?? '');
  const [siteId, setSiteId] = useState(job?.site_id ?? '');
  const [search, setSearch] = useState('');
  const [litres, setLitres] = useState(job?.requested_litres?.toString() ?? '');
  const [date, setDate] = useState(job ? (job.scheduled_date ?? '') : (defaultDate ?? ''));
  const [driverId, setDriverId] = useState(job?.driver_id ?? '');
  const [truckId, setTruckId] = useState(job?.truck_id ?? '');
  const [priority, setPriority] = useState(job?.priority ?? 0);
  const [notes, setNotes] = useState(job?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers.data ?? [];
    if (!q) return list.slice(0, 50);
    return list.filter((c) => c.name.toLowerCase().includes(q) || (c.account_code ?? '').toLowerCase().includes(q)).slice(0, 50);
  }, [customers.data, search]);
  const customerSites = (sites.data ?? []).filter((s) => s.customer_id === customerId);
  const selectedCustomer = customers.data?.find((c) => c.id === customerId);

  function pickCustomer(id: string) {
    setCustomerId(id);
    const own = (sites.data ?? []).filter((s) => s.customer_id === id);
    setSiteId(own.length === 1 ? own[0].id : '');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customerId || !siteId) return setError('Pick a customer and a delivery point.');
    setBusy(true);
    const body = {
      customer_id: customerId,
      site_id: siteId,
      requested_litres: litres ? Number(litres) : null,
      scheduled_date: date || null,
      driver_id: driverId || null,
      truck_id: truckId || null,
      priority,
      notes: notes || null,
    };
    try {
      onSaved(job ? await patch<Job>(`/jobs/${job.id}`, body) : await post<Job>('/jobs', body));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <label>
        Customer
        {selectedCustomer && !search ? (
          <div className="row">
            <strong>{selectedCustomer.name}</strong>
            {selectedCustomer.account_code && <span className="muted">{selectedCustomer.account_code}</span>}
            <button type="button" className="link" onClick={() => { setCustomerId(''); setSiteId(''); }}>Change</button>
          </div>
        ) : (
          <>
            <input placeholder="Search by name or account" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            <div className="picklist">
              {matches.map((c) => (
                <button type="button" key={c.id} onClick={() => { pickCustomer(c.id); setSearch(''); }}>
                  {c.name} {c.account_code && <span className="muted">{c.account_code}</span>}
                </button>
              ))}
              {customers.data && matches.length === 0 && <span className="muted">No match. Add customers on the Customers page.</span>}
            </div>
          </>
        )}
      </label>
      {customerId && (
        <label>
          Delivery point
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
            <option value="">Choose…</option>
            {customerSites.map((s) => (
              <option key={s.id} value={s.id}>{s.label}{s.address ? `, ${s.address}` : ''}</option>
            ))}
          </select>
          {customerSites.length === 0 && <span className="error">This customer has no delivery points yet.</span>}
        </label>
      )}
      <div className="grid2">
        <label>
          Litres requested
          <input type="number" min={1} step={1} value={litres} onChange={(e) => setLitres(e.target.value)} placeholder="Fill to full" />
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Driver
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Not assigned</option>
            {(drivers.data ?? []).filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>
          Truck
          <select value={truckId} onChange={(e) => setTruckId(e.target.value)}>
            <option value="">Driver picks when going on duty</option>
            {(trucks.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>
      <label>
        Priority
        <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
          <option value={0}>Normal</option>
          <option value={1}>High</option>
          <option value={2}>Urgent (out of water)</option>
        </select>
      </label>
      <label>
        Notes for the driver
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {!date || !driverId ? <p className="muted small">Without a date and driver the job waits in the request queue.</p> : null}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : job ? 'Save changes' : 'Create job'}</button>
      </div>
    </form>
  );
}
