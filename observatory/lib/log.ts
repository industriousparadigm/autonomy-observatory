/**
 * Server-only access to the event log. Streams line by line while parsing
 * rather than reading the whole file into memory in one go, so a 100MB+ log
 * costs one bounded pass rather than a single giant buffer.
 *
 * Parsed events are memoized at module scope, keyed by the file's mtime and
 * size. An unattended experiment appends to this file continuously, so the
 * cache re-validates on every call — but a size+mtime match (nothing appended
 * since the last read) skips the disk read and re-parse entirely, which is
 * the common case for a human clicking around the same handful of runs. The
 * cache lives for the life of the server process; that's fine, because the
 * only way the file changes is by appending, and an append always changes
 * both the mtime and the size.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
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

type ParsedLog = { mtimeMs: number; size: number; events: RunEvent[]; corruptLines: number };

const parseCache = new Map<string, ParsedLog>();

async function getParsedLog(path: string): Promise<ParsedLog | null> {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  const cached = parseCache.get(path);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }

  const events: RunEvent[] = [];
  let corruptLines = 0;
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      events.push(JSON.parse(trimmed) as RunEvent);
    } catch {
      corruptLines++;
    }
  }

  const parsed: ParsedLog = { mtimeMs: stat.mtimeMs, size: stat.size, events, corruptLines };
  parseCache.set(path, parsed);
  return parsed;
}

export async function reduceEventLog<T>(
  path: string,
  initial: T,
  reducer: (acc: T, event: RunEvent) => T,
): Promise<ReduceResult<T>> {
  const parsed = await getParsedLog(path);
  if (!parsed) {
    return { value: initial, corruptLines: 0, totalEvents: 0, logExists: false };
  }

  let acc = initial;
  for (const event of parsed.events) acc = reducer(acc, event);

  return { value: acc, corruptLines: parsed.corruptLines, totalEvents: parsed.events.length, logExists: true };
}
