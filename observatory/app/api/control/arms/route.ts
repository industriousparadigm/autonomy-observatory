/**
 * Create an arm. The config lands on the volume at /data/arms/<id>.yaml, which
 * the harness reads before the image's own arms/, so a new arm starts running
 * on the next tick with no rebuild and no redeploy.
 *
 * Rejected rather than written if anything is off, because src/config.ts parses
 * these strictly: an arm with a bad field would sit there failing every tick.
 */

import { knownArmIds, parseArmDraft, writeArmConfig, writeArmControl, DEFAULT_CONTROL, MAX_INTERVAL_HOURS } from '@/lib/control';
import { fail, readJsonBody, refuse } from '../respond';

export async function POST(req: Request): Promise<Response> {
  const refused = refuse(req);
  if (refused) return refused;

  const body = await readJsonBody(req);
  if (!body) return fail(400, 'Send a JSON object describing the arm.');

  const parsed = parseArmDraft(body);
  if (!parsed.ok) return fail(400, 'This arm config would not load.', { problems: parsed.errors });

  const { draft } = parsed;
  if (knownArmIds().includes(draft.id)) {
    return fail(409, `An arm called ${draft.id} already exists. Pick another id.`);
  }

  const intervalGiven = body.intervalHours !== undefined && body.intervalHours !== null && body.intervalHours !== '';
  const intervalHours = intervalGiven ? Number(body.intervalHours) : DEFAULT_CONTROL.intervalHours;
  if (!Number.isFinite(intervalHours) || intervalHours <= 0 || intervalHours > MAX_INTERVAL_HOURS) {
    return fail(400, `intervalHours must be a number above 0 and at most ${MAX_INTERVAL_HOURS}.`);
  }

  const file = writeArmConfig(draft);
  if (intervalHours !== DEFAULT_CONTROL.intervalHours) {
    writeArmControl(draft.id, { ...DEFAULT_CONTROL, intervalHours });
  }

  return Response.json({ arm: draft.id, file, intervalHours }, { status: 201 });
}
