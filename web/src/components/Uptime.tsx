import { useState, type FormEvent } from 'react';
import { ActionIcon, Alert, Badge, Box, Button, Card, Checkbox, Group, NumberInput, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import {
  IconAlertTriangle, IconCalendarDue, IconCircleCheck, IconClipboardCheck, IconPlus, IconTool, IconTrash, IconTruck,
} from '@tabler/icons-react';
import { del, patch, post, type DueState, type FleetTruck, type Inspection, type MaintenanceEntry, type MaintenanceTask } from '../api';
import { notifyOk, useApi, useInvalidate } from '../hooks';
import { ago, dateTime, day, money, todayIso } from '../format';
import { EmptyState, Sheet } from './ui';

export const DUE_COLOR: Record<DueState, string> = { overdue: 'red', due_soon: 'orange', ok: 'teal', unknown: 'gray' };
const km = (v: string | number | null | undefined) => (v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-CA')} km`);
const hrs = (v: string | number | null | undefined) => (v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-CA')} h`);

function every(t: MaintenanceTask) {
  return [t.every_km && `${t.every_km.toLocaleString('en-CA')} km`, t.every_hours && `${t.every_hours} engine h`, t.every_days && `${t.every_days} days`].filter(Boolean).join(' or ');
}

/** One card per truck: road-ready or not, last inspection, and what maintenance is coming up. */
export function UptimeCards({ onOpen }: { onOpen: (t: FleetTruck) => void }) {
  const fleet = useApi<FleetTruck[]>('/fleet/status');
  const list = (fleet.data ?? []).filter((t) => t.active);
  if (fleet.data && !list.length) return null;
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
      {list.map((t) => {
        const insp = t.last_inspection;
        const inspectedToday = insp && insp.at.slice(0, 10) === todayIso();
        const next = [...t.tasks].sort((a, b) => ['overdue', 'due_soon', 'ok', 'unknown'].indexOf(a.due.state) - ['overdue', 'due_soon', 'ok', 'unknown'].indexOf(b.due.state))[0];
        return (
          <Card key={t.id} padding="md" className="wt-job" onClick={() => onOpen(t)} style={{ ['--rail' as string]: t.out_of_service ? '#ef4444' : t.overdue ? '#f97316' : '#10b981' }}>
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <Box className="wt-empty-icon" style={{ width: 40, height: 40, borderRadius: 12 }}><IconTruck size={22} /></Box>
                <div style={{ minWidth: 0 }}>
                  <Text fw={700} truncate>{t.name}</Text>
                  <Text size="sm" c="dimmed" className="wt-num">{km(t.odometer_km)} · {hrs(t.engine_hours)}</Text>
                </div>
              </Group>
              {t.out_of_service ? <Badge color="red" leftSection={<IconAlertTriangle size={12} />}>Off the road</Badge>
                : <Badge color="teal" leftSection={<IconCircleCheck size={12} />}>Road ready</Badge>}
            </Group>
            {t.out_of_service && t.out_of_service_reason && <Text size="sm" c="red" mt="sm" lineClamp={2}>{t.out_of_service_reason}</Text>}
            <Stack gap={6} mt="md">
              <Group gap={8} wrap="nowrap">
                <IconClipboardCheck size={16} opacity={0.6} />
                <Text size="sm" c={insp ? undefined : 'dimmed'} truncate>
                  {insp ? `${inspectedToday ? 'Inspected today' : `Inspected ${ago(insp.at)}`}${insp.driver_name ? ` by ${insp.driver_name}` : ''}${insp.defects ? ` · ${insp.defects} problem${insp.defects === 1 ? '' : 's'}` : ''}` : 'No inspections yet'}
                </Text>
              </Group>
              <Group gap={8} wrap="nowrap">
                <IconTool size={16} opacity={0.6} />
                {next ? <Text size="sm" truncate>{next.name}: <Text span c={DUE_COLOR[next.due.state]} fw={600}>{next.due.label}</Text></Text>
                  : <Text size="sm" c="dimmed">No maintenance schedule yet</Text>}
              </Group>
            </Stack>
          </Card>
        );
      })}
    </SimpleGrid>
  );
}

/** Everything about one truck's upkeep: schedule, work done, inspections. */
export function TruckUptime({ truckId, onClose }: { truckId: string; onClose: () => void }) {
  const fleet = useApi<FleetTruck[]>('/fleet/status');
  const t = fleet.data?.find((x) => x.id === truckId);
  const log = useApi<MaintenanceEntry[]>(`/maintenance/log?truck_id=${truckId}`);
  const inspections = useApi<Inspection[]>(`/inspections?truck_id=${truckId}&limit=30`);
  const invalidate = useInvalidate();
  const [taskForm, setTaskForm] = useState<MaintenanceTask | 'new' | null>(null);
  const [logForm, setLogForm] = useState<{ task?: MaintenanceTask } | null>(null);
  if (!t) return null;

  const refresh = () => invalidate('/fleet/status', '/maintenance', '/inspections', '/trucks');
  const removeTask = (task: MaintenanceTask) => modals.openConfirmModal({
    title: `Stop tracking "${task.name}"?`, labels: { confirm: 'Remove', cancel: 'Keep' }, confirmProps: { color: 'red' },
    onConfirm: async () => { await del(`/maintenance/tasks/${task.id}`); await refresh(); },
  });

  return (
    <Stack>
      {t.out_of_service ? (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Off the road">
          <Text size="sm">{t.out_of_service_reason ?? 'Marked out of service.'}</Text>
          <Group mt="sm" gap="xs">
            <Button size="xs" color="red" variant="white" onClick={() => setLogForm({})}>Log the repair</Button>
            <Button size="xs" variant="subtle" color="red" onClick={async () => { await patch(`/trucks/${t.id}`, { out_of_service: false, out_of_service_reason: null }); await refresh(); notifyOk(`${t.name} is back on the road`); }}>
              Put back on the road
            </Button>
          </Group>
        </Alert>
      ) : (
        <Group justify="space-between">
          <Badge size="lg" color="teal" leftSection={<IconCircleCheck size={14} />}>Road ready</Badge>
          <Button size="xs" variant="subtle" color="red" onClick={() => modals.openConfirmModal({
            title: `Take ${t.name} off the road?`, labels: { confirm: 'Take off the road', cancel: 'Cancel' }, confirmProps: { color: 'red' },
            onConfirm: async () => { await patch(`/trucks/${t.id}`, { out_of_service: true, out_of_service_reason: 'Marked by the office' }); await refresh(); },
          })}>Take off the road</Button>
        </Group>
      )}
      <SimpleGrid cols={2}>
        <Card padding="sm"><Text size="xs" c="dimmed">Odometer</Text><Text fw={650} className="wt-num">{km(t.odometer_km)}</Text></Card>
        <Card padding="sm"><Text size="xs" c="dimmed">Engine hours</Text><Text fw={650} className="wt-num">{hrs(t.engine_hours)}</Text></Card>
      </SimpleGrid>

      <Tabs defaultValue="schedule">
        <Tabs.List>
          <Tabs.Tab value="schedule">Schedule</Tabs.Tab>
          <Tabs.Tab value="log">Work done</Tabs.Tab>
          <Tabs.Tab value="inspections">Inspections</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="schedule" pt="md">
          <Stack gap={8}>
            {t.tasks.map((task) => (
              <Card key={task.id} padding="sm">
                <Group justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>{task.name}</Text>
                    <Text size="xs" c="dimmed">Every {every(task) || '—'}</Text>
                  </div>
                  <Group gap={4} wrap="nowrap">
                    <Badge color={DUE_COLOR[task.due.state]} variant="light">{task.due.label}</Badge>
                    <Tooltip label="Log it done"><ActionIcon variant="subtle" onClick={() => setLogForm({ task })} aria-label="Log it done"><IconCircleCheck size={18} /></ActionIcon></Tooltip>
                    <ActionIcon variant="subtle" color="gray" onClick={() => setTaskForm(task)} aria-label="Edit"><IconCalendarDue size={18} /></ActionIcon>
                    <ActionIcon variant="subtle" color="red" onClick={() => removeTask(task)} aria-label="Remove"><IconTrash size={16} /></ActionIcon>
                  </Group>
                </Group>
              </Card>
            ))}
            {!t.tasks.length && <EmptyState icon={<IconTool size={24} />} title="No maintenance schedule">Add oil changes, pump service, tank cleaning and the annual safety inspection, and you'll be warned before each is due.</EmptyState>}
            <Group>
              <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setTaskForm('new')}>Add to schedule</Button>
              <Button variant="default" leftSection={<IconTool size={16} />} onClick={() => setLogForm({})}>Log other work</Button>
            </Group>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="log" pt="md">
          {(log.data ?? []).length ? (
            <Table.ScrollContainer minWidth={420}>
              <Table verticalSpacing={6} fz="sm">
                <Table.Thead><Table.Tr><Table.Th>Date</Table.Th><Table.Th>Work</Table.Th><Table.Th ta="right">Odometer</Table.Th><Table.Th ta="right">Cost</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {(log.data ?? []).map((l) => (
                    <Table.Tr key={l.id}>
                      <Table.Td>{day(l.done_at.slice(0, 10))}</Table.Td>
                      <Table.Td><Text size="sm" fw={550}>{l.title}</Text>{l.notes && <Text size="xs" c="dimmed">{l.notes}</Text>}</Table.Td>
                      <Table.Td ta="right" className="wt-num">{km(l.odometer_km)}</Table.Td>
                      <Table.Td ta="right" className="wt-num">{l.cost ? money(l.cost) : '—'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : <Text size="sm" c="dimmed">Nothing logged yet.</Text>}
        </Tabs.Panel>
        <Tabs.Panel value="inspections" pt="md">
          <Stack gap={8}>
            {(inspections.data ?? []).map((i) => (
              <Card key={i.id} padding="sm">
                <Group justify="space-between" wrap="nowrap">
                  <div>
                    <Text size="sm" fw={600}>{dateTime(i.at)}{i.driver_name ? ` · ${i.driver_name}` : ''}</Text>
                    <Text size="xs" c="dimmed" className="wt-num">{km(i.odometer_km)} · {hrs(i.engine_hours)}</Text>
                  </div>
                  {i.defects ? <Badge color="red">{i.defects} problem{i.defects === 1 ? '' : 's'}</Badge> : <Badge color="teal">All good</Badge>}
                </Group>
                {i.items.filter((x) => !x.ok).map((x) => <Text key={x.label} size="sm" c="red" mt={4}>{x.label}{x.note ? `: ${x.note}` : ''}</Text>)}
                {i.notes && <Text size="sm" mt={4}>{i.notes}</Text>}
              </Card>
            ))}
            {inspections.data && !inspections.data.length && <Text size="sm" c="dimmed">Drivers fill in the pre-trip check on the phone app when they go on duty.</Text>}
          </Stack>
        </Tabs.Panel>
      </Tabs>
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Done</Button></Group>

      <Sheet opened={!!taskForm} onClose={() => setTaskForm(null)} title={taskForm === 'new' ? 'Add to schedule' : 'Edit schedule'} size="sm">
        {taskForm && <TaskForm truck={t} task={taskForm === 'new' ? null : taskForm} onDone={async () => { setTaskForm(null); await refresh(); }} />}
      </Sheet>
      <Sheet opened={!!logForm} onClose={() => setLogForm(null)} title={logForm?.task ? `Log: ${logForm.task.name}` : 'Log work'} size="sm">
        {logForm && <LogForm truck={t} task={logForm.task} onDone={async () => { setLogForm(null); await refresh(); }} />}
      </Sheet>
    </Stack>
  );
}

const PRESETS = [
  { name: 'Engine oil and filter', every_km: 10000, every_hours: 250 },
  { name: 'Water pump service', every_hours: 500 },
  { name: 'Tank clean and disinfect', every_days: 90 },
  { name: 'Annual safety inspection', every_days: 365 },
  { name: 'Meter calibration', every_days: 365 },
];

function TaskForm({ truck, task, onDone }: { truck: FleetTruck; task: MaintenanceTask | null; onDone: () => void }) {
  const [f, setF] = useState({
    name: task?.name ?? '', every_km: task?.every_km ?? ('' as number | ''), every_hours: task?.every_hours ?? ('' as number | ''), every_days: task?.every_days ?? ('' as number | ''),
    last_done_at: task?.last_done_at?.slice(0, 10) ?? todayIso(), last_done_km: task?.last_done_km != null ? Number(task.last_done_km) : (truck.odometer_km != null ? Number(truck.odometer_km) : ''),
    last_done_hours: task?.last_done_hours != null ? Number(task.last_done_hours) : (truck.engine_hours != null ? Number(truck.engine_hours) : ''),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = (v: number | string | '') => (v === '' ? null : Number(v));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.every_km && !f.every_hours && !f.every_days) return setError('Set how often: by km, engine hours or days.');
    setBusy(true);
    const body = { name: f.name, every_km: n(f.every_km), every_hours: n(f.every_hours), every_days: n(f.every_days), last_done_at: f.last_done_at || null, last_done_km: n(f.last_done_km), last_done_hours: n(f.last_done_hours) };
    try {
      if (task) await patch(`/maintenance/tasks/${task.id}`, body); else await post('/maintenance/tasks', { ...body, truck_id: truck.id });
      onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit}>
      <Stack>
        {!task && (
          <Group gap={6}>
            {PRESETS.map((p) => <Button key={p.name} size="compact-xs" variant="default" onClick={() => setF({ ...f, name: p.name, every_km: p.every_km ?? '', every_hours: p.every_hours ?? '', every_days: p.every_days ?? '' })}>{p.name}</Button>)}
          </Group>
        )}
        <TextInput label="What" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
        <Text size="sm" fw={500} mb={-8}>Every (whichever comes first)</Text>
        <SimpleGrid cols={3} spacing="xs">
          <NumberInput placeholder="km" suffix=" km" min={1} value={f.every_km} onChange={(v) => setF({ ...f, every_km: v as number | '' })} />
          <NumberInput placeholder="hours" suffix=" h" min={1} value={f.every_hours} onChange={(v) => setF({ ...f, every_hours: v as number | '' })} />
          <NumberInput placeholder="days" suffix=" d" min={1} value={f.every_days} onChange={(v) => setF({ ...f, every_days: v as number | '' })} />
        </SimpleGrid>
        <Text size="sm" fw={500} mb={-8}>Last done</Text>
        <SimpleGrid cols={3} spacing="xs">
          <DatePickerInput value={f.last_done_at} onChange={(v) => setF({ ...f, last_done_at: (v as string) ?? '' })} valueFormat="MMM D, YYYY" />
          <NumberInput suffix=" km" min={0} value={f.last_done_km} onChange={(v) => setF({ ...f, last_done_km: v as number | '' })} />
          <NumberInput suffix=" h" min={0} value={f.last_done_hours} onChange={(v) => setF({ ...f, last_done_hours: v as number | '' })} />
        </SimpleGrid>
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end"><Button type="submit" loading={busy}>Save</Button></Group>
      </Stack>
    </form>
  );
}

function LogForm({ truck, task, onDone }: { truck: FleetTruck; task?: MaintenanceTask; onDone: () => void }) {
  const [f, setF] = useState({
    title: task?.name ?? '', done_at: todayIso(), odometer_km: truck.odometer_km != null ? Number(truck.odometer_km) : ('' as number | ''),
    engine_hours: truck.engine_hours != null ? Number(truck.engine_hours) : ('' as number | ''), cost: '' as number | '', notes: '', back: truck.out_of_service,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/maintenance/log', {
        truck_id: truck.id, task_id: task?.id ?? null, title: f.title, done_at: f.done_at, odometer_km: f.odometer_km === '' ? null : Number(f.odometer_km),
        engine_hours: f.engine_hours === '' ? null : Number(f.engine_hours), cost: f.cost === '' ? null : Number(f.cost), notes: f.notes || null, back_in_service: f.back,
      });
      notifyOk('Work logged');
      onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit}>
      <Stack>
        <TextInput label="Work done" required value={f.title} onChange={(e) => setF({ ...f, title: e.currentTarget.value })} />
        <SimpleGrid cols={2} spacing="xs">
          <DatePickerInput label="Date" value={f.done_at} onChange={(v) => setF({ ...f, done_at: (v as string) ?? todayIso() })} valueFormat="MMM D, YYYY" />
          <NumberInput label="Cost" prefix="$" decimalScale={2} min={0} value={f.cost} onChange={(v) => setF({ ...f, cost: v as number | '' })} />
          <NumberInput label="Odometer" suffix=" km" min={0} value={f.odometer_km} onChange={(v) => setF({ ...f, odometer_km: v as number | '' })} />
          <NumberInput label="Engine hours" suffix=" h" min={0} value={f.engine_hours} onChange={(v) => setF({ ...f, engine_hours: v as number | '' })} />
        </SimpleGrid>
        <Textarea label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.currentTarget.value })} />
        {truck.out_of_service && <Checkbox label="The truck is fixed and back on the road" checked={f.back} onChange={(e) => setF({ ...f, back: e.currentTarget.checked })} />}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end"><Button type="submit" loading={busy}>Save</Button></Group>
      </Stack>
    </form>
  );
}
