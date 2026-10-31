import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Anchor, Badge, Box, Button, Card, Center, Grid, Group, Image, Loader, Menu, NumberInput, SimpleGrid, Stack, Text, TextInput, Textarea, Timeline, Title,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { modals } from '@mantine/modals';
import {
  IconArrowLeft, IconBan, IconCalendar, IconCopy, IconDots, IconDroplet, IconFileTypePdf, IconMapPin, IconPencil, IconPhone, IconReceipt, IconTruck, IconUser,
} from '@tabler/icons-react';
import { authedUrl, post, type JobDetail } from '../api';
import JobForm from '../components/JobForm';
import JobMap from '../components/Map';
import StatusBadge from '../components/StatusBadge';
import { Sheet } from '../components/ui';
import { notifyError, notifyOk, useApi, useInvalidate } from '../hooks';
import { dateTime, day, litres, time, todayIso } from '../format';

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
    .map(([k, v]) => (Array.isArray(v) && v.length === 2 ? `${k.replace(/_/g, ' ')}: ${v[0] ?? '—'} → ${v[1] ?? '—'}` : `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`))
    .join(' · ');
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <Box c="dimmed" pt={2}>{icon}</Box>
      <Box style={{ minWidth: 0 }}>
        <Text size="xs" c="dimmed">{label}</Text>
        <Text size="sm" fw={500}>{children}</Text>
      </Box>
    </Group>
  );
}

