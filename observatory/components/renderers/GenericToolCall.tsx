import { describeGenericInput } from '@/lib/tool-schemas';
import { ToolCallShell } from './ToolCallShell';
import type { ToolCallNode } from '@/lib/transcript';

/**
 * The catch-all for any tool name without a dedicated renderer (Bash,
 * WebSearch, WebFetch, Grep, Glob, an MCP tool, or anything added to an arm
 * later). Still one plain line by default — recognizing a handful of common
 * field names (command/query/url/pattern/path) — with the untouched JSON
 * behind the same disclosure every renderer uses. This is the fallback the
 * registry reaches for when nothing more specific matches; see registry.tsx.
 */
export function GenericToolCall({ node }: { node: ToolCallNode }) {
  const description = describeGenericInput(node.input);
  const summary = (
    <>
      {node.toolName.toLowerCase()}
      {description ? <>: {description}</> : null}
    </>
  );
  return <ToolCallShell node={node} summary={summary} />;
}
