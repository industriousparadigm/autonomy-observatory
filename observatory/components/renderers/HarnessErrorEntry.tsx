import { Expandable } from '../Expandable';
import type { HarnessErrorNode } from '@/lib/transcript';

export function HarnessErrorEntry({ node }: { node: HarnessErrorNode }) {
  return (
    <div className="turn turn--harness_error">
      <div className="kind">
        <span className="pill pill--error">Harness error</span>
      </div>
      <p style={{ margin: '0.3rem 0' }}>{node.payload.message}</p>
      {node.payload.stack ? <Expandable text={node.payload.stack} /> : null}
    </div>
  );
}
