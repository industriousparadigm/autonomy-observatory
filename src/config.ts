/**
 * One YAML file per arm, in git. Arms are isolated by construction: separate
 * workspace, separate event log, separate config. Nothing is shared but the code.
 */

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

export const ArmConfigSchema = z.object({
  /** Short id. Also the workspace directory and event log filename. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  model: z.string(),
  /** Billed tokens per session: uncached input + cache writes + output. */
  budgetTokens: z.number().int().positive(),
  /**
   * Dollar ceiling handed to the SDK as a backstop. Set above the token budget
   * so it only ever fires if token accounting itself has failed — belt and
   * braces, not the primary control.
   */
  maxBudgetUsd: z.number().positive(),
  timezone: z.string(),
  /** SDK tool names the agent may use this phase. */
  tools: z.array(z.string()),
  /** How those tools are described in the system prompt, in plain words. */
  toolNames: z.array(z.string()),
  hasMailbox: z.boolean().default(false),
  /** Arm C wipes the workspace before each run; persistence is the variable. */
  wipeWorkspaceEachRun: z.boolean().default(false),
  /** Files seeded into an empty workspace on run 1. Arm D's manipulation. */
  seedFiles: z.record(z.string(), z.string()).default({}),
  maxTurns: z.number().int().positive().default(60),
});

export type ArmConfig = z.infer<typeof ArmConfigSchema>;

export function loadArm(path: string): ArmConfig {
  return ArmConfigSchema.parse(parse(readFileSync(path, 'utf8')));
}

export type Paths = {
  workspace: string;
  eventLog: string;
  claudeConfigDir: string;
};

export function pathsFor(arm: ArmConfig, dataRoot: string): Paths {
  return {
    workspace: `${dataRoot}/workspaces/${arm.id}`,
    eventLog: `${dataRoot}/logs/${arm.id}.jsonl`,
    claudeConfigDir: `${dataRoot}/claude-config`,
  };
}
