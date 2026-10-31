import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, Group, Select, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconCalendar, IconClipboardList, IconDownload, IconSearch } from '@tabler/icons-react';
import { authedUrl, type Job, type JobStatus } from '../api';
import StatusBadge from '../components/StatusBadge';
import { EmptyState, PageHeader, useIsMobile } from '../components/ui';
import { useApi } from '../hooks';
import { addDays, day, litres, STATUS_LABEL, time, todayIso } from '../format';

export default function Jobs() {
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [range, setRange] = useState<[string | null, string | null]>([addDays(todayIso(), -7), todayIso()]);
  const [status, setStatus] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [from, to] = [range[0] ?? addDays(todayIso(), -7), range[1] ?? range[0] ?? todayIso()];
  const jobs = useApi<Job[]>(`/jobs?from=${from}&to=${to}${status ? `&status=${status}` : ''}`);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (jobs.data ?? []).filter(
      (j) => !n || String(j.number).includes(n) || j.customer_name.toLowerCase().includes(n) || j.site_label.toLowerCase().includes(n) || (j.driver_name ?? '').toLowerCase().includes(n),
    );
  }, [jobs.data, q]);
  const total = rows.reduce((s, j) => s + (j.delivered_litres ?? 0), 0);

  return (
    <Box p={{ base: 'md', lg: 'lg' }}>
      <PageHeader
        title="Jobs"
        subtitle={`${rows.length} jobs · ${litres(total)} delivered`}
        actions={<Button variant="default" component="a" href={authedUrl(`/exports/deliveries.csv?from=${from}&to=${to}`)} leftSection={<IconDownload size={16} />}>Export CSV</Button>}
      />
      <Group gap="sm" mb="md" grow={mobile} wrap="wrap">
        <DatePickerInput type="range" value={range} onChange={(v) => setRange(v as [string | null, string | null])} leftSection={<IconCalendar size={16} />} valueFormat="MMM D" size="sm" miw={200} allowSingleDateInRange />
        <Select placeholder="Any status" clearable value={status} onChange={setStatus} size="sm" miw={150}
          data={(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <TextInput placeholder="Search job, customer, driver" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} size="sm" miw={220} />
      </Group>

      {jobs.isLoading && <Stack>{[1, 2, 3, 4].map((i) => <Skeleton key={i} h={64} radius="md" />)}</Stack>}
      {jobs.data && rows.length === 0 && <EmptyState icon={<IconClipboardList size={24} />} title="No jobs match">Try a wider date range or clear the search.</EmptyState>}

      {mobile ? (
        <Stack gap={8}>
          {rows.map((j) => (
            <Card key={j.id} padding="sm" radius="md" className="wt-job" onClick={() => navigate(`/jobs/${j.id}`)}>
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Box style={{ minWidth: 0 }}>
                  <Text fw={700} size="sm" truncate><Text span c="dimmed" size="sm">#{j.number}</Text> {j.customer_name}</Text>
                  <Text size="xs" c="dimmed" truncate>{day(j.scheduled_date)} · {j.driver_name ?? 'Unassigned'}{j.site_label !== j.customer_name ? ` · ${j.site_label}` : ''}</Text>
                </Box>
                <Stack gap={4} align="flex-end">
                  <StatusBadge status={j.status} size="xs" />
                  <Text size="sm" fw={700}>{j.delivered_litres !== null ? litres(j.delivered_litres) : <Text span c="dimmed" size="xs">{litres(j.requested_litres)} req.</Text>}</Text>
                </Stack>
              </Group>
            </Card>
          ))}
        </Stack>
      ) : (
        rows.length > 0 && (
          <Card p={0}>
            <Table.ScrollContainer minWidth={860}>
              <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Job</Table.Th><Table.Th>Date</Table.Th><Table.Th>Customer</Table.Th><Table.Th>Driver</Table.Th><Table.Th>Truck</Table.Th>
                    <Table.Th>Status</Table.Th><Table.Th ta="right">Requested</Table.Th><Table.Th ta="right">Delivered</Table.Th><Table.Th>Done</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((j) => (
                    <Table.Tr key={j.id} onClick={() => navigate(`/jobs/${j.id}`)} style={{ cursor: 'pointer' }}>
                      <Table.Td fw={600}>#{j.number}</Table.Td>
                      <Table.Td>{day(j.scheduled_date)}</Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={500}>{j.customer_name}</Text>
                        {j.site_label !== j.customer_name && <Text size="xs" c="dimmed">{j.site_label}</Text>}
                      </Table.Td>
                      <Table.Td>{j.driver_name ?? <Text span c="dimmed">—</Text>}</Table.Td>
                      <Table.Td>{j.truck_name ?? <Text span c="dimmed">—</Text>}</Table.Td>
                      <Table.Td><StatusBadge status={j.status} /></Table.Td>
                      <Table.Td ta="right">{litres(j.requested_litres)}</Table.Td>
                      <Table.Td ta="right" fw={700}>{j.delivered_litres !== null ? litres(j.delivered_litres) : '—'}</Table.Td>
                      <Table.Td>{time(j.completed_at)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        )
      )}
    </Box>
  );
}
