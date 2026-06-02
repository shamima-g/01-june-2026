import * as React from 'react';
import { Inbox, FilterX } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * EmptyState — shared presentational primitive that distinguishes a genuine
 * zero-data state from a zero-filter-results state (R15). Consumed by Epics 2–4
 * on the File Logs and Transactions surfaces.
 *
 *   - variant="no-data"    → "nothing here yet" framing; NO clear-filters control.
 *   - variant="no-results" → reflects the active filter context and offers a
 *                            Clear-filters affordance so the user can recover.
 *
 * The two variants render distinguishable messaging and iconography so the user
 * can tell "there is no data" from "your filter hid the data".
 */

interface BaseEmptyStateProps {
  /** Short headline for the empty state. */
  title: string;
  /** Supporting explanatory copy. */
  message: string;
  className?: string;
}

interface NoDataEmptyStateProps extends BaseEmptyStateProps {
  variant: 'no-data';
  /** Optional call-to-action (e.g. an Upload button) rendered for the zero-data state. */
  action?: React.ReactNode;
}

interface NoResultsEmptyStateProps extends BaseEmptyStateProps {
  variant: 'no-results';
  /** Human-readable summary of the active filters that produced zero results. */
  activeFilterSummary: string;
  /** Invoked when the user clears the active filters. */
  onClearFilters: () => void;
}

export type EmptyStateProps = NoDataEmptyStateProps | NoResultsEmptyStateProps;

export function EmptyState(props: EmptyStateProps) {
  const { variant, title, message, className } = props;
  const Icon = variant === 'no-results' ? FilterX : Inbox;

  return (
    <div
      data-variant={variant}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center',
        className,
      )}
    >
      <Icon className="size-10 text-muted-foreground" aria-hidden="true" />
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>

      {variant === 'no-results' && (
        <>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Active filters:</span>{' '}
            {props.activeFilterSummary}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onClearFilters}
          >
            <FilterX aria-hidden="true" />
            Clear all filters
          </Button>
        </>
      )}

      {variant === 'no-data' && props.action}
    </div>
  );
}
