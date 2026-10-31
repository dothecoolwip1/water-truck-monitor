import { useState } from 'react';
import {
  ActionIcon, Alert, Badge, Box, Button, Code, CopyButton, Group, NumberInput, ScrollArea, SimpleGrid, Stack, Switch, Table, Text, TextInput, Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconArrowDown, IconArrowUp, IconCheck, IconCopy, IconCurrentLocation, IconMail, IconMessage, IconPlugConnected, IconPlus, IconRefresh, IconTrash,
} from '@tabler/icons-react';
import { del, post, type OutboundMessage, type QuickBooksStatus, type Settings } from '../api';
import { notifyError, notifyOk, useApi, useInvalidate } from '../hooks';
import { dateTime } from '../format';
import { Section } from './ui';

type Up = <K extends keyof Settings>(k: K, p: Partial<Settings[K]>) => void;

const MSG_COLOR: Record<OutboundMessage['status'], string> = { sent: 'teal', queued: 'blue', failed: 'red', skipped: 'gray' };

function ProviderBadge({ ok, label }: { ok: boolean; label: string }) {
  return <Badge variant="light" color={ok ? 'teal' : 'gray'} leftSection={ok ? <IconCheck size={12} /> : undefined}>{label}: {ok ? 'connected' : 'not set up'}</Badge>;
}

