import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ActionIcon, Affix, Badge, Box, Button, Card, Group, Indicator, Menu, Paper, ScrollArea, SegmentedControl, SimpleGrid, Stack, Text, Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  IconArrowDown, IconArrowUp, IconCircleCheck, IconDots, IconDroplet, IconGripVertical, IconInbox, IconList, IconMap, IconPlus, IconTruck, IconUserCheck,
} from '@tabler/icons-react';
import { post, type Job, type LivePosition, type User } from '../api';
import JobForm from '../components/JobForm';
import JobMap from '../components/Map';
import StatusBadge from '../components/StatusBadge';
import { DayPicker, EmptyState, PageHeader, Sheet, StatCard, useIsMobile } from '../components/ui';
import { notifyError, useApi, useInvalidate, useLive } from '../hooks';
import { compactLitres, day, litres, longDay, time, todayIso } from '../format';

const QUEUE = '__queue__';

interface Column {
  id: string;
  title: string;
  driver: User | null;
  onDuty: LivePosition | null;
  jobs: Job[];
}

function JobCard({ job, inQueue, onOpen, actions, handle, dragging, overlay }: {
  job: Job; inQueue: boolean; onOpen?: () => void; actions?: React.ReactNode; handle?: React.ReactNode; dragging?: boolean; overlay?: boolean;
}) {
  const sub = job.customer_name !== job.site_label ? job.customer_name : job.site_address;
  return (
    <Card
      padding="sm"
      radius="md"
      className="wt-job"
      data-urgent={job.priority === 2 || undefined}
      data-dragging={dragging || undefined}
      data-overlay={overlay || undefined}
      onClick={onOpen}
    >
      <Group gap={6} wrap="nowrap" align="flex-start">
        {handle}
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" gap={6} wrap="nowrap">
            <Text fw={700} size="sm" truncate>
              <Text span c="dimmed" fw={600} size="sm">#{job.number}</Text> {job.site_label}
            </Text>
            <StatusBadge status={job.status} size="xs" />
          </Group>
          {sub && <Text size="xs" c="dimmed" truncate>{sub}</Text>}
          <Group justify="space-between" gap={6} wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <IconDroplet size={14} color="var(--mantine-color-water-5)" />
              <Text size="xs" fw={job.status === 'completed' ? 700 : 500}>
                {job.status === 'completed' ? litres(job.delivered_litres) : job.requested_litres ? litres(job.requested_litres) : 'Fill to full'}
              </Text>
              {job.priority === 2 && <Badge color="red" size="xs" variant="filled">Out of water</Badge>}
              {job.priority === 1 && <Badge color="orange" size="xs">High</Badge>}
            </Group>
            <Text size="xs" c="dimmed">
              {job.completed_at ? `Done ${time(job.completed_at)}` : job.arrived_at ? `On site ${time(job.arrived_at)}` : inQueue && job.scheduled_date ? day(job.scheduled_date) : ''}
            </Text>
          </Group>
        </Stack>
        {actions}
      </Group>
    </Card>
  );
}

function SortableJob({ job, inQueue, onOpen, onHover }: { job: Job; inQueue: boolean; onOpen: () => void; onHover: (id: string | null) => void }) {
  const movable = job.status !== 'completed';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.id, disabled: !movable });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onMouseEnter={() => onHover(job.id)}
      onMouseLeave={() => onHover(null)}
    >
      <JobCard
        job={job}
        inQueue={inQueue}
        onOpen={onOpen}
        dragging={isDragging}
        handle={
          movable ? (
            <Box className="wt-drag" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} aria-label="Drag to move" pt={2}>
              <IconGripVertical size={16} />
            </Box>
          ) : (
            <Box pt={2} c="teal"><IconCircleCheck size={16} /></Box>
          )
        }
      />
    </div>
  );
}

