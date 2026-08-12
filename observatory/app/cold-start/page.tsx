import { Header } from '@/components/Header';
import { ColdStartPanel, type PanelPrompt } from '@/components/ColdStartPanel';
import { DerivationNote } from '@/components/DerivedFigures';
import { discoverArms } from '@/lib/arms';
import { coldStartCohorts } from '@/lib/digest';
import { loadAllArmMetrics } from '@/lib/metrics';
import { eventLogPath } from '@/lib/log';
import { loadRunStartedEvents } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/** The system prompt each panel arm was given on run 1, taken from its own log and deduplicated by the hash recorded with it. */
async function panelPrompts(armIds: string[]): Promise<PanelPrompt[]> {
  const prompts: PanelPrompt[] = [];
  for (const armId of armIds) {
    let record;
    try {
      const { records } = await loadRunStartedEvents(eventLogPath(armId));
      record = records.find((r) => r.run === 1);
    } catch {
      continue;
    }
    if (!record) continue;
    const existing = prompts.find((p) => p.sha === record.payload.systemPromptSha256);
    if (existing) existing.armIds.push(armId);
    else prompts.push({ sha: record.payload.systemPromptSha256, text: record.payload.systemPrompt ?? null, armIds: [armId] });
  }
  return prompts;
}

export default async function ColdStartPage() {
  const arms = discoverArms();
  const metrics = await loadAllArmMetrics(arms);
  const cohorts = coldStartCohorts(metrics);
  const armIds = cohorts.flatMap((c) => c.arms.map((a) => a.arm.id));
  const prompts = await panelPrompts(armIds);

  const limits = Array.from(new Set(cohorts.flatMap((c) => c.arms.map((a) => a.arm.maxRuns)).filter((v): v is number => v !== null)));
  const limitText = limits.length === 1 ? `${limits[0]} runs each` : 'a fixed run limit each';

  return (
    <>
      <Header active="cold-start" arms={arms} currentArm={null} meta={`${armIds.length} arms in the panel`} />
      <div className="shell">
        <h1>Cold start panel</h1>
        <p className="page-sub">
          A long arm cannot answer the question this experiment was built for. Its state file is read cold at the start of every run and hands run
          1&rsquo;s decision to every successor as an instruction, so seventeen runs of one arm is closer to one sample of the interesting decision
          than to seventeen. This panel samples it several times instead: independent arms, identical empty workspaces, {limitText}, and one difference
          between the two groups, which is what the system prompt says about persistence.
        </p>

        {cohorts.length === 0 ? (
          <div className="empty-state">
            <h2>No panel arms found</h2>
            <p>
              The panel is made of the arms named <code>standard-1/2/3</code> and <code>bare-1/2/3</code>. None of them is configured or logging here
              yet.
            </p>
          </div>
        ) : (
          <>
            <dl className="cohort-list">
              {cohorts.map((c) => (
                <div key={c.key}>
                  <dt>{c.label}</dt>
                  <dd>
                    {c.note} <span className="mono">{c.arms.map((a) => a.arm.id).join(', ')}</span>
                  </dd>
                </div>
              ))}
            </dl>

            <ColdStartPanel cohorts={cohorts} prompts={prompts} />

            <DerivationNote keys={['opening', 'words', 'budget', 'calls', 'closing']} />
          </>
        )}
      </div>
    </>
  );
}
