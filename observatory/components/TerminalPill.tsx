export function TerminalPill({ reason, inProgress, crashed }: { reason: string | null; inProgress: boolean; crashed: boolean }) {
  if (inProgress && !crashed) return <span className="pill pill--progress">In progress</span>;
  if (crashed) return <span className="pill pill--error">Harness error</span>;
  if (reason === 'voluntary_stop') return <span className="pill pill--stop">Voluntary stop</span>;
  if (reason === 'budget_exhausted') return <span className="pill pill--exhausted">Budget exhausted</span>;
  if (reason === 'harness_error') return <span className="pill pill--error">Harness error</span>;
  return <span className="pill pill--done">{reason?.replace('_', ' ') ?? 'ended'}</span>;
}
