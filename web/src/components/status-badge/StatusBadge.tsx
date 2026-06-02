import * as React from 'react';
import {
  ArrowDownToLine,
  Loader,
  CheckCircle2,
  XCircle,
  CircleDashed,
  Circle,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/**
 * StatusBadge — shared presentational primitive for the file/transaction status
 * lifecycle (R16, NFR1). Consumed by Epics 2–4 wherever a status value is shown.
 *
 * Colour mapping (brief §6 / §11, R16):
 *   - Imported / Processing → blue (info)
 *   - Approved / Completed  → green (success)
 *   - Rejected / Failed     → red (danger)
 *   - Uploaded              → grey (neutral)
 *
 * Accessibility (R16 / NFR1): colour is NEVER the sole signal. Every badge pairs
 * a hue with BOTH a distinct icon and the visible status text label.
 *
 * Styling: colours come from token-backed Tailwind utility classes that resolve
 * to the `--status-*` custom properties declared once in globals.css. No hex
 * literals live in this file.
 */

type StatusGroup = 'info' | 'success' | 'danger' | 'neutral';

interface StatusVisual {
  group: StatusGroup;
  Icon: LucideIcon;
}

/**
 * Canonical status → visual mapping. Unknown/unmapped statuses fall back to the
 * neutral group so a badge always renders an icon + label rather than throwing.
 */
const STATUS_VISUALS: Record<string, StatusVisual> = {
  Imported: { group: 'info', Icon: ArrowDownToLine },
  Processing: { group: 'info', Icon: Loader },
  Approved: { group: 'success', Icon: CheckCircle2 },
  Completed: { group: 'success', Icon: CheckCircle2 },
  Rejected: { group: 'danger', Icon: XCircle },
  Failed: { group: 'danger', Icon: XCircle },
  Uploaded: { group: 'neutral', Icon: CircleDashed },
};

const GROUP_CLASSES: Record<StatusGroup, string> = {
  info: 'bg-status-info-bg text-status-info-fg border-status-info-border',
  success:
    'bg-status-success-bg text-status-success-fg border-status-success-border',
  danger:
    'bg-status-danger-bg text-status-danger-fg border-status-danger-border',
  neutral:
    'bg-status-neutral-bg text-status-neutral-fg border-status-neutral-border',
};

export interface StatusBadgeProps extends Omit<
  React.ComponentProps<typeof Badge>,
  'variant' | 'children'
> {
  /** Canonical status value (e.g. "Imported", "Approved", "Failed", "Uploaded"). */
  status: string;
}

export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const visual = STATUS_VISUALS[status] ?? {
    group: 'neutral' as const,
    Icon: Circle,
  };
  const { group, Icon } = visual;

  return (
    <Badge
      data-status={status}
      className={cn('border font-medium', GROUP_CLASSES[group], className)}
      {...props}
    >
      <Icon aria-hidden="true" />
      <span>{status}</span>
    </Badge>
  );
}
