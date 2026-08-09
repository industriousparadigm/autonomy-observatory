import { Fragment } from 'react';
import { parseUnifiedDiff, type DiffLine } from '@/lib/diff';

function Row({ line }: { line: DiffLine }) {
  if (line.kind === 'meta') {
    return (
      <tr>
        <td className="gutter" />
        <td className="gutter" />
        <td className="marker" />
        <td className="code diff-meta-line">{line.text}</td>
      </tr>
    );
  }
  const rowClass = line.kind === 'add' ? 'diff-row-add' : line.kind === 'remove' ? 'diff-row-remove' : undefined;
  const marker = line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : '';
  return (
    <tr className={rowClass}>
      <td className="gutter">{line.oldLine ?? ''}</td>
      <td className="gutter">{line.newLine ?? ''}</td>
      <td className="marker">{marker}</td>
      <td className="code">{line.text}</td>
    </tr>
  );
}

export function DiffView({ diff }: { diff: string }) {
  const files = parseUnifiedDiff(diff);
  if (files.length === 0) {
    return <p className="files-preview">Diff recorded, but no parseable file changes.</p>;
  }

  return (
    <div>
      {files.map((file, i) => (
        <details className="diff-file" key={i} open>
          <summary>
            {file.oldPath === file.newPath ? file.newPath : `${file.oldPath} → ${file.newPath}`}
            {file.binary ? ' (binary)' : ''}
          </summary>
          {file.binary ? (
            <p className="files-preview">Binary file, diff not shown.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="diff-table">
                <tbody>
                  {file.hunks.map((hunk, hi) => (
                    <Fragment key={hi}>
                      <tr>
                        <td colSpan={4} className="diff-hunk-header">
                          {hunk.header}
                        </td>
                      </tr>
                      {hunk.lines.map((line, li) => (
                        <Row key={`${hi}-${li}`} line={line} />
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      ))}
    </div>
  );
}
