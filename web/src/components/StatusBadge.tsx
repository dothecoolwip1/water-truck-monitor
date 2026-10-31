import type { JobStatus } from '../api';
import { STATUS_HEX, STATUS_LABEL } from '../format';

/** A soft pill with a coloured dot; the dot pulses while the job is under way. */
export default function StatusBadge({ status, size = 'sm' }: { status: JobStatus; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className="wt-status"
      data-size={size === 'lg' || size === 'md' ? 'lg' : undefined}
      data-live={status === 'en_route' || status === 'arrived' || undefined}
      style={{ ['--c' as string]: STATUS_HEX[status] }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
