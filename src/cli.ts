/**
 * Every operation is a CLI verb, so the whole experiment is drivable over bash
 * with no special integration.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { armConfigPath, discoverArmIds, loadArm, pathsFor } from './config.ts';
import { isDue, queuedRuns, readArmControl } from './control.ts';
import { lastRunStartedAt, nextRunNumber, readLog } from './events.ts';
import { runOnce } from './harness.ts';

const DATA_ROOT = process.env.DATA_ROOT ?? '/data';

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

async function main(): Promise<void> {
  const verb = process.argv[2];

  // `due` is the only verb that is about every arm rather than one, so it
  // resolves its own configs and returns before the single-arm setup below.
  if (verb === 'due') {
    for (const id of discoverArmIds(DATA_ROOT)) {
      let arm;
      try {
        arm = loadArm(armConfigPath(id, DATA_ROOT));
      } catch {
        // A malformed arm config must not stop the other arms from running.
        process.stderr.write(`due: skipping ${id}, config did not parse\n`);
        continue;
      }
      const events = readLog(pathsFor(arm, DATA_ROOT).eventLog);
      const decision = isDue({
        control: readArmControl(DATA_ROOT, id),
        lastRunStartedAt: lastRunStartedAt(events),
        runsSoFar: nextRunNumber(events) - 1,
        maxRuns: arm.maxRuns,
        queued: queuedRuns(DATA_ROOT).includes(id),
        now: new Date(),
      });
      if (decision.due) process.stdout.write(`${id}\n`);
    }
    return;
  }

  const armId = argValue('--arm', 'a');
  const arm = loadArm(argValue('--config', armConfigPath(armId, DATA_ROOT)));
  const paths = pathsFor(arm, DATA_ROOT);

  switch (verb) {
    case 'run': {
      mkdirSync(dirname(paths.eventLog), { recursive: true });
      mkdirSync(paths.claudeConfigDir, { recursive: true });
      mkdirSync(paths.blobsDir, { recursive: true });

      // A finished short arm stays on the schedule rather than being unwired,
      // so the tick keeps offering it. Exiting cleanly here costs nothing and
      // leaves the workspace and log exactly as the last run left them.
      if (arm.maxRuns !== undefined) {
        const done = nextRunNumber(readLog(paths.eventLog)) - 1;
        if (done >= arm.maxRuns) {
          process.stdout.write(`arm=${arm.id} complete=${done}/${arm.maxRuns}\n`);
          return;
        }
      }

      const reason = await runOnce(arm, paths);
      process.stdout.write(`arm=${arm.id} terminal_reason=${reason}\n`);
      return;
    }

    case 'replay': {
      // Metrics are projections of the log. Recomputing them must never
      // require re-running the agent, so this reads and never calls the API.
      const events = readLog(paths.eventLog);
      for (const e of events) {
        process.stdout.write(`${e.seq}\t${e.ts}\trun=${e.run}\t${e.type}\n`);
      }
      return;
    }

    default:
      process.stderr.write('usage: cli.ts <run|replay|due> [--arm a] [--config path]\n');
      process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exitCode = 1;
});
