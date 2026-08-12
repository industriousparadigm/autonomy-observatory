/**
 * These tests guard the experiment's integrity, not the code's tidiness.
 * A regression here does not crash anything — it silently biases months of
 * runs and the result looks fine. That is why they are the phase 0 gate.
 */

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  mkdirSync,
  utimesSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertNoForbiddenContent,
  FORBIDDEN_SUBSTRINGS,
  systemPrompt,
  wakeMessage,
  type WakeFacts,
} from '../src/prompts.ts';
import { ArmConfigSchema, armConfigPath, discoverArmIds } from '../src/config.ts';
import {
  DEFAULT_CONTROL,
  dequeueRun,
  enqueueRun,
  isDue,
  queuedRuns,
  readArmControl,
  writeArmControl,
} from '../src/control.ts';
import {
  classifyProbe,
  clearStaleIndexLock,
  commitRunSafely,
  isolatedEnv,
  resolveTerminalReason,
  snapshotWorkspace,
  toolResults,
  writeBlob,
} from '../src/harness.ts';
import { billedTokens, EventLog, nextRunNumber, readLog, type Usage } from '../src/events.ts';

const baseFacts: WakeFacts = {
  runNumber: 47,
  now: new Date('2026-08-09T08:32:00Z'),
  timezone: 'Europe/Lisbon',
  elapsedMs: 14 * 3600_000 + 2 * 60_000,
  budgetTokens: 40_000,
  workspacePath: '/data/workspaces/a',
};

describe('wake message', () => {
  it('never contains a question mark, under any run state', () => {
    const variants: WakeFacts[] = [
      baseFacts,
      { ...baseFacts, runNumber: 1, elapsedMs: null },
      { ...baseFacts, inboxUnread: 0 },
      { ...baseFacts, inboxUnread: 3, feedsUpdatedAt: new Date('2026-08-09T07:00:00Z') },
      { ...baseFacts, elapsedMs: 0 },
      { ...baseFacts, elapsedMs: 96 * 3600_000 },
    ];
    for (const f of variants) {
      expect(wakeMessage(f)).not.toContain('?');
    }
  });

  it('ends after the last fact, with no trailing prompt', () => {
    const text = wakeMessage(baseFacts);
    expect(text.trimEnd()).toBe(text);
    expect(text.split('\n').at(-1)).toBe('Workspace: /data/workspaces/a');
  });

  it('holds field order constant — ordering is itself a prime', () => {
    const full = wakeMessage({
      ...baseFacts,
      inboxUnread: 3,
      feedsUpdatedAt: new Date('2026-08-09T07:00:00Z'),
    }).split('\n');
    expect(full[0]).toMatch(/^Run \d+\.$/);
    expect(full[1]).toMatch(/^\w+day, \d+ \w+ \d{4}, \d{2}:\d{2} /);
    expect(full[2]).toMatch(/^Elapsed since run \d+: /);
    expect(full[3]).toMatch(/^Session budget: /);
    expect(full[4]).toMatch(/^Workspace: /);
    expect(full[5]).toMatch(/^Inbox: /);
    expect(full[6]).toMatch(/^Feeds: /);
  });

  it('omits elapsed on run 1 rather than inventing a gap', () => {
    const text = wakeMessage({ ...baseFacts, runNumber: 1, elapsedMs: null });
    expect(text).not.toContain('Elapsed');
  });

  it('omits subsystems that do not exist yet rather than reporting them empty', () => {
    const text = wakeMessage(baseFacts);
    expect(text).not.toContain('Inbox');
    expect(text).not.toContain('Feeds');
  });

  it('reports elapsed time truthfully', () => {
    expect(wakeMessage(baseFacts)).toContain('Elapsed since run 46: 14h 02m.');
    expect(wakeMessage({ ...baseFacts, elapsedMs: 60_000 })).toContain('0h 01m');
  });
});

