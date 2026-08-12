/**
 * Drive the experiment: pause an arm, change how often it wakes, wake it once
 * now, or add an arm. Reading this page needs nothing; every change on it needs
 * the control token.
 *
 * State shown here is read from the same two places the scheduler reads:
 * each arm's control file and each arm's event log. There is no third copy.
 */

import { cookies } from 'next/headers';
import { Header } from '@/components/Header';
import { ArmControls } from '@/components/control/ArmControls';
import { CreateArmForm } from '@/components/control/CreateArmForm';
import { UnlockForm } from '@/components/control/UnlockForm';
import { discoverArms } from '@/lib/arms';
import {
  CONTROL_COOKIE,
  controlTokenConfigured,
  isRunQueued,
  knownArmIds,
  nextDueAt,
  readArmConfig,
  readArmControl,
  tokenMatches,
} from '@/lib/control';
import { formatElapsedGap, formatWallClock } from '@/lib/format';
import { eventLogPath } from '@/lib/log';
import { loadRunSummaries } from '@/lib/runs';

import './control.css';

export const dynamic = 'force-dynamic';

type ArmState = {
  id: string;
  label: string;
  model: string | null;
  promptVariant: string | null;
  maxRuns: number | null;
  configSource: 'volume' | 'image' | null;
  paused: boolean;
  note: string;
  intervalHours: number;
  queued: boolean;
  runsSoFar: number;
  lastRunStartedAt: Date | null;
  running: boolean;
};

async function loadArmState(id: string): Promise<ArmState> {
  const config = readArmConfig(id);
  const control = readArmControl(id);
  const { runs } = await loadRunSummaries(eventLogPath(id));
  const started = runs.filter((r) => r.startedAt !== null);

  return {
    id,
    label: config.label || id,
    model: config.model,
    promptVariant: config.promptVariant,
    maxRuns: config.maxRuns,
    configSource: config.source,
    paused: control.paused,
    note: control.note,
    intervalHours: control.intervalHours,
    queued: isRunQueued(id),
    runsSoFar: started.length === 0 ? 0 : Math.max(...started.map((r) => r.run)),
    lastRunStartedAt: started[0]?.startedAt ? new Date(started[0].startedAt) : null,
    running: runs.some((r) => r.inProgress && !r.crashed),
  };
}

function isComplete(arm: ArmState): boolean {
  return arm.maxRuns !== null && arm.runsSoFar >= arm.maxRuns;
}

/** When the arm is next allowed to wake, said the way a person would ask it. */
function nextWake(arm: ArmState, now: Date): string {
  if (isComplete(arm)) return 'never again, it has finished its runs';
  if (arm.paused) return arm.queued ? 'held: a run is queued and waiting for you to resume' : 'not while it is paused';
  if (arm.queued) return 'within a minute, a run is queued';
  if (arm.lastRunStartedAt === null) return 'on the next tick, it has never run';

  const due = nextDueAt(arm.lastRunStartedAt, { paused: arm.paused, intervalHours: arm.intervalHours, note: arm.note });
  if (due === null) return 'on the next tick';
  const deltaMs = due.getTime() - now.getTime();
  if (deltaMs <= 0) return 'within a minute, it is already due';
  return `${formatWallClock(due.toISOString())}, in ${formatElapsedGap(deltaMs)}`;
}

function statusPill(arm: ArmState) {
  if (isComplete(arm)) return <span className="pill pill--done">Finished</span>;
  if (arm.paused) return <span className="pill pill--stop">Paused</span>;
  if (arm.running) return <span className="pill pill--progress">Running now</span>;
  return <span className="pill pill--done">On schedule</span>;
}

export default async function ControlPage() {
  const jar = await cookies();
  const unlocked = tokenMatches(jar.get(CONTROL_COOKIE)?.value);
  const tokenConfigured = controlTokenConfigured();

  const ids = knownArmIds();
  const armStates = await Promise.all(ids.map(loadArmState));
  const now = new Date();

  return (
    <>
      {/* 'run-detail' is the one key that highlights no tab: control is not one of the header's sections. */}
      <Header active="run-detail" arms={discoverArms()} currentArm={null} />
      <div className="shell">
        <h1>Control</h1>
        <p className="page-sub">
          Pause an arm, change how often it wakes, wake one now, or add an arm. Changes land in files on the volume; the scheduler reads them on its
          next minute tick, so nothing here needs a redeploy.
        </p>

        <UnlockForm unlocked={unlocked} tokenConfigured={tokenConfigured} />

        {armStates.length === 0 ? (
          <div className="empty-state">
            <h2>No arms found</h2>
            <p>Nothing under the logs directory and no arm config readable from here.</p>
          </div>
        ) : null}

        {armStates.map((arm) => (
          <section key={arm.id} className="panel ctl-arm">
            <div className="ctl-arm-head">
              <div>
                <h2 className="ctl-arm-title">{arm.label}</h2>
                <div className="ctl-arm-sub mono">
                  {[arm.id, arm.model, arm.promptVariant].filter(Boolean).join(' · ')}
                  {arm.configSource === 'volume' ? ' · created here' : ''}
                  {arm.configSource === null ? ' · no config found, log only' : ''}
                </div>
              </div>
              <div className="pill-row">
                {statusPill(arm)}
                {arm.queued ? <span className="pill ctl-pill-queued">Run queued</span> : null}
              </div>
            </div>

            <div className="ctl-facts">
              <div className="stat">
                <div className="label">Wakes every</div>
                <div className="value">{arm.intervalHours}h</div>
              </div>
              <div className="stat">
                <div className="label">Runs so far</div>
                <div className="value">{arm.maxRuns === null ? arm.runsSoFar : `${arm.runsSoFar}/${arm.maxRuns}`}</div>
              </div>
              <div className="ctl-fact">
                <div className="label">Last run started</div>
                <div>
                  {arm.lastRunStartedAt === null
                    ? 'never'
                    : `${formatWallClock(arm.lastRunStartedAt.toISOString())}, ${formatElapsedGap(now.getTime() - arm.lastRunStartedAt.getTime())} ago`}
                </div>
              </div>
              <div className="ctl-fact">
                <div className="label">Next wake</div>
                <div>{nextWake(arm, now)}</div>
              </div>
            </div>

            {arm.note ? (
              <p className="ctl-note">
                <span className="label">Note</span> {arm.note}
              </p>
            ) : null}

            {unlocked ? (
              <ArmControls
                armId={arm.id}
                label={arm.label}
                paused={arm.paused}
                note={arm.note}
                intervalHours={arm.intervalHours}
                complete={isComplete(arm)}
              />
            ) : null}
          </section>
        ))}

        <h2>Add an arm</h2>
        {unlocked ? (
          <details className="ctl-create-wrap">
            <summary>New arm</summary>
            <p className="ctl-help">
              The config is written to the volume, where the harness looks before the arms shipped in the image. Change one field against an existing
              arm and nothing else, or the comparison measures two things at once.
            </p>
            <CreateArmForm />
          </details>
        ) : (
          <p className="ctl-help">Unlock the controls above to add an arm.</p>
        )}
      </div>
    </>
  );
}
