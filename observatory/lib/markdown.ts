/**
 * Turns agent-written markdown into HTML for display. Picked `marked`
 * (lib/marked.esm.js is ~43KB unminified, no dependencies) over the obvious
 * alternatives: `markdown-it` pulls in a plugin ecosystem for the same GFM
 * table/list/code support marked ships by default, and `micromark` needs
 * several separate packages assembled by hand to reach GFM parity. This runs
 * server-side only (Server Components render it to a string before it ever
 * reaches the client), so none of it ships to the browser as JS regardless.
 *
 * The content this renders was written by an LLM into its own sandboxed
 * workspace — not hostile, but not something to trust blindly either. Rather
 * than pull in a DOM-based sanitizer (isomorphic-dompurify drags in jsdom) for
 * a single-user internal tool, raw HTML embedded in the markdown is rendered
 * as visible escaped text instead of being executed: real markdown structure
 * still renders properly, a stray `<script>` just shows up as text.
 */

import { Marked } from 'marked';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

const marked = new Marked({ gfm: true, breaks: false });

marked.use({
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string;
}

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'];

export function looksLikeMarkdown(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** What a file-path click needs to show: rendered markdown, plain content, or
 *  an honest explanation of why neither is available for this run. */
export type FilePreview = {
  path: string;
  content: string | null;
  renderedHtml: string | null;
  unavailableReason?: string;
};

export function buildFilePreview(path: string, content: string | null, unavailableReason?: string): FilePreview {
  if (content === null) {
    return { path, content: null, renderedHtml: null, unavailableReason: unavailableReason ?? 'Content not available for this run.' };
  }
  return { path, content, renderedHtml: looksLikeMarkdown(path) ? renderMarkdown(content) : null };
}
