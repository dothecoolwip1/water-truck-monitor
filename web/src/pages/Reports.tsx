import { useState } from 'react';
import { Box, Button, Card, Group, ScrollArea, SegmentedControl, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { AreaChart, BarChart } from '@mantine/charts';
import { DatePickerInput } from '@mantine/dates';
import { IconAlertTriangle, IconCalendar, IconCircleCheck, IconDownload, IconDroplet, IconGauge } from '@tabler/icons-react';
import { authedUrl, type DayReport, type Tank } from '../api';
import { PageHeader, StatCard, useIsMobile } from '../components/ui';
import { useApi } from '../hooks';
import { addDays, compactLitres, dateTime, day, litres, todayIso } from '../format';

interface Fill {
  id: string;
  started_at: string;
  ended_at: string;
  truck_name: string;
  driver_name: string;
  tank_name: string | null;
  litres_reported: number | null;
  litres_from_tank: number | null;
}
interface CustomerTotal {
  id: string;
  name: string;
  account_code: string | null;
  deliveries: number;
  litres: number;
}

const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

export default function Reports() {
  const mobile = useIsMobile();
  const [range, setRange] = useState<[string | null, string | null]>([addDays(todayIso(), -13), todayIso()]);
  const [from, to] = [range[0] ?? addDays(todayIso(), -13), range[1] ?? range[0] ?? todayIso()];
  const q = `from=${from}&to=${to}`;
  const daily = useApi<DayReport[]>(`/reports/daily?${q}`);
  const fills = useApi<Fill[]>(`/reports/fills?${q}`);
  const customers = useApi<CustomerTotal[]>(`/reports/customers?${q}`);
  const tanks = useApi<Tank[]>('/tanks');

  const days = daily.data ?? [];
  const delivered = days.reduce((s, d) => s + d.delivered_l, 0);
  const jobs = days.reduce((s, d) => s + d.jobs_completed, 0);
  const hasTank = days.some((d) => d.tank_drawn_l !== null);
  const drawn = hasTank ? days.reduce((s, d) => s + (d.tank_drawn_l ?? 0), 0) : null;
  const gap = drawn === null ? null : drawn - delivered;
  const gapPct = gap !== null && drawn ? (gap / drawn) * 100 : null;

  const quick = (n: number) => setRange([addDays(todayIso(), -(n - 1)), todayIso()]);

  return (
    <Box maw={1400}>
      <PageHeader
        eyebrow="Money"
        title="Reports"
        subtitle={`${day(from)} to ${day(to)}`}
        actions={<Button variant="default" component="a" href={authedUrl(`/exports/deliveries.csv?${q}`)} leftSection={<IconDownload size={16} />}>Export CSV</Button>}
      />
      <Group gap="xs" mb="md" wrap="wrap">
        <DatePickerInput type="range" value={range} onChange={(v) => setRange(v as [string | null, string | null])} leftSection={<IconCalendar size={16} />} valueFormat="MMM D" size="sm" miw={200} allowSingleDateInRange />
        <Button variant="subtle" size="compact-sm" onClick={() => quick(7)}>7 days</Button>
        <Button variant="subtle" size="compact-sm" onClick={() => quick(14)}>14 days</Button>
        <Button variant="subtle" size="compact-sm" onClick={() => quick(30)}>30 days</Button>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md" mb="lg">
        <StatCard label="Delivered" value={compactLitres(delivered)} hint={`${jobs.toLocaleString('en-CA')} deliveries`} icon={<IconDroplet size={20} />} />
        <StatCard label="Drawn from tank" value={drawn === null ? 'No sensor' : compactLitres(drawn)} hint="from the level sensor" icon={<IconGauge size={20} />} color="cyan" />
        <StatCard label="Not accounted for" value={gap === null ? '—' : compactLitres(gap)} hint={gapPct === null ? '' : `${gapPct.toFixed(1)}% of drawn`} icon={<IconAlertTriangle size={20} />} color={gapPct !== null && gapPct > 10 ? 'red' : 'orange'} />
        <StatCard label="Per delivery" value={jobs ? litres(delivered / jobs) : '—'} hint="average" icon={<IconCircleCheck size={20} />} color="teal" />
      </SimpleGrid>

      <Stack gap="md">
        <DailyCard days={days} hasTank={hasTank} mobile={mobile} />
        {(tanks.data ?? []).map((t) => <TankLevel key={t.id} tank={t} />)}
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Card>
            <Title order={4} mb="sm">Truck fills</Title>
            <Text size="xs" c="dimmed" mb="sm">What the driver's meter said against what left the bulk tank during the fill.</Text>
            <ScrollArea.Autosize mah={440} type="auto" viewportProps={{ tabIndex: 0, 'aria-label': 'Truck fills' }}>
            <Table.ScrollContainer minWidth={480}>
              <Table fz="sm" verticalSpacing={6}>
                <Table.Thead><Table.Tr><Table.Th>When</Table.Th><Table.Th>Truck</Table.Th><Table.Th>Driver</Table.Th><Table.Th ta="right">Tank sensor</Table.Th><Table.Th ta="right">Meter</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {(fills.data ?? []).map((f) => (
                    <Table.Tr key={f.id}>
                      <Table.Td>{dateTime(f.started_at)}</Table.Td><Table.Td>{f.truck_name}</Table.Td><Table.Td>{f.driver_name}</Table.Td>
                      <Table.Td ta="right">{f.litres_from_tank === null ? <Text span c="dimmed" size="xs">no reading</Text> : litres(f.litres_from_tank)}</Table.Td>
                      <Table.Td ta="right">{litres(f.litres_reported)}</Table.Td>
                    </Table.Tr>
                  ))}
                  {fills.data?.length === 0 && <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" size="sm">No fills in this range.</Text></Table.Td></Table.Tr>}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            </ScrollArea.Autosize>
          </Card>
          <Card>
            <Title order={4} mb="sm">By customer</Title>
            <Text size="xs" c="dimmed" mb="sm">Totals for billing, highest first.</Text>
            <ScrollArea.Autosize mah={440} type="auto" viewportProps={{ tabIndex: 0, 'aria-label': 'Totals by customer' }}>
            <Table.ScrollContainer minWidth={380}>
              <Table fz="sm" verticalSpacing={6} highlightOnHover>
                <Table.Thead><Table.Tr><Table.Th>Customer</Table.Th><Table.Th>Account</Table.Th><Table.Th ta="right">Deliveries</Table.Th><Table.Th ta="right">Litres</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {(customers.data ?? []).map((c) => (
                    <Table.Tr key={c.id}><Table.Td fw={500}>{c.name}</Table.Td><Table.Td c="dimmed">{c.account_code ?? '—'}</Table.Td><Table.Td ta="right">{c.deliveries}</Table.Td><Table.Td ta="right" fw={700}>{litres(c.litres)}</Table.Td></Table.Tr>
                  ))}
                  {customers.data?.length === 0 && <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" size="sm">No deliveries in this range.</Text></Table.Td></Table.Tr>}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            </ScrollArea.Autosize>
          </Card>
        </SimpleGrid>
      </Stack>
    </Box>
  );
}

function DailyCard({ days, hasTank, mobile }: { days: DayReport[]; hasTank: boolean; mobile: boolean }) {
  const [view, setView] = useState('chart');
  const data = days.map((d) => ({ day: shortDay(d.day), Delivered: d.delivered_l, ...(hasTank ? { 'Drawn from tank': d.tank_drawn_l ?? 0 } : {}) }));
  return (
    <Card>
      <Group justify="space-between" mb="md" wrap="wrap" gap="xs">
        <Box>
          <Title order={4}>Drawn from the tank vs. delivered</Title>
          <Text size="xs" c="dimmed">A small gap is normal (water left in trucks, meter rounding). A large or growing one is worth a look.</Text>
        </Box>
        <SegmentedControl size="xs" value={view} onChange={setView} data={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
      </Group>
      {view === 'chart' ? (
        <BarChart
          h={mobile ? 240 : 300}
          data={data}
          dataKey="day"
          series={[{ name: 'Delivered', color: 'var(--viz-1)' }, ...(hasTank ? [{ name: 'Drawn from tank', color: 'var(--viz-2)' }] : [])]}
          valueFormatter={(v) => `${Math.round(v).toLocaleString('en-CA')} L`}
          withLegend
          legendProps={{ verticalAlign: 'top', height: 36 }}
          tickLine="none"
          gridAxis="y"
          barProps={{ radius: [4, 4, 0, 0] }}
          barChartProps={{ barGap: 2 }}
          yAxisProps={{ width: 64, tickFormatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)) }}
          xAxisProps={{ interval: 'preserveStartEnd', minTickGap: 16 }}
        />
      ) : null}
      {view === 'chart' && hasTank && <GapChart days={days} mobile={mobile} />}
      {view === 'table' && (
        <Table.ScrollContainer minWidth={640}>
          <Table fz="sm" verticalSpacing={6} striped>
            <Table.Thead><Table.Tr><Table.Th>Day</Table.Th><Table.Th ta="right">Deliveries</Table.Th><Table.Th ta="right">Delivered</Table.Th><Table.Th ta="right">Drawn</Table.Th><Table.Th ta="right">Gap</Table.Th><Table.Th>By truck</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {days.map((d) => (
                <Table.Tr key={d.day}>
                  <Table.Td>{day(d.day)}</Table.Td><Table.Td ta="right">{d.jobs_completed}</Table.Td><Table.Td ta="right">{litres(d.delivered_l)}</Table.Td>
                  <Table.Td ta="right">{d.tank_drawn_l === null ? '—' : litres(d.tank_drawn_l)}</Table.Td>
                  <Table.Td ta="right" c={d.unaccounted_pct !== null && d.unaccounted_pct > 10 ? 'red' : undefined}>
                    {d.unaccounted_l === null ? '—' : `${litres(d.unaccounted_l)}${d.unaccounted_pct !== null ? ` (${d.unaccounted_pct}%)` : ''}`}
                  </Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{d.by_truck.map((t) => `${t.truck_name ?? '?'} ${compactLitres(t.delivered_l)}`).join(' · ')}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}

/** The share of drawn water that wasn't delivered, day by day, against the 10% line worth checking. */
function GapChart({ days, mobile }: { days: DayReport[]; mobile: boolean }) {
  const data = days.filter((d) => d.unaccounted_pct !== null).map((d) => ({ day: shortDay(d.day), 'Not accounted for': d.unaccounted_pct ?? 0 }));
  if (data.length < 2) return null;
  const over = data.filter((d) => d['Not accounted for'] > 10).length;
  return (
    <Box mt="lg">
      <Group justify="space-between" gap="xs" mb={4}>
        <Text fw={600} size="sm">Not accounted for, % of what was drawn</Text>
        <Text size="xs" c={over ? 'red' : 'dimmed'}>{over ? `${over} ${over === 1 ? 'day' : 'days'} over 10%` : 'Every day under 10%'}</Text>
      </Group>
      <BarChart
        h={mobile ? 150 : 170}
        data={data}
        dataKey="day"
        series={[{ name: 'Not accounted for', color: 'var(--viz-3)' }]}
        valueFormatter={(v) => `${v.toFixed(1)}%`}
        referenceLines={[{ y: 10, label: '10%: worth a look', color: 'gray.6', labelPosition: 'insideTopRight' }]}
        tickLine="none"
        gridAxis="y"
        barProps={{ radius: [4, 4, 0, 0] }}
        yAxisProps={{ width: 64, tickFormatter: (v: number) => `${v}%` }}
        xAxisProps={{ interval: 'preserveStartEnd', minTickGap: 16 }}
      />
    </Box>
  );
}

function TankLevel({ tank }: { tank: Tank }) {
  const readings = useApi<{ ts: string; volume_l: number }[]>(`/tanks/${tank.id}/readings?hours=48`);
  const pts = readings.data ?? [];
  // Thin to one point per ~15 minutes so the chart stays smooth on phones.
  const step = Math.max(1, Math.floor(pts.length / 200));
  const data = pts.filter((_, i) => i % step === 0).map((p) => ({
    t: new Date(p.ts).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric' }),
    Level: Math.round((p.volume_l / tank.capacity_l) * 1000) / 10,
  }));
  return (
    <Card>
      <Title order={4}>{tank.name}</Title>
      <Text size="xs" c="dimmed" mb="md">Level over the last 48 hours. Each drop is a truck filling; the climb overnight is the well pump.</Text>
      {pts.length < 2 ? (
        <Text c="dimmed" size="sm">Not enough readings yet. They appear once the sensor starts posting to the tank feed.</Text>
      ) : (
        <AreaChart
          h={220}
          data={data}
          dataKey="t"
          series={[{ name: 'Level', color: 'var(--viz-1)' }]}
          curveType="monotone"
          withDots={false}
          yAxisProps={{ domain: [0, 100], width: 44 }}
          unit="%"
          gridAxis="y"
          tickLine="none"
          xAxisProps={{ interval: 'preserveStartEnd', minTickGap: 40 }}
          fillOpacity={0.35}
        />
      )}
    </Card>
  );
}
