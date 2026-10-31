import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import MapGL, { Marker } from 'react-map-gl/maplibre';
import {
  Alert, Box, Button, Card, Center, Checkbox, Container, Group, Loader, NumberInput, Radio, SegmentedControl, Stack, Text, TextInput, Textarea, Title,
  UnstyledButton,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import {
  IconAlertCircle, IconAlertTriangle, IconCheck, IconChevronRight, IconDroplet, IconHome, IconLogout, IconPhone, IconTruck, IconClock,
} from '@tabler/icons-react';
import Brand from '../components/Brand';
import { makeStyle } from '../components/Map';
import StatusBadge from '../components/StatusBadge';
import type { JobStatus } from '../api';
import { STATUS_HEX, day, litres, time } from '../format';

// Residents get their own short-lived token, kept apart from the office sign-in.
const KEY = 'wt.resident';
const readToken = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const writeToken = (t: string | null) => { try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch { /* private mode */ } };

class PublicError extends Error { constructor(public status: number, msg: string, public data?: Record<string, unknown>) { super(msg); } }
async function pub<T>(method: string, path: string, body?: unknown): Promise<T> {
  const t = readToken();
  const res = await fetch(`/api/public${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new PublicError(res.status, data?.error ?? res.statusText, data?.details ?? data);
  return data as T;
}

interface Config { enabled: boolean; org_name: string; phone: string | null; message: string | null; max_litres: number }
interface MySite { id: string; label: string; address: string | null; tank_capacity_l: number | null }
interface MyJob { number: number; status: JobStatus; scheduled_date: string | null; requested_litres: number | null; created_at: string; completed_at: string | null; track_token: string | null; site_label: string; delivered_litres: number | null }
interface Me { customer_name: string; sites: MySite[]; jobs: MyJob[] }
interface Track {
  number: number; status: JobStatus; scheduled_date: string | null; requested_litres: number | null; urgent: boolean;
  site_label: string; site_address: string | null; site_lat: number | null; site_lng: number | null;
  driver_first_name: string | null; truck_name: string | null; delivered_litres: number | null;
  created_at: string; started_at: string | null; arrived_at: string | null; completed_at: string | null; cancelled_at: string | null;
  stops_before: number | null; truck: { lat: number; lng: number; ts: string } | null; eta_minutes: number | null;
}

function Shell({ children, config, onSignOut }: { children: ReactNode; config?: Config; onSignOut?: () => void }) {
  return (
    <Box className="wt-public">
      <header className="wt-public-top">
        <Container size={560} px="md" w="100%">
          <Group justify="space-between" wrap="nowrap">
            <Brand compact />
            {onSignOut && <Button variant="subtle" color="gray" size="compact-sm" leftSection={<IconLogout size={16} />} onClick={onSignOut}>Sign out</Button>}
          </Group>
        </Container>
      </header>
      <Container size={560} px="md" py="lg">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>{children}</motion.div>
        {config?.phone && (
          <Text size="sm" c="dimmed" ta="center" mt="xl">
            Need help? Phone <a className="wt-link" href={`tel:${config.phone.replace(/[^\d+]/g, '')}`}>{config.phone}</a>
          </Text>
        )}
      </Container>
    </Box>
  );
}

function useConfig() {
  return useQuery({ queryKey: ['public-config'], queryFn: () => pub<Config>('GET', '/config'), staleTime: 60_000 });
}

function SignIn({ config, onDone }: { config: Config; onDone: () => void }) {
  const [account, setAccount] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await pub<{ token: string }>('POST', '/sign-in', { account_code: account, phone });
      writeToken(r.token);
      onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Stack gap="lg">
      <div>
        <Text className="wt-eyebrow">{config.org_name}</Text>
        <Title order={1} mt={4}>Order water</Title>
        <Text c="dimmed" mt={6}>{config.message || 'Request a delivery and follow the truck to your door.'}</Text>
      </div>
      <Card>
        <form onSubmit={submit}>
          <Stack>
            <TextInput label="Account number" description="It's on your water bill, for example FGH-012" autoCapitalize="characters" autoComplete="off"
              value={account} onChange={(e) => setAccount(e.currentTarget.value)} required autoFocus />
            <TextInput label="Phone number on your account" type="tel" inputMode="tel" autoComplete="tel" leftSection={<IconPhone size={18} />}
              value={phone} onChange={(e) => setPhone(e.currentTarget.value)} required />
            {error && <Alert color="red" icon={<IconAlertCircle size={18} />}>{error}</Alert>}
            <Button type="submit" size="lg" loading={busy} fullWidth rightSection={<IconChevronRight size={18} />}>Continue</Button>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}

function RequestForm({ me, config, onSent }: { me: Me; config: Config; onSent: (token: string) => void }) {
  const [siteId, setSiteId] = useState(me.sites[0]?.id ?? '');
  const site = me.sites.find((s) => s.id === siteId);
  const [mode, setMode] = useState<'fill' | 'amount'>('fill');
  const [amount, setAmount] = useState<number | string>(2000);
  const [out, setOut] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<{ msg: string; token?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await pub<{ track_token: string }>('POST', '/requests', {
        site_id: siteId, litres: mode === 'amount' ? Number(amount) : null, out_of_water: out, name, phone, notes: notes || null,
      });
      onSent(r.track_token);
    } catch (err) {
      const pe = err as PublicError;
      setError({ msg: pe.message, token: (pe.data?.track_token as string | undefined) });
    } finally { setBusy(false); }
  }

  if (!me.sites.length) {
    return <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>There's no delivery address on your account yet. Please phone the office.</Alert>;
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <Card>
          <Stack gap="sm">
            <Text fw={650}>Where should we deliver?</Text>
            <Radio.Group value={siteId} onChange={setSiteId}>
              <Stack gap={8}>
                {me.sites.map((s) => (
                  <Radio.Card key={s.id} value={s.id} className="wt-choice" p="md" radius="md">
                    <Group wrap="nowrap" gap="sm">
                      <Radio.Indicator />
                      <IconHome size={20} style={{ flexShrink: 0, opacity: 0.6 }} />
                      <div style={{ minWidth: 0 }}>
                        <Text fw={600}>{s.label}</Text>
                        {s.address && <Text size="sm" c="dimmed">{s.address}</Text>}
                      </div>
                    </Group>
                  </Radio.Card>
                ))}
              </Stack>
            </Radio.Group>
          </Stack>
        </Card>

        <Card>
          <Stack gap="sm">
            <Text fw={650}>How much water?</Text>
            <SegmentedControl fullWidth size="md" value={mode} onChange={(v) => setMode(v as 'fill' | 'amount')}
              data={[{ value: 'fill', label: 'Fill my tank' }, { value: 'amount', label: 'A set amount' }]} />
            {mode === 'amount' ? (
              <NumberInput label="Litres" min={100} max={config.max_litres} step={500} value={amount} onChange={setAmount} suffix=" L" required />
            ) : (
              <Text size="sm" c="dimmed">{site?.tank_capacity_l ? `Your tank holds about ${litres(site.tank_capacity_l)}. The driver fills it to the top.` : 'The driver fills your tank to the top.'}</Text>
            )}
            <Checkbox.Card className="wt-choice" data-danger={out || undefined} checked={out} onClick={() => setOut((v) => !v)} p="md" radius="md">
              <Group wrap="nowrap" gap="sm">
                <Checkbox.Indicator color="red" />
                <div>
                  <Text fw={600}>I'm out of water</Text>
                  <Text size="sm" c="dimmed">We'll put you at the front of the line.</Text>
                </div>
              </Group>
            </Checkbox.Card>
          </Stack>
        </Card>

        <Card>
          <Stack gap="sm">
            <Text fw={650}>Who should the driver call?</Text>
            <TextInput label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
            <TextInput label="Phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} required />
            <Textarea label="Anything the driver should know?" placeholder="Dog in the yard, tank is around the back…" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          </Stack>
        </Card>

        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />}>
            {error.msg}
            {error.token && <> <Link className="wt-link" to={`/track/${error.token}`}>Track it</Link></>}
          </Alert>
        )}
        <Button type="submit" size="lg" color={out ? 'red' : undefined} loading={busy} fullWidth leftSection={<IconDroplet size={20} />}>
          {out ? 'Send urgent request' : 'Send request'}
        </Button>
      </Stack>
    </form>
  );
}

export function RequestPage() {
  const config = useConfig();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [signedIn, setSignedIn] = useState(!!readToken());
  const me = useQuery({
    queryKey: ['public-me'], enabled: signedIn, retry: false,
    queryFn: () => pub<Me>('GET', '/me').catch((e) => { if ((e as PublicError).status === 401) { writeToken(null); setSignedIn(false); } throw e; }),
  });
  const signOut = () => { writeToken(null); setSignedIn(false); qc.removeQueries({ queryKey: ['public-me'] }); };

  if (config.isLoading) return <Center h="100dvh"><Loader type="dots" /></Center>;
  const c = config.data;
  if (!c) return <Shell><Alert color="red">We couldn't reach the water office. Check your connection and try again.</Alert></Shell>;
  if (!c.enabled) {
    return <Shell config={c}><Alert color="yellow" icon={<IconPhone size={18} />} title="Online requests are off">Please phone the office to order water.</Alert></Shell>;
  }
  if (!signedIn) return <Shell config={c}><SignIn config={c} onDone={() => setSignedIn(true)} /></Shell>;
  if (me.isLoading || !me.data) return <Shell config={c}><Center h={200}><Loader type="dots" /></Center></Shell>;

  const open = me.data.jobs.filter((j) => !['completed', 'cancelled'].includes(j.status));
  const past = me.data.jobs.filter((j) => j.status === 'completed').slice(0, 5);
  return (
    <Shell config={c} onSignOut={signOut}>
      <Stack gap="lg">
        <div>
          <Text className="wt-eyebrow">{me.data.customer_name}</Text>
          <Title order={1} mt={4}>Order water</Title>
        </div>
        {open.length > 0 && (
          <Stack gap={8}>
            <Text fw={650} size="sm" c="dimmed">On the way</Text>
            {open.map((j) => <JobRow key={j.number} j={j} />)}
          </Stack>
        )}
        <RequestForm me={me.data} config={c} onSent={(t) => { qc.invalidateQueries({ queryKey: ['public-me'] }); navigate(`/track/${t}?new=1`); }} />
        {past.length > 0 && (
          <Stack gap={8}>
            <Text fw={650} size="sm" c="dimmed">Recent deliveries</Text>
            {past.map((j) => <JobRow key={j.number} j={j} />)}
          </Stack>
        )}
      </Stack>
    </Shell>
  );
}

function JobRow({ j }: { j: MyJob }) {
  const inner = (
    <Card padding="md">
      <Group justify="space-between" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Text fw={600} truncate>{j.site_label}</Text>
          <Text size="sm" c="dimmed">
            #{j.number} · {j.status === 'completed' ? `${litres(j.delivered_litres)} on ${day(j.completed_at?.slice(0, 10))}` : j.scheduled_date ? `Booked for ${day(j.scheduled_date)}` : `Asked ${day(j.created_at.slice(0, 10))}`}
          </Text>
        </div>
        <Group gap={6} wrap="nowrap"><StatusBadge status={j.status} />{j.track_token && <IconChevronRight size={18} opacity={0.5} />}</Group>
      </Group>
    </Card>
  );
  return j.track_token ? <UnstyledButton component={Link} to={`/track/${j.track_token}`} display="block">{inner}</UnstyledButton> : inner;
}

const STEPS: { key: JobStatus; label: string; at: keyof Track }[] = [
  { key: 'requested', label: 'Request received', at: 'created_at' },
  { key: 'scheduled', label: 'Booked with a driver', at: 'created_at' },
  { key: 'en_route', label: 'Truck on the way', at: 'started_at' },
  { key: 'arrived', label: 'Truck at your place', at: 'arrived_at' },
  { key: 'completed', label: 'Delivered', at: 'completed_at' },
];

function headline(t: Track): { title: string; sub: string } {
  switch (t.status) {
    case 'requested': return { title: 'We got your request', sub: 'The office will book a truck shortly.' };
    case 'scheduled': return {
      title: t.scheduled_date ? `Booked for ${day(t.scheduled_date)}` : 'Booked',
      sub: t.stops_before ? `${t.driver_first_name ?? 'Your driver'} has ${t.stops_before} stop${t.stops_before === 1 ? '' : 's'} before you.` : `${t.driver_first_name ?? 'Your driver'} will head your way soon.`,
    };
    case 'en_route': return { title: t.eta_minutes ? `About ${t.eta_minutes} min away` : 'On the way', sub: `${t.driver_first_name ?? 'Your driver'} is driving${t.truck_name ? ` ${t.truck_name}` : ''} to ${t.site_label}.` };
    case 'arrived': return { title: 'The truck is here', sub: `${t.driver_first_name ?? 'Your driver'} is filling your tank now.` };
    case 'completed': return { title: `${litres(t.delivered_litres)} delivered`, sub: `Finished at ${time(t.completed_at)}. Thank you!` };
    case 'cancelled': return { title: 'This request was cancelled', sub: 'Phone the office if that is a surprise.' };
  }
}

export function TrackPage() {
  const { token = '' } = useParams();
  const config = useConfig();
  const fresh = new URLSearchParams(location.search).has('new');
  const q = useQuery({
    queryKey: ['track', token], queryFn: () => pub<Track>('GET', `/track/${token}`), retry: false,
    refetchInterval: (query) => (['completed', 'cancelled'].includes(query.state.data?.status ?? '') ? false : query.state.data?.status === 'en_route' ? 10_000 : 30_000),
  });
  if (q.isLoading) return <Center h="100dvh"><Loader type="dots" /></Center>;
  if (!q.data) return <Shell config={config.data}><Alert color="red" icon={<IconAlertCircle size={18} />}>{(q.error as Error)?.message ?? 'Not found'}</Alert></Shell>;
  const t = q.data;
  const h = headline(t);
  const idx = STEPS.findIndex((s) => s.key === t.status);
  return (
    <Shell config={config.data}>
      <Stack gap="md">
        {fresh && t.status === 'requested' && (
          <Alert color="teal" icon={<IconCheck size={18} />} title="Request sent">Keep this page. It updates by itself as the truck gets closer.</Alert>
        )}
        <Card className="wt-track-hero" padding="lg" style={{ ['--c' as string]: STATUS_HEX[t.status] }}>
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <div>
              <Text className="wt-eyebrow">Request #{t.number}{t.urgent ? ' · Urgent' : ''}</Text>
              <Title order={2} mt={6}>{h.title}</Title>
              <Text c="dimmed" mt={4}>{h.sub}</Text>
            </div>
            <Box className="wt-track-icon">{t.status === 'completed' ? <IconCheck size={26} /> : t.status === 'en_route' ? <IconTruck size={26} /> : <IconClock size={26} />}</Box>
          </Group>
        </Card>

        {t.site_lat !== null && t.site_lng !== null && t.status !== 'cancelled' && <TrackMap t={t} />}

        {t.status !== 'cancelled' && (
          <Card>
            <Stack gap={0}>
              {STEPS.map((s, i) => {
                const done = i <= idx;
                const at = i === idx || (done && s.key !== 'scheduled') ? (t[s.at] as string | null) : null;
                return (
                  <Group key={s.key} gap="sm" wrap="nowrap" align="flex-start" className="wt-step" data-done={done || undefined} data-current={i === idx || undefined}>
                    <Box className="wt-step-dot">{done && <IconCheck size={12} stroke={3} />}</Box>
                    <Group justify="space-between" style={{ flex: 1 }} pb={i < STEPS.length - 1 ? 18 : 0}>
                      <Text fw={i === idx ? 650 : 500} c={done ? undefined : 'dimmed'}>{s.label}</Text>
                      {done && at && <Text size="sm" c="dimmed" className="wt-num">{time(at)}</Text>}
                    </Group>
                  </Group>
                );
              })}
            </Stack>
          </Card>
        )}

        <Card padding="md">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <IconHome size={20} opacity={0.6} />
              <div>
                <Text fw={600}>{t.site_label}</Text>
                {t.site_address && <Text size="sm" c="dimmed">{t.site_address}</Text>}
              </div>
            </Group>
            <Text fw={650} className="wt-num" style={{ whiteSpace: 'nowrap' }}>{t.requested_litres ? litres(t.requested_litres) : 'Fill'}</Text>
          </Group>
        </Card>
        <Button component={Link} to="/request" variant="default" fullWidth>Order more water</Button>
      </Stack>
    </Shell>
  );
}

function TrackMap({ t }: { t: Track }) {
  const style = useMemo(() => makeStyle('satellite'), []);
  const [ref, setRef] = useState<import('react-map-gl/maplibre').MapRef | null>(null);
  useEffect(() => {
    if (!ref) return;
    if (t.truck) {
      const lngs = [t.truck.lng, t.site_lng!], lats = [t.truck.lat, t.site_lat!];
      ref.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, maxZoom: 17, duration: 600 });
    } else ref.flyTo({ center: [t.site_lng!, t.site_lat!], zoom: 16.5, duration: 0 });
  }, [ref, t.truck?.lat, t.truck?.lng, t.site_lat, t.site_lng]);
  return (
    <Box className="wt-map" h={260} style={{ borderRadius: 'var(--mantine-radius-lg)', overflow: 'hidden' }}>
      <MapGL ref={setRef} mapStyle={style} initialViewState={{ longitude: t.site_lng!, latitude: t.site_lat!, zoom: 16.5 }} attributionControl={{ compact: true }} dragRotate={false}>
        <Marker longitude={t.site_lng!} latitude={t.site_lat!} anchor="bottom">
          <div className="wt-pin" style={{ ['--pin' as string]: STATUS_HEX[t.status] }}><IconHome size={14} /> Your place</div>
        </Marker>
        {t.truck && (
          <Marker longitude={t.truck.lng} latitude={t.truck.lat} anchor="center">
            <div className="wt-truck"><span className="wt-truck-icon"><IconTruck size={14} /></span>{t.driver_first_name ?? "Truck"}</div>
          </Marker>
        )}
      </MapGL>
    </Box>
  );
}
