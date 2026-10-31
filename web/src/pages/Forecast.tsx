import { useMemo, useState } from 'react';
import { Badge, Box, Button, Card, Group, Progress, SegmentedControl, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconCalendarPlus, IconDroplet, IconFlame, IconHeartbeat, IconSearch, IconTank } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import type { SiteForecast } from '../api';
import JobForm from '../components/JobForm';
import StatusBadge from '../components/StatusBadge';
import { EmptyState, FadeIn, ListSkeleton, PageHeader, Sheet, StatCard } from '../components/ui';
import { useApi } from '../hooks';
import { day, litres, todayIso } from '../format';

const STATE_COLOR: Record<SiteForecast['state'], string> = { empty: 'red', low: 'orange', ok: 'teal', unknown: 'gray' };
const STATE_LABEL: Record<SiteForecast['state'], string> = { empty: 'Probably empty', low: 'Running low', ok: 'Fine for now', unknown: 'Not enough history' };

function daysText(f: SiteForecast) {
  if (f.days_left === null) return 'Need two deliveries to estimate';
  if (f.days_left <= 0) return 'Empty now';
  const d = Math.round(f.days_left);
  return d <= 1 ? 'About a day left' : `About ${d} days left`;
}

function Row({ f, i, onBook }: { f: SiteForecast; i: number; onBook: () => void }) {
  const navigate = useNavigate();
  const color = STATE_COLOR[f.state];
  return (
    <FadeIn i={i}>
      <Card padding="md" className="wt-forecast" data-state={f.state}>
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
          <Box style={{ minWidth: 0, flex: 1 }} onClick={() => navigate(`/customers/${f.customer_id}`)}>
            <Group gap={6} wrap="nowrap">
              <Text fw={700} truncate>{f.site_label}</Text>
              {f.critical && (
                <Tooltip label="Critical site, such as a clinic or elder care">
                  <Badge size="xs" color="red" variant="light" leftSection={<IconHeartbeat size={11} />}>Critical</Badge>
                </Tooltip>
              )}
            </Group>
            <Text size="sm" c="dimmed" truncate>{f.customer_name}{f.site_address ? ` · ${f.site_address}` : ''}</Text>
          </Box>
          <Badge color={f.state === 'empty' ? 'red.9' : color} variant={f.state === 'empty' ? 'filled' : 'light'} style={{ flexShrink: 0 }}>{STATE_LABEL[f.state]}</Badge>
        </Group>

        <Box mt="sm">
          <Group justify="space-between" mb={4} gap="xs">
            <Text size="sm" fw={600}>{daysText(f)}</Text>
            {f.level_pct !== null && <Text size="sm" c="dimmed">{Math.round(f.level_pct)}% · {litres(f.level_l)}</Text>}
          </Group>
          <Progress value={f.level_pct ?? 0} color={color} size="lg" radius="xl" aria-label={`${f.site_label} tank level`} />
          <Group justify="space-between" mt={6} gap="xs">
            <Text size="xs" c="dimmed">
              {f.litres_per_day !== null ? `Uses about ${litres(Math.round(f.litres_per_day))} a day` : `${f.deliveries} ${f.deliveries === 1 ? 'delivery' : 'deliveries'} on record`}
              {f.empty_on ? ` · empty around ${day(f.empty_on)}` : ''}
            </Text>
            {f.tank_capacity_l ? <Text size="xs" c="dimmed">Tank {litres(f.tank_capacity_l)}</Text> : null}
          </Group>
        </Box>

        <Group justify="space-between" mt="sm" gap="xs">
          {f.open_job ? (
            <Group gap={8} style={{ cursor: 'pointer' }} onClick={() => navigate(`/jobs/${f.open_job!.id}`)}>
              <Text size="sm" fw={600}>#{f.open_job.number}</Text>
              <StatusBadge status={f.open_job.status} />
              {f.open_job.scheduled_date && <Text size="sm" c="dimmed">{day(f.open_job.scheduled_date)}</Text>}
            </Group>
          ) : (
            <Text size="sm" c="dimmed">No delivery booked</Text>
          )}
          {!f.open_job && (
            <Button size="xs" variant={f.state === 'ok' || f.state === 'unknown' ? 'default' : 'filled'} color={f.state === 'empty' ? 'red' : undefined}
              leftSection={<IconCalendarPlus size={15} />} onClick={onBook}>
              Book delivery
            </Button>
          )}
        </Group>
      </Card>
    </FadeIn>
  );
}

