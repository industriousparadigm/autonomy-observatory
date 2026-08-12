/**
 * One wake, told as what it did rather than as a row of numbers: what it
 * wrote, how its calls went, what it opened with, what it said before it
 * stopped, and anything that stands out against the same arm's earlier runs.
 *
 * Every line is a count or a quotation from that run's events. Where a fact
 * is missing from the log, the card says it is missing instead of leaving a
 * gap that reads as a zero.
 */

import Link from 'next/link';
import { TerminalPill } from './TerminalPill';
import { Quote } from './Quote';
import { describeCalls, describeOpening } from './DerivedFigures';
import type { DigestEntry } from '@/lib/digest';
import { formatCompact, formatWallClock } from '@/lib/format';

function wroteText(entry: DigestEntry): string {
  const { recorded } = entry.metrics;
  if (recorded.commitCount === 0) return recorded.inProgress ? 'nothing committed yet' : 'nothing';
  const files = recorded.changedFiles;
  const shown = files.slice(0, 4).join(', ');
  const more = files.length > 4 ? ` and ${files.length - 4} more` : '';
  return `${shown || `${recorded.filesChanged} files`}${more} (+${recorded.insertions} / -${recorded.deletions})`;
}

function wordsText(entry: DigestEntry): string {
  const { work, bookkeeping } = entry.metrics.words;
  if (work === 0 && bookkeeping === 0) return 'no added lines to count';
  return `${work.toLocaleString('en-US')} work, ${bookkeeping.toLocaleString('en-US')} bookkeeping`;
}

function budgetText(entry: DigestEntry): string {
  const { recorded, budgetShare } = entry.metrics;
  if (budgetShare === null) return `${formatCompact(recorded.billedTokens)} billed, no budget recorded`;
  return `${Math.round(budgetShare * 100)}% of ${formatCompact(recorded.budgetTokens ?? 0)}`;
}

export function RunDigestCard({ entry, showArm = true }: { entry: DigestEntry; showArm?: boolean }) {
  const { arm, metrics, anomalies } = entry;
  const { recorded } = metrics;
  const alert = anomalies.some((a) => a.severity === 'alert');
  const href = `/${arm.id}/runs/${metrics.run}`;

  return (
    <article className={`digest-card${alert ? ' digest-card--alert' : ''}`}>
      <div className="digest-head">
        <Link href={href} className="run-link">
          {showArm ? `${arm.label} · run ${metrics.run}` : `Run ${metrics.run}`}
        </Link>
        <TerminalPill reason={recorded.terminalReason} inProgress={recorded.inProgress} crashed={recorded.crashed} />
        <span className="digest-when">{recorded.startedAt ? formatWallClock(recorded.startedAt) : 'no start time recorded'}</span>
      </div>

      {anomalies.length > 0 ? (
        <ul className="anomaly-list">
          {anomalies.map((a) => (
            <li key={a.key}>
              <span className={`anomaly-mark anomaly-mark--${a.severity}`}>{a.severity === 'alert' ? 'Flag' : 'Note'}</span>
              <span>{a.text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="digest-facts">
        <div>
          <dt>Wrote</dt>
          <dd className="mono">{wroteText(entry)}</dd>
        </div>
        <div>
          <dt>Words added</dt>
          <dd>{wordsText(entry)}</dd>
        </div>
        <div>
          <dt>Tool calls</dt>
          <dd>{describeCalls(metrics.calls)}</dd>
        </div>
        <div>
          <dt>Opened with</dt>
          <dd>{describeOpening(metrics.firstCall)}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{budgetText(entry)}</dd>
        </div>
      </dl>

      <div className="digest-said">
        <span className="fact-label">Said before stopping</span>
        {metrics.closingText ? <Quote text={metrics.closingText} limit={300} /> : <p className="files-preview">No closing text was recorded for this run.</p>}
      </div>
    </article>
  );
}
