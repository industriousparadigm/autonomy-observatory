#!/bin/sh
# Fired by root's crontab (see crontab.harness). Runs as root itself so it can
# write to /proc/1/fd/1 — supervisord's stdout, which Railway captures — before
# dropping to the unprivileged `agent` user for the actual run: a non-root
# process cannot open another process's /proc/<pid>/fd/*, only its own, so the
# redirect has to happen before the su, not after.
#
# Overlap safety: a run for a given arm must never start while that same
# arm's previous run is still going. The lock is scoped per arm
# (/run/locks/<arm>.lock) on purpose: five arms share this container and are
# expected to run concurrently when their staggered wakes land close together
# or one runs long — only a repeat of the same arm is ever blocked. The lock
# is a directory under tmpfs (/run), so a container restart always clears it
# for free; the age check below additionally reclaims a lock left behind by a
# run that wedged without the container restarting.
set -eu

# Restore the service environment. Running this by hand from a shell works
# without it, which is exactly why its absence went unnoticed: only cron starts
# the job with a stripped environment, so only the scheduled run failed.
if [ -f /run/harness.env ]; then
  set -a
  . /run/harness.env
  set +a
fi

ARM="${1:?usage: run-arm.sh <arm>}"
LOCK="/run/locks/${ARM}.lock"
STALE_SECONDS=10800 # 3h: no real run should take this long; older locks are wedged, not overlapping.

mkdir -p /run/locks

if [ -d "$LOCK" ]; then
  age=$(( $(date +%s) - $(date -r "$LOCK" +%s) ))
  if [ "$age" -gt "$STALE_SECONDS" ]; then
    echo "$(date -Iseconds) run-arm[$ARM]: reclaiming stale lock (age ${age}s)"
    rmdir "$LOCK" 2>/dev/null || rm -rf "$LOCK"
  else
    echo "$(date -Iseconds) run-arm[$ARM]: skip, previous run still active (lock age ${age}s)"
    exit 0
  fi
fi

mkdir "$LOCK" 2>/dev/null || {
  echo "$(date -Iseconds) run-arm[$ARM]: skip, lost race acquiring lock"
  exit 0
}
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM

echo "$(date -Iseconds) run-arm[$ARM]: starting"
set +e
su -s /bin/sh -c "cd /app && exec node --experimental-strip-types src/cli.ts run --arm '$ARM'" agent
status=$?
set -e
echo "$(date -Iseconds) run-arm[$ARM]: exited status=$status"

# Offsite backup, after the run and never allowed to affect its outcome.
set +e
su -s /bin/sh -c "/app/scripts/backup.sh '$ARM'" agent
backup_status=$?
set -e

# Heartbeat covers the whole fire (run + backup), not just the run: a backup
# that silently stops advancing is exactly the failure this can't afford to
# stay invisible to (see scripts/backup.sh). Per-arm (HEALTHCHECK_URL_<ARM>)
# so one arm going quiet shows up as its own check going Late/Down, not
# masked by four other arms still pinging on time. Inert unless that arm's
# variable is set — see DEPLOY.md. Never allowed to affect $status, same as
# backup above.
ARM_UPPER=$(printf '%s' "$ARM" | tr 'a-z' 'A-Z')
eval "healthcheck_url=\${HEALTHCHECK_URL_${ARM_UPPER}:-}"
if [ -n "$healthcheck_url" ]; then
  if [ "$status" -eq 0 ] && [ "$backup_status" -eq 0 ]; then
    curl -fsS -m 10 --retry 2 -o /dev/null "$healthcheck_url" || true
  else
    curl -fsS -m 10 --retry 2 -o /dev/null "${healthcheck_url}/fail" || true
  fi
fi

exit "$status"
