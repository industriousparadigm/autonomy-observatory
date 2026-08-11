/**
 * Attributes billed tokens to activity categories.
 *
 * The schema forces a compromise here: token usage is reported on
 * assistant_message (one per API turn), but the *activity* it represents is
 * expressed by whichever tool_use events that turn produced — a separate
 * event type with no usage field of its own. So each assistant turn's billed
 * tokens are attributed to the categories of the tool_use events that follow
 * it, up to the next assistant_message (split evenly across categories when
 * a turn calls tools of more than one kind); a turn that calls no tool at
 * all — plain narration, or the closing message — falls into
 * "uncategorized" rather than being dropped.
 */

import { categoryForTool, CATEGORY_ORDER, type ActivityCategory } from './categories';
import type { RunEvent } from './events';
import { reduceEventLog } from './log';

export type RunAllocation = {
  run: number;
  totals: Record<ActivityCategory, number>;
  totalBilled: number;
};

function emptyTotals(): Record<ActivityCategory, number> {
  const t = {} as Record<ActivityCategory, number>;
  for (const c of CATEGORY_ORDER) t[c] = 0;
  return t;
}

/** One run's worth of turn-to-category attribution. Feed it events in order. */
export class CategoryAccumulator {
  readonly totals = emptyTotals();
  private openBilled: number | null = null;
  private openCategories = new Set<ActivityCategory>();

  push(event: RunEvent): void {
    if (event.type === 'assistant_message') {
      this.flush();
      this.openBilled = event.payload.billed;
      this.openCategories = new Set();
    } else if (event.type === 'tool_use') {
      if (this.openBilled !== null) this.openCategories.add(categoryForTool(event.payload.toolName));
    } else if (event.type === 'run_ended' || event.type === 'harness_error') {
      this.flush();
    }
  }

  /** Call once after the last event, to attribute a still-open turn. */
  finish(): void {
    this.flush();
  }

  private flush(): void {
    if (this.openBilled === null) return;
    const billed = this.openBilled;
    this.openBilled = null;
    if (this.openCategories.size === 0) {
      this.totals.uncategorized += billed;
      return;
    }
    const share = billed / this.openCategories.size;
    for (const c of this.openCategories) this.totals[c] += share;
  }
}

/** Per-run category totals, oldest run first (chronological, for a trend chart). */
export async function loadBudgetAllocation(path: string): Promise<{
  allocations: RunAllocation[];
  corruptLines: number;
  logExists: boolean;
}> {
  const result = await reduceEventLog(path, new Map<number, CategoryAccumulator>(), (acc, event) => {
    let bucket = acc.get(event.run);
    if (!bucket) {
      bucket = new CategoryAccumulator();
      acc.set(event.run, bucket);
    }
    bucket.push(event);
    return acc;
  });

  for (const bucket of result.value.values()) bucket.finish();

  const allocations = Array.from(result.value.entries())
    .map(([run, bucket]): RunAllocation => ({
      run,
      totals: bucket.totals,
      totalBilled: CATEGORY_ORDER.reduce((sum, c) => sum + bucket.totals[c], 0),
    }))
    .sort((a, b) => a.run - b.run);

  return { allocations, corruptLines: result.corruptLines, logExists: result.logExists };
}
