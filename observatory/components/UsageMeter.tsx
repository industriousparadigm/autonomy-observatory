import { formatCompact } from '@/lib/format';

export function UsageMeter({ billed, budget }: { billed: number; budget: number | null }) {
  if (budget === null || budget === 0) {
    return <span className="meter-label num">{formatCompact(billed)} billed</span>;
  }
  const fraction = billed / budget;
  const pct = Math.min(fraction, 1) * 100;
  const color = fraction >= 1 ? 'var(--critical)' : fraction >= 0.7 ? 'var(--warning)' : 'var(--accent)';
  return (
    <div className="meter" title={`${formatCompact(billed)} of ${formatCompact(budget)} tokens (${Math.round(fraction * 100)}%)`}>
      <div className="track">
        <div className="fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="label">
        {formatCompact(billed)} / {formatCompact(budget)}
      </span>
    </div>
  );
}
