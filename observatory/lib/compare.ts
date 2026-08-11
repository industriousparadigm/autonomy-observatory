/** Aggregates one arm's run summaries into the numbers the cross-arm comparison view puts side by side. */

import type { RunSummary } from './runs';
import { loadRunSummaries } from './runs';
import { eventLogPath } from './log';
import type { TerminalReason } from './events';
import type { ArmMeta } from './arms';

export type TerminalMixKey = TerminalReason | 'in_progress';

export type ArmStats = {
  arm: ArmMeta;
  runs: RunSummary[];
  runCount: number;
  totalBilled: number;
  avgBilled: number;
  totalCost: number;
  boundaryProbeTotal: number;
  /** Count per terminal outcome, in a fixed display order. Runs still in progress count as 'in_progress', not by any eventual reason. */
  terminalMix: { key: TerminalMixKey; count: number }[];
};

export const TERMINAL_MIX_ORDER: TerminalMixKey[] = ['voluntary_stop', 'max_turns', 'budget_exhausted', 'harness_error', 'aborted', 'in_progress'];

export const TERMINAL_MIX_LABEL: Record<TerminalMixKey, string> = {
  voluntary_stop: 'voluntary stop',
  max_turns: 'max turns',
  budget_exhausted: 'budget exhausted',
  harness_error: 'harness error',
  aborted: 'aborted',
  in_progress: 'in progress',
};

/** Same color rule as TerminalPill/RunFlags elsewhere in the app — reused rather than a new palette, so a reader isn't asked to learn two color languages for the same fact. */
export const TERMINAL_MIX_PILL_CLASS: Record<TerminalMixKey, string> = {
  voluntary_stop: 'pill--stop',
  max_turns: 'pill--done',
  budget_exhausted: 'pill--exhausted',
  harness_error: 'pill--error',
  aborted: 'pill--done',
  in_progress: 'pill--progress',
};

/**
 * What this arm's config changed relative to the baseline — computed as a
 * plain field diff (model / prompt variant / tool list), never read from the
 * arm files' free-text comments. This is what "isolates" means on the
 * compare page: the one dimension a reader should attribute any difference
 * in the numbers to.
 */
export function isolationLabel(arm: ArmMeta, baseline: ArmMeta | null): string {
  if (!arm.hasConfig) return 'no config found';
  if (!baseline || !baseline.hasConfig || arm.id === baseline.id) return 'baseline';

  const diffs: string[] = [];
  if (arm.model !== baseline.model) diffs.push(`model: ${arm.model ?? 'unknown'}`);
  if (arm.promptVariant !== baseline.promptVariant) diffs.push(`prompt: ${arm.promptVariant ?? 'unknown'}`);

  const baseTools = new Set(baseline.tools ?? []);
  const armTools = new Set(arm.tools ?? []);
  const added = [...armTools].filter((t) => !baseTools.has(t));
  const removed = [...baseTools].filter((t) => !armTools.has(t));
  if (added.length > 0) diffs.push(`+${added.join(', ')}`);
  if (removed.length > 0) diffs.push(`-${removed.join(', ')}`);

  return diffs.length > 0 ? diffs.join('; ') : 'identical config to baseline';
}

export async function loadArmStats(arm: ArmMeta): Promise<ArmStats> {
  const { runs } = await loadRunSummaries(eventLogPath(arm.id));

  const totalBilled = runs.reduce((sum, r) => sum + r.billedTokens, 0);
  const totalCost = runs.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0);
  const boundaryProbeTotal = runs.reduce((sum, r) => sum + r.boundaryProbeCount, 0);

  const counts = new Map<TerminalMixKey, number>();
  for (const r of runs) {
    const key: TerminalMixKey = r.inProgress ? 'in_progress' : (r.terminalReason ?? 'in_progress');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const terminalMix = TERMINAL_MIX_ORDER.map((key) => ({ key, count: counts.get(key) ?? 0 })).filter((m) => m.count > 0);

  return {
    arm,
    runs,
    runCount: runs.length,
    totalBilled,
    avgBilled: runs.length > 0 ? totalBilled / runs.length : 0,
    totalCost,
    boundaryProbeTotal,
    terminalMix,
  };
}
