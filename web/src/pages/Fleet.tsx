import { useState, type FormEvent, type ReactNode } from 'react';
import {
  ActionIcon, Alert, Badge, Box, Button, Card, Checkbox, Code, CopyButton, Group, Menu, NumberInput, PasswordInput, Progress, Select, SimpleGrid, Stack, Tabs, Text, TextInput, Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconBell, IconBellOff, IconCheck, IconCopy, IconDots, IconGauge, IconKey, IconPencil, IconPlus, IconTank, IconTruck, IconUser, IconUsers } from '@tabler/icons-react';
import { patch, post, type Tank, type Truck, type User } from '../api';
import { useAuth } from '../auth';
import { PageHeader, Sheet } from '../components/ui';
import { notifyError, useApi, useInvalidate } from '../hooks';
import { ago, litres } from '../format';

const ROLE_LABEL: Record<User['role'], string> = { driver: 'Driver', dispatcher: 'Dispatcher', admin: 'Admin' };
const ROLE_COLOR: Record<User['role'], string> = { driver: 'water', dispatcher: 'grape', admin: 'orange' };

function ItemCard({ icon, title, subtitle, right, children, dimmed, onEdit }: {
  icon: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; children?: ReactNode; dimmed?: boolean; onEdit?: () => void;
}) {
  return (
    <Card padding="md" opacity={dimmed ? 0.6 : 1}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          {icon}
          <Box style={{ minWidth: 0 }}>
            <Text fw={700} truncate>{title}</Text>
            {subtitle && <Text size="sm" c="dimmed" truncate>{subtitle}</Text>}
          </Box>
        </Group>
        <Group gap={6} wrap="nowrap">
          {right}
          {onEdit && <ActionIcon variant="subtle" color="gray" onClick={onEdit} aria-label="Edit"><IconPencil size={18} /></ActionIcon>}
        </Group>
      </Group>
      {children}
    </Card>
  );
}

