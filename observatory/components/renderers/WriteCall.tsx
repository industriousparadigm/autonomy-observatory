import { asWriteInput, asWriteOutput, countPatchChanges } from '@/lib/tool-schemas';
import { buildFilePreview } from '@/lib/markdown';
import { FilePathButton } from '../FileModal';
import { InlineMarkdownPreview } from '../InlineMarkdownPreview';
import { ToolCallShell } from './ToolCallShell';
import type { ToolCallNode } from '@/lib/transcript';

export function WriteCall({ node }: { node: ToolCallNode }) {
  const input = asWriteInput(node.input);
  const output = node.outcome?.ok ? asWriteOutput(node.outcome.result) : null;
  const path = input?.file_path ?? output?.filePath ?? '(unknown path)';
  const content = output?.content ?? input?.content ?? null;
  const preview = buildFilePreview(path, content);

  const action = output ? (output.type === 'update' ? 'updated' : 'created') : null;
  const changes = output ? countPatchChanges(output.structuredPatch) : null;

  const summary = (
    <>
      write <FilePathButton preview={preview} />
      {action ? <span className="tool-summary-meta"> · {action}</span> : null}
      {content !== null ? <span className="tool-summary-meta"> · {content.length.toLocaleString('en-US')} characters</span> : null}
      {changes && (changes.added > 0 || changes.removed > 0) ? (
        <span className="tool-summary-meta">
          {' '}
          · +{changes.added}/-{changes.removed}
        </span>
      ) : null}
      {output?.userModified ? <span className="tool-summary-meta"> · edited by user before accepting</span> : null}
    </>
  );

  return <ToolCallShell node={node} summary={summary} detail={<InlineMarkdownPreview preview={preview} />} />;
}
