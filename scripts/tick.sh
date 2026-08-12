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
