import { Badge } from '@mantine/core';
import type { JobStatus } from '../api';
import { STATUS_LABEL, STATUS_MANTINE } from '../format';

export default function StatusBadge({ status, size = 'sm' }: { status: JobStatus; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return (
    <Badge color={STATUS_MANTINE[status]} size={size} variant="light">
      {STATUS_LABEL[status]}
    </Badge>
  );
}
