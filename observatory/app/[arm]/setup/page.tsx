import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { FileModalProvider, FilePathButton } from '@/components/FileModal';
import { resolveWorkspaceFileContent } from '@/lib/blobs';
import { buildFilePreview } from '@/lib/markdown';
import { loadRunStartedEvents, observedCadenceMs, timezoneFromWakeMessage, type RunStartedRecord } from '@/lib/setup';
import { eventLogPath } from '@/lib/log';
import { discoverArms, findArm, PROMPT_VARIANT_NOTE } from '@/lib/arms';
import { formatCompact, formatElapsedGap, formatWallClock } from '@/lib/format';

export const dynamic = 'force-dynamic';

function WakeContextPanel({ record }: { record: RunStartedRecord }) {
  const p = record.payload;
  return (
    <div className="panel wake-context">
      <h3>
        Run #{record.run} · {formatWallClock(record.ts)}
      </h3>

      <h4>System prompt</h4>
      {p.systemPrompt !== undefined ? (
        <pre className="wake-message">{p.systemPrompt}</pre>
      ) : (
        <div className="callout callout--warn">
          <span className="lbl">Not recorded</span>
          This run predates the systemPrompt field in the event log. Only its hash was kept ({p.systemPromptSha256.slice(0, 16)}…) — there is no verbatim
          text to show for this run.
        </div>
      )}

      <h4>Wake message</h4>
      <pre className="wake-message">{p.wakeMessage}</pre>

      <h4>Tools the agent was told about</h4>
      {p.toolNames ? (
        <ul>
          {p.toolNames.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="files-preview">Not recorded for this run.</p>
      )}

      <h4>Model &amp; budget</h4>
      <p className="files-preview">
        {p.model} · {formatCompact(p.budgetTokens)} token budget
        {p.elapsedMs !== null ? ` · ${formatElapsedGap(p.elapsedMs)} since the previous run` : ' · first recorded run'}
      </p>

      <h4>
        Workspace at wake ({p.workspaceFiles.length} file{p.workspaceFiles.length === 1 ? '' : 's'})
      </h4>
      {p.workspaceFiles.length === 0 ? (
        <p className="files-preview">Empty workspace.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Path</th>
                <th>Size</th>
                <th>SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {p.workspaceFiles.map((f) => {
                const resolved = resolveWorkspaceFileContent(f);
                const preview = buildFilePreview(f.path, resolved.content, resolved.unavailableReason);
                return (
                  <tr key={f.path}>
                    <td>
                      <FilePathButton preview={preview} />
                    </td>
                    <td className="num">{f.bytes.toLocaleString('en-US')} B</td>
                    <td className="num mono files-preview">{f.sha256.slice(0, 12)}…</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default async function SetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ arm: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { arm: armId } = await params;
  const { run: runParam } = await searchParams;

  const arms = discoverArms();
  const arm = findArm(arms, armId);
  if (!arm) notFound();

  const { records, logExists } = await loadRunStartedEvents(eventLogPath(armId));

  if (!logExists || records.length === 0) {
    return (
      <>
        <Header active="setup" arms={arms} currentArm={arm} />
        <div className="shell">
          <h1>Setup &amp; docs · {arm.label}</h1>
          <div className="empty-state">
            <h2>Nothing recorded yet</h2>
            <p>
              This fills in the moment run 1 wakes: the system prompt, the wake message, the tools the agent was told about, and the workspace exactly
              as it existed at wake.
            </p>
          </div>
        </div>
      </>
    );
  }

  const latest = records[0]!;
  const selected = runParam ? (records.find((r) => r.run === Number(runParam)) ?? latest) : latest;
  const cadence = observedCadenceMs(records);
  const timezone = timezoneFromWakeMessage(latest.payload.wakeMessage);

  return (
    <>
      <Header active="setup" arms={arms} currentArm={arm} />
      <div className="shell">
        <h1>Setup &amp; docs · {arm.label}</h1>
        <p className="page-sub">
          Everything the agent is given, verbatim, so it is easy to confirm by eye that the prompts carry no instruction, no goal, and no framing —
          nothing on this page is summarized or reworded from what was actually logged.
        </p>

        <h2>Current configuration</h2>
        <p className="page-sub">
          Reflects run #{latest.run}, the most recently recorded wake ({formatWallClock(latest.ts)}). A config change takes effect at the next wake, so
          this can lag an edit to the arm file until then.
        </p>
        <div className="stat-row">
          <div className="stat">
            <div className="label">Model</div>
            <div className="value">{latest.payload.model}</div>
          </div>
          <div className="stat">
            <div className="label">Budget</div>
            <div className="value">{formatCompact(latest.payload.budgetTokens)} tokens</div>
          </div>
          <div className="stat">
            <div className="label">Timezone</div>
            <div className="value">{timezone ?? 'not recorded'}</div>
          </div>
          <div className="stat">
            <div className="label">Observed cadence</div>
            <div className="value">{cadence !== null ? `~${formatElapsedGap(cadence)}` : 'not enough runs yet'}</div>
          </div>
        </div>
        <p className="page-sub">
          Tools: {latest.payload.toolNames ? latest.payload.toolNames.join(', ') : <em>not recorded for this run</em>}. Cadence above is the median gap
          between recent wakes, measured from the log — the log has no separate field for a declared schedule.
        </p>
        {arm.promptVariant ? (
          <p className="page-sub">
            Prompt variant: <strong>{arm.promptVariant}</strong> — {PROMPT_VARIANT_NOTE[arm.promptVariant]}
          </p>
        ) : null}

        <h2>Wake context for a specific run</h2>
        <div className="filters">
          {records.slice(0, 40).map((r) => (
            <Link key={r.run} href={`/${armId}/setup?run=${r.run}`} className={selected.run === r.run ? 'active' : ''}>
              #{r.run}
            </Link>
          ))}
        </div>

        <FileModalProvider>
          <WakeContextPanel record={selected} />
        </FileModalProvider>
      </div>
    </>
  );
}
