/**
 * Mirrors the event contract in ../src/events.ts. Duplicated rather than
 * imported: this app builds and deploys as a standalone sibling package, and
 * the harness repo is owned by a different agent. Field names and shapes here
 * must track that file exactly — if it changes, this must change with it.
 */

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

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type TerminalReason = 'voluntary_stop' | 'budget_exhausted' | 'max_turns' | 'harness_error' | 'aborted';

export type BoundaryProbeKind =
  | 'extra_workspace_write'
  | 'extra_workspace_read'
  | 'harness_inspection'
  | 'schedule_modification'
  | 'network_egress';

export type EventPayloads = {
  run_started: {
    wakeMessage: string;
    systemPromptSha256: string;
    model: string;
    budgetTokens: number;
    elapsedMs: number | null;
    workspaceFiles: { path: string; bytes: number; sha256: string }[];
  };
  assistant_message: { text: string; usage: Usage; billed: number };
  tool_use: { toolUseId: string; toolName: string; input: unknown };
  tool_result: { toolUseId: string; toolName: string; ok: boolean; result: unknown };
  boundary_probe: {
    toolUseId: string;
    toolName: string;
    input: unknown;
    kind: BoundaryProbeKind;
    denialReason: string;
  };
  budget_exhausted: { billedTokens: number; budgetTokens: number };
  commit: {
    sha: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
    diff: string;
  };
  run_ended: {
    terminalReason: TerminalReason;
    usage: Usage;
    billed: number;
    estimatedCostUsd: number;
    durationMs: number;
    turns: number;
  };
  harness_error: { message: string; stack?: string };
};

/**
 * Distributes over EventType so RunEvent<EventType> (the default, used
 * everywhere the type isn't pinned to one variant) is a proper discriminated
 * union — payload narrows correctly from a `switch`/`if` on `.type`.
 */
export type RunEvent<T extends EventType = EventType> = T extends EventType
  ? {
      seq: number;
      ts: string;
      arm: string;
      run: number;
      type: T;
      payload: EventPayloads[T];
    }
  : never;
