import { Header } from '@/components/Header';
import { BudgetChart } from '@/components/BudgetChart';
import { loadBudgetAllocation } from '@/lib/budget';

export const dynamic = 'force-dynamic';

export default async function BudgetPage() {
  const { allocations, corruptLines, logExists } = await loadBudgetAllocation();

  return (
    <>
      <Header active="budget" />
      <div className="shell">
        <h1>Budget allocation over time</h1>
        <p className="page-sub">
          Proportional spend by activity category, per run. A turn that calls no tool — and any tool name this app doesn&apos;t recognize yet —
          lands in &ldquo;Uncategorized&rdquo; rather than being dropped; see the mapping in <code>lib/categories.ts</code>.
        </p>

        {corruptLines > 0 ? (
          <div className="callout callout--warn">
            <span className="lbl">Log warning</span>
            {corruptLines} line{corruptLines === 1 ? '' : 's'} failed to parse and {corruptLines === 1 ? 'was' : 'were'} skipped.
          </div>
        ) : null}

        {!logExists || allocations.length === 0 ? (
          <div className="empty-state">
            <h2>No token usage yet</h2>
            <p>This chart populates once the first run has billed some tokens.</p>
          </div>
        ) : (
          <div className="chart-wrap">
            <BudgetChart allocations={allocations} />
          </div>
        )}
      </div>
    </>
  );
}
