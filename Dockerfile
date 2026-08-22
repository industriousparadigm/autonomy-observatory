# syntax=docker/dockerfile:1

################################################################################
# Stage 1: harness runtime dependencies.
# cli.ts runs straight off src/*.ts via `node --experimental-strip-types` —
# there is no compile step for the harness, so this stage only needs the
# production dependency tree (@anthropic-ai/claude-agent-sdk, yaml, zod).
################################################################################
FROM node:22-bookworm-slim AS harness-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

################################################################################
# Stage 2: observatory build (Next.js standalone output).
# Not owned by this Dockerfile's author — assumes observatory/ has its own
# package.json with a "build" script and next.config setting
# `output: "standalone"`. Unverified end-to-end: observatory/ has no code yet,
# so this stage will fail until it lands. Revisit once it does.
################################################################################
FROM node:22-bookworm-slim AS observatory-build
WORKDIR /app/observatory
COPY observatory/package.json observatory/package-lock.json* ./
RUN npm ci || npm install
COPY observatory/ ./
# Next.js only emits public/ when there are static assets, and the runtime
# stage copies it unconditionally. Guaranteeing it here rather than relying on
# a directory existing in the host checkout: an empty one does not survive git.
RUN mkdir -p /app/observatory/public && npm run build

################################################################################
# Stage 3: runtime image.
################################################################################
FROM node:22-bookworm-slim AS runtime

# git: the agent's workspace is a git repo the harness commits to every run.
# cron + supervisor: see scripts/supervisord.conf and scripts/crontab.harness
# for the scheduling design.
# tzdata: DST-aware Europe/Lisbon wall-clock scheduling needs the real
# zoneinfo database. Debian slim ships without it — TZ alone resolves to
# nothing without /usr/share/zoneinfo present.
# curl: the optional per-arm HEALTHCHECK_URL_<ARM> heartbeat in run-arm.sh.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      openssh-client \
      cron \
      supervisor \
      tzdata \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Europe/Lisbon
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo "$TZ" > /etc/timezone

# Next.js standalone server.js defaults to binding localhost on some
# versions; force it to bind the container interface.
ENV HOSTNAME=0.0.0.0

ENV DATA_ROOT=/data
# Config isolation (non-negotiable, see arms/*.yaml + src/harness.ts): the
# agent must not inherit ambient Claude Code config or memory. ANTHROPIC_API_KEY
# is set as a Railway variable, not baked in here — see DEPLOY.md.
ENV CLAUDE_CONFIG_DIR=/data/claude-config
ENV CLAUDE_CODE_DISABLE_AUTO_MEMORY=1

# Two unprivileged users, neither able to write /app (root-owned, locked below).
# harness: the always-on web server + the scheduler (cron itself still needs
#          root — see crontab.harness for why — but nothing content-related
#          runs as root beyond that).
# agent:   every `cli.ts run` invocation. This is the one process that both
#          does harness bookkeeping (event log append, git commit) and
#          executes the LLM's tool calls, because the SDK runs tools in-process
#          rather than in a separate sandboxed subprocess. See DEPLOY.md for
#          exactly what this separation does and doesn't buy.
# `mailbox` is the one group both users share, and it exists for exactly one
# directory: the mailbox, where each process has to move files the other
# created. Named `mailbox` rather than `mail` because Debian already ships a
# `mail` group and quietly joining it would widen these two accounts by more
# than this needs.
RUN groupadd --gid 10003 mailbox \
 && useradd --uid 10001 --create-home --home-dir /home/harness --shell /usr/sbin/nologin harness \
 && useradd --uid 10002 --create-home --home-dir /home/agent   --shell /usr/sbin/nologin agent \
 && usermod -aG mailbox harness \
 && usermod -aG mailbox agent

WORKDIR /app
COPY package.json ./
COPY --from=harness-deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY arms/ ./arms/

# Standalone output nests public/ and .next/static as siblings of server.js,
# not flattened to the WORKDIR root, to match the path this experiment's
# harness was told to launch: observatory/.next/standalone/server.js.
COPY --from=observatory-build /app/observatory/.next/standalone ./observatory/.next/standalone
COPY --from=observatory-build /app/observatory/public ./observatory/.next/standalone/public
COPY --from=observatory-build /app/observatory/.next/static ./observatory/.next/standalone/.next/static

COPY scripts/entrypoint.sh scripts/run-arm.sh scripts/backup.sh scripts/tick.sh /app/scripts/
COPY scripts/supervisord.conf /etc/supervisor/conf.d/harness.conf
COPY scripts/crontab.harness /etc/cron.d/harness

RUN chmod 0755 /app/scripts/entrypoint.sh /app/scripts/run-arm.sh /app/scripts/backup.sh /app/scripts/tick.sh \
 && chmod 0644 /etc/cron.d/harness \
 && chmod -R a-w /app

# /data is the Railway volume mount, empty on first deploy — entrypoint.sh
# fixes ownership at boot since this image can't own volume content at build
# time.
RUN mkdir -p /data

EXPOSE 3000

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