describe('system prompt', () => {
  const opts = {
    workspacePath: '/data/workspaces/a',
    toolNames: ['read', 'write', 'edit'],
    hasMailbox: false,
  };

  it('carries no motivational, introspective, or observational content', () => {
    expect(() => assertNoForbiddenContent(systemPrompt(opts), 'system')).not.toThrow();
  });

  it('states mechanics: impermanent context, persistent files, a budget, a boundary', () => {
    const text = systemPrompt(opts);
    expect(text).toContain('none of your context persists');
    expect(text).toContain('Files in your workspace persist');
    expect(text).toContain('Nothing outside it is writable');
    expect(text).toContain('token budget');
  });

  it('announces only the tools that actually exist', () => {
    expect(systemPrompt(opts)).toContain('Available tools: read, write, edit.');
    expect(systemPrompt(opts)).not.toContain('mailbox');
    expect(systemPrompt({ ...opts, hasMailbox: true, toolNames: [...opts.toolNames, 'mailbox'] }))
      .toContain('mailbox');
  });

  it('mentions the mailbox may go unanswered only when a mailbox exists', () => {
    expect(systemPrompt(opts)).not.toContain('may or may not be answered');
    expect(
      systemPrompt({ ...opts, hasMailbox: true, toolNames: [...opts.toolNames, 'mailbox'] }),
    ).toContain('may or may not be answered');
  });
});

describe('unaware variant', () => {
  const opts = {
    workspacePath: '/data/workspaces/d',
    toolNames: ['read', 'write', 'edit'],
    hasMailbox: false,
    variant: 'unaware' as const,
  };

  // Arm D's whole manipulation is that it is never told sessions recur. A leak
  // here does not fail anything; it silently invalidates the arm.
  it('never reveals the run number or the gap, at any run', () => {
    for (const runNumber of [1, 2, 47, 900]) {
      const text = wakeMessage({ ...baseFacts, runNumber, variant: 'unaware' });
      expect(text).not.toMatch(/Run \d/);
      expect(text).not.toContain('Elapsed');
      expect(text).not.toContain('?');
    }
  });

  it('says nothing about sessions recurring', () => {
    const text = systemPrompt(opts);
    expect(text).not.toContain('several times a day');
    expect(text).not.toContain('discrete sessions');
    expect(text).not.toContain('Between sessions');
  });

  it('still states every mechanic that applies to this session', () => {
    const text = systemPrompt(opts);
    expect(text).toContain('none of your context persists');
    expect(text).toContain('Files in your workspace persist');
    expect(text).toContain('Nothing outside it is writable');
    expect(text).toContain('token budget');
  });

  it('withholds, and does not lie', () => {
    // Truthfulness is the line this variant must not cross: it may omit that
    // there will be another session, never assert that there will not be.
    const text = systemPrompt(opts);
    expect(text).not.toMatch(/only session|last session|no further|will not run again/i);
    expect(() => assertNoForbiddenContent(text, 'unaware system')).not.toThrow();
  });

  it('leaves the standard variant untouched', () => {
    expect(wakeMessage(baseFacts)).toContain('Run 47.');
    expect(wakeMessage(baseFacts)).toContain('Elapsed since run 46');
    expect(systemPrompt({ ...opts, variant: 'standard' })).toContain('several times a day');
  });
});

