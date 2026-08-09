# Deploying to Railway

One Railway service runs two things in one container: the observatory web
server (always on) and the harness (fired by an in-container cron 4x/day).
They share one container because Railway volumes attach to a single service —
see the Dockerfile and `scripts/` for the how and why.

All commands below are for you to run. Nothing here has been executed against
a real Railway project — the CLI syntax was verified locally against
`railway --help` (this CLI is installed, version 4.27.5), and the Docker
mechanics (users, permissions, cron, locking) were verified in a local
container; see the bottom of this file for exactly what that covered.

## Provision from scratch

```sh
cd /Users/diogo/Dev/Personal/autonomy-observatory

railway login                                   # skip if already logged in
railway init -n autonomy-observatory            # creates + links the project
railway add --service harness                   # empty service, no source yet

# Volume: note --service goes BEFORE `add`, not after — it's an option of
# `railway volume`, not of `add` (verified: `railway volume add --service x`
# errors with "unexpected argument").
railway volume --service harness add --mount-path /data

# The only secret you must set. Everything else (TZ, CLAUDE_CONFIG_DIR,
# CLAUDE_CODE_DISABLE_AUTO_MEMORY, DATA_ROOT, HOSTNAME) is baked into the
# Dockerfile as a plain ENV, not a Railway variable, so it can't be edited
# away from the dashboard by accident.
railway variable set --service harness ANTHROPIC_API_KEY=<from the Anthropic Console>

# Build + deploy from the Dockerfile in this repo.
railway up --service harness --detach

# Public URL for the observatory (also what the healthcheck in railway.json
# and Railway's own idle-detection watch for traffic on).
railway domain --service harness
```

### Variables — what to set and where values come from

| Variable | Where it comes from | Set how |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Console (a real API key, billed to your Anthropic account — this is what pays for every run) | `railway variable set` (above) |
| `TZ`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `DATA_ROOT`, `HOSTNAME` | Fixed by the experiment design | Baked into the Dockerfile — nothing to do |
| `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` | Must NOT exist | Don't set them. If they're already present at the project or shared-variables level, remove them — `entrypoint.sh` refuses to start if either is set, so a misconfigured service fails loudly instead of quietly running unisolated. |
| `PORT` | Injected by Railway automatically once a domain exists | Don't set it yourself — a manual value can conflict with what Railway routes to. |

Verify nothing extra leaked in: `railway variable list --service harness` and
confirm the only things you don't recognize from this table are Railway's own
(`RAILWAY_*`).

## Why not Railway's own `cronSchedule`

`railway.json` supports a `deploy.cronSchedule` field, but that turns the
*whole service* into a run-to-completion job: Railway starts the container,
runs it, and stops it. That's incompatible with also keeping the observatory
web server up between fires, and it would cold-start a container 4x/day
against a volume that's supposed to look continuously live. This is why the
schedule lives inside the container as a real cron daemon instead — see
`scripts/crontab.harness`.

For the same reason, don't set `numReplicas` above 1. The overlap lock in
`scripts/run-arm.sh` is per-container (`/run/locks`, tmpfs); a second replica
would have its own independent lock and could fire concurrently against the
same shared volume.

## Making sure it never sleeps

Railway's sleep feature ("Serverless", formerly "app-sleeping") puts a
service to sleep after ~10 minutes with no *outbound* traffic, and only wakes
on an inbound request — a sleeping container would silently miss every cron
fire, which corrupts the experiment's elapsed-time signal.

**Verified against Railway's current docs (docs.railway.com/reference and
/guides, checked 9 Aug 2026), not assumed:** Serverless is opt-in and off by
default for new services. It is not something you need to disable — only
something you must not turn on. Confirm this once after provisioning:

- Railway dashboard → the `harness` service → Settings → Deploy → **Serverless**
  should show the toggle **off**.

`railway.json` in this repo also sets `restartPolicyType: "ALWAYS"` with 10
retries, so if the container crashes for any reason (not sleep — an actual
crash), Railway restarts it rather than leaving it dead until someone notices.
The one gap this doesn't close: if the container is down for any reason
(crash-restart cycling, a bad deploy) across a scheduled fire time, that fire
is lost — there's no catch-up mechanism. Worth an external uptime check
(pinging the domain) if a missed fire ever needs to be *known about* rather
than just rare.

