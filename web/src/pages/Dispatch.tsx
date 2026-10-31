import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionIcon, Box, Button, Group, Menu, ScrollArea, SegmentedControl, SimpleGrid, Stack, Text, Tooltip, VisuallyHidden } from '@mantine/core';
import { useLocalStorage, useMediaQuery } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'motion/react';
import {
  IconArrowDown, IconArrowUp, IconCircleCheck, IconCircleCheckFilled, IconDots, IconDroplet, IconGripVertical, IconInbox, IconLayoutColumns,
  IconLayoutKanban, IconList, IconMap, IconPlus, IconTruck, IconAlertTriangle, IconRoute,
} from '@tabler/icons-react';
import { post, type Job, type LivePosition, type User } from '../api';
import JobCard from '../components/JobCard';
import JobForm from '../components/JobForm';
import JobMap from '../components/Map';
import { DayPicker, EmptyState, ListSkeleton, PageHeader, Person, Sheet, StatCard } from '../components/ui';
import { useIsMobile } from '../components/ui';
import { notifyError, notifyOk, useApi, useInvalidate, useLive } from '../hooks';
import { compactLitres, litres, longDay, todayIso } from '../format';

const QUEUE = '__queue__';

interface Column {
  id: string;
  title: string;
  driver: User | null;
  onDuty: LivePosition | null;
  jobs: Job[];
}

function SortableJob({ job, onOpen, onHover, highlight }: { job: Job; onOpen: () => void; onHover: (id: string | null) => void; highlight: boolean }) {
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
        onOpen={onOpen}
        dragging={isDragging}
        highlight={highlight}
        showDriver={false}
        handle={
          movable ? (
            <Box className="wt-drag" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} aria-label="Drag to move" pt={1} ml={-4}>
              <IconGripVertical size={16} />
            </Box>
          ) : undefined
        }
      />
    </div>
  );
}

interface Optimized { job_ids: string[]; before_km: number; after_km: number; changed: boolean; depot: { label: string } | null }

