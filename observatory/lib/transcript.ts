/**
 * Groups a run's flat event log into the shape a reader actually wants: tool
 * calls and boundary probes nested under the assistant turn that issued them,
 * rather than appearing in raw log order.
 *
 * Raw order is misleading by construction, not by bug: the PreToolUse hook
 * logs `tool_use` (and `boundary_probe`, for a denied call) as soon as a tool
 * call is parsed out of the model's streaming response, which happens before
 * the SDK yields the fully-assembled `assistant_message` for that turn. So
 * the log reads "tool ran" then "600 tokens billed, no text" — as if the
 * tool fired on its own and the turn that caused it showed up after the
 * fact. `assistant_message.toolUseIds` exists to undo exactly this: it lists
 * which tool_use/boundary_probe events the turn that follows them in the log
 * actually issued.
 *
 * Runs recorded before `toolUseIds` existed don't have that list. For those,
 * grouping falls back to claiming every not-yet-claimed tool_use/probe seen
 * so far when an assistant_message without the field is reached — the same
 * "preceding calls belong to the next turn" rule the field itself encodes,
 * just inferred from position instead of stated. Entries built this way are
 * marked `groupingInferred: true` so the UI can say so rather than imply a
 * certainty the log doesn't back up.
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

/** One entry in the top-level transcript, in chronological order. */
export type TranscriptNode = AssistantTurnNode | UnattributedNode | CommitNode | BudgetExhaustedNode | HarnessErrorNode | RunEndedNode;

/** Everything the renderer registry can be asked to draw: top-level entries plus the calls nested inside a turn. */
export type RenderableNode = TranscriptNode | CallNode;

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

  // Second pass: walk in log order, building each turn. `pending` accumulates
  // tool_use/boundary_probe ids seen since the last turn was built — that
  // window, not "everything left in the whole run", is what an old-shape
  // assistant_message without toolUseIds should claim.
  const entries: TranscriptNode[] = [];
  const pending: string[] = [];

  for (const e of events) {
    switch (e.type) {
      case 'tool_use':
        pending.push(e.payload.toolUseId);
        break;
      case 'boundary_probe':
        pending.push(e.payload.toolUseId);
        break;
      case 'assistant_message': {
        const explicit = e.payload.toolUseIds;
        let ids: string[];
        let groupingInferred: boolean;
        if (explicit !== undefined) {
          ids = explicit;
          groupingInferred = false;
        } else {
          ids = pending.slice();
          pending.length = 0;
          groupingInferred = ids.length > 0;
        }
        const items = ids.map(buildItem).filter((x): x is CallNode => x !== null);
        entries.push({
          kind: 'assistant_turn',
          seq: e.seq,
          text: e.payload.text,
          thinking: e.payload.thinking ?? null,
          billed: e.payload.billed,
          items,
          groupingInferred,
        });
        break;
      }
      case 'commit':
        entries.push({ kind: 'commit', seq: e.seq, payload: e.payload as EventPayloads['commit'] });
        break;
      case 'budget_exhausted':
        entries.push({ kind: 'budget_exhausted', seq: e.seq, payload: e.payload as EventPayloads['budget_exhausted'] });
        break;
      case 'harness_error':
        entries.push({ kind: 'harness_error', seq: e.seq, payload: e.payload as EventPayloads['harness_error'] });
        break;
      case 'run_ended':
        entries.push({ kind: 'run_ended', seq: e.seq, payload: e.payload as EventPayloads['run_ended'] });
        break;
      default:
        break; // run_started, tool_result are consumed via the indexes above
    }
  }

  // Anything never claimed by a turn — a run that crashed between logging a
  // tool_use and the assistant_message that would have listed it, most
  // often — still has to show up somewhere: it's exactly the kind of signal
  // this instrument exists to never silently drop.
  const strandedIds = pending.filter((id) => !claimed.has(id));
  if (strandedIds.length > 0) {
    const items = strandedIds.map(buildItem).filter((x): x is CallNode => x !== null);
    const seq = Math.max(...events.map((e) => e.seq));
    entries.push({ kind: 'unattributed_activity', seq, items });
  }

  entries.sort((a, b) => a.seq - b.seq);
  return entries;
}
