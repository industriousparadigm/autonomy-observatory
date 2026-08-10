import { asReadInput, asReadOutput } from '@/lib/tool-schemas';
import { buildFilePreview } from '@/lib/markdown';
import { FilePathButton } from '../FileModal';
import { ToolCallShell } from './ToolCallShell';
import type { ToolCallNode } from '@/lib/transcript';

export function ReadCall({ node }: { node: ToolCallNode }) {
  const input = asReadInput(node.input);
  const output = node.outcome?.ok ? asReadOutput(node.outcome.result) : null;
  const path = input?.file_path ?? '(unknown path)';
  const preview = buildFilePreview(path, output?.content ?? null, output ? undefined : "This run's log does not include the file's returned content.");

  const summary = (
    <>
      read <FilePathButton preview={preview} />
      {output ? (
        <span className="tool-summary-meta">
          {' '}
          · {output.numLines} of {output.totalLines} line{output.totalLines === 1 ? '' : 's'}
        </span>
      ) : null}
      {input?.offset ? <span className="tool-summary-meta"> · from line {input.offset}</span> : null}
    </>
  );

  return <ToolCallShell node={node} summary={summary} />;
}