export default function Fleet() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const trucks = useApi<Truck[]>('/trucks?active=all');
  const users = useApi<User[]>('/users');
  const tanks = useApi<Tank[]>('/tanks');
  const invalidate = useInvalidate();
  const [tab, setTab] = useState<string | null>('trucks');
  const [truck, setTruck] = useState<Truck | 'new' | null>(null);
  const [person, setPerson] = useState<User | 'new' | null>(null);
  const [tank, setTank] = useState<Tank | 'new' | null>(null);
  const [newKey, setNewKey] = useState<{ device_id: string; device_key: string } | null>(null);

  function rotate(t: Tank) {
    modals.openConfirmModal({
      title: `New key for ${t.name}?`,
      children: <Text size="sm">The sensor stops reporting until it is set up with the new key.</Text>,
      labels: { confirm: 'Make a new key', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          const r = await post<{ device_key: string }>(`/tanks/${t.id}/rotate-key`);
          setNewKey({ device_id: t.device_id, device_key: r.device_key });
        } catch (e) {
          notifyError(e);
        }
      },
    });
  }

  const addButton =
    tab === 'trucks' ? <Button leftSection={<IconPlus size={16} />} onClick={() => setTruck('new')}>Add truck</Button>
      : tab === 'people' && isAdmin ? <Button leftSection={<IconPlus size={16} />} onClick={() => setPerson('new')}>Add person</Button>
        : tab === 'tanks' && isAdmin ? <Button leftSection={<IconPlus size={16} />} onClick={() => setTank('new')}>Add tank sensor</Button> : null;

  return (
    <Box p={{ base: 'md', lg: 'lg' }} maw={1200}>
      <PageHeader title="Fleet" subtitle="Trucks, people and the bulk water tank" actions={addButton} />
      <Tabs value={tab} onChange={setTab} variant="pills" radius="xl" mb="md">
        <Tabs.List>
          <Tabs.Tab value="trucks" leftSection={<IconTruck size={16} />}>Trucks</Tabs.Tab>
          <Tabs.Tab value="people" leftSection={<IconUsers size={16} />}>People</Tabs.Tab>
          <Tabs.Tab value="tanks" leftSection={<IconTank size={16} />}>Bulk tank</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {tab === 'trucks' && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {(trucks.data ?? []).map((t) => (
            <ItemCard
              key={t.id}
              dimmed={!t.active}
              icon={<IconTruck size={28} color="var(--mantine-color-water-6)" />}
              title={t.name}
              subtitle={t.plate ?? 'No plate'}
              right={!t.active ? <Badge color="gray">Retired</Badge> : undefined}
              onEdit={() => setTruck(t)}
            >
              <SimpleGrid cols={2} mt="md" spacing="xs">
                <Box><Text size="xs" c="dimmed">Tank</Text><Text size="sm" fw={600}>{litres(t.capacity_l)}</Text></Box>
                <Box><Text size="xs" c="dimmed">Meter reading</Text><Text size="sm" fw={600}>{t.last_meter_reading?.toLocaleString('en-CA') ?? '—'}</Text></Box>
                <Box><Text size="xs" c="dimmed">Meter serial</Text><Text size="sm" fw={600}>{t.meter_serial ?? '—'}</Text></Box>
              </SimpleGrid>
            </ItemCard>
          ))}
        </SimpleGrid>
      )}

      {tab === 'people' && (
        <Stack>
          {!isAdmin && <Alert variant="light">Only admins can add or change accounts.</Alert>}
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            {(users.data ?? []).map((u) => (
              <ItemCard
                key={u.id}
                dimmed={!u.active}
                icon={<IconUser size={28} color={`var(--mantine-color-${ROLE_COLOR[u.role]}-6)`} />}
                title={u.name}
                subtitle={u.email}
                right={
                  <>
                    <Badge color={ROLE_COLOR[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                    {u.role === 'driver' && (
                      <Tooltip label={u.has_push ? 'Gets new-job alerts on their phone' : 'Not signed in on the driver app yet'}>
                        {u.has_push ? <IconBell size={18} color="var(--mantine-color-teal-6)" /> : <IconBellOff size={18} color="var(--mantine-color-dimmed)" />}
                      </Tooltip>
                    )}
                  </>
                }
                onEdit={isAdmin ? () => setPerson(u) : undefined}
              >
                {(u.phone || !u.active) && <Text size="sm" c="dimmed" mt="xs">{u.phone}{!u.active ? ' · Can’t sign in' : ''}</Text>}
              </ItemCard>
            ))}
          </SimpleGrid>
        </Stack>
      )}

      {tab === 'tanks' && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {(tanks.data ?? []).map((t) => {
            const pct = t.latest_volume_l != null ? Math.round((t.latest_volume_l / t.capacity_l) * 100) : null;
            const stale = !t.latest_ts || Date.now() - new Date(t.latest_ts).getTime() > 3_600_000;
            return (
              <ItemCard
                key={t.id}
                icon={<IconGauge size={28} color="var(--mantine-color-cyan-6)" />}
                title={t.name}
                subtitle={<>Sensor <Code>{t.device_id}</Code></>}
                right={isAdmin ? (
                  <Menu position="bottom-end" shadow="md">
                    <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label="Tank actions"><IconDots size={18} /></ActionIcon></Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setTank(t)}>Edit</Menu.Item>
                      <Menu.Item leftSection={<IconKey size={16} />} color="red" onClick={() => rotate(t)}>New sensor key</Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                ) : undefined}
              >
                <Stack gap={6} mt="md">
                  <Group justify="space-between">
                    <Text fz={28} fw={800} lh={1}>{pct === null ? '—' : `${pct}%`}</Text>
                    <Text size="sm" c="dimmed">{litres(t.latest_volume_l)} of {litres(t.capacity_l)}</Text>
                  </Group>
                  <Progress value={pct ?? 0} size="lg" radius="xl" color={pct !== null && pct < 25 ? 'red' : 'cyan'} />
                  <Text size="xs" c={stale ? 'red' : 'dimmed'}>
                    {t.latest_ts ? `Last reading ${ago(t.latest_ts)}${stale ? ': check the sensor' : ''}` : 'No readings yet'}
                  </Text>
                </Stack>
              </ItemCard>
            );
          })}
        </SimpleGrid>
      )}

      <Sheet opened={!!truck} onClose={() => setTruck(null)} title={truck === 'new' ? 'Add truck' : 'Edit truck'} size="md">
        {truck && <TruckForm truck={truck === 'new' ? null : truck} onCancel={() => setTruck(null)} onSaved={() => { setTruck(null); void invalidate('/trucks'); }} />}
      </Sheet>
      <Sheet opened={!!person} onClose={() => setPerson(null)} title={person === 'new' ? 'Add person' : 'Edit person'} size="md">
        {person && <PersonForm person={person === 'new' ? null : person} onCancel={() => setPerson(null)} onSaved={() => { setPerson(null); void invalidate('/users'); }} />}
      </Sheet>
      <Sheet opened={!!tank} onClose={() => setTank(null)} title={tank === 'new' ? 'Add tank sensor' : 'Edit tank'} size="md">
        {tank && (
          <TankForm
            tank={tank === 'new' ? null : tank}
            onCancel={() => setTank(null)}
            onSaved={(t) => { setTank(null); if (t.device_key) setNewKey({ device_id: t.device_id, device_key: t.device_key }); void invalidate('/tanks'); }}
          />
        )}
      </Sheet>
      <Sheet opened={!!newKey} onClose={() => setNewKey(null)} title="Sensor connection details" size="lg">
        {newKey && (
          <Stack>
            <Alert color="yellow" variant="light">Set up the tank sensor or its gateway with these details. The key is shown only once.</Alert>
            {[
              ['URL', `${window.location.origin}/api/ingest/tank-readings`],
              ['Header x-device-id', newKey.device_id],
              ['Header x-device-key', newKey.device_key],
              ['Body (JSON)', '{"ts": "2026-11-02T14:00:00Z", "level_mm": 4200}'],
            ].map(([k, v]) => (
              <Box key={k}>
                <Text size="xs" c="dimmed">{k}</Text>
                <Group gap={6} wrap="nowrap">
                  <Code block style={{ flex: 1, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{v}</Code>
                  <CopyButton value={v}>
                    {({ copied, copy }) => (
                      <ActionIcon variant="default" onClick={copy} aria-label={`Copy ${k}`}>{copied ? <IconCheck size={16} /> : <IconCopy size={16} />}</ActionIcon>
                    )}
                  </CopyButton>
                </Group>
              </Box>
            ))}
            <Text size="xs" c="dimmed">The body can carry volume_l, level_mm, distance_mm (lid to water) or level_pct, one reading or a "readings" list.</Text>
            <Group justify="flex-end"><Button onClick={() => setNewKey(null)}>I've saved it</Button></Group>
          </Stack>
        )}
      </Sheet>
    </Box>
  );
}

