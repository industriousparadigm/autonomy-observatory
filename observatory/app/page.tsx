import Link from 'next/link';
import { Header } from '@/components/Header';
import { RunDigestCard } from '@/components/RunDigestCard';
import { DerivationNote, describeWords } from '@/components/DerivedFigures';
import { discoverArms, findArm } from '@/lib/arms';
import { buildDigest, coldStartCohorts } from '@/lib/digest';
import { failureShare, loadAllArmMetrics } from '@/lib/metrics';
import { isolationLabel, loadArmStats, TERMINAL_MIX_LABEL, TERMINAL_MIX_PILL_CLASS } from '@/lib/compare';

export const dynamic = 'force-dynamic';

/** How many wakes the front page tells the story of before it stops and points at the timelines. */
const DIGEST_LIMIT = 12;

function pct(x: number | null): string {
  return x === null ? '—' : `${Math.round(x * 100)}%`;
}

export default async function DigestPage() {
  const arms = discoverArms();

  if (arms.length === 0) {
    return (
      <>
        <Header active="compare" arms={arms} currentArm={null} />
        <div className="shell">
          <h1>Nothing to report</h1>
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

  const metrics = await loadAllArmMetrics(arms);
  const digest = buildDigest(metrics, new Date(), DIGEST_LIMIT);
  // An arm whose log cannot be read must not take the whole page down with it,
  // and loadArmStats reads the log again for the terminal mix.
  const stats = await Promise.all(arms.map((a) => loadArmStats(a).catch(() => null)));
  const statsById = new Map(stats.filter((s) => s !== null).map((s) => [s.arm.id, s]));
  const baseline = findArm(arms, 'a') ?? arms[0] ?? null;
  const panelArmCount = coldStartCohorts(metrics).reduce((sum, c) => sum + c.arms.length, 0);

  return (
    <>
      <Header active="compare" arms={arms} currentArm={null} meta={`${digest.totalRuns} runs recorded`} />
      <div className="shell">
        <h1>What happened</h1>
        <p className="page-sub">
          Every arm wakes on a schedule with a workspace that survives between sessions, a token budget, and no task. Below are the most recent wakes
          across all arms, newest first, with anything that stands out against that same arm&rsquo;s earlier runs called out on the run it happened in.
          Figures the log does not record are worked out here from events that it does, and each one carries its definition.
        </p>

        {digest.unreadable.length > 0 ? (
          <div className="callout callout--danger">
            <span className="lbl">Logs that could not be read</span>
            {digest.unreadable.map((u) => (
              <div key={u.arm.id}>
                {u.arm.label}: {u.error}
              </div>
            ))}
          </div>
        ) : null}

        {digest.alerts.length > 0 ? (
          <>
            <h2>Worth a look</h2>
            <ul className="alert-list">
              {digest.alerts.map((entry) =>
                entry.anomalies
                  .filter((a) => a.severity === 'alert')
                  .map((a) => (
                    <li key={`${entry.arm.id}-${entry.metrics.run}-${a.key}`}>
                      <Link href={`/${entry.arm.id}/runs/${entry.metrics.run}`} className="run-link">
                        {entry.arm.label} run {entry.metrics.run}
                      </Link>
                      <span> {a.text}</span>
                    </li>
                  )),
              )}
            </ul>
          </>
        ) : null}

        {digest.buckets.length === 0 ? (
          <div className="empty-state">
            <h2>No runs recorded yet</h2>
            <p>Every configured arm has an empty log or none at all. This page fills in the moment the first wake finishes.</p>
          </div>
        ) : (
          digest.buckets.map((bucket) => (
            <section key={bucket.key}>
              <h2>
                {bucket.label}
                <span className="count-note">
                  {bucket.entries.length} run{bucket.entries.length === 1 ? '' : 's'}
                </span>
              </h2>
              <div className="digest-list">
                {bucket.entries.map((entry) => (
                  <RunDigestCard key={`${entry.arm.id}-${entry.metrics.run}`} entry={entry} />
                ))}
              </div>
            </section>
          ))
        )}

        {digest.totalRuns > digest.shownRuns ? (
          <p className="page-sub" style={{ marginTop: '1rem' }}>
            Showing the {digest.shownRuns} most recent of {digest.totalRuns} recorded runs. Older ones are on each arm&rsquo;s timeline.
          </p>
        ) : null}

        {digest.armsWithoutRuns.length > 0 ? (
          <p className="page-sub">
            Configured with no wake recorded so far: {digest.armsWithoutRuns.map((a) => a.label).join(', ')}.
          </p>
        ) : null}

        {panelArmCount > 0 ? (
          <>
            <h2>The cold start panel</h2>
            <p className="page-sub">
              {panelArmCount} short arms started from an identical empty workspace, each stopping after a fixed number of runs, differing only in what
              their system prompt says about persistence. What each one independently decided to do with run 1 is the live experiment.{' '}
              <Link href="/cold-start">Open the panel</Link>.
            </p>
          </>
        ) : null}

        <h2>Compare arms</h2>
        <p className="page-sub">
          One thing changes per arm and everything else is held constant, so a difference in these columns is attributable to the change named under
          &ldquo;isolates&rdquo;. A single arm&rsquo;s numbers mean little without this table.
        </p>

        <div className="panel" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Arm</th>
                <th>Isolates</th>
                <th>Runs</th>
                <th>Failed calls</th>
                <th>Budget used</th>
                <th>Work : bookkeeping</th>
                <th>Boundary probes</th>
                <th>Terminal reasons</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const arm = m.arm;
                const terminalMix = statsById.get(arm.id)?.terminalMix ?? [];
                const words = m.readError === null ? describeWords(m.words) : null;
                return (
                  <tr key={arm.id}>
                    <td>
                      <Link href={`/${arm.id}`} className="run-link">
                        {arm.label}
                      </Link>
                      <div className="tool-summary-meta">{arm.id}</div>
                    </td>
                    <td className="files-preview">{isolationLabel(arm, baseline)}</td>
                    <td className="num">{m.readError ? 'unreadable' : m.runs.length}</td>
                    <td className="num">
                      {m.calls.total > 0 ? (
                        <>
                          {pct(failureShare(m.calls))}
                          <div className="tool-summary-meta">
                            {m.calls.failed + m.calls.unanswered} of {m.calls.total}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{m.readError ? '—' : pct(m.meanBudgetShare)}</td>
                    <td className="num">
                      {words ? (
                        <>
                          {words.value}
                          <div className="tool-summary-meta">{words.sub}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{m.readError ? '—' : m.probeTotal}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>

        <DerivationNote keys={['calls', 'budget', 'words', 'opening', 'closing']} />
      </div>
    </>
  );
}
