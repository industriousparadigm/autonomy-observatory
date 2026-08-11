# Deploying to Railway

One Railway service runs two things in one container: the observatory web
server (always on) and the harness (fired by an in-container cron). Five
arms — `a` through `e` — each wake every 3 hours, staggered a few minutes
apart so their 2-4min runs never start at once while sharing the one
container. They share one container because Railway volumes attach to a
single service — see the Dockerfile and `scripts/` for the how and why.

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
| `ANTHROPIC_API_KEY` | Anthropic Console (a real API key, billed to your Anthropic account — this is what pays for every run, across all five arms) | `railway variable set` (above) |
| `TZ`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `DATA_ROOT`, `HOSTNAME` | Fixed by the experiment design | Baked into the Dockerfile — nothing to do |
| `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` | Must NOT exist | Don't set them. If they're already present at the project or shared-variables level, remove them — `entrypoint.sh` refuses to start if either is set, so a misconfigured service fails loudly instead of quietly running unisolated. |
| `PORT` | Injected by Railway automatically once a domain exists | Don't set it yourself — a manual value can conflict with what Railway routes to. |
| `WORKSPACE_REPO_<ARM>` (one per arm: `WORKSPACE_REPO_A` … `WORKSPACE_REPO_E`) | The GitHub repo `backup.sh` mirrors that arm's workspace to (see "Offsite backup" below) | `railway variable set`, using that arm's `github-workspace-<arm>` SSH alias, e.g. `WORKSPACE_REPO_A=git@github-workspace-a:you/observatory-workspace-a.git` |
| `DEPLOY_KEY_<ARM>_B64` (one per arm: `DEPLOY_KEY_A_B64` … `DEPLOY_KEY_E_B64`) | A base64'd SSH deploy key (write access) for that arm's workspace repo | `railway variable set --service harness DEPLOY_KEY_A_B64="$(base64 < path/to/key-a)"` |
| `DATA_REPO` | The one GitHub repo all five arms' event logs mirror to — shared, not per-arm; each arm writes its own `<arm>.jsonl` there | `railway variable set`, using the `github-data` SSH alias, e.g. `git@github-data:you/observatory-log.git` |
| `DEPLOY_KEY_DATA_B64` | A base64'd SSH deploy key (write access) for `DATA_REPO`, shared by all arms | `railway variable set --service harness DEPLOY_KEY_DATA_B64="$(base64 < path/to/key)"` |
| `HEALTHCHECK_URL_<ARM>` (one per arm, optional: `HEALTHCHECK_URL_A` … `HEALTHCHECK_URL_E`) | A healthchecks.io check's ping URL, one check per arm (see "Detecting a missed or failed run" below) | `railway variable set`. Omit an arm's to leave that arm's heartbeat off; the others are unaffected. |

An arm missing its `WORKSPACE_REPO_<ARM>` or `DEPLOY_KEY_<ARM>_B64` isn't a
deploy blocker — `backup.sh` skips that arm's workspace backup with a clear
log line and keeps going (see "What was validated" below). `DATA_REPO` /
`DEPLOY_KEY_DATA_B64` are the only ones that matter for every arm, since the
event log is shared.

Verify nothing extra leaked in: `railway variable list --service harness` and
confirm the only things you don't recognize from this table are Railway's own
(`RAILWAY_*`).

## Offsite backup: creating the repos

`backup.sh` mirrors two things off the Railway volume after every run: the
firing arm's workspace (`WORKSPACE_REPO_<ARM>`) and the event log
(`DATA_REPO`, shared — every arm writes its own `<arm>.jsonl` into the one
repo). Each workspace repo is authenticated with its own deploy key and
reached through a `github-workspace-<arm>` SSH alias; the data repo through
`github-data`. `entrypoint.sh` writes these aliases to `~/.ssh/config` at
boot, one per arm that has a `DEPLOY_KEY_<ARM>_B64` set — that alias, not
`github.com` directly, is what selects the right key, so every
`WORKSPACE_REPO_<ARM>` / `DATA_REPO` value must be written in that form.

