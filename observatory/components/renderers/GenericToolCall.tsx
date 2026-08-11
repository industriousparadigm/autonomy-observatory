import { describeGenericInput, describeGenericOutput } from '@/lib/tool-schemas';
import { truncate } from '@/lib/format';
import { ToolCallShell } from './ToolCallShell';
import type { ToolCallNode } from '@/lib/transcript';

/**
 * The catch-all for any tool name without a dedicated renderer (Bash,
 * WebSearch, WebFetch, Grep, Glob, an MCP tool, or anything added to an arm
 * later). Shows what it did (input) and what came back (result) as two plain
 * lines by default — recognizing a handful of common field names on each
 * side — with the untouched JSON behind the same disclosure every renderer
 * uses. This is the fallback the registry reaches for when nothing more
 * specific matches; see registry.tsx.
 */
export function GenericToolCall({ node }: { node: ToolCallNode }) {
  const description = describeGenericInput(node.input);
  const resultPreview = node.outcome?.ok ? describeGenericOutput(node.outcome.result) : null;
  const summary = (
    <>
      {node.toolName.toLowerCase()}
      {description ? <>: {description}</> : null}
    </>
  );
  const detail = resultPreview ? (
    <p className="tool-summary tool-summary-meta" style={{ marginTop: '0.4rem' }}>
      → {truncate(resultPreview, 400)}
    </p>
  ) : undefined;
  return <ToolCallShell node={node} summary={summary} detail={detail} />;
}
