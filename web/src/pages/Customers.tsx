import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ActionIcon, Alert, Anchor, Badge, Box, Button, Card, Checkbox, Grid, Group, NumberInput, ScrollArea, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Title, UnstyledButton,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import {
  IconArrowLeft, IconChevronRight, IconFileSpreadsheet, IconHome, IconMail, IconMapPin, IconPencil, IconPhone, IconPlus, IconSearch, IconUpload, IconUsers,
} from '@tabler/icons-react';
import { patch, post, type Customer, type Job, type Site } from '../api';
import JobMap, { type PickedPoint } from '../components/Map';
import { EmptyState, PageHeader, Sheet, useIsMobile } from '../components/ui';
import { csvObjects } from '../csv';
import { notifyOk, useApi, useInvalidate } from '../hooks';
import { litres } from '../format';

/** Sites shown on the map look like jobs to the map component. */
function siteAsJob(s: Site, c?: Customer): Job {
  return {
    id: s.id, number: 0, status: 'scheduled', site_id: s.id, site_label: s.label, site_address: s.address, site_lat: s.lat, site_lng: s.lng,
    customer_id: s.customer_id, customer_name: c?.name ?? s.label, priority: 0,
  } as unknown as Job;
}

export default function Customers() {
  const { id: selected } = useParams();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const customers = useApi<Customer[]>('/customers?active=all');
  const sites = useApi<Site[]>('/sites?active=all');
  const [q, setQ] = useState('');
  const [editingCustomer, setEditingCustomer] = useState<Customer | 'new' | null>(null);
  const [editingSite, setEditingSite] = useState<Site | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (customers.data ?? []).filter((c) => !n || c.name.toLowerCase().includes(n) || (c.account_code ?? '').toLowerCase().includes(n));
  }, [customers.data, q]);
  const current = customers.data?.find((c) => c.id === selected) ?? null;
  const currentSites = (sites.data ?? []).filter((s) => s.customer_id === selected);
  const siteCount = (id: string) => (sites.data ?? []).filter((s) => s.customer_id === id).length;

  const listPane = (
    <Stack gap="sm">
      <TextInput placeholder="Search customers" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      <Card p={0}>
        <ScrollArea.Autosize mah={mobile ? undefined : 'calc(100dvh - 260px)'}>
          {list.map((c, i) => (
            <UnstyledButton
              key={c.id}
              onClick={() => navigate(`/customers/${c.id}`)}
              w="100%"
              px="md"
              py="sm"
              style={{
                borderTop: i ? '1px solid var(--mantine-color-default-border)' : undefined,
                background: c.id === selected ? 'var(--mantine-primary-color-light)' : undefined,
              }}
            >
              <Group justify="space-between" wrap="nowrap">
                <Box style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600} c={c.active ? undefined : 'dimmed'} truncate>{c.name}</Text>
                  <Text size="xs" c="dimmed">{c.account_code ?? 'No account code'} · {siteCount(c.id)} delivery point{siteCount(c.id) === 1 ? '' : 's'}</Text>
                </Box>
                <IconChevronRight size={16} color="var(--mantine-color-dimmed)" />
              </Group>
            </UnstyledButton>
          ))}
          {customers.data && list.length === 0 && <EmptyState icon={<IconUsers size={24} />} title="No customers found" />}
        </ScrollArea.Autosize>
      </Card>
    </Stack>
  );

  const detail = current ? (
    <Stack gap="md">
      {mobile && (
        <Anchor component={Link} to="/customers" size="sm" c="dimmed"><Group gap={4}><IconArrowLeft size={16} />Customers</Group></Anchor>
      )}
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Box style={{ minWidth: 0 }}>
          <Group gap="xs">
            <Title order={3}>{current.name}</Title>
            {!current.active && <Badge color="gray">Inactive</Badge>}
          </Group>
          <Text size="sm" c="dimmed">{current.account_code ?? 'No account code'}</Text>
        </Box>
        <ActionIcon variant="default" size="lg" onClick={() => setEditingCustomer(current)} aria-label="Edit customer"><IconPencil size={18} /></ActionIcon>
      </Group>
      <Card>
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
          <Group gap="xs"><IconPhone size={16} color="var(--mantine-color-dimmed)" />{current.phone ? <Anchor href={`tel:${current.phone}`} size="sm">{current.phone}</Anchor> : <Text size="sm" c="dimmed">No phone</Text>}</Group>
          <Group gap="xs"><IconMail size={16} color="var(--mantine-color-dimmed)" />{current.email ? <Anchor href={`mailto:${current.email}`} size="sm">{current.email}</Anchor> : <Text size="sm" c="dimmed">No email</Text>}</Group>
        </SimpleGrid>
        {current.notes && <Text size="sm" mt="sm">{current.notes}</Text>}
      </Card>
      <Group justify="space-between">
        <Title order={4}>Delivery points</Title>
        <Button size="sm" leftSection={<IconPlus size={16} />} onClick={() => setEditingSite('new')}>Add</Button>
      </Group>
      {currentSites.length > 0 && <JobMap jobs={currentSites.map((s) => siteAsJob(s, current))} height={260} />}
      <Stack gap={8}>
        {currentSites.map((s) => (
          <Card key={s.id} padding="sm" radius="md" className="wt-job" onClick={() => setEditingSite(s)} opacity={s.active ? 1 : 0.55}>
            <Group justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <IconHome size={20} color="var(--mantine-color-water-6)" />
                <Box style={{ minWidth: 0 }}>
                  <Text fw={600} size="sm" truncate>{s.label}</Text>
                  <Text size="xs" c="dimmed" truncate>{s.address ?? 'No address'} · tank {litres(s.tank_capacity_l)} · arrival within {s.geofence_m} m</Text>
                  {s.lat === null && <Text size="xs" c="red">Not on the map yet, so arrival can't be detected</Text>}
                </Box>
              </Group>
              <IconPencil size={16} color="var(--mantine-color-dimmed)" />
            </Group>
          </Card>
        ))}
        {currentSites.length === 0 && <EmptyState icon={<IconMapPin size={24} />} title="No delivery points">Add one and tap the house on the map.</EmptyState>}
      </Stack>
    </Stack>
  ) : (
    <EmptyState icon={<IconUsers size={24} />} title="Pick a customer">Their delivery points, tank sizes and access notes show here.</EmptyState>
  );

  return (
    <Box p={{ base: 'md', lg: 'lg' }}>
      {!(mobile && current) && (
        <PageHeader
          title="Customers"
          subtitle={`${customers.data?.length ?? 0} customers · ${sites.data?.length ?? 0} delivery points`}
          actions={
            <>
              <Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => setImporting(true)}>Import</Button>
              <Button leftSection={<IconPlus size={16} />} onClick={() => setEditingCustomer('new')}>Add customer</Button>
            </>
          }
        />
      )}
      {mobile ? (current ? detail : listPane) : (
        <Grid gap="lg">
          <Grid.Col span={{ base: 12, sm: 5, lg: 4 }}>{listPane}</Grid.Col>
          <Grid.Col span={{ base: 12, sm: 7, lg: 8 }}>{detail}</Grid.Col>
        </Grid>
      )}

      <Sheet opened={!!editingCustomer} onClose={() => setEditingCustomer(null)} title={editingCustomer === 'new' ? 'Add customer' : 'Edit customer'} size="md">
        {editingCustomer && (
          <CustomerForm
            customer={editingCustomer === 'new' ? null : editingCustomer}
            onCancel={() => setEditingCustomer(null)}
            onSaved={(c) => { setEditingCustomer(null); navigate(`/customers/${c.id}`); }}
          />
        )}
      </Sheet>
      <Sheet opened={!!editingSite && !!current} onClose={() => setEditingSite(null)} title={editingSite === 'new' ? 'Add delivery point' : 'Edit delivery point'} size="xl">
        {editingSite && current && (
          <SiteForm customerId={current.id} site={editingSite === 'new' ? null : editingSite} onCancel={() => setEditingSite(null)} onSaved={() => setEditingSite(null)} />
        )}
      </Sheet>
      <Sheet opened={importing} onClose={() => setImporting(false)} title="Import customers from a spreadsheet" size="xl">
        <ImportForm onDone={() => setImporting(false)} />
      </Sheet>
    </Box>
  );
}

