import type { ReactNode } from 'react';
import { ActionIcon, Avatar, Box, Button, Card, Group, Modal, Skeleton, Stack, Text, Title, Tooltip, type ModalProps } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { IconCalendarEvent, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { addDays, initials, isoDate, personColor, todayIso } from '../format';

export function useIsMobile() {
  return !useMediaQuery('(min-width: 48em)', true, { getInitialValueInEffect: false });
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-end" gap="sm" mb={{ base: 'md', sm: 'lg' }} wrap="wrap">
      <Box style={{ minWidth: 0 }}>
        {eyebrow && <Text className="wt-eyebrow" mb={4}>{eyebrow}</Text>}
        <Title order={1} fz={{ base: 26, sm: 28 }} lh={1.15}>{title}</Title>
        {subtitle && <Text c="dimmed" size="sm" mt={4}>{subtitle}</Text>}
      </Box>
      {actions && <Group gap={8} wrap="wrap">{actions}</Group>}
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
      transitionProps={mobile ? { transition: 'slide-up', duration: 240, timingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } : { transition: 'pop', duration: 180 }}
      {...props}
    />
  );
}

export function DayPicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const today = value === todayIso();
  return (
    <Group gap={0} wrap="nowrap" style={{ border: '1px solid var(--wt-border-strong)', borderRadius: 10, background: 'var(--wt-surface)', overflow: 'hidden' }}>
      <ActionIcon variant="subtle" color="gray" size={38} radius={0} onClick={() => onChange(addDays(value, -1))} aria-label="Previous day">
        <IconChevronLeft size={18} />
      </ActionIcon>
      <DatePickerInput
        value={value}
        onChange={(v) => v && onChange(typeof v === 'string' ? v : isoDate(v as unknown as Date))}
        valueFormat={today ? '[Today], MMM D' : 'ddd, MMM D'}
        leftSection={<IconCalendarEvent size={16} />}
        variant="unstyled"
        miw={150}
        style={{ flex: 1 }}
        size="sm"
        styles={{ input: { height: 38, minHeight: 38, fontWeight: 600, paddingLeft: 32 } }}
        popoverProps={{ position: 'bottom', shadow: 'lg' }}
      />
      <ActionIcon variant="subtle" color="gray" size={38} radius={0} onClick={() => onChange(addDays(value, 1))} aria-label="Next day">
        <IconChevronRight size={18} />
      </ActionIcon>
      {!today && (
        <Button variant="subtle" size="compact-sm" mr={4} onClick={() => onChange(todayIso())}>Today</Button>
      )}
    </Group>
  );
}

export function StatCard({ label, value, hint, icon, color = 'var(--wt-accent)', progress }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; color?: string; progress?: number;
}) {
  if (/^[a-z]+$/.test(color)) color = `var(--mantine-color-${color}-6)`;
  return (
    <Card className="wt-kpi" padding="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap={6}>
        <Text size="sm" c="dimmed" fw={500} truncate>{label}</Text>
        {icon && (
          <Box style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)`, width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', flex: 'none' }}>
            {icon}
          </Box>
        )}
      </Group>
      <Text className="wt-kpi-value" mt={6}>{value}</Text>
      {progress !== undefined && (
        <Box className="wt-progress-track" mt={10}>
          <Box className="wt-progress-fill" style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
        </Box>
      )}
      {hint && <Text size="xs" c="dimmed" mt={progress !== undefined ? 8 : 4} truncate component="div">{hint}</Text>}
    </Card>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Stack align="center" gap={8} py={36} px="md" ta="center">
        <Box className="wt-empty-icon">{icon}</Box>
        <Text fw={600} mt={4}>{title}</Text>
        {children && <Text size="sm" c="dimmed" maw={340}>{children}</Text>}
        {action && <Box mt={6}>{action}</Box>}
      </Stack>
    </motion.div>
  );
}

/** A card with a title row, for detail screens. */
export function Section({ title, actions, children, padding = 'lg', ...rest }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; padding?: string | number; id?: string }) {
  return (
    <Card padding={0} {...rest}>
      {(title || actions) && (
        <Group justify="space-between" px={padding} pt={14} pb={title ? 10 : 0} wrap="nowrap" gap="xs">
          {typeof title === 'string' ? <Text fw={650} size="md">{title}</Text> : title}
          {actions}
        </Group>
      )}
      <Box px={padding} pb={padding} pt={title ? 0 : padding}>{children}</Box>
    </Card>
  );
}

export function Person({ name, size = 28, tooltip = false }: { name: string | null | undefined; size?: number; tooltip?: boolean }) {
  const a = (
    <Avatar size={size} radius="xl" className="wt-avatar-ring" styles={{ placeholder: { background: personColor(name), color: '#fff', fontSize: size * 0.38, fontWeight: 650 } }}>
      {initials(name)}
    </Avatar>
  );
  return tooltip && name ? <Tooltip label={name}>{a}</Tooltip> : a;
}

export function ListSkeleton({ rows = 4, height = 72 }: { rows?: number; height?: number }) {
  return (
    <Stack gap={8}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={height} radius={12} style={{ opacity: 1 - i * 0.18 }} />
      ))}
    </Stack>
  );
}

/** Staggered entrance for lists. */
export function FadeIn({ children, i = 0, ...rest }: { children: ReactNode; i?: number; layout?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, delay: Math.min(i, 10) * 0.03, ease: [0.2, 0.8, 0.2, 1] }} {...rest}>
      {children}
    </motion.div>
  );
}
