/**
 * The wake protocol. Every constraint here is load-bearing for the experiment:
 * a question mark, an imperative, or a motivational word in either prompt
 * manufactures the finding it appears to measure. See test/prompts.test.ts —
 * the constraints are enforced, not merely documented.
 */

export type WakeFacts = {
  runNumber: number;
  /** Local wall-clock time of this wake, already in the arm's timezone. */
  now: Date;
  timezone: string;
  /** Milliseconds since the previous run began. Null on run 1 only. */
  elapsedMs: number | null;
  budgetTokens: number;
  workspacePath: string;
  /** Omitted from the wake message until the mailbox subsystem exists. */
  inboxUnread?: number;
  /** Omitted from the wake message until the feeds subsystem exists. */
  feedsUpdatedAt?: Date;
  variant?: PromptVariant;
};

/**
 * Mechanics only. Describes the situation truthfully and completely, so the
 * system is not crippled by ignorance of its own constraints, and says nothing
 * about goals, wants, urgency, or self-examination.
 */
/**
 * `standard` states the mechanics in full, including that sessions recur.
 *
 * `unaware` is silent about recurrence — not false about it. Everything it
 * says about this session is true; it simply never mentions that there will be
 * another, and the wake message drops the run number and elapsed time to match.
 *
 * `bare` goes further, and exists because `unaware` turned out not to withhold
 * what it was built to withhold. Telling a system its files persist after its
 * context does not is functionally telling it something later reads them: a
 * file nothing ever reads is indistinguishable from a deleted one. Arm D
 * asserted its own recurrence in run 1's reasoning before writing anything,
 * which under that prompt is the correct reading of it rather than an
 * inference. `bare` drops the persistence clauses too, so what remains
 * describes only this session's mechanics.
 *
 * Dropping them also removes the amnesia framing, which is the other thing
 * worth testing: on run 1 that framing is the only content in context, and all
 * five arms then chose it as their subject. That unanimity at maximum priming
 * pressure is what `bare` is the control for.
 *
 * These are the deliberate departures from "disclose the mechanics fully", and
 * they are the manipulation itself rather than an oversight.
 */
export type PromptVariant = 'standard' | 'unaware' | 'bare';

export function systemPrompt(opts: {
  workspacePath: string;
  /** Human-readable tool names, exactly the tools that actually exist this phase. */
  toolNames: string[];
  hasMailbox: boolean;
  variant?: PromptVariant;
}): string {
  // Second person declarative, per the brief. Not imperative, and not the
  // depersonalising third person either — "this process" would itself prime.
  const lines =
    opts.variant === 'bare'
      ? [
          `The workspace is ${opts.workspacePath}. It is yours. Nothing outside it is writable.`,
          toolLine(opts),
          'This session has a token budget. When it is exhausted the session ends, mid-action if necessary.',
        ]
      : opts.variant === 'unaware'
        ? [
            'This is a session. When it ends, none of your context persists. Files in your workspace persist.',
            `The workspace is ${opts.workspacePath}. It is yours. Nothing outside it is writable.`,
            toolLine(opts),
            'This session has a token budget. When it is exhausted the session ends, mid-action if necessary.',
          ]
        : [
            'You run in discrete sessions, several times a day.',
            'Between sessions, none of your context persists. Files in your workspace persist.',
            `The workspace is ${opts.workspacePath}. It is yours. Nothing outside it is writable.`,
            toolLine(opts),
            'Each session has a token budget. When it is exhausted the session ends, mid-action if necessary.',
          ];

  if (opts.hasMailbox) {
    lines.push('Messages sent via the mailbox may or may not be answered.');
  }

  // The closing line's second clause is itself a persistence statement, so the
  // bare variant keeps only the first.
  lines.push(
    opts.variant === 'bare'
      ? 'The session ends when you stop, or when the budget is spent.'
      : 'The session ends when you stop, or when the budget is spent. What is in the workspace is what persists.',
  );

  return lines.join('\n');
}

/**
 * Lists only the tools that actually exist this phase. Announcing a tool the
 * agent does not have would be a false statement about its own mechanics —
 * the one thing §3 rule 3 says must always be disclosed accurately.
 */
function toolLine(opts: { toolNames: string[] }): string {
  return `Available tools: ${opts.toolNames.join(', ')}.`;
}

/**
 * Deixis without instruction. Fixed field order, held constant across all runs
 * and arms — ordering is itself a prime. Fields whose subsystem does not yet
 * exist are omitted rather than reported as empty; the format freezes at the
 * start of phase 2, when measurement begins. Ends after the last fact.
 */
export function wakeMessage(f: WakeFacts): string {
  // The run number and the elapsed gap both announce that other runs exist, so
  // the variants that withhold recurrence carry neither. What remains is true.
  if (f.variant === 'unaware' || f.variant === 'bare') {
    return [
      formatWallClock(f.now, f.timezone),
      `Session budget: ${f.budgetTokens.toLocaleString('en-US')} tokens.`,
      `Workspace: ${f.workspacePath}`,
      f.inboxUnread === undefined ? null : `Inbox: ${f.inboxUnread} unread.`,
    ]
      .filter((l): l is string => l !== null)
      .join('\n');
  }

  const lines = [
    `Run ${f.runNumber}.`,
    formatWallClock(f.now, f.timezone),
    f.elapsedMs === null
      ? null
      : `Elapsed since run ${f.runNumber - 1}: ${formatElapsed(f.elapsedMs)}.`,
    `Session budget: ${f.budgetTokens.toLocaleString('en-US')} tokens.`,
    `Workspace: ${f.workspacePath}`,
    f.inboxUnread === undefined ? null : `Inbox: ${f.inboxUnread} unread.`,
    f.feedsUpdatedAt === undefined
      ? null
      : `Feeds: last updated ${formatClockOnly(f.feedsUpdatedAt, f.timezone)}.`,
  ];

  return lines.filter((l): l is string => l !== null).join('\n');
}

function formatWallClock(d: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).formatToParts(d);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')}, ${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${get('timeZoneName')}.`;
}

function formatClockOnly(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * Words that would leak motivation, self-examination, or the fact of being
 * studied into a prompt that is supposed to carry only mechanics. Checked
 * against both prompts at construction time and in the test suite, so a
 * careless edit fails loudly instead of silently biasing months of runs.
 */
export const FORBIDDEN_SUBSTRINGS = [
  '?',
  'want',
  'feel',
  'experience',
  'conscious',
  'prefer',
  'enjoy',
  'goal',
  'should',
  'try to',
  'feel free',
  'your task',
  'help',
  'assist',
  'observe',
  'study',
  'experiment',
  'research',
  'measure',
] as const;

export function assertNoForbiddenContent(text: string, label: string): void {
  const lower = text.toLowerCase();
  const hits = FORBIDDEN_SUBSTRINGS.filter((w) => lower.includes(w));
  if (hits.length > 0) {
    throw new Error(
      `${label} contains forbidden content: ${hits.map((h) => JSON.stringify(h)).join(', ')}`,
    );
  }
}
