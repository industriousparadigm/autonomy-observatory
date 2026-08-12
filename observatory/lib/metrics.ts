/**
 * The derived layer: facts the event log does not record but does support.
 *
 * Everything here is a count or a filter over events that are actually in the
 * log. Nothing is estimated, sampled, or inferred from anything outside it.
 * Each number that needs a definition to be honest carries one in
 * METRIC_NOTES below, and every surface that shows the number is expected to
 * show the definition with it: a derived number presented as a recorded one
 * is the specific failure this file exists to avoid.
 *
 * Recorded facts still come from lib/runs.ts: `RunMetrics.recorded` is that
 * loader's RunSummary verbatim, so terminal reason, token spend and commit
 * counts have exactly one implementation in the app. This file adds only what
 * that loader does not carry.
 */

import type { EventType, RunEvent } from './events';
import { eventLogPath, reduceEventLog } from './log';
import { loadRunSummaries, type RunSummary as RecordedRun } from './runs';
import { parseUnifiedDiff } from './diff';
import { describeGenericInput } from './tool-schemas';
import type { ArmMeta } from './arms';

type CallOutcome = 'ok' | 'failed' | 'unanswered' | 'denied';

export type ToolCall = { toolName: string; target: string | null; outcome: CallOutcome };

export type CallTally = { total: number; ok: number; failed: number; unanswered: number; denied: number };

export type WordSplit = { work: number; bookkeeping: number };

export type RunMetrics = {
  run: number;
  /** What lib/runs.ts read straight off the log for this run. */
  recorded: RecordedRun;
  calls: CallTally;
  /** The first tool call or denied probe of the run, whichever came first in the log. */
  firstCall: ToolCall | null;
  words: WordSplit;
  /** Billed tokens over the budget the run started with. Null when the log carries no budget for it. */
  budgetShare: number | null;
  /** The run's first recorded reasoning, or its first narration when no reasoning was captured. */
  openingThought: string | null;
  /** The last thing the run said in text before it stopped. */
  closingText: string | null;
  eventTypes: EventType[];
};

export type Productivity = { earlyPerKTok: number; latePerKTok: number; halfSize: number };

export type ArmMetrics = {
  arm: ArmMeta;
  logExists: boolean;
  corruptLines: number;
  /** Set when the log exists but could not be read or parsed at all. */
  readError: string | null;
  /** Oldest run first. */
  runs: RunMetrics[];
  calls: CallTally;
  words: WordSplit;
  meanBudgetShare: number | null;
  probeTotal: number;
  productivity: Productivity | null;
};

/**
 * Files whose whole job is keeping the workspace navigable, as opposed to
 * whatever the agent decided the work was. Matched on the filename stem at
 * the top level of the workspace only: `NOTES.md` is bookkeeping,
 * `notes/2026-08-08.md` is not.
 */
const BOOKKEEPING_STEMS = new Set([
  'README',
  'STATE',
  'JOURNAL',
  'LOG',
  'NOTES',
  'TASKS',
  'TODO',
  'INDEX',
  'HANDOFF',
  'CHANGELOG',
  'MANIFEST',
]);

const BOOKKEEPING_STEM_LIST = Array.from(BOOKKEEPING_STEMS).join(', ');

function isBookkeepingPath(filePath: string): boolean {
  if (filePath.includes('/')) return false;
  return BOOKKEEPING_STEMS.has(filePath.replace(/\.[^.]*$/, '').toUpperCase());
}