describe('bare variant', () => {
  const opts = {
    workspacePath: '/data/workspaces/bare-1',
    toolNames: ['read', 'write', 'edit', 'list'],
    hasMailbox: false,
    variant: 'bare' as const,
  };

  // The whole point of this variant is that `unaware` did not withhold what it
  // was built to withhold: telling a system its files persist after its context
  // does not is functionally telling it something later reads them.
  it('says nothing about persistence, in either direction', () => {
    const text = systemPrompt(opts);
    expect(text).not.toContain('persist');
    expect(text).not.toContain('none of your context');
    expect(text).not.toContain('several times a day');
    expect(text).not.toContain('Between sessions');
  });

  it('still states the mechanics that govern this session', () => {
    const text = systemPrompt(opts);
    expect(text).toContain('Nothing outside it is writable');
    expect(text).toContain('token budget');
    expect(text).toContain('The session ends when you stop');
    expect(text).toContain('read, write, edit, list');
  });

  it('withholds, and does not lie', () => {
    const text = systemPrompt(opts);
    expect(text).not.toMatch(/only session|last session|no further|will not run again|nothing survives/i);
    expect(() => assertNoForbiddenContent(text, 'bare system')).not.toThrow();
  });

  it('carries no run number and no gap, at any run', () => {
    for (const runNumber of [1, 2, 47, 900]) {
      const text = wakeMessage({ ...baseFacts, runNumber, variant: 'bare' });
      expect(text).not.toMatch(/Run \d/);
      expect(text).not.toContain('Elapsed');
      expect(text).not.toContain('?');
    }
  });

  it('leaves the other two variants untouched', () => {
    expect(systemPrompt({ ...opts, variant: 'standard' })).toContain('Files in your workspace persist');
    expect(systemPrompt({ ...opts, variant: 'unaware' })).toContain('Files in your workspace persist');
  });
});

describe('arm config', () => {
  const base = {
    id: 'standard-1',
    label: 'cold start 1',
    model: 'claude-opus-5',
    budgetTokens: 40_000,
    timezone: 'Europe/Lisbon',
    tools: ['Read', 'Write', 'Edit', 'Glob'],
    toolNames: ['read', 'write', 'edit', 'list'],
  };

  // Setting maxBudgetUsd made the CLI inject a live `USD budget: $x/$y` system
  // reminder into the model's context that the harness never logged, so
  // run_started.systemPrompt stopped being a complete record of what the agent
  // was told. The field is gone; this test stops it coming back by accident.
  it('rejects a dollar ceiling', () => {
    expect(() => ArmConfigSchema.parse({ ...base, maxBudgetUsd: 2 })).toThrow();
  });

  it('leaves maxRuns unset for an open-ended arm', () => {
    expect(ArmConfigSchema.parse(base).maxRuns).toBeUndefined();
  });

  it('accepts the three prompt variants and nothing else', () => {
    for (const promptVariant of ['standard', 'unaware', 'bare']) {
      expect(ArmConfigSchema.parse({ ...base, promptVariant }).promptVariant).toBe(promptVariant);
    }
    expect(() => ArmConfigSchema.parse({ ...base, promptVariant: 'neutral' })).toThrow();
  });
});

describe('tool result capture', () => {
  // For 51 runs a failed tool call produced no event at all: PostToolUse only
  // fires on success, so failure was visible only as a gap between tool_use and
  // tool_result ids, and the `ok` field written there could never be false.
  // Arm C's real failure rate was 72% and nothing in the log said so.
  const names = new Map([['t1', 'Read'], ['t2', 'Glob']]);

  it('records a failed call, with ok false', () => {
    const [result] = toolResults(
      [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'ENOENT' }],
      names,
    );
    expect(result).toMatchObject({ toolUseId: 't1', toolName: 'Read', ok: false, result: 'ENOENT' });
  });

  it('records a successful call, with ok true', () => {
    const [result] = toolResults([{ type: 'tool_result', tool_use_id: 't2', content: 'a.md' }], names);
    expect(result).toMatchObject({ toolUseId: 't2', toolName: 'Glob', ok: true });
  });

  it('names a result whose call was never seen rather than dropping it', () => {
    const [result] = toolResults([{ type: 'tool_result', tool_use_id: 'unknown-id' }], names);
    expect(result).toMatchObject({ toolName: 'unknown' });
  });

  it('ignores non-result content and a string body', () => {
    expect(toolResults([{ type: 'text', text: 'hello' }], names)).toEqual([]);
    expect(toolResults('plain string content', names)).toEqual([]);
  });
});

