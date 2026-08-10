'use client';

/**
 * Makes an entire timeline row navigate, not just the "#N" link inside it —
 * a hover highlight across the whole row with only one small cell actually
 * clickable reads as broken. The real <Link> in the run-number cell stays
 * (so cmd-click / right-click / middle-click still work); clicks anywhere
 * else in the row defer to it via the router.
 */

import { useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';

export function RunRow({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();

  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    router.push(href);
  };

  return (
    <tr className={['row-link', className].filter(Boolean).join(' ')} onClick={onClick}>
      {children}
    </tr>
  );
}
