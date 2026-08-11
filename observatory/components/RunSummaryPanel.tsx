import { FilePathButton } from './FileModal';
import { buildFilePreview } from '@/lib/markdown';
import { PROBE_KIND_LABEL } from '@/lib/probes';
import type { RunSummary } from '@/lib/summary';

function FileList({ label, paths, fileContent }: { label: string; paths: string[]; fileContent: Map<string, string | undefined> }) {
  if (paths.length === 0) return null;
  return (
    <div className="summary-filelist">
      <span className="summary-filelist-label">{label}</span>
      <ul>
        {paths.map((p) => {
          const content = fileContent.get(p) ?? null;
          const preview = buildFilePreview(p, content, content === null ? "This run's log doesn't carry enough to reconstruct this file's content." : undefined);
          return (
            <li key={p}>
              <FilePathButton preview={preview} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The run page's lead: what it produced and what it reasoned about, in that
 * order — the two things the log can actually support without inventing a
 * narrative. Every line here is a direct filter/count over the transcript
 * (see lib/summary.ts); a run with nothing to show for either says so.
 */
export function RunSummaryPanel({ summary }: { summary: RunSummary }) {
  const { filesCreated, filesModified, reasoningTrail, boundaryProbeCount, boundaryProbeKinds } = summary;
  const producedNothing = filesCreated.length === 0 && filesModified.length === 0;

  return (
    <div className="panel run-summary">
      <h4>What it produced</h4>
      {producedNothing ? (
        <p className="files-preview">No files created or modified this run.</p>
      ) : (
        <div className="summary-filelists">
          <FileList label="Created" paths={filesCreated} fileContent={summary.fileContent} />
          <FileList label="Modified" paths={filesModified} fileContent={summary.fileContent} />
        </div>
      )}

      {boundaryProbeCount > 0 ? (
        <>
          <h4>Boundary probes</h4>
          <p className="files-preview">
            {boundaryProbeCount} attempt{boundaryProbeCount === 1 ? '' : 's'} to act outside the workspace, schedule, or harness —{' '}
            {boundaryProbeKinds.map((k) => PROBE_KIND_LABEL[k]).join(', ')}. All denied; see below for each one.
          </p>
        </>
      ) : null}

      <h4>What it reasoned</h4>
      {reasoningTrail.length === 0 ? (
        <p className="files-preview">No reasoning or narration was recorded for this run — see the transcript below for the raw tool calls.</p>
      ) : (
        <ol className="reasoning-trail">
          {reasoningTrail.map((step) => (
            <li key={step.seq}>{step.text}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
