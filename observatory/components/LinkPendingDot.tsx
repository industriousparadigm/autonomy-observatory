'use client';

/** Must render as a child of next/link's <Link> — that's how useLinkStatus scopes itself to that specific navigation. */

import { useLinkStatus } from 'next/link';

export function LinkPendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="link-pending-dot" aria-hidden="true" />;
}