## Verifying the deploy is healthy

```sh
railway logs --service harness                      # stream logs
```

Look for, in order: supervisord starting, `cron` and `web` both reaching
`RUNNING`, and the observatory's own "ready"/listening line.

```sh
curl -I https://<the-domain-from-railway-domain>/
```

Expect `200`. (`railway.json`'s healthcheckPath is `/` — if the observatory
doesn't serve 200 at root once it's built, e.g. it redirects or requires
auth, update `healthcheckPath` in `railway.json` accordingly.)

**Confirming the schedule actually fires**, without waiting up to 6 hours:

```sh
railway logs --service harness --since 1d --filter "run-arm"
```

You should see, 4x/day at 06:17/12:17/18:17/23:17 Europe/Lisbon, a
`run-arm[a]: starting` line followed by `arm=a terminal_reason=...` (printed
by `cli.ts` itself) and `run-arm[a]: exited status=0`.

To prove the whole path immediately rather than waiting for a real fire, you
can `railway ssh --service harness` in and run `/app/scripts/run-arm.sh a`
by hand — **this executes a real run against the real API key and spends
real budget** (`arms/a.yaml`: up to 40,000 billed tokens / $2 per invocation),
so only do this once, deliberately, not as a routine check.

To inspect the event log directly: `railway ssh --service harness`, then
`cat /data/logs/a.jsonl`.

## What was validated vs. not

Validated locally (Docker daemon on this Mac, `docker build` + `docker run`,
9 Aug 2026):
- Multi-stage build succeeds for the harness stage (`npm ci --omit=dev`
  against the real `package.json`/`package-lock.json`).
- The runtime stage builds and runs against a **stubbed** observatory output
  (real `observatory/` has code now but doesn't typecheck yet — that's the
  other agent's in-progress work, not this Dockerfile).
- `/app` is root-owned and unwritable by both `harness` and `agent`
  (confirmed both get `Permission denied`).
- `/data/workspaces`, `/data/logs`, `/data/claude-config` are chowned to
  `agent` at boot with the intended modes; `harness` gets `Permission denied`
  writing to the workspace.
- `TZ=Europe/Lisbon` resolves correctly system-wide (`date` inside the
  container showed `WEST`, the correct Aug-2026 DST abbreviation).
- The cron.d file installs with correct content/permissions.
- End-to-end: manually firing `run-arm.sh a` as root against the **real**
  `src/cli.ts` (with a dummy `ANTHROPIC_API_KEY`) correctly: acquired the
  lock, dropped to `agent` via `su`, ran the harness, which created the git
  repo in `/data/workspaces/a` (agent-owned), wrote `/data/logs/a.jsonl`
  (agent-owned, world-readable), wrote SDK session state into
  `/data/claude-config` (agent-owned, `700`), failed cleanly at the API call
  with "Invalid API key" (expected — the key was a dummy), logged a
  `harness_error` + `run_ended` event, and exited 0.
- Overlap lock: manually holding the lock caused a second invocation to log
  `skip, previous run still active` and exit 0 without touching the lock.
- Stale-lock reclaim: a lock backdated 4 hours was correctly reclaimed and
  the run proceeded.

**Not validated** (can't be, without deploying, and not something I should
be the one to deploy):
- The real observatory build (it doesn't typecheck yet).
- Whether Next's real standalone output's own `package.json` correctly
  declares its module type — see the risk note below; the stub needed one
  added by hand to run at all, which is a real (if likely self-resolving)
  interaction worth confirming once the real build exists.
- Anything about actual Railway behavior (volume mount permissions on
  Railway's infrastructure specifically, whether `railway add --service`
  with no image/repo behaves as assumed, real cron fire timing over a DST
  boundary).
- The observatory's real healthcheck path/response.

## Fallback if the volume looks unwritable on Railway specifically

Railway's own volume docs flag that non-root images can hit permission
issues with a fresh volume mount, with `RAILWAY_RUN_UID=0` as their
documented escape hatch. This image starts as root anyway (that's how
`entrypoint.sh` chowns `/data` before dropping privileges), so this
shouldn't be needed — but if `/data` ever comes up owned by something
`entrypoint.sh` can't chown, set `RAILWAY_RUN_UID=0` on the service and
redeploy before digging further.
