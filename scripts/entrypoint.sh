#!/bin/sh
# Container entrypoint. Runs as root (the image sets no USER), fixes up the
# volume and fails fast on a misconfigured auth setup, then hands off to
# supervisord, which does everything else as the two unprivileged users.
set -eu

# Config isolation is non-negotiable: either of these silently outranks
# ANTHROPIC_API_KEY in the SDK's auth precedence and invalidates every run
# in the experiment.
if [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] || [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "FATAL: ANTHROPIC_AUTH_TOKEN / CLAUDE_CODE_OAUTH_TOKEN must not be set on this service. Remove them from the Railway variables." >&2
  exit 1
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "FATAL: ANTHROPIC_API_KEY is not set." >&2
  exit 1
fi

# /data is the Railway volume: empty on first deploy, so ownership has to be
# fixed at boot rather than baked into the image. Non-recursive on purpose —
# a recursive chown over months of accumulated git history and event-log
# growth would slow down every restart.
mkdir -p /data/workspaces /data/logs /data/claude-config
chown agent:agent /data /data/workspaces /data/logs /data/claude-config
chmod 0755 /data /data/workspaces /data/logs
chmod 0700 /data/claude-config

# The control plane, owned by the web server because that is the only process
# that writes it: pause flags, cadence, queued one-off runs, and any arm config
# authored in the observatory. The scheduler and the agent only read it, and
# both run as other users, so these stay world-readable. Nothing here is inside
# any workspace, so no agent can see it — the boundary check already refuses
# every path outside /data/workspaces/<its own arm>.
mkdir -p /data/control/arms /data/control/queue /data/arms
chown -R harness:harness /data/control /data/arms
chmod 0755 /data/control /data/control/arms /data/control/queue /data/arms

# The set of arms this container serves, read from the same configs cli.ts
# loads rather than hardcoded here — onboarding a sixth arm is dropping in
# arms/f.yaml, its DEPLOY_KEY_F_B64 / WORKSPACE_REPO_F variables, and a
# crontab.harness line, never a change to this script.
# An arm id may contain hyphens; a shell variable name may not. Without the
# translation, `DEPLOY_KEY_COLD-1_B64` parses as a use-default expansion of
# DEPLOY_KEY_COLD and yields a literal string, which base64 then fails to
# decode — killing this script under `set -e` before supervisord starts, with
# no logs and a healthcheck that just times out.
env_suffix() {
  printf '%s' "$1" | tr 'a-z-' 'A-Z_'
}

ARMS=$(cd /app/arms && ls *.yaml 2>/dev/null | sed 's/\.yaml$//')
if [ -z "$ARMS" ]; then
  echo "FATAL: no arm configs found under /app/arms/*.yaml" >&2
  exit 1
fi

# Per-arm deploy keys for the offsite backup, plus one shared key for the
# data repo (all arms' logs live in one repo — see DATA_REPO in DEPLOY.md).
# Written at boot rather than baked into the image so rotating a key is a
# variable change and a restart. One ssh alias per repo: only the alias,
# never github.com directly, is what selects the right key. An arm with no
# DEPLOY_KEY_<ARM>_B64 set just gets no alias — backup.sh treats that as a
# skip for that arm, not a failure (see scripts/backup.sh).
SSH_DIR=/home/agent/.ssh
mkdir -p "$SSH_DIR"
: > "$SSH_DIR/config"

for arm in $ARMS; do
  arm_upper=$(env_suffix "$arm")
  eval "key_b64=\${DEPLOY_KEY_${arm_upper}_B64:-}"
  if [ -n "$key_b64" ]; then
    printf '%s' "$key_b64" | base64 -d > "$SSH_DIR/workspace_${arm}"
    cat >> "$SSH_DIR/config" <<EOF
Host github-workspace-${arm}
  HostName github.com
  User git
  IdentityFile ~/.ssh/workspace_${arm}
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
  fi
done

if [ -n "${DEPLOY_KEY_DATA_B64:-}" ]; then
  printf '%s' "$DEPLOY_KEY_DATA_B64" | base64 -d > "$SSH_DIR/data"
  cat >> "$SSH_DIR/config" <<EOF
Host github-data
  HostName github.com
  User git
  IdentityFile ~/.ssh/data
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
fi

chmod 0700 "$SSH_DIR"
chmod 0600 "$SSH_DIR"/* 2>/dev/null || true
chown -R agent:agent "$SSH_DIR"

# git refuses to operate on a repo owned by another user; the volume's repos
# are the agent's, and only the agent ever touches them.
su -s /bin/sh -c 'git config --global --add safe.directory "*"' agent 2>/dev/null || true

# cron does not pass its own environment to the jobs it starts: a job sees only
# HOME, PATH, SHELL and whatever the crontab file itself declares. None of this
# service's variables reach it, so the run finds no API key and the SDK fails
# with "Not logged in". Snapshot what a run needs where run-arm.sh can source
# it. Root-only, on tmpfs, rewritten every boot.
umask 077
: > /run/harness.env
for v in ANTHROPIC_API_KEY DATA_ROOT CLAUDE_CONFIG_DIR CLAUDE_CODE_DISABLE_AUTO_MEMORY \
         DATA_REPO TZ; do
  eval "value=\${$v:-}"
  [ -n "$value" ] && printf '%s=%s\n' "$v" "$value" >> /run/harness.env
done
# Per-arm variables need the same snapshot treatment as the shared ones
# above — WORKSPACE_REPO_<ARM> (backup.sh's push target) and
# HEALTHCHECK_URL_<ARM> (run-arm.sh's heartbeat). Skipping this loop is
# exactly how the single-arm version of this file broke once before: a
# variable that works by hand but not under cron.
for arm in $ARMS; do
  arm_upper=$(env_suffix "$arm")
  for v in "WORKSPACE_REPO_${arm_upper}" "HEALTHCHECK_URL_${arm_upper}"; do
    eval "value=\${$v:-}"
    [ -n "$value" ] && printf '%s=%s\n' "$v" "$value" >> /run/harness.env
  done
done
chmod 600 /run/harness.env

# Cron overlap locks live on tmpfs, not the volume: a container restart
# should always clear them, since a lock surviving a restart could only be
# stale (see scripts/run-arm.sh for the additional in-process staleness check).
mkdir -p /run/locks

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