/** Works out the shortest order for a driver's stops, shows the saving, and applies it on confirm. */
function BestOrder({ col, date }: { col: Column; date: string }) {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const open = col.jobs.filter((j) => j.status === 'scheduled').length;
  if (!col.driver || open < 2) return null;
  async function run() {
    setBusy(true);
    try {
      const r = await post<Optimized>('/dispatch/optimize', { driver_id: col.driver!.id, scheduled_date: date });
      if (!r.changed) {
        notifyOk(`${col.title}'s stops are already in the shortest order (about ${r.after_km} km).`);
        return;
      }
      const saved = Math.max(0, r.before_km - r.after_km);
      modals.openConfirmModal({
        title: `Best order for ${col.title}`,
        children: (
          <Stack gap={6}>
            <Text size="sm">Driving drops from about <b>{r.before_km} km</b> to <b>{r.after_km} km</b>, saving roughly {saved.toFixed(1)} km.</Text>
            <Text size="sm" c="dimmed">Urgent stops stay first and jobs already under way keep their place. Starting from {r.depot?.label || 'the fill station'}.</Text>
          </Stack>
        ),
        labels: { confirm: 'Use this order', cancel: 'Keep mine' },
        onConfirm: async () => {
          try {
            await post('/jobs/reorder', { scheduled_date: date, driver_id: col.driver!.id, job_ids: r.job_ids });
            await invalidate('/jobs');
            notifyOk(`Stops reordered for ${col.title}`);
          } catch (e) {
            notifyError(e);
          }
        },
      });
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Tooltip label="Put stops in the shortest driving order">
      <ActionIcon variant="subtle" color="gray" size={28} loading={busy} onClick={() => void run()} aria-label="Best stop order"><IconRoute size={16} /></ActionIcon>
    </Tooltip>
  );
}

function ColumnHeader({ col, date }: { col: Column; date: string }) {
  const planned = col.jobs.reduce((s, j) => s + (j.requested_litres ?? 0), 0);
  const delivered = col.jobs.reduce((s, j) => s + (j.delivered_litres ?? 0), 0);
  const done = col.jobs.filter((j) => j.status === 'completed').length;
  if (!col.driver) {
    return (
      <Group gap={10} wrap="nowrap" px={4} pt={2} pb={10}>
        <Box w={32} h={32} style={{ borderRadius: 99, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, #f59e0b 14%, transparent)', color: '#d97706' }}>
          <IconInbox size={17} />
        </Box>
        <Box>
          <Text fw={650} size="sm">Requests</Text>
          <Text size="xs" c="dimmed">{col.jobs.length === 0 ? 'All assigned' : `${col.jobs.length} waiting to assign`}</Text>
        </Box>
      </Group>
    );
  }
  return (
    <Box px={4} pt={2} pb={10}>
      <Group justify="space-between" wrap="nowrap" gap={8}>
        <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
          <Box pos="relative">
            <Person name={col.title} size={32} />
            <Box pos="absolute" right={-1} bottom={-1} w={11} h={11} style={{ borderRadius: 99, border: '2px solid var(--wt-surface)', background: col.onDuty ? '#10b981' : '#94a3b8' }} />
          </Box>
          <Box style={{ minWidth: 0 }}>
            <Text fw={650} size="sm" truncate>{col.title}</Text>
            <Text size="xs" c="dimmed" truncate>{col.onDuty ? `On duty · ${col.onDuty.truck_name}` : 'Off duty'}</Text>
          </Box>
        </Group>
        <Group gap={2} wrap="nowrap" style={{ flex: 'none' }}>
          <BestOrder col={col} date={date} />
          <Text size="xs" c="dimmed" className="wt-num">{done}/{col.jobs.length}</Text>
        </Group>
      </Group>
      <Box className="wt-progress-track" mt={10} h={4}>
        <Box className="wt-progress-fill" style={{ width: `${planned ? Math.min(100, (delivered / planned) * 100) : 0}%` }} />
      </Box>
      <Text size="xs" c="dimmed" mt={6} className="wt-num">{compactLitres(delivered)} of {compactLitres(planned)}</Text>
    </Box>
  );
}

function BoardColumn({ col, date, children }: { col: Column; date: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}` });
  return (
    <div ref={setNodeRef} className="wt-column" data-over={isOver || undefined}>
      <ColumnHeader col={col} date={date} />
      <Stack gap={8} mih={60}>
        {children}
        {col.jobs.length === 0 && (
          <div className="wt-drop-hint">{col.driver ? 'Drag requests here to assign' : 'Drop a job here to unassign it'}</div>
        )}
      </Stack>
    </div>
  );
}

type View = 'board' | 'split' | 'map';

export default function Dispatch() {
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const wide = useMediaQuery('(min-width: 80em)', true, { getInitialValueInEffect: false });
  const [date, setDate] = useState(todayIso());
  const [creating, setCreating] = useState(false);
  const [phoneView, setPhoneView] = useState<'list' | 'map'>('list');
  const [deskView, setDeskView] = useLocalStorage<View>({ key: 'wt.dispatchView', defaultValue: 'split' });
  const view: View = !wide && deskView === 'split' ? 'board' : deskView;
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
  useEffect(() => { setConnected(live); }, [live]);

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
    urgent: allJobs.filter((j) => j.priority === 2 && j.status !== 'completed').length,
    onDuty: (positions.data ?? []).length,
  };
  const loading = dayJobs.isLoading || queue.isLoading || drivers.isLoading;

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

  const sheet = (
    <Sheet opened={creating} onClose={() => setCreating(false)} title="New delivery job">
      <JobForm defaultDate={date} onCancel={() => setCreating(false)} onSaved={() => setCreating(false)} />
    </Sheet>
  );

  const liveChip = (
    <Tooltip label={connected ? 'Updates arrive the moment drivers act' : 'Refreshing every 15 seconds'}>
      <Group gap={7} px={10} h={38} style={{ borderRadius: 10, border: '1px solid var(--wt-border-strong)', background: 'var(--wt-surface)' }}>
        {connected ? <span className="wt-live-dot" /> : <Box w={8} h={8} style={{ borderRadius: 9, background: '#94a3b8' }} />}
        <Text size="sm" fw={600}>{connected ? 'Live' : 'Polling'}</Text>
      </Group>
    </Tooltip>
  );

  // ---------- Phone: summary card, driver lanes, one list at a time ----------
  if (mobile) {
    const col = columns.find((c) => c.id === mobileCol) ?? columns[0];
    const moveMenu = (j: Job, i: number) => {
      const others = columns.filter((c) => c.id !== col.id && c.driver);
      const underway = ['en_route', 'arrived'].includes(j.status);
      if (j.status === 'completed') return null;
      return (
        <Menu position="bottom-end" withinPortal width={230}>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size={30} onClick={(e) => e.stopPropagation()} aria-label="Job actions"><IconDots size={18} /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
            {!underway && others.length > 0 && <Menu.Label>Assign to</Menu.Label>}
            {!underway && others.map((c) => (
              <Menu.Item key={c.id} leftSection={<Person name={c.title} size={20} />} onClick={() => void move(j, c.id, c.jobs.length)}>{c.title}</Menu.Item>
            ))}
            {col.driver && (
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
    const pct = totals.planned ? totals.delivered / totals.planned : 0;
    return (
      <Box>
        <Group justify="space-between" align="flex-end" mb="md" wrap="nowrap">
          <Box>
            <Text className="wt-eyebrow">{longDay(date)}</Text>
            <Text fz={28} fw={650} lh={1.15} style={{ letterSpacing: '-0.02em' }}>Dispatch</Text>
          </Box>
          <SegmentedControl size="xs" value={phoneView} onChange={(v) => setPhoneView(v as 'list' | 'map')}
            data={[
              { value: 'list', label: <Group gap={4} wrap="nowrap"><IconList size={14} />List</Group> },
              { value: 'map', label: <Group gap={4} wrap="nowrap"><IconMap size={14} />Map</Group> },
            ]} />
        </Group>

        <Box mb="md"><DayPicker value={date} onChange={setDate} /></Box>

        {phoneView === 'list' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className="wt-hero">
              <Group justify="space-between" align="flex-start" wrap="nowrap" style={{ position: 'relative', zIndex: 1 }}>
                <Box>
                  <Text size="sm" fw={500} c="rgb(255 255 255 / 0.8)">Delivered</Text>
                  <Group gap={6} align="baseline">
                    <Text fz={34} fw={650} lh={1.1} className="wt-num" style={{ letterSpacing: '-0.03em' }}>{compactLitres(totals.delivered)}</Text>
                    <Text size="sm" c="rgb(255 255 255 / 0.75)" className="wt-num">of {compactLitres(totals.planned)}</Text>
                  </Group>
                </Box>
                <Group gap={6} px={10} py={5} style={{ borderRadius: 99, background: 'rgb(255 255 255 / 0.16)' }}>
                  {connected ? <span className="wt-live-dot" /> : null}
                  <Text size="xs" fw={600}>{connected ? 'Live' : 'Updating'}</Text>
                </Group>
              </Group>
              <Box className="wt-progress-track" mt={14} h={8} style={{ position: 'relative', zIndex: 1 }}>
                <Box className="wt-progress-fill" style={{ width: `${Math.min(100, pct * 100)}%` }} />
              </Box>
              <SimpleGrid cols={3} mt={16} spacing={8} style={{ position: 'relative', zIndex: 1 }}>
                <Box><div className="wt-hero-num">{totals.done}/{totals.count}</div><div className="wt-hero-stat">jobs done</div></Box>
                <Box><div className="wt-hero-num">{totals.waiting}</div><div className="wt-hero-stat">to assign</div></Box>
                <Box><div className="wt-hero-num">{totals.onDuty}</div><div className="wt-hero-stat">trucks out</div></Box>
              </SimpleGrid>
            </div>
          </motion.div>
        )}

        {phoneView === 'map' ? (
          <Box mt={4}>
            <JobMap jobs={mapJobs} positions={positions.data ?? []} onJobClick={(j) => navigate(`/jobs/${j.id}`)}
              height="calc(100dvh - var(--wt-topbar-h) - env(safe-area-inset-top) - var(--wt-tabbar-h) - env(safe-area-inset-bottom) - 190px)" />
          </Box>
        ) : (
          <>
            <Text className="wt-section-title" mt="lg" mb={8}>Lanes</Text>
            <div className="wt-lanes">
              {columns.map((c) => (
                <button key={c.id} className="wt-lane" data-active={c.id === col.id || undefined} onClick={() => setMobileCol(c.id)}>
                  {c.driver ? <Person name={c.title} size={28} /> : (
                    <Box w={28} h={28} style={{ borderRadius: 99, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, #f59e0b 18%, transparent)', color: '#d97706' }}><IconInbox size={15} /></Box>
                  )}
                  {c.driver ? c.title.split(' ')[0] : 'Requests'}
                  <span className="wt-lane-count">{c.jobs.length}</span>
                </button>
              ))}
            </div>

            {col.driver && (
              <Group justify="space-between" mt="md" mb={8}>
                <Text size="sm" c="dimmed">{col.onDuty ? `On duty in ${col.onDuty.truck_name}` : 'Off duty'}</Text>
                <Text size="sm" c="dimmed" className="wt-num">
                  {litres(col.jobs.reduce((s, j) => s + (j.delivered_litres ?? 0), 0))} / {litres(col.jobs.reduce((s, j) => s + (j.requested_litres ?? 0), 0))}
                </Text>
              </Group>
            )}
            {!col.driver && <Box mt="md" />}

            {loading ? <ListSkeleton rows={4} height={96} /> : (
              <Stack gap={8}>
                <AnimatePresence initial={false}>
                  {col.jobs.map((j, i) => (
                    <motion.div key={j.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22, delay: Math.min(i, 8) * 0.025 }}>
                      <JobCard job={j} onOpen={() => navigate(`/jobs/${j.id}`)} actions={moveMenu(j, i)} showDriver={false} showDate={!col.driver} />
                    </motion.div>
                  ))}
                </AnimatePresence>
                {col.jobs.length === 0 && (
                  <EmptyState icon={col.driver ? <IconTruck size={26} /> : <IconCircleCheckFilled size={26} />} title={col.driver ? 'Nothing assigned yet' : 'All requests assigned'}>
                    {col.driver ? 'Open Requests and use the ⋯ menu on a job to give it to this driver.' : 'New requests from the office or residents land here.'}
                  </EmptyState>
                )}
              </Stack>
            )}
          </>
        )}
        <button className="wt-fab" onClick={() => setCreating(true)} aria-label="New job"><IconPlus size={22} stroke={2.4} />New job</button>
        {sheet}
      </Box>
    );
  }

  // ---------- Tablet and desktop: drag-and-drop board beside the live map ----------
  const board = (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setDragId(null); setOverCol(null); }}>
      <ScrollArea type="auto" offsetScrollbars scrollbarSize={8}>
        <Group gap={12} align="flex-start" wrap="nowrap" pb={8}>
          {columns.map((c) => (
            <BoardColumn key={c.id} col={c} date={date}>
              <SortableContext items={c.jobs.map((j) => j.id)} strategy={verticalListSortingStrategy}>
                {c.jobs.map((j) => (
                  <SortableJob key={j.id} job={j} onOpen={() => navigate(`/jobs/${j.id}`)} onHover={setHighlight} highlight={highlight === j.id} />
                ))}
              </SortableContext>
            </BoardColumn>
          ))}
          {drivers.data && driverCols.length === 0 && (
            <EmptyState icon={<IconTruck size={26} />} title="No drivers yet" action={<Button variant="light" onClick={() => navigate('/fleet')}>Add drivers</Button>}>
              Add your drivers under Fleet & people, then drag requests onto them.
            </EmptyState>
          )}
        </Group>
      </ScrollArea>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
        {dragged ? <JobCard job={dragged} overlay showDriver={false} /> : null}
      </DragOverlay>
    </DndContext>
  );
  const map = (h: string | number) => (
    <JobMap jobs={mapJobs} positions={positions.data ?? []} highlight={highlight} onJobClick={(j) => navigate(`/jobs/${j.id}`)} height={h} />
  );

  return (
    <Box>
      <PageHeader
        eyebrow={longDay(date)}
        title="Dispatch"
        actions={
          <>
            {liveChip}
            <DayPicker value={date} onChange={setDate} />
            <SegmentedControl
              value={view}
              onChange={(v) => setDeskView(v as View)}
              data={[
                { value: 'board', label: <Tooltip label="Board"><Box><IconLayoutKanban size={17} /><VisuallyHidden>Board</VisuallyHidden></Box></Tooltip> },
                ...(wide ? [{ value: 'split', label: <Tooltip label="Board and map"><Box><IconLayoutColumns size={17} /><VisuallyHidden>Board and map</VisuallyHidden></Box></Tooltip> }] : []),
                { value: 'map', label: <Tooltip label="Map"><Box><IconMap size={17} /><VisuallyHidden>Map</VisuallyHidden></Box></Tooltip> },
              ]}
              styles={{ root: { height: 38 }, label: { padding: '6px 10px' } }}
            />
            <Button leftSection={<IconPlus size={18} />} onClick={() => setCreating(true)} h={38}>New job</Button>
          </>
        }
      />
      <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="md" mb="lg">
        <StatCard label="Jobs delivered" value={<>{totals.done}<Text span c="dimmed" fz={18} fw={500}> / {totals.count}</Text></>} progress={totals.count ? totals.done / totals.count : 0} icon={<IconCircleCheck size={17} />} color="#10b981" />
        <StatCard label="Litres delivered" value={compactLitres(totals.delivered)} progress={totals.planned ? totals.delivered / totals.planned : 0} hint={`of ${compactLitres(totals.planned)} planned`} icon={<IconDroplet size={17} />} />
        <StatCard label="Waiting to assign" value={totals.waiting} hint={totals.urgent ? <Group gap={4} c="red"><IconAlertTriangle size={13} />{totals.urgent} out of water</Group> : 'Requests queue'} icon={<IconInbox size={17} />} color="#f59e0b" />
        <StatCard label="Trucks on duty" value={totals.onDuty} hint={`${driverCols.length} drivers today`} icon={<IconTruck size={17} />} color="#8b5cf6" />
      </SimpleGrid>

      {loading ? (
        <Group gap={12} align="flex-start" wrap="nowrap">{[0, 1, 2].map((i) => <Box key={i} w={296}><ListSkeleton rows={4 - i} height={104} /></Box>)}</Group>
      ) : view === 'map' ? (
        map('calc(100dvh - 300px)')
      ) : view === 'split' ? (
        <Box style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(420px, 40%)', gap: 16 }}>
          <Box style={{ minWidth: 0 }}>{board}</Box>
          <Box style={{ position: 'sticky', top: 24, alignSelf: 'start' }}>{map('calc(100dvh - 48px)')}</Box>
        </Box>
      ) : board}
      {sheet}
    </Box>
  );
}