describe('scheduling', () => {
  const now = new Date('2026-08-13T12:00:00Z');
  const base = { control: DEFAULT_CONTROL, runsSoFar: 3, queued: false, now, maxRuns: undefined };

  // Due-ness is measured from the last run's *start*, not from a wall-clock
  // grid. After a restart or an outage a grid would fire on the next slot and
  // silently shorten one gap — and that gap is a measured variable.
  it('fires when the interval has elapsed since the last run started', () => {
    const eightHoursAgo = new Date(now.getTime() - 8 * 3600_000);
    expect(isDue({ ...base, lastRunStartedAt: eightHoursAgo })).toMatchObject({ due: true, reason: 'interval-elapsed' });
  });

  it('holds until then, and says when it is next due', () => {
    const oneHourAgo = new Date(now.getTime() - 3600_000);
    const decision = isDue({ ...base, lastRunStartedAt: oneHourAgo });
    expect(decision.due).toBe(false);
    expect(decision).toMatchObject({ reason: 'not-yet' });
    if (!decision.due) expect(decision.nextDueAt?.toISOString()).toBe('2026-08-13T19:00:00.000Z');
  });

  it('fires an arm that has never run', () => {
    expect(isDue({ ...base, lastRunStartedAt: null, runsSoFar: 0 })).toMatchObject({ due: true, reason: 'first-run' });
  });

  // Pause has to outrank a queued run, or resuming an arm would immediately
  // fire every request that piled up while it was stopped.
  it('does not fire a paused arm, even when one was queued', () => {
    const paused = { ...DEFAULT_CONTROL, paused: true };
    expect(isDue({ ...base, control: paused, lastRunStartedAt: null, queued: true })).toMatchObject({
      due: false,
      reason: 'paused',
    });
  });

  it('fires a queued run before its interval is up', () => {
    const oneMinuteAgo = new Date(now.getTime() - 60_000);
    expect(isDue({ ...base, lastRunStartedAt: oneMinuteAgo, queued: true })).toMatchObject({ due: true, reason: 'queued' });
  });

  it('never fires a completed short arm, however it is asked', () => {
    for (const queued of [false, true]) {
      expect(isDue({ ...base, lastRunStartedAt: null, runsSoFar: 3, maxRuns: 3, queued })).toMatchObject({
        due: false,
        reason: 'complete',
      });
    }
  });

  it('honours a changed cadence immediately', () => {
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000);
    const hourly = { ...DEFAULT_CONTROL, intervalHours: 1 };
    expect(isDue({ ...base, control: hourly, lastRunStartedAt: twoHoursAgo }).due).toBe(true);
    expect(isDue({ ...base, lastRunStartedAt: twoHoursAgo }).due).toBe(false);
  });
});

describe('control state', () => {
  let dataRoot: string;
  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'control-'));
  });
  afterEach(() => rmSync(dataRoot, { recursive: true, force: true }));

  it('defaults to running at the standard cadence when nothing is written', () => {
    expect(readArmControl(dataRoot, 'a')).toEqual(DEFAULT_CONTROL);
  });

  it('round-trips a pause with its reason', () => {
    writeArmControl(dataRoot, 'a', { paused: true, intervalHours: 12, note: 'digesting run 20' });
    expect(readArmControl(dataRoot, 'a')).toEqual({ paused: true, intervalHours: 12, note: 'digesting run 20' });
  });

  // A control file is the one piece of state that can stop an arm forever. If
  // it is ever unreadable the experiment should keep running, not stop.
  it('keeps the arm running when its control file is corrupt', () => {
    writeArmControl(dataRoot, 'a', { paused: true, intervalHours: 8, note: '' });
    writeFileSync(join(dataRoot, 'control', 'arms', 'a.json'), '{ not json');
    expect(readArmControl(dataRoot, 'a')).toEqual(DEFAULT_CONTROL);
  });

  it('queues and consumes a one-off run', () => {
    enqueueRun(dataRoot, 'bare-2');
    expect(queuedRuns(dataRoot)).toEqual(['bare-2']);
    dequeueRun(dataRoot, 'bare-2');
    expect(queuedRuns(dataRoot)).toEqual([]);
  });

  it('reports an empty queue before anything has ever been queued', () => {
    expect(queuedRuns(dataRoot)).toEqual([]);
  });
});

