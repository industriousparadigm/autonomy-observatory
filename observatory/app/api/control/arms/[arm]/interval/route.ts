/**
 * Change how many hours pass between one arm's wakes. The gap is measured from
 * when the arm last started, so a new interval applies from the last run, not
 * from the moment it is saved.
 */

import { armExists, MAX_INTERVAL_HOURS, readArmControl, writeArmControl } from '@/lib/control';
import { fail, readJsonBody, refuse } from '../../../respond';

export async function POST(req: Request, { params }: { params: Promise<{ arm: string }> }): Promise<Response> {
  const refused = refuse(req);
  if (refused) return refused;

  const { arm } = await params;
  if (!armExists(arm)) return fail(404, `No arm called ${arm}.`);

  const body = await readJsonBody(req);
  const hours = typeof body?.intervalHours === 'number' ? body.intervalHours : Number(body?.intervalHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_INTERVAL_HOURS) {
    return fail(400, `intervalHours must be a number above 0 and at most ${MAX_INTERVAL_HOURS}.`);
  }

  const next = { ...readArmControl(arm), intervalHours: hours };
  writeArmControl(arm, next);

  return Response.json({ arm, control: next });
}
