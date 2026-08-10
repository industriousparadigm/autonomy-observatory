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

# Per-repo deploy keys for the offsite backup. Written at boot rather than
# baked into the image so rotating a key is a variable change and a restart.
# Two keys, one host: only an ssh alias per repo can select between them.
SSH_DIR=/home/agent/.ssh
if [ -n "${DEPLOY_KEY_WORKSPACE_A_B64:-}" ] || [ -n "${DEPLOY_KEY_DATA_B64:-}" ]; then
  mkdir -p "$SSH_DIR"
  [ -n "${DEPLOY_KEY_WORKSPACE_A_B64:-}" ] &&
    printf '%s' "$DEPLOY_KEY_WORKSPACE_A_B64" | base64 -d > "$SSH_DIR/workspace_a"
  [ -n "${DEPLOY_KEY_DATA_B64:-}" ] &&
    printf '%s' "$DEPLOY_KEY_DATA_B64" | base64 -d > "$SSH_DIR/data"
  cat > "$SSH_DIR/config" <<'EOF'
Host github-workspace-a
  HostName github.com
  User git
  IdentityFile ~/.ssh/workspace_a
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
Host github-data
  HostName github.com
  User git
  IdentityFile ~/.ssh/data
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
  chmod 0700 "$SSH_DIR"
  chmod 0600 "$SSH_DIR"/* 2>/dev/null || true
  chown -R agent:agent "$SSH_DIR"
fi

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
         WORKSPACE_REPO DATA_REPO ARM TZ; do
  eval "value=\${$v:-}"
  [ -n "$value" ] && printf '%s=%s\n' "$v" "$value" >> /run/harness.env
done
chmod 600 /run/harness.env

# Cron overlap locks live on tmpfs, not the volume: a container restart
# should always clear them, since a lock surviving a restart could only be
# stale (see scripts/run-arm.sh for the additional in-process staleness check).
mkdir -p /run/locks

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
