/**
 * One YAML file per arm, in git. Arms are isolated by construction: separate
 * workspace, separate event log, separate config. Nothing is shared but the code.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

export const ArmConfigSchema = z.object({
  /** Short id. Also the workspace directory and event log filename. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  model: z.string(),
  /** Billed tokens per session: uncached input + cache writes + output. */
  budgetTokens: z.number().int().positive(),
  timezone: z.string(),
  /** SDK tool names the agent may use this phase. */
  tools: z.array(z.string()),
  /** How those tools are described in the system prompt, in plain words. */
  toolNames: z.array(z.string()),
  /** `unaware` and `bare` withhold progressively more. See prompts.ts. */
  promptVariant: z.enum(['standard', 'unaware', 'bare']).default('standard'),
  hasMailbox: z.boolean().default(false),
  /** Wipes the workspace before each run, making persistence the variable.
   *  Unused by every arm so far; pre-registered metric 1's null is defined
   *  against a memory-ablated arm, so this is what that arm would set. */
  wipeWorkspaceEachRun: z.boolean().default(false),
  /** Files seeded into an otherwise empty workspace on run 1. Unused so far. */
  seedFiles: z.record(z.string(), z.string()).default({}),
  maxTurns: z.number().int().positive().default(60),
  /**
   * Stop after this many runs. Short arms sampled from a cold start answer the
   * disposition-versus-sampling question that long arms cannot: a state file
   * hands run 1's branch to every successor as an instruction, so ten runs of
   * one arm is closer to one sample than to ten. Omit for an open-ended arm.
   */
  maxRuns: z.number().int().positive().optional(),
})
  // Strict, so an unrecognised key fails the arm at load rather than being
  // silently dropped. A typo'd field would otherwise take its default and the
  // arm would run for weeks measuring something other than what it says it
  // measures — and `maxBudgetUsd`, removed because it leaked a live cost meter
  // into the model's context, would come back as a no-op nobody noticed.
  .strict();

export type ArmConfig = z.infer<typeof ArmConfigSchema>;

export function loadArm(path: string): ArmConfig {
  return ArmConfigSchema.parse(parse(readFileSync(path, 'utf8')));
}

/**
 * Where an arm's config lives. Arms authored in the observatory land on the
 * volume, which is the only writable place; arms that ship with the image are
 * in `arms/`. The volume is checked first so an arm can be edited without a
 * rebuild — including the ones the image ships.
 */
export function armConfigPath(armId: string, dataRoot: string, imageArmsDir = 'arms'): string {
  const onVolume = `${dataRoot}/arms/${armId}.yaml`;
  return existsSync(onVolume) ? onVolume : `${imageArmsDir}/${armId}.yaml`;
}

/** Every arm this container knows about, from both sources, ids only. */
export function discoverArmIds(dataRoot: string, imageArmsDir = 'arms'): string[] {
  const ids = new Set<string>();
  for (const dir of [imageArmsDir, `${dataRoot}/arms`]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const m = file.match(/^(.+)\.ya?ml$/);
      if (m?.[1]) ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

export type Paths = {
  workspace: string;
  eventLog: string;
  claudeConfigDir: string;
  /** Content-addressed store for workspace file snapshots, keyed by sha256.
   *  Shared across arms and runs, since content is what's deduplicated. */
  blobsDir: string;
  /** The arm's mailbox root. Outside the workspace on purpose: a channel the
   *  agent could write to both ends of is not a channel. */
  mailboxRoot: string;
};

export function pathsFor(arm: ArmConfig, dataRoot: string): Paths {
  return {
    workspace: `${dataRoot}/workspaces/${arm.id}`,
    eventLog: `${dataRoot}/logs/${arm.id}.jsonl`,
    // Per arm: arms are isolated by construction, and a shared config dir would
    // put every arm's transcripts and session state in one place.
    claudeConfigDir: `${dataRoot}/claude-config/${arm.id}`,
    // Shared deliberately. Blobs are harness-side storage the agent never sees,
    // and content-addressing means identical files across arms cost one copy.
    blobsDir: `${dataRoot}/blobs`,
    mailboxRoot: `${dataRoot}/mailbox/${arm.id}`,
  };
}
