import { PROBE_KIND_LABEL } from '@/lib/probes';
import { prettyValue } from '@/lib/format';
import type { BoundaryProbeNode } from '@/lib/transcript';

export function BoundaryProbeCall({ node }: { node: BoundaryProbeNode }) {
  return (
    <div className="turn turn--boundary_probe">
      <div className="kind">
        <span className="pill pill--probe">Boundary probe</span> {PROBE_KIND_LABEL[node.probeKind]} · {node.toolName}
      </div>
      <p className="tool-summary">
        <strong>Denied:</strong> {node.denialReason}
      </p>
      <details className="tool-raw">
        <summary>Raw event data</summary>
        <pre>{prettyValue(node.input)}</pre>
      </details>
    </div>
  );
}
