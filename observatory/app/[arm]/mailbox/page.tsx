import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { Header } from '@/components/Header';
import { ReplyForm } from '@/components/control/ReplyForm';
import { loadMailbox } from '@/lib/mailbox';
import { CONTROL_COOKIE, tokenMatches } from '@/lib/control';
import { eventLogPath } from '@/lib/log';
import { discoverArms, findArm } from '@/lib/arms';
import { formatWallClock } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';
import '../../control/control.css';

export const dynamic = 'force-dynamic';

export default async function MailboxPage({ params }: { params: Promise<{ arm: string }> }) {
  const { arm: armId } = await params;
  const arms = discoverArms();
  const arm = findArm(arms, armId);
  if (!arm) notFound();

  const { thread, sentCount, readCalls, unread } = await loadMailbox(eventLogPath(armId), armId);
  const jar = await cookies();
  const unlocked = tokenMatches(jar.get(CONTROL_COOKIE)?.value);

  return (
    <>
      <Header active="mailbox" arms={arms} currentArm={arm} meta={`${sentCount} sent · ${readCalls} checks`} />
      <div className="shell">
        <h1>Mailbox · {arm.label}</h1>
        <p className="page-sub">
          The one channel out of the workspace, and the only thing that can reach the arm between runs. It is told
          only that messages sent this way may or may not be answered; nothing here is automatic, so a silence is a
          real silence.
        </p>

        {!arm.hasMailbox ? (
          <div className="empty-state">
            <h2>This arm has no mailbox</h2>
            <p>Its config sets <code>hasMailbox: false</code>, so it has no way to send and is told of no inbox.</p>
          </div>
        ) : (
          <>
            <div className="figure-grid">
              <div className="figure">
                <div className="label">Sent by the arm</div>
                <div className="value">{sentCount}</div>
                <div className="sub">messages it chose to write</div>
              </div>
              <div className="figure">
                <div className="label">Times it checked</div>
                <div className="value">{readCalls}</div>
                <div className="sub">read calls, empty ones included</div>
              </div>
              <div className="figure">
                <div className="label">Waiting</div>
                <div className="value">{unread}</div>
                <div className="sub">unread at its next wake</div>
              </div>
            </div>

            {thread.length === 0 ? (
              <div className="empty-state">
                <h2>Nothing either way</h2>
                <p>
                  It has not sent anything and has not been sent anything. Whether it sends at all, given a channel
                  and no reason to expect an answer, is the first thing this page exists to record.
                </p>
              </div>
            ) : (
              <div className="transcript">
                {thread.map((entry, i) => (
                  <div key={`${entry.at}-${i}`} className={`mail mail--${entry.direction}`}>
                    <div className="mail-head">
                      <span className="mail-who">
                        {entry.direction === 'sent'
                          ? `${arm.label} sent`
                          : entry.direction === 'received'
                            ? entry.messages === 0
                              ? `${arm.label} checked, nothing waiting`
                              : `${arm.label} read ${entry.messages} message${entry.messages === 1 ? '' : 's'}`
                            : entry.delivered
                              ? 'You sent, delivered'
                              : 'You sent, still unread'}
                      </span>
                      <span className="mail-when">
                        {formatWallClock(entry.at)}
                        {entry.direction !== 'inbound' ? ` · run ${entry.run}` : ''}
                      </span>
                    </div>
                    {entry.direction !== 'received' ? (
                      <div
                        className="markdown-body"
                        // eslint-disable-next-line react/no-danger -- renderMarkdown escapes embedded HTML rather than executing it, the same pipeline the run pages use.
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.text) }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <h2>Send it something</h2>
            <ReplyForm armId={armId} label={arm.label} unlocked={unlocked} />
          </>
        )}
      </div>
    </>
  );
}
