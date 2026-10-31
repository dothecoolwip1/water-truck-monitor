import { useState, type FormEvent } from 'react';
import { ActionIcon, Alert, Badge, Button, Chip, Group, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, Textarea } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconCalendarRepeat, IconPencil, IconPlus, IconRepeat, IconTrash } from '@tabler/icons-react';
import { del, patch, post, type Recurring, type Site, type Truck, type User } from '../api';
import { notifyOk, useApi, useInvalidate } from '../hooks';
import { day, litres, todayIso } from '../format';
import { Section, Sheet } from './ui';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeSchedule(r: Pick<Recurring, 'weekdays' | 'every_days'>): string {
  if (r.weekdays?.length) {
    if (r.weekdays.length === 7) return 'Every day';
    return `Every ${[...r.weekdays].sort().map((d) => WEEKDAYS[d]).join(', ')}`;
  }
  if (r.every_days === 1) return 'Every day';
  if (r.every_days === 7) return 'Every week';
  if (r.every_days === 14) return 'Every two weeks';
  return `Every ${r.every_days} days`;
}

export interface RecurringSeed { customer_id: string; site_id?: string; requested_litres?: number | null; driver_id?: string | null; truck_id?: string | null; notes?: string | null; tags?: string[] }

export function RecurringForm({ seed, existing, onDone }: { seed: RecurringSeed; existing?: Recurring | null; onDone: () => void }) {
  const sites = useApi<Site[]>('/sites');
  const drivers = useApi<User[]>('/users?role=driver');
  const trucks = useApi<Truck[]>('/trucks');
  const invalidate = useInvalidate();
  const r = existing;
  const [siteId, setSiteId] = useState<string | null>(r?.site_id ?? seed.site_id ?? null);
  const [mode, setMode] = useState<'weekdays' | 'interval'>(r && !r.weekdays?.length ? 'interval' : 'weekdays');
  const [weekdays, setWeekdays] = useState<string[]>((r?.weekdays ?? [new Date().getDay()]).map(String));
  const [every, setEvery] = useState<number | string>(r?.every_days ?? 7);
  const [amount, setAmount] = useState<number | string>(r?.requested_litres ?? seed.requested_litres ?? '');
  const [start, setStart] = useState<string | null>(r?.start_date ?? todayIso());
  const [end, setEnd] = useState<string | null>(r?.end_date ?? null);
  const [driverId, setDriverId] = useState<string | null>(r?.driver_id ?? seed.driver_id ?? null);
  const [truckId, setTruckId] = useState<string | null>(r?.truck_id ?? seed.truck_id ?? null);
  const [notes, setNotes] = useState(r?.notes ?? seed.notes ?? '');
  const [active, setActive] = useState(r?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!siteId) return setError('Pick a delivery point.');
    if (mode === 'weekdays' && !weekdays.length) return setError('Pick at least one day.');
    setBusy(true); setError(null);
    const body = {
      customer_id: seed.customer_id, site_id: siteId, requested_litres: amount === '' ? null : Number(amount),
      weekdays: mode === 'weekdays' ? weekdays.map(Number) : null, every_days: mode === 'interval' ? Number(every) : 7,
      start_date: start ?? todayIso(), end_date: end, driver_id: driverId, truck_id: truckId, notes: notes || null, tags: r?.tags ?? seed.tags ?? [], active,
    };
    try {
      if (r) await patch(`/recurring/${r.id}`, body); else await post('/recurring', body);
      await invalidate('/recurring', '/jobs');
      notifyOk(r ? 'Standing order updated' : 'Standing order created. Upcoming jobs are on the board.');
      onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        <Select label="Delivery point" data={(sites.data ?? []).filter((s) => s.customer_id === seed.customer_id).map((s) => ({ value: s.id, label: s.label }))} value={siteId} onChange={setSiteId} required />
        <Stack gap={8}>
          <Text size="sm" fw={500}>Repeat</Text>
          <SegmentedControl value={mode} onChange={(v) => setMode(v as 'weekdays' | 'interval')} data={[{ value: 'weekdays', label: 'On set days' }, { value: 'interval', label: 'Every few days' }]} />
          {mode === 'weekdays' ? (
            <Chip.Group multiple value={weekdays} onChange={setWeekdays}>
              <Group gap={6}>{WEEKDAYS.map((d, i) => <Chip key={d} value={String(i)} size="sm" radius="md">{d}</Chip>)}</Group>
            </Chip.Group>
          ) : (
            <NumberInput label="Every" suffix=" days" min={1} max={90} value={every} onChange={setEvery} />
          )}
        </Stack>
        <NumberInput label="Litres" description="Leave empty to fill the tank" min={100} step={500} value={amount} onChange={setAmount} suffix=" L" />
        <SimpleGrid cols={2}>
          <DatePickerInput label="Starts" value={start} onChange={setStart} valueFormat="MMM D, YYYY" />
          <DatePickerInput label="Ends" placeholder="No end" clearable value={end} onChange={setEnd} valueFormat="MMM D, YYYY" />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <Select label="Driver" placeholder="Assign later" clearable data={(drivers.data ?? []).filter((d) => d.active !== false).map((d) => ({ value: d.id, label: d.name }))} value={driverId} onChange={setDriverId} />
          <Select label="Truck" placeholder="Assign later" clearable data={(trucks.data ?? []).filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))} value={truckId} onChange={setTruckId} />
        </SimpleGrid>
        <Textarea label="Notes for the driver" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        {r && <Switch label="Active" checked={active} onChange={(e) => setActive(e.currentTarget.checked)} />}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>Cancel</Button>
          <Button type="submit" loading={busy} leftSection={<IconRepeat size={16} />}>{r ? 'Save' : 'Create standing order'}</Button>
        </Group>
      </Stack>
    </form>
  );
}

