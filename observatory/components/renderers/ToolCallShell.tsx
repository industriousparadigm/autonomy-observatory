import type { ReactNode } from 'react';
import { categoryForTool } from '@/lib/categories';
import { prettyValue } from '@/lib/format';
import type { ToolCallNode } from '@/lib/transcript';

/**
 * The one shape every tool-call renderer shares: a colored tool-name label,
 * a plain-language one-line summary, an optional richer detail block (a
 * diff, say), and the raw event data behind a disclosure — never shown by
 * default. This is what turns "request JSON, then a second receipt JSON
 * repeating the same content" into one entry.
 */
export function ToolCallShell({ node, summary, detail }: { node: ToolCallNode; summary: ReactNode; detail?: ReactNode }) {
  const category = categoryForTool(node.toolName);
  const status = node.outcome === null ? 'pending' : node.outcome.ok ? 'ok' : 'failed';

  return (
    <div className="turn turn--tool_call">
      <div className="kind" style={{ color: `var(--cat-${category})` }}>
        {node.toolName}
        {status === 'failed' ? <span className="result-fail"> · failed</span> : null}
        {status === 'pending' ? <span className="tool-summary-meta"> · no result recorded</span> : null}
      </div>
      <div className="tool-summary">{summary}</div>
      {detail}
      <details className="tool-raw">
        <summary>Raw event data</summary>
        <pre>{prettyValue({ input: node.input, outcome: node.outcome })}</pre>
      </details>
    </div>
  );
}
