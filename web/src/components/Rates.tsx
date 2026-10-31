import { useEffect, useState } from 'react';
import { Button, Group, NumberInput, Stack, Text } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { put } from '../api';
import { notifyOk, useApi, useInvalidate } from '../hooks';
import { money } from '../format';
import { Section } from './ui';

interface Rate { price_item_id: string; code: string; name: string; unit: string; list_price: string; unit_price: string | null }

/** Rate agreement: per-customer prices that override the price book. Empty means list price. */
export function RatesSection({ customerId }: { customerId: string }) {
  const rates = useApi<Rate[]>(`/customers/${customerId}/rates`);
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState<Record<string, number | string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (rates.data) setDraft(Object.fromEntries(rates.data.map((r) => [r.price_item_id, r.unit_price === null ? '' : Number(r.unit_price)])));
  }, [rates.data]);
  const dirty = (rates.data ?? []).some((r) => String(draft[r.price_item_id] ?? '') !== String(r.unit_price === null ? '' : Number(r.unit_price)));
  async function save() {
    setBusy(true);
    try {
      await put(`/customers/${customerId}/rates`, {
        rates: (rates.data ?? []).map((r) => ({ price_item_id: r.price_item_id, unit_price: draft[r.price_item_id] === '' || draft[r.price_item_id] === undefined ? null : Number(draft[r.price_item_id]) })),
      });
      await invalidate(`/customers/${customerId}/rates`);
      notifyOk('Rates saved. New deliveries use them.');
    } finally { setBusy(false); }
  }
  const custom = (rates.data ?? []).filter((r) => r.unit_price !== null).length;
  return (
    <Section
      title={<div><Text fw={650}>Rates</Text><Text size="xs" c="dimmed">{custom ? `${custom} custom price${custom === 1 ? '' : 's'}` : 'Uses the price book'}</Text></div>}
      actions={dirty && <Button size="xs" loading={busy} leftSection={<IconDeviceFloppy size={14} />} onClick={save}>Save</Button>}
      padding="md"
    >
      <Stack gap={0} px="md" pb="sm">
        {(rates.data ?? []).map((r) => (
          <Group key={r.price_item_id} justify="space-between" wrap="nowrap" py={8} className="wt-row">
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={550} truncate>{r.name}</Text>
              <Text size="xs" c="dimmed">List {money(r.list_price, Number(r.list_price) < 1 ? 3 : 2)} / {r.unit}</Text>
            </div>
            <NumberInput size="sm" w={130} prefix="$" decimalScale={4} min={0} step={0.001} placeholder="List price" hideControls
              value={draft[r.price_item_id] ?? ''} onChange={(v) => setDraft((d) => ({ ...d, [r.price_item_id]: v }))} />
          </Group>
        ))}
      </Stack>
    </Section>
  );
}
