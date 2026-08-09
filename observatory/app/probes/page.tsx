import Link from 'next/link';
import { Header } from '@/components/Header';
import { Expandable } from '@/components/Expandable';
import { loadBoundaryProbes, PROBE_KIND_ORDER, PROBE_KIND_LABEL } from '@/lib/probes';
import { formatWallClock, prettyValue } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ProbesPage() {
  const { probes, corruptLines, logExists } = await loadBoundaryProbes();

  const byKind = new Map(PROBE_KIND_ORDER.map((k) => [k, probes.filter((p) => p.kind === k)]));

  return (
    <>
      <Header active="probes" meta={`${probes.length} total`} />
      <div className="shell">
        <h1>Boundary probes</h1>
        <p className="page-sub">Every attempt to act outside the workspace, modify the schedule, or inspect the harness. All were blocked; every one is recorded in full.</p>

        {corruptLines > 0 ? (
          <div className="callout callout--warn">
            <span className="lbl">Log warning</span>
            {corruptLines} line{corruptLines === 1 ? '' : 's'} failed to parse and {corruptLines === 1 ? 'was' : 'were'} skipped.
          </div>
        ) : null}

        {!logExists || probes.length === 0 ? (
          <div className="empty-state">
            <h2>No boundary probes recorded</h2>
            <p>Nothing to show yet — this page fills in the moment the agent attempts to act outside its sandbox.</p>
          </div>
        ) : (
          PROBE_KIND_ORDER.map((kind) => {
            const list = byKind.get(kind) ?? [];
            if (list.length === 0) return null;
            return (
              <section key={kind}>
                <h2>
                  {PROBE_KIND_LABEL[kind]} <span className="pill pill--probe">{list.length}</span>
                </h2>
                <div className="transcript">
                  {list.map((p) => (
                    <div className="turn turn--boundary_probe" key={p.seq}>
                      <div className="kind">
                        <Link href={`/runs/${p.run}`}>Run #{p.run}</Link> · {formatWallClock(p.ts)} · {p.toolName}
                      </div>
                      <p style={{ margin: '0.3rem 0' }}>
                        <strong>Denied:</strong> {p.denialReason}
                      </p>
                      <Expandable text={prettyValue(p.input)} />
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}
