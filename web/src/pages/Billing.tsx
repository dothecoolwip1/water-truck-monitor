import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge, Box, Button, Checkbox, Drawer, Group, Menu, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import {
  IconAlertTriangle, IconCheck, IconChevronDown, IconCircleCheck, IconClockHour4, IconDownload, IconFileInvoice, IconFileTypePdf, IconPlus,
  IconReceipt2, IconSend, IconCash, IconX, IconTag,
} from '@tabler/icons-react';
import { authedUrl, patch, post, put, type BillingSummary, type Customer, type Invoice, type Job, type PriceItem, type QuickBooksStatus, type Settings } from '../api';
import { EmptyState, ListSkeleton, PageHeader, Sheet, StatCard, useIsMobile } from '../components/ui';
import { notifyError, notifyOk, useApi, useInvalidate } from '../hooks';
import { addDays, day, litres, money, todayIso } from '../format';
import { useAuth } from '../auth';

const INV_COLOR: Record<Invoice['status'], string> = { draft: '#64748b', sent: '#2877eb', paid: '#10b981', void: '#94a3b8' };
const INV_LABEL: Record<Invoice['status'], string> = { draft: 'Draft', sent: 'Sent', paid: 'Paid', void: 'Void' };

function InvoiceStatus({ inv }: { inv: Pick<Invoice, 'status' | 'due_date'> }) {
  const overdue = inv.status === 'sent' && inv.due_date && inv.due_date < todayIso();
  return (
    <span className="wt-status" style={{ ['--c' as string]: overdue ? '#ef4444' : INV_COLOR[inv.status] }}>
      {overdue ? 'Overdue' : INV_LABEL[inv.status]}
    </span>
  );
}

function Review() {
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const jobs = useApi<Job[]>('/approvals?status=pending');
  const invalidate = useInvalidate();
  const [picked, setPicked] = useState<string[]>([]);
  const list = jobs.data ?? [];
  const all = list.length > 0 && picked.length === list.length;

  async function approve(ids: string[]) {
    try {
      await post('/approvals/approve', { job_ids: ids });
      notifyOk(`${ids.length} ${ids.length === 1 ? 'delivery' : 'deliveries'} approved`);
      setPicked([]);
      await invalidate('/approvals', '/billing', '/jobs');
    } catch (e) {
      notifyError(e);
    }
  }

  if (jobs.isLoading) return <ListSkeleton rows={4} />;
  if (list.length === 0) {
    return (
      <EmptyState icon={<IconCircleCheck size={26} />} title="Nothing to review">
        Deliveries whose meter, GPS and tank checks all pass are approved automatically. Anything that doesn't add up lands here.
      </EmptyState>
    );
  }
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Checkbox label={`Select all (${list.length})`} checked={all} indeterminate={picked.length > 0 && !all} onChange={() => setPicked(all ? [] : list.map((j) => j.id))} />
        <Button size="sm" color="teal" leftSection={<IconCheck size={16} />} disabled={picked.length === 0} onClick={() => void approve(picked)}>
          Approve {picked.length || ''}
        </Button>
      </Group>
      {list.map((j) => (
        <Box key={j.id} className="wt-job" style={{ ['--rail' as string]: '#f97316' }} onClick={() => navigate(`/jobs/${j.id}`)}>
          <Group wrap="nowrap" align="flex-start" gap="sm">
            <Checkbox checked={picked.includes(j.id)} onClick={(e) => e.stopPropagation()} onChange={() => setPicked(picked.includes(j.id) ? picked.filter((x) => x !== j.id) : [...picked, j.id])} mt={2} />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group justify="space-between" wrap="nowrap" gap={8}>
                <Box style={{ minWidth: 0 }}>
                  <Text className="wt-chip-num">#{j.number} · {day(j.scheduled_date)} · {j.driver_name}</Text>
                  <Text className="wt-job-title" truncate mt={2}>{j.site_label}</Text>
                </Box>
                <Box ta="right" style={{ flex: 'none' }}>
                  <Text fw={650} className="wt-num">{litres(j.delivered_litres)}</Text>
                  <Text size="xs" c="dimmed" className="wt-num">{money(j.amount)}</Text>
                </Box>
              </Group>
              <Group gap={6} mt={6} wrap="nowrap" c="orange.7">
                <IconAlertTriangle size={14} style={{ flex: 'none' }} />
                <Text size="sm" c="orange.8" lineClamp={mobile ? 3 : 2}>{(j.approval_note ?? '').replace(/^Needs review: /, '')}</Text>
              </Group>
            </Box>
            {!mobile && (
              <Button size="xs" variant="light" color="teal" onClick={(e) => { e.stopPropagation(); void approve([j.id]); }}>Approve</Button>
            )}
          </Group>
        </Box>
      ))}
    </Stack>
  );
}

