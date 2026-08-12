/**
 * Unlock and lock the control page. POST exchanges a correct token for a
 * cookie the browser sends back on later control calls; DELETE throws it away.
 *
 * The token is never written to a log, never returned in a body, and the
 * cookie is HttpOnly so no script on the page can read it back either.
 */

import { CONTROL_COOKIE, controlTokenConfigured, tokenMatches } from '@/lib/control';
import { fail, readJsonBody } from '../respond';

const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

function cookieHeader(value: string, maxAgeSeconds: number): string {
  const parts = [
    `${CONTROL_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export async function POST(req: Request): Promise<Response> {
  if (!controlTokenConfigured()) {
    return fail(503, 'CONTROL_TOKEN is not set on this service, so no control action can be taken.');
  }

  const body = await readJsonBody(req);
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!tokenMatches(token)) return fail(401, 'Wrong control token.');

  return Response.json({ unlocked: true }, { headers: { 'set-cookie': cookieHeader(token, TWELVE_HOURS_SECONDS) } });
}

export async function DELETE(): Promise<Response> {
  return Response.json({ unlocked: false }, { headers: { 'set-cookie': cookieHeader('', 0) } });
}
