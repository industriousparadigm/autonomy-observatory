/**
 * The renderer registry. Every node the transcript can produce (see
 * lib/transcript.ts) is looked up here for the component that draws it —
 * this is the one place that decides "what does a Read call look like",
 * "what does a boundary probe look like", and so on.
 *
 * How to add a renderer for a new case (a new tool, or a payload shape
 * within an existing tool that deserves its own treatment):
 *
 *   1. Write a component that takes `{ node }` and returns JSX. Put it in
 *      this directory. Look at ReadCall.tsx or WriteCall.tsx for the shape:
 *      a one-line plain-language summary by default, with a <details> for
 *      anything raw/bulky (ToolCallShell already gives you the raw-JSON
 *      disclosure for free for tool calls — pass it a `summary` and
 *      optionally a `detail`).
 *   2. Add one entry to REGISTRY below, above the generic fallback. `match`
 *      decides when it applies — check `node.kind`, and for tool calls,
 *      `node.toolName` and/or the actual input/output shape (see
 *      lib/tool-schemas.ts for typed readers that return null on a
 *      mismatch instead of throwing).
 *   3. First match in the array wins, so put narrower matches before
 *      broader ones. `tool-generic` matches every tool_call and must stay
 *      last, or it will shadow every dedicated tool renderer after it.
 *
 * Nothing here should ever fall through to "no entry matched" — every
 * RenderableNode kind that lib/transcript.ts produces has exactly one
 * catch-all entry (tool-generic for tool calls; one entry each for the six
 * other kinds), so renderNode() returning null is a bug, not an expected
 * path.
 */

import type { ReactNode } from 'react';
import { formatCompact } from '@/lib/format';
import type {
  AssistantTurnNode,
  BoundaryProbeNode,
  BudgetExhaustedNode,
  CommitNode,
  HarnessErrorNode,
  RenderableNode,
  RunEndedNode,
  ToolCallNode,
  UnattributedNode,
} from '@/lib/transcript';
import { ReadCall } from './ReadCall';
import { WriteCall } from './WriteCall';
import { EditCall } from './EditCall';
import { GenericToolCall } from './GenericToolCall';
import { BoundaryProbeCall } from './BoundaryProbeCall';
import { CommitEntry } from './CommitEntry';
import { BudgetExhaustedEntry } from './BudgetExhaustedEntry';
import { HarnessErrorEntry } from './HarnessErrorEntry';
import { RunEndedEntry } from './RunEndedEntry';

/** One assistant turn: its text, its summarised reasoning if the model returned any, and the calls it issued, nested. */
function AssistantTurn({ node }: { node: AssistantTurnNode }) {
  return (
    <div className="turn turn--assistant">
      <div className="kind">
        Assistant · {formatCompact(node.billed)} tokens billed
        {node.groupingInferred ? (
          <span
            className="inferred-badge"
            title="This run predates assistant_message.toolUseIds. The calls below are grouped by their position in the log, not an explicit link."
          >
            ordering inferred
          </span>
        ) : null}
      </div>
      {node.thinking ? (
        <details className="thinking-block">
          <summary>Summarised reasoning</summary>
          <div className="body-text thinking-text">{node.thinking}</div>
        </details>
      ) : null}
      <div className="body-text">{node.text || <em>(no text — tool calls only)</em>}</div>
      {node.items.length > 0 ? <div className="turn-items">{node.items.map((item, i) => renderNode(item, item.toolUseId ?? i))}</div> : null}
    </div>
  );
}

/** Tool calls or probes that never got claimed by a turn — almost always a run that crashed mid-call. Shown, not dropped. */
function UnattributedActivity({ node }: { node: UnattributedNode }) {
  return (
    <div className="turn turn--unattributed">
      <div className="kind">
        Unattributed activity
        <span className="inferred-badge" title="No assistant_message claimed these calls — most likely the run ended (crash, or budget cutoff) before it could.">
          not linked to a turn
        </span>
      </div>
      <div className="turn-items">{node.items.map((item, i) => renderNode(item, item.toolUseId ?? i))}</div>
    </div>
  );
}

type RegistryEntry = {
  id: string;
  description: string;
  match: (node: RenderableNode) => boolean;
  Component: (props: { node: RenderableNode }) => ReactNode;
};

/** Registers a concretely-typed component under the loosely-typed table; `match` is what actually guarantees the shape at render time. */
function entry<T extends RenderableNode>(id: string, description: string, match: (node: RenderableNode) => node is T, Component: (props: { node: T }) => ReactNode): RegistryEntry {
  return { id, description, match, Component: Component as (props: { node: RenderableNode }) => ReactNode };
}

const isToolCall = (n: RenderableNode): n is ToolCallNode => n.kind === 'tool_call';

const REGISTRY: RegistryEntry[] = [
  entry('tool-read', 'A Read tool call.', (n): n is ToolCallNode => isToolCall(n) && n.toolName === 'Read', ReadCall),
  entry('tool-write', 'A Write tool call.', (n): n is ToolCallNode => isToolCall(n) && n.toolName === 'Write', WriteCall),
  entry('tool-edit', 'An Edit tool call.', (n): n is ToolCallNode => isToolCall(n) && n.toolName === 'Edit', EditCall),
  entry('boundary-probe', 'A denied call outside the workspace/harness/schedule/network boundary.', (n): n is BoundaryProbeNode => n.kind === 'boundary_probe', BoundaryProbeCall),
  entry('commit', 'The end-of-run git commit and its diff.', (n): n is CommitNode => n.kind === 'commit', CommitEntry),
  entry('budget-exhausted', 'The session hit its token budget mid-action.', (n): n is BudgetExhaustedNode => n.kind === 'budget_exhausted', BudgetExhaustedEntry),
  entry('harness-error', 'An uncaught error in the harness process itself.', (n): n is HarnessErrorNode => n.kind === 'harness_error', HarnessErrorEntry),
  entry('run-ended', 'The run_ended summary line.', (n): n is RunEndedNode => n.kind === 'run_ended', RunEndedEntry),
  entry('assistant-turn', 'One assistant turn: text, reasoning, and the calls it issued.', (n): n is AssistantTurnNode => n.kind === 'assistant_turn', AssistantTurn),
  entry('unattributed', 'Calls/probes never claimed by a turn.', (n): n is UnattributedNode => n.kind === 'unattributed_activity', UnattributedActivity),
  // Fallback — must stay last. Matches any tool call not caught by a dedicated renderer above.
  entry('tool-generic', 'Any tool without a dedicated renderer above.', isToolCall, GenericToolCall),
];

export function renderNode(node: RenderableNode, key: string | number): ReactNode {
  const match = REGISTRY.find((r) => r.match(node));
  if (!match) return null; // unreachable — see the module doc comment
  const { Component } = match;
  return <Component node={node} key={key} />;
}