export default function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const job = useApi<JobDetail>(`/jobs/${id}`);
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(false);
  const [entering, setEntering] = useState(false);

  if (job.error) return <Box p="md"><Alert color="red">{(job.error as Error).message}</Alert></Box>;
  const j = job.data;
  if (!j) return <Center h={300}><Loader /></Center>;
  const open = !['completed', 'cancelled'].includes(j.status);
  const refresh = () => invalidate('/jobs');

  async function clone() {
    try {
      const r = await post<JobDetail>(`/jobs/${j!.id}/clone`, { scheduled_date: todayIso() });
      notifyOk(`Job #${r.number} created for today`);
      void refresh();
      navigate(`/jobs/${r.id}`);
    } catch (e) {
      notifyError(e);
    }
  }

  function cancel() {
    let reason = '';
    modals.openConfirmModal({
      title: `Cancel job #${j!.number}?`,
      children: <TextInput label="Reason" placeholder="Customer cancelled, duplicate…" data-autofocus onChange={(e) => (reason = e.currentTarget.value)} />,
      labels: { confirm: 'Cancel job', cancel: 'Keep it' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await post(`/jobs/${j!.id}/cancel`, { reason });
          void refresh();
        } catch (e) {
          notifyError(e);
        }
      },
    });
  }

  const meterDiff = j.meter_start !== null && j.meter_end !== null ? j.meter_end - j.meter_start : null;

  return (
    <Box p={{ base: 'md', lg: 'lg' }} maw={1280}>
      <Anchor component={Link} to="/" size="sm" c="dimmed">
        <Group gap={4}><IconArrowLeft size={16} />Dispatch</Group>
      </Anchor>
      <Group justify="space-between" align="flex-start" mt="xs" mb="md" wrap="nowrap">
        <Box style={{ minWidth: 0 }}>
          <Group gap="sm">
            <Title order={2} fz={{ base: 22, sm: 26 }}>Job #{j.number}</Title>
            <StatusBadge status={j.status} size="lg" />
            {j.priority === 2 && <Badge color="red" variant="filled">Out of water</Badge>}
          </Group>
          <Text c="dimmed" size="sm" truncate>{j.site_label}{j.site_address ? ` · ${j.site_address}` : ''}</Text>
        </Box>
        <Group gap="xs" wrap="nowrap">
          {j.status === 'completed' && (
            <Button component="a" href={authedUrl(`/jobs/${j.id}/ticket.pdf`)} target="_blank" rel="noreferrer" leftSection={<IconFileTypePdf size={18} />} visibleFrom="sm">
              Delivery ticket
            </Button>
          )}
          {open && <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)} visibleFrom="sm">Edit</Button>}
          <Menu position="bottom-end" shadow="md" width={230}>
            <Menu.Target>
              <Button variant="default" px="xs" aria-label="More actions"><IconDots size={18} /></Button>
            </Menu.Target>
            <Menu.Dropdown>
              {j.status === 'completed' && (
                <Menu.Item component="a" href={authedUrl(`/jobs/${j.id}/ticket.pdf`)} target="_blank" leftSection={<IconFileTypePdf size={16} />} hiddenFrom="sm">Delivery ticket (PDF)</Menu.Item>
              )}
              {open && <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)} hiddenFrom="sm">Edit job</Menu.Item>}
              <Menu.Item leftSection={<IconCopy size={16} />} onClick={() => void clone()}>Repeat for today</Menu.Item>
              {open && <Menu.Item leftSection={<IconReceipt size={16} />} onClick={() => setEntering(true)}>Enter paper ticket</Menu.Item>}
              {open && (
                <>
                  <Menu.Divider />
                  <Menu.Item color="red" leftSection={<IconBan size={16} />} onClick={cancel}>Cancel job</Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      <Grid gap="md">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="md">
            <Card p={0} style={{ overflow: 'hidden' }}>
              <JobMap jobs={[j]} trail={j.trail.map((p) => [p.lat, p.lng])} height={340} radius={0} />
              <Group justify="space-between" p="sm">
                <Text size="xs" c="dimmed">{j.trail.length ? `Route: ${j.trail.length} GPS points` : 'No GPS route recorded for this job'}</Text>
                {j.site_lat !== null && (
                  <Anchor size="xs" href={`https://www.google.com/maps/dir/?api=1&destination=${j.site_lat},${j.site_lng}`} target="_blank">Directions</Anchor>
                )}
              </Group>
            </Card>
            <Card>
              <Title order={4} mb="md">Delivery</Title>
              {j.status === 'completed' ? (
                <Stack gap="md">
                  <Group align="baseline" gap="xs">
                    <Text fz={36} fw={800} lh={1} c="teal">{litres(j.delivered_litres)}</Text>
                    <Text c="dimmed" size="sm">delivered {dateTime(j.delivered_at ?? j.completed_at)}</Text>
                  </Group>
                  <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                    <Field icon={<IconDroplet size={16} />} label="Meter start">{j.meter_start ?? '—'}</Field>
                    <Field icon={<IconDroplet size={16} />} label="Meter end">{j.meter_end ?? '—'}</Field>
                    <Field icon={<IconDroplet size={16} />} label="Meter difference">{meterDiff === null ? '—' : litres(meterDiff)}</Field>
                    <Field icon={<IconUser size={16} />} label="Received by">{j.recipient_name ?? '—'}</Field>
                  </SimpleGrid>
                  {meterDiff !== null && Math.abs(meterDiff - (j.delivered_litres ?? 0)) > 1 && (
                    <Alert color="orange" p="xs">The meter difference doesn't match the litres entered.</Alert>
                  )}
                  {j.delivery_notes && <Text size="sm"><Text span c="dimmed">Driver notes: </Text>{j.delivery_notes}</Text>}
                  {(j.meter_photo_id || j.signature_id) && (
                    <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
                      {j.meter_photo_id && (
                        <a href={authedUrl(`/files/${j.meter_photo_id}`)} target="_blank" rel="noreferrer">
                          <Image src={authedUrl(`/files/${j.meter_photo_id}`)} alt="Meter reading" className="wt-photo" />
                        </a>
                      )}
                      {j.signature_id && <Image src={authedUrl(`/files/${j.signature_id}`)} alt="Signature" className="wt-sig" fit="contain" />}
                    </SimpleGrid>
                  )}
                </Stack>
              ) : (
                <Text c="dimmed" size="sm">{j.status === 'cancelled' ? 'Cancelled before delivery.' : 'Not delivered yet. The driver records litres, the meter photo and a signature on their phone.'}</Text>
              )}
            </Card>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="md">
            <Card>
              <Title order={4} mb="md">Details</Title>
              <Stack gap="sm">
                <Field icon={<IconUser size={16} />} label="Customer">
                  {j.customer_name}
                  {j.customer_phone && <> · <Anchor href={`tel:${j.customer_phone}`} size="sm"><IconPhone size={13} /> {j.customer_phone}</Anchor></>}
                </Field>
                <Field icon={<IconMapPin size={16} />} label="Delivery point">{j.site_label}{j.site_address ? `, ${j.site_address}` : ''}</Field>
                {j.site_access_notes && <Alert color="yellow" p="xs" variant="light"><Text size="sm">Access: {j.site_access_notes}</Text></Alert>}
                <SimpleGrid cols={2} spacing="sm">
                  <Field icon={<IconCalendar size={16} />} label="Date">{day(j.scheduled_date)}</Field>
                  <Field icon={<IconDroplet size={16} />} label="Requested">{j.requested_litres ? litres(j.requested_litres) : 'Fill to full'}</Field>
                  <Field icon={<IconUser size={16} />} label="Driver">{j.driver_name ?? '—'}</Field>
                  <Field icon={<IconTruck size={16} />} label="Truck">{j.truck_name ?? '—'}</Field>
                </SimpleGrid>
                {j.notes && <Text size="sm"><Text span c="dimmed">Notes: </Text>{j.notes}</Text>}
              </Stack>
            </Card>
            <Card>
              <Title order={4} mb="md">Progress</Title>
              <Timeline bulletSize={18} lineWidth={2} active={[j.created_at, j.started_at, j.arrived_at, j.completed_at].filter(Boolean).length - 1} color="water">
                <Timeline.Item title="Created"><Text size="xs" c="dimmed">{dateTime(j.created_at)}</Text></Timeline.Item>
                <Timeline.Item title="Driver on the way"><Text size="xs" c="dimmed">{j.started_at ? time(j.started_at) : 'Not yet'}</Text></Timeline.Item>
                <Timeline.Item title="Arrived">
                  <Text size="xs" c="dimmed">{j.arrived_at ? `${time(j.arrived_at)} · ${j.arrival_source === 'manual' ? 'driver tapped arrived' : 'GPS geofence'}` : 'Not yet'}</Text>
                </Timeline.Item>
                <Timeline.Item title={j.status === 'cancelled' ? 'Cancelled' : 'Delivered'} color={j.status === 'cancelled' ? 'gray' : 'teal'}>
                  <Text size="xs" c="dimmed">{j.completed_at ? time(j.completed_at) : j.cancelled_at ? dateTime(j.cancelled_at) : 'Not yet'}</Text>
                </Timeline.Item>
              </Timeline>
            </Card>
            <Card>
              <Title order={4} mb="md">History</Title>
              {j.audit.length === 0 && <Text size="sm" c="dimmed">No history recorded.</Text>}
              <Stack gap="xs">
                {j.audit.map((a, i) => (
                  <Box key={i}>
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Text size="sm" fw={600}>{ACTION_LABEL[a.action] ?? a.action}</Text>
                      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{dateTime(a.at)}</Text>
                    </Group>
                    <Text size="xs" c="dimmed">
                      {a.actor_name ? `by ${a.actor_name}` : ''}
                      {['updated', 'assigned', 'cancelled', 'completed'].includes(a.action) && describe(a.changes) ? ` · ${describe(a.changes)}` : ''}
                    </Text>
                  </Box>
                ))}
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>

      <Sheet opened={editing} onClose={() => setEditing(false)} title={`Edit job #${j.number}`}>
        <JobForm job={j} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
      </Sheet>
      <Sheet opened={entering} onClose={() => setEntering(false)} title="Enter a paper delivery ticket" size="md">
        <PaperTicket jobId={j.id} onDone={() => { setEntering(false); void refresh(); }} onCancel={() => setEntering(false)} />
      </Sheet>
    </Box>
  );
}

