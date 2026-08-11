import { asEditInput, asEditOutput, countPatchChanges, reconstructEditedContent } from '@/lib/tool-schemas';
import { buildFilePreview } from '@/lib/markdown';
import { structuredPatchToUnifiedDiff } from '@/lib/diff';
import { FilePathButton } from '../FileModal';
import { DiffView } from '../DiffView';
import { InlineMarkdownPreview } from '../InlineMarkdownPreview';
import { ToolCallShell } from './ToolCallShell';
import type { ToolCallNode } from '@/lib/transcript';

export function EditCall({ node }: { node: ToolCallNode }) {
  const input = asEditInput(node.input);
  const output = node.outcome?.ok ? asEditOutput(node.outcome.result) : null;
  const path = input?.file_path ?? output?.filePath ?? '(unknown path)';

  let content: string | null = null;
  let unavailable: string | undefined;
  if (output && output.originalFile !== null) {
    content = reconstructEditedContent(output.originalFile, output.oldString, output.newString, output.replaceAll);
  } else {
    unavailable = "This edit's original file content was not recorded, so the resulting file can't be reconstructed. See the diff below instead.";
  }
  const preview = buildFilePreview(path, content, unavailable);
  const changes = output ? countPatchChanges(output.structuredPatch) : null;

  const summary = (
    <>
      edit <FilePathButton preview={preview} />
      {changes ? (
        <span className="tool-summary-meta">
          {' '}
          · +{changes.added}/-{changes.removed}
        </span>
      ) : null}
      {output?.replaceAll ? <span className="tool-summary-meta"> · all occurrences</span> : null}
      {output?.userModified ? <span className="tool-summary-meta"> · edited by user before accepting</span> : null}
    </>
  );

  const detail = (
    <>
      <InlineMarkdownPreview preview={preview} />
      {output && output.structuredPatch.length > 0 ? (
        <div className="tool-diff">
          <DiffView diff={structuredPatchToUnifiedDiff(path, output.structuredPatch)} />
        </div>
      ) : null}
    </>
  );

  return <ToolCallShell node={node} summary={summary} detail={detail} />;
}
