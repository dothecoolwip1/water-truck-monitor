import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Anchor, Badge, Box, Button, Center, Group, Image, Loader, Menu, MultiSelect, NumberInput, SimpleGrid, Stack, Text, TextInput, Textarea, Timeline, Title, Tooltip,
  UnstyledButton, Collapse,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { modals } from '@mantine/modals';
import {
  IconArrowLeft, IconBan, IconCopy, IconDots, IconFileTypePdf, IconPencil, IconPhone, IconReceipt, IconNavigation, IconWorld, IconRepeat,
  IconChevronDown, IconAlertTriangleFilled, IconMessageCircle, IconCheck,
} from '@tabler/icons-react';
import { authedUrl, post, put, type JobDetail, type Settings, type User } from '../api';
import Conversation from '../components/Conversation';
import JobForm from '../components/JobForm';
import LinesEditor from '../components/LinesEditor';
import JobMap from '../components/Map';
import StatusBadge from '../components/StatusBadge';
import { Person, Section, Sheet, useIsMobile } from '../components/ui';
import { notifyError, notifyOk, useApi, useInvalidate, useLive } from '../hooks';
import { dateTime, day, litres, money, time, todayIso } from '../format';

const ACTION_LABEL: Record<string, string> = {
  created: 'Job created',
  updated: 'Job changed',
  assigned: 'Assigned',
  started: 'Driver started the job',
  arrived: 'Arrived on site',
  completed: 'Delivery recorded',
  cancelled: 'Cancelled',
  entered_by_office: 'Entered by the office',
  approved: 'Approved for billing',
  rejected: 'Rejected',
  lines_changed: 'Charges changed',
};

function describe(changes: Record<string, unknown> | null): string {
  if (!changes) return '';
  return Object.entries(changes)
    .filter(([k, v]) => v !== null && v !== undefined && k !== 'at')
    .map(([k, v]) => (Array.isArray(v) && v.length === 2 ? `${k.replace(/_/g, ' ')}: ${v[0] ?? '—'} → ${v[1] ?? '—'}` : `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`))
    .join(' · ');
}

function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="wt-kv" style={{ margin: 0 }}>
      {items.map(([k, v]) => (
        <Box key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Box>
      ))}
    </dl>
  );
}

function Followers({ jobId }: { jobId: string }) {
  const users = useApi<User[]>('/users');
  const followers = useApi<{ id: string; name: string }[]>(`/jobs/${jobId}/followers`);
  const invalidate = useInvalidate();
  const [value, setValue] = useState<string[]>([]);
  useEffect(() => { setValue((followers.data ?? []).map((f) => f.id)); }, [followers.data]);
  return (
    <MultiSelect
      label="Followers"
      description="They're told about messages and changes on this job"
      size="sm"
      data={(users.data ?? []).filter((u) => u.active !== false).map((u) => ({ value: u.id, label: u.name }))}
      value={value}
      onChange={async (v) => {
        setValue(v);
        try {
          await put(`/jobs/${jobId}/followers`, { user_ids: v });
          void invalidate(`/jobs/${jobId}/followers`);
        } catch (e) {
          notifyError(e);
        }
      }}
      searchable
      hidePickedOptions
      placeholder={value.length ? undefined : 'Add people'}
    />
  );
}

