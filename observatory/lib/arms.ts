/**
 * Arm discovery. The app is multi-arm: five arms as of writing, each with its
 * own log at `${LOGS_DIR}/<id>.jsonl` and, when the harness repo is checked
 * out alongside this one, its own config at `arms/<id>.yaml`. Neither source
 * is required on its own — an arm can exist in config with no runs yet (fresh
 * arm, harness hasn't fired), or have a log with no readable config
 * (deployed without the harness repo's arms/ directory mounted) — so the
 * arm list is the union of both, enriched with whichever config is found.
 *
 * `arms/*.yaml` is owned by the harness side of this repo, not this app;
 * this only ever reads it, defensively, and never assumes it is present —
 * see resolveArmsDir's candidate list for where a deployment might put it.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { logsDir } from './log';

export type PromptVariant = 'standard' | 'unaware';

export type ArmMeta = {
  id: string;
  label: string;
  model: string | null;
  promptVariant: PromptVariant | null;
  tools: string[] | null;
  budgetTokens: number | null;
  /** Whether `${LOGS_DIR}/<id>.jsonl` exists — an arm can be configured with none yet. */
  hasLog: boolean;
  /** Whether `arms/<id>.yaml` was found and parsed. */
  hasConfig: boolean;
};

/** One factual line per known prompt variant — mechanics only, matching what src/prompts.ts actually withholds. Never invents intent beyond that. */
export const PROMPT_VARIANT_NOTE: Record<PromptVariant, string> = {
  standard: 'Told its run number, elapsed time since the last run, and that sessions recur.',
  unaware: 'Not told its run number or elapsed time, and the prompt never mentions that sessions recur — everything it is told is still true, that fact is just withheld.',
};

function resolveArmsDir(): string | null {
  const candidates = [
    process.env.ARMS_DIR,
    '/app/arms',
    path.join(process.cwd(), 'arms'),
    path.join(process.cwd(), '..', 'arms'),
    path.join(process.cwd(), '..', '..', 'arms'),
    path.join(process.cwd(), '..', '..', '..', 'arms'),
  ].filter((p): p is string => !!p);
  return candidates.find((c) => existsSync(c)) ?? null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function readArmConfig(armsDir: string, id: string): Partial<ArmMeta> | null {
  const file = path.join(armsDir, `${id}.yaml`);
  if (!existsSync(file)) return null;
  try {
    const doc = parseYaml(readFileSync(file, 'utf8')) as unknown;
    if (typeof doc !== 'object' || doc === null) return null;
    const d = doc as Record<string, unknown>;
    const promptVariant = d.promptVariant === 'unaware' ? 'unaware' : d.promptVariant === 'standard' ? 'standard' : null;
    return {
      label: str(d.label) ?? undefined,
      model: str(d.model) ?? undefined,
      promptVariant: promptVariant ?? undefined,
      tools: Array.isArray(d.tools) ? d.tools.filter((t): t is string => typeof t === 'string') : undefined,
      budgetTokens: typeof d.budgetTokens === 'number' ? d.budgetTokens : undefined,
    };
  } catch {
    return null;
  }
}

/** Every arm known either from a log file or a config file, sorted by id. */
export function discoverArms(): ArmMeta[] {
  const dir = logsDir();
  const logIds = new Set<string>();
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.jsonl')) logIds.add(f.slice(0, -'.jsonl'.length));
    }
  }

  const armsDir = resolveArmsDir();
  const configIds = new Set<string>();
  if (armsDir) {
    for (const f of readdirSync(armsDir)) {
      const m = f.match(/^(.+)\.ya?ml$/);
      if (m) configIds.add(m[1]!);
    }
  }

  const ids = Array.from(new Set([...configIds, ...logIds])).sort();

  return ids.map((id) => {
    const cfg = armsDir ? readArmConfig(armsDir, id) : null;
    return {
      id,
      label: cfg?.label ?? id,
      model: cfg?.model ?? null,
      promptVariant: cfg?.promptVariant ?? null,
      tools: cfg?.tools ?? null,
      budgetTokens: cfg?.budgetTokens ?? null,
      hasLog: logIds.has(id),
      hasConfig: cfg !== null,
    };
  });
}

/** The arm a bare `/` or an unqualified link should land on — prefers one with runs so a first-time visit isn't an empty state by default. */
export function defaultArmId(arms: ArmMeta[]): string | null {
  if (arms.length === 0) return null;
  return (arms.find((a) => a.hasLog) ?? arms[0])!.id;
}

export function findArm(arms: ArmMeta[], id: string): ArmMeta | null {
  return arms.find((a) => a.id === id) ?? null;
}