function PaperTicket({ jobId, onDone, onCancel }: { jobId: string; onDone: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState<number | string>('');
  const [start, setStart] = useState<number | string>('');
  const [end, setEnd] = useState<number | string>('');
  const [recipient, setRecipient] = useState('');
  const [notes, setNotes] = useState('');
  const [at, setAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (v: number | string) => (v === '' ? null : Number(v));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/jobs/${jobId}/complete`, {
        litres: Number(amount),
        meter_start: num(start),
        meter_end: num(end),
        recipient_name: recipient || null,
        notes: notes || null,
        delivered_at: at ? new Date(at).toISOString() : undefined,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <NumberInput label="Litres delivered" required min={0} thousandSeparator="," value={amount} onChange={setAmount} data-autofocus />
          <DateTimePicker label="Delivered at" placeholder="Now" value={at} onChange={(v) => setAt(v as string | null)} clearable size="md" />
          <NumberInput label="Meter start" min={0} value={start} onChange={(v) => { setStart(v); if (end !== '' && v !== '') setAmount(Number(end) - Number(v)); }} />
          <NumberInput label="Meter end" min={0} value={end} onChange={(v) => { setEnd(v); if (start !== '' && v !== '') setAmount(Number(v) - Number(start)); }} />
        </SimpleGrid>
        <TextInput label="Received by" value={recipient} onChange={(e) => setRecipient(e.currentTarget.value)} />
        <Textarea label="Notes" autosize minRows={2} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={busy}>Record delivery</Button>
        </Group>
      </Stack>
    </form>
  );
}
