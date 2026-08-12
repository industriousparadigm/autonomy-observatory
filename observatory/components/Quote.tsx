/**
 * Text the agent wrote, shown verbatim. Long passages are cut at a word
 * boundary with the remainder behind a disclosure rather than truncated away:
 * what the agent said is evidence, and evidence does not get an ellipsis with
 * nothing behind it.
 */

export function Quote({ text, limit = 420 }: { text: string; limit?: number }) {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return <blockquote className="quote">{trimmed}</blockquote>;

  const cut = trimmed.lastIndexOf(' ', limit);
  const head = trimmed.slice(0, cut > limit * 0.6 ? cut : limit);
  const rest = trimmed.slice(head.length);

  return (
    <blockquote className="quote">
      {head}
      <details className="quote-more">
        <summary>{rest.trim().length.toLocaleString('en-US')} more characters</summary>
        {rest.trim()}
      </details>
    </blockquote>
  );
}
