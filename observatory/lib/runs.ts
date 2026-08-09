import type { RunEvent, TerminalReason } from './events';
import { reduceEventLog, eventLogPath } from './log';
import { changedFilePaths } from './diff';

export type RunSummary = {
  run: number;
  arm: string;
  seq: number;
  startedAt: string | null;
  elapsedMs: number | null;
  budgetTokens: number | null;
  model: string | null;
  billedTokens: number;
  turns: number | null;
  estimatedCostUsd: number | null;
  durationMs: number | null;
  terminalReason: TerminalReason | null;
  /** run_started exists, run_ended does not — includes runs that died silently. */
  inProgress: boolean;
  /** run_started exists, a harness_error was logged, run_ended does not. */
  crashed: boolean;
  boundaryProbeCount: number;
  budgetExhausted: boolean;
  commitCount: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
  changedFiles: string[];
};

type Builder = RunSummary & { _seenHarnessError: boolean };

const RUN_KEY = (arm: string, run: number) => `${arm} ${run}`;

function blankBuilder(arm: string, run: number, seq: number): Builder {
  return {
    run,
    arm,
    seq,
    startedAt: null,
    elapsedMs: null,
    budgetTokens: null,
    model: null,
    billedTokens: 0,
    turns: null,
    estimatedCostUsd: null,
    durationMs: null,
    terminalReason: null,
    inProgress: true,
    crashed: false,
    boundaryProbeCount: 0,
    budgetExhausted: false,
    commitCount: 0,
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    changedFiles: [],
    _seenHarnessError: false,
  };
}

function apply(builder: Builder, event: RunEvent): void {
  switch (event.type) {
    case 'run_started':
      builder.startedAt = event.ts;
      builder.elapsedMs = event.payload.elapsedMs;
      builder.budgetTokens = event.payload.budgetTokens;
      builder.model = event.payload.model;
      break;
    case 'assistant_message':
      if (builder.inProgress) builder.billedTokens += event.payload.billed;
      break;
    case 'boundary_probe':
      builder.boundaryProbeCount += 1;
      break;
    case 'budget_exhausted':
      builder.budgetExhausted = true;
      break;
    case 'commit':
      builder.commitCount += 1;
      builder.filesChanged += event.payload.filesChanged;
      builder.insertions += event.payload.insertions;
      builder.deletions += event.payload.deletions;
      for (const p of changedFilePaths(event.payload.diff)) {
        if (!builder.changedFiles.includes(p)) builder.changedFiles.push(p);
      }
      break;
    case 'harness_error':
      builder._seenHarnessError = true;
      break;
    case 'run_ended':
      builder.inProgress = false;
      builder.terminalReason = event.payload.terminalReason;
      builder.billedTokens = event.payload.billed;
      builder.turns = event.payload.turns;
      builder.estimatedCostUsd = event.payload.estimatedCostUsd;
      builder.durationMs = event.payload.durationMs;
      break;
  }
}

/** All runs, newest first. One streaming pass over the log. */
export async function loadRunSummaries(path: string = eventLogPath()): Promise<{
  runs: RunSummary[];
  corruptLines: number;
  logExists: boolean;
}> {
  const result = await reduceEventLog(path, new Map<string, Builder>(), (acc, event) => {
    const key = RUN_KEY(event.arm, event.run);
    let builder = acc.get(key);
    if (!builder) {
      builder = blankBuilder(event.arm, event.run, event.seq);
      acc.set(key, builder);
    }
    apply(builder, event);
    return acc;
  });

  const runs = Array.from(result.value.values())
    .map((b): RunSummary => {
      const { _seenHarnessError, ...summary } = b;
      return { ...summary, crashed: b.inProgress && _seenHarnessError };
    })
    .sort((a, b) => b.seq - a.seq);

  return { runs, corruptLines: result.corruptLines, logExists: result.logExists };
}

/** Every event belonging to one run, in log order. One streaming pass. */
export async function loadRunEvents(
  run: number,
  path: string = eventLogPath(),
): Promise<{ events: RunEvent[]; arm: string | null }> {
  const result = await reduceEventLog(
    path,
    { events: [] as RunEvent[], arm: null as string | null },
    (acc, event) => {
      if (event.run === run) {
        acc.events.push(event);
        acc.arm = event.arm;
      }
      return acc;
    },
  );
  return result.value;
}
