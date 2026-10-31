import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Group, Select, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAlertTriangle, IconCalendar, IconCircleCheck, IconClipboardList, IconDownload, IconMessage, IconSearch, IconWorld } from '@tabler/icons-react';
import { authedUrl, type Job, type JobStatus } from '../api';
import JobCard from '../components/JobCard';
import StatusBadge from '../components/StatusBadge';
import { EmptyState, FadeIn, ListSkeleton, PageHeader, StatCard, useIsMobile } from '../components/ui';
import { useApi } from '../hooks';
import { addDays, day, litres, money, STATUS_LABEL, time, todayIso } from '../format';

function Approval({ j }: { j: Job }) {
  if (j.status !== 'completed') return <Text span c="dimmed">—</Text>;
  if (j.invoice_number) return <Badge variant="light" color="gray">Invoiced</Badge>;
  if (j.approval_status === 'pending') return <Badge color="orange" variant="light" leftSection={<IconAlertTriangle size={12} />}>Review</Badge>;
  if (j.approval_status === 'rejected') return <Badge color="red">Rejected</Badge>;
  return <Badge color="teal" leftSection={<IconCircleCheck size={12} />}>Approved</Badge>;
}

export default function Jobs() {
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [range, setRange] = useState<[string | null, string | null]>([addDays(todayIso(), -7), todayIso()]);
  const [status, setStatus] = useState<string | null>(null);
  const [approval, setApproval] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q.trim(), 250);
  const [from, to] = [range[0] ?? addDays(todayIso(), -7), range[1] ?? range[0] ?? todayIso()];
  const params = new URLSearchParams({ from, to });
  if (status) params.set('status', status);
  if (approval) params.set('approval', approval);
  if (tag) params.set('tag', tag);
  if (dq) params.set('q', dq);
  const jobs = useApi<Job[]>(`/jobs?${params}`);

  const rows = jobs.data ?? [];
  const tags = useMemo(() => [...new Set(rows.flatMap((j) => j.tags ?? []))].sort(), [rows]);
  const done = rows.filter((j) => j.status === 'completed');
  const total = done.reduce((s, j) => s + (j.delivered_litres ?? 0), 0);
  const value = done.reduce((s, j) => s + Number(j.amount ?? 0), 0);
  const review = done.filter((j) => j.approval_status === 'pending').length;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Jobs"
        subtitle="Every delivery, searchable, with its proof and charges."
        actions={<Button variant="default" component="a" href={authedUrl(`/exports/deliveries.csv?from=${from}&to=${to}`)} leftSection={<IconDownload size={16} />}>Export CSV</Button>}
      />
      <div className="wt-stats">
        <StatCard label="Jobs" value={rows.length.toLocaleString()} hint={`${done.length} delivered`} />
        <StatCard label="Delivered" value={litres(total)} />
        <StatCard label="Billable" value={money(value)} hint="Before tax" />
        <StatCard label="Needs review" value={review} color={review ? '#f97316' : undefined} hint={review ? 'Meter or location did not match' : 'All clear'} />
      </div>

      <Group gap="sm" my="md" wrap="wrap" className="wt-filters">
        <DatePickerInput type="range" value={range} onChange={(v) => setRange(v as [string | null, string | null])} leftSection={<IconCalendar size={16} />} valueFormat="MMM D" size="sm" miw={190} allowSingleDateInRange />
        <TextInput placeholder="Search job, customer, address, driver" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} size="sm" style={{ flex: '1 1 220px' }} />
        <Select placeholder="Any status" clearable value={status} onChange={setStatus} size="sm" w={150}
          data={(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <Select placeholder="Any approval" clearable value={approval} onChange={setApproval} size="sm" w={150}
          data={[{ value: 'pending', label: 'Needs review' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }]} />
        {(tags.length > 0 || tag) && <Select placeholder="Any tag" clearable value={tag} onChange={setTag} size="sm" w={140} data={tag && !tags.includes(tag) ? [tag, ...tags] : tags} />}
      </Group>

      {jobs.isLoading && <ListSkeleton rows={6} />}
      {jobs.data && rows.length === 0 && (
        <Card><EmptyState icon={<IconClipboardList size={26} />} title="No jobs match">Try a wider date range or clear the filters.</EmptyState></Card>
      )}

      {mobile ? (
        <Stack gap={8}>
          {rows.map((j, i) => <FadeIn key={j.id} i={i}><JobCard job={j} onOpen={() => navigate(`/jobs/${j.id}`)} showDriver showDate /></FadeIn>)}
        </Stack>
      ) : (
        rows.length > 0 && (
          <Card p={0}>
            <Table.ScrollContainer minWidth={980}>
              <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Job</Table.Th><Table.Th>Date</Table.Th><Table.Th>Customer</Table.Th><Table.Th>Driver</Table.Th>
                    <Table.Th>Status</Table.Th><Table.Th ta="right">Delivered</Table.Th><Table.Th ta="right">Amount</Table.Th><Table.Th>Billing</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((j) => (
                    <Table.Tr key={j.id} onClick={() => navigate(`/jobs/${j.id}`)} style={{ cursor: 'pointer' }}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text fw={600} className="wt-num">#{j.number}</Text>
                          {j.source === 'portal' && <Tooltip label="Requested online"><IconWorld size={14} opacity={0.55} /></Tooltip>}
                          {j.comment_count > 0 && <Tooltip label={`${j.comment_count} messages`}><Group gap={2} c="dimmed" wrap="nowrap"><IconMessage size={14} /><Text size="xs">{j.comment_count}</Text></Group></Tooltip>}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{day(j.scheduled_date)}</Text>
                        {j.completed_at && <Text size="xs" c="dimmed">Done {time(j.completed_at)}</Text>}
                      </Table.Td>
                      <Table.Td maw={260}>
                        <Text size="sm" fw={550} truncate>{j.customer_name}</Text>
                        <Group gap={4} wrap="nowrap">
                          {j.site_label !== j.customer_name && <Text size="xs" c="dimmed" truncate>{j.site_label}</Text>}
                          {(j.tags ?? []).slice(0, 2).map((t) => <Badge key={t} size="xs" variant="default">{t}</Badge>)}
                        </Group>
                      </Table.Td>
                      <Table.Td>{j.driver_name ?? <Text span c="dimmed">Unassigned</Text>}</Table.Td>
                      <Table.Td><StatusBadge status={j.status} /></Table.Td>
                      <Table.Td ta="right" className="wt-num">
                        {j.delivered_litres !== null ? <Text size="sm" fw={650}>{litres(j.delivered_litres)}</Text> : <Text size="xs" c="dimmed">{j.requested_litres ? `${litres(j.requested_litres)} asked` : 'Fill'}</Text>}
                      </Table.Td>
                      <Table.Td ta="right" className="wt-num">{j.status === 'completed' ? money(j.amount) : <Text span c="dimmed">—</Text>}</Table.Td>
                      <Table.Td><Approval j={j} /></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        )
      )}
    </>
  );
}
