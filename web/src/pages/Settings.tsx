import { arrayMove } from '@dnd-kit/sortable';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ActionIcon, Alert, Box, Button, CopyButton, Group, Image, NumberInput, Select, SimpleGrid, Stack, Switch, Tabs, TagsInput, Text, TextInput, Textarea, Tooltip,
} from '@mantine/core';
import { IconBell, IconCategory, IconMapPin, IconPlugConnected, IconTruckDelivery, IconArrowDown, IconArrowUp, IconBuilding, IconCheck, IconClipboardCheck, IconCopy, IconExternalLink, IconPlus, IconReceiptTax, IconShieldCheck, IconTrash, IconWorld } from '@tabler/icons-react';
import QRCode from 'qrcode';
import { patch, type FormField, type Settings as S } from '../api';
import { PageHeader, Section } from '../components/ui';
import { AlertsPanel, ClassesPanel, InspectionPanel, OperationsPanel, QuickBooksPanel } from '../components/SettingsExtra';
import { notifyError, notifyOk, useApi, useInvalidate } from '../hooks';

function useDraft() {
  const settings = useApi<S>('/settings');
  const [draft, setDraft] = useState<S | null>(null);
  useEffect(() => {
    if (settings.data) setDraft(structuredClone(settings.data));
  }, [settings.data]);
  return { saved: settings.data, draft, setDraft };
}

function SaveBar({ dirty, onSave, onReset, busy }: { dirty: boolean; onSave: () => void; onReset: () => void; busy: boolean }) {
  if (!dirty) return null;
  return (
    <Group justify="flex-end" gap={8} mt="md" p="sm" style={{ position: 'sticky', bottom: 'calc(var(--wt-tabbar-h) + 12px + env(safe-area-inset-bottom))', background: 'var(--wt-surface)', border: '1px solid var(--wt-border)', borderRadius: 12, boxShadow: 'var(--mantine-shadow-lg)', zIndex: 5 }}>
      <Text size="sm" c="dimmed" mr="auto">You have unsaved changes</Text>
      <Button variant="default" onClick={onReset}>Discard</Button>
      <Button onClick={onSave} loading={busy}>Save changes</Button>
    </Group>
  );
}

function FieldEditor({ fields, onChange }: { fields: FormField[]; onChange: (f: FormField[]) => void }) {
  const set = (i: number, p: Partial<FormField>) => onChange(fields.map((f, k) => (k === i ? { ...f, ...p } : f)));
  const move = (i: number, d: number) => onChange(arrayMove(fields, i, i + d));
  const keyFor = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `field_${fields.length + 1}`;
  return (
    <Stack gap="sm">
      {fields.length === 0 && <Text size="sm" c="dimmed">No extra questions. Drivers record litres, meter readings, a photo and a signature.</Text>}
      {fields.map((f, i) => (
        <Box key={i} p="sm" style={{ border: '1px solid var(--wt-border)', borderRadius: 12, background: 'var(--wt-surface-2)' }}>
          <Group align="flex-end" gap="sm" wrap="wrap">
            <TextInput label="Question" value={f.label} size="sm" style={{ flex: 2, minWidth: 200 }}
              onChange={(e) => set(i, { label: e.currentTarget.value, key: f.key && f.key !== keyFor(f.label) ? f.key : keyFor(e.currentTarget.value) })} />
            <Select label="Answer" size="sm" w={150} value={f.type} onChange={(v) => set(i, { type: (v as FormField['type']) ?? 'text' })}
              data={[{ value: 'yesno', label: 'Yes / no' }, { value: 'choice', label: 'Pick one' }, { value: 'number', label: 'Number' }, { value: 'text', label: 'Text' }]} />
            <Switch label="Required" size="sm" checked={!!f.required} onChange={(e) => set(i, { required: e.currentTarget.checked })} mb={8} />
            <Group gap={2} mb={4}>
              <ActionIcon variant="subtle" color="gray" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><IconArrowUp size={16} /></ActionIcon>
              <ActionIcon variant="subtle" color="gray" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><IconArrowDown size={16} /></ActionIcon>
              <ActionIcon variant="subtle" color="red" onClick={() => onChange(fields.filter((_, k) => k !== i))} aria-label="Remove"><IconTrash size={16} /></ActionIcon>
            </Group>
          </Group>
          {f.type === 'choice' && (
            <TagsInput mt="xs" size="sm" label="Choices" placeholder="Type a choice and press Enter" value={f.options ?? []} onChange={(v) => set(i, { options: v })} />
          )}
        </Box>
      ))}
      <Button variant="light" leftSection={<IconPlus size={16} />} w="fit-content" onClick={() => onChange([...fields, { key: `question_${fields.length + 1}`, label: '', type: 'yesno' }])}>
        Add a question
      </Button>
    </Stack>
  );
}