function BoardColumn({ col, children, count }: { col: Column; children: React.ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}` });
  const planned = col.jobs.reduce((s, j) => s + (j.requested_litres ?? 0), 0);
  const delivered = col.jobs.reduce((s, j) => s + (j.delivered_litres ?? 0), 0);
  return (
    <Paper ref={setNodeRef} className="wt-column" data-over={isOver || undefined} withBorder p="sm" radius="lg" bg="var(--mantine-color-default-hover)">
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          {col.driver ? (
            <Indicator color={col.onDuty ? 'teal' : 'gray'} size={9} offset={3} position="bottom-end" withBorder>
              <Box w={28} h={28} style={{ borderRadius: 99, display: 'grid', placeItems: 'center', background: 'var(--mantine-color-water-light)' }}>
                <IconTruck size={16} color="var(--mantine-color-water-6)" />
              </Box>
            </Indicator>
          ) : (
            <Box w={28} h={28} style={{ borderRadius: 99, display: 'grid', placeItems: 'center', background: 'var(--mantine-color-yellow-light)' }}>
              <IconInbox size={16} color="var(--mantine-color-yellow-7)" />
            </Box>
          )}
          <Box style={{ minWidth: 0 }}>
            <Text fw={700} size="sm" truncate>{col.title}</Text>
            <Text size="xs" c="dimmed" truncate>
              {col.driver ? (col.onDuty ? `On duty · ${col.onDuty.truck_name}` : 'Off duty') : `${count} waiting`}
            </Text>
          </Box>
        </Group>
        {col.driver && <Text size="xs" c="dimmed" ta="right">{compactLitres(delivered)}<br />of {compactLitres(planned)}</Text>}
      </Group>
      <Stack gap={8} mih={60}>
        {children}
        {count === 0 && (
          <Text size="xs" c="dimmed" ta="center" py="md">
            {col.driver ? 'Drag requests here to assign them.' : 'No waiting requests. Drag a job here to unassign it.'}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

export default function Dispatch() {
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const wide = useMediaQuery('(min-width: 75em)', true, { getInitialValueInEffect: false });
  const [date, setDate] = useState(todayIso());
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [mobileCol, setMobileCol] = useState<string>(QUEUE);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<string, string[]> | null>(null);
  const invalidate = useInvalidate();

  const [connected, setConnected] = useState(false);
  const poll = connected ? 60_000 : 15_000;
  const dayJobs = useApi<Job[]>(`/jobs?date=${date}`, { refetchInterval: poll });
  const queue = useApi<Job[]>('/jobs?unscheduled=true', { refetchInterval: poll });
  const drivers = useApi<User[]>('/users?role=driver');
  const positions = useApi<LivePosition[]>('/live/positions', { refetchInterval: connected ? 60_000 : 10_000 });

  const live = useLive((e) => {
    if (e.type === 'job') void invalidate('/jobs');
    if (e.type === 'shift' || e.type === 'position') void invalidate('/live/positions');
  });
  useEffect(() => setConnected(live), [live]);

  // Server data, optionally overlaid with the order from a drag that is still saving.
  const columns = useMemo<Column[]>(() => {
    const all = new Map<string, Job>();
    for (const j of [...(queue.data ?? []), ...(dayJobs.data ?? [])]) all.set(j.id, j);
    const assigned = (dayJobs.data ?? []).filter((j) => j.driver_id && j.status !== 'cancelled');
    const queued = [...all.values()]
      .filter((j) => !j.driver_id && j.status === 'requested')
      .sort((a, b) => b.priority - a.priority || a.number - b.number);
    const active = (drivers.data ?? []).filter((d) => d.active || assigned.some((j) => j.driver_id === d.id));
    const cols: Column[] = [
      { id: QUEUE, title: 'Requests', driver: null, onDuty: null, jobs: queued },
      ...active.map((d) => ({
        id: d.id,
        title: d.name,
        driver: d,
        onDuty: (positions.data ?? []).find((p) => p.driver_id === d.id) ?? null,
        jobs: assigned.filter((j) => j.driver_id === d.id).sort((a, b) => a.sort_order - b.sort_order || a.number - b.number),
      })),
    ];
    if (!override) return cols;
    return cols.map((c) => (override[c.id] ? { ...c, jobs: override[c.id].map((id) => all.get(id)).filter((j): j is Job => !!j) } : c));
  }, [queue.data, dayJobs.data, drivers.data, positions.data, override]);

  const allJobs = columns.flatMap((c) => c.jobs);
  const driverCols = columns.filter((c) => c.driver);
  const totals = {
    planned: driverCols.reduce((s, c) => s + c.jobs.reduce((t, j) => t + (j.requested_litres ?? 0), 0), 0),
    delivered: driverCols.reduce((s, c) => s + c.jobs.reduce((t, j) => t + (j.delivered_litres ?? 0), 0), 0),
    done: driverCols.reduce((s, c) => s + c.jobs.filter((j) => j.status === 'completed').length, 0),
    count: driverCols.reduce((s, c) => s + c.jobs.length, 0),
    waiting: columns[0]?.jobs.length ?? 0,
    onDuty: (positions.data ?? []).length,
  };

  async function move(job: Job, toCol: string, index: number) {
    const target = columns.find((c) => c.id === toCol);
    if (!target) return;
    const ids = target.jobs.map((j) => j.id).filter((id) => id !== job.id);
    ids.splice(Math.min(index, ids.length), 0, job.id);
    const fromCol = columns.find((c) => c.jobs.some((j) => j.id === job.id));
    const next: Record<string, string[]> = { [toCol]: ids };
    if (fromCol && fromCol.id !== toCol) next[fromCol.id] = fromCol.jobs.filter((j) => j.id !== job.id).map((j) => j.id);
    setOverride(next);
    try {
      await post('/jobs/reorder', { scheduled_date: date, driver_id: toCol === QUEUE ? null : toCol, job_ids: toCol === QUEUE ? [job.id] : ids });
    } catch (e) {
      notifyError(e, "Couldn't move the job");
    }
    await invalidate('/jobs');
    setOverride(null);
  }

  // --- drag and drop (mouse, touch and keyboard) ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const colOf = (id: string) => (id.startsWith('col:') ? id.slice(4) : columns.find((c) => c.jobs.some((j) => j.id === id))?.id ?? null);
  const [overCol, setOverCol] = useState<{ col: string; index: number } | null>(null);

  function onDragStart(e: DragStartEvent) {
    setDragId(String(e.active.id));
  }
  function onDragOver(e: DragOverEvent) {
    if (!e.over) return setOverCol(null);
    const col = colOf(String(e.over.id));
    if (!col) return;
    const c = columns.find((x) => x.id === col)!;
    const idx = String(e.over.id).startsWith('col:') ? c.jobs.length : c.jobs.findIndex((j) => j.id === e.over!.id);
    setOverCol({ col, index: idx });
  }
  function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    const target = overCol;
    setOverCol(null);
    const job = allJobs.find((j) => j.id === e.active.id);
    if (!job || !e.over || !target) return;
    const from = colOf(job.id);
    if (from === target.col) {
      const c = columns.find((x) => x.id === from)!;
      const oldIdx = c.jobs.findIndex((j) => j.id === job.id);
      if (oldIdx === target.index || from === QUEUE) return;
      const ids = arrayMove(c.jobs.map((j) => j.id), oldIdx, Math.min(target.index, c.jobs.length - 1));
      void move(job, from!, ids.indexOf(job.id));
      return;
    }
    if (['en_route', 'arrived'].includes(job.status) && target.col !== from) {
      notifyError(new Error('Jobs already under way can be reordered but not moved to another driver.'), "Can't move that job");
      return;
    }
    void move(job, target.col, target.index);
  }

  const dragged = dragId ? allJobs.find((j) => j.id === dragId) : null;
  const mapJobs = allJobs.filter((j) => j.scheduled_date === date || j.status === 'requested');

  const header = (
    <PageHeader
      title="Dispatch"
      subtitle={mobile ? undefined : longDay(date)}
      actions={
        <>
          <DayPicker value={date} onChange={setDate} />
          {!mobile && <Button leftSection={<IconPlus size={18} />} onClick={() => setCreating(true)}>New job</Button>}
        </>
      }
    />
  );

  const stats = (
    <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm" mb="md">
      <StatCard label="Delivered" value={`${totals.done} / ${totals.count}`} hint="jobs today" icon={<IconCircleCheck size={20} />} color="teal" />
      <StatCard label="Litres" value={compactLitres(totals.delivered)} hint={`of ${compactLitres(totals.planned)} planned`} icon={<IconDroplet size={20} />} />
      <StatCard label="Requests" value={totals.waiting} hint="waiting to assign" icon={<IconInbox size={20} />} color="yellow" />
      <StatCard
        label="On duty"
        value={totals.onDuty}
        hint={<Group gap={4}><Box w={7} h={7} style={{ borderRadius: 9, background: connected ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-gray-5)' }} />{connected ? 'live' : 'updates every 15 s'}</Group>}
        icon={<IconTruck size={20} />}
        color="grape"
      />
    </SimpleGrid>
  );

  const sheet = (
    <Sheet opened={creating} onClose={() => setCreating(false)} title="New delivery job">
      <JobForm defaultDate={date} onCancel={() => setCreating(false)} onSaved={() => setCreating(false)} />
    </Sheet>
  );

  // ---------- Phone layout: one column at a time, actions in a menu ----------
  if (mobile) {
    const col = columns.find((c) => c.id === mobileCol) ?? columns[0];
    const moveMenu = (j: Job, i: number) => {
      const others = columns.filter((c) => c.id !== col.id && c.driver);
      const underway = ['en_route', 'arrived'].includes(j.status);
      return (
        <Menu position="bottom-end" withinPortal shadow="md" width={220}>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" onClick={(e) => e.stopPropagation()} aria-label="Job actions"><IconDots size={18} /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
            {j.status !== 'completed' && !underway && others.length > 0 && <Menu.Label>Assign to</Menu.Label>}
            {j.status !== 'completed' && !underway && others.map((c) => (
              <Menu.Item key={c.id} leftSection={<IconUserCheck size={16} />} onClick={() => void move(j, c.id, c.jobs.length)}>{c.title}</Menu.Item>
            ))}
            {col.driver && j.status !== 'completed' && (
              <>
                <Menu.Divider />
                <Menu.Item leftSection={<IconArrowUp size={16} />} disabled={i === 0} onClick={() => void move(j, col.id, i - 1)}>Move up</Menu.Item>
                <Menu.Item leftSection={<IconArrowDown size={16} />} disabled={i === col.jobs.length - 1} onClick={() => void move(j, col.id, i + 1)}>Move down</Menu.Item>
                {!underway && <Menu.Item leftSection={<IconInbox size={16} />} onClick={() => void move(j, QUEUE, 0)}>Back to requests</Menu.Item>}
              </>
            )}
          </Menu.Dropdown>
        </Menu>
      );
    };
    return (
      <Box p="md">
        {header}
        {view === 'list' && stats}
        <SegmentedControl fullWidth mb="md" value={view} onChange={(v) => setView(v as 'list' | 'map')}
          data={[
            { value: 'list', label: <Group gap={6} justify="center"><IconList size={16} />List</Group> },
            { value: 'map', label: <Group gap={6} justify="center"><IconMap size={16} />Map</Group> },
          ]} />
        {view === 'map' ? (
          <JobMap jobs={mapJobs} positions={positions.data ?? []} onJobClick={(j) => navigate(`/jobs/${j.id}`)} height="calc(100dvh - 60px - env(safe-area-inset-top) - 76px - env(safe-area-inset-bottom) - 196px)" />
        ) : (
          <>
            <ScrollArea type="never" mb="sm" mx={-16}>
              <Group gap={8} wrap="nowrap" px={16}>
                {columns.map((c) => (
                  <Button key={c.id} size="compact-md" radius="xl" variant={c.id === col.id ? 'filled' : 'default'} onClick={() => setMobileCol(c.id)}
                    rightSection={<Badge size="sm" circle variant={c.id === col.id ? 'white' : 'light'}>{c.jobs.length}</Badge>}>
                    {c.driver ? c.title.split(' ')[0] : 'Requests'}
                  </Button>
                ))}
              </Group>
            </ScrollArea>
            {col.driver && (
              <Text size="sm" c="dimmed" mb="xs">
                {col.onDuty ? `On duty in ${col.onDuty.truck_name}` : 'Off duty'} · {litres(col.jobs.reduce((s, j) => s + (j.delivered_litres ?? 0), 0))} of{' '}
                {litres(col.jobs.reduce((s, j) => s + (j.requested_litres ?? 0), 0))}
              </Text>
            )}
            <Stack gap={8}>
              {col.jobs.map((j, i) => (
                <JobCard key={j.id} job={j} inQueue={!col.driver} onOpen={() => navigate(`/jobs/${j.id}`)} actions={moveMenu(j, i)} />
              ))}
              {col.jobs.length === 0 && (
                <EmptyState icon={<IconInbox size={24} />} title={col.driver ? 'Nothing assigned' : 'No waiting requests'}>
                  {col.driver ? 'Open Requests and use the ⋯ menu to assign jobs.' : 'New requests show up here until they are assigned.'}
                </EmptyState>
              )}
            </Stack>
          </>
        )}
        <Affix position={{ bottom: 'calc(84px + env(safe-area-inset-bottom))', right: 16 }} zIndex={150}>
          <Tooltip label="New job">
            <ActionIcon size={56} radius="xl" variant="filled" onClick={() => setCreating(true)} aria-label="New job" style={{ boxShadow: 'var(--mantine-shadow-lg)' }}>
              <IconPlus size={26} />
            </ActionIcon>
          </Tooltip>
        </Affix>
        {sheet}
      </Box>
    );
  }

  // ---------- Tablet and desktop: drag-and-drop board beside the live map ----------
  return (
    <Box p={{ base: 'md', lg: 'lg' }}>
      {header}
      {stats}
      <Box style={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(0, 1fr) minmax(380px, 42%)' : '1fr', gap: 'var(--mantine-spacing-md)' }}>
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setDragId(null); setOverCol(null); }}>
          <ScrollArea type="auto" offsetScrollbars>
            <Group gap="sm" align="flex-start" wrap="nowrap" pb="xs">
              {columns.map((c) => (
                <BoardColumn key={c.id} col={c} count={c.jobs.length}>
                  <SortableContext items={c.jobs.map((j) => j.id)} strategy={verticalListSortingStrategy}>
                    {c.jobs.map((j) => (
                      <SortableJob key={j.id} job={j} inQueue={!c.driver} onOpen={() => navigate(`/jobs/${j.id}`)} onHover={setHighlight} />
                    ))}
                  </SortableContext>
                </BoardColumn>
              ))}
              {drivers.data && driverCols.length === 0 && (
                <EmptyState icon={<IconTruck size={24} />} title="No drivers yet">Add drivers under Fleet.</EmptyState>
              )}
            </Group>
          </ScrollArea>
          <DragOverlay dropAnimation={{ duration: 160 }}>
            {dragged ? <JobCard job={dragged} inQueue={false} overlay /> : null}
          </DragOverlay>
        </DndContext>
        <Box style={wide ? { position: 'sticky', top: 'calc(76px + env(safe-area-inset-top))', alignSelf: 'start' } : undefined}>
          <JobMap
            jobs={mapJobs}
            positions={positions.data ?? []}
            highlight={highlight}
            onJobClick={(j) => navigate(`/jobs/${j.id}`)}
            height={wide ? 'calc(100dvh - 300px)' : 440}
          />
        </Box>
      </Box>
      {sheet}
    </Box>
  );
}