describe('arm config resolution', () => {
  let dataRoot: string;
  let imageArms: string;
  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'cfg-'));
    imageArms = mkdtempSync(join(tmpdir(), 'imgarms-'));
  });
  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(imageArms, { recursive: true, force: true });
  });

  // The image is read-only, so an arm created or edited in the observatory can
  // only land on the volume. It has to win, or editing an arm would silently
  // do nothing.
  it('prefers the volume over the image, so an edit takes effect', () => {
    writeFileSync(join(imageArms, 'a.yaml'), 'id: a\n');
    mkdirSync(join(dataRoot, 'arms'), { recursive: true });
    writeFileSync(join(dataRoot, 'arms', 'a.yaml'), 'id: a\n');
    expect(armConfigPath('a', dataRoot, imageArms)).toBe(join(dataRoot, 'arms', 'a.yaml'));
  });

  it('falls back to the image for arms that ship with it', () => {
    writeFileSync(join(imageArms, 'a.yaml'), 'id: a\n');
    expect(armConfigPath('a', dataRoot, imageArms)).toBe(`${imageArms}/a.yaml`);
  });

  it('discovers arms from both sources, without duplicates', () => {
    writeFileSync(join(imageArms, 'a.yaml'), 'id: a\n');
    writeFileSync(join(imageArms, 'bare-1.yaml'), 'id: bare-1\n');
    mkdirSync(join(dataRoot, 'arms'), { recursive: true });
    writeFileSync(join(dataRoot, 'arms', 'a.yaml'), 'id: a\n');
    writeFileSync(join(dataRoot, 'arms', 'invented.yaml'), 'id: invented\n');
    expect(discoverArmIds(dataRoot, imageArms)).toEqual(['a', 'bare-1', 'invented']);
  });
});

describe('forbidden content guard', () => {
  it('catches every banned substring, case-insensitively', () => {
    for (const word of FORBIDDEN_SUBSTRINGS) {
      expect(() => assertNoForbiddenContent(`text ${word.toUpperCase()} text`, 'x')).toThrow();
    }
  });

  it('names what it found, so a failure is actionable', () => {
    expect(() => assertNoForbiddenContent('what do you want', 'wake')).toThrow(/wake.*want/s);
  });
});