You need up to six repos: one workspace repo per arm you want backed up
(`WORKSPACE_REPO_A` … `WORKSPACE_REPO_E`), plus the one shared `DATA_REPO`.
An arm can run without its own workspace repo — `backup.sh` just skips that
arm's workspace backup (see "What was validated" below) — but every arm
needs `DATA_REPO` to keep its event log safe.

**Create every repo completely empty.** Do not tick "Add a README file", and
don't add a `.gitignore` or license template. Any of those gives the repo an
initial commit with no shared history with the harness's own — the first
push is then rejected as non-fast-forward. `backup.sh` recovers from this
automatically (fetch, then `push --force-with-lease`: the harness is the sole
writer to each repo, so its local history is always the complete record and
safe to force onto a remote that only ever diverges by way of this
initializer commit) but an empty repo avoids the situation, and the one extra
reconcile it costs, in the first place.

## Adding a sixth arm

Nothing in `scripts/` is hardcoded to five arms — `entrypoint.sh` discovers
the arm set at boot from whatever configs land in `/app/arms/*.yaml`, so
onboarding arm `f` is:

1. Add `arms/f.yaml` (owned by the harness config, not this doc — see
   `arms/*.yaml` for the shape).
2. Set `WORKSPACE_REPO_F` and `DEPLOY_KEY_F_B64` as Railway variables (and
   `HEALTHCHECK_URL_F` if you want its own heartbeat check) — same pattern as
   the table above, just the new letter.
3. Add one line to `scripts/crontab.harness` for arm f's cadence: keep the
   3h cycle (`*/3` in the hour field) and pick a minute at least a few
   minutes clear of the other five (`07/13/19/25/31` are taken — `37` is the
   next open slot at the same 6-minute spacing).
4. Redeploy.

No script needs editing beyond that crontab line — `entrypoint.sh` writes
arm f's ssh key/alias and harness.env entries the same loop already handles
for a–e, and `backup.sh` resolves `WORKSPACE_REPO_F` / the key it wrote
generically from the arm argument it's given.

## Detecting a missed or failed run (heartbeat)

Nothing above watches whether a scheduled fire actually happened — the
observatory web server stays green regardless, and stale data on the site is
otherwise the only symptom. `run-arm.sh` closes this with an optional
heartbeat, following the healthchecks.io ping convention — **per arm**, so
one arm going quiet is never masked by the other four still pinging on time:

- Create one healthchecks.io check per arm you want covered and set its ping
  URL as `HEALTHCHECK_URL_<ARM>` (`https://hc-ping.com/<uuid>`, a different
  uuid per arm). `run-arm.sh` pings that arm's URL after every fire of that
  arm — the bare URL on success, `<HEALTHCHECK_URL_<ARM>>/fail` if either the
  agent's run or the backup step failed. A backup that silently stops
  advancing (the failure mode `backup.sh` used to be able to hide) now trips
  this the same as a crashed run.
  - Per-arm distinct check URLs, not a shared slug: healthchecks.io's ping
    URL bakes the check's own uuid into the path, so there's no way to derive
    a valid per-arm URL by appending a suffix to one shared uuid — the only
    convention it defines for a single check is the literal `/fail` suffix
    used above. Distinguishing five arms means five checks, hence five
    variables, not one `HEALTHCHECK_URL` plus a naming trick.
- **Off by default, safe by default, per arm.** Leave an arm's
  `HEALTHCHECK_URL_<ARM>` unset and nothing is ever contacted for that arm —
  no third-party account is required to run this experiment at all.
- Set each check's schedule in healthchecks.io to match `crontab.harness`:
  period 3h, with enough grace (~30min) to cover a slow run without
  false-alerting. A missed or failed fire then shows as that arm's check
  going "Late" or "Down" on the healthchecks.io dashboard (and by
  email/Slack/whatever that check is wired to) — that's the "somebody would
  find out" this experiment was otherwise missing, now scoped to the one arm
  that actually broke.

## Why not Railway's own `cronSchedule`

