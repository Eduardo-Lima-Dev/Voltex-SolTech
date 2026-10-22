import type { InstallationStatus } from '@voltex/shared';
import { Badge } from '@voltex/ui';
import { INSTALLATION_STATUS_LABELS, INSTALLATION_STATUS_VARIANT } from './labels';

export function InstallationStatusBadge({ status }: { status: InstallationStatus }) {
  return (
    <Badge variant={INSTALLATION_STATUS_VARIANT[status]}>
      {INSTALLATION_STATUS_LABELS[status]}
    </Badge>
  );
}