function PortalLink() {
  const url = `${window.location.origin}/request`;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#0d1420', light: '#ffffff' } }).then(setQr).catch(() => setQr(null));
  }, [url]);
  return (
    <Group align="flex-start" gap="lg" wrap="wrap">
      {qr && <Image src={qr} w={140} h={140} radius="md" alt="QR code for the request page" style={{ border: '1px solid var(--wt-border)' }} />}
      <Stack gap={8} style={{ flex: 1, minWidth: 220 }}>
        <Text size="sm">Residents open this link (or scan the code on a poster or their bill), sign in with their account number and phone, ask for water and watch the truck come.</Text>
        <Group gap={6} wrap="nowrap">
          <TextInput value={url} readOnly size="sm" style={{ flex: 1 }} />
          <CopyButton value={url}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied' : 'Copy link'}>
                <ActionIcon variant="default" size={36} onClick={copy}>{copied ? <IconCheck size={16} /> : <IconCopy size={16} />}</ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
          <Tooltip label="Open"><ActionIcon component="a" href="/request" target="_blank" variant="default" size={36}><IconExternalLink size={16} /></ActionIcon></Tooltip>
        </Group>
        {qr && <Button component="a" href={qr} download="water-request-qr.png" variant="subtle" size="xs" w="fit-content">Download QR code</Button>}
      </Stack>
    </Group>
  );
}

