import type { ReactNode } from 'react';
import { Box, Group, Text } from '@mantine/core';
import { IconAlertTriangleFilled, IconDroplet, IconMapPin } from '@tabler/icons-react';
import type { Job } from '../api';
import { STATUS_HEX, day, litres, time } from '../format';
import StatusBadge from './StatusBadge';
import { Person } from './ui';

export function jobWhen(job: Job, showDate: boolean): string {
  if (job.completed_at) return `Delivered ${time(job.completed_at)}`;
  if (job.arrived_at) return `On site since ${time(job.arrived_at)}`;
  if (job.started_at) return `Left ${time(job.started_at)}`;
  return showDate ? day(job.scheduled_date) : '';
}

/** One delivery, as a card: house, address, litres, who, and where it's at. */
export default function JobCard({ job, onOpen, actions, handle, dragging, overlay, highlight, showDriver = true, showDate = false }: {
  job: Job; onOpen?: () => void; actions?: ReactNode; handle?: ReactNode; dragging?: boolean; overlay?: boolean; highlight?: boolean;
  showDriver?: boolean; showDate?: boolean;
}) {
  const sub = job.customer_name !== job.site_label ? job.customer_name : job.site_address;
  const amount = job.status === 'completed' ? litres(job.delivered_litres) : job.requested_litres ? litres(job.requested_litres) : 'Fill to full';
  const when = jobWhen(job, showDate);
  return (
    <div
      role="button"
      tabIndex={0}
      className="wt-job"
      style={{ ['--rail' as string]: job.priority === 2 ? '#ef4444' : STATUS_HEX[job.status] }}
      data-dragging={dragging || undefined}
      data-overlay={overlay || undefined}
      data-highlight={highlight || undefined}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen?.()}
    >
      <Group gap={8} wrap="nowrap" align="flex-start">
        {handle}
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" gap={8} wrap="nowrap" align="flex-start">
            <Box style={{ minWidth: 0 }}>
              <Group gap={6} wrap="nowrap">
                <span className="wt-chip-num">#{job.number}</span>
                {job.priority === 2 && (
                  <Group gap={3} wrap="nowrap" c="red.6"><IconAlertTriangleFilled size={13} /><Text size="xs" fw={650} c="red.6" style={{ whiteSpace: "nowrap" }}>Out of water</Text></Group>
                )}
                {job.priority === 1 && <Text size="xs" fw={650} c="orange.6">High priority</Text>}
              </Group>
              <Text className="wt-job-title" truncate mt={3}>{job.site_label}</Text>
            </Box>
            <Group gap={2} wrap="nowrap" style={{ flex: 'none' }}>
              <StatusBadge status={job.status} />
              {actions}
            </Group>
          </Group>
          {sub && (
            <Group gap={4} wrap="nowrap" mt={2}>
              <IconMapPin size={13} color="var(--wt-subtle)" style={{ flex: 'none' }} />
              <Text className="wt-job-meta" truncate>{sub}</Text>
            </Group>
          )}
          <Group justify="space-between" gap={6} wrap="nowrap" mt={10}>
            <Group gap={5} wrap="nowrap">
              <IconDroplet size={15} color="var(--wt-accent)" />
              <Text size="sm" fw={job.status === 'completed' ? 650 : 550} className="wt-num">{amount}</Text>
              {job.tags?.slice(0, 2).map((t) => (
                <Text key={t} size="xs" c="dimmed" px={6} style={{ border: '1px solid var(--wt-border)', borderRadius: 6 }}>{t}</Text>
              ))}
            </Group>
            <Group gap={6} wrap="nowrap">
              {when && <Text size="xs" c="dimmed">{when}</Text>}
              {showDriver && job.driver_name && <Person name={job.driver_name} size={22} tooltip />}
            </Group>
          </Group>
        </Box>
      </Group>
    </div>
  );
}
