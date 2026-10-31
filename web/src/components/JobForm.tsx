import { useState, type FormEvent } from 'react';
import { Alert, Button, Chip, Group, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Switch, TagsInput, Text, Textarea } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconCalendar, IconDroplet, IconInfoCircle, IconMapPin, IconTruck, IconUser } from '@tabler/icons-react';
import { patch, post, type Customer, type Job, type Site, type Truck, type User } from '../api';
import { useApi, useInvalidate } from '../hooks';
import { addDays, litres as fmtLitres, todayIso } from '../format';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  job?: Job;
  defaultDate?: string;
  defaultCustomerId?: string;
  defaultSiteId?: string;
  defaultLitres?: number;
  onSaved: (job: Job) => void;
  onCancel: () => void;
}

export default function JobForm({ job, defaultDate, defaultCustomerId, defaultSiteId, defaultLitres, onSaved, onCancel }: Props) {
  const customers = useApi<Customer[]>('/customers');
  const sites = useApi<Site[]>('/sites');
  const drivers = useApi<User[]>('/users?role=driver');
  const trucks = useApi<Truck[]>('/trucks');
  const invalidate = useInvalidate();

  const [customerId, setCustomerId] = useState<string | null>(job?.customer_id ?? defaultCustomerId ?? null);
  const [siteId, setSiteId] = useState<string | null>(job?.site_id ?? defaultSiteId ?? null);
  const [amount, setAmount] = useState<number | string>(job?.requested_litres ?? defaultLitres ?? '');
  const [date, setDate] = useState<string | null>(job ? job.scheduled_date : (defaultDate ?? null));
  const [driverId, setDriverId] = useState<string | null>(job?.driver_id ?? null);
  const [truckId, setTruckId] = useState<string | null>(job?.truck_id ?? null);
  const [priority, setPriority] = useState(String(job?.priority ?? 0));
  const [notes, setNotes] = useState(job?.notes ?? '');
  const [tags, setTags] = useState<string[]>(job?.tags ?? []);
  const [repeat, setRepeat] = useState(false);
  const [weekdays, setWeekdays] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const customerSites = (sites.data ?? []).filter((s) => s.customer_id === customerId);
  const site = customerSites.find((s) => s.id === siteId);

  function pickCustomer(id: string | null) {
    setCustomerId(id);
    const own = (sites.data ?? []).filter((s) => s.customer_id === id);
    setSiteId(own.length === 1 ? own[0].id : null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customerId || !siteId) return setError('Pick a customer and a delivery point.');
    setBusy(true);
    const body = {
      customer_id: customerId,
      site_id: siteId,
      requested_litres: amount === '' ? null : Number(amount),
      scheduled_date: date || null,
      driver_id: driverId || null,
      truck_id: truckId || null,
      priority: Number(priority),
      notes: notes || null,
      tags,
    };
    const days = weekdays.length ? weekdays : [String(new Date(`${date ?? todayIso()}T12:00:00`).getDay())];
    try {
      const saved = job ? await patch<Job>(`/jobs/${job.id}`, body) : await post<Job>('/jobs', body);
      if (!job && repeat) {
        // The first job is made now; the standing order makes the following ones (it skips dates that already have a job).
        await post('/recurring', {
          customer_id: customerId, site_id: siteId, requested_litres: body.requested_litres, weekdays: days.map(Number),
          start_date: addDays(date ?? todayIso(), 1), driver_id: body.driver_id, truck_id: body.truck_id, notes: body.notes, tags,
        });
        void invalidate('/recurring');
      }
      void invalidate('/jobs');
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <Select
          label="Customer"
          placeholder="Search by name or account"
          searchable
          nothingFoundMessage="No match. Add customers on the Customers page."
          data={(customers.data ?? []).map((c) => ({ value: c.id, label: c.account_code ? `${c.name} · ${c.account_code}` : c.name }))}
          value={customerId}
          onChange={pickCustomer}
          leftSection={<IconUser size={18} />}
          limit={60}
          data-autofocus
          required
        />
        {customerId && (
          <Select
            label="Delivery point"
            placeholder="Choose…"
            data={customerSites.map((s) => ({ value: s.id, label: s.address ? `${s.label} · ${s.address}` : s.label }))}
            value={siteId}
            onChange={setSiteId}
            leftSection={<IconMapPin size={18} />}
            error={customerSites.length === 0 ? 'This customer has no delivery points yet.' : undefined}
            required
          />
        )}
        {site?.tank_capacity_l ? <Text size="xs" c="dimmed" mt={-8}>Tank holds {fmtLitres(site.tank_capacity_l)}{site.access_notes ? ` · ${site.access_notes}` : ''}</Text> : null}
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
          <NumberInput label="Litres requested" placeholder="Fill to full" min={1} step={100} thousandSeparator="," value={amount} onChange={setAmount} leftSection={<IconDroplet size={18} />} />
          <DatePickerInput label="Date" placeholder="Not scheduled" clearable value={date} onChange={(v) => setDate(v as string | null)} leftSection={<IconCalendar size={18} />} size="md" />
          <Select label="Driver" placeholder="Not assigned" clearable data={(drivers.data ?? []).filter((d) => d.active).map((d) => ({ value: d.id, label: d.name }))} value={driverId} onChange={setDriverId} leftSection={<IconUser size={18} />} />
          <Select label="Truck" placeholder="Driver picks on duty" clearable data={(trucks.data ?? []).map((t) => ({ value: t.id, label: t.name }))} value={truckId} onChange={setTruckId} leftSection={<IconTruck size={18} />} />
        </SimpleGrid>
        <Stack gap={4}>
          <Text size="sm" fw={500}>Priority</Text>
          <SegmentedControl
            fullWidth
            value={priority}
            onChange={setPriority}
            color={priority === '2' ? 'red' : priority === '1' ? 'orange' : 'water'}
            data={[{ value: '0', label: 'Normal' }, { value: '1', label: 'High' }, { value: '2', label: 'Out of water' }]}
          />
        </Stack>
        <Textarea label="Notes for the driver" autosize minRows={2} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        <TagsInput label="Tags" placeholder="e.g. school, commercial, contract" value={tags} onChange={setTags} clearable maxTags={10} />
        {!job && (
          <Stack gap={8}>
            <Switch label="Repeat on a schedule" description="Makes a standing order so future jobs appear on the board by themselves" checked={repeat} onChange={(e) => setRepeat(e.currentTarget.checked)} />
            {repeat && (
              <Chip.Group multiple value={weekdays} onChange={setWeekdays}>
                <Group gap={6}>{WEEKDAYS.map((d, i) => <Chip key={d} value={String(i)} size="sm" radius="md">{d}</Chip>)}</Group>
              </Chip.Group>
            )}
          </Stack>
        )}
        {(!date || !driverId) && (
          <Alert variant="light" color="gray" icon={<IconInfoCircle size={18} />} p="xs">
            <Text size="sm">Without a date and a driver the job waits in Requests.</Text>
          </Alert>
        )}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={busy}>{job ? 'Save changes' : 'Create job'}</Button>
        </Group>
      </Stack>
    </form>
  );
}
