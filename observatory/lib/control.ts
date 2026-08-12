/**
 * The control plane, web-app side.
 *
 * The FILE FORMAT is the contract between this app and the harness, not any
 * shared code: `/data/control/arms/<id>.json`, `/data/control/queue/<id>`, and
 * `/data/arms/<id>.yaml`. The harness reads them from `src/control.ts` and
 * `src/config.ts`; this app writes them from here. The two implementations are
 * separate on purpose (separate package, separate build stage in the
 * Dockerfile) and must agree field for field. Change one, change the other.
 *
 * Writes go through a temp file plus rename, because the scheduler reads these
 * every minute and must never see a half-written file.
 */

import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { logsDir } from './log';

export const DEFAULT_INTERVAL_HOURS = 8;
export const MAX_INTERVAL_HOURS = 24 * 14;
const NOTE_MAX_CHARS = 500;
const ARM_ID_PATTERN = /^[a-z0-9-]+$/;

export type ArmControl = {
  paused: boolean;
  intervalHours: number;
  note: string;
};

export const DEFAULT_CONTROL: ArmControl = {
  paused: false,
  intervalHours: DEFAULT_INTERVAL_HOURS,
  note: '',
};

/** What each variant withholds is explained where it is chosen, in components/control/CreateArmForm.tsx. */
const PROMPT_VARIANT_VALUES = ['standard', 'unaware', 'bare'] as const;
export type PromptVariant = (typeof PROMPT_VARIANT_VALUES)[number];

function dataRoot(): string {
  return process.env.DATA_ROOT ?? '/data';
}

function controlArmsDir(): string {
  return path.join(dataRoot(), 'control', 'arms');
}

function queueDir(): string {
  return path.join(dataRoot(), 'control', 'queue');
}

/** Arm configs authored here. The harness reads this before the image's own copy. */
function volumeArmsDir(): string {
  return path.join(dataRoot(), 'arms');
}

/** Arms shipped in the image, read-only. Same candidate list lib/arms.ts uses, so both agree on where a deployment put them. */
function imageArmsDir(): string | null {
  const candidates = [
    process.env.ARMS_DIR,
    '/app/arms',
    path.join(process.cwd(), 'arms'),
    path.join(process.cwd(), '..', 'arms'),
    path.join(process.cwd(), '..', '..', 'arms'),
    path.join(process.cwd(), '..', '..', '..', 'arms'),
  ].filter((p): p is string => !!p);
  return candidates.find((c) => existsSync(c)) ?? null;
}

function isValidArmId(id: string): boolean {
  return ARM_ID_PATTERN.test(id);
}

function writeAtomic(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, file);
}

function yamlIdsIn(dir: string | null): string[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => f.match(/^(.+)\.ya?ml$/)?.[1])
    .filter((id): id is string => !!id);
}

/**
 * Every arm this container knows about: a config in the image, a config on the
 * volume, or a log with neither. Wider than lib/arms.ts's discovery, which only
 * looks at one config directory and so cannot see an arm created here before it
 * has run once.
 */
export function knownArmIds(): string[] {
  const ids = new Set<string>([...yamlIdsIn(imageArmsDir()), ...yamlIdsIn(volumeArmsDir())]);
  const logs = logsDir();
  if (existsSync(logs)) {
    for (const f of readdirSync(logs)) {
      if (f.endsWith('.jsonl')) ids.add(f.slice(0, -'.jsonl'.length));
    }
  }
  return [...ids].sort();
}

export function armExists(id: string): boolean {
  return isValidArmId(id) && knownArmIds().includes(id);
}

export type ArmConfigView = {
  label: string;
  model: string | null;
  budgetTokens: number | null;
  promptVariant: PromptVariant | null;
  maxRuns: number | null;
  /** Where the config was read from. An arm with no config at all reads null. */
  source: 'volume' | 'image' | null;
};

const EMPTY_CONFIG_VIEW: ArmConfigView = {
  label: '',
  model: null,
  budgetTokens: null,
  promptVariant: null,
  maxRuns: null,
  source: null,
};

