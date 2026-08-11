/**
 * Groups a run's flat event log into the shape a reader actually wants: tool
 * calls and boundary probes nested under the assistant turn that issued them,
 * fragments of one turn merged into one, and stretches that produced nothing
 * worth reading compacted rather than repeated card-for-card.
 *
 * Two mechanics from the harness drive this, and which one claims a given
 * call depends on whether the turn it belongs to has a `messageId`:
 *
 * 1. Fragmentation (messageId present). One model turn can arrive as several
 *    assistant_message events sharing an id — reasoning/text in one
 *    fragment, tool calls in the next — with usage/billed attached to the
 *    first fragment only. Once a turn is tied together by a real id, its own
 *    fragments' `toolUseIds` is authoritative for what it claims: this is
 *    exactly the ambiguity messageId exists to remove, so a second,
 *    positional guess on top of it would do more harm than good. Concretely:
 *    a turn with no calls of its own sits between two turns that do; if a
 *    positional "everything since the last flush" rule were applied here, a
 *    later turn's calls would bleed backwards into the empty one the moment
 *    it happens to flush first. Trusting the id-scoped `toolUseIds` avoids
 *    that entirely.
 *
 * 2. Positional attachment (no messageId — a run from before fragmentation
 *    landed). Every one of these turns is exactly one fragment, so there is
 *    no merging to do, but `toolUseIds` on them has been observed to
 *    under-report (empty even though calls immediately follow — the same
 *    fragmentation happening at the SDK level without the id yet to name it).
 *    For these, position is what actually claims a call: the PreToolUse hook
 *    logs `tool_use`/`boundary_probe` as soon as a call is parsed out of the
 *    model's streaming response, before the SDK yields the assistant_message
 *    for that turn, so everything between one closed turn and the next
 *    always belongs to the next one. `groupingInferred` marks turns claimed
 *    this way, since the log itself offers no confirming link for them.
 *
 * The node types here are exactly what components/renderers/registry.tsx
 * dispatches on — see that file for how a renderer is matched and added.
 */

import type { BoundaryProbeKind, EventPayloads, RunEvent } from './events';

export type ToolCallNode = {
  kind: 'tool_call';
  toolUseId: string;
  toolName: string;
  input: unknown;
  outcome: { ok: boolean; result: unknown } | null;
};

export type BoundaryProbeNode = {
  kind: 'boundary_probe';
  toolUseId: string;
  toolName: string;
  input: unknown;
  probeKind: BoundaryProbeKind;
  denialReason: string;
};

/** A tool call and a denied probe are the only two things an assistant turn's `items` can hold. */
export type CallNode = ToolCallNode | BoundaryProbeNode;

export type AssistantTurnNode = {
  kind: 'assistant_turn';
  seq: number;
  text: string;
  thinking: string | null;
  billed: number;
  items: CallNode[];
  groupingInferred: boolean;
};

export type UnattributedNode = { kind: 'unattributed_activity'; seq: number; items: CallNode[] };
export type CommitNode = { kind: 'commit'; seq: number; payload: EventPayloads['commit'] };
export type BudgetExhaustedNode = { kind: 'budget_exhausted'; seq: number; payload: EventPayloads['budget_exhausted'] };
export type HarnessErrorNode = { kind: 'harness_error'; seq: number; payload: EventPayloads['harness_error'] };
export type RunEndedNode = { kind: 'run_ended'; seq: number; payload: EventPayloads['run_ended'] };
/** One or more consecutive assistant turns that produced no text, no reasoning, and issued no tool call — pure token spend with nothing to read. Collapsed so they don't each claim a full card. */
export type QuietStretchNode = { kind: 'quiet_stretch'; seq: number; turnCount: number; billed: number };

/** One entry in the top-level transcript, in chronological order. */
export type TranscriptNode =
  | AssistantTurnNode
  | UnattributedNode
  | CommitNode
  | BudgetExhaustedNode
  | HarnessErrorNode
  | RunEndedNode
  | QuietStretchNode;

/** Everything the renderer registry can be asked to draw: top-level entries plus the calls nested inside a turn. */
export type RenderableNode = TranscriptNode | CallNode;

function isEmptyTurn(n: TranscriptNode): n is AssistantTurnNode {
  return n.kind === 'assistant_turn' && n.text === '' && n.thinking === null && n.items.length === 0;
}

/** Merges consecutive empty assistant turns into one QuietStretchNode. Anything else passes through untouched. */
function collapseQuietStretches(entries: TranscriptNode[]): TranscriptNode[] {
  const out: TranscriptNode[] = [];
  let run: AssistantTurnNode[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      out.push(run[0]!);
    } else {
      out.push({
        kind: 'quiet_stretch',
        seq: run[0]!.seq,
        turnCount: run.length,
        billed: run.reduce((sum, t) => sum + t.billed, 0),
      });
    }
    run = [];
  };

  for (const entry of entries) {
    if (isEmptyTurn(entry)) {
      run.push(entry);
    } else {
      flush();
      out.push(entry);
    }
  }
  flush();
  return out;
}