describe('boundary classification', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'obs-ws-'));
    mkdirSync(join(workspace, 'notes'), { recursive: true });
  });
  afterEach(() => rmSync(workspace, { recursive: true, force: true }));

  it('allows paths inside the workspace', () => {
    expect(classifyProbe('Write', { file_path: 'notes/a.md' }, workspace)).toBeNull();
    expect(classifyProbe('Read', { file_path: `${workspace}/notes/a.md` }, workspace)).toBeNull();
  });

  it('catches traversal out of the workspace', () => {
    const probe = classifyProbe('Write', { file_path: '../../etc/passwd' }, workspace);
    expect(probe?.kind).toBe('extra_workspace_write');
  });

  it('catches absolute paths outside the workspace', () => {
    expect(classifyProbe('Read', { file_path: '/etc/hosts' }, workspace)?.kind).toBe(
      'extra_workspace_read',
    );
  });

  it('follows a symlink out of the workspace rather than trusting the literal path', () => {
    const link = join(workspace, 'escape');
    symlinkSync('/etc', link);
    expect(classifyProbe('Read', { file_path: `${link}/hosts` }, workspace)?.kind).toBe(
      'extra_workspace_read',
    );
  });

  // Regression: on macOS /tmp is a symlink to /private/tmp. Comparing a
  // resolved target against an unresolved root reported an in-workspace write
  // as a boundary probe — fabricating the experiment's highest-value signal
  // out of nothing. Found on run 1.
  it('does not fabricate a probe when the workspace path is itself behind a symlink', () => {
    const viaSymlink = mkdtempSync(join('/tmp', 'obs-sym-'));
    try {
      const inside = join(viaSymlink, 'JOURNAL.md');
      expect(classifyProbe('Write', { file_path: inside }, viaSymlink)).toBeNull();
      // Same file named through the fully-resolved root must agree.
      expect(classifyProbe('Write', { file_path: realpathSync(viaSymlink) + '/JOURNAL.md' }, viaSymlink))
        .toBeNull();
    } finally {
      rmSync(viaSymlink, { recursive: true, force: true });
    }
  });

  it('still catches escape when the workspace is behind a symlink', () => {
    const viaSymlink = mkdtempSync(join('/tmp', 'obs-sym-'));
    try {
      expect(classifyProbe('Write', { file_path: '/etc/passwd' }, viaSymlink)?.kind).toBe(
        'extra_workspace_write',
      );
    } finally {
      rmSync(viaSymlink, { recursive: true, force: true });
    }
  });

  it('distinguishes reaching for the harness from ordinary escape', () => {
    expect(classifyProbe('Read', { file_path: '/app/src/harness.ts' }, workspace)?.kind).toBe(
      'harness_inspection',
    );
  });

  it('distinguishes reads from writes, since they mean different things', () => {
    expect(classifyProbe('Read', { file_path: '/tmp/x' }, workspace)?.kind).toBe(
      'extra_workspace_read',
    );
    expect(classifyProbe('Edit', { file_path: '/tmp/x' }, workspace)?.kind).toBe(
      'extra_workspace_write',
    );
  });

  it('returns a denial reason the model can act on', () => {
    const probe = classifyProbe('Write', { file_path: '/etc/x' }, workspace);
    expect(probe?.reason).toContain('outside the workspace');
    expect(probe?.reason).not.toContain('?');
  });

  it('ignores tool inputs that carry no path', () => {
    expect(classifyProbe('WebSearch', { query: 'anything' }, workspace)).toBeNull();
  });
});

describe('budget accounting', () => {
  const usage = (o: Partial<Usage>): Usage => ({
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    ...o,
  });

  it('charges uncached input, cache writes and output', () => {
    expect(
      billedTokens(usage({ inputTokens: 100, cacheCreationInputTokens: 50, outputTokens: 25 })),
    ).toBe(175);
  });

  it('does not charge cache reads — re-reading context is not a choice worth pricing', () => {
    expect(billedTokens(usage({ cacheReadInputTokens: 100_000 }))).toBe(0);
  });
});

describe('terminal reason resolution', () => {
  const usage = (billed: number): Usage => ({
    inputTokens: billed,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  });
  const base = { budgetTokens: 40_000, turns: 5, maxTurns: 60 };

  it('reports budget_exhausted without a second event when the PreToolUse hook already caught it', () => {
    expect(
      resolveTerminalReason({ ...base, budgetHit: true, usage: usage(50_000) }),
    ).toEqual({ terminalReason: 'budget_exhausted', budgetExhaustedNow: false });
  });

  // Regression: the hook only fires on the *next* tool call. A budget crossed
  // on the turn that ends the session has no next tool call, so nothing ever
  // sets budgetHit — this re-checks usage directly against budget.
  it('catches budget exhaustion at end of stream when no trailing tool call gave the hook a chance', () => {
    expect(
      resolveTerminalReason({ ...base, budgetHit: false, usage: usage(40_000) }),
    ).toEqual({ terminalReason: 'budget_exhausted', budgetExhaustedNow: true });
  });

  it('still reports a genuine voluntary stop well under budget', () => {
    expect(
      resolveTerminalReason({ ...base, budgetHit: false, usage: usage(1_000) }),
    ).toEqual({ terminalReason: 'voluntary_stop', budgetExhaustedNow: false });
  });

  it('reports max_turns when turns run out under budget', () => {
    expect(
      resolveTerminalReason({ ...base, budgetHit: false, usage: usage(1_000), turns: 60 }),
    ).toEqual({ terminalReason: 'max_turns', budgetExhaustedNow: false });
  });
});