function CustomerForm({ customer, onCancel, onSaved }: { customer: Customer | null; onCancel: () => void; onSaved: (c: Customer) => void }) {
  const invalidate = useInvalidate();
  const [f, setF] = useState({
    name: customer?.name ?? '', account_code: customer?.account_code ?? '', phone: customer?.phone ?? '',
    email: customer?.email ?? '', notes: customer?.notes ?? '', active: customer?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { ...f, account_code: f.account_code || null, phone: f.phone || null, email: f.email || null, notes: f.notes || null };
    try {
      const saved = customer ? await patch<Customer>(`/customers/${customer.id}`, body) : await post<Customer>('/customers', body);
      await invalidate('/customers');
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <Stack>
        <TextInput label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} data-autofocus />
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput label="Account code" value={f.account_code} onChange={(e) => setF({ ...f, account_code: e.currentTarget.value })} />
          <TextInput label="Phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.currentTarget.value })} />
        </SimpleGrid>
        <TextInput label="Email" type="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.currentTarget.value })} />
        <Textarea label="Notes" autosize minRows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.currentTarget.value })} />
        {customer && <Checkbox label="Active" checked={f.active} onChange={(e) => setF({ ...f, active: e.currentTarget.checked })} />}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></Group>
      </Stack>
    </form>
  );
}

