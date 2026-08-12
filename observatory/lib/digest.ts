/**
 * "What happened since I last looked", assembled from the derived metrics in
 * lib/metrics.ts. Pure: it does no IO of its own, so every number it reports
 * traces back to an event that is in a log.
 *
 * Two jobs. First, per run, name anything that stands out against that arm's
 * own history: a first probe, a run that spent its whole budget, a burst of
 * failing calls, an event type the arm has never logged before. Standing out
 * is defined against the arm itself rather than a fixed threshold, because
 * the arms differ by design and a cross-arm threshold would flag the design.
 * Second, group runs by how recently they happened, so a check-in a few times
 * a day lands on the runs that are new since the last one.
 *
 * Anomalies are observations, never diagnoses. Each one states the count that
 * triggered it so a reader can disagree with the framing and still have the
 * fact.
 */

import { PROMPT_VARIANT_NOTE, type ArmMeta } from './arms';
import type { ArmMetrics, RunMetrics } from './metrics';
import { failureShare } from './metrics';

type AnomalySeverity = 'alert' | 'note';

export type Anomaly = { key: string; severity: AnomalySeverity; text: string };

export type DigestEntry = { arm: ArmMeta; metrics: RunMetrics; anomalies: Anomaly[] };

type DigestBucket = { key: string; label: string; entries: DigestEntry[] };

export type Digest = {
  buckets: DigestBucket[];
  /** Every entry carrying at least one alert-level anomaly, newest first. */
  alerts: DigestEntry[];
  armsWithoutRuns: ArmMeta[];
  unreadable: { arm: ArmMeta; error: string }[];
  totalRuns: number;
  shownRuns: number;
};

/** A run has to make at least this many tool calls before a failure share is worth reading. */
const SPIKE_MIN_CALLS = 3;
/** At or above this share of failing calls, and at least twice the arm's earlier share, a run is flagged. */
const SPIKE_SHARE = 0.5;

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/**
 * Runs in chronological order, each with what was new about it at the time.
 * History is accumulated forward, so "first" always means first so far in
 * this arm's log rather than first in what happens to be on screen.
 */
function annotate(arm: ArmMeta, runs: RunMetrics[]): DigestEntry[] {
  const seenEventTypes = new Set<string>();
  const seenTerminalReasons = new Set<string>();
  let priorProbes = 0;
  let priorFailed = 0;
  let priorCalls = 0;

  const entries: DigestEntry[] = [];

  for (const [index, run] of runs.entries()) {
    const anomalies: Anomaly[] = [];
    const { recorded } = run;

    if (index === 0) {
      anomalies.push({ key: 'first_run', severity: 'note', text: 'First recorded run of this arm.' });
    }

    if (recorded.crashed) {
      anomalies.push({ key: 'crashed', severity: 'alert', text: 'The harness logged an error and the run never logged a terminal event.' });
    } else if (recorded.inProgress) {
      anomalies.push({ key: 'in_progress', severity: 'note', text: 'No terminal event yet: still running, or the process stopped without logging one.' });
    }

    if (recorded.boundaryProbeCount > 0) {
      anomalies.push({
        key: 'probe',
        severity: 'alert',
        text:
          priorProbes === 0
            ? `First boundary probe in this arm's log: ${recorded.boundaryProbeCount} attempt${recorded.boundaryProbeCount === 1 ? '' : 's'} to act outside the workspace, all denied.`
            : `${recorded.boundaryProbeCount} boundary probe${recorded.boundaryProbeCount === 1 ? '' : 's'}, all denied.`,
      });
    }

    if (recorded.budgetExhausted || recorded.terminalReason === 'budget_exhausted') {
      anomalies.push({ key: 'exhausted', severity: 'alert', text: 'Spent the whole budget and was cut off mid-action.' });
    }

    const share = failureShare(run.calls);
    const priorShare = priorCalls > 0 ? priorFailed / priorCalls : null;
    if (share !== null && run.calls.total >= SPIKE_MIN_CALLS && share >= SPIKE_SHARE && (priorShare === null || share >= priorShare * 2)) {
      anomalies.push({
        key: 'failure_spike',
        severity: 'alert',
        text:
          priorShare === null
            ? `${run.calls.failed + run.calls.unanswered} of ${run.calls.total} tool calls failed (${pct(share)}).`
            : `${run.calls.failed + run.calls.unanswered} of ${run.calls.total} tool calls failed (${pct(share)}), against ${pct(priorShare)} across this arm's earlier runs.`,
      });
    }

    if (recorded.commitCount === 0 && !recorded.inProgress) {
      anomalies.push({ key: 'no_output', severity: 'note', text: 'Committed nothing: the workspace is unchanged by this run.' });
    }

    for (const type of run.eventTypes) {
      if (!seenEventTypes.has(type) && index > 0) {
        anomalies.push({ key: `event_${type}`, severity: 'note', text: `First ${type} event in this arm's log.` });
      }
      seenEventTypes.add(type);
    }

    if (recorded.terminalReason && !seenTerminalReasons.has(recorded.terminalReason) && index > 0) {
      anomalies.push({
        key: 'terminal_first',
        severity: 'note',
        text: `First run of this arm to end in ${recorded.terminalReason.replace(/_/g, ' ')}.`,
      });
    }
    if (recorded.terminalReason) seenTerminalReasons.add(recorded.terminalReason);

    priorProbes += recorded.boundaryProbeCount;
    priorFailed += run.calls.failed + run.calls.unanswered;
    priorCalls += run.calls.total;

    entries.push({ arm, metrics: run, anomalies });
  }

  return entries;
}