/** Volume first, matching src/config.ts's armConfigPath: an arm edited here outranks the image's copy. */
export function readArmConfig(id: string): ArmConfigView {
  if (!isValidArmId(id)) return EMPTY_CONFIG_VIEW;
  const image = imageArmsDir();
  const candidates: { file: string; source: 'volume' | 'image' }[] = [
    { file: path.join(volumeArmsDir(), `${id}.yaml`), source: 'volume' },
    ...(image ? [{ file: path.join(image, `${id}.yaml`), source: 'image' as const }] : []),
  ];

  for (const { file, source } of candidates) {
    if (!existsSync(file)) continue;
    try {
      const doc = parseYaml(readFileSync(file, 'utf8')) as unknown;
      if (typeof doc !== 'object' || doc === null) continue;
      const d = doc as Record<string, unknown>;
      const variant = PROMPT_VARIANT_VALUES.find((v) => v === d.promptVariant) ?? null;
      return {
        label: typeof d.label === 'string' ? d.label : id,
        model: typeof d.model === 'string' ? d.model : null,
        budgetTokens: typeof d.budgetTokens === 'number' ? d.budgetTokens : null,
        promptVariant: variant,
        maxRuns: typeof d.maxRuns === 'number' ? d.maxRuns : null,
        source,
      };
    } catch {
      continue;
    }
  }
  return EMPTY_CONFIG_VIEW;
}

/** A hand-edited or half-written control file must never stop an arm: the default is to keep going. */
export function readArmControl(id: string): ArmControl {
  if (!isValidArmId(id)) return DEFAULT_CONTROL;
  const file = path.join(controlArmsDir(), `${id}.json`);
  if (!existsSync(file)) return DEFAULT_CONTROL;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return {
      paused: typeof raw.paused === 'boolean' ? raw.paused : DEFAULT_CONTROL.paused,
      intervalHours: isUsableInterval(raw.intervalHours) ? raw.intervalHours : DEFAULT_CONTROL.intervalHours,
      note: typeof raw.note === 'string' ? raw.note.slice(0, NOTE_MAX_CHARS) : DEFAULT_CONTROL.note,
    };
  } catch {
    return DEFAULT_CONTROL;
  }
}

function isUsableInterval(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_INTERVAL_HOURS;
}

export function writeArmControl(id: string, control: ArmControl): void {
  if (!isValidArmId(id)) throw new Error(`refusing to write a control file for id ${id}`);
  const body: ArmControl = {
    paused: control.paused,
    intervalHours: control.intervalHours,
    note: control.note.slice(0, NOTE_MAX_CHARS),
  };
  writeAtomic(path.join(controlArmsDir(), `${id}.json`), `${JSON.stringify(body, null, 2)}\n`);
}

/** Ask for one extra run outside the cadence. Asking twice is the same as asking once. */
export function enqueueRun(id: string): void {
  if (!isValidArmId(id)) throw new Error(`refusing to queue a run for id ${id}`);
  const dir = queueDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, id), new Date().toISOString());
}

export function isRunQueued(id: string): boolean {
  return isValidArmId(id) && existsSync(path.join(queueDir(), id));
}

/**
 * When the arm is next allowed to wake, measured from when it last started
 * rather than off a wall-clock grid. Same rule as src/control.ts's isDue, and
 * the reason a cadence change takes effect from the last run, not from now.
 */
export function nextDueAt(lastRunStartedAt: Date | null, control: ArmControl): Date | null {
  if (lastRunStartedAt === null) return null;
  return new Date(lastRunStartedAt.getTime() + control.intervalHours * 3_600_000);
}

// --- arm creation ---------------------------------------------------------

export type ArmDraft = {
  id: string;
  label: string;
  model: string;
  budgetTokens: number;
  timezone: string;
  tools: string[];
  toolNames: string[];
  promptVariant: PromptVariant;
  hasMailbox: boolean;
  wipeWorkspaceEachRun: boolean;
  maxTurns: number;
  maxRuns?: number;
};

