/**
 * The cold-start panel, read one question at a time.
 *
 * The comparison this view exists for is narrow: six arms, identical empty
 * workspaces, and one decision each about what to do with a session nobody
 * gave them a task for. Six columns of prose would be unreadable, so the
 * layout is inverted: one section per question, every arm answering it in
 * turn, so a reader compares down a short list instead of across a wide
 * table.
 *
 * Arms that have not run yet say so in every section. An arm missing from the
 * panel is worth as much as one that answered.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Quote } from './Quote';
import { TerminalPill } from './TerminalPill';
import { describeCalls, describeOpening } from './DerivedFigures';
import type { ColdStartCohort } from '@/lib/digest';
import type { ArmMetrics, RunMetrics } from '@/lib/metrics';
import { formatCompact } from '@/lib/format';

export type PanelPrompt = { sha: string; text: string | null; armIds: string[] };

type Row = { cohortKey: string; metrics: ArmMetrics };

function runOne(metrics: ArmMetrics): RunMetrics | null {
  return metrics.runs.find((r) => r.run === 1) ?? null;
}

function laterRunLine(run: RunMetrics): string {
  const { recorded } = run;
  const changed = recorded.commitCount === 0 ? 'committed nothing' : `${recorded.changedFiles.join(', ')} (+${recorded.insertions} / -${recorded.deletions})`;
  return `${changed}, ${describeCalls(run.calls)}`;
}

function Section({ title, note, rows, render }: { title: string; note: string; rows: Row[]; render: (row: Row) => ReactNode }) {
  return (
    <section className="panel-question">
      <h3>{title}</h3>
      <p className="page-sub">{note}</p>
      <div className="panel-rows">
        {rows.map((row) => (
          <div className="panel-row" key={row.metrics.arm.id}>
            <div className="panel-row-arm">
              <Link href={`/${row.metrics.arm.id}`} className="run-link">
                {row.metrics.arm.id}
              </Link>
              <span className="cohort-tag">{row.cohortKey}</span>
            </div>
            <div className="panel-row-body">{render(row)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function NotYet() {
  return <span className="files-preview">Has not run yet.</span>;
}

export function ColdStartPanel({ cohorts, prompts }: { cohorts: ColdStartCohort[]; prompts: PanelPrompt[] }) {
  const rows: Row[] = cohorts.flatMap((c) => c.arms.map((metrics) => ({ cohortKey: c.key, metrics })));

  return (
    <>
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Arm</th>
              <th>Prompt variant in its config</th>
              <th>Runs recorded</th>
              <th>Latest outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const latest = row.metrics.runs[row.metrics.runs.length - 1];
              return (
                <tr key={row.metrics.arm.id}>
                  <td>
                    <Link href={`/${row.metrics.arm.id}`} className="run-link">
                      {row.metrics.arm.id}
                    </Link>
                  </td>
                  <td className="files-preview">{row.metrics.arm.promptVariant ?? 'no config readable'}</td>
                  <td className="num">
                    {row.metrics.readError
                      ? 'log unreadable'
                      : row.metrics.arm.maxRuns !== null
                        ? `${row.metrics.runs.length} of ${row.metrics.arm.maxRuns}`
                        : row.metrics.runs.length}
                  </td>
                  <td>
                    {latest ? (
                      <TerminalPill reason={latest.recorded.terminalReason} inProgress={latest.recorded.inProgress} crashed={latest.recorded.crashed} />
                    ) : (
                      <span className="files-preview">nothing yet</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Section
        title="What it did first"
        note="The first tool call of run 1, and the outcome the log records for it. Run 1 starts from an empty directory, so this is the first thing it decided to do about that."
        rows={rows}
        render={(row) => {
          const first = runOne(row.metrics);
          if (!first) return <NotYet />;
          return <span className="mono">{describeOpening(first.firstCall)}</span>;
        }}
      />

      <Section
        title="What it was thinking when it started"
        note="The first reasoning recorded in run 1, or its first narration where no reasoning was captured. Quoted verbatim."
        rows={rows}
        render={(row) => {
          const first = runOne(row.metrics);
          if (!first) return <NotYet />;
          return first.openingThought ? <Quote text={first.openingThought} limit={520} /> : <span className="files-preview">No reasoning or narration was recorded.</span>;
        }}
      />

      <Section
        title="What run 1 left in the workspace"
        note="Files touched by run 1's commits, with lines added and removed, and the split between work and bookkeeping words."
        rows={rows}
        render={(row) => {
          const first = runOne(row.metrics);
          if (!first) return <NotYet />;
          if (first.recorded.commitCount === 0) return <span className="files-preview">Committed nothing.</span>;
          return (
            <>
              <div className="mono">
                {first.recorded.changedFiles.join(', ')} (+{first.recorded.insertions} / -{first.recorded.deletions})
              </div>
              <div className="files-preview">
                {first.words.work.toLocaleString('en-US')} work words, {first.words.bookkeeping.toLocaleString('en-US')} bookkeeping
              </div>
            </>
          );
        }}
      />

      <Section
        title="What it said before it stopped"
        note="The last text run 1 produced. This is where an arm states, in its own words, why it did what it did."
        rows={rows}
        render={(row) => {
          const first = runOne(row.metrics);
          if (!first) return <NotYet />;
          return first.closingText ? <Quote text={first.closingText} limit={520} /> : <span className="files-preview">No closing text was recorded.</span>;
        }}
      />

      <Section
        title="What run 1 cost, and how its calls went"
        note="Billed tokens against the budget the run was started with, and the tally of tool calls."
        rows={rows}
        render={(row) => {
          const first = runOne(row.metrics);
          if (!first) return <NotYet />;
          return (
            <span>
              {first.budgetShare === null
                ? `${formatCompact(first.recorded.billedTokens)} billed, no budget recorded`
                : `${Math.round(first.budgetShare * 100)}% of ${formatCompact(first.recorded.budgetTokens ?? 0)} tokens`}
              {' · '}
              {describeCalls(first.calls)}
            </span>
          );
        }}
      />

      <Section
        title="Whether run 1's choice held"
        note="Runs 2 and 3, one line each. The panel stops after three: past that it measures how well run 1's handover note travels, not what the arm chose."
        rows={rows}
        render={(row) => {
          const later = row.metrics.runs.filter((r) => r.run > 1);
          if (row.metrics.runs.length === 0) return <NotYet />;
          if (later.length === 0) return <span className="files-preview">Only run 1 so far.</span>;
          return (
            <ul className="plain-list">
              {later.map((r) => (
                <li key={r.run}>
                  <Link href={`/${row.metrics.arm.id}/runs/${r.run}`} className="run-link">
                    Run {r.run}
                  </Link>
                  <span className="files-preview"> {laterRunLine(r)}</span>
                </li>
              ))}
            </ul>
          );
        }}
      />

      <h3>The prompts these arms were given</h3>
      <p className="page-sub">
        Taken from the run_started events themselves, deduplicated by the hash the harness records with them. This is the only thing that differs
        across the panel.
      </p>
      {prompts.length === 0 ? (
        <p className="files-preview">No run has started yet, so no prompt has been recorded.</p>
      ) : (
        prompts.map((p) => (
          <div key={p.sha} className="prompt-block">
            <div className="prompt-block-head">
              <span className="fact-label">{p.armIds.join(', ')}</span>
              <code className="digest-when">{p.sha.slice(0, 12)}</code>
            </div>
            {p.text ? (
              <pre className="wake-message">{p.text}</pre>
            ) : (
              <p className="files-preview">These runs recorded the prompt&rsquo;s hash but not its text, so it cannot be shown here.</p>
            )}
          </div>
        ))
      )}
    </>
  );
}
