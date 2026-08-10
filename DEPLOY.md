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
| `WORKSPACE_REPO`, `DATA_REPO` | The two GitHub repos `backup.sh` mirrors to (see "Offsite backup" below) | `railway variable set`, using the `github-workspace-a` / `github-data` SSH aliases, e.g. `git@github-data:you/observatory-log.git` |
| `DEPLOY_KEY_WORKSPACE_A_B64`, `DEPLOY_KEY_DATA_B64` | A base64'd SSH deploy key (write access) for each repo above | `railway variable set --service harness DEPLOY_KEY_DATA_B64="$(base64 < path/to/key)"` |
| `HEALTHCHECK_URL` | A healthchecks.io check's ping URL (optional; see "Detecting a missed or failed run" below) | `railway variable set`. Omit entirely to leave the heartbeat off. |

Verify nothing extra leaked in: `railway variable list --service harness` and
confirm the only things you don't recognize from this table are Railway's own
(`RAILWAY_*`).

## Offsite backup: creating the two repos

`backup.sh` mirrors two things off the Railway volume after every run: the
agent's workspace (`WORKSPACE_REPO`) and the event log (`DATA_REPO`). Each is
authenticated with its own deploy key and reached through the
`github-workspace-a` / `github-data` SSH aliases `entrypoint.sh` writes to
`~/.ssh/config` — that alias, not `github.com` directly, is what selects the
right key, so both variables must be written in that form.

**Create both repos completely empty.** Do not tick "Add a README file", and
don't add a `.gitignore` or license template. Any of those gives the repo an
initial commit with no shared history with the harness's own — the first
push is then rejected as non-fast-forward. `backup.sh` recovers from this
automatically (fetch, then `push --force-with-lease`: the harness is the sole
writer to both repos, so its local history is always the complete record and
safe to force onto a remote that only ever diverges by way of this
initializer commit) but an empty repo avoids the situation, and the one extra
reconcile it costs, in the first place.

## Detecting a missed or failed run (heartbeat)

Nothing above watches whether a scheduled fire actually happened — the
observatory web server stays green regardless, and stale data on the site is
otherwise the only symptom. `run-arm.sh` closes this with an optional
heartbeat, following the healthchecks.io ping convention:

- Set `HEALTHCHECK_URL` to a healthchecks.io check's ping URL
  (`https://hc-ping.com/<uuid>`) and `run-arm.sh` pings it after every fire —
  the bare URL on success, `<HEALTHCHECK_URL>/fail` if either the agent's run
  or the backup step failed. A backup that silently stops advancing (the
  failure mode `backup.sh` used to be able to hide) now trips this the same
  as a crashed run.
- **Off by default, safe by default.** Leave `HEALTHCHECK_URL` unset and
  nothing is ever contacted — no third-party account is required to run this
  experiment.
- Set the check's schedule in healthchecks.io to match `crontab.harness`:
  period ~6h (the widest gap between 06:17/12:17/18:17/23:17), with enough
  grace (~1h) to cover a slow run without false-alerting. A missed or failed
  fire then shows as the check going "Late" or "Down" on the healthchecks.io
  dashboard (and by email/Slack/whatever that check is wired to) — that's the
  "somebody would find out" this experiment was otherwise missing.

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
is lost — there's no catch-up mechanism. See "Detecting a missed or failed
run" above for how to actually find out when that happens, rather than just
assuming it's rare.

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
  (real `observatory/` had code but didn't typecheck yet at this point — see
  the 10 Aug entry below for the real build).
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

Validated locally (10 Aug 2026, this pass — `backup.sh` reconciliation and
the heartbeat):
- The runtime image now builds against the **real** `observatory/` (it
  typechecks and builds cleanly as of this pass — superseding the "doesn't
  typecheck yet" note this section used to carry).
- Wedged index (`.git/index.lock` present): against a throwaway repo,
  `git add -A` fails and `git diff --cached --quiet` still reports clean —
  confirmed `backup.sh` now logs "git add failed, index may be wedged"
  distinctly, instead of the previous "no new events to commit", and returns
  a non-zero exit. Confirmed no event was lost: the missed line was picked up
  and committed on the very next run.
- Diverged remote (bare repo seeded with an unrelated "Initial commit",
  reproducing the GitHub "Add a README" case): the first push was rejected
  non-fast-forward, `backup.sh` fetched and force-with-lease-pushed past it
  automatically in the same run, and every subsequent push was a normal
  fast-forward. No committed event was ever lost across the divergence.
- Unreachable remote: push and the fetch-and-retry both fail distinctly and
  `backup.sh` exits non-zero, rather than the old unconditional success.
- Heartbeat, in a running container (real `entrypoint.sh` → `supervisord` →
  manually fired `run-arm.sh a`, pinging a local mock HTTP server standing in
  for healthchecks.io): a normal run (dummy key → `harness_error`, backup
  skipped for no ssh keys) pinged the bare `HEALTHCHECK_URL`; forcing the
  backup step to fail (bad deploy key, unreachable `DATA_REPO`) while the
  agent run itself still exited 0 correctly pinged `${HEALTHCHECK_URL}/fail`
  instead — proving a silent backup failure is no longer indistinguishable
  from a healthy run. With `HEALTHCHECK_URL` unset, confirmed zero network
  calls (no curl output, no hit on the mock server) and confirmed the
  variable survives into `/run/harness.env` when it is set, so it reaches a
  cron-triggered run and not just a manual one.
- The real standalone `server.js` starts cleanly under `supervisord` and
  serves `200` at `/` — the module-type and healthcheck-path risks this
  section used to flag as unresolved are both resolved now that the real
  build exists to check against.

**Not validated** (can't be, without deploying, and not something I should
be the one to deploy):
- A real healthchecks.io check and real GitHub repos end-to-end — the above
  used a synthetic ping target and local bare repos, not the real services.
- Anything about actual Railway behavior (volume mount permissions on
  Railway's infrastructure specifically, whether `railway add --service`
  with no image/repo behaves as assumed, real cron fire timing over a DST
  boundary).

## Fallback if the volume looks unwritable on Railway specifically

Railway's own volume docs flag that non-root images can hit permission
issues with a fresh volume mount, with `RAILWAY_RUN_UID=0` as their
documented escape hatch. This image starts as root anyway (that's how
`entrypoint.sh` chowns `/data` before dropping privileges), so this
shouldn't be needed — but if `/data` ever comes up owned by something
`entrypoint.sh` can't chown, set `RAILWAY_RUN_UID=0` on the service and
redeploy before digging further.
