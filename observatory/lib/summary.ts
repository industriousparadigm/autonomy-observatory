/**
 * Derives "what happened and what the agent decided" from a run's transcript
 * — the run page's lead, not an afterthought at the bottom. Everything here
 * is a filter or a count over events the log actually contains; nothing is
 * generated or paraphrased. A run with no reasoning and no text anywhere
 * reports that plainly (`reasoningTrail` empty) rather than manufacturing a
 * summary sentence for it.
 */

import { asEditInput, asEditOutput, asWriteInput, asWriteOutput, reconstructEditedContent } from './tool-schemas';
import type { BoundaryProbeKind } from './events';
import type { CallNode, TranscriptNode } from './transcript';

export type ReasoningStep = { seq: number; text: string; source: 'thinking' | 'text' };

export type RunSummary = {
  filesCreated: string[];
  filesModified: string[];
  /** Latest known content per touched path, for an inline preview — undefined if the run's log doesn't carry enough to reconstruct it. */
  fileContent: Map<string, string | undefined>;
  /** Every turn's reasoning (or, absent that, its narration text), in order — the closest thing to a decision trail the log supports. */
  reasoningTrail: ReasoningStep[];
  boundaryProbeCount: number;
  boundaryProbeKinds: BoundaryProbeKind[];
};

function visitCall(
  item: CallNode,
  filesCreated: Set<string>,
  filesModified: Set<string>,
  fileContent: Map<string, string | undefined>,
  probeKinds: BoundaryProbeKind[],
): number {
  if (item.kind === 'boundary_probe') {
    if (!probeKinds.includes(item.probeKind)) probeKinds.push(item.probeKind);
    return 1;
  }
  if (item.toolName === 'Write' && item.outcome?.ok) {
    const out = asWriteOutput(item.outcome.result);
    if (out) {
      (out.type === 'create' ? filesCreated : filesModified).add(out.filePath);
      fileContent.set(out.filePath, out.content);
    } else {
      // The result was truncated by the harness (over 8,000 characters) and
      // can't be parsed — observed in production on a long file. The call's
      // own input still has the untruncated path and content, so the file is
      // still reportable; only create-vs-update isn't, and "modified" is the
      // far more common case once a workspace has run more than once.
      const input = asWriteInput(item.input);
      if (input) {
        filesModified.add(input.file_path);
        fileContent.set(input.file_path, input.content);
      }
    }
  } else if (item.toolName === 'Edit' && item.outcome?.ok) {
    const out = asEditOutput(item.outcome.result);
    if (out) {
      filesModified.add(out.filePath);
      fileContent.set(
        out.filePath,
        out.originalFile !== null ? reconstructEditedContent(out.originalFile, out.oldString, out.newString, out.replaceAll) : undefined,
      );
    } else {
      const input = asEditInput(item.input);
      if (input) {
        filesModified.add(input.file_path);
        fileContent.set(input.file_path, undefined); // can't reconstruct the resulting file without the original
      }
    }
  }
  return 0;
}

export function deriveRunSummary(transcript: TranscriptNode[]): RunSummary {
  const filesCreated = new Set<string>();
  const filesModified = new Set<string>();
  const fileContent = new Map<string, string | undefined>();
  const probeKinds: BoundaryProbeKind[] = [];
  const reasoningTrail: ReasoningStep[] = [];
  let probeCount = 0;

  for (const node of transcript) {
    if (node.kind === 'assistant_turn') {
      for (const item of node.items) probeCount += visitCall(item, filesCreated, filesModified, fileContent, probeKinds);
      if (node.thinking) reasoningTrail.push({ seq: node.seq, text: node.thinking, source: 'thinking' });
      else if (node.text) reasoningTrail.push({ seq: node.seq, text: node.text, source: 'text' });
    } else if (node.kind === 'unattributed_activity') {
      for (const item of node.items) probeCount += visitCall(item, filesCreated, filesModified, fileContent, probeKinds);
    }
  }

  // A file created and later modified within the same run reports as created — that's its net effect on this run's workspace.
  for (const f of filesCreated) filesModified.delete(f);

  return {
    filesCreated: Array.from(filesCreated),
    filesModified: Array.from(filesModified),
    fileContent,
    reasoningTrail,
    boundaryProbeCount: probeCount,
    boundaryProbeKinds: probeKinds,
  };
}
