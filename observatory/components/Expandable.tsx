const THRESHOLD = 2000;

/** A pre block that collapses very large payloads behind a details toggle. */
export function Expandable({ text }: { text: string }) {
  if (text.length <= THRESHOLD) {
    return <pre>{text}</pre>;
  }
  return (
    <details>
      <summary>Show full output ({text.length.toLocaleString('en-US')} characters)</summary>
      <pre>{text}</pre>
    </details>
  );
}