function SiteForm({ customerId, site, onCancel, onSaved }: { customerId: string; site: Site | null; onCancel: () => void; onSaved: () => void }) {
  const invalidate = useInvalidate();
  const [f, setF] = useState({
    label: site?.label ?? '', address: site?.address ?? '', lat: site?.lat ?? (null as number | null), lng: site?.lng ?? (null as number | null),
    geofence_m: site?.geofence_m ?? 75, tank_capacity_l: (site?.tank_capacity_l ?? '') as number | string, access_notes: site?.access_notes ?? '',
    active: site?.active ?? true,
  });
  const [house, setHouse] = useState<PickedPoint['building']>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(p: PickedPoint) {
    setHouse(p.building);
    // Fill in the address from the map when the office hasn't typed one.
    const addr = p.building?.address ?? p.building?.name;
    setF((x) => ({ ...x, lat: p.lat, lng: p.lng, address: x.address || (addr ? `${addr}, Fort Good Hope, NT` : x.address) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      ...f, customer_id: customerId, address: f.address || null, access_notes: f.access_notes || null,
      tank_capacity_l: f.tank_capacity_l === '' ? null : Number(f.tank_capacity_l),
    };
    try {
      if (site) await patch(`/sites/${site.id}`, body);
      else await post('/sites', body);
      await invalidate('/sites', '/jobs');
      notifyOk('Delivery point saved');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, md: 7 }} order={{ base: 2, md: 1 }}>
          <Stack gap={6}>
            <JobMap fit={false} picked={f.lat !== null && f.lng !== null ? { lat: f.lat, lng: f.lng } : null} onPick={pick} height={380} />
            <Text size="xs" c="dimmed">
              {f.lat === null
                ? 'Tap the house on the map. The truck is marked as arrived when it comes within the arrival radius.'
                : house
                  ? `Placed on ${house.name ?? house.address ?? 'a building'} (${f.lat.toFixed(5)}, ${f.lng!.toFixed(5)}). Tap another house to move it.`
                  : `Placed at ${f.lat.toFixed(5)}, ${f.lng!.toFixed(5)}. Tap a house outline to snap to it.`}
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }} order={{ base: 1, md: 2 }}>
          <Stack>
            <TextInput label="Name" required value={f.label} onChange={(e) => setF({ ...f, label: e.currentTarget.value })} placeholder="e.g. House 12" data-autofocus />
            <TextInput label="Address" value={f.address} onChange={(e) => setF({ ...f, address: e.currentTarget.value })} />
            <SimpleGrid cols={2}>
              <NumberInput label="Tank size (L)" min={0} step={500} thousandSeparator="," value={f.tank_capacity_l} onChange={(v) => setF({ ...f, tank_capacity_l: v })} />
              <NumberInput label="Arrival radius (m)" min={10} max={2000} value={f.geofence_m} onChange={(v) => setF({ ...f, geofence_m: Number(v) || 75 })} />
            </SimpleGrid>
            <Textarea label="Access notes for drivers" autosize minRows={2} value={f.access_notes} onChange={(e) => setF({ ...f, access_notes: e.currentTarget.value })} placeholder="Fill pipe on north side; dog in yard" />
            {site && <Checkbox label="Active" checked={f.active} onChange={(e) => setF({ ...f, active: e.currentTarget.checked })} />}
            {error && <Alert color="red">{error}</Alert>}
          </Stack>
        </Grid.Col>
      </Grid>
      <Group justify="flex-end" mt="lg"><Button variant="default" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></Group>
    </form>
  );
}

