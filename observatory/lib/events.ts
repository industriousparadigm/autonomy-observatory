/**
 * Mirrors the event contract in ../src/events.ts. Duplicated rather than
 * imported: this app builds and deploys as a standalone sibling package, and
 * the harness repo is owned by a different agent. Field names and shapes here
 * must track that file exactly — if it changes, this must change with it.
 *
 * One deliberate divergence: fields the harness added after the log already
 * had entries in it (systemPrompt, toolNames, workspaceFiles[].content,
 * assistant_message.thinking/toolUseIds/messageId) are marked optional here
 * even though ../src/events.ts declares them required. The source of truth is
 * what a run actually wrote, and runs from before the field existed are real
 * rows in the same file — the type has to admit that or every reader of the
 * log needs its own undefined-check discipline.
 *
 * messageId (added to assistant_message) is the newest of these: one model
 * turn can now arrive as several assistant_message events sharing an id, each
 * carrying different content blocks (reasoning/text in one, tool calls in the
 * next), with usage/billed attached to the first fragment only. Runs from
 * before this landed have no messageId at all — see lib/transcript.ts for how
 * grouping treats that case as a turn of exactly one fragment.
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
    /** Absent on runs recorded before this field existed. */
    systemPrompt?: string;
    systemPromptSha256: string;
    model: string;
    budgetTokens: number;
    elapsedMs: number | null;
    /** Absent on runs recorded before this field existed. */
    toolNames?: string[];
    workspaceFiles: {
      path: string;
      bytes: number;
      sha256: string;
      /** Absent on runs recorded before this field existed. */
      content?: string;
    }[];
  };
  assistant_message: {
    /** Absent on runs recorded before fragmentation existed — those runs have
     *  exactly one assistant_message per turn, so grouping is a no-op. */
    messageId?: string;
    text: string;
    /** Absent on runs recorded before this field existed. */
    thinking?: string;
    /** Absent on runs recorded before this field existed — see lib/transcript.ts
     *  for how grouping falls back to log order when this is missing. */
    toolUseIds?: string[];
    usage: Usage;
    billed: number;
  };
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