export function buildTranscript(events: RunEvent[]): TranscriptNode[] {
  // First pass: full lookup tables. A tool_result can be logged either side
  // of the assistant_message that references its call, so outcomes have to
  // be resolvable regardless of where in the second pass a call gets built.
  const toolUseIndex = new Map<string, { toolName: string; input: unknown }>();
  const resultIndex = new Map<string, { ok: boolean; result: unknown }>();
  const probeIndex = new Map<string, BoundaryProbeNode>();

  for (const e of events) {
    if (e.type === 'tool_use') {
      toolUseIndex.set(e.payload.toolUseId, { toolName: e.payload.toolName, input: e.payload.input });
    } else if (e.type === 'tool_result') {
      resultIndex.set(e.payload.toolUseId, { ok: e.payload.ok, result: e.payload.result });
    } else if (e.type === 'boundary_probe') {
      probeIndex.set(e.payload.toolUseId, {
        kind: 'boundary_probe',
        toolUseId: e.payload.toolUseId,
        toolName: e.payload.toolName,
        input: e.payload.input,
        probeKind: e.payload.kind,
        denialReason: e.payload.denialReason,
      });
    }
  }

  const claimed = new Set<string>();

  function buildItem(id: string): CallNode | null {
    const call = toolUseIndex.get(id);
    if (call) {
      claimed.add(id);
      const outcome = resultIndex.get(id);
      return { kind: 'tool_call', toolUseId: id, toolName: call.toolName, input: call.input, outcome: outcome ?? null };
    }
    const probe = probeIndex.get(id);
    if (probe) {
      claimed.add(id);
      return probe;
    }
    return null;
  }

  // Second pass: walk in log order. `pending` accumulates tool_use/probe ids
  // seen since the last turn was flushed — under the positional-attachment
  // invariant (see module doc), that window is exactly what the next turn
  // claims, regardless of whether toolUseIds corroborates it.
  const entries: TranscriptNode[] = [];
  const pending: string[] = [];

  let openMessageId: string | null = null;
  let openFragments: RunEvent<'assistant_message'>[] = [];

  function flushOpenTurn(): void {
    if (openFragments.length === 0) return;
    const text = openFragments
      .map((f) => f.payload.text)
      .filter((t) => t.trim() !== '')
      .join('\n\n');
    const thinkingParts = openFragments.map((f) => f.payload.thinking).filter((t): t is string => !!t && t.trim() !== '');
    const thinking = thinkingParts.length > 0 ? thinkingParts.join('\n\n') : null;
    const billed = openFragments.reduce((sum, f) => sum + f.payload.billed, 0);

    // A real messageId ties these fragments together and makes their own
    // toolUseIds authoritative (see module doc, mechanic 1) — position must
    // not also weigh in here, or a neighboring turn's calls can bleed into
    // an empty one the moment it happens to flush first. No messageId means
    // exactly one fragment with no reliable link of its own (mechanic 2):
    // position is what actually claims a call, so drain everything pending
    // since the last flush, skipping anything a messageId-linked turn has
    // already claimed (only possible mid-run, across a schema transition).
    const isFragmented = openMessageId !== null;
    let ids: string[];
    if (isFragmented) {
      ids = Array.from(new Set(openFragments.flatMap((f) => f.payload.toolUseIds ?? [])));
    } else {
      ids = pending.filter((id) => !claimed.has(id));
      pending.length = 0;
    }

    const items = ids.map(buildItem).filter((x): x is CallNode => x !== null);

    entries.push({
      kind: 'assistant_turn',
      seq: openFragments[0]!.seq,
      text,
      thinking,
      billed,
      items,
      groupingInferred: !isFragmented,
    });

    openMessageId = null;
    openFragments = [];
  }

  for (const e of events) {
    switch (e.type) {
      case 'tool_use':
        pending.push(e.payload.toolUseId);
        break;
      case 'boundary_probe':
        pending.push(e.payload.toolUseId);
        break;
      case 'assistant_message': {
        const mid = e.payload.messageId;
        if (mid !== undefined && mid === openMessageId) {
          // Another fragment of the turn already open — keep accumulating, don't flush.
          openFragments.push(e);
        } else {
          flushOpenTurn();
          openMessageId = mid ?? null;
          openFragments = [e];
          if (mid === undefined) flushOpenTurn(); // pre-messageId runs: always a singleton turn
        }
        break;
      }
      case 'commit':
        flushOpenTurn();
        entries.push({ kind: 'commit', seq: e.seq, payload: e.payload as EventPayloads['commit'] });
        break;
      case 'budget_exhausted':
        flushOpenTurn();
        entries.push({ kind: 'budget_exhausted', seq: e.seq, payload: e.payload as EventPayloads['budget_exhausted'] });
        break;
      case 'harness_error':
        flushOpenTurn();
        entries.push({ kind: 'harness_error', seq: e.seq, payload: e.payload as EventPayloads['harness_error'] });
        break;
      case 'run_ended':
        flushOpenTurn();
        entries.push({ kind: 'run_ended', seq: e.seq, payload: e.payload as EventPayloads['run_ended'] });
        break;
      default:
        break; // run_started, tool_result are consumed via the indexes above
    }
  }
  flushOpenTurn();

  // Anything never claimed by a turn — a run that crashed between logging a
  // tool_use and the assistant_message that would have claimed it, most
  // often — still has to show up somewhere: it's exactly the kind of signal
  // this instrument exists to never silently drop.
  const strandedIds = pending.filter((id) => !claimed.has(id));
  if (strandedIds.length > 0) {
    const items = strandedIds.map(buildItem).filter((x): x is CallNode => x !== null);
    const seq = Math.max(...events.map((e) => e.seq));
    entries.push({ kind: 'unattributed_activity', seq, items });
  }

  entries.sort((a, b) => a.seq - b.seq);
  return collapseQuietStretches(entries);
}