`railway.json` supports a `deploy.cronSchedule` field, but that turns the
*whole service* into a run-to-completion job: Railway starts the container,
runs it, and stops it. That's incompatible with also keeping the observatory
web server up between fires, and it would cold-start a container 8x/day per
arm (five arms, every 3h) against a volume that's supposed to look
continuously live. This is why the schedule lives inside the container as a
real cron daemon instead — see `scripts/crontab.harness`.

For the same reason, don't set `numReplicas` above 1. The overlap lock in
`scripts/run-arm.sh` is per-container, per-arm (`/run/locks/<arm>.lock`,
tmpfs); a second replica would have its own independent set of five locks
and could fire any or all arms concurrently against the same shared volume.

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

**Confirming the schedule actually fires**, without waiting up to 3 hours:

```sh
railway logs --service harness --since 1d --filter "run-arm"
```

You should see, every 3h Europe/Lisbon at each arm's own staggered minute
(a=:07, b=:13, c=:19, d=:25, e=:31 past every 3rd hour — see
`scripts/crontab.harness`), a `run-arm[<arm>]: starting` line followed by
`arm=<arm> terminal_reason=...` (printed by `cli.ts` itself) and
`run-arm[<arm>]: exited status=0`. All five arms should appear across a full
3h window; if one is consistently missing, check that arm's cron line and
that its `arms/<arm>.yaml` exists in the built image.

To prove the whole path immediately rather than waiting for a real fire, you
can `railway ssh --service harness` in and run `/app/scripts/run-arm.sh
<arm>` by hand for any of `a`–`e` — **this executes a real run against the
real API key and spends real budget** (`arms/<arm>.yaml`: up to 40,000
billed tokens / $2 per invocation, per arm), so only do this once per arm
you need to check, deliberately, not as a routine check.

To inspect an event log directly: `railway ssh --service harness`, then
`cat /data/logs/<arm>.jsonl`.

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

Validated locally (11 Aug 2026, this pass — generalizing from one arm at
4x/day to five arms at 3h each, staggered):
- Real container boot end-to-end: built the image from the real Dockerfile
  and `observatory/`, ran `entrypoint.sh` → `supervisord`, confirmed both
  `cron` and `web` reach `RUNNING`, and `web` serves `Ready` in its own log —
  same boot path as the single-arm version, unaffected by the arm-discovery
  change.
- `entrypoint.sh` correctly derives the arm set from `/app/arms/*.yaml` (five
  arms found, matching `arms/a.yaml`…`arms/e.yaml`) rather than a hardcoded
  list.
- `/etc/cron.d/harness` installs with the real 5-line schedule
  (`07/13/19/25/31 */3 * * *` for a–e), correct content and `0644`
  permissions, root-owned (confirmed `-rw-r--r-- 1 root root`) — the
  ownership Debian's `cron` actually requires to load a `cron.d` file at all;
  discovered because a `docker cp`-copied test crontab used for the live-fire
  check below silently never fired until re-chowned to root, which is
  exactly why this got checked explicitly rather than assumed.
- Given `DEPLOY_KEY_A_B64` / `DEPLOY_KEY_B_B64` / `DEPLOY_KEY_DATA_B64`, boot
  wrote `~/.ssh/workspace_a`, `~/.ssh/workspace_b`, `~/.ssh/data` (agent-owned,
  `0600`) and a `~/.ssh/config` with exactly the matching `github-workspace-a`
  / `github-workspace-b` / `github-data` aliases — and no alias at all for an
  arm (`c`) whose key was left unset, confirming a partially-provisioned arm
  set doesn't get a broken or placeholder alias.
- `/run/harness.env` (`0600`, root-owned) carried every variable that was
  set: the shared globals plus `WORKSPACE_REPO_A`, `WORKSPACE_REPO_B`,
  `WORKSPACE_REPO_C`, and `HEALTHCHECK_URL_A` — confirming the per-arm
  snapshot loop, not just the shared one.