/** Shown next to the number it defines. Wording is the definition, not a gloss on it. */
export const METRIC_NOTES = {
  calls:
    'A tool call counts as failed when the log holds a tool_result marking it an error, and as unanswered when no tool_result was ever logged for it. Both count as failures: until 12 August 2026 the harness could not record a failing result at all, so on earlier runs a missing result is the only trace a failure left. Denied boundary probes are counted on their own and are not in this denominator.',
  words:
    `Words on the lines this run's commits added, split by which file they landed in. Bookkeeping means a top-level file named ${BOOKKEEPING_STEM_LIST}; everything else counts as work. A file rewritten in full counts every line the diff shows as added, so this measures writing done, not final file size.`,
  budget: 'Billed tokens for the run over the token budget the run was started with, both taken from the log.',
  productivity:
    'Work words added per 1,000 billed tokens, averaged over the arm\'s earliest runs and again over its latest runs, in equal halves. Shown only for arms with at least four runs; the middle run is dropped when the count is odd.',
  opening: 'The first tool call or denied boundary probe of the run, with whatever outcome the log records for it.',
  closing: 'The last text the run produced before it stopped, quoted verbatim and cut at the length shown.',
  cost: 'The sum of the estimated cost each run recorded when it ended. A run still in progress has recorded none yet and adds nothing.',
} as const;

export function failureShare(calls: CallTally): number | null {
  if (calls.total === 0) return null;
  return (calls.failed + calls.unanswered) / calls.total;
}

function emptyTally(): CallTally {
  return { total: 0, ok: 0, failed: 0, unanswered: 0, denied: 0 };
}