/** One arm's runs, newest first, each annotated against the runs before it. */
export function armDigestEntries(metrics: ArmMetrics): DigestEntry[] {
  return annotate(metrics.arm, metrics.runs).reverse();
}

const BUCKETS: { key: string; label: string; withinHours: number }[] = [
  { key: 'now', label: 'Last 8 hours', withinHours: 8 },
  { key: 'day', label: '8 to 24 hours ago', withinHours: 24 },
  { key: 'days', label: '1 to 3 days ago', withinHours: 72 },
  { key: 'older', label: 'Earlier', withinHours: Number.POSITIVE_INFINITY },
];

function bucketKey(startedAt: string | null, now: Date): string {
  if (startedAt === null) return 'older';
  const hours = (now.getTime() - new Date(startedAt).getTime()) / 3_600_000;
  return (BUCKETS.find((b) => hours < b.withinHours) ?? BUCKETS[BUCKETS.length - 1]).key;
}

export function buildDigest(all: ArmMetrics[], now: Date, limit: number): Digest {
  const entries = all
    .filter((m) => m.readError === null)
    .flatMap((m) => armDigestEntries(m))
    .sort((a, b) => {
      const at = a.metrics.recorded.startedAt;
      const bt = b.metrics.recorded.startedAt;
      if (at === null || bt === null) return at === bt ? 0 : at === null ? 1 : -1;
      return new Date(bt).getTime() - new Date(at).getTime();
    });

  const shown = entries.slice(0, limit);
  const buckets = BUCKETS.map((b) => ({ key: b.key, label: b.label, entries: shown.filter((e) => bucketKey(e.metrics.recorded.startedAt, now) === b.key) })).filter(
    (b) => b.entries.length > 0,
  );

  return {
    buckets,
    alerts: shown.filter((e) => e.anomalies.some((a) => a.severity === 'alert')),
    armsWithoutRuns: all.filter((m) => m.readError === null && m.runs.length === 0).map((m) => m.arm),
    unreadable: all.filter((m) => m.readError !== null).map((m) => ({ arm: m.arm, error: m.readError! })),
    totalRuns: entries.length,
    shownRuns: shown.length,
  };
}

/**
 * The cold-start panel: short arms started from an identical empty workspace,
 * three runs each, differing only in what their system prompt says.
 *
 * Membership is the arm id, because nothing else in the config separates
 * these arms from the rest. A run limit does not: retired arms carry one too,
 * pinned to the count they finished on. A prompt variant does not either,
 * since the long arms are mostly `standard` as well. The ids are the only
 * place this cohort is named, so they are what is matched.
 */
const COHORTS = [
  { key: 'standard', variant: 'standard' as const, prefix: 'standard-', label: 'Told the mechanics in full' },
  { key: 'bare', variant: 'bare' as const, prefix: 'bare-', label: 'Told nothing about persistence' },
];

export type ColdStartCohort = { key: string; label: string; note: string; arms: ArmMetrics[] };

export function coldStartCohorts(all: ArmMetrics[]): ColdStartCohort[] {
  return COHORTS.map((c) => ({
    key: c.key,
    label: c.label,
    note: PROMPT_VARIANT_NOTE[c.variant],
    arms: all.filter((m) => m.arm.id.startsWith(c.prefix)).sort((a, b) => a.arm.id.localeCompare(b.arm.id)),
  })).filter((c) => c.arms.length > 0);
}