- **Cron's stripped environment, reproduced exactly** per
  `env -i HOME=/root LOGNAME=root SHELL=/bin/sh PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin TZ=Europe/Lisbon /app/scripts/run-arm.sh a`:
  the run correctly picked up `ANTHROPIC_API_KEY`, `WORKSPACE_REPO_A`,
  `DATA_REPO`, and `HEALTHCHECK_URL_A` from `/run/harness.env` despite none
  of them existing in the invoking shell — reached `cli.ts` (dummy key →
  `harness_error`, expected), pushed the workspace and event log, and
  attempted the arm's own heartbeat ping (connection refused to the fake
  local URL, swallowed by `|| true` as designed). This is the single
  documented failure mode this generalization was warned about, and it does
  not reproduce.
- **Overlap and cross-arm isolation**: manually holding arm a's lock
  (`/run/locks/a.lock`) caused a repeat fire of arm a to log
  `skip, previous run still active` and exit 0 without touching the lock —
  while arm b, fired in the same window with a's lock still held, ran to
  completion completely unaffected. This is the concrete proof that a
  long-running (here, artificially held) arm never blocks another arm's
  wake: the locks are genuinely independent per arm, not a single
  container-wide lock.
- **`backup.sh`'s per-arm resolution**, against local throwaway bare repos
  (`git init --bare`) standing in for GitHub, addressed via `file://` URLs so
  no network or real deploy key was needed — exactly two arms driven to a
  real successful push: pre-seeded `/data/workspaces/a` and
  `/data/workspaces/b` each with one commit, ran `backup.sh a` and
  `backup.sh b` directly as `agent`, and confirmed by cloning each bare repo
  back out that arm a's and arm b's own content landed in arm a's and arm
  b's own repo respectively — not cross-wired. Also drove the two documented
  skip paths distinctly: arm `c` (repo set, no key) logged
  "no deploy key for arm c, skipping workspace backup"; arms `d`/`e`
  (no `WORKSPACE_REPO_<ARM>` at all) logged
  "WORKSPACE_REPO_<ARM> not set, skipping workspace backup". Every skip
  case exited 0 and still pushed that arm's event log to the one shared
  `DATA_REPO` — confirmed by cloning it and finding `b.jsonl`, `c.jsonl`,
  `d.jsonl`, `e.jsonl` each in their own commit, keyed by arm.
- A real cron-triggered fire (not a manual invocation): temporarily pointed
  `/etc/cron.d/harness` at a near-future minute inside the running container,
  confirmed the daemon fired `run-arm.sh a` and `run-arm.sh e` unprompted at
  that minute with the expected `starting` → `terminal_reason=...` →
  `exited status=0` sequence — proof the schedule mechanism itself (not just
  `run-arm.sh` invoked by hand) drives multiple arms correctly.

**Not validated** (can't be, without deploying, and not something I should
be the one to deploy):
- A real healthchecks.io check and real GitHub repos end-to-end — the above
  used a synthetic ping target and local bare repos, not the real services.
- Five arms' real Claude Agent SDK runs actually overlapping under load
  (CPU/memory contention, not just the lock mechanics) — every run exercised
  here failed fast on a dummy API key, so genuine 2-4min concurrent runs
  sharing the container's resources were never produced.
- A sixth arm added and deployed end-to-end — the mechanism (arm discovery
  from `arms/*.yaml`, generic env var resolution) was verified with the
  existing five, not literally exercised with an `arms/f.yaml`.
- Anything about actual Railway behavior (volume mount permissions on
  Railway's infrastructure specifically, whether `railway add --service`
  with no image/repo behaves as assumed, real cron fire timing for the new
  3h cadence over a DST boundary).

## Fallback if the volume looks unwritable on Railway specifically

Railway's own volume docs flag that non-root images can hit permission
issues with a fresh volume mount, with `RAILWAY_RUN_UID=0` as their
documented escape hatch. This image starts as root anyway (that's how
`entrypoint.sh` chowns `/data` before dropping privileges), so this
shouldn't be needed — but if `/data` ever comes up owned by something
`entrypoint.sh` can't chown, set `RAILWAY_RUN_UID=0` on the service and
redeploy before digging further.
