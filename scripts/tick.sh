#!/bin/sh
# One scheduler tick, fired every minute by cron.
#
# This replaced a static line-per-arm crontab. The crontab could only be
# changed by rebuilding the image, which made "pause this arm" and "change the
# cadence" deploys rather than decisions — and the observatory could not offer
# them at all. Due-ness now comes from `cli.ts due`, which reads each arm's
# control file off the volume and each arm's own event log, so a cadence change
# takes effect on the next tick.
#
# Runs as root, same as the old per-arm lines did, so run-arm.sh can still
# write to the container's captured stdout before dropping to `agent`.
#
# Deliberately dumb: it asks which arms are due and runs them, one at a time.
# Sequential because five concurrent runs in one container was never the
# intent — the old schedule staggered them by six minutes for exactly this
# reason, and doing them in series is a simpler way to get the same property.
# run-arm.sh still holds a per-arm lock, so a run that outlives its interval
# blocks only itself.
set -eu

# One dispatcher at a time, or a tick that outlives its minute double-runs an
# arm. Observed on the first production tick: the 23:52 tick was still working
# through six due arms when the 23:53 tick computed its own due list from the
# same still-unrun state, and standard-3 ran twice 3m42s apart instead of 8h
# apart. run-arm.sh's per-arm lock cannot catch that, because the second run
# starts after the first has finished and released it.
#
# On tmpfs, so a container restart always clears it. No staleness reclaim: a
# wedged tick is bounded by the runs it dispatches, each of which run-arm.sh
# already age-limits, and a missed tick costs at most a minute.
TICK_LOCK=/run/tick.lock
if ! mkdir "$TICK_LOCK" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$TICK_LOCK" 2>/dev/null || true' EXIT INT TERM

if [ -f /run/harness.env ]; then
  set -a
  . /run/harness.env
  set +a
fi

DATA_ROOT="${DATA_ROOT:-/data}"
QUEUE_DIR="${DATA_ROOT}/control/queue"

DUE=$(cd /app && node --experimental-strip-types src/cli.ts due 2>/dev/null || true)
[ -z "$DUE" ] && exit 0

for arm in $DUE; do
  # Consumed before the run, not after: a queued trigger is a request for one
  # run, and a run that fails has still had its turn. Leaving it would retry a
  # failing arm every minute for as long as it keeps failing.
  rm -f "${QUEUE_DIR}/${arm}"
  /app/scripts/run-arm.sh "$arm" || true
done