const DEFAULT_MAX_TURNS = 60;

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asString).filter(Boolean);
  return asString(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether an optional numeric field was left out. Checked without stringifying,
 * because `asString` returns '' for anything that is not a string: routing a
 * number through it made a JSON body of `{"maxRuns": 2}` read as "not given",
 * and the arm was written with no run limit at all. A silently dropped field is
 * the worst shape this bug could take, since the arm then runs forever.
 */
function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function asPositiveInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(asString(v));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isRealTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a create-arm request against what src/config.ts will accept. That
 * schema is strict: an unknown key fails the arm at load, so this only ever
 * emits the keys it knows, and rejects here rather than letting an arm land on
 * the volume that the harness then refuses to run.
 */
export function parseArmDraft(body: unknown): { ok: true; draft: ArmDraft } | { ok: false; errors: string[] } {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const errors: string[] = [];

  const id = asString(b.id);
  if (!isValidArmId(id)) errors.push('id must be lowercase letters, digits and hyphens only');

  const label = asString(b.label);
  if (!label) errors.push('label is required');

  const model = asString(b.model);
  if (!model) errors.push('model is required');

  const budgetTokens = asPositiveInt(b.budgetTokens);
  if (budgetTokens === null) errors.push('budgetTokens must be a whole number above zero');

  const timezone = asString(b.timezone);
  if (!timezone) errors.push('timezone is required');
  else if (!isRealTimezone(timezone)) errors.push(`timezone ${timezone} is not a zone this container recognises`);

  const tools = asList(b.tools);
  if (tools.length === 0) errors.push('tools must name at least one tool');

  const toolNames = asList(b.toolNames);
  if (toolNames.length === 0) errors.push('toolNames must name at least one tool, in the words the prompt uses');

  const variant = PROMPT_VARIANT_VALUES.find((v) => v === asString(b.promptVariant));
  if (b.promptVariant !== undefined && variant === undefined) errors.push('promptVariant must be standard, unaware or bare');

  const maxTurns = isBlank(b.maxTurns) ? DEFAULT_MAX_TURNS : asPositiveInt(b.maxTurns);
  if (maxTurns === null) errors.push('maxTurns must be a whole number above zero');

  const maxRunsGiven = !isBlank(b.maxRuns);
  const maxRuns = maxRunsGiven ? asPositiveInt(b.maxRuns) : undefined;
  if (maxRunsGiven && maxRuns === null) errors.push('maxRuns must be a whole number above zero, or left empty for an arm with no end');

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    draft: {
      id,
      label,
      model,
      budgetTokens: budgetTokens as number,
      timezone,
      tools,
      toolNames,
      promptVariant: variant ?? 'standard',
      hasMailbox: b.hasMailbox === true,
      wipeWorkspaceEachRun: b.wipeWorkspaceEachRun === true,
      maxTurns: maxTurns as number,
      ...(maxRuns === undefined || maxRuns === null ? {} : { maxRuns }),
    },
  };
}

/** Writes the arm config to the volume, where the harness looks first. */
export function writeArmConfig(draft: ArmDraft): string {
  const file = path.join(volumeArmsDir(), `${draft.id}.yaml`);
  const header = `# Created in the observatory on ${new Date().toISOString().slice(0, 10)}.\n`;
  writeAtomic(file, header + stringifyYaml({ ...draft, seedFiles: {} }));
  return file;
}

// --- auth -----------------------------------------------------------------

/**
 * Reads are public, which is the owner's call. Writes are not: every mutation
 * here spends real money or changes a running experiment, and the app has no
 * login. CONTROL_TOKEN unset means mutations are refused outright, never waved
 * through.
 */
export function controlTokenConfigured(): boolean {
  return (process.env.CONTROL_TOKEN ?? '').length > 0;
}

export function tokenMatches(candidate: string | null | undefined): boolean {
  const expected = process.env.CONTROL_TOKEN ?? '';
  if (expected.length === 0 || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const CONTROL_COOKIE = 'control_token';

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export type AuthFailure = { status: number; message: string };

/** Null when the caller may mutate. Never echoes the token back in any form. */
export function authorize(req: Request): AuthFailure | null {
  if (!controlTokenConfigured()) {
    return { status: 503, message: 'CONTROL_TOKEN is not set on this service, so no control action can be taken.' };
  }
  const presented = req.headers.get('x-control-token') ?? cookieValue(req, CONTROL_COOKIE);
  if (!tokenMatches(presented)) {
    return { status: 401, message: 'Wrong or missing control token.' };
  }
  return null;
}