function useSubmit<T>(fn: () => Promise<T>, onSaved: (r: T) => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    error,
    busy,
    submit: async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setBusy(true);
      try {
        onSaved(await fn());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
  };
}

const n = (v: number | string) => (v === '' ? null : Number(v));

function Footer({ error, busy, onCancel }: { error: string | null; busy: boolean; onCancel: () => void }) {
  return (
    <>
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end"><Button variant="default" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></Group>
    </>
  );
}

function TruckForm({ truck, onCancel, onSaved }: { truck: Truck | null; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: truck?.name ?? '', plate: truck?.plate ?? '', capacity_l: (truck?.capacity_l ?? '') as number | string, meter_serial: truck?.meter_serial ?? '', active: truck?.active ?? true });
  const body = { name: f.name, plate: f.plate || null, capacity_l: Number(f.capacity_l || 0), meter_serial: f.meter_serial || null, active: f.active };
  const s = useSubmit(() => (truck ? patch(`/trucks/${truck.id}`, body) : post('/trucks', body)), onSaved);
  return (
    <form onSubmit={s.submit}>
      <Stack>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} data-autofocus />
          <TextInput label="Plate" value={f.plate} onChange={(e) => setF({ ...f, plate: e.currentTarget.value })} />
          <NumberInput label="Tank size (L)" min={0} step={100} thousandSeparator="," value={f.capacity_l} onChange={(v) => setF({ ...f, capacity_l: v })} />
          <TextInput label="Flow meter serial" value={f.meter_serial} onChange={(e) => setF({ ...f, meter_serial: e.currentTarget.value })} />
        </SimpleGrid>
        {truck && <Checkbox label="In service" checked={f.active} onChange={(e) => setF({ ...f, active: e.currentTarget.checked })} />}
        <Footer error={s.error} busy={s.busy} onCancel={onCancel} />
      </Stack>
    </form>
  );
}

