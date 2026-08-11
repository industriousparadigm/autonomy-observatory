import path from 'node:path';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { RunFlags, isFlagged } from '@/components/Pills';
import { UsageMeter } from '@/components/UsageMeter';
import { RunRow } from '@/components/RunRow';
import { LinkPendingDot } from '@/components/LinkPendingDot';
import { loadRunSummaries } from '@/lib/runs';
import { eventLogPath } from '@/lib/log';
import { discoverArms, findArm } from '@/lib/arms';
import { formatElapsedGap, formatWallClock, truncate } from '@/lib/format';

export const dynamic = 'force-dynamic';

type FilterKey = 'all' | 'probes' | 'stops' | 'exhausted' | 'errors' | 'in_progress';

function changesSummary(run: { commitCount: number; filesChanged: number; insertions: number; deletions: number; changedFiles: string[] }): string {
  if (run.commitCount === 0) return 'no workspace changes';
  const files = run.changedFiles.slice(0, 3).map((f) => f.split('/').pop()).join(', ');
  const more = run.changedFiles.length > 3 ? ` +${run.changedFiles.length - 3} more` : '';
  return `${files}${more} (+${run.insertions}/-${run.deletions})`;
}

export default async function TimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ arm: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { arm: armId } = await params;
  const { filter: filterParam } = await searchParams;
  const filter = (filterParam ?? 'all') as FilterKey;

  const arms = discoverArms();
  const arm = findArm(arms, armId);
  if (!arm) notFound();

  const logPath = eventLogPath(armId);
  const { runs, corruptLines, logExists } = await loadRunSummaries(logPath);

  const counts = {
    all: runs.length,
    probes: runs.filter((r) => r.boundaryProbeCount > 0).length,
    stops: runs.filter((r) => r.terminalReason === 'voluntary_stop').length,
    exhausted: runs.filter((r) => r.budgetExhausted || r.terminalReason === 'budget_exhausted').length,
    errors: runs.filter((r) => r.crashed || r.terminalReason === 'harness_error').length,
    in_progress: runs.filter((r) => r.inProgress && !r.crashed).length,
  };

  const filtered = runs.filter((r) => {
    switch (filter) {
      case 'probes':
        return r.boundaryProbeCount > 0;
      case 'stops':
        return r.terminalReason === 'voluntary_stop';
      case 'exhausted':
        return r.budgetExhausted || r.terminalReason === 'budget_exhausted';
      case 'errors':
        return r.crashed || r.terminalReason === 'harness_error';
      case 'in_progress':
        return r.inProgress && !r.crashed;
      default:
        return true;
    }
  });

  const chips: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'probes', label: 'Boundary probes' },
    { key: 'stops', label: 'Voluntary stops' },
    { key: 'exhausted', label: 'Budget exhausted' },
    { key: 'errors', label: 'Harness errors' },
    { key: 'in_progress', label: 'In progress' },
  ];

  return (
    <>
      <Header active="timeline" arms={arms} currentArm={arm} meta={logExists ? `${runs.length} runs · ${path.basename(logPath)}` : path.basename(logPath)} />
      <div className="shell">
        <h1>Run timeline · {arm.label}</h1>
        <p className="page-sub">Every wake, newest first. Boundary probes and voluntary stops are flagged red/amber — everything else is a normal run finishing on schedule.</p>

        {corruptLines > 0 ? (
          <div className="callout callout--warn">
            <span className="lbl">Log warning</span>
            {corruptLines} line{corruptLines === 1 ? '' : 's'} in the event log failed to parse and {corruptLines === 1 ? 'was' : 'were'} skipped.
          </div>
        ) : null}

        {!logExists ? (
          <div className="empty-state">
            <h2>No runs yet</h2>
            <p>
              Waiting on <code>{logPath}</code>. This view will populate the moment run 1 wakes.
            </p>
          </div>
        ) : runs.length === 0 ? (
          <div className="empty-state">
            <h2>Log exists, no runs recorded</h2>
            <p>The event log at {logPath} is empty so far.</p>
          </div>
        ) : (
          <>
            <div className="filters">
              {chips.map((c) => (
                <Link key={c.key} href={c.key === 'all' ? `/${armId}` : `/${armId}?filter=${c.key}`} className={filter === c.key ? 'active' : ''}>
                  {c.label}
                  <span className="count">{counts[c.key]}</span>
                </Link>
              ))}
            </div>

            <div className="panel" style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Started</th>
                    <th>Gap</th>
                    <th>Tokens</th>
                    <th>Terminal</th>
                    <th>Workspace changes</th>
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((run) => (
                    <RunRow key={`${run.arm}-${run.run}`} href={`/${armId}/runs/${run.run}`} className={isFlagged(run) ? 'flag' : undefined}>
                      <td>
                        <Link href={`/${armId}/runs/${run.run}`} className="run-link">
                          #{run.run}
                          <LinkPendingDot />
                        </Link>
                      </td>
                      <td className="num">{run.startedAt ? formatWallClock(run.startedAt) : '—'}</td>
                      <td className="num">{formatElapsedGap(run.elapsedMs)}</td>
                      <td>
                        <UsageMeter billed={run.billedTokens} budget={run.budgetTokens} />
                      </td>
                      <td>{run.inProgress ? (run.crashed ? 'crashed' : 'running') : run.terminalReason?.replace('_', ' ')}</td>
                      <td className="files-preview">{truncate(changesSummary(run), 70)}</td>
                      <td>
                        <RunFlags run={run} />
                      </td>
                    </RunRow>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 ? <p className="page-sub">No runs match this filter.</p> : null}
          </>
        )}
      </div>
    </>
  );
}
