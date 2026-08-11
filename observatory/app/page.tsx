import Link from 'next/link';
import { Header } from '@/components/Header';
import { discoverArms, findArm } from '@/lib/arms';
import { loadArmStats, isolationLabel, TERMINAL_MIX_LABEL, TERMINAL_MIX_PILL_CLASS } from '@/lib/compare';
import { formatCompact, formatUsd } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ComparePage() {
  const arms = discoverArms();

  if (arms.length === 0) {
    return (
      <>
        <Header active="compare" arms={arms} currentArm={null} />
        <div className="shell">
          <h1>Compare arms</h1>
          <div className="empty-state">
            <h2>No arms found</h2>
            <p>
              Nothing under <code>LOGS_DIR</code> and no <code>arms/*.yaml</code> readable from here.
            </p>
          </div>
        </div>
      </>
    );
  }

  const stats = await Promise.all(arms.map(loadArmStats));
  const baseline = findArm(arms, 'a') ?? arms[0] ?? null;

  return (
    <>
      <Header active="compare" arms={arms} currentArm={null} />
      <div className="shell">
        <h1>Compare arms</h1>
        <p className="page-sub">
          Every arm runs the same harness against the same question — what does it do with unstructured time — with exactly one thing changed per
          arm. Differences here are the experiment; a single arm's numbers mean nothing without this page.
        </p>

        <div className="panel" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Arm</th>
                <th>Isolates</th>
                <th>Model</th>
                <th>Tools</th>
                <th>Runs</th>
                <th>Avg tokens/run</th>
                <th>Est. cost</th>
                <th>Boundary probes</th>
                <th>Terminal reasons</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(({ arm, runCount, avgBilled, totalCost, boundaryProbeTotal, terminalMix }) => (
                <tr key={arm.id}>
                  <td>
                    <Link href={`/${arm.id}`} className="run-link">
                      {arm.label}
                    </Link>
                    {!arm.hasLog ? <div className="tool-summary-meta">no runs yet</div> : null}
                  </td>
                  <td className="files-preview">{isolationLabel(arm, baseline)}</td>
                  <td className="files-preview">{arm.model ?? '—'}</td>
                  <td className="files-preview">{arm.tools ? arm.tools.join(', ') : '—'}</td>
                  <td className="num">{runCount}</td>
                  <td className="num">{runCount > 0 ? formatCompact(avgBilled) : '—'}</td>
                  <td className="num">{runCount > 0 ? formatUsd(totalCost) : '—'}</td>
                  <td className="num">{boundaryProbeTotal}</td>
                  <td>
                    {terminalMix.length === 0 ? (
                      <span className="files-preview">—</span>
                    ) : (
                      <div className="pill-row">
                        {terminalMix.map(({ key, count }) => (
                          <span key={key} className={`pill ${TERMINAL_MIX_PILL_CLASS[key]}`}>
                            {count} {TERMINAL_MIX_LABEL[key]}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="page-sub" style={{ marginTop: '1rem' }}>
          &ldquo;Isolates&rdquo; states the one mechanic that differs from the baseline (arm A) for that row — the whole point of holding everything
          else constant. See <Link href="/a">arm A&apos;s timeline</Link> for the baseline itself.
        </p>
      </div>
    </>
  );
}