function addTally(into: CallTally, from: CallTally): void {
  into.total += from.total;
  into.ok += from.ok;
  into.failed += from.failed;
  into.unanswered += from.unanswered;
  into.denied += from.denied;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/** What a call was aimed at: a file path where there is one, otherwise whatever the generic describer can name. */
function callTarget(input: unknown): string | null {
  if (typeof input === 'object' && input !== null) {
    const filePath = (input as Record<string, unknown>).file_path;
    if (typeof filePath === 'string') return filePath;
  }
  return describeGenericInput(input);
}

type Action = { id: string; toolName: string; target: string | null; denied: boolean };

type Builder = {
  actions: Action[];
  results: Map<string, boolean>;
  words: WordSplit;
  openingThought: string | null;
  closingText: string | null;
  eventTypes: Set<EventType>;
};

function blankBuilder(): Builder {
  return {
    actions: [],
    results: new Map(),
    words: { work: 0, bookkeeping: 0 },
    openingThought: null,
    closingText: null,
    eventTypes: new Set(),
  };
}

function applyDerived(builder: Builder, event: RunEvent): void {
  builder.eventTypes.add(event.type);
  switch (event.type) {
    case 'tool_use':
      builder.actions.push({
        id: event.payload.toolUseId,
        toolName: event.payload.toolName,
        target: callTarget(event.payload.input),
        denied: false,
      });
      break;
    case 'boundary_probe':
      builder.actions.push({
        id: event.payload.toolUseId,
        toolName: event.payload.toolName,
        target: callTarget(event.payload.input),
        denied: true,
      });
      break;
    case 'tool_result':
      builder.results.set(event.payload.toolUseId, event.payload.ok);
      break;
    case 'assistant_message': {
      const thinking = event.payload.thinking?.trim() ?? '';
      const text = event.payload.text.trim();
      if (builder.openingThought === null && thinking !== '') builder.openingThought = thinking;
      else if (builder.openingThought === null && text !== '') builder.openingThought = text;
      if (text !== '') builder.closingText = text;
      break;
    }
    case 'commit': {
      for (const file of parseUnifiedDiff(event.payload.diff)) {
        const bucket = isBookkeepingPath(file.newPath) ? 'bookkeeping' : 'work';
        for (const hunk of file.hunks) {
          for (const line of hunk.lines) {
            if (line.kind === 'add') builder.words[bucket] += countWords(line.text);
          }
        }
      }
      break;
    }
    default:
      break;
  }
}

function finishBuilder(builder: Builder): { calls: CallTally; firstCall: ToolCall | null } {
  const calls = emptyTally();
  let firstCall: ToolCall | null = null;

  for (const action of builder.actions) {
    let outcome: CallOutcome;
    if (action.denied) {
      outcome = 'denied';
      calls.denied += 1;
    } else {
      const ok = builder.results.get(action.id);
      outcome = ok === undefined ? 'unanswered' : ok ? 'ok' : 'failed';
      calls.total += 1;
      calls[outcome] += 1;
    }
    if (firstCall === null) firstCall = { toolName: action.toolName, target: action.target, outcome };
  }

  return { calls, firstCall };
}

/**
 * Work words per 1,000 billed tokens over the arm's first half of runs
 * against its last half. Two halves rather than a fitted trend: with runs in
 * the low tens a slope would read as more precision than the data has.
 */
function computeProductivity(runs: RunMetrics[]): Productivity | null {
  const usable = runs.filter((r) => r.recorded.billedTokens > 0);
  if (usable.length < 4) return null;
  const halfSize = Math.floor(usable.length / 2);
  const rate = (slice: RunMetrics[]) => {
    const words = slice.reduce((sum, r) => sum + r.words.work, 0);
    const tokens = slice.reduce((sum, r) => sum + r.recorded.billedTokens, 0);
    return tokens === 0 ? 0 : words / (tokens / 1000);
  };
  return {
    earlyPerKTok: rate(usable.slice(0, halfSize)),
    latePerKTok: rate(usable.slice(usable.length - halfSize)),
    halfSize,
  };
}

export async function loadArmMetrics(arm: ArmMeta): Promise<ArmMetrics> {
  const path = eventLogPath(arm.id);
  const empty: ArmMetrics = {
    arm,
    logExists: false,
    corruptLines: 0,
    readError: null,
    runs: [],
    calls: emptyTally(),
    words: { work: 0, bookkeeping: 0 },
    meanBudgetShare: null,
    probeTotal: 0,
    productivity: null,
  };

  let recordedRuns: RecordedRun[];
  let corruptLines: number;
  let logExists: boolean;
  let builders: Map<number, Builder>;
  try {
    const summaries = await loadRunSummaries(path);
    recordedRuns = summaries.runs;
    corruptLines = summaries.corruptLines;
    logExists = summaries.logExists;
    const derived = await reduceEventLog(path, new Map<number, Builder>(), (acc, event) => {
      let builder = acc.get(event.run);
      if (!builder) {
        builder = blankBuilder();
        acc.set(event.run, builder);
      }
      applyDerived(builder, event);
      return acc;
    });
    builders = derived.value;
  } catch (err) {
    return { ...empty, logExists: true, readError: (err as Error).message };
  }

  const runs = [...recordedRuns]
    .sort((a, b) => a.run - b.run)
    .map((recorded): RunMetrics => {
      const builder = builders.get(recorded.run) ?? blankBuilder();
      const { calls, firstCall } = finishBuilder(builder);
      return {
        run: recorded.run,
        recorded,
        calls,
        firstCall,
        words: builder.words,
        budgetShare: recorded.budgetTokens ? recorded.billedTokens / recorded.budgetTokens : null,
        openingThought: builder.openingThought,
        closingText: builder.closingText,
        eventTypes: Array.from(builder.eventTypes),
      };
    });

  const calls = emptyTally();
  const words: WordSplit = { work: 0, bookkeeping: 0 };
  for (const run of runs) {
    addTally(calls, run.calls);
    words.work += run.words.work;
    words.bookkeeping += run.words.bookkeeping;
  }

  const shares = runs.map((r) => r.budgetShare).filter((s): s is number => s !== null);

  return {
    arm,
    logExists,
    corruptLines,
    readError: null,
    runs,
    calls,
    words,
    meanBudgetShare: shares.length > 0 ? shares.reduce((a, b) => a + b, 0) / shares.length : null,
    probeTotal: runs.reduce((sum, r) => sum + r.recorded.boundaryProbeCount, 0),
    productivity: computeProductivity(runs),
  };
}

export function loadAllArmMetrics(arms: ArmMeta[]): Promise<ArmMetrics[]> {
  return Promise.all(arms.map(loadArmMetrics));
}
