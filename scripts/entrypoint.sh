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

# Cron overlap locks live on tmpfs, not the volume: a container restart
# should always clear them, since a lock surviving a restart could only be
# stale (see scripts/run-arm.sh for the additional in-process staleness check).
mkdir -p /run/locks

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
