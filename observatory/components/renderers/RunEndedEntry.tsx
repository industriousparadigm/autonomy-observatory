import { TerminalPill } from '../TerminalPill';
import { formatCompact, formatDuration, formatUsd } from '@/lib/format';
import type { RunEndedNode } from '@/lib/transcript';

export function RunEndedEntry({ node }: { node: RunEndedNode }) {
  const { terminalReason, billed, turns, durationMs, estimatedCostUsd } = node.payload;
  return (
    <div className="turn turn--run_ended">
      <div className="kind">
        Run ended · <TerminalPill reason={terminalReason} inProgress={false} crashed={false} />
      </div>
      <p style={{ margin: '0.3rem 0' }}>
        {formatCompact(billed)} tokens billed over {turns} turns, {formatDuration(durationMs)}, est. {formatUsd(estimatedCostUsd)}.
      </p>
    </div>
  );
}