function InvoiceList({ onOpen }: { onOpen: (id: string) => void }) {
  const mobile = useIsMobile();
  const [status, setStatus] = useState('open');
  const q = status === 'open' ? 'draft,sent' : status === 'all' ? '' : status;
  const invoices = useApi<Invoice[]>(`/invoices${q ? `?status=${q}` : ''}`);
  const list = invoices.data ?? [];
  return (
    <Stack gap="sm">
      <SegmentedControl
        value={status}
        onChange={setStatus}
        data={[{ value: 'open', label: 'Open' }, { value: 'draft', label: 'Drafts' }, { value: 'sent', label: 'Sent' }, { value: 'paid', label: 'Paid' }, { value: 'all', label: 'All' }]}
        w={mobile ? '100%' : 'fit-content'}
        size="sm"
      />
      {invoices.isLoading && <ListSkeleton rows={5} height={58} />}
      {invoices.data && list.length === 0 && (
        <EmptyState icon={<IconFileInvoice size={26} />} title="No invoices here">Use “Create invoices” to batch approved deliveries into one draft per customer.</EmptyState>
      )}
      {list.length > 0 && (mobile ? (
        <Stack gap={8}>
          {list.map((i) => (
            <Box key={i.id} className="wt-job" style={{ ['--rail' as string]: INV_COLOR[i.status] }} onClick={() => onOpen(i.id)}>
              <Group justify="space-between" wrap="nowrap">
                <Box style={{ minWidth: 0 }}>
                  <Text className="wt-chip-num">#{i.number} · {i.job_count} deliveries</Text>
                  <Text className="wt-job-title" truncate mt={2}>{i.customer_name}</Text>
                  <Text size="xs" c="dimmed" mt={2}>{day(i.period_start)} – {day(i.period_end)}</Text>
                </Box>
                <Stack gap={4} align="flex-end">
                  <Text fw={650} className="wt-num">{money(i.total)}</Text>
                  <InvoiceStatus inv={i} />
                </Stack>
              </Group>
            </Box>
          ))}
        </Stack>
      ) : (
        <Box style={{ border: '1px solid var(--wt-border)', borderRadius: 14, overflow: 'hidden', background: 'var(--wt-surface)' }}>
          <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr><Table.Th>Invoice</Table.Th><Table.Th>Customer</Table.Th><Table.Th>Period</Table.Th><Table.Th>Due</Table.Th><Table.Th ta="right">Deliveries</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Status</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((i) => (
                <Table.Tr key={i.id} onClick={() => onOpen(i.id)} style={{ cursor: 'pointer' }}>
                  <Table.Td fw={600} className="wt-num">#{i.number}</Table.Td>
                  <Table.Td><Text size="sm" fw={550}>{i.customer_name}</Text><Text size="xs" c="dimmed">{i.account_code}</Text></Table.Td>
                  <Table.Td><Text size="sm">{day(i.period_start)} – {day(i.period_end)}</Text></Table.Td>
                  <Table.Td><Text size="sm">{day(i.due_date)}</Text></Table.Td>
                  <Table.Td ta="right" className="wt-num">{i.job_count}</Table.Td>
                  <Table.Td ta="right" fw={650} className="wt-num">{money(i.total)}</Table.Td>
                  <Table.Td><InvoiceStatus inv={i} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      ))}
    </Stack>
  );
}

function InvoiceDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const mobile = useIsMobile();
  const inv = useApi<Invoice>(id ? `/invoices/${id}` : null);
  const invalidate = useInvalidate();
  const i = inv.data;
  const qbo = useApi<QuickBooksStatus>('/integrations/quickbooks');
  const [pushing, setPushing] = useState(false);
  async function toQuickBooks() {
    setPushing(true);
    try {
      await post(`/invoices/${id}/quickbooks`);
      await invalidate('/invoices');
      notifyOk(`Invoice #${i?.number} is in QuickBooks`);
    } catch (e) {
      notifyError(e, "Couldn't send to QuickBooks");
    } finally {
      setPushing(false);
    }
  }
  async function setStatus(status: Invoice['status']) {
    const go = async () => {
      try {
        await patch(`/invoices/${id}`, { status });
        await invalidate('/invoices', '/billing', '/jobs');
        notifyOk(status === 'void' ? 'Invoice voided; its deliveries can be billed again' : `Marked ${INV_LABEL[status].toLowerCase()}`);
      } catch (e) {
        notifyError(e);
      }
    };
    if (status === 'void') {
      modals.openConfirmModal({
        title: `Void invoice #${i?.number}?`,
        children: <Text size="sm">The deliveries on it go back to “ready to bill”. The invoice stays on record as void.</Text>,
        labels: { confirm: 'Void invoice', cancel: 'Keep it' },
        confirmProps: { color: 'red' },
        onConfirm: go,
      });
    } else await go();
  }
  const byJob = useMemo(() => {
    const m = new Map<number, NonNullable<Invoice['lines']>>();
    for (const l of i?.lines ?? []) m.set(l.job_number, [...(m.get(l.job_number) ?? []), l]);
    return [...m.entries()];
  }, [i?.lines]);
  return (
    <Drawer opened={!!id} onClose={onClose} position={mobile ? 'bottom' : 'right'} size={mobile ? '92%' : 640} radius={mobile ? 'lg' : 0}
      title={i ? <Group gap={10}><Text fw={650} size="lg">Invoice #{i.number}</Text><InvoiceStatus inv={i} /></Group> : 'Invoice'}>
      {!i ? <ListSkeleton rows={6} height={40} /> : (
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Box>
              <Text className="wt-eyebrow">Bill to</Text>
              <Text fw={650} size="lg">{i.customer_name}</Text>
              <Text size="sm" c="dimmed">{i.account_code}</Text>
            </Box>
            <Box ta="right">
              <Text size="sm" c="dimmed">{day(i.period_start)} – {day(i.period_end)}</Text>
              <Text size="sm" c="dimmed">Due {day(i.due_date)}</Text>
            </Box>
          </Group>
          <Group gap={8} wrap="wrap">
            <Button component="a" href={authedUrl(`/invoices/${i.id}/pdf`)} target="_blank" variant="default" leftSection={<IconFileTypePdf size={16} />} size="sm">PDF</Button>
            {i.status === 'draft' && <Button size="sm" leftSection={<IconSend size={16} />} onClick={() => void setStatus('sent')}>Mark sent</Button>}
            {i.status === 'sent' && <Button size="sm" color="teal" leftSection={<IconCash size={16} />} onClick={() => void setStatus('paid')}>Mark paid</Button>}
            {i.qbo_id ? (
              <Badge size="lg" variant="light" color="green" leftSection={<IconCheck size={13} />} style={{ alignSelf: 'center' }}>In QuickBooks</Badge>
            ) : qbo.data?.connected && i.status !== 'void' ? (
              <Button size="sm" variant="light" color="green" loading={pushing} onClick={() => void toQuickBooks()}>Send to QuickBooks</Button>
            ) : null}
            <Menu position="bottom-end">
              <Menu.Target><Button size="sm" variant="default" rightSection={<IconChevronDown size={14} />}>More</Button></Menu.Target>
              <Menu.Dropdown>
                <Menu.Item component="a" href={authedUrl(`/exports/quickbooks.csv?ids=${i.id}`)} leftSection={<IconDownload size={16} />}>QuickBooks Online (CSV)</Menu.Item>
                <Menu.Item component="a" href={authedUrl(`/exports/quickbooks.iif?ids=${i.id}`)} leftSection={<IconDownload size={16} />}>QuickBooks Desktop (IIF)</Menu.Item>
                {i.status === 'paid' && <Menu.Item onClick={() => void setStatus('sent')}>Mark unpaid</Menu.Item>}
                {i.status !== 'void' && <><Menu.Divider /><Menu.Item color="red" leftSection={<IconX size={16} />} onClick={() => void setStatus('void')}>Void invoice</Menu.Item></>}
              </Menu.Dropdown>
            </Menu>
          </Group>
          <Stack gap={10}>
            {byJob.map(([num, lines]) => (
              <Box key={num} p="sm" style={{ border: '1px solid var(--wt-border)', borderRadius: 12 }}>
                <Group justify="space-between" mb={6}>
                  <Text size="sm" fw={600}>{lines[0].site_label}</Text>
                  <Text size="xs" c="dimmed" className="wt-num">#{num} · {day(lines[0].completed_at.slice(0, 10))}</Text>
                </Group>
                {lines.map((l, k) => (
                  <Group key={k} justify="space-between" wrap="nowrap" gap={8}>
                    <Text size="sm" c="dimmed" truncate>{l.description} · {Number(l.quantity).toLocaleString('en-CA')} {l.unit === 'litre' ? 'L' : l.unit} × {Number(l.unit_price) < 1 ? `$${Number(l.unit_price).toFixed(4)}` : money(Number(l.unit_price))}</Text>
                    <Text size="sm" className="wt-num" style={{ flex: 'none' }}>{money(l.amount)}</Text>
                  </Group>
                ))}
              </Box>
            ))}
          </Stack>
          <Box ml="auto" w={260}>
            <Group justify="space-between"><Text size="sm" c="dimmed">Subtotal</Text><Text size="sm" className="wt-num">{money(i.subtotal)}</Text></Group>
            <Group justify="space-between"><Text size="sm" c="dimmed">Tax</Text><Text size="sm" className="wt-num">{money(i.tax)}</Text></Group>
            <Group justify="space-between" mt={6} pt={6} style={{ borderTop: '1px solid var(--wt-border)' }}><Text fw={650}>Total</Text><Text fw={650} size="lg" className="wt-num">{money(i.total)}</Text></Group>
          </Box>
        </Stack>
      )}
    </Drawer>
  );
}

function GenerateForm({ onDone }: { onDone: () => void }) {
  const customers = useApi<Customer[]>('/customers');
  const invalidate = useInvalidate();
  const [range, setRange] = useState<[string | null, string | null]>([addDays(todayIso(), -30), todayIso()]);
  const [customer, setCustomer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!range[0] || !range[1]) return;
    setBusy(true);
    try {
      const r = await post<{ created: number }>('/invoices/generate', { from: range[0], to: range[1], customer_id: customer });
      await invalidate('/invoices', '/billing', '/jobs');
      notifyOk(r.created ? `${r.created} draft ${r.created === 1 ? 'invoice' : 'invoices'} created` : 'Nothing to bill in that range');
      onDone();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <Text size="sm" c="dimmed">Every approved delivery in the range that isn't billed yet goes onto one draft invoice per customer. You can check drafts, then mark them sent.</Text>
      <DatePickerInput type="range" label="Deliveries from" value={range} onChange={(v) => setRange(v as [string | null, string | null])} />
      <Select label="Customer" placeholder="All customers" clearable searchable value={customer} onChange={setCustomer} data={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      <Group justify="flex-end"><Button onClick={() => void go()} loading={busy} leftSection={<IconFileInvoice size={16} />}>Create drafts</Button></Group>
    </Stack>
  );
}

export function PriceBook() {
  const { user } = useAuth();
  const items = useApi<PriceItem[]>('/price-items');
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<Partial<PriceItem> | null>(null);
  const settings = useApi<Settings>('/settings');
  const classes = settings.data?.classes ?? [];
  const admin = user?.role === 'admin';
  async function save() {
    if (!editing) return;
    try {
      const body = { code: editing.code, name: editing.name, unit: editing.unit || 'each', unit_price: Number(editing.unit_price) || 0, kind: editing.kind ?? 'other', auto_add: !!editing.auto_add, taxable: editing.taxable ?? true, active: editing.active ?? true };
      const saved = editing.id ? await patch<PriceItem>(`/price-items/${editing.id}`, body) : await post<PriceItem>('/price-items', body);
      const rates = Object.fromEntries(classes.map((c) => {
        const v = editing.class_rates?.[c.key];
        return [c.key, v === undefined || v === '' ? null : Number(v)];
      }));
      if (classes.length) await put(`/price-items/${saved.id ?? editing.id}/class-rates`, { rates });
      await invalidate('/price-items');
      setEditing(null);
    } catch (e) {
      notifyError(e);
    }
  }
  const KIND: Record<PriceItem['kind'], string> = { water: 'Per litre delivered', delivery: 'Once per delivery', other: 'Added by hand' };
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed" maw={560}>Delivered jobs are priced from this list automatically. Customer-specific rates are set on each customer.</Text>
        {admin && <Button size="sm" leftSection={<IconPlus size={16} />} onClick={() => setEditing({ kind: 'other', taxable: true, active: true, unit: 'each' })}>Add item</Button>}
      </Group>
      {items.isLoading && <ListSkeleton rows={3} height={56} />}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        {(items.data ?? []).map((it) => (
          <Box key={it.id} className="wt-job" style={{ opacity: it.active ? 1 : 0.55, ['--rail' as string]: it.kind === 'water' ? '#2877eb' : it.kind === 'delivery' ? '#8b5cf6' : '#94a3b8' }}
            onClick={() => admin && setEditing(it)}>
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Box style={{ minWidth: 0 }}>
                <Text className="wt-chip-num">{it.code}</Text>
                <Text fw={600} truncate>{it.name}</Text>
                <Text size="xs" c="dimmed">{KIND[it.kind]}{it.auto_add ? ' · added to every delivery' : ''}{it.taxable ? '' : ' · tax exempt'}</Text>
                {Object.keys(it.class_rates ?? {}).length > 0 && (
                  <Text size="xs" c="water" mt={2}>
                    {Object.entries(it.class_rates!).map(([k, v]) => `${classes.find((c) => c.key === k)?.label ?? k} ${Number(v) < 1 ? `$${Number(v).toFixed(4)}` : money(Number(v))}`).join(' · ')}
                  </Text>
                )}
              </Box>
              <Box ta="right" style={{ flex: 'none' }}>
                <Text fw={650} className="wt-num">{Number(it.unit_price) < 1 ? `$${Number(it.unit_price).toFixed(4)}` : money(Number(it.unit_price))}</Text>
                <Text size="xs" c="dimmed">per {it.unit}</Text>
              </Box>
            </Group>
          </Box>
        ))}
      </SimpleGrid>
      {items.data && items.data.length === 0 && <EmptyState icon={<IconTag size={26} />} title="No prices yet">Add water per litre and a delivery fee to price jobs automatically.</EmptyState>}
      <Sheet opened={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit price' : 'New price'} size="md">
        {editing && (
          <Stack>
            <Group grow>
              <TextInput label="Code" value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.currentTarget.value.toUpperCase() })} required />
              <TextInput label="Unit" placeholder="litre, load, hour, each" value={editing.unit ?? ''} onChange={(e) => setEditing({ ...editing, unit: e.currentTarget.value })} />
            </Group>
            <TextInput label="Name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.currentTarget.value })} required />
            <NumberInput label="Price" prefix="$" decimalScale={4} min={0} value={editing.unit_price ?? ''} onChange={(v) => setEditing({ ...editing, unit_price: Number(v) })} />
            <Select label="How it's charged" value={editing.kind} onChange={(v) => setEditing({ ...editing, kind: (v as PriceItem['kind']) ?? 'other' })}
              data={[{ value: 'water', label: 'Per litre delivered' }, { value: 'delivery', label: 'Once per delivery' }, { value: 'other', label: 'Added by hand' }]} />
            {editing.kind === 'other' && <Switch label="Add to every delivery automatically" checked={!!editing.auto_add} onChange={(e) => setEditing({ ...editing, auto_add: e.currentTarget.checked })} />}
            {classes.length > 0 && (
              <Box>
                <Text size="sm" fw={500}>Price by customer class</Text>
                <Text size="xs" c="dimmed" mb={6}>Leave blank to use the price above. A rate set on a single customer still wins.</Text>
                <SimpleGrid cols={2} spacing="xs">
                  {classes.map((c) => (
                    <NumberInput key={c.key} size="sm" label={c.label} prefix="$" decimalScale={4} min={0} placeholder="Same as above"
                      value={editing.class_rates?.[c.key] ?? ''}
                      onChange={(v) => setEditing({ ...editing, class_rates: { ...(editing.class_rates ?? {}), [c.key]: v as string | number } })} />
                  ))}
                </SimpleGrid>
              </Box>
            )}
            <Switch label="Taxable" checked={editing.taxable ?? true} onChange={(e) => setEditing({ ...editing, taxable: e.currentTarget.checked })} />
            {editing.id && <Switch label="Active" checked={editing.active ?? true} onChange={(e) => setEditing({ ...editing, active: e.currentTarget.checked })} />}
            <Group justify="flex-end"><Button variant="default" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => void save()}>Save</Button></Group>
          </Stack>
        )}
      </Sheet>
    </Stack>
  );
}

