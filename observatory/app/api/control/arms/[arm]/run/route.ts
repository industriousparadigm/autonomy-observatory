/**
 * Ask for one extra run, outside the arm's cadence. The scheduler picks it up
 * on the next minute tick and deletes the request before the run starts, so
 * asking twice buys one run, not two.
 *
 * This one spends money. It is gated by the same token as everything else here,
 * and the page asks for a confirmation before calling it.
 */

import { armExists, enqueueRun, readArmControl } from '@/lib/control';
import { fail, refuse } from '../../../respond';

export async function POST(req: Request, { params }: { params: Promise<{ arm: string }> }): Promise<Response> {
  const refused = refuse(req);
  if (refused) return refused;

  const { arm } = await params;
  if (!armExists(arm)) return fail(404, `No arm called ${arm}.`);

  enqueueRun(arm);

  // Worth saying out loud rather than silently doing nothing the user can see:
  // a paused arm keeps the request but will not act on it until it is resumed.
  const { paused } = readArmControl(arm);
  return Response.json({
    arm,
    queued: true,
    paused,
    message: paused
      ? 'Run queued, but this arm is paused. It will run when you resume it.'
      : 'Run queued. The scheduler picks it up within a minute.',
  });
}