function PersonForm({ person, onCancel, onSaved }: { person: User | null; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: person?.name ?? '', email: person?.email ?? '', phone: person?.phone ?? '', role: person?.role ?? 'driver', password: '', active: person?.active ?? true });
  const body: Record<string, unknown> = { name: f.name, email: f.email, phone: f.phone || null, role: f.role, active: f.active };
  if (f.password) body.password = f.password;
  const s = useSubmit(() => (person ? patch(`/users/${person.id}`, body) : post('/users', body)), onSaved);
  return (
    <form onSubmit={s.submit}>
      <Stack>
        <TextInput label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} data-autofocus />
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput label="Email (signs in with this)" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.currentTarget.value })} />
          <TextInput label="Phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.currentTarget.value })} />
        </SimpleGrid>
        <Select
          label="Role"
          value={f.role}
          onChange={(v) => v && setF({ ...f, role: v as User['role'] })}
          allowDeselect={false}
          data={[
            { value: 'driver', label: 'Driver (phone app)' },
            { value: 'dispatcher', label: 'Dispatcher (office)' },
            { value: 'admin', label: 'Admin (office, manages accounts)' },
          ]}
        />
        <PasswordInput label={person ? 'New password (leave blank to keep)' : 'Password'} minLength={8} required={!person} value={f.password} onChange={(e) => setF({ ...f, password: e.currentTarget.value })} autoComplete="new-password" />
        {person && <Checkbox label="Can sign in" checked={f.active} onChange={(e) => setF({ ...f, active: e.currentTarget.checked })} />}
        <Footer error={s.error} busy={s.busy} onCancel={onCancel} />
      </Stack>
    </form>
  );
}

function TankForm({ tank, onCancel, onSaved }: { tank: Tank | null; onCancel: () => void; onSaved: (t: Tank) => void }) {
  const [f, setF] = useState({
    name: tank?.name ?? '', device_id: tank?.device_id ?? '', capacity_l: (tank?.capacity_l ?? '') as number | string, height_mm: (tank?.height_mm ?? '') as number | string,
    lat: (tank?.lat ?? '') as number | string, lng: (tank?.lng ?? '') as number | string, noise_l: (tank?.noise_l ?? 200) as number | string,
  });
  const body = { name: f.name, device_id: f.device_id, capacity_l: Number(f.capacity_l), height_mm: n(f.height_mm), lat: n(f.lat), lng: n(f.lng), noise_l: Number(f.noise_l || 0) };
  const s = useSubmit(() => (tank ? patch<Tank>(`/tanks/${tank.id}`, body) : post<Tank>('/tanks', body)), onSaved);
  return (
    <form onSubmit={s.submit}>
      <Stack>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} data-autofocus />
          <TextInput label="Sensor device id" required value={f.device_id} onChange={(e) => setF({ ...f, device_id: e.currentTarget.value })} placeholder="e.g. armor-001" />
          <NumberInput label="Capacity (L)" required min={1} thousandSeparator="," value={f.capacity_l} onChange={(v) => setF({ ...f, capacity_l: v })} />
          <NumberInput label="Water height when full (mm)" min={1} value={f.height_mm} onChange={(v) => setF({ ...f, height_mm: v })} />
          <NumberInput label="Latitude" decimalScale={6} value={f.lat} onChange={(v) => setF({ ...f, lat: v })} />
          <NumberInput label="Longitude" decimalScale={6} value={f.lng} onChange={(v) => setF({ ...f, lng: v })} />
          <NumberInput label="Ignore changes under (L)" min={0} value={f.noise_l} onChange={(v) => setF({ ...f, noise_l: v })} />
        </SimpleGrid>
        <Text size="xs" c="dimmed">Height is needed only if the sensor reports a depth or distance rather than litres or percent.</Text>
        <Footer error={s.error} busy={s.busy} onCancel={onCancel} />
      </Stack>
    </form>
  );
}