export default function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const job = useApi<JobDetail>(`/jobs/${id}`);
  const settings = useApi<Settings>('/settings');
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(false);
  const [entering, setEntering] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  useLive((e) => {
    if (e.type === 'job' && e.jobId === id) void invalidate(`/jobs/${id}`);
  });

  if (job.error) return <Alert color="red">{(job.error as Error).message}</Alert>;
  const j = job.data;
  if (!j) return <Center h={300}><Loader type="dots" /></Center>;
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
  const fieldLabel = (k: string) => settings.data?.form.fields.find((f) => f.key === k)?.label ?? k.replace(/_/g, ' ');
  const steps = [
    { title: 'Requested', at: j.created_at, sub: j.source === 'portal' ? `Online by ${j.requester_name ?? 'resident'}` : j.source === 'recurring' ? 'Standing order' : 'By the office', show: true },
    { title: 'On the way', at: j.started_at, sub: j.truck_name ?? '', show: true },
    { title: 'Arrived', at: j.arrived_at, sub: j.arrived_at ? (j.arrival_source === 'manual' ? 'Driver tapped arrived' : 'GPS geofence') : '', show: true },
    { title: j.status === 'cancelled' ? 'Cancelled' : 'Delivered', at: j.completed_at ?? j.cancelled_at, sub: j.delivered_litres !== null ? litres(j.delivered_litres) : '', show: true },
  ];
  const reached = steps.filter((s) => s.at).length - 1;

  const actions = (
    <Group gap={8} wrap="nowrap">
      {j.status === 'completed' && (
        <Button component="a" href={authedUrl(`/jobs/${j.id}/ticket.pdf`)} target="_blank" rel="noreferrer" variant="default" leftSection={<IconFileTypePdf size={18} />} visibleFrom="sm">
          Ticket
        </Button>
      )}
      {open && <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)} visibleFrom="sm">Edit</Button>}
      <Menu position="bottom-end" width={230}>
        <Menu.Target>
          <Button variant="default" px={10} aria-label="More actions"><IconDots size={18} /></Button>
        </Menu.Target>
        <Menu.Dropdown>
          {j.status === 'completed' && (
            <Menu.Item component="a" href={authedUrl(`/jobs/${j.id}/ticket.pdf`)} target="_blank" leftSection={<IconFileTypePdf size={16} />} hiddenFrom="sm">Delivery ticket (PDF)</Menu.Item>
          )}
          {open && <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)} hiddenFrom="sm">Edit job</Menu.Item>}
          <Menu.Item leftSection={<IconCopy size={16} />} onClick={() => void clone()}>Repeat for today</Menu.Item>
          {open && <Menu.Item leftSection={<IconReceipt size={16} />} onClick={() => setEntering(true)}>Enter paper ticket</Menu.Item>}
          {j.site_lat !== null && (
            <Menu.Item component="a" href={`https://www.google.com/maps/dir/?api=1&destination=${j.site_lat},${j.site_lng}`} target="_blank" leftSection={<IconNavigation size={16} />}>Directions</Menu.Item>
          )}
          {open && (
            <>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<IconBan size={16} />} onClick={cancel}>Cancel job</Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );

  const delivery = (
    <Section title="Delivery">
      {j.status === 'completed' ? (
        <Stack gap="md">
          <Group align="flex-end" gap="md" wrap="wrap">
            <Box>
              <div className="wt-big-number">{litres(j.delivered_litres)}</div>
              <Text c="dimmed" size="sm" mt={6}>Delivered {dateTime(j.delivered_at ?? j.completed_at)}</Text>
            </Box>
            {j.requested_litres && <Text size="sm" c="dimmed" mb={4}>of {litres(j.requested_litres)} requested</Text>}
          </Group>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
            {([['Meter start', j.meter_start ?? '—'], ['Meter end', j.meter_end ?? '—'], ['Meter difference', meterDiff === null ? '—' : litres(meterDiff)], ['Received by', j.recipient_name ?? '—']] as const).map(([k, v]) => (
              <Box key={k} p="sm" style={{ background: 'var(--wt-surface-2)', borderRadius: 10, border: '1px solid var(--wt-border)' }}>
                <Text size="xs" c="dimmed">{k}</Text>
                <Text fw={600} className="wt-num" truncate>{typeof v === 'number' ? v.toLocaleString('en-CA') : v}</Text>
              </Box>
            ))}
          </SimpleGrid>
          {j.form_data && Object.keys(j.form_data).length > 0 && (
            <Box>
              <Text className="wt-section-title" mb={6}>Driver's checklist</Text>
              <KV items={Object.entries(j.form_data).map(([k, v]) => [fieldLabel(k), v === true ? <Group gap={4} c="teal"><IconCheck size={15} />Yes</Group> : v === false ? 'No' : String(v ?? '—')])} />
            </Box>
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
        <Text c="dimmed" size="sm">{j.status === 'cancelled' ? 'Cancelled before delivery.' : 'Not delivered yet. The driver records litres, a meter photo, the checklist and a signature on their phone.'}</Text>
      )}
    </Section>
  );

  const details = (
    <Section title="Details">
      <Stack gap="md">
        <KV
          items={[
            ['Customer', <Group key="c" gap={6} wrap="nowrap"><Link className="wt-link" to={`/customers/${j.customer_id}`}>{j.customer_name}</Link></Group>],
            ...(j.customer_phone ? [['Phone', <Anchor key="p" href={`tel:${j.customer_phone}`} size="sm"><IconPhone size={13} /> {j.customer_phone}</Anchor>] as [string, ReactNode]] : []),
            ['Delivery point', `${j.site_label}${j.site_address ? `, ${j.site_address}` : ''}`],
            ['Date', day(j.scheduled_date)],
            ['Requested', j.requested_litres ? litres(j.requested_litres) : 'Fill to full'],
            ['Driver', j.driver_name ? <Group key="d" gap={6}><Person name={j.driver_name} size={20} />{j.driver_name}</Group> : '—'],
            ['Truck', j.truck_name ?? '—'],
            ...(j.requester_name ? [['Asked by', `${j.requester_name}${j.requester_phone ? ` · ${j.requester_phone}` : ''}`] as [string, ReactNode]] : []),
            ...(j.tags?.length ? [['Tags', <Group key="t" gap={4}>{j.tags.map((t) => <Badge key={t} variant="default" size="sm">{t}</Badge>)}</Group>] as [string, ReactNode]] : []),
          ]}
        />
        {j.site_access_notes && <Alert color="yellow" p="xs" variant="light"><Text size="sm"><b>Access:</b> {j.site_access_notes}</Text></Alert>}
        {j.notes && <Text size="sm"><Text span c="dimmed">Notes: </Text>{j.notes}</Text>}
        <Followers jobId={j.id} />
      </Stack>
    </Section>
  );

  const progress = (
    <Section title="Progress">
      <Timeline bulletSize={20} lineWidth={2} active={reached} color={j.status === 'cancelled' ? 'gray' : 'water'}>
        {steps.map((s) => (
          <Timeline.Item key={s.title} title={<Text size="sm" fw={600}>{s.title}</Text>} bullet={s.at ? <IconCheck size={12} /> : undefined}>
            <Text size="xs" c="dimmed">{s.at ? `${time(s.at)}${s.sub ? ` · ${s.sub}` : ''}` : 'Not yet'}</Text>
          </Timeline.Item>
        ))}
      </Timeline>
      <UnstyledButton mt="md" onClick={() => setShowHistory((v) => !v)}>
        <Group gap={4}><Text size="sm" fw={600} c="water">Full history ({j.audit.length})</Text><IconChevronDown size={14} style={{ transform: showHistory ? 'rotate(180deg)' : undefined, transition: 'transform 160ms' }} /></Group>
      </UnstyledButton>
      <Collapse expanded={showHistory}>
        <Stack gap={10} mt="sm">
          {j.audit.map((a, i) => (
            <Box key={i} pl="sm" style={{ borderLeft: '2px solid var(--wt-border)' }}>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="sm" fw={600}>{ACTION_LABEL[a.action] ?? a.action}</Text>
                <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{dateTime(a.at)}</Text>
              </Group>
              <Text size="xs" c="dimmed">
                {a.actor_name ? `by ${a.actor_name}` : 'automatic'}
                {['updated', 'assigned', 'cancelled', 'completed', 'approved', 'rejected'].includes(a.action) && describe(a.changes) ? ` · ${describe(a.changes)}` : ''}
              </Text>
            </Box>
          ))}
        </Stack>
      </Collapse>
    </Section>
  );

  const chat = (
    <Section title={<Group gap={8}><IconMessageCircle size={18} /><Text fw={650}>Messages</Text>{j.driver_name && <Text size="sm" c="dimmed">with {j.driver_name.split(' ')[0]}</Text>}</Group>}>
      <Conversation jobId={j.id} />
    </Section>
  );

  const billing = j.status === 'completed' && (
    <Section title={<Group gap={8}><Text fw={650}>Charges</Text>{j.amount > 0 && <Text size="sm" c="dimmed" className="wt-num">{money(j.amount)} before tax</Text>}</Group>}>
      <LinesEditor job={j} />
    </Section>
  );

  return (
    <Box maw={1320} mx="auto">
      <Anchor component={Link} to="/" size="sm" c="dimmed" underline="never">
        <Group gap={4}><IconArrowLeft size={16} />Dispatch</Group>
      </Anchor>
      <Group justify="space-between" align="flex-start" mt="sm" mb="lg" wrap="nowrap" gap="sm">
        <Box style={{ minWidth: 0 }}>
          <Group gap={10} wrap="wrap">
            <Title order={1} fz={{ base: 24, sm: 28 }}>{j.site_label}</Title>
            <StatusBadge status={j.status} size="lg" />
          </Group>
          <Group gap={8} mt={6} wrap="wrap">
            <Text c="dimmed" size="sm" className="wt-num">Job #{j.number}</Text>
            {j.priority === 2 && <Badge color="red" variant="light" leftSection={<IconAlertTriangleFilled size={12} />}>Out of water</Badge>}
            {j.priority === 1 && <Badge color="orange" variant="light">High priority</Badge>}
            {j.source === 'portal' && <Tooltip label="Requested by the resident online"><Badge variant="light" color="cyan" leftSection={<IconWorld size={12} />}>Online request</Badge></Tooltip>}
            {j.source === 'recurring' && <Badge variant="light" color="violet" leftSection={<IconRepeat size={12} />}>Standing order</Badge>}
            {j.approval_status === 'pending' && <Badge variant="light" color="orange">Needs review</Badge>}
            {j.invoice_number && <Badge variant="light" color="teal">Invoice #{j.invoice_number}</Badge>}
          </Group>
        </Box>
        {actions}
      </Group>

      <Box style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0, 1.45fr) minmax(340px, 1fr)', gap: 16, alignItems: 'start' }}>
        <Stack gap="md">
          <Box style={{ borderRadius: 14, overflow: 'hidden' }}>
            <JobMap jobs={[j]} trail={j.trail.map((p) => [p.lat, p.lng])} height={mobile ? 260 : 360} />
          </Box>
          {delivery}
          {billing}
          {mobile && chat}
        </Stack>
        <Stack gap="md" style={mobile ? undefined : { position: 'sticky', top: 24 }}>
          {!mobile && chat}
          {details}
          {progress}
        </Stack>
      </Box>

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
