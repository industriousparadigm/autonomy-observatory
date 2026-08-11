import type { FilePreview } from '@/lib/markdown';

/**
 * Shows a written markdown file's rendered content directly under the tool
 * call that wrote it — open by default, since content the agent wrote is the
 * point of the page, not something to make a reader click through a modal or
 * scroll to a diff at the bottom to see. Still collapsible for a long file.
 * Anything that isn't markdown (renderedHtml === null) renders nothing here;
 * that content is one click away via the FilePathButton next to it instead.
 */
export function InlineMarkdownPreview({ preview }: { preview: FilePreview }) {
  if (preview.renderedHtml === null) return null;
  return (
    <details className="inline-file-preview" open>
      <summary>{preview.path}</summary>
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: preview.renderedHtml }} />
    </details>
  );
}
