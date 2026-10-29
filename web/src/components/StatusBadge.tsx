import type { JobStatus } from '../api';
import { STATUS_COLOR, STATUS_LABEL } from '../format';

export default function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className="badge" style={{ color: STATUS_COLOR[status], borderColor: STATUS_COLOR[status] }}>
      {STATUS_LABEL[status]}
    </span>
  );
}
