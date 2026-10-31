import { useEffect, useState } from 'react';
import { ActionIcon, Alert, Box, Button, Group, NumberInput, Select, Stack, Switch, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconAlertTriangle, IconCheck, IconCircleCheckFilled, IconPlus, IconReceipt2, IconTrash, IconX } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { post, put, type JobDetail, type JobLine, type PriceItem } from '../api';
import { notifyError, notifyOk, useApi, useInvalidate } from '../hooks';
import { money, rate } from '../format';
import { useIsMobile } from './ui';

interface LinesResponse {
  lines: JobLine[];
  check: { ok: boolean; reasons: string[]; passed: string[] };
  tax: { label: string; rate: number };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Approval state of a delivered job, with the automatic checks spelled out. */
export function ApprovalPanel({ job, check }: { job: JobDetail; check?: LinesResponse['check'] }) {
  const invalidate = useInvalidate();
  async function decide(kind: 'approve' | 'reject') {
    let note = '';
    modals.openConfirmModal({
      title: kind === 'approve' ? `Approve job #${job.number}?` : `Reject job #${job.number}?`,
      children: (
        <Textarea label="Note (optional)" placeholder={kind === 'approve' ? 'Checked with the driver' : 'Why it should not be billed'} onChange={(e) => (note = e.currentTarget.value)} data-autofocus />
      ),
      labels: { confirm: kind === 'approve' ? 'Approve' : 'Reject', cancel: 'Cancel' },
      confirmProps: { color: kind === 'approve' ? 'teal' : 'red' },
      onConfirm: async () => {
        try {
          await post(`/approvals/${kind}`, { job_ids: [job.id], note: note || null });
          await invalidate('/jobs', '/approvals', '/billing');
          notifyOk(kind === 'approve' ? 'Approved for billing' : 'Rejected');
        } catch (e) {
          notifyError(e);
        }
      },
    });
  }
  const s = job.approval_status;
  const tone = s === 'approved' ? 'teal' : s === 'rejected' ? 'red' : 'orange';
  return (
    <Alert
      color={tone}
      variant="light"
      radius="md"
      icon={s === 'approved' ? <IconCircleCheckFilled size={20} /> : s === 'rejected' ? <IconX size={20} /> : <IconAlertTriangle size={20} />}
      title={s === 'approved' ? (job.approved_by_name ? `Approved by ${job.approved_by_name}` : 'Approved automatically') : s === 'rejected' ? 'Rejected' : 'Waiting for review'}
    >
      <Stack gap={6}>
        {check && (check.passed.length > 0 || check.reasons.length > 0) && (
          <Stack gap={2}>
            {check.passed.map((p) => <Group key={p} gap={6} wrap="nowrap"><IconCheck size={14} color="var(--mantine-color-teal-6)" /><Text size="sm">{p}</Text></Group>)}
            {check.reasons.map((p) => <Group key={p} gap={6} wrap="nowrap"><IconX size={14} color="var(--mantine-color-red-6)" /><Text size="sm">{p}</Text></Group>)}
          </Stack>
        )}
        {job.approval_note && !job.approval_note.startsWith('Auto-approved') && !job.approval_note.startsWith('Needs review') && <Text size="sm" c="dimmed">{job.approval_note}</Text>}
        {job.invoice_id ? (
          <Text size="sm">On invoice <Link className="wt-link" to={`/billing/${job.invoice_id}`}>#{job.invoice_number}</Link></Text>
        ) : (
          <Group gap={8} mt={4}>
            {s !== 'approved' && <Button size="xs" color="teal" leftSection={<IconCheck size={14} />} onClick={() => decide('approve')}>Approve</Button>}
            {s !== 'rejected' && <Button size="xs" variant="default" onClick={() => decide('reject')}>Reject</Button>}
          </Group>
        )}
      </Stack>
    </Alert>
  );
}

/** The billable lines on a job, editable until it's on a sent invoice. */
export default function LinesEditor({ job }: { job: JobDetail }) {
  const mobile = useIsMobile();
  const data = useApi<LinesResponse>(`/jobs/${job.id}/lines`);
  const items = useApi<PriceItem[]>('/price-items');
  const invalidate = useInvalidate();
  const [lines, setLines] = useState<JobLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data.data) setLines(data.data.lines.map((l) => ({ ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })));
  }, [data.data]);
  if (!lines || !data.data) return null;
  const tax = data.data.tax;
  const subtotal = round2(lines.reduce((s, l) => s + round2(l.quantity * l.unit_price), 0));
  const taxAmt = round2(lines.filter((l) => l.taxable).reduce((s, l) => s + round2(l.quantity * l.unit_price), 0) * tax.rate);
  const dirty = JSON.stringify(lines) !== JSON.stringify(data.data.lines.map((l) => ({ ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })));
  const set = (i: number, patch: Partial<JobLine>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const active = (items.data ?? []).filter((i) => i.active);

  async function save() {
    setBusy(true);
    try {
      await put(`/jobs/${job.id}/lines`, { lines: lines!.map(({ price_item_id, description, quantity, unit, unit_price, taxable }) => ({ price_item_id, description, quantity, unit, unit_price, taxable })) });
      await invalidate(`/jobs/${job.id}`, '/jobs', '/billing', '/invoices');
      notifyOk('Charges saved');
    } catch (e) {
      notifyError(e, "Couldn't save the charges");
    } finally {
      setBusy(false);
    }
  }

  const addItem = (id: string | null) => {
    const it = active.find((x) => x.id === id);
    if (!it) return setLines([...lines, { price_item_id: null, description: 'Other charge', quantity: 1, unit: 'each', unit_price: 0, taxable: true }]);
    setLines([...lines, { price_item_id: it.id, description: it.name, quantity: it.kind === 'water' ? Number(job.delivered_litres ?? 0) : 1, unit: it.unit, unit_price: Number(it.unit_price), taxable: it.taxable }]);
  };

  return (
    <Stack gap="md">
      <ApprovalPanel job={job} check={data.data.check} />
      {lines.length === 0 ? (
        <Group gap={8} c="dimmed"><IconReceipt2 size={18} /><Text size="sm">No charges yet. Add items from the price book below.</Text></Group>
      ) : mobile ? (
        <Stack gap={8}>
          {lines.map((l, i) => (
            <Box key={i} p="sm" style={{ border: '1px solid var(--wt-border)', borderRadius: 12 }}>
              <Group justify="space-between" wrap="nowrap" gap={6}>
                <TextInput size="sm" value={l.description} onChange={(e) => set(i, { description: e.currentTarget.value })} style={{ flex: 1 }} />
                <ActionIcon variant="subtle" color="gray" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label="Remove"><IconTrash size={16} /></ActionIcon>
              </Group>
              <Group grow mt={8} gap={8}>
                <NumberInput size="sm" label="Qty" value={l.quantity} onChange={(v) => set(i, { quantity: Number(v) || 0 })} />
                <NumberInput size="sm" label="Rate" value={l.unit_price} decimalScale={4} prefix="$" onChange={(v) => set(i, { unit_price: Number(v) || 0 })} />
              </Group>
              <Group justify="space-between" mt={8}>
                <Switch size="xs" label={tax.label} checked={l.taxable} onChange={(e) => set(i, { taxable: e.currentTarget.checked })} />
                <Text fw={650} className="wt-num">{money(round2(l.quantity * l.unit_price))}</Text>
              </Group>
            </Box>
          ))}
        </Stack>
      ) : (
        <Table verticalSpacing={6} horizontalSpacing="xs" className="wt-num">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Item</Table.Th><Table.Th w={110} ta="right">Qty</Table.Th><Table.Th w={120} ta="right">Rate</Table.Th>
              <Table.Th w={60} ta="center">{tax.label}</Table.Th><Table.Th w={100} ta="right">Amount</Table.Th><Table.Th w={36} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((l, i) => (
              <Table.Tr key={i}>
                <Table.Td><TextInput size="xs" variant="unstyled" value={l.description} onChange={(e) => set(i, { description: e.currentTarget.value })} styles={{ input: { fontWeight: 550 } }} /></Table.Td>
                <Table.Td><NumberInput size="xs" variant="filled" value={l.quantity} onChange={(v) => set(i, { quantity: Number(v) || 0 })} hideControls styles={{ input: { textAlign: 'right' } }} rightSection={<Text size="xs" c="dimmed" pr={6}>{l.unit === 'litre' ? 'L' : ''}</Text>} /></Table.Td>
                <Table.Td><NumberInput size="xs" variant="filled" value={l.unit_price} decimalScale={4} prefix="$" onChange={(v) => set(i, { unit_price: Number(v) || 0 })} hideControls styles={{ input: { textAlign: 'right' } }} /></Table.Td>
                <Table.Td ta="center"><Switch size="xs" checked={l.taxable} onChange={(e) => set(i, { taxable: e.currentTarget.checked })} style={{ display: 'inline-block' }} /></Table.Td>
                <Table.Td ta="right" fw={600}>{money(round2(l.quantity * l.unit_price))}</Table.Td>
                <Table.Td><Tooltip label="Remove"><ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setLines(lines.filter((_, k) => k !== i))}><IconTrash size={14} /></ActionIcon></Tooltip></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Select
          placeholder="Add a charge…"
          leftSection={<IconPlus size={16} />}
          data={[...active.map((i) => ({ value: i.id, label: `${i.name} · ${rate(i.unit_price)}/${i.unit}` })), { value: '__other', label: 'Other (type your own)' }]}
          value={null}
          onChange={(v) => v && addItem(v === '__other' ? null : v)}
          size="sm"
          w={mobile ? '100%' : 280}
          searchable
        />
        <Box miw={220} ml="auto">
          <Group justify="space-between"><Text size="sm" c="dimmed">Subtotal</Text><Text size="sm" className="wt-num">{money(subtotal)}</Text></Group>
          <Group justify="space-between"><Text size="sm" c="dimmed">{tax.label} {(tax.rate * 100).toFixed(tax.rate * 100 % 1 ? 2 : 0)}%</Text><Text size="sm" className="wt-num">{money(taxAmt)}</Text></Group>
          <Group justify="space-between" mt={4} pt={6} style={{ borderTop: '1px solid var(--wt-border)' }}>
            <Text fw={650}>Total</Text><Text fw={650} className="wt-num">{money(round2(subtotal + taxAmt))}</Text>
          </Group>
        </Box>
      </Group>
      {dirty && (
        <Group justify="flex-end" gap={8}>
          <Button variant="default" size="sm" onClick={() => data.refetch()}>Discard</Button>
          <Button size="sm" loading={busy} onClick={() => void save()}>Save charges</Button>
        </Group>
      )}
    </Stack>
  );
}
