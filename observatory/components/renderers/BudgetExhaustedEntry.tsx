import { formatCompact } from '@/lib/format';
import type { BudgetExhaustedNode } from '@/lib/transcript';

export function BudgetExhaustedEntry({ node }: { node: BudgetExhaustedNode }) {
  return (
    <div className="turn turn--budget_exhausted">
      <div className="kind">
        <span className="pill pill--exhausted">Budget exhausted</span>
      </div>
      <p style={{ margin: '0.3rem 0' }}>
        {formatCompact(node.payload.billedTokens)} billed against a {formatCompact(node.payload.budgetTokens)} token budget.
      </p>
    </div>
  );
}
