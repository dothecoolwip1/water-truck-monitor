import type { ReactNode } from 'react';
import { ActionIcon, Box, Button, Card, Group, Modal, Stack, Text, ThemeIcon, Title, type ModalProps } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { IconCalendar, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { addDays, isoDate, todayIso } from '../format';

export function useIsMobile() {
  return !useMediaQuery('(min-width: 48em)', true, { getInitialValueInEffect: false });
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-end" gap="sm" mb="md" wrap="wrap">
      <Box style={{ minWidth: 0 }}>
        <Title order={2} fz={{ base: 22, sm: 26 }} lh={1.2}>{title}</Title>
        {subtitle && <Text c="dimmed" size="sm" mt={2}>{subtitle}</Text>}
      </Box>
      {actions && <Group gap="xs" wrap="wrap">{actions}</Group>}
    </Group>
  );
}

/** A modal that becomes a full-screen sheet on phones. */
export function Sheet(props: ModalProps) {
  const mobile = useIsMobile();
  return (
    <Modal
      fullScreen={mobile}
      size={props.size ?? 'lg'}
      transitionProps={mobile ? { transition: 'slide-up', duration: 200 } : undefined}
      {...props}
      styles={{ title: { fontWeight: 700, fontSize: 18 }, ...props.styles }}
    />
  );
}

export function DayPicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  return (
    <Group gap={6} wrap="nowrap">
      <ActionIcon variant="default" size={36} onClick={() => onChange(addDays(value, -1))} aria-label="Previous day">
        <IconChevronLeft size={18} />
      </ActionIcon>
      <DatePickerInput
        value={value}
        onChange={(v) => v && onChange(typeof v === 'string' ? v : isoDate(v as unknown as Date))}
        valueFormat="ddd, MMM D"
        leftSection={<IconCalendar size={16} />}
        w={150}
        size="sm"
        styles={{ input: { height: 36, minHeight: 36 } }}
        popoverProps={{ position: 'bottom' }}
      />
      <ActionIcon variant="default" size={36} onClick={() => onChange(addDays(value, 1))} aria-label="Next day">
        <IconChevronRight size={18} />
      </ActionIcon>
      {value !== todayIso() && <Button variant="subtle" size="compact-sm" onClick={() => onChange(todayIso())}>Today</Button>}
    </Group>
  );
}

export function StatCard({ label, value, hint, icon, color = 'water' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; color?: string }) {
  return (
    <Card padding="sm" px={{ base: 'sm', sm: 'md' }} py={{ base: 10, sm: 'md' }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap={6}>
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: 0.4 }} truncate>{label}</Text>
          <Text fw={800} fz={{ base: 20, sm: 24 }} lh={1.25}>{value}</Text>
          {hint && <Text size="xs" c="dimmed" truncate component="div">{hint}</Text>}
        </Stack>
        {icon && <ThemeIcon variant="light" color={color} size={32} radius="md" visibleFrom="xs">{icon}</ThemeIcon>}
      </Group>
    </Card>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <Stack align="center" gap={6} py="xl" px="md" ta="center">
      <ThemeIcon size={48} radius="xl" variant="light" color="gray">{icon}</ThemeIcon>
      <Text fw={600}>{title}</Text>
      {children && <Text size="sm" c="dimmed" maw={360}>{children}</Text>}
    </Stack>
  );
}
