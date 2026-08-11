/** Data for the Setup & docs section: what the agent was actually given, per run. */

import type { EventPayloads } from './events';
import { reduceEventLog } from './log';

export type RunStartedRecord = { run: number; ts: string; payload: EventPayloads['run_started'] };

export async function loadRunStartedEvents(path: string): Promise<{
  records: RunStartedRecord[];
  logExists: boolean;
}> {
  const result = await reduceEventLog(path, [] as RunStartedRecord[], (acc, event) => {
    if (event.type === 'run_started') acc.push({ run: event.run, ts: event.ts, payload: event.payload });
    return acc;
  });
  result.value.sort((a, b) => b.run - a.run); // newest first
  return { records: result.value, logExists: result.logExists };
}

/** Median gap between consecutive wakes — an observed cadence, not a declared schedule (the event log doesn't carry the latter). */
export function observedCadenceMs(records: RunStartedRecord[]): number | null {
  const gaps = records.map((r) => r.payload.elapsedMs).filter((ms): ms is number => ms !== null);
  if (gaps.length === 0) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * The event log has no dedicated timezone field — the wake message embeds a
 * formatted wall clock ending in a zone abbreviation instead (see
 * ../../src/prompts.ts's formatWallClock). Reading it back out of that line
 * rather than inventing a field the log doesn't carry.
 */
export function timezoneFromWakeMessage(wakeMessage: string): string | null {
  const match = wakeMessage.match(/\d{2}:\d{2}\s+(\S+)\.$/m);
  return match ? match[1]! : null;
}