export default function Forecast() {
  const data = useApi<{ warn_days: number; sites: SiteForecast[] }>('/forecast', { refetchInterval: 120_000 });
  const [show, setShow] = useState<'attention' | 'all'>('attention');
  const [q, setQ] = useState('');
  const [booking, setBooking] = useState<SiteForecast | null>(null);

  const sites = useMemo(() => data.data?.sites ?? [], [data.data]);
  const counts = useMemo(() => ({
    empty: sites.filter((s) => s.state === 'empty').length,
    low: sites.filter((s) => s.state === 'low').length,
    unbooked: sites.filter((s) => (s.state === 'empty' || s.state === 'low') && !s.open_job).length,
    unknown: sites.filter((s) => s.state === 'unknown').length,
  }), [sites]);

  const shown = sites.filter((s) => {
    if (show === 'attention' && s.state !== 'empty' && s.state !== 'low') return false;
    const needle = q.trim().toLowerCase();
    return !needle || `${s.site_label} ${s.customer_name} ${s.site_address ?? ''}`.toLowerCase().includes(needle);
  });
  const warn = data.data?.warn_days ?? 3;

  return (
    <Box>
      <PageHeader
        title="Running low"
        subtitle={`Each tank's level is estimated from how much water it has taken in the past. Houses expected to run dry within ${warn} days show here first.`}
      />
      <div className="wt-stats" style={{ marginBottom: 'var(--mantine-spacing-lg)' }}>
        <StatCard label="Probably empty" value={counts.empty} hint="past their usual refill" icon={<IconFlame size={20} />} color="red" />
        <StatCard label="Running low" value={counts.low} hint={`empty within ${warn} days`} icon={<IconAlertTriangle size={20} />} color="orange" />
        <StatCard label="Not booked yet" value={counts.unbooked} hint="low or empty, no delivery set" icon={<IconCalendarPlus size={20} />} />
        <StatCard label="Learning" value={counts.unknown} hint="need more deliveries" icon={<IconTank size={20} />} color="gray" />
      </div>

      <Group className="wt-filters" mb="md" gap="sm">
        <SegmentedControl style={{ flex: '1 1 300px' }} value={show} onChange={(v) => setShow(v as 'attention' | 'all')}
          data={[{ value: 'attention', label: `Needs water (${counts.empty + counts.low})` }, { value: 'all', label: `All (${sites.length})` }]} />
        <TextInput placeholder="Search houses" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} style={{ flex: '1 1 240px' }} />
      </Group>

      {data.isLoading ? <ListSkeleton rows={5} height={150} /> : shown.length === 0 ? (
        <EmptyState icon={<IconDroplet size={28} />} title={show === 'attention' ? 'Nobody is running low' : 'No houses match'}>
          {show === 'attention' ? 'Every tank with enough history should last more than a few days.' : 'Try a different search.'}
        </EmptyState>
      ) : (
        <Stack gap="sm" className="wt-forecast-list">
          {shown.map((f, i) => <Row key={f.site_id} f={f} i={i} onBook={() => setBooking(f)} />)}
        </Stack>
      )}

      <Sheet opened={!!booking} onClose={() => setBooking(null)} title={booking ? `Book water for ${booking.site_label}` : ''} size="lg">
        {booking && (
          <JobForm
            defaultDate={todayIso()}
            defaultCustomerId={booking.customer_id}
            defaultSiteId={booking.site_id}
            defaultLitres={booking.tank_capacity_l && booking.level_l !== null ? Math.max(500, Math.round((booking.tank_capacity_l - booking.level_l) / 100) * 100) : undefined}
            onCancel={() => setBooking(null)}
            onSaved={() => { setBooking(null); void data.refetch(); }}
          />
        )}
      </Sheet>
    </Box>
  );
}
