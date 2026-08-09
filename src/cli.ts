/**
 * Every operation is a CLI verb, so the whole experiment is drivable over bash
 * with no special integration.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadArm, pathsFor } from './config.ts';
import { readLog } from './events.ts';
import { runOnce } from './harness.ts';

const DATA_ROOT = process.env.DATA_ROOT ?? '/data';

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

async function main(): Promise<void> {
  const verb = process.argv[2];
  const armId = argValue('--arm', 'a');
  const arm = loadArm(argValue('--config', `arms/${armId}.yaml`));
  const paths = pathsFor(arm, DATA_ROOT);

  switch (verb) {
    case 'run': {
      mkdirSync(dirname(paths.eventLog), { recursive: true });
      mkdirSync(paths.claudeConfigDir, { recursive: true });
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
      process.stderr.write('usage: cli.ts <run|replay> [--arm a] [--config path]\n');
      process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exitCode = 1;
});
