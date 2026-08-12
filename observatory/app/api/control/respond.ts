/** Shared plumbing for the control endpoints: refuse first, then parse, then act. */

import { authorize } from '@/lib/control';

export function fail(status: number, message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: message, ...extra }, { status });
}

/** A Response when the caller must be turned away, null when it may proceed. */
export function refuse(req: Request): Response | null {
  const failure = authorize(req);
  return failure ? fail(failure.status, failure.message) : null;
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
