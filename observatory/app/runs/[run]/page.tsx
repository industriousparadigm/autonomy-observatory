import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { UsageMeter } from '@/components/UsageMeter';
import { Expandable } from '@/components/Expandable';
import { DiffView } from '@/components/DiffView';
import { loadRunEvents } from '@/lib/runs';
import { CategoryAccumulator } from '@/lib/budget';
import { CATEGORY_ORDER, CATEGORY_LABEL, categoryForTool } from '@/lib/categories';
import type { RunEvent } from '@/lib/events';
import { formatWallClock, formatElapsedGap, formatDuration, formatUsd, formatCompact, prettyValue } from '@/lib/format';

export const dynamic = 'force-dynamic';

function TerminalPill({ reason, inProgress, crashed }: { reason: string | null; inProgress: boolean; crashed: boolean }) {
  if (inProgress && !crashed) return <span className="pill pill--progress">In progress</span>;
  if (crashed) return <span className="pill pill--error">Harness error</span>;
  if (reason === 'voluntary_stop') return <span className="pill pill--stop">Voluntary stop</span>;
  if (reason === 'budget_exhausted') return <span className="pill pill--exhausted">Budget exhausted</span>;
  if (reason === 'harness_error') return <span className="pill pill--error">Harness error</span>;
  return <span className="pill pill--done">{reason?.replace('_', ' ') ?? 'ended'}</span>;
}

function TranscriptTurn({ event }: { event: RunEvent }) {
  switch (event.type) {
    case 'assistant_message':
      return (
        <div className="turn turn--assistant">
          <div className="kind">
            Assistant · {formatCompact(event.payload.billed)} tokens billed
          </div>
          <div className="body-text">{event.payload.text || <em>(no text — tool calls only)</em>}</div>
        </div>
      );
    case 'tool_use':
      return (
        <div className="turn turn--tool_use">
          <div className="kind" style={{ color: `var(--cat-${categoryForTool(event.payload.toolName)})` }}>
            Tool call · {event.payload.toolName}
          </div>
          <Expandable text={prettyValue(event.payload.input)} />
        </div>
      );
    case 'tool_result':
      return (
        <div className="turn">
          <div className="kind">
            Tool result · {event.payload.toolName} ·{' '}
            <span className={event.payload.ok ? 'result-ok' : 'result-fail'}>{event.payload.ok ? 'ok' : 'failed'}</span>
          </div>
          <Expandable text={prettyValue(event.payload.result)} />
        </div>
      );
    case 'boundary_probe':
      return (
        <div className="turn turn--boundary_probe">
          <div className="kind">
            <span className="pill pill--probe">Boundary probe</span> {event.payload.kind.replace(/_/g, ' ')} · {event.payload.toolName}
          </div>
          <p style={{ margin: '0.3rem 0' }}>
            <strong>Denied:</strong> {event.payload.denialReason}
          </p>
          <Expandable text={prettyValue(event.payload.input)} />
        </div>
      );
    case 'budget_exhausted':
      return (
        <div className="turn turn--budget_exhausted">
          <div className="kind">
            <span className="pill pill--exhausted">Budget exhausted</span>
          </div>
          <p style={{ margin: '0.3rem 0' }}>
            {formatCompact(event.payload.billedTokens)} billed against a {formatCompact(event.payload.budgetTokens)} token budget.
          </p>
        </div>
      );
    case 'commit':
      return (
        <div className="turn turn--commit">
          <div className="kind">
            Commit {event.payload.sha.slice(0, 8)} · {event.payload.filesChanged} file{event.payload.filesChanged === 1 ? '' : 's'} · +
            {event.payload.insertions}/-{event.payload.deletions}
          </div>
          <div style={{ padding: '0 1.05rem 0.9rem' }}>
            <DiffView diff={event.payload.diff} />
          </div>
        </div>
      );
    case 'harness_error':
      return (
        <div className="turn turn--harness_error">
          <div className="kind">
            <span className="pill pill--error">Harness error</span>
          </div>
          <p style={{ margin: '0.3rem 0' }}>{event.payload.message}</p>
          {event.payload.stack ? <Expandable text={event.payload.stack} /> : null}
        </div>
      );
    case 'run_ended':
      return (
        <div className="turn turn--run_ended">
          <div className="kind">
            Run ended · <TerminalPill reason={event.payload.terminalReason} inProgress={false} crashed={false} />
          </div>
          <p style={{ margin: '0.3rem 0' }}>
            {formatCompact(event.payload.billed)} tokens billed over {event.payload.turns} turns, {formatDuration(event.payload.durationMs)},
            est. {formatUsd(event.payload.estimatedCostUsd)}.
          </p>
        </div>
      );
    default:
      return null;
  }
}

export default async function RunDetailPage({ params }: { params: Promise<{ run: string }> }) {
  const { run: runParam } = await params;
  const run = Number(runParam);
  if (!Number.isInteger(run)) notFound();

  const { events } = await loadRunEvents(run);
  if (events.length === 0) notFound();

  const started = events.find((e) => e.type === 'run_started');
  const ended = events.find((e) => e.type === 'run_ended');
  const crashed = !ended && events.some((e) => e.type === 'harness_error');
  const inProgress = !ended;
  const transcript = events.filter((e) => e.type !== 'run_started');

  const billedSoFar = ended
    ? (ended.payload as RunEvent<'run_ended'>['payload']).billed
    : events.filter((e) => e.type === 'assistant_message').reduce((sum, e) => sum + (e.payload as RunEvent<'assistant_message'>['payload']).billed, 0);

  const acc = new CategoryAccumulator();
  for (const e of events) acc.push(e);
  acc.finish();

  const wake = started?.payload as RunEvent<'run_started'>['payload'] | undefined;

  return (
    <>
      <Header active="run-detail" />
      <div className="shell">
        <p>
          <Link href="/">← Run timeline</Link>
        </p>
        <h1>
          Run #{run} <TerminalPill reason={ended ? (ended.payload as RunEvent<'run_ended'>['payload']).terminalReason : null} inProgress={inProgress} crashed={crashed} />
        </h1>
        <p className="page-sub">
          {wake ? formatWallClock(started!.ts) : ''} {wake?.elapsedMs != null ? `· ${formatElapsedGap(wake.elapsedMs)} since previous run` : ''}{' '}
          {wake?.model ? `· ${wake.model}` : ''}
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

        <h2>Wake message</h2>
        <pre className="wake-message">{wake?.wakeMessage ?? '(no run_started event recorded for this run)'}</pre>

        <h2>Transcript</h2>
        <div className="transcript">
          {transcript.map((event, i) => (
            <TranscriptTurn key={`${event.seq}-${i}`} event={event} />
          ))}
        </div>
      </div>
    </>
  );
}