export default function Settings() {
  const { saved, draft, setDraft } = useDraft();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'company';
  const qbo = params.get('qbo');
  useEffect(() => {
    if (!qbo) return;
    if (qbo === 'connected') notifyOk('QuickBooks is connected');
    else notifyError(new Error(qbo === 'cancelled' ? 'The connection was cancelled.' : qbo === 'expired' ? 'The sign-in took too long. Try again.' : 'QuickBooks did not accept the connection. Try again.'), "QuickBooks isn't connected");
    void invalidate('/integrations', '/settings');
    setParams({ tab: 'integrations' }, { replace: true });
  }, [qbo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!draft || !saved) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const up = <K extends keyof S>(k: K, p: Partial<S[K]>) => setDraft({ ...draft, [k]: { ...draft[k], ...p } });

  async function save() {
    if (draft!.inspection.items.some((x) => !x.trim())) return notifyError(new Error('Remove or fill in the empty inspection item'), "Can't save yet");
    if (draft!.classes.some((c) => !c.label.trim())) return notifyError(new Error('Every customer class needs a name'), "Can't save yet");
    const bad = draft!.form.fields.find((f) => !f.label.trim() || (f.type === 'choice' && !(f.options ?? []).length));
    if (bad) return notifyError(new Error(bad.label ? `Add choices for “${bad.label}”` : 'Every question needs a label'), "Can't save yet");
    setBusy(true);
    try {
      await patch('/settings', draft);
      await invalidate('/settings');
      notifyOk('Settings saved');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box maw={980}>
      <PageHeader title="Settings" subtitle="Company details, billing, approvals, resident alerts, truck inspections and connected apps." />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'company' }, { replace: true })} keepMounted>
        <Select aria-label="Settings section" hiddenFrom="sm" mb="lg" size="md" allowDeselect={false} value={tab} onChange={(v) => setParams({ tab: v ?? 'company' }, { replace: true })}
          data={[{ value: 'company', label: 'Company' }, { value: 'billing', label: 'Billing' }, { value: 'approvals', label: 'Approvals' }, { value: 'portal', label: 'Resident page' }, { value: 'form', label: 'Driver checklist' }, { value: 'alerts', label: 'Alerts' }, { value: 'inspection', label: 'Inspection' }, { value: 'operations', label: 'Routes' }, { value: 'classes', label: 'Classes' }, { value: 'integrations', label: 'QuickBooks' }]} />
        <Tabs.List mb="lg" visibleFrom="sm" style={{ flexWrap: 'wrap' }}>
          <Tabs.Tab value="company" leftSection={<IconBuilding size={16} />}>Company</Tabs.Tab>
          <Tabs.Tab value="billing" leftSection={<IconReceiptTax size={16} />}>Billing</Tabs.Tab>
          <Tabs.Tab value="approvals" leftSection={<IconShieldCheck size={16} />}>Approvals</Tabs.Tab>
          <Tabs.Tab value="portal" leftSection={<IconWorld size={16} />}>Resident page</Tabs.Tab>
          <Tabs.Tab value="form" leftSection={<IconClipboardCheck size={16} />}>Driver checklist</Tabs.Tab>
          <Tabs.Tab value="alerts" leftSection={<IconBell size={16} />}>Alerts</Tabs.Tab>
          <Tabs.Tab value="inspection" leftSection={<IconTruckDelivery size={16} />}>Inspection</Tabs.Tab>
          <Tabs.Tab value="operations" leftSection={<IconMapPin size={16} />}>Routes</Tabs.Tab>
          <Tabs.Tab value="classes" leftSection={<IconCategory size={16} />}>Classes</Tabs.Tab>
          <Tabs.Tab value="integrations" leftSection={<IconPlugConnected size={16} />}>QuickBooks</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="company">
          <Section title="Company" >
            <Stack>
              <TextInput label="Business name" value={draft.company.name} onChange={(e) => up('company', { name: e.currentTarget.value })} />
              <Textarea label="Address" value={draft.company.address} onChange={(e) => up('company', { address: e.currentTarget.value })} />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput label="Phone" value={draft.company.phone} onChange={(e) => up('company', { phone: e.currentTarget.value })} />
                <TextInput label="Email" value={draft.company.email} onChange={(e) => up('company', { email: e.currentTarget.value })} />
              </SimpleGrid>
              <Text size="xs" c="dimmed">Shown on invoices, delivery tickets and the resident page.</Text>
            </Stack>
          </Section>
        </Tabs.Panel>

        <Tabs.Panel value="billing">
          <Section title="Tax and invoices">
            <Stack>
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <TextInput label="Tax name" value={draft.tax.label} onChange={(e) => up('tax', { label: e.currentTarget.value })} />
                <NumberInput label="Tax rate" suffix="%" decimalScale={3} min={0} max={50} value={Math.round(draft.tax.rate * 100000) / 1000} onChange={(v) => up('tax', { rate: (Number(v) || 0) / 100 })} />
                <TextInput label={`${draft.tax.label} number`} value={draft.company.tax_number} onChange={(e) => up('company', { tax_number: e.currentTarget.value })} />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <TextInput label="Invoice number prefix" value={draft.invoice.prefix} onChange={(e) => up('invoice', { prefix: e.currentTarget.value })} />
                <NumberInput label="Payment terms" suffix=" days" min={0} max={180} value={draft.invoice.terms_days} onChange={(v) => up('invoice', { terms_days: Number(v) || 0 })} />
              </SimpleGrid>
              <TextInput label="Invoice footer" value={draft.invoice.footer} onChange={(e) => up('invoice', { footer: e.currentTarget.value })} />
              <Text size="xs" c="dimmed">Prices live in Billing → Price book.</Text>
            </Stack>
          </Section>
        </Tabs.Panel>

        <Tabs.Panel value="approvals">
          <Section title="Automatic approval">
            <Stack>
              <Switch size="md" label="Approve deliveries automatically when every check passes" checked={draft.approvals.auto} onChange={(e) => up('approvals', { auto: e.currentTarget.checked })} />
              <Alert variant="light" color="water" radius="md">
                <Text size="sm">Each delivery is checked against the truck's flow meter and GPS. When the meter readings agree with the litres entered, the truck was at the house and it's no more than the tank holds, the delivery is approved for billing with no one touching it. Anything else waits in Billing → Review.</Text>
              </Alert>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <NumberInput label="Meter tolerance" description="Allowed gap between meter difference and litres entered" suffix=" L" min={0} value={draft.approvals.meter_tolerance_l} onChange={(v) => up('approvals', { meter_tolerance_l: Number(v) || 0 })} />
                <NumberInput label="Over tank size allowed" description="How far over the tank size before it's flagged" suffix="%" min={0} value={draft.approvals.max_over_tank_pct} onChange={(v) => up('approvals', { max_over_tank_pct: Number(v) || 0 })} />
              </SimpleGrid>
              <Switch label="Require GPS confirmation that the truck was at the delivery point" checked={draft.approvals.require_at_site} onChange={(e) => up('approvals', { require_at_site: e.currentTarget.checked })} />
            </Stack>
          </Section>
        </Tabs.Panel>

        <Tabs.Panel value="portal">
          <Stack>
            <Section title="Resident request page">
              <Stack>
                <Switch size="md" label="Let residents request water online" checked={draft.portal.enabled} onChange={(e) => up('portal', { enabled: e.currentTarget.checked })} />
                <PortalLink />
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <NumberInput label="Largest request" suffix=" L" min={100} max={100000} step={500} value={draft.portal.max_litres} onChange={(v) => up('portal', { max_litres: Number(v) || 0 })} />
                </SimpleGrid>
                <Textarea label="Message shown to residents" placeholder="e.g. Requests after 3 pm are delivered the next morning." value={draft.portal.message} onChange={(e) => up('portal', { message: e.currentTarget.value })} />
              </Stack>
            </Section>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="form">
          <Section title="Questions the driver answers at each delivery">
            <FieldEditor fields={draft.form.fields} onChange={(fields) => setDraft({ ...draft, form: { fields } })} />
          </Section>
        </Tabs.Panel>

        <Tabs.Panel value="alerts"><AlertsPanel draft={draft} up={up} /></Tabs.Panel>
        <Tabs.Panel value="inspection"><InspectionPanel draft={draft} up={up} /></Tabs.Panel>
        <Tabs.Panel value="operations"><OperationsPanel draft={draft} up={up} /></Tabs.Panel>
        <Tabs.Panel value="classes"><ClassesPanel draft={draft} onChange={(classes) => setDraft({ ...draft, classes })} /></Tabs.Panel>
        <Tabs.Panel value="integrations"><QuickBooksPanel /></Tabs.Panel>
      </Tabs>
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} onReset={() => setDraft(structuredClone(saved))} />
    </Box>
  );
}
