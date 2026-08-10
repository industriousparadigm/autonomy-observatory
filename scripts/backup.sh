#!/bin/sh
# Offsite copy of the two things that cannot be regenerated: the agent's
# workspace and the event log. The Railway volume is a single point of failure
# and this experiment is meant to run for months.
#
# Runs as `agent`, after the run. Never allowed to affect the run's own exit
# status (run-arm.sh discards it there) — but this script's exit status is
# still meaningful: run-arm.sh reads it to decide the heartbeat ping (see
# HEALTHCHECK_URL in DEPLOY.md), so every failure path below must actually
# return non-zero instead of being swallowed.
set -u

ARM="${1:?usage: backup.sh <arm>}"
DATA_ROOT="${DATA_ROOT:-/data}"
WORKSPACE="${DATA_ROOT}/workspaces/${ARM}"
LOGREPO="${DATA_ROOT}/logrepo"
rc=0

log() { echo "$(date -Iseconds) backup[$ARM]: $*"; }

if [ ! -d "${HOME:-/home/agent}/.ssh" ]; then
  log "no ssh keys present, skipping"
  exit 0
fi

# Push HEAD to origin/main, reconciling a non-fast-forward rejection instead
# of leaving it permanent. Both repos are single-writer (only this script
# ever pushes to them), so local history is always the complete record and a
# rejection means only one thing: the GitHub repo was created with an initial
# commit (e.g. the "Add a README" checkbox) that shares no ancestry with
# ours. force-with-lease over rebase: rebase can hit a real conflict (e.g. a
# same-path edit in the workspace repo) and leave the repo mid-rebase,
# silently wedging every future commit until a human intervenes; force-with-
# lease always completes, and gated on the remote ref we just fetched, can
# only ever discard that disposable initializer, never a commit a second
# writer produced — safe for the append-only log for the same reason.
push_reconciling() {
  repo="$1"
  if git -C "$repo" push -q origin HEAD:refs/heads/main 2>&1; then
    return 0
  fi
  log "push rejected for $repo, fetching to reconcile"
  if ! git -C "$repo" fetch -q origin main 2>&1; then
    return 1
  fi
  git -C "$repo" push -q --force-with-lease origin HEAD:refs/heads/main 2>&1
}

# The agent's workspace, exactly as committed by the harness.
if [ -n "${WORKSPACE_REPO:-}" ] && [ -d "$WORKSPACE/.git" ]; then
  git -C "$WORKSPACE" remote add origin "$WORKSPACE_REPO" 2>/dev/null ||
    git -C "$WORKSPACE" remote set-url origin "$WORKSPACE_REPO"
  if push_reconciling "$WORKSPACE"; then
    log "workspace pushed"
  else
    log "workspace push failed (will retry next run)"
    rc=1
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

  # add and commit are checked individually: a wedged index makes `add` fail
  # while leaving the index itself untouched, so `diff --cached --quiet`
  # below would still see it as clean and log the same reassuring "nothing to
  # commit" as a genuinely quiet run — the two must never look alike.
  if ! git -C "$LOGREPO" add -A; then
    log "git add failed, index may be wedged"
    rc=1
  elif git -C "$LOGREPO" diff --cached --quiet; then
    log "no new events to commit"
  elif ! git -C "$LOGREPO" commit -q -m "arm ${ARM}: $(wc -l < "${DATA_ROOT}/logs/${ARM}.jsonl" | tr -d ' ') events"; then
    log "git commit failed"
    rc=1
  fi

  # Push unconditionally, not only when this run committed. A commit that
  # succeeded while its push failed would otherwise never be retried — the next
  # run sees a clean index and skips, and the backup silently stops advancing.
  if push_reconciling "$LOGREPO"; then
    log "event log pushed"
  else
    log "event log push failed (will retry next run)"
    rc=1
  fi
fi

exit "$rc"