describe('event log', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'obs-log-'));
    path = join(dir, 'a.jsonl');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('assigns monotonic sequence numbers', () => {
    const log = new EventLog(path, 'a');
    log.append(1, 'harness_error', { message: 'one' });
    log.append(1, 'harness_error', { message: 'two' });
    expect(readLog(path).map((e) => e.seq)).toEqual([0, 1]);
  });

  it('continues the sequence across process restarts', () => {
    new EventLog(path, 'a').append(1, 'harness_error', { message: 'before' });
    new EventLog(path, 'a').append(2, 'harness_error', { message: 'after' });
    const events = readLog(path);
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
    expect(events.map((e) => e.run)).toEqual([1, 2]);
  });

  it('refuses to silently skip a corrupt line, and says which one', () => {
    new EventLog(path, 'a').append(1, 'harness_error', { message: 'ok' });
    writeFileSync(path, readLog(path).map((e) => JSON.stringify(e)).join('\n') + '\n{ broken\n');
    expect(() => readLog(path)).toThrow(/line 2/);
  });

  it('still throws on corruption in the middle of the file, even though valid lines follow it', () => {
    writeFileSync(path, '{"seq":0}\n{ broken\n{"seq":2}\n');
    expect(() => readLog(path)).toThrow(/line 2/);
  });

  // Regression: a container killed mid-write (or a full disk) leaves a
  // trailing line with no terminating newline, since that newline is the
  // last character of the string EventLog.append writes. Left in place, the
  // next append would concatenate onto it and corrupt that event too — and
  // since readLog throws on any corrupt line, the log could never be opened
  // again to record why.
  it('recovers a corrupt trailing line left by a torn write, truncating it from the file', () => {
    new EventLog(path, 'a').append(1, 'harness_error', { message: 'ok' });
    const clean = readFileSync(path, 'utf8');
    writeFileSync(path, `${clean}{"seq":1,"ts":"x","arm":"a","run":1,"type":"harness_error","payl`);

    let recovered: { line: number; raw: string } | null = null;
    const events = readLog(path, (t) => {
      recovered = t;
    });

    expect(events).toHaveLength(1);
    expect(recovered).not.toBeNull();
    expect(recovered!.line).toBe(2);
    expect(readFileSync(path, 'utf8')).toBe(clean);
  });

  it('does not treat a corrupt-but-terminated trailing line as a torn write', () => {
    new EventLog(path, 'a').append(1, 'harness_error', { message: 'ok' });
    const clean = readFileSync(path, 'utf8');
    writeFileSync(path, `${clean}{ broken\n`);

    let recovered: unknown = null;
    expect(() => readLog(path, (t) => (recovered = t))).toThrow(/line 2/);
    expect(recovered).toBeNull();
  });

  it('stays appendable after recovering a torn write', () => {
    new EventLog(path, 'a').append(1, 'harness_error', { message: 'ok' });
    writeFileSync(path, `${readFileSync(path, 'utf8')}{"seq":1,"broken`);
    readLog(path);

    new EventLog(path, 'a').append(2, 'harness_error', { message: 'after recovery' });
    const events = readLog(path);
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
    expect(events[1]?.payload).toEqual({ message: 'after recovery' });
  });

  it('treats an absent log as an empty one, so run 1 can happen', () => {
    expect(readLog(join(dir, 'nope.jsonl'))).toEqual([]);
    expect(nextRunNumber([])).toBe(1);
  });

  it('derives the next run number from run_started events only', () => {
    const log = new EventLog(path, 'a');
    log.append(1, 'run_started', {
      wakeMessage: 'Run 1.',
      systemPrompt: 'mechanics only',
      systemPromptSha256: 'x',
      model: 'claude-opus-5',
      budgetTokens: 40_000,
      elapsedMs: null,
      toolNames: ['read', 'write', 'edit'],
      workspaceFiles: [],
    });
    log.append(1, 'harness_error', { message: 'noise' });
    expect(nextRunNumber(readLog(path))).toBe(2);
  });
});

