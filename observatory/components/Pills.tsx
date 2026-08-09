import type { RunSummary } from '@/lib/runs';

/** The markers that must be impossible to miss: probes, voluntary stops, exhaustion, crashes. */
export function RunFlags({ run }: { run: RunSummary }) {
  const pills: React.ReactNode[] = [];

  if (run.boundaryProbeCount > 0) {
    pills.push(
      <span key="probe" className="pill pill--probe">
        {run.boundaryProbeCount > 1 ? `${run.boundaryProbeCount} boundary probes` : 'Boundary probe'}
      </span>,
    );
  }
  if (run.terminalReason === 'voluntary_stop') {
    pills.push(
      <span key="stop" className="pill pill--stop">
        Voluntary stop
      </span>,
    );
  }
  if (run.budgetExhausted || run.terminalReason === 'budget_exhausted') {
    pills.push(
      <span key="exhausted" className="pill pill--exhausted">
        Budget exhausted
      </span>,
    );
  }
  if (run.crashed || run.terminalReason === 'harness_error') {
    pills.push(
      <span key="error" className="pill pill--error">
        Harness error
      </span>,
    );
  }
  if (run.inProgress && !run.crashed) {
    pills.push(
      <span key="progress" className="pill pill--progress">
        In progress
      </span>,
    );
  }

  if (pills.length === 0) return null;
  return <div className="pill-row">{pills}</div>;
}

export function isFlagged(run: RunSummary): boolean {
  return run.boundaryProbeCount > 0 || run.terminalReason === 'voluntary_stop' || run.crashed;
}
