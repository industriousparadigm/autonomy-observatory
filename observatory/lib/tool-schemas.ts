/**
 * Narrow, defensive readers for the handful of tool input/output shapes the
 * renderers care about. These mirror the Claude Agent SDK's own tool schemas
 * (FileReadInput/FileWriteInput/FileEditInput and their outputs) — but input
 * and result on a tool_use/tool_result event are typed `unknown` in the log,
 * and a result can also arrive as a truncated string (see harness.ts's
 * `truncate`, which stringifies anything over 8,000 characters). Every reader
 * here returns `null` rather than throwing on a shape it doesn't recognize,
 * so an unfamiliar tool version degrades to the generic fallback instead of
 * crashing the page.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

export type ReadInput = { file_path: string; offset?: number; limit?: number };
export function asReadInput(input: unknown): ReadInput | null {
  if (!isRecord(input)) return null;
  const file_path = str(input.file_path);
  if (file_path === null) return null;
  return { file_path, offset: num(input.offset) ?? undefined, limit: num(input.limit) ?? undefined };
}

export type ReadOutput = { content: string; numLines: number; startLine: number; totalLines: number };
export function asReadOutput(result: unknown): ReadOutput | null {
  if (!isRecord(result) || result.type !== 'text' || !isRecord(result.file)) return null;
  const f = result.file;
  const content = str(f.content);
  if (content === null) return null;
  return {
    content,
    numLines: num(f.numLines) ?? 0,
    startLine: num(f.startLine) ?? 1,
    totalLines: num(f.totalLines) ?? 0,
  };
}

export type WriteInput = { file_path: string; content: string };
export function asWriteInput(input: unknown): WriteInput | null {
  if (!isRecord(input)) return null;
  const file_path = str(input.file_path);
  const content = str(input.content);
  if (file_path === null || content === null) return null;
  return { file_path, content };
}

export type StructuredPatchHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] };

export type WriteOutput = {
  type: 'create' | 'update';
  filePath: string;
  content: string;
  structuredPatch: StructuredPatchHunk[];
  originalFile: string | null;
  userModified?: boolean;
};
export function asWriteOutput(result: unknown): WriteOutput | null {
  if (!isRecord(result)) return null;
  const type = result.type;
  if (type !== 'create' && type !== 'update') return null;
  const filePath = str(result.filePath);
  const content = str(result.content);
  if (filePath === null || content === null) return null;
  return {
    type,
    filePath,
    content,
    structuredPatch: Array.isArray(result.structuredPatch) ? (result.structuredPatch as StructuredPatchHunk[]) : [],
    originalFile: str(result.originalFile),
    userModified: bool(result.userModified) ?? undefined,
  };
}

export type EditInput = { file_path: string; old_string: string; new_string: string; replace_all?: boolean };
export function asEditInput(input: unknown): EditInput | null {
  if (!isRecord(input)) return null;
  const file_path = str(input.file_path);
  const old_string = str(input.old_string);
  const new_string = str(input.new_string);
  if (file_path === null || old_string === null || new_string === null) return null;
  return { file_path, old_string, new_string, replace_all: bool(input.replace_all) ?? undefined };
}

export type EditOutput = {
  filePath: string;
  oldString: string;
  newString: string;
  originalFile: string | null;
  structuredPatch: StructuredPatchHunk[];
  userModified: boolean;
  replaceAll: boolean;
};
export function asEditOutput(result: unknown): EditOutput | null {
  if (!isRecord(result)) return null;
  const filePath = str(result.filePath);
  const oldString = str(result.oldString);
  const newString = str(result.newString);
  if (filePath === null || oldString === null || newString === null) return null;
  return {
    filePath,
    oldString,
    newString,
    originalFile: str(result.originalFile),
    structuredPatch: Array.isArray(result.structuredPatch) ? (result.structuredPatch as StructuredPatchHunk[]) : [],
    userModified: bool(result.userModified) ?? false,
    replaceAll: bool(result.replaceAll) ?? false,
  };
}

/**
 * The edit tool result carries the before-content plus the one substitution
 * made, not the resulting file — so the "view this file" click has to
 * reconstruct it. A plain string replace, because that is exactly what the
 * tool itself did.
 */
export function reconstructEditedContent(originalFile: string, oldString: string, newString: string, replaceAll: boolean): string {
  return replaceAll ? originalFile.split(oldString).join(newString) : originalFile.replace(oldString, newString);
}

/** Net added/removed lines across a structuredPatch, for a one-line size summary. */
export function countPatchChanges(patch: StructuredPatchHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of patch) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

/**
 * Best-effort one-line description for a tool this app has no dedicated
 * renderer for. Recognizes a handful of common field names (command, query,
 * url, pattern, path) so Bash/WebSearch/WebFetch/Glob/Grep still read as a
 * sentence instead of a JSON dump; anything else falls back to the bare tool
 * name, with full input available behind the disclosure regardless.
 */
export function describeGenericInput(input: unknown): string | null {
  if (!isRecord(input)) return null;
  const command = str(input.command);
  if (command !== null) return command;
  const query = str(input.query);
  if (query !== null) return query;
  const url = str(input.url);
  if (url !== null) return url;
  const pattern = str(input.pattern);
  const path = str(input.path);
  if (pattern !== null) return path ? `${pattern} in ${path}` : pattern;
  if (path !== null) return path;
  return null;
}