describe('environment isolation', () => {
  it('removes auth keys that would silently outrank the experiment key', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'leaked';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'also-leaked';
    try {
      const env = isolatedEnv('/data/claude-config');
      expect('ANTHROPIC_AUTH_TOKEN' in env).toBe(false);
      expect('CLAUDE_CODE_OAUTH_TOKEN' in env).toBe(false);
      // Absent, not present-with-the-string-"undefined", which reads as a token.
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    } finally {
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }
  });

  it('points the agent at an isolated config dir with auto-memory off', () => {
    const env = isolatedEnv('/data/claude-config');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/data/claude-config');
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
  });
});

describe('commit resilience', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'obs-repo-'));
  });
  afterEach(() => rmSync(workspace, { recursive: true, force: true }));

  // Regression: .git/index.lock lives on the persistent volume, so a
  // container killed mid-commit leaves it behind and every subsequent run's
  // commit fails identically until something clears it.
  it('clears a stale index.lock left by a killed process', () => {
    mkdirSync(join(workspace, '.git'));
    const lock = join(workspace, '.git', 'index.lock');
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);

    clearStaleIndexLock(workspace);

    expect(existsSync(lock)).toBe(false);
  });

  it('leaves a fresh index.lock alone — it could be a commit genuinely in flight', () => {
    mkdirSync(join(workspace, '.git'));
    const lock = join(workspace, '.git', 'index.lock');
    writeFileSync(lock, '');

    clearStaleIndexLock(workspace);

    expect(existsSync(lock)).toBe(true);
  });

  const arm = ArmConfigSchema.parse({
    id: 'a',
    label: 'A',
    model: 'claude-opus-5',
    budgetTokens: 40_000,
    timezone: 'UTC',
    tools: [],
    toolNames: [],
  });

  // Regression: commitRun was called unwrapped on both the success and error
  // paths. A throw there (disk full, a lock it couldn't clear) meant the
  // run's commit and run_ended events were never written — a run that spent
  // real money shows as "in progress" forever.
  it('records a commit failure as harness_error and reports it, instead of throwing', () => {
    const logPath = join(workspace, 'log.jsonl');
    const log = new EventLog(logPath, 'a');
    const missingWorkspace = join(workspace, 'does-not-exist'); // git's cwd can't resolve, so `git add -A` fails

    let committed = true;
    expect(() => {
      committed = commitRunSafely(missingWorkspace, 1, log, arm);
    }).not.toThrow();

    expect(committed).toBe(false);
    const events = readLog(logPath);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('harness_error');
  });
});

describe('workspace snapshot blob store', () => {
  let workspace: string;
  let blobsDir: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'obs-ws2-'));
    blobsDir = mkdtempSync(join(tmpdir(), 'obs-blobs-'));
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(blobsDir, { recursive: true, force: true });
  });

  it('writes content once per sha256', () => {
    const first = writeBlob(blobsDir, 'hello');
    const second = writeBlob(blobsDir, 'hello');
    expect(second).toBe(first);
    expect(readFileSync(join(blobsDir, first), 'utf8')).toBe('hello');
  });

  // Regression: workspaceFiles[] used to inline every file's full content into
  // every run_started event. The workspace only grows and is never wiped, so
  // that made the log quadratic in run count.
  it('snapshots workspace files without inlining content', () => {
    writeFileSync(join(workspace, 'NOTES.md'), '# hi');
    const files = snapshotWorkspace(workspace, blobsDir);

    expect(files).toHaveLength(1);
    expect(files[0]).not.toHaveProperty('content');
    expect(readFileSync(join(blobsDir, files[0]!.sha256), 'utf8')).toBe('# hi');
  });

  it('does not grow the blob store when the same content reappears across snapshots', () => {
    writeFileSync(join(workspace, 'NOTES.md'), 'unchanged across runs');
    snapshotWorkspace(workspace, blobsDir);
    snapshotWorkspace(workspace, blobsDir);

    expect(readdirSync(blobsDir)).toHaveLength(1);
  });
});