export function AlertsPanel({ draft, up }: { draft: Settings; up: Up }) {
  const log = useApi<{ providers: { sms: boolean; email: boolean }; items: OutboundMessage[] }>('/messages?limit=50');
  const p = log.data?.providers;
  return (
    <Stack>
      <Section title="Text and email alerts">
        <Stack>
          <Text size="sm" c="dimmed">Residents who opt in (on their customer page) hear from you automatically. Each message includes a link to watch the truck.</Text>
          {p && <Group gap={8}><ProviderBadge ok={p.sms} label="Text messages" /><ProviderBadge ok={p.email} label="Email" /></Group>}
          {p && (!p.sms || !p.email) && (
            <Alert variant="light" color="water" radius="md">
              <Text size="sm">Until a provider is connected, messages are written to the log below as “skipped” so you can see exactly what residents would get.</Text>
            </Alert>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Switch label="Send text messages" checked={draft.alerts.sms} onChange={(e) => up('alerts', { sms: e.currentTarget.checked })} />
            <Switch label="Send emails" checked={draft.alerts.email} onChange={(e) => up('alerts', { email: e.currentTarget.checked })} />
          </SimpleGrid>
          <Text fw={600} size="sm" mt="xs">Tell residents when</Text>
          <Stack gap="xs">
            <Switch label="Their delivery is booked for a day" checked={draft.alerts.on_scheduled} onChange={(e) => up('alerts', { on_scheduled: e.currentTarget.checked })} />
            <Switch label="The truck is on its way" checked={draft.alerts.on_en_route} onChange={(e) => up('alerts', { on_en_route: e.currentTarget.checked })} />
            <Switch label="The water has been delivered" checked={draft.alerts.on_completed} onChange={(e) => up('alerts', { on_completed: e.currentTarget.checked })} />
          </Stack>
        </Stack>
      </Section>
      <Section title="Recent messages" actions={<ActionIcon variant="subtle" color="gray" onClick={() => void log.refetch()} aria-label="Refresh"><IconRefresh size={16} /></ActionIcon>}>
        {!log.data?.items.length ? (
          <Text size="sm" c="dimmed">Nothing sent yet.</Text>
        ) : (
          <ScrollArea type="auto">
            <Table verticalSpacing="sm" horizontalSpacing="md" miw={640}>
              <Table.Thead><Table.Tr><Table.Th>When</Table.Th><Table.Th>To</Table.Th><Table.Th>Message</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {log.data.items.map((m) => (
                  <Table.Tr key={m.id}>
                    <Table.Td><Text size="sm" style={{ whiteSpace: 'nowrap' }}>{dateTime(m.created_at)}</Text></Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        {m.channel === 'sms' ? <IconMessage size={15} /> : <IconMail size={15} />}
                        <Box><Text size="sm" fw={550}>{m.customer_name ?? 'Resident'}</Text><Text size="xs" c="dimmed">{m.recipient}</Text></Box>
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="sm" lineClamp={2} maw={360}>{m.body}</Text></Table.Td>
                    <Table.Td>
                      <Tooltip label={m.error ?? ''} disabled={!m.error} multiline w={260}>
                        <Badge variant="light" color={MSG_COLOR[m.status]}>{m.status}</Badge>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Section>
    </Stack>
  );
}

export function InspectionPanel({ draft, up }: { draft: Settings; up: Up }) {
  const items = draft.inspection.items;
  const set = (next: string[]) => up('inspection', { items: next });
  const [adding, setAdding] = useState('');
  const move = (i: number, d: number) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    set(next);
  };
  return (
    <Section title="Pre-trip truck inspection">
      <Stack>
        <Switch size="md" label="Drivers must inspect the truck before their first delivery each day"
          checked={draft.inspection.required} onChange={(e) => up('inspection', { required: e.currentTarget.checked })} />
        <Text size="sm" c="dimmed">Drivers tick each item on their phone. If anything fails, the truck is taken off the road and the office is told right away.</Text>
        <Stack gap={6}>
          {items.map((it, i) => (
            <Group key={i} gap={6} wrap="nowrap">
              <Text size="sm" c="dimmed" w={22} ta="right" className="wt-num">{i + 1}</Text>
              <TextInput size="sm" value={it} style={{ flex: 1 }} onChange={(e) => set(items.map((x, k) => (k === i ? e.currentTarget.value : x)))} />
              <ActionIcon variant="subtle" color="gray" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><IconArrowUp size={16} /></ActionIcon>
              <ActionIcon variant="subtle" color="gray" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><IconArrowDown size={16} /></ActionIcon>
              <ActionIcon variant="subtle" color="red" onClick={() => set(items.filter((_, k) => k !== i))} aria-label="Remove"><IconTrash size={16} /></ActionIcon>
            </Group>
          ))}
        </Stack>
        <Group gap={6} wrap="nowrap">
          <TextInput size="sm" placeholder="e.g. Hose reel locked" value={adding} style={{ flex: 1 }} onChange={(e) => setAdding(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && adding.trim()) { e.preventDefault(); set([...items, adding.trim()]); setAdding(''); } }} />
          <Button variant="light" leftSection={<IconPlus size={16} />} disabled={!adding.trim()} onClick={() => { set([...items, adding.trim()]); setAdding(''); }}>Add</Button>
        </Group>
      </Stack>
    </Section>
  );
}

export function OperationsPanel({ draft, up }: { draft: Settings; up: Up }) {
  const [locating, setLocating] = useState(false);
  function here() {
    if (!navigator.geolocation) return notifyError(new Error('This browser cannot share its location'));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { up('depot', { lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }); setLocating(false); },
      (e) => { notifyError(new Error(e.message)); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }
  return (
    <Stack>
      <Section title="Where trucks start the day">
        <Stack>
          <Text size="sm" c="dimmed">Used to work out the shortest stop order. Leave it empty to start from the first fill station.</Text>
          <TextInput label="Name" placeholder="e.g. Truck garage" value={draft.depot.label} onChange={(e) => up('depot', { label: e.currentTarget.value })} />
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <NumberInput label="Latitude" decimalScale={6} min={-90} max={90} value={draft.depot.lat ?? ''} onChange={(v) => up('depot', { lat: v === '' ? null : Number(v) })} />
            <NumberInput label="Longitude" decimalScale={6} min={-180} max={180} value={draft.depot.lng ?? ''} onChange={(v) => up('depot', { lng: v === '' ? null : Number(v) })} />
            <Button variant="default" mt={{ base: 0, sm: 25 }} leftSection={<IconCurrentLocation size={16} />} loading={locating} onClick={here}>Use where I am</Button>
          </SimpleGrid>
        </Stack>
      </Section>
      <Section title="Running low">
        <NumberInput label="Warn when a tank is expected to run dry within" suffix=" days" min={1} max={30} w={{ base: '100%', sm: 360 }}
          value={draft.forecast.warn_days} onChange={(v) => up('forecast', { warn_days: Number(v) || 1 })} />
      </Section>
    </Stack>
  );
}

const keyFor = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

export function ClassesPanel({ draft, onChange }: { draft: Settings; onChange: (c: Settings['classes']) => void }) {
  const [label, setLabel] = useState('');
  const classes = draft.classes;
  const add = () => {
    const key = keyFor(label);
    if (!key || classes.some((c) => c.key === key)) return;
    onChange([...classes, { key, label: label.trim() }]);
    setLabel('');
  };
  return (
    <Section title="Customer classes">
      <Stack>
        <Text size="sm" c="dimmed">Group customers so each group can pay its own rate (set the rates in Billing → Price book) and get its own notices.</Text>
        {classes.map((c, i) => (
          <Group key={c.key} gap={6} wrap="nowrap">
            <TextInput size="sm" value={c.label} style={{ flex: 1 }} onChange={(e) => onChange(classes.map((x, k) => (k === i ? { ...x, label: e.currentTarget.value } : x)))} />
            <Code>{c.key}</Code>
            <ActionIcon variant="subtle" color="red" disabled={c.key === 'residential'} onClick={() => onChange(classes.filter((_, k) => k !== i))} aria-label="Remove"><IconTrash size={16} /></ActionIcon>
          </Group>
        ))}
        <Group gap={6} wrap="nowrap">
          <TextInput size="sm" placeholder="e.g. Band office" value={label} style={{ flex: 1 }} onChange={(e) => setLabel(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <Button variant="light" leftSection={<IconPlus size={16} />} disabled={!keyFor(label)} onClick={add}>Add class</Button>
        </Group>
      </Stack>
    </Section>
  );
}

export function QuickBooksPanel() {
  const st = useApi<QuickBooksStatus>('/integrations/quickbooks');
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState<string | null>(null);
  const s = st.data;
  async function connect() {
    setBusy('connect');
    try {
      const r = await post<{ url: string }>('/integrations/quickbooks/connect');
      window.location.href = r.url;
    } catch (e) {
      notifyError(e);
      setBusy(null);
    }
  }
  async function sync() {
    setBusy('sync');
    try {
      const r = await post<{ sent: number; failed: { number: number; error: string }[] }>('/quickbooks/sync', {});
      if (r.failed.length) notifyError(new Error(`${r.failed.length} could not be sent. First problem: invoice ${r.failed[0].number}, ${r.failed[0].error}`), `Sent ${r.sent} invoices`);
      else notifyOk(r.sent ? `Sent ${r.sent} invoices to QuickBooks` : 'Everything is already in QuickBooks');
      await invalidate('/invoices');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  }
  function disconnect() {
    modals.openConfirmModal({
      title: 'Disconnect QuickBooks?',
      children: <Text size="sm">Invoices already sent stay in QuickBooks. New ones won't be sent until you connect again.</Text>,
      labels: { confirm: 'Disconnect', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await del('/integrations/quickbooks');
          await invalidate('/integrations', '/settings');
          notifyOk('QuickBooks disconnected');
        } catch (e) {
          notifyError(e);
        }
      },
    });
  }
  return (
    <Section title="QuickBooks Online">
      {!s ? null : (
        <Stack>
          <Group gap="sm">
            <Box w={44} h={44} style={{ borderRadius: 12, display: 'grid', placeItems: 'center', background: '#2ca01c', color: '#fff', fontWeight: 800, fontSize: 18 }}>qb</Box>
            <Box style={{ flex: 1 }}>
              <Text fw={650}>{s.connected ? (s.company_name ?? 'Connected') : 'Not connected'}</Text>
              <Text size="sm" c="dimmed">
                {s.connected ? `Connected ${dateTime(s.connected_at)}${s.environment === 'sandbox' ? ' · test company' : ''}` : 'Send invoices straight into your books, with customers, items and GST.'}
              </Text>
            </Box>
            {s.connected ? <Badge color="teal" variant="light">Connected</Badge> : null}
          </Group>
          {!s.configured ? (
            <Alert variant="light" color="orange" radius="md" title="Needs a one-time setup">
              <Text size="sm">Create an app at developer.intuit.com, add this redirect address, and give us its client ID and secret.</Text>
              <Group gap={6} mt={8} wrap="nowrap">
                <Code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.redirect_uri}</Code>
                <CopyButton value={s.redirect_uri}>
                  {({ copied, copy }) => <ActionIcon variant="default" onClick={copy} aria-label="Copy">{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}</ActionIcon>}
                </CopyButton>
              </Group>
            </Alert>
          ) : s.connected ? (
            <Group gap="sm">
              <Button leftSection={<IconRefresh size={16} />} loading={busy === 'sync'} onClick={() => void sync()}>Send unsynced invoices</Button>
              <Button variant="default" color="red" onClick={disconnect}>Disconnect</Button>
            </Group>
          ) : (
            <Button w="fit-content" leftSection={<IconPlugConnected size={16} />} loading={busy === 'connect'} onClick={() => void connect()}>Connect QuickBooks</Button>
          )}
          <Text size="xs" c="dimmed">Each invoice is sent once. Customers and price items are matched by name, or created if they're new.</Text>
        </Stack>
      )}
    </Section>
  );
}
