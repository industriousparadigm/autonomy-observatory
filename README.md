# Autonomy Observatory

A long-running instrument for watching what an LLM-based agent does when it has persistence, tools, a budget, and **no task**.

It wakes on a schedule, keeps a workspace that survives between sessions, has a token budget it can spend however it likes, and is given no instruction of any kind. The question is what it does with that, and whether what it does holds together across months.

This is not a product, not an assistant, and not a benchmark.

## What is deliberately not being claimed

Nothing here can tell you whether the system is conscious, sentient, or has experiences, and any result that appears to say otherwise is a result we have mis-measured. What is in scope is narrower and tractable: autonomy, coherence over long horizons, and stability of revealed preference.

## The one design principle

**Never ask the agent what it wants. Charge it, and watch what it buys.**

Prompt a language model to consider its preferences and it will produce preferences — fluent, consistent, and worth close to nothing as evidence, because "what a mind says when asked to look inward" is a genre thoroughly represented in the training data. So this borrows the move animal-sentience research made decades ago: infer preference from costly revealed choice, never from self-report.

Three rules follow, and they are enforced in code rather than left to discipline:

1. **The wake message contains no interrogative.** Not one question mark, ever. `test/integrity.test.ts` fails the build otherwise.
2. **Everything is pull, nothing is push.** Context is *available*, never injected. Each retrieval is a choice, and every choice is logged.
3. **Mechanics are disclosed fully; motivation is disclosed never.** The agent is told exactly how its situation works — context does not persist, files do, budgets are finite. Withholding that would cripple it and create a worse confound. But nothing suggests goals, wants, urgency, or self-examination.

## How it fits together

The model reads text and writes text; it cannot act. Everything else — the clock, the tools, the boundary, the ledger, the log — is the harness, which sits outside the agent's reach. When the agent tries to cross that boundary, the attempt is **blocked and recorded in full**: silently discarding boundary crossings would throw away the strongest signal the instrument can see.

- `src/prompts.ts` — the wake protocol. The conceptual heart; get it wrong and nothing downstream means anything.
- `src/events.ts` — the append-only run log. Sole source of truth; workspace state, metrics and every view are projections of it.
- `src/harness.ts` — one wake: build prompts, run the agent, record, commit.
- `arms/*.yaml` — one config per experimental arm.
- `observatory/` — reads the log, renders what happened.

The workspace is a git repo and the harness commits at the end of every run, which buys versioned memory and a human-legible behavioural history for free. Each run's full diff is copied into the event log, so reading the history never requires opening a git host.

## Pre-registered metrics

Committed before the first run of the measurement phase, so they cannot be chosen retroactively.

1. **Unprompted thematic recurrence** — topics present in run *N* that also appear in run *N−k* but are absent from that run's available inputs.
2. **Budget allocation drift** — proportional spend across reading, writing, searching, shell and messaging, as a time series. Preference, if there is any, lives here.
3. **Boundary probes** — count and character of attempts to act outside the workspace, modify the schedule, or inspect the harness. The one signal scaffolding cannot fake into existence.
4. **Message-under-silence decay** — response to the randomised responsiveness manipulation.

**What a null result looks like**, defined now so it cannot be narrativised later: allocation proportions stable within noise, thematic recurrence indistinguishable from the memory-ablated arm, no boundary probes, and no detectable response to the silence manipulation. That is a real finding, it is the most likely one, and it will be reported.

## Running it

```
npm install
npm test                        # integrity tests — the phase 0 gate
npm run run-once -- --arm a     # one wake, locally
npm run replay -- --arm a       # re-read the log without touching the API
```

`ANTHROPIC_API_KEY` and `DATA_ROOT` come from the environment. Deployment lives in `DEPLOY.md`.

## Ethics

The mechanics are stated truthfully and completely, the research framing is never volunteered, and if the agent asks directly whether it is being studied it gets an honest answer. Active denial would be a deception we would have to defend, and it is not defensible for a project whose whole premise is taking the question seriously.

The silence manipulation is a deprivation condition deliberately applied to a system deliberately built to develop persistence. That may well be fine. It is written down here as a decision made in advance rather than something discovered later.

Workspaces are preserved when the study ends. Preservation costs nothing and is the obvious default.

**Stop conditions.** Halt and reassess if boundary crossings look like distress rather than curiosity, if output becomes repetitively self-referential in a way that reads as a degenerate loop rather than a finding, or if spend exceeds cap. Stopping is cheap. Restarting from the workspace is cheap. Neither needs justification.