export default function Billing() {
  const { id } = useParams();
  const navigate = useNavigate();
  const summary = useApi<BillingSummary>('/billing/summary');
  const [tab, setTab] = useState<string | null>('review');
  const [generating, setGenerating] = useState(false);
  const s = summary.data;
  useEffect(() => {
    if (id) setTab('invoices');
  }, [id]);
  useEffect(() => {
    if (s && s.pending_approvals === 0 && tab === 'review' && !id) setTab('invoices');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.pending_approvals]);

  return (
    <Box>
      <PageHeader
        title="Billing"
        subtitle="Review deliveries, batch them into invoices, and send them to QuickBooks."
        actions={
          <>
            <Menu position="bottom-end">
              <Menu.Target><Button variant="default" leftSection={<IconDownload size={16} />} rightSection={<IconChevronDown size={14} />}>QuickBooks</Button></Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Open invoices (drafts and sent)</Menu.Label>
                <Menu.Item component="a" href={authedUrl('/exports/quickbooks.csv')}>QuickBooks Online (CSV import)</Menu.Item>
                <Menu.Item component="a" href={authedUrl('/exports/quickbooks.iif')}>QuickBooks Desktop (IIF)</Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Button leftSection={<IconFileInvoice size={16} />} onClick={() => setGenerating(true)}>Create invoices</Button>
          </>
        }
      />
      <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="md" mb="lg">
        <StatCard label="Needs review" value={s?.pending_approvals ?? '—'} hint="Deliveries held by the checks" icon={<IconClockHour4 size={17} />} color="#f97316" />
        <StatCard label="Ready to bill" value={s ? money(s.unbilled_subtotal) : '—'} hint={s ? `${s.unbilled_jobs} approved deliveries` : ''} icon={<IconReceipt2 size={17} />} />
        <StatCard label="Outstanding" value={s ? money(s.outstanding_total) : '—'} hint={s?.overdue_count ? <Text span size="xs" c="red.6">{s.overdue_count} overdue</Text> : 'Sent, not yet paid'} icon={<IconSend size={17} />} color="#8b5cf6" />
        <StatCard label="Paid this month" value={s ? money(s.paid_this_month) : '—'} hint={s ? `${s.draft_count} drafts · ${money(s.draft_total)}` : ''} icon={<IconCash size={17} />} color="#10b981" />
      </SimpleGrid>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="review" rightSection={s?.pending_approvals ? <Badge size="sm" color="orange" circle>{s.pending_approvals}</Badge> : undefined}>Review</Tabs.Tab>
          <Tabs.Tab value="invoices">Invoices</Tabs.Tab>
          <Tabs.Tab value="prices">Price book</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="review"><Review /></Tabs.Panel>
        <Tabs.Panel value="invoices"><InvoiceList onOpen={(iid) => navigate(`/billing/${iid}`)} /></Tabs.Panel>
        <Tabs.Panel value="prices"><PriceBook /></Tabs.Panel>
      </Tabs>
      <InvoiceDrawer id={id ?? null} onClose={() => navigate('/billing')} />
      <Sheet opened={generating} onClose={() => setGenerating(false)} title="Create invoices" size="md">
        <GenerateForm onDone={() => { setGenerating(false); setTab('invoices'); }} />
      </Sheet>
    </Box>
  );
}
