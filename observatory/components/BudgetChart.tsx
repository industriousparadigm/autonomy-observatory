import { CATEGORY_ORDER, CATEGORY_LABEL, type ActivityCategory } from '@/lib/categories';
import type { RunAllocation } from '@/lib/budget';
import { formatCompact } from '@/lib/format';

const W = 1000;
const H = 340;
const MARGIN = { top: 16, right: 16, bottom: 32, left: 44 };
const PLOT_W = W - MARGIN.left - MARGIN.right;
const PLOT_H = H - MARGIN.top - MARGIN.bottom;

const CAT_VAR: Record<ActivityCategory, string> = {
  reading: 'var(--cat-reading)',
  writing: 'var(--cat-writing)',
  searching: 'var(--cat-searching)',
  shell: 'var(--cat-shell)',
  messaging: 'var(--cat-messaging)',
  uncategorized: 'var(--cat-uncategorized)',
};

function xAt(i: number, n: number): number {
  if (n <= 1) return MARGIN.left;
  return MARGIN.left + (i / (n - 1)) * PLOT_W;
}

function yAt(p: number): number {
  return MARGIN.top + (1 - p) * PLOT_H;
}

export function BudgetChart({ allocations }: { allocations: RunAllocation[] }) {
  if (allocations.length === 0) {
    return <p className="files-preview">No runs with token usage yet.</p>;
  }

  const n = allocations.length;
  // proportions[i][category] — share of run i's billed tokens in that category
  const proportions = allocations.map((a) => {
    const total = a.totalBilled;
    const p = {} as Record<ActivityCategory, number>;
    for (const c of CATEGORY_ORDER) p[c] = total > 0 ? a.totals[c] / total : 0;
    return p;
  });

  // cumulative[i] = running sum boundaries, one entry per category plus a leading 0
  const cumulative = proportions.map((p) => {
    const cum: number[] = [0];
    for (const c of CATEGORY_ORDER) cum.push(cum[cum.length - 1]! + p[c]);
    return cum;
  });

  const paths = CATEGORY_ORDER.map((cat, catIdx) => {
    const top = cumulative.map((cum) => cum[catIdx + 1]!);
    const bottom = cumulative.map((cum) => cum[catIdx]!);

    let d: string;
    if (n === 1) {
      const x0 = MARGIN.left;
      const x1 = W - MARGIN.right;
      d = `M ${x0},${yAt(top[0]!)} L ${x1},${yAt(top[0]!)} L ${x1},${yAt(bottom[0]!)} L ${x0},${yAt(bottom[0]!)} Z`;
    } else {
      const forward = top.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i, n)},${yAt(p)}`).join(' ');
      const backward = bottom
        .map((_, i) => i)
        .reverse()
        .map((i) => `L ${xAt(i, n)},${yAt(bottom[i]!)}`)
        .join(' ');
      d = `${forward} ${backward} Z`;
    }
    return { cat, d };
  });

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const tickCount = Math.min(6, n);
  const xTickIdx = Array.from(new Set(Array.from({ length: tickCount }, (_, k) => Math.round((k / Math.max(tickCount - 1, 1)) * (n - 1)))));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" aria-label="Budget allocation by activity category over time">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={MARGIN.left} x2={W - MARGIN.right} y1={yAt(t)} y2={yAt(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={MARGIN.left - 8} y={yAt(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--text-faint)">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {paths.map(({ cat, d }) => (
          <path key={cat} d={d} style={{ fill: CAT_VAR[cat] }} stroke="var(--paper)" strokeWidth={1.5}>
            <title>{CATEGORY_LABEL[cat]}</title>
          </path>
        ))}

        <line x1={MARGIN.left} x2={W - MARGIN.right} y1={H - MARGIN.bottom} y2={H - MARGIN.bottom} stroke="var(--border-strong)" strokeWidth={1} />
        {xTickIdx.map((i) => (
          <text key={i} x={xAt(i, n)} y={H - MARGIN.bottom + 18} textAnchor="middle" fontSize={11} fill="var(--text-faint)">
            {allocations[i]!.run}
          </text>
        ))}
        <text x={(MARGIN.left + W - MARGIN.right) / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--text-faint)">
          run number
        </text>
      </svg>

      <div className="legend">
        {CATEGORY_ORDER.map((cat) => (
          <span className="item" key={cat}>
            <span className="swatch" style={{ background: CAT_VAR[cat] }} />
            {CATEGORY_LABEL[cat]}
          </span>
        ))}
      </div>

      <details>
        <summary>Table view (exact billed tokens per run)</summary>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Run</th>
                {CATEGORY_ORDER.map((c) => (
                  <th key={c}>{CATEGORY_LABEL[c]}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a) => (
                <tr key={a.run}>
                  <td className="num">{a.run}</td>
                  {CATEGORY_ORDER.map((c) => (
                    <td className="num" key={c}>
                      {formatCompact(a.totals[c])}
                    </td>
                  ))}
                  <td className="num">{formatCompact(a.totalBilled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
