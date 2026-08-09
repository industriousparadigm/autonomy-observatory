#!/bin/sh
# Fired by root's crontab (see crontab.harness). Runs as root itself so it can
# write to /proc/1/fd/1 — supervisord's stdout, which Railway captures — before
# dropping to the unprivileged `agent` user for the actual run: a non-root
# process cannot open another process's /proc/<pid>/fd/*, only its own, so the
# redirect has to happen before the su, not after.
#
# Overlap safety: a run must never start while the previous one is still
# going. The lock is a directory under tmpfs (/run), so a container restart
# always clears it for free; the age check below additionally reclaims a lock
# left behind by a run that wedged without the container restarting.
set -eu

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
exit "$status"
