/** Parses a unified diff (as produced by `git diff`) into renderable structure. */

export type DiffLine = {
  kind: 'add' | 'remove' | 'context' | 'meta';
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

export type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

export type DiffFile = {
  oldPath: string;
  newPath: string;
  binary: boolean;
  hunks: DiffHunk[];
};

const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(diff: string): DiffFile[] {
  if (!diff.trim()) return [];
  const lines = diff.split('\n');
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const fileMatch = line.match(FILE_HEADER);
    if (fileMatch) {
      current = { oldPath: fileMatch[1]!, newPath: fileMatch[2]!, binary: false, hunks: [] };
      files.push(current);
      hunk = null;
      continue;
    }
    if (!current) continue;

    if (line.startsWith('Binary files ') && line.endsWith(' differ')) {
      current.binary = true;
      continue;
    }
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to')
    ) {
      continue;
    }

    const hunkMatch = line.match(HUNK_HEADER);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[3]);
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', oldLine: null, newLine, text: line.slice(1) });
      newLine++;
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'remove', oldLine, newLine: null, text: line.slice(1) });
      oldLine++;
    } else if (line.startsWith('\\')) {
      hunk.lines.push({ kind: 'meta', oldLine: null, newLine: null, text: line.slice(1).trim() });
    } else {
      hunk.lines.push({ kind: 'context', oldLine, newLine, text: line.slice(1) });
      oldLine++;
      newLine++;
    }
  }

  return files;
}

/** File paths touched by a diff, for a one-line "what changed" summary. */
export function changedFilePaths(diff: string): string[] {
  const paths: string[] = [];
  for (const line of diff.split('\n')) {
    const match = line.match(FILE_HEADER);
    if (match) paths.push(match[2] ?? match[1]!);
  }
  return paths;
}
