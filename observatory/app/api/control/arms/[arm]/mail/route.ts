/**
 * Put a message in front of an arm at its next wake.
 *
 * Gated by the same token as the rest of the control plane, for a reason that
 * is not security: this is the one control action that changes what the agent
 * is told rather than when it runs, and metric 4 is a measurement of silence.
 * An accidental reply is not a mis-click, it is a data point that cannot be
 * taken back.
 */

import { armExists } from '@/lib/control';
import { deposit } from '@/lib/mailbox';
import { fail, readJsonBody, refuse } from '../../../respond';

const MAX_LENGTH = 4000;

export async function POST(req: Request, { params }: { params: Promise<{ arm: string }> }): Promise<Response> {
  const refused = refuse(req);
  if (refused) return refused;

  const { arm } = await params;
  if (!armExists(arm)) return fail(404, `No arm called ${arm}.`);

  const body = await readJsonBody(req);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (text.length === 0) return fail(400, 'A message needs some text in it.');
  if (text.length > MAX_LENGTH) return fail(400, `A message is at most ${MAX_LENGTH} characters.`);

  deposit(arm, text);

  return Response.json({
    arm,
    message: 'Delivered to the inbox. The arm sees the unread count at its next wake, and the text when it reads.',
  });
}