export function RecurringSection({ customerId }: { customerId: string }) {
  const list = useApi<Recurring[]>(`/recurring?customer_id=${customerId}`);
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);
  const remove = (r: Recurring) =>
    modals.openConfirmModal({
      title: 'Delete standing order?', children: <Text size="sm">Upcoming jobs that haven't started are removed too. Past deliveries stay.</Text>,
      labels: { confirm: 'Delete', cancel: 'Keep' }, confirmProps: { color: 'red' },
      onConfirm: async () => { await del(`/recurring/${r.id}`); await invalidate('/recurring', '/jobs'); notifyOk('Standing order deleted'); },
    });
  return (
    <Section title="Standing orders" actions={<Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>Add</Button>} padding="md">
      <Stack gap={0} px="md" pb="sm">
        {(list.data ?? []).map((r) => (
          <Group key={r.id} justify="space-between" wrap="nowrap" py={10} className="wt-row" opacity={r.active ? 1 : 0.55}>
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
              <IconCalendarRepeat size={20} color="var(--wt-accent)" style={{ flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} truncate>{describeSchedule(r)} · {r.requested_litres ? litres(r.requested_litres) : 'fill'}</Text>
                <Text size="xs" c="dimmed" truncate>
                  {r.site_label}{r.driver_name ? ` · ${r.driver_name}` : ''}{r.active && r.next_dates[0] ? ` · next ${day(r.next_dates[0])}` : ''}
                </Text>
              </div>
              {!r.active && <Badge size="xs" color="gray">Paused</Badge>}
            </Group>
            <Group gap={2} wrap="nowrap">
              <ActionIcon variant="subtle" color="gray" onClick={() => setEditing(r)} aria-label="Edit"><IconPencil size={16} /></ActionIcon>
              <ActionIcon variant="subtle" color="red" onClick={() => remove(r)} aria-label="Delete"><IconTrash size={16} /></ActionIcon>
            </Group>
          </Group>
        ))}
        {list.data && list.data.length === 0 && (
          <Text size="sm" c="dimmed" py="xs">No standing orders. Add one for customers who get water on a schedule, and the jobs appear on the board by themselves.</Text>
        )}
      </Stack>
      <Sheet opened={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New standing order' : 'Edit standing order'} size="md">
        {editing && <RecurringForm seed={{ customer_id: customerId }} existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </Section>
  );
}

