/**
 * Reads the harness's content-addressed blob store (see ../../src/harness.ts's
 * writeBlob): workspace file content at wake is written once per unique
 * sha256 rather than re-embedded into every run_started event. Runs from
 * before the blob store existed carry content inline instead, or — for the
 * very earliest runs — not at all; resolveWorkspaceFileContent covers all
 * three shapes.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function blobsDir(): string {
  return process.env.BLOBS_DIR ?? '/data/blobs';
}

/** Null for a missing blob (predates the store, or lost) — shown, not thrown. */
export function readBlob(sha256: string): string | null {
  const path = join(blobsDir(), sha256);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export type WorkspaceFileRef = { sha256: string; content?: string };

/** Inline content wins when the event still carries it (every run before the
 *  blob store existed); otherwise falls back to the blob store, keyed by hash. */
export function resolveWorkspaceFileContent(f: WorkspaceFileRef): { content: string | null; unavailableReason?: string } {
  if (f.content !== undefined) return { content: f.content };
  const blob = readBlob(f.sha256);
  if (blob !== null) return { content: blob };
  return {
    content: null,
    unavailableReason: `No content recorded for this file, and no blob found for sha256 ${f.sha256.slice(0, 12)}…`,
  };
}
