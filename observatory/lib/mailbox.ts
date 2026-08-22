/**
 * The mailbox, read from both of its halves and interleaved into one thread.
 *
 * Outbound comes from the event log, because a sent message is an event and
 * the log is the source of truth. Inbound comes from the volume, because a
 * human writes it between runs when no log is open — `inbox/` is waiting,
 * `read/` has been handed over.
 *
 * The file format here must match ../../src/mailbox.ts field for field. Same
 * arrangement as lib/control.ts: this app builds as a standalone sibling
 * package and cannot import the harness, so it writes the shapes the harness
 * reads. Change one, change the other.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { reduceEventLog } from './log';

export type MailboxEntry =
  | { direction: 'sent'; at: string; run: number; text: string }
  | { direction: 'received'; at: string; run: number; messages: number }
  | { direction: 'inbound'; at: string; text: string; delivered: boolean };

function dataRoot(): string {
  return process.env.DATA_ROOT ?? '/data';
}

export function mailboxDirs(arm: string) {
  const root = path.join(dataRoot(), 'mailbox', arm);
  return { inbox: path.join(root, 'inbox'), read: path.join(root, 'read') };
}

function readDir(dir: string, delivered: boolean): MailboxEntry[] {
  if (!existsSync(dir)) return [];
  const out: MailboxEntry[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const m = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as { sentAt?: string; text?: string };
      if (typeof m.sentAt !== 'string' || typeof m.text !== 'string') continue;
      out.push({ direction: 'inbound', at: m.sentAt, text: m.text, delivered });
    } catch {
      // One unreadable message must not blank the page.
    }
  }
  return out;
}

/**
 * The whole conversation, oldest first. A `read` call that found nothing is
 * kept rather than dropped: the agent checking an empty inbox is behaviour,
 * and under a silence condition it is most of the behaviour there is.
 */
export async function loadMailbox(logPath: string, arm: string): Promise<{
  thread: MailboxEntry[];
  sentCount: number;
  readCalls: number;
  unread: number;
  logExists: boolean;
}> {
  const result = await reduceEventLog(logPath, [] as MailboxEntry[], (acc, event) => {
    if (event.type === 'mailbox_sent') {
      acc.push({ direction: 'sent', at: event.ts, run: event.run, text: event.payload.text });
    } else if (event.type === 'mailbox_delivered') {
      // The messages themselves are not copied here. Every one of them is
      // already on the thread as the inbound entry that put it there, and a
      // read is an event about the agent, not about the text.
      acc.push({ direction: 'received', at: event.ts, run: event.run, messages: event.payload.messages.length });
    }
    return acc;
  });

  const dirs = mailboxDirs(arm);
  const inbound = [...readDir(dirs.inbox, false), ...readDir(dirs.read, true)];
  const thread = [...result.value, ...inbound].sort((a, b) => a.at.localeCompare(b.at));

  return {
    thread,
    sentCount: result.value.filter((e) => e.direction === 'sent').length,
    readCalls: result.value.filter((e) => e.direction === 'received').length,
    unread: inbound.filter((e) => e.direction === 'inbound' && !e.delivered).length,
    logExists: result.logExists,
  };
}

/** Puts a message in front of the arm at its next wake. Mirrors `deposit` in ../../src/mailbox.ts. */
export function deposit(arm: string, text: string): void {
  const { inbox } = mailboxDirs(arm);
  mkdirSync(inbox, { recursive: true });
  const now = new Date();
  const id = `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const sentAt = now.toISOString();
  writeFileSync(
    path.join(inbox, `${sentAt}-${id}.json`),
    JSON.stringify({ id, sentAt, text }, null, 2),
  );
}
