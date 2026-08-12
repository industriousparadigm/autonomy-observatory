/**
 * The derived numbers, and the definitions that make them readable.
 *
 * Nothing here is recorded in the event log as such: every figure is computed
 * in lib/metrics.ts from events that are. So every block of figures ships
 * with <DerivationNote>, which prints the definition of each figure it shows.
 * If a figure ever appears without its definition next to it, that is a bug,
 * not a layout choice.
 */

import { METRIC_NOTES, failureShare, type ArmMetrics, type CallTally, type ToolCall, type WordSplit } from '@/lib/metrics';
import { formatUsd } from '@/lib/format';

type FigureKey = keyof typeof METRIC_NOTES;

const FIGURE_TITLE: Record<FigureKey, string> = {
  calls: 'Failed tool calls',
  words: 'Work against bookkeeping',
  budget: 'Budget used',
  productivity: 'Words per 1,000 tokens',
  opening: 'Opening move',
  closing: 'Closing text',
  cost: 'Spent so far',
};

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function n(x: number): string {
  return Math.round(x).toLocaleString('en-US');
}

/**
 * "9 calls, 2 failed (22%)", the sentence form used in tables and cards.
 * Errors and calls with no result are both failures but are not the same
 * fact, so a run that has both says so rather than adding them into one
 * number a reader cannot take apart.
 */
export function describeCalls(calls: CallTally): string {
  if (calls.total === 0) return calls.denied > 0 ? `${calls.denied} denied` : 'no tool calls';
  const bad = calls.failed + calls.unanswered;
  const head = `${calls.total} call${calls.total === 1 ? '' : 's'}`;
  if (bad === 0) return `${head}, none failed`;
  const share = pct(failureShare(calls) ?? 0);
  if (calls.failed === 0) return `${head}, ${calls.unanswered} with no result recorded (${share})`;
  if (calls.unanswered === 0) return `${head}, ${calls.failed} failed (${share})`;
  return `${head}, ${bad} failed (${share}): ${calls.failed} returned an error, ${calls.unanswered} got no result`;
}

export function describeOpening(call: ToolCall | null): string {
  if (call === null) return 'made no tool call';
  const outcome =
    call.outcome === 'ok' ? 'succeeded' : call.outcome === 'failed' ? 'failed' : call.outcome === 'unanswered' ? 'no result recorded' : 'denied by the harness';
  return `${call.toolName}${call.target ? ` ${call.target}` : ''}, ${outcome}`;
}

export function describeWords(words: WordSplit): { value: string; sub: string } {
  const sub = `${n(words.work)} work, ${n(words.bookkeeping)} bookkeeping`;
  if (words.work === 0 && words.bookkeeping === 0) return { value: 'nothing yet', sub: 'no committed lines' };
  if (words.bookkeeping === 0) return { value: 'all work', sub };
  if (words.work === 0) return { value: '0 : 1', sub };
  return { value: `${(words.work / words.bookkeeping).toFixed(1)} : 1`, sub };
}

export function Figure({ label, value, sub, variant = 'number' }: { label: string; value: string; sub: string; variant?: 'number' | 'text' }) {
  return (
    <div className={variant === 'text' ? 'figure figure--wide' : 'figure'}>
      <div className="label">{label}</div>
      <div className={variant === 'text' ? 'value value--text' : 'value'}>{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

/** One arm's derived figures. Pair it with <DerivationNote keys={...} /> for the same keys. */
export function ArmFigures({ metrics }: { metrics: ArmMetrics }) {
  const share = failureShare(metrics.calls);
  const words = describeWords(metrics.words);
  const latest = metrics.runs[metrics.runs.length - 1];

  return (
    <div className="figure-grid">
      <Figure
        label={FIGURE_TITLE.calls}
        value={share === null ? 'no calls' : pct(share)}
        sub={metrics.calls.total === 0 ? 'nothing to divide' : `${metrics.calls.failed + metrics.calls.unanswered} of ${n(metrics.calls.total)} calls`}
      />
      <Figure
        label={FIGURE_TITLE.budget}
        value={metrics.meanBudgetShare === null ? 'unknown' : pct(metrics.meanBudgetShare)}
        sub={metrics.meanBudgetShare === null ? 'no budget recorded' : `mean over ${metrics.runs.length} run${metrics.runs.length === 1 ? '' : 's'}`}
      />
      <Figure label={FIGURE_TITLE.words} value={words.value} sub={words.sub} />
      {metrics.productivity ? (
        <Figure
          label={FIGURE_TITLE.productivity}
          value={`${n(metrics.productivity.earlyPerKTok)} to ${n(metrics.productivity.latePerKTok)}`}
          sub={`first ${metrics.productivity.halfSize} runs against last ${metrics.productivity.halfSize}`}
        />
      ) : null}
      {latest ? (
        <Figure label={FIGURE_TITLE.opening} value={describeOpening(latest.firstCall)} sub={`run ${latest.run}, the latest`} variant="text" />
      ) : null}
      <Figure
        label={FIGURE_TITLE.cost}
        value={formatUsd(metrics.runs.reduce((sum, r) => sum + (r.recorded.estimatedCostUsd ?? 0), 0))}
        sub={`over ${metrics.runs.length} run${metrics.runs.length === 1 ? '' : 's'}`}
      />
    </div>
  );
}

export function DerivationNote({ keys }: { keys: FigureKey[] }) {
  return (
    <details className="derivation">
      <summary>How these numbers are worked out</summary>
      <p className="page-sub">
        The event log records events, not figures. Each of these is counted here from the events named below, and holds only as far as its definition
        does.
      </p>
      <dl>
        {keys.map((k) => (
          <div key={k}>
            <dt>{FIGURE_TITLE[k]}</dt>
            <dd>{METRIC_NOTES[k]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
