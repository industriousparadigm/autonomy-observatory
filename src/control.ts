/**
 * The control plane: what the observatory can change about a running
 * experiment without a redeploy.
 *
 * Everything here lives on the volume, never in the image, because the image
 * is read-only and a cadence change should not need a rebuild. Two kinds of
 * state, deliberately in separate files with a single writer each, so the web
 * process and the scheduler never race:
 *
 *   /data/control/arms/<id>.json   written by the web app, read by the tick
 *   /data/control/queue/<id>       created by the web app, consumed by the tick
 *   /data/arms/<id>.yaml           arm configs created in the UI
 *
 * There is deliberately no `lastFiredAt` file. When an arm last ran is already
 * recorded, in the only place that matters: its event log. A second copy would
 * be a second thing to keep true.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const DEFAULT_INTERVAL_HOURS = 8;

export const ArmControlSchema = z.object({
  paused: z.boolean().default(false),
  /** Hours between wakes. The gap is a measured variable, so it is stated in
   *  hours rather than as a cron expression: "every 8h" is a fact about the
   *  experiment, an hour-field expression is a fact about cron. */
  intervalHours: z.number().positive().max(24 * 14).default(DEFAULT_INTERVAL_HOURS),
  /** Free text shown in the UI. Why an arm is paused is worth more than that it is. */
  note: z.string().max(500).default(''),
}).strict();

export type ArmControl = z.infer<typeof ArmControlSchema>;

export const DEFAULT_CONTROL: ArmControl = {
  paused: false,
  intervalHours: DEFAULT_INTERVAL_HOURS,
  note: '',
};

export function controlPaths(dataRoot: string) {
  return {
    arms: join(dataRoot, 'control', 'arms'),
    queue: join(dataRoot, 'control', 'queue'),
    /** Arm configs authored in the UI. Read after the image's own arms/. */
    armConfigs: join(dataRoot, 'arms'),
  };
}

export function readArmControl(dataRoot: string, armId: string): ArmControl {
  const file = join(controlPaths(dataRoot).arms, `${armId}.json`);
  if (!existsSync(file)) return DEFAULT_CONTROL;
  try {
    return ArmControlSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    // A hand-edited or half-written control file must never stop an arm from
    // running: the experiment's default is to keep going.
    return DEFAULT_CONTROL;
  }
}

export function writeArmControl(dataRoot: string, armId: string, control: ArmControl): void {
  const dir = controlPaths(dataRoot).arms;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${armId}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(ArmControlSchema.parse(control), null, 2));
  // Rename, not write-in-place: it is atomic on the same filesystem, so the
  // tick reading these on a one-minute loop never sees a half-written file.
  renameSync(tmp, file);
}

/** Ask for one extra run of an arm, outside its cadence. */
export function enqueueRun(dataRoot: string, armId: string): void {
  const dir = controlPaths(dataRoot).queue;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, armId), new Date().toISOString());
}

export function queuedRuns(dataRoot: string): string[] {
  const dir = controlPaths(dataRoot).queue;
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/** Consumed before the run starts, not after: a queued trigger is a request
 *  for one run, and a run that fails has still had its turn. Leaving it would
 *  retry a failing arm every minute. */
export function dequeueRun(dataRoot: string, armId: string): void {
  rmSync(join(controlPaths(dataRoot).queue, armId), { force: true });
}

export type DueDecision =
  | { due: true; reason: 'queued' | 'first-run' | 'interval-elapsed' }
  | { due: false; reason: 'paused' | 'complete' | 'not-yet'; nextDueAt?: Date };

/**
 * Whether an arm should run at this instant. Due-ness is measured from when
 * the arm last *started*, not from a wall-clock grid, which is what keeps the
 * wake-to-wake gap equal to the configured interval even after a restart or a
 * long outage. A cron grid would instead fire immediately on the next slot and
 * silently shorten one gap.
 */
export function isDue(opts: {
  control: ArmControl;
  lastRunStartedAt: Date | null;
  runsSoFar: number;
  maxRuns?: number;
  queued: boolean;
  now: Date;
}): DueDecision {
  if (opts.maxRuns !== undefined && opts.runsSoFar >= opts.maxRuns) {
    return { due: false, reason: 'complete' };
  }
  // A queued run is an explicit instruction and outranks the cadence, but not
  // a pause: pausing an arm should mean it does not run, whatever else is
  // pending. The queued request stays until the arm is resumed.
  if (opts.control.paused) return { due: false, reason: 'paused' };
  if (opts.queued) return { due: true, reason: 'queued' };
  if (opts.lastRunStartedAt === null) return { due: true, reason: 'first-run' };

  const nextDueAt = new Date(opts.lastRunStartedAt.getTime() + opts.control.intervalHours * 3_600_000);
  return opts.now >= nextDueAt
    ? { due: true, reason: 'interval-elapsed' }
    : { due: false, reason: 'not-yet', nextDueAt };
}