const COLUMNS = 'customer, account_code, phone, email, site_label, address, lat, lng, tank_capacity_l, access_notes';

function ImportForm({ onDone }: { onDone: () => void }) {
  const invalidate = useInvalidate();
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(file: File) {
    setError(null);
    const parsed = csvObjects(await file.text());
    if (parsed.length && !('customer' in parsed[0])) return setError('The first row must be headings, including a "customer" column.');
    setRows(parsed);
  }
  async function submit() {
    setBusy(true);
    try {
      const clean = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === '' ? null : v])));
      const r = await post<{ customers_created: number; sites_created: number }>('/import/customers', { rows: clean });
      notifyOk(`Added ${r.customers_created} customers and ${r.sites_created} delivery points`);
      await invalidate('/customers', '/sites');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <Text size="sm">Save the spreadsheet as CSV with these headings (only <b>customer</b> is required): <Text span ff="monospace" size="xs">{COLUMNS}</Text>. Rows with the same account code or name become one customer with several delivery points.</Text>
      <Dropzone onDrop={(files) => files[0] && void load(files[0])} accept={['text/csv', '.csv']} maxFiles={1} radius="lg">
        <Group justify="center" gap="md" mih={110} style={{ pointerEvents: 'none' }}>
          <IconFileSpreadsheet size={40} color="var(--mantine-color-water-6)" stroke={1.4} />
          <Box>
            <Text fw={600}>Drop a CSV file here or tap to choose</Text>
            <Text size="sm" c="dimmed">Exported from Excel, Google Sheets or your billing system</Text>
          </Box>
        </Group>
      </Dropzone>
      {rows.length > 0 && (
        <>
          <Text size="sm" fw={600}>{rows.length} rows ready. First few:</Text>
          <Table.ScrollContainer minWidth={560}>
            <Table striped withTableBorder fz="xs">
              <Table.Thead><Table.Tr><Table.Th>Customer</Table.Th><Table.Th>Account</Table.Th><Table.Th>Delivery point</Table.Th><Table.Th>Address</Table.Th><Table.Th>Lat/Lng</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{rows.slice(0, 5).map((r, i) => <Table.Tr key={i}><Table.Td>{r.customer}</Table.Td><Table.Td>{r.account_code}</Table.Td><Table.Td>{r.site_label}</Table.Td><Table.Td>{r.address}</Table.Td><Table.Td>{r.lat} {r.lng}</Table.Td></Table.Tr>)}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Group justify="flex-end"><Button onClick={submit} loading={busy}>Import {rows.length} rows</Button></Group>
        </>
      )}
      {error && <Alert color="red">{error}</Alert>}
    </Stack>
  );
}
