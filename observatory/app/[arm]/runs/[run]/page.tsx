import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { UsageMeter } from '@/components/UsageMeter';
import { TerminalPill } from '@/components/TerminalPill';
import { FileModalProvider } from '@/components/FileModal';
import { RunSummaryPanel } from '@/components/RunSummaryPanel';
import { renderNode } from '@/components/renderers/registry';
import { loadRunEvents } from '@/lib/runs';
import { eventLogPath } from '@/lib/log';
import { discoverArms, findArm } from '@/lib/arms';
import { buildTranscript } from '@/lib/transcript';
import { deriveRunSummary } from '@/lib/summary';
import { CategoryAccumulator } from '@/lib/budget';
import { CATEGORY_ORDER, CATEGORY_LABEL } from '@/lib/categories';
import type { RunEvent } from '@/lib/events';
import { formatWallClock, formatElapsedGap, formatDuration, formatUsd, formatCompact } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function RunDetailPage({ params }: { params: Promise<{ arm: string; run: string }> }) {
  const { arm: armId, run: runParam } = await params;
  const run = Number(runParam);
  if (!Number.isInteger(run)) notFound();

  const arms = discoverArms();
  const arm = findArm(arms, armId);
  if (!arm) notFound();

  const { events } = await loadRunEvents(run, eventLogPath(armId));
  if (events.length === 0) notFound();

  const started = events.find((e) => e.type === 'run_started');
  const ended = events.find((e) => e.type === 'run_ended');
  const crashed = !ended && events.some((e) => e.type === 'harness_error');
  const inProgress = !ended;

  const billedSoFar = ended
    ? (ended.payload as RunEvent<'run_ended'>['payload']).billed
    : events.filter((e) => e.type === 'assistant_message').reduce((sum, e) => sum + (e.payload as RunEvent<'assistant_message'>['payload']).billed, 0);

  const acc = new CategoryAccumulator();
  for (const e of events) acc.push(e);
  acc.finish();

  const wake = started?.payload as RunEvent<'run_started'>['payload'] | undefined;
  const transcript = buildTranscript(events);
  const summary = deriveRunSummary(transcript);

  return (
    <>
      <Header active="run-detail" arms={arms} currentArm={arm} />
      <div className="shell">
        <p>
          <Link href={`/${armId}`}>← {arm.label} timeline</Link>
        </p>
        <h1>
          Run #{run} <TerminalPill reason={ended ? (ended.payload as RunEvent<'run_ended'>['payload']).terminalReason : null} inProgress={inProgress} crashed={crashed} />
        </h1>
        <p className="page-sub">
          {wake ? formatWallClock(started!.ts) : ''} {wake?.elapsedMs != null ? `· ${formatElapsedGap(wake.elapsedMs)} since previous run` : ''}{' '}
          {wake?.model ? `· ${wake.model}` : ''} · <Link href={`/${armId}/setup?run=${run}`}>view full wake context</Link>
        </p>

        {inProgress ? (
          <div className="callout">
            <span className="lbl">Status</span>
            This run has no run_ended event yet — still in progress, or the process stopped without logging a terminal event. Showing everything
            captured so far.
          </div>
        ) : null}

        <div className="stat-row">
          <div className="stat">
            <div className="label">Tokens</div>
            <div className="value">
              <UsageMeter billed={billedSoFar} budget={wake?.budgetTokens ?? null} />
            </div>
          </div>
          {ended ? (
            <>
              <div className="stat">
                <div className="label">Turns</div>
                <div className="value">{(ended.payload as RunEvent<'run_ended'>['payload']).turns}</div>
              </div>
              <div className="stat">
                <div className="label">Duration</div>
                <div className="value">{formatDuration((ended.payload as RunEvent<'run_ended'>['payload']).durationMs)}</div>
              </div>
              <div className="stat">
                <div className="label">Est. cost</div>
                <div className="value">{formatUsd((ended.payload as RunEvent<'run_ended'>['payload']).estimatedCostUsd)}</div>
              </div>
            </>
          ) : null}
        </div>

        <div className="legend" style={{ marginBottom: '1.8rem' }}>
          {CATEGORY_ORDER.filter((c) => acc.totals[c] > 0).map((c) => (
            <span className="item" key={c}>
              <span className="swatch" style={{ background: `var(--cat-${c})` }} />
              {CATEGORY_LABEL[c]} · {formatCompact(acc.totals[c])}
            </span>
          ))}
        </div>

        <FileModalProvider>
          <RunSummaryPanel summary={summary} />

          <h2>Wake message</h2>
          <pre className="wake-message">{wake?.wakeMessage ?? '(no run_started event recorded for this run)'}</pre>

          <h2>Transcript</h2>
          {transcript.some((n) => n.kind === 'assistant_turn' && n.groupingInferred) ? (
            <p className="note">
              This run predates the link between a turn and the calls it issued, so calls are
              grouped by their position in the log. Some of this run&rsquo;s tool calls were also
              never recorded. Runs from 11 Aug carry the full record.
            </p>
          ) : null}
          <div className="transcript">{transcript.map((node) => renderNode(node, node.seq))}</div>
        </FileModalProvider>
      </div>
    </>
  );
}
