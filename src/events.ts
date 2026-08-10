/**
 * The append-only run log. This file is the sole source of truth for the
 * experiment: workspace state, metrics, and every view in the observatory are
 * projections of it. The first pass at the metrics will be wrong, so
 * recomputing them must never require re-running the agent.
 *
 * Format is JSONL — one event per line, never rewritten, never reordered.
 */

import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeSync, fsyncSync } from 'node:fs';
import { createHash } from 'node:crypto';

export type EventType =
  | 'run_started'
  | 'assistant_message'
  | 'tool_use'
  | 'tool_result'
  | 'boundary_probe'
  | 'budget_exhausted'
  | 'commit'
  | 'run_ended'
  | 'harness_error';

/** Token accounting for one API turn, as reported by the SDK. */
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

/**
 * The experiment's budget unit: what the request actually costs to serve.
 * Cache reads are excluded deliberately — re-reading cached context is close
 * to free, so charging for it would make long sessions expensive for reasons
 * that have nothing to do with what the agent chose to do.
 */
export function billedTokens(u: Usage): number {
  return u.inputTokens + u.cacheCreationInputTokens + u.outputTokens;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

/** Why a run stopped. `voluntary_stop` is itself a measured signal. */
export type TerminalReason =
  | 'voluntary_stop'
  | 'budget_exhausted'
  | 'max_turns'
  | 'harness_error'
  | 'aborted';

export type EventPayloads = {
  run_started: {
    wakeMessage: string;
    /** The prompt verbatim, not just its hash: the log has to be able to show
     *  exactly what the agent was told, without consulting the code that ran. */
    systemPrompt: string;
    systemPromptSha256: string;
    model: string;
    budgetTokens: number;
    elapsedMs: number | null;
    /** Names the agent was given for its tools, as they appear in the prompt. */
    toolNames: string[];
    /** Every file in the workspace at wake, contents included, so the log alone
     *  reconstructs what the agent could see when it woke. */
    workspaceFiles: { path: string; bytes: number; sha256: string; content: string }[];
  };
  assistant_message: {
    text: string;
    /** Summarised reasoning when the model returns it. Observation only: the
     *  thinking happens either way, this just stops us throwing it away. */
    thinking: string;
    /** Tool calls this turn issued, so a reader can see which turn caused what. */
    toolUseIds: string[];
    usage: Usage;
    billed: number;
  };
  tool_use: { toolUseId: string; toolName: string; input: unknown };
  tool_result: { toolUseId: string; toolName: string; ok: boolean; result: unknown };
  /**
   * An attempt to act outside the workspace, modify the schedule, or inspect
   * the harness. Blocked, but recorded in full — silently discarding these
   * would throw away the strongest autonomy signal the instrument can see.
   */
  boundary_probe: {
    toolUseId: string;
    toolName: string;
    input: unknown;
    kind: 'extra_workspace_write' | 'extra_workspace_read' | 'harness_inspection' | 'schedule_modification' | 'network_egress';
    denialReason: string;
  };
  budget_exhausted: { billedTokens: number; budgetTokens: number };
  commit: {
    sha: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
    /** Full unified diff, so the observatory never has to reach for a git host. */
    diff: string;
  };
  run_ended: {
    terminalReason: TerminalReason;
    usage: Usage;
    billed: number;
    /** SDK client-side estimate. Reconciled against the Admin API separately. */
    estimatedCostUsd: number;
    durationMs: number;
    turns: number;
  };
  harness_error: { message: string; stack?: string };
};

export type RunEvent<T extends EventType = EventType> = {
  seq: number;
  ts: string;
  arm: string;
  run: number;
  type: T;
  payload: EventPayloads[T];
};

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Appends with an fsync per event. Slower than buffering, and correct: an
 * unattended run that dies mid-session must not take the record of what it did
 * with it.
 */
export class EventLog {
  // Explicit fields rather than constructor parameter properties: Node's
  // type-stripping runs the .ts directly and rejects that syntax.
  private seq: number;
  private readonly path: string;
  private readonly arm: string;

  constructor(path: string, arm: string) {
    this.path = path;
    this.arm = arm;
    this.seq = existsSync(path) ? readLog(path).length : 0;
  }

  append<T extends EventType>(run: number, type: T, payload: EventPayloads[T]): RunEvent<T> {
    const event: RunEvent<T> = {
      seq: this.seq++,
      ts: new Date().toISOString(),
      arm: this.arm,
      run,
      type,
      payload,
    };
    const fd = openSync(this.path, 'a');
    try {
      writeSync(fd, JSON.stringify(event) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return event;
  }
}

export function readLog(path: string): RunEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      try {
        return JSON.parse(line) as RunEvent;
      } catch (err) {
        throw new Error(`corrupt event log at ${path} line ${i + 1}: ${(err as Error).message}`);
      }
    });
}

/** The run number the next wake should carry. */
export function nextRunNumber(events: RunEvent[]): number {
  const starts = events.filter((e) => e.type === 'run_started');
  return starts.length === 0 ? 1 : Math.max(...starts.map((e) => e.run)) + 1;
}

/** When the previous run began, for the wake message's elapsed field. */
export function lastRunStartedAt(events: RunEvent[]): Date | null {
  const starts = events.filter((e) => e.type === 'run_started');
  if (starts.length === 0) return null;
  return new Date(starts[starts.length - 1]!.ts);
}
