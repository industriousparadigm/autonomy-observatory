/**
 * Pause or resume one arm. A paused arm is skipped by every tick, including
 * one it has a queued run for: the queued request waits until it is resumed.
 */

import { armExists, readArmControl, writeArmControl } from '@/lib/control';
import { fail, readJsonBody, refuse } from '../../../respond';

export async function POST(req: Request, { params }: { params: Promise<{ arm: string }> }): Promise<Response> {
  const refused = refuse(req);
  if (refused) return refused;

  const { arm } = await params;
  if (!armExists(arm)) return fail(404, `No arm called ${arm}.`);

  const body = await readJsonBody(req);
  if (typeof body?.paused !== 'boolean') return fail(400, 'paused must be true or false.');
  if (body.note !== undefined && typeof body.note !== 'string') return fail(400, 'note must be text.');

  const control = readArmControl(arm);
  const next = { ...control, paused: body.paused, note: body.note ?? control.note };
  writeArmControl(arm, next);

  return Response.json({ arm, control: next });
}
