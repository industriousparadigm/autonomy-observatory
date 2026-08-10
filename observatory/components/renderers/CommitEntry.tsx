import { DiffView } from '../DiffView';
import type { CommitNode } from '@/lib/transcript';

export function CommitEntry({ node }: { node: CommitNode }) {
  const { sha, filesChanged, insertions, deletions, diff } = node.payload;
  return (
    <div className="turn turn--commit">
      <div className="kind">
        Commit {sha.slice(0, 8)} · {filesChanged} file{filesChanged === 1 ? '' : 's'} · +{insertions}/-{deletions}
      </div>
      <div style={{ padding: '0 1.05rem 0.9rem' }}>
        <DiffView diff={diff} />
      </div>
    </div>
  );
}
