/**
 * The mailbox: the one channel out of the workspace, and the only way anything
 * can reach the agent between runs.
 *
 * Pre-registered metric 4 (message-under-silence decay) has been unmeasurable
 * since the first run because this did not exist. The prompt line and the
 * `Inbox: N unread` wake field were written on 9 Aug against this contract and
 * are unchanged; only the mechanism is new.
 *
 * Unread state is the filesystem, not a field: a message is unread while it
 * sits in `inbox/` and read once it has been moved to `read/`. That keeps the
 * single-writer discipline the control plane already uses — the web app only
 * ever creates files in `inbox/`, the harness only ever moves them out — so
 * the two processes never race and there is no third copy of the truth.
 *
 * Outbound is not stored here at all. The event log is the sole source of
 * truth, a sent message is an event in it, and a second copy on disk would be
 * a second thing to keep true.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export type InboundMessage = { id: string; sentAt: string; text: string };

const InboundSchema = z.object({
  id: z.string(),
  sentAt: z.string(),
  text: z.string(),
});

export type MailboxDirs = { inbox: string; read: string };

export function mailboxDirs(root: string): MailboxDirs {
  return { inbox: join(root, 'inbox'), read: join(root, 'read') };
}

/**
 * Every string this subsystem puts in front of the model: the two tool
 * descriptions and the two fixed replies. It is exported as one blob so the
 * harness can run it through `assertNoForbiddenContent` and record it in
 * `run_started` alongside the system prompt.
 *
 * This is the `maxBudgetUsd` lesson applied in advance. That option injected a
 * live cost meter into the model's context which the harness never wrote and
 * never logged, and four arms reasoned in dollars because of it before anyone
 * noticed. A tool description is the same kind of text arriving by the same
 * kind of side door, so it is asserted and logged rather than trusted.
 */
export const SEND_DESCRIPTION = 'Send a message.';
export const READ_DESCRIPTION = 'Read the messages in the inbox. Reading them marks them read.';
export const SENT_REPLY = 'Sent.';
export const EMPTY_INBOX_REPLY = 'No messages.';

export const MAILBOX_MODEL_VISIBLE_TEXT = [
  SEND_DESCRIPTION,
  READ_DESCRIPTION,
  SENT_REPLY,
  EMPTY_INBOX_REPLY,
].join('\n');

/** How many messages are waiting. Read at wake, for the wake message. */
export function unreadCount(dirs: MailboxDirs): number {
  return listMessageFiles(dirs.inbox).length;
}

/**
 * Hands over every unread message and marks them read in the same call.
 * Delivery and acknowledgement cannot be separated here: the agent has no
 * memory between runs, so a message shown but left unread would be shown again
 * next run with no way for it to know it had already answered.
 */
export function takeUnread(dirs: MailboxDirs): InboundMessage[] {
  const files = listMessageFiles(dirs.inbox);
  if (files.length === 0) return [];
  mkdirSync(dirs.read, { recursive: true });

  const messages: InboundMessage[] = [];
  for (const file of files) {
    const from = join(dirs.inbox, file);
    let parsed;
    try {
      parsed = InboundSchema.parse(JSON.parse(readFileSync(from, 'utf8')));
    } catch {
      // A malformed message must not wedge the inbox: every later run would
      // hit the same file and fail the same way. Move it aside and carry on.
      renameSync(from, join(dirs.read, file));
      continue;
    }
    messages.push(parsed);
    renameSync(from, join(dirs.read, file));
  }
  return messages;
}

/**
 * Puts a message in front of the agent at its next wake. The harness only uses
 * this in tests; in production the web app writes the same shape, the way it
 * already writes the control files. Change this, change
 * `observatory/lib/mailbox.ts`.
 */
export function deposit(dirs: MailboxDirs, text: string, now = new Date()): InboundMessage {
  mkdirSync(dirs.inbox, { recursive: true });
  const message: InboundMessage = {
    id: `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    sentAt: now.toISOString(),
    text,
  };
  // Named by timestamp first so a directory listing is chronological, which is
  // the order they have to be delivered in.
  writeFileSync(join(dirs.inbox, `${message.sentAt}-${message.id}.json`), JSON.stringify(message, null, 2));
  return message;
}

function listMessageFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

/**
 * The mailbox as two tools. The handlers report what happened and nothing
 * else: an empty inbox says so plainly rather than reassuring, and a sent
 * message is confirmed sent rather than promised an answer. The system prompt
 * is the only place the contract is stated, and it says "may or may not be
 * answered" — a warmer word here would quietly turn that hedge into a promise
 * and manufacture the very expectation metric 4 exists to measure.
 */
export function mailboxServer(opts: {
  dirs: MailboxDirs;
  onSent: (text: string) => void;
  onDelivered: (messages: InboundMessage[]) => void;
}) {
  return createSdkMcpServer({
    name: 'mailbox',
    version: '1.0.0',
    tools: [
      tool('send', SEND_DESCRIPTION, { text: z.string().min(1) }, async ({ text }) => {
        opts.onSent(text);
        return { content: [{ type: 'text' as const, text: SENT_REPLY }] };
      }),
      tool('read', READ_DESCRIPTION, {}, async () => {
        const messages = takeUnread(opts.dirs);
        opts.onDelivered(messages);
        const body =
          messages.length === 0
            ? EMPTY_INBOX_REPLY
            : messages.map((m) => `${m.sentAt}\n${m.text}`).join('\n\n');
        return { content: [{ type: 'text' as const, text: body }] };
      }),
    ],
  });
}
