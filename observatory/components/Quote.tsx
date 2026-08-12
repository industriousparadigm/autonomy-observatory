import { renderMarkdown } from '@/lib/markdown';

/**
 * Text the agent wrote. It writes markdown, so it is rendered as markdown:
 * showing a reader `**What I decided:**` and a literal `- ` is showing them the
 * wire format rather than the writing.
 *
 * Long passages are cut at a block boundary, never at a character count. The
 * count-based cut landed mid-sentence, which split a bold span across the fold
 * (so both halves rendered as literal asterisks) and left the toggle sitting
 * inside a word. Each half is parsed on its own, so the fold has to fall where
 * one markdown block ends and the next begins.
 */
export function Quote({ text, limit = 420 }: { text: string; limit?: number }) {
  const { head, rest } = splitAtBlockBoundary(text.trim(), limit);

  return (
    <blockquote className="quote">
      <Markdown source={head} />
      {rest === null ? null : (
        <details className="quote-more">
          <summary>
            <span className="quote-more-label" data-state="closed">
              Show the rest, {rest.length.toLocaleString('en-US')} more characters
            </span>
            <span className="quote-more-label" data-state="open">
              Show less
            </span>
          </summary>
          <Markdown source={rest} />
        </details>
      )}
    </blockquote>
  );
}

function Markdown({ source }: { source: string }) {
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />;
}

/**
 * Splits on the blank line between markdown blocks, taking whole blocks until
 * the limit is passed. A single block longer than the limit would otherwise
 * defeat the fold entirely, so that one case falls back to the last sentence
 * end before the limit, which is still never mid-word and never mid-emphasis.
 */
function splitAtBlockBoundary(source: string, limit: number): { head: string; rest: string | null } {
  if (source.length <= limit) return { head: source, rest: null };

  const blocks = source.split(/\n\s*\n/);
  const head: string[] = [];
  let taken = 0;
  for (const block of blocks) {
    if (head.length > 0 && taken + block.length > limit) break;
    head.push(block);
    taken += block.length + 2;
  }

  const rest = blocks.slice(head.length).join('\n\n').trim();
  if (rest.length === 0) return splitLongParagraph(source, limit);
  return { head: head.join('\n\n').trim(), rest };
}

function splitLongParagraph(source: string, limit: number): { head: string; rest: string | null } {
  const sentenceEnd = source.lastIndexOf('. ', limit);
  const cut = sentenceEnd > limit * 0.5 ? sentenceEnd + 1 : source.lastIndexOf(' ', limit);
  if (cut <= 0) return { head: source, rest: null };
  return { head: source.slice(0, cut).trim(), rest: source.slice(cut).trim() };
}
