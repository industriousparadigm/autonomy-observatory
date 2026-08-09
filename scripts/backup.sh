#!/bin/sh
# Offsite copy of the two things that cannot be regenerated: the agent's
# workspace and the event log. The Railway volume is a single point of failure
# and this experiment is meant to run for months.
#
# Runs as `agent`, after the run, and is deliberately non-fatal: a push failure
# must never cost us a run or mask its exit status. Push errors are logged and
# the next run retries, since git is cumulative.
set -u

ARM="${1:?usage: backup.sh <arm>}"
DATA_ROOT="${DATA_ROOT:-/data}"
WORKSPACE="${DATA_ROOT}/workspaces/${ARM}"
LOGREPO="${DATA_ROOT}/logrepo"

log() { echo "$(date -Iseconds) backup[$ARM]: $*"; }

if [ ! -d "${HOME:-/home/agent}/.ssh" ]; then
  log "no ssh keys present, skipping"
  exit 0
fi

# The agent's workspace, exactly as committed by the harness.
if [ -n "${WORKSPACE_REPO:-}" ] && [ -d "$WORKSPACE/.git" ]; then
  git -C "$WORKSPACE" remote add origin "$WORKSPACE_REPO" 2>/dev/null ||
    git -C "$WORKSPACE" remote set-url origin "$WORKSPACE_REPO"
  if git -C "$WORKSPACE" push -q origin HEAD:refs/heads/main 2>&1; then
    log "workspace pushed"
  else
    log "workspace push failed (will retry next run)"
  fi
fi

# The event log is the source of truth, so it gets its own history.
if [ -n "${DATA_REPO:-}" ]; then
  if [ ! -d "$LOGREPO/.git" ]; then
    mkdir -p "$LOGREPO"
    git -C "$LOGREPO" init -q
    git -C "$LOGREPO" config user.email "harness@autonomy-observatory.local"
    git -C "$LOGREPO" config user.name "harness"
    git -C "$LOGREPO" remote add origin "$DATA_REPO"
  fi
  cp "${DATA_ROOT}/logs/${ARM}.jsonl" "$LOGREPO/${ARM}.jsonl" 2>/dev/null || true
  git -C "$LOGREPO" add -A
  if git -C "$LOGREPO" diff --cached --quiet; then
    log "no new events to commit"
  else
    git -C "$LOGREPO" commit -q -m "arm ${ARM}: $(wc -l < "${DATA_ROOT}/logs/${ARM}.jsonl" | tr -d ' ') events"
  fi

  # Push unconditionally, not only when this run committed. A commit that
  # succeeded while its push failed would otherwise never be retried — the next
  # run sees a clean index and skips, and the backup silently stops advancing.
  if git -C "$LOGREPO" push -q origin HEAD:refs/heads/main 2>&1; then
    log "event log pushed"
  else
    log "event log push failed (will retry next run)"
  fi
fi

exit 0
