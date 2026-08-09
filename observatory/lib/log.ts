/**
 * Server-only access to the event log. Streams line by line rather than
 * reading the whole file into memory, so a 100MB+ log stays bounded by
 * however much a single caller's reducer chooses to retain (one run's
 * events, or a handful of running totals) rather than by file size.
 *
 * There is no cross-request cache: an unattended experiment appends to this
 * file continuously, so every request re-scans it to stay current. That is
 * an honest trade for "no database" — a request against a very large log
 * costs an O(file size) read every time.
 */

import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { RunEvent } from './events';

export function eventLogPath(): string {
  return process.env.EVENT_LOG_PATH ?? '/data/logs/a.jsonl';
}

export type ReduceResult<T> = {
  value: T;
  /** Lines that failed to parse as JSON. Skipped, not thrown, so one bad
   *  line never takes down the dashboard. */
  corruptLines: number;
  totalEvents: number;
  logExists: boolean;
};

export async function reduceEventLog<T>(
  path: string,
  initial: T,
  reducer: (acc: T, event: RunEvent) => T,
): Promise<ReduceResult<T>> {
  let acc = initial;
  let corruptLines = 0;
  let totalEvents = 0;

  if (!existsSync(path)) {
    return { value: acc, corruptLines, totalEvents, logExists: false };
  }

  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const event = JSON.parse(trimmed) as RunEvent;
      totalEvents++;
      acc = reducer(acc, event);
    } catch {
      corruptLines++;
    }
  }

  return { value: acc, corruptLines, totalEvents, logExists: true };
}
